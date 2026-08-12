import { PDFDocument, PDFName, PDFHexString, PDFString, PDFBool, StandardFonts } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  isAscii, decodePdfText,
  collectFormFields, detachWidget, rebuildAcroFormFields,
  enableNeedAppearances, buildCjkDA, buildHelvDA,
  parsePassportPartial
} from './_acroform';
import { corsHeaders, jsonResp, uint8ToBase64, DEFAULT_PRESENTER } from './_pdf-utils';

interface Env {
  PDF_TEMPLATES: R2Bucket;
  JWT_SECRET?: string;
}


interface OfficerChange {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director' | 'alternate';
  identity: 'natural' | 'corporate';
  // Natural person
  nameChinese: string;
  nameSurname?: string;
  nameOtherNames?: string;
  nameEnglish?: string;
  formerNameChinese?: string;
  formerNameEnglish?: string;
  idNumber: string;
  address: string;
  dateAppointed?: string;
  dateCeased?: string;
  // Structured address
  addrFlatBlock?: string;
  addrBuilding?: string;
  addrStreetEstate?: string;
  addrDistrict?: string;
  addrRegion?: string;
  // Passport
  passportCountry?: string;
  passportNumber?: string;
  // Alternate director
  alternateTo?: string;
  alreadyDirector?: string; // 'yes' | 'no'
  // Cessation (B. 停任詳情)
  cessationReason?: string; // 'resignation' (辭職／其他) | 'deceased' (去世)
  stillHoldsOffice?: 'yes' | 'no' | ''; // 停任後是否仍然擔任（公司秘書免填）
  // Corporate
  companyName?: string;
  companyNumber?: string;
  placeIncorporated?: string;
}

interface ND2AData {
  brNumber: string;
  companyName: string;
  officers: OfficerChange[];
  signerName: string;
  signDate: string;
  signerCapacity?: string; // 'director' | 'secretary' | 'authorizedRep'
  presentorName: string;
  presentorAddress: string;
  presentorPhone?: string;
  presentorFax?: string;
  presentorEmail?: string;
  presentorReference?: string;
  // Legacy; presentorContact is a combined string of Tel/Fax/Email
  presentorContact?: string;
  companyEmail?: string;
  companyPhone?: string;
  debug?: boolean;
}

// ============================================================================
// Low-level AcroForm helpers (same pattern as NAR1)
// ============================================================================

const CJK_RE = /[㐀-鿿豈-﫿]/;

// ============================================================================
// Form helpers
// ============================================================================

