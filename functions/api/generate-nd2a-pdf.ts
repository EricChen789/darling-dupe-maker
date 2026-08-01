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

  // ===== Officer routing (matching local server.py) =====
  // Natural appointment → P.2, P.6, P.7  (detailed pages)
  // Natural cessation   → P.4              (cessation page)
  // Corporate           → P.3, P.5, P.7     (corporate pages)
  const officers = data.officers || [];
  let natApptIdx = 0;
  let natCessIdx = 0;
  let corpIdx = 0;

  for (let i = 0; i < Math.min(officers.length, 6); i++) {
    const officer = officers[i];
    const isNatural = officer.identity === 'natural';
    const isCessation = officer.type === 'cessation';
    let page: number;

    if (isNatural) {
      if (isCessation) {
        page = 4;
        natCessIdx++;
      } else {
        page = [2, 6, 7][natApptIdx] || 7;
        natApptIdx++;
      }
    } else {
      page = corpIdx * 2 + 3; // 3, 5, 7
      corpIdx++;
    }
    const p = page;

    if (isNatural) {
      // Parse English name
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
      if (p === 2) {
        // P.2: Natural person appointment — detailed info
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
          const crossField = officer.role === 'director' ? 'Dropdown_2_P.2' : 'Dropdown_1_P.2';
          const pageObj = pages[p - 1];
          for (const dn of ['Dropdown_1_P.2', 'Dropdown_2_P.2']) {
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
      } else if (p === 4) {
        // P.4: Natural person cessation
        setText(`fill_3_P.${p}`, chinese);
        setText(`fill_4_P.${p}`, surname);
        setText(`fill_5_P.${p}`, other);
        if (officer.idNumber) setText(`fill_6_P.${p}`, officer.idNumber, 'right');
        if (officer.passportNumber) setText(`fill_7_P.${p}`, officer.passportNumber);
        // Address: two tall fields
        const addrParts = [officer.addrFlatBlock, officer.addrBuilding, officer.addrStreetEstate, officer.addrDistrict, officer.addrRegion].filter(Boolean);
        if (addrParts.length > 0) {
          setText(`fill_8_P.${p}`, addrParts.slice(0, 3).join(', '));
          setText(`fill_9_P.${p}`, addrParts.slice(3).join(', '));
        } else {
          setText(`fill_8_P.${p}`, officer.address);
        }
        // Date: fill_10/11/12 = D/M/Y
        const dateStr = officer.dateCeased || officer.dateAppointed;
        if (dateStr) {
          const parts = dateStr.split(/[\/\-]/);
          if (parts.length >= 3) {
            setText(`fill_10_P.${p}`, parts[2]);
            setText(`fill_11_P.${p}`, parts[1]);
            setText(`fill_12_P.${p}`, parts[0]);
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
        check(`cb_4_P.${p}`, true); // cessation marker
      } else if (p === 6) {
        // P.6 (PI-ND2A continuation) — different layout from P.2
        if (officer.role === 'alternate' && officer.alternateTo) {
          setText(`fill_2_P.${p}`, officer.alternateTo);
        }
        setText(`fill_3_P.${p}`, chinese);
        setText(`fill_4_P.${p}`, surname);
        setText(`fill_5_P.${p}`, other);
        // fill_8 = 住址 (structured address), fill_9 = 國家／地區 (passport issuing country), fill_10 = 通訊地址
        const addrP6 = [officer.addrFlatBlock, officer.addrBuilding, officer.addrStreetEstate, officer.addrDistrict, officer.addrRegion].filter(Boolean);
        setText(`fill_8_P.${p}`, addrP6.length > 0 ? addrP6.join(', ') : (officer.address || ''));
        if (officer.passportCountry) setText(`fill_9_P.${p}`, officer.passportCountry);
        // ID number (full, not truncated)
        if (officer.idNumber) {
          if (officer.passportNumber) {
            setText(`fill_11_P.${p}`, `${officer.idNumber} / ${officer.passportNumber}`, 'right');
          } else {
            setText(`fill_11_P.${p}`, officer.idNumber, 'right');
          }
        } else if (officer.passportNumber) {
          setText(`fill_11_P.${p}`, officer.passportNumber, 'right');
        }
        // Dates: fill_14/15/16 = D/M/Y
        const dateStr = officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased;
        if (dateStr) {
          const parts = dateStr.split(/[\/\-]/);
          if (parts.length >= 3) {
            setText(`fill_14_P.${p}`, parts[2]);
            setText(`fill_15_P.${p}`, parts[1]);
            setText(`fill_16_P.${p}`, parts[0]);
          }
        }
        // Role checkboxes
        if (officer.role === 'secretary') {
          check(`cb_1_P.${p}`, true);
        } else if (officer.role === 'alternate') {
          check(`cb_3_P.${p}`, true);
        } else {
          check(`cb_2_P.${p}`, true);
        }
        if (officer.type === 'cessation') {
          check(`cb_4_P.${p}`, true);
        }
      } else if (p === 7) {
        // ── P.7 (PI-ND2A) Protected Data Page ──
        // This page shows FULL HKID and passport (not truncated).
        // Layout: fill_2=中文姓名, fill_3=英文姓氏, fill_4=英文名字
        //         fill_5=HKID完整號碼, fill_6=括號校驗位
        //         fill_7=護照簽發國, fill_8=護照完整號碼
        //         fill_9~13=地址五欄
        setText(`fill_2_P.${p}`, chinese);
        setText(`fill_3_P.${p}`, surname);
        setText(`fill_4_P.${p}`, other);
        // Full HKID with checksum
        const idFull = officer.idNumber || '';
        if (idFull) {
          const hkidMatch = idFull.trim().match(/^([A-Za-z]?\d+)\s*(\([^)]*\))?$/);
          if (hkidMatch) {
            setText(`fill_5_P.${p}`, hkidMatch[1], 'right');
            if (hkidMatch[2]) setText(`fill_6_P.${p}`, hkidMatch[2]);
          } else {
            setText(`fill_5_P.${p}`, idFull, 'right');
          }
        }
        // Full passport (not truncated)
        if (officer.passportCountry) setText(`fill_7_P.${p}`, officer.passportCountry);
        if (officer.passportNumber) setText(`fill_8_P.${p}`, officer.passportNumber);
        // Structured address
        const afb7 = officer.addrFlatBlock || '';
        const ab7 = officer.addrBuilding || '';
        const ase7 = officer.addrStreetEstate || '';
        const ad7 = officer.addrDistrict || '';
        const ar7 = officer.addrRegion || '';
        if (afb7 || ab7 || ase7 || ad7 || ar7) {
          setText(`fill_9_P.${p}`, afb7);
          setText(`fill_10_P.${p}`, ab7);
          setText(`fill_11_P.${p}`, ase7);
          setText(`fill_12_P.${p}`, ad7);
          setText(`fill_13_P.${p}`, ar7);
        } else {
          setText(`fill_9_P.${p}`, officer.address);
        }
        // Role checkboxes
        if (officer.role === 'secretary') {
          check(`cb_1_P.${p}`, true);
        } else if (officer.role === 'alternate') {
          check(`cb_3_P.${p}`, true);
        } else {
          check(`cb_2_P.${p}`, true);
        }
        // Note: P.7 has NO date fields, NO cessation checkbox, NO dropdown cross-out
      }
    } else {
      // ── Corporate officer (P.3/P.5/P.7 法人團體) ──
      // P.7 (PI-ND2A) layout is COMPLETELY different from P.3/P.5
      if (p === 7) {
        // ── P.7 (PI-ND2A) 法人團體 ──
        // PI-ND2A 是為自然人設計的頁面。法人團體無 HKID / 護照，
        // 只填姓名 + 地址 + 角色，fill_5/6/7/8（HKID/護照）留空。
        setText(`fill_2_P.7`, officer.nameChinese || '');
        const engFull = officer.companyName || officer.nameEnglish || '';
        const engParts = engFull.trim().split(/\s+/);
        if (engParts.length > 1) {
          setText(`fill_3_P.7`, engParts[0]);
          setText(`fill_4_P.7`, engParts.slice(1).join(' '));
        } else {
          setText(`fill_3_P.7`, engFull);
        }
        // 法人無 HKID / 護照 → fill_5/6/7/8 全部留空
        // Address
        const afb7 = officer.addrFlatBlock || '';
        const ab7 = officer.addrBuilding || '';
        const ase7 = officer.addrStreetEstate || '';
        const ad7 = officer.addrDistrict || '';
        const ar7 = officer.addrRegion || '';
        if (afb7 || ab7 || ase7 || ad7 || ar7) {
          setText(`fill_9_P.7`, afb7);
          setText(`fill_10_P.7`, ab7);
          setText(`fill_11_P.7`, ase7);
          setText(`fill_12_P.7`, ad7);
          setText(`fill_13_P.7`, ar7);
        } else {
          setText(`fill_9_P.7`, officer.address || '');
        }
        // Role
        if (officer.role === 'secretary') {
          check(`cb_1_P.7`, true);
        } else if (officer.role === 'alternate') {
          check(`cb_3_P.7`, true);
        } else {
          check(`cb_2_P.7`, true);
        }
      } else {
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
      if (officer.type === 'cessation') {
        check(`cb_4_P.${p}`, true);
      }

      // ── P.3/P.5 法人團體簽署橫線 ──
      // 第一簽署：董事(法人團體)的 董事／公司秘書／獲授權人士*
      //   Dropdown_3=董事(KEEP), Dropdown_4=公司秘書(CROSS), Dropdown_5=獲授權人士(CROSS)
      // 第二簽署：董事Director／公司秘書Company Secretary*
      //   Dropdown_6=董事(KEEP), Dropdown_7=公司秘書(CROSS)
      const pageObj2 = pages[p - 1];
      // First signature: Dropdown_3/4/5
      for (const dn of ['Dropdown_3', 'Dropdown_4', 'Dropdown_5']) {
        const key = `${dn}_P.${p}`;
        const crossOut = dn === 'Dropdown_4' || dn === 'Dropdown_5';
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
      // Second signature: Dropdown_6/7
      for (const dn of ['Dropdown_6', 'Dropdown_7']) {
        const key = `${dn}_P.${p}`;
        const crossOut = dn === 'Dropdown_7';
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
      }  // end P.3/P.5 block
    }
  }

  // ── PI-ND2A 受保護資料頁（P.7）：始終填入第一個人的完整資料 ──
  // 優先取第一個自然人（完整 HKID + 護照），若無自然人則取第一個法人（BR + 成立地）。
  const firstNat = officers.find(o => o.identity === 'natural');
  const firstCorp = officers.find(o => o.identity === 'corporate');
  const piSubject = firstNat || firstCorp;
  if (piSubject) {
    const p = 7;
    const isNat = piSubject.identity === 'natural';
    if (isNat) {
      // ── 自然人 PI-ND2A：完整 HKID + 護照 ──
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
      // Full HKID + checksum digit
      const idFull = piSubject.idNumber || '';
      if (idFull) {
        const hkidMatch = idFull.trim().match(/^([A-Za-z]?\d+)\s*(\([^)]*\))?$/);
        if (hkidMatch) {
          setText(`fill_5_P.${p}`, hkidMatch[1], 'right');
          if (hkidMatch[2]) setText(`fill_6_P.${p}`, hkidMatch[2]);
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
    } else {
      // ── 法人團體 PI-ND2A：只填姓名+地址+角色，不填HKID/護照（公司沒有）──
      setText(`fill_2_P.7`, piSubject.nameChinese || '');
      const corpName = piSubject.companyName || piSubject.nameEnglish || '';
      const nameParts = corpName.trim().split(/\s+/);
      if (nameParts.length > 1) {
        setText(`fill_3_P.7`, nameParts[0]);
        setText(`fill_4_P.7`, nameParts.slice(1).join(' '));
      } else {
        setText(`fill_3_P.7`, corpName);
      }
      // 法人無 HKID / 護照 → fill_5/6/7/8 全部留空
      const afb7 = piSubject.addrFlatBlock || '';
      const ab7 = piSubject.addrBuilding || '';
      const ase7 = piSubject.addrStreetEstate || '';
      const ad7 = piSubject.addrDistrict || '';
      const ar7 = piSubject.addrRegion || '';
      if (afb7 || ab7 || ase7 || ad7 || ar7) {
        setText(`fill_9_P.7`, afb7);
        setText(`fill_10_P.7`, ab7);
        setText(`fill_11_P.7`, ase7);
        setText(`fill_12_P.7`, ad7);
        setText(`fill_13_P.7`, ar7);
      } else {
        setText(`fill_9_P.7`, piSubject.address || '');
      }
      const role7 = piSubject.role || 'director';
      if (role7 === 'secretary') check(`cb_1_P.7`, true);
      else if (role7 === 'alternate') check(`cb_3_P.7`, true);
      else check(`cb_2_P.7`, true);
    }
  }

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