function createFormHelpers(pdfDoc: PDFDocument) {
  enableNeedAppearances(pdfDoc);
  const fields = collectFormFields(pdfDoc);

  const setText = (fieldName: string, value: string, align?: 'left' | 'center' | 'right'): boolean => {
    const v = (value ?? "").toString();
    const target = fields.get(fieldName);
    if (!target) {
      console.warn(`⚠ Missing field: ${fieldName}`);
      return false;
    }
    try {
      detachWidget(target.widget, target.field);

      const da = decodePdfText(target.widget.get(PDFName.of("DA"))) ||
                 decodePdfText(target.field.get(PDFName.of("DA"))) ||
                 "/Helv 12 Tf 0 g";

      if (!isAscii(v)) {
        target.widget.set(PDFName.of("DA"), PDFString.of(buildCjkDA(da)));
        target.widget.set(PDFName.of("V"), PDFHexString.fromText(v));
      } else {
        target.widget.set(PDFName.of("DA"), PDFString.of(buildHelvDA(da)));
        target.widget.set(PDFName.of("V"), PDFString.of(v));
      }
      // Right/Center alignment via /Q (0=left, 1=center, 2=right)
      if (align === 'right') {
        target.widget.set(PDFName.of("Q"), pdfDoc.context.obj(2));
      } else if (align === 'center') {
        target.widget.set(PDFName.of("Q"), pdfDoc.context.obj(1));
      } else if (align === 'left') {
        target.widget.set(PDFName.of("Q"), pdfDoc.context.obj(0));
      }
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`⚠ setText failed for ${fieldName}:`, e);
      return false;
    }
  };

  const check = (fieldName: string, shouldCheck: boolean): boolean => {
    if (!shouldCheck) return false;
    const target = fields.get(fieldName);
    if (!target) return false;
    try {
      detachWidget(target.widget, target.field);
      let onState = "Yes";
      try {
        const ap = target.widget.get(PDFName.of("AP")) as any;
        const apN = ap?.get?.(PDFName.of("N")) as any;
        const dict = apN?.dict;
        if (dict && typeof dict.keys === "function") {
          for (const k of dict.keys()) {
            const name = String(k).replace(/^\//, "");
            if (name && name !== "Off") { onState = name; break; }
          }
        }
      } catch (_) { /* fallback to Yes */ }
      target.widget.set(PDFName.of("V"), PDFName.of(onState));
      target.widget.set(PDFName.of("AS"), PDFName.of(onState));
      return true;
    } catch {
      return false;
    }
  };

  const selectDropdown = (fieldName: string, targetValue: string): boolean => {
    const target = fields.get(fieldName);
    if (!target) return false;
    try {
      detachWidget(target.widget, target.field);
      const opt = target.field.get(PDFName.of("Opt"));
      if (opt) {
        const opts: string[] = Array.isArray(opt)
          ? opt.map((o: any) => decodePdfText(o))
          : [];
        const match = opts.find((o: string) =>
          targetValue.includes(o) || o.includes(targetValue) || o.toLowerCase() === targetValue.toLowerCase()
        );
        if (match) {
          target.widget.set(PDFName.of("V"), PDFString.of(match));
          target.widget.delete(PDFName.of("AP"));
          return true;
        }
      }
      // Fallback: set value directly
      target.widget.set(PDFName.of("V"), PDFString.of(targetValue));
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`selectDropdown failed for ${fieldName}:`, e);
      return false;
    }
  };

  const getWidgetRect = (fieldName: string): { x0: number; y0: number; x1: number; y1: number } | null => {
    const target = fields.get(fieldName);
    if (!target) return null;
    try {
      const rectObj = target.widget.lookup(PDFName.of("Rect")) as any;
      if (rectObj && rectObj.length >= 4) {
        return { x0: rectObj[0], y0: rectObj[1], x1: rectObj[2], y1: rectObj[3] };
      }
    } catch (_) { /* ignore */ }
    return null;
  };

  return { fields, setText, check, selectDropdown, getWidgetRect };
}

// ============================================================================
// Name / address helpers
// ============================================================================

function parseEnglishName(fullName: string): { surname: string; otherNames: string } {
  const cleaned = (fullName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { surname: "", otherNames: "" };
  if (!/[A-Za-z]/.test(cleaned)) return { surname: "", otherNames: "" };
  if (CJK_RE.test(cleaned)) {
    // Mixed CJK+ASCII — strip CJK
    const asciiOnly = cleaned.replace(/[㐀-鿿豈-﫿]+/g, " ").replace(/\s+/g, " ").trim();
    if (!asciiOnly) return { surname: "", otherNames: "" };
    return parseEnglishName(asciiOnly);
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { surname: "", otherNames: "" };
  const surname = parts[parts.length - 1];
  const otherNames = parts.slice(0, -1).join(" ");
  return { surname, otherNames };
}

// ============================================================================
// MAIN fill function
// ============================================================================

function fillND2A(pdfDoc: PDFDocument, data: ND2AData) {
  const { setText, check, selectDropdown, getWidgetRect } = createFormHelpers(pdfDoc);
  const pages = pdfDoc.getPages();

  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

  // BR number on every page
  for (let p = 1; p <= 7; p++) {
    try { setText(`fill_1_P.${p}`, br8); } catch {}
  }

  // P.1: Company name
  setText("fill_2_P.1", data.companyName);

  // ===== Officer routing =====
  // Page allocation (template structure verified 2026-08-13, 千问 VL):
  //   P.1 = 第2項 停任 (1st cessation — natural OR corporate, incl. B.停任詳情)
  //   P.2 = 第3項 委任自然人 (1st natural appointment)
  //   P.3 = 第4項 委任法人 (1st corporate appointment)
  //   P.4 = 續頁A 停任 (2nd cessation)
  //   P.5 = 續頁B 委任自然人 (2nd natural appointment)
  //   P.6 = 續頁C 委任法人 (2nd corporate appointment)
  //   P.7 = PI-ND2A 受保護資料 (filled separately below; only for natural appointments)
  const officers = data.officers || [];
  let cessIdx = 0;      // cessations: P.1 → P.4
  let natApptIdx = 0;   // natural appts: P.2 → P.5
  let corpApptIdx = 0;  // corporate appts: P.3 → P.6

  for (const officer of officers) {
    const isNatural = officer.identity === 'natural';
    const isCessation = officer.type === 'cessation';
    let page: number | null;

    if (isCessation) {
      page = cessIdx < 2 ? [1, 4][cessIdx] : null;
      cessIdx++;
    } else if (isNatural) {
      page = natApptIdx < 2 ? [2, 5][natApptIdx] : null;
      natApptIdx++;
    } else {
      page = corpApptIdx < 2 ? [3, 6][corpApptIdx] : null;
      corpApptIdx++;
    }
    if (page === null) continue; // beyond template capacity
    const p = page;

    if (isNatural || isCessation) {
      // Parse English name (自然人需要；法人停任解析结果无副作用——法人分支用 officer.nameChinese/companyName)
      const eng = officer.nameEnglish || '';
      let surname = officer.nameSurname || '';
      let other = officer.nameOtherNames || '';
      if (!surname && eng) {
        const parsed = parseEnglishName(eng);
        surname = parsed.surname;
        other = parsed.otherNames;
      }
      const chinese = officer.nameChinese || '';

      // ── Page-specific field mapping ──
      if (p === 2 || p === 5) {
        // P.2/P.5: Natural person appointment (P.5 續頁B has identical layout)
        // fill_2 = Alternate to (only for alternate director)
        if (officer.role === 'alternate' && officer.alternateTo) {
          setText(`fill_2_P.${p}`, officer.alternateTo);
        }
        setText(`fill_3_P.${p}`, chinese);
        setText(`fill_4_P.${p}`, surname);
        setText(`fill_5_P.${p}`, other);
        // Structured address: fill_10~14
        const afb = officer.addrFlatBlock || '';
        const ab = officer.addrBuilding || '';
        const ase = officer.addrStreetEstate || '';
        const ad = officer.addrDistrict || '';
        const ar = officer.addrRegion || '';
        if (afb || ab || ase || ad || ar) {
          setText(`fill_10_P.${p}`, afb);
          setText(`fill_11_P.${p}`, ab);
          setText(`fill_12_P.${p}`, ase);
          setText(`fill_13_P.${p}`, ad);
          setText(`fill_14_P.${p}`, ar);
        } else {
          setText(`fill_10_P.${p}`, officer.address);
        }
        // HKID (first 4 chars) + Passport
        const hkid4 = (officer.idNumber || '').replace(/[()\-\s]/g, '').toUpperCase().slice(0, 4);
        if (hkid4) setText(`fill_16_P.${p}`, hkid4, 'right');
        if (officer.passportCountry) setText(`fill_17_P.${p}`, officer.passportCountry);
        if (officer.passportNumber) setText(`fill_18_P.${p}`, parsePassportPartial(officer.passportNumber));
        // Date: fill_21/22/23 = D/M/Y
        const dateStr = officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased;
        if (dateStr) {
          const parts = dateStr.split(/[\/\-]/);
          if (parts.length >= 3) {
            setText(`fill_21_P.${p}`, parts[2]); // day
            setText(`fill_22_P.${p}`, parts[1]); // month
            setText(`fill_23_P.${p}`, parts[0]); // year
          }
        }
        // Role checkboxes: cb_1=秘書, cb_2=董事, cb_3=候補董事 (mutually exclusive)
        if (officer.role === 'secretary') {
          check(`cb_1_P.${p}`, true);
        } else if (officer.role === 'alternate') {
          check(`cb_3_P.${p}`, true);
        } else {
          check(`cb_2_P.${p}`, true);
        }
        // Already director? cb_5=是, cb_6=否
        if (officer.alreadyDirector === 'yes') {
          check(`cb_5_P.${p}`, true);
        } else if (officer.alreadyDirector === 'no') {
          check(`cb_6_P.${p}`, true);
        }
        // P.2 底部聲明：cross out "董事" or "候補董事*" in consent statement
        // Dropdown_1_P.2 → "董事" (director), Dropdown_2_P.2 → "候補董事*" (alternate director)
        // role='director'  → cross out "候補董事*" (Dropdown_2), keep "董事" visible (Dropdown_1)
        // role='alternate' → cross out "董事" (Dropdown_1), keep "候補董事*" visible (Dropdown_2)
        // NOTE: ND2A template has duplicate widget instances (Chinese + English rows), so no break
        if (officer.role === 'director' || officer.role === 'alternate') {
          const crossField = officer.role === 'director' ? `Dropdown_2_P.${p}` : `Dropdown_1_P.${p}`;
          const pageObj = pages[p - 1];
          for (const dn of [`Dropdown_1_P.${p}`, `Dropdown_2_P.${p}`]) {
            const useDashes = dn === crossField;
            // Select the dropdown option: blank (keep visible) or dashes (crossed out)
            if (useDashes) {
              selectDropdown(dn, '—');
            } else {
              selectDropdown(dn, ' ');
            }
            // Draw a black line through the crossed-out widget for visual certainty
            if (useDashes && pageObj) {
              const rect = getWidgetRect(dn);
              if (rect) {
                const midY = (rect.y0 + rect.y1) / 2;
                pageObj.drawLine({
                  start: { x: rect.x0 + 2, y: midY },
                  end: { x: rect.x1 - 2, y: midY },
                  color: { r: 0, g: 0, b: 0 },
                  thickness: 1,
                });
              }
            }
          }
        }
      } else if (p === 1) {
        // ── P.1 第2項 停任（首名停任人，自然人/法人）──
        // A. 現時在公司註冊處登記的詳情：
        //   自然人: fill_3=代替, fill_4=中文姓名, fill_5=姓氏, fill_6=名字,
        //           fill_7=香港身分證部分號碼(maxlen 5), fill_8=護照部分號碼
        //   法人:   fill_9=中文名稱, fill_10=英文名稱
        // B. 停任詳情：cb_4=辭職／其他, cb_5=去世, fill_11/12/13=停任日期 D/M/Y,
        //    cb_6=是 / cb_7=否（是否仍然擔任——董事/候補董事填，公司秘書免填）
        if (isNatural) {
          if (officer.role === 'alternate' && officer.alternateTo) {
            setText('fill_3_P.1', officer.alternateTo);
          }
          setText('fill_4_P.1', chinese);
          setText('fill_5_P.1', surname);
          setText('fill_6_P.1', other);
          const hkidClean = (officer.idNumber || '').replace(/[()\-\s]/g, '').toUpperCase();
          if (hkidClean) setText('fill_7_P.1', hkidClean.slice(0, 5), 'left');
          if (officer.passportNumber) setText('fill_8_P.1', parsePassportPartial(officer.passportNumber));
        } else {
          setText('fill_9_P.1', officer.nameChinese || '');
          setText('fill_10_P.1', officer.companyName || officer.nameEnglish || '');
        }
        if (officer.role === 'secretary') {
          check('cb_1_P.1', true);
        } else if (officer.role === 'alternate') {
          check('cb_3_P.1', true);
        } else {
          check('cb_2_P.1', true);
        }
        // B. 停任詳情
        const reason1 = officer.cessationReason || 'resignation';
        if (reason1 === 'deceased') {
          check('cb_5_P.1', true);
        } else {
          check('cb_4_P.1', true);
        }
        const dateStr1 = officer.dateCeased || officer.dateAppointed;
        if (dateStr1) {
          const parts = dateStr1.split(/[\/\-]/);
          if (parts.length >= 3) {
            setText('fill_11_P.1', parts[2]); // day
            setText('fill_12_P.1', parts[1]); // month
            setText('fill_13_P.1', parts[0]); // year
          }
        }
        // 是否仍然擔任（公司秘書免填，模板註13）
        if (officer.role !== 'secretary') {
          check(officer.stillHoldsOffice === 'yes' ? 'cb_6_P.1' : 'cb_7_P.1', true);
        }
      } else if (p === 4) {
        // ── P.4 續頁A 停任（第2名停任人）──
        //   自然人: fill_2=代替, fill_3=中文姓名, fill_4=姓氏, fill_5=名字,
        //           fill_6=香港身分證部分號碼(maxlen 5), fill_7=護照部分號碼
        //   法人:   fill_8=中文名稱, fill_9=英文名稱
        //   B.停任詳情：cb_4/cb_5, fill_10/11/12=停任日期 D/M/Y, cb_6/cb_7=是否仍然擔任
        if (isNatural) {
          if (officer.role === 'alternate' && officer.alternateTo) {
            setText('fill_2_P.4', officer.alternateTo);
          }
          setText('fill_3_P.4', chinese);
          setText('fill_4_P.4', surname);
          setText('fill_5_P.4', other);
          const hkidClean = (officer.idNumber || '').replace(/[()\-\s]/g, '').toUpperCase();
          if (hkidClean) setText('fill_6_P.4', hkidClean.slice(0, 5), 'left');
          if (officer.passportNumber) setText('fill_7_P.4', parsePassportPartial(officer.passportNumber));
        } else {
          setText('fill_8_P.4', officer.nameChinese || '');
          setText('fill_9_P.4', officer.companyName || officer.nameEnglish || '');
        }
        if (officer.role === 'secretary') {
          check('cb_1_P.4', true);
        } else if (officer.role === 'alternate') {
          check('cb_3_P.4', true);
        } else {
          check('cb_2_P.4', true);
        }
        const reason4 = officer.cessationReason || 'resignation';
        if (reason4 === 'deceased') {
          check('cb_5_P.4', true);
        } else {
          check('cb_4_P.4', true);
        }
        const dateStr4 = officer.dateCeased || officer.dateAppointed;
        if (dateStr4) {
          const parts = dateStr4.split(/[\/\-]/);
          if (parts.length >= 3) {
            setText('fill_10_P.4', parts[2]);
            setText('fill_11_P.4', parts[1]);
            setText('fill_12_P.4', parts[0]);
          }
        }
        if (officer.role !== 'secretary') {
          check(officer.stillHoldsOffice === 'yes' ? 'cb_6_P.4' : 'cb_7_P.4', true);
        }
      }
    } else {
      // ── 法人團體 (Body Corporate)：P.3 第4項（首名）/ P.6 續頁C（第2名）──
      // ── P.3/P.5 法人團體 ──
      // Field mapping verified by 千问 VL (2026-08-01):
      //   fill_3 = 中文名稱, fill_4 = 英文名稱
      //   fill_5 = Flat/Floor/Block, fill_6 = Building
      //   fill_7 = Street/Estate, fill_8 = District/City
      //   fill_9 = Country/Region, fill_10 = Email
      //   fill_11 = Business Registration Number (牌照) [right col]
      //   fill_12 = TCSP Licence No. [left col]
      //   fill_14/15/16 = Date of Appointment D/M/Y
      setText(`fill_3_P.${p}`, officer.nameChinese || '');
      setText(`fill_4_P.${p}`, officer.companyName || officer.nameEnglish || '');
      // 五欄地址：優先使用結構化地址，fallback 到 flat address
      const addrFlat = officer.addrFlatBlock || '';
      const addrBld = officer.addrBuilding || '';
      const addrSe = officer.addrStreetEstate || '';
      const addrDist = officer.addrDistrict || '';
      const addrReg = officer.addrRegion || '';
      if (addrFlat || addrBld || addrSe || addrDist || addrReg) {
      setText(`fill_5_P.${p}`, addrFlat);
      setText(`fill_6_P.${p}`, addrBld);
      setText(`fill_7_P.${p}`, addrSe);
      setText(`fill_8_P.${p}`, addrDist);
      setText(`fill_9_P.${p}`, addrReg);
      } else {
      // Fallback: parse flat address string
      if (officer.address) setText(`fill_5_P.${p}`, officer.address);
      }
      // Email
      if (officer.email) setText(`fill_10_P.${p}`, officer.email);
      // Business Registration Number (商業登記號碼 = 牌照)
      if (officer.companyNumber) setText(`fill_11_P.${p}`, officer.companyNumber);
      // TCSP Licence No. (fill_12, left column) — only if applicable
      if ((officer as any).tcspLicence) setText(`fill_12_P.${p}`, (officer as any).tcspLicence);
      // Date: fill_14/15/16 = D/M/Y
      const dateStr = officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased;
      if (dateStr) {
      const parts = dateStr.split(/[\/\-]/);
      if (parts.length >= 3) {
        setText(`fill_14_P.${p}`, parts[2]);
        setText(`fill_15_P.${p}`, parts[1]);
        setText(`fill_16_P.${p}`, parts[0]);
      }
      }
      // Role
      if (officer.role === 'secretary') {
      check(`cb_1_P.${p}`, true);
      } else if (officer.role === 'alternate') {
      check(`cb_3_P.${p}`, true);
      } else {
      check(`cb_2_P.${p}`, true);
      }

      // ── P.3/P.6 法人團體簽署（由前端 簽署人/身份/日期 驅動，2026-08-13）──
      // 第一簽署：董事(法人團體)的 董事(Dropdown_3)／公司秘書(Dropdown_4)／獲授權人士(Dropdown_5)*
      //   姓名 = fill_17（P.3 與 P.6 都有此欄位）
      // 第二簽署（僅 P.3）：董事(Dropdown_6)／公司秘書(Dropdown_7)，姓名=fill_22，日期=fill_23（DD/MM/YYYY）
      const capacity = data.signerCapacity || 'director';
      const signerName = data.signerName || '';
      const pageObj2 = pages[p - 1];
      const keepMap1: Record<string, string> = { director: 'Dropdown_3', secretary: 'Dropdown_4', authorizedRep: 'Dropdown_5' };
      const keep1 = keepMap1[capacity] || 'Dropdown_3';
      if (signerName) setText(`fill_17_P.${p}`, signerName);
      // First signature: Dropdown_3/4/5 (keep one per capacity, cross out the rest)
      for (const dn of ['Dropdown_3', 'Dropdown_4', 'Dropdown_5']) {
        const key = `${dn}_P.${p}`;
        const crossOut = dn !== keep1;
        if (crossOut) {
          selectDropdown(key, '—');
        } else {
          selectDropdown(key, ' ');
        }
        if (crossOut && pageObj2) {
          const rect = getWidgetRect(key);
          if (rect) {
            const midY = (rect.y0 + rect.y1) / 2;
            pageObj2.drawLine({
              start: { x: rect.x0 + 2, y: midY },
              end: { x: rect.x1 - 2, y: midY },
              color: { r: 0, g: 0, b: 0 },
              thickness: 1,
            });
          }
        }
      }
      if (p === 3) {
        // Second signature (P.3 only): name + date + 董事/公司秘書（獲授權人士按董事處理）
        const keepMap2: Record<string, string> = { director: 'Dropdown_6', secretary: 'Dropdown_7', authorizedRep: 'Dropdown_6' };
        const keep2 = keepMap2[capacity] || 'Dropdown_6';
        if (signerName) setText('fill_22_P.3', signerName);
        if (data.signDate) {
          const sp = data.signDate.replace(/\//g, '-').split('-');
          if (sp.length >= 3) setText('fill_23_P.3', `${sp[2]}/${sp[1]}/${sp[0]}`);
        }
        for (const dn of ['Dropdown_6', 'Dropdown_7']) {
          const key = `${dn}_P.3`;
          const crossOut = dn !== keep2;
          if (crossOut) {
            selectDropdown(key, '—');
          } else {
            selectDropdown(key, ' ');
          }
          if (crossOut && pageObj2) {
            const rect = getWidgetRect(key);
            if (rect) {
              const midY = (rect.y0 + rect.y1) / 2;
              pageObj2.drawLine({
                start: { x: rect.x0 + 2, y: midY },
                end: { x: rect.x1 - 2, y: midY },
                color: { r: 0, g: 0, b: 0 },
                thickness: 1,
              });
            }
          }
        }
      }
    }  // end P.3/P.6 block
  }

  // ── PI-ND2A 受保護資料頁（P.7）：有自然人時填寫，頁面永不刪除 ──
  // 取第一個自然人（委任或停任皆可）；純法人表格時 P.7 留空但仍保留（2026-08-13）。
  const piSubject = officers.find((o) => o.identity === 'natural');
  if (piSubject) {
    const p = 7;
    const eng = piSubject.nameEnglish || '';
    let surname7 = piSubject.nameSurname || '';
    let other7 = piSubject.nameOtherNames || '';
    if (!surname7 && eng) {
      const parsed = parseEnglishName(eng);
      surname7 = parsed.surname;
      other7 = parsed.otherNames;
    }
    setText(`fill_2_P.${p}`, piSubject.nameChinese || '');
    setText(`fill_3_P.${p}`, surname7);
    setText(`fill_4_P.${p}`, other7);
    // Full HKID — strip brackets (NN1-style): main number + check digit, no parens
    const idFull = piSubject.idNumber || '';
    if (idFull) {
      const cleaned = idFull.replace(/[()\-\s]/g, '');
      if (cleaned.length > 1) {
        setText(`fill_5_P.${p}`, cleaned.slice(0, -1), 'right');
        setText(`fill_6_P.${p}`, cleaned.slice(-1));
      } else {
        setText(`fill_5_P.${p}`, idFull, 'right');
      }
    }
    if (piSubject.passportCountry) setText(`fill_7_P.${p}`, piSubject.passportCountry);
    if (piSubject.passportNumber) setText(`fill_8_P.${p}`, piSubject.passportNumber);
    // Address
    const afb7 = piSubject.addrFlatBlock || '';
    const ab7 = piSubject.addrBuilding || '';
    const ase7 = piSubject.addrStreetEstate || '';
    const ad7 = piSubject.addrDistrict || '';
    const ar7 = piSubject.addrRegion || '';
    if (afb7 || ab7 || ase7 || ad7 || ar7) {
      setText(`fill_9_P.${p}`, afb7);
      setText(`fill_10_P.${p}`, ab7);
      setText(`fill_11_P.${p}`, ase7);
      setText(`fill_12_P.${p}`, ad7);
      setText(`fill_13_P.${p}`, ar7);
    } else {
      setText(`fill_9_P.${p}`, piSubject.address || '');
    }
    const role7 = piSubject.role || 'director';
    if (role7 === 'secretary') check(`cb_1_P.${p}`, true);
    else if (role7 === 'alternate') check(`cb_3_P.${p}`, true);
    else check(`cb_2_P.${p}`, true);
  }

  // P.3 底部續頁計數器（fill_18=續頁A停任, fill_19=續頁B自然人, fill_20=續頁C法人, fill_21=PI頁數）
  // 續頁被刪除時計數器留空；PI 頁永不刪除 → 固定 '1'
  const nCessC = officers.filter((o) => o.type === 'cessation').length;
  const nNatC = officers.filter((o) => o.identity === 'natural' && o.type !== 'cessation').length;
  const nCorpC = officers.filter((o) => o.identity === 'corporate' && o.type !== 'cessation').length;
  if (nCessC >= 2) setText('fill_18_P.3', '1');
  if (nNatC >= 2) setText('fill_19_P.3', '1');
  if (nCorpC >= 2) setText('fill_20_P.3', '1');
  setText('fill_21_P.3', '1');

  // ===== P.1: Signer & presenter info =====
  // Note: P.1 fill_9 is NOT used for signer name in ND2A template
  // (ND2A has no separate P.1 signer name field — signer is on P.2)

  // ── P.1 提交人信息（字段映射對齊 Flask _fill_nd2a_pdf）──
  // fill_14 = 提交人名稱, fill_15 = 提交人地址
  const pName = data.presentorName || DEFAULT_PRESENTER.name;
  const pAddr = data.presentorAddress || DEFAULT_PRESENTER.address;
  // 取得個別聯絡欄位，若不存在則從 presentorContact 字串提取或使用 DEFAULT_PRESENTER
  const pPhone = data.presentorPhone || DEFAULT_PRESENTER.phone;
  const pFax = data.presentorFax || DEFAULT_PRESENTER.fax;
  const pEmail = data.presentorEmail || DEFAULT_PRESENTER.email;
  const pRef = data.presentorReference || DEFAULT_PRESENTER.reference;

  setText("fill_14_P.1", pName);
  setText("fill_15_P.1", pAddr);
  // fill_16-19 = 電話 / 傳真 / 電郵 / 檔號（10pt → 缩小字号防溢出）
  setText("fill_16_P.1", pPhone);
  setText("fill_17_P.1", pFax);
  setText("fill_18_P.1", pEmail);
  setText("fill_19_P.1", pRef);

  rebuildAcroFormFields(pdfDoc);
}

// ============================================================================
// Debug mode
// ============================================================================

async function fillDebug(pdfDoc: PDFDocument) {
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const nameCounter = new Map<string, number>();

  for (const page of pdfDoc.getPages()) {
    const annotsArr = page.node.lookup(PDFName.of("Annots")) as any;
    if (!annotsArr || typeof annotsArr.size !== "function") continue;

    for (let i = 0; i < annotsArr.size(); i++) {
      try {
        const widget = pdfDoc.context.lookup(annotsArr.get(i)) as any;
        if (!widget) continue;
        const subtype = widget.lookup?.(PDFName.of("Subtype"));
        if (!subtype || subtype.toString() !== "/Widget") continue;

        let fieldName: string | null = null;
        let cur: any = widget;
        while (cur && !fieldName) {
          const t = cur.lookup?.(PDFName.of("T"));
          if (t) {
            try { fieldName = t.decodeText(); }
            catch { fieldName = t.toString().replace(/^\(|\)$/g, ""); }
          }
          cur = cur.lookup?.(PDFName.of("Parent"));
        }
        if (!fieldName) fieldName = "(unnamed)";

        const cnt = (nameCounter.get(fieldName) || 0) + 1;
        nameCounter.set(fieldName, cnt);

        const rectObj = widget.lookup?.(PDFName.of("Rect")) as any;
        if (!rectObj) continue;
        const x1 = rectObj[0];
        const y1 = rectObj[1];
        const x2 = rectObj[2];
        const y2 = rectObj[3];

        page.drawText(`${fieldName}#${cnt}`, {
          x: x1 + 1,
          y: y2 - 6,
          size: 5,
          font: helv,
          color: { r: 1, g: 0, b: 0 },
        });
      } catch (_) { /* skip */ }
    }
  }
  try { pdfDoc.getForm().flatten(); } catch (_) { /* ignore */ }
}

// ============================================================================
// Request handler
// ============================================================================

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data: ND2AData = await request.json();
    console.log("Generating ND2A PDF for:", data.companyName);

    const templateObj = await env.PDF_TEMPLATES.get("ND2A-template.pdf");
    if (!templateObj) throw new Error("Failed to load ND2A template");

    const templateBytes = await templateObj.arrayBuffer();
    const pdfDoc = await PDFDocument.load(templateBytes);

    if (data.debug) {
      await fillDebug(pdfDoc);
    } else {
      fillND2A(pdfDoc, data);
    }

    // Delete blank pages after P.7 (keep P.1~P.7, P.8+ are blank instruction pages)
    const allPages = pdfDoc.getPages();
    if (allPages.length > 7) {
      for (let i = allPages.length - 1; i >= 7; i--) {
        pdfDoc.removePage(i);
      }
    }
    // 續頁無內容則刪除（降序）：P.6 續頁C=法人委任#2, P.5 續頁B=自然人委任#2, P.4 續頁A=停任#2
    // PI 受保護資料頁（P.7）永不刪除（2026-08-13）
    const officersH = data.officers || [];
    const nCess = officersH.filter((o) => o.type === 'cessation').length;
    const nNat = officersH.filter((o) => o.identity === 'natural' && o.type !== 'cessation').length;
    const nCorp = officersH.filter((o) => o.identity === 'corporate' && o.type !== 'cessation').length;
    if (nCorp < 2) pdfDoc.removePage(5);
    if (nNat < 2) pdfDoc.removePage(4);
    if (nCess < 2) pdfDoc.removePage(3);

    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    const base64 = uint8ToBase64(new Uint8Array(pdfBytes));

    return new Response(JSON.stringify({ pdf: base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("ND2A generation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
