import { PDFDocument, PDFName, PDFHexString, PDFString, PDFBool, StandardFonts } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  isAscii, decodePdfText,
  collectFormFields, detachWidget, rebuildAcroFormFields,
  enableNeedAppearances, buildCjkDA, buildHelvDA,
  parsePassportPartial
} from './_acroform';
import { corsHeaders, jsonResp, uint8ToBase64 } from './_pdf-utils';

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
  presentorContact: string;
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

  return { setText, check };
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
  const { setText, check } = createFormHelpers(pdfDoc);

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
  const officers = data.officers;
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
        setText(`fill_8_P.${p}`, officer.address);
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
      // ── Corporate officer ──
      setText(`fill_3_P.${p}`, officer.companyName || officer.nameEnglish || '');
      setText(`fill_5_P.${p}`, officer.companyNumber || '');
      setText(`fill_6_P.${p}`, officer.placeIncorporated || '');
      setText(`fill_7_P.${p}`, officer.address || '');
      // Date
      const dateStr = officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased;
      if (dateStr) {
        const parts = dateStr.split(/[\/\-]/);
        if (parts.length >= 3) {
          setText(`fill_9_P.${p}`, parts[2]);
          setText(`fill_10_P.${p}`, parts[1]);
          setText(`fill_11_P.${p}`, parts[0]);
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
    }
  }

  // ===== P.1: Signer & presenter info =====
  // Signer date (fill_11/12/13 = D/M/Y)
  if (data.signDate) {
    const parts = data.signDate.split(/[\/\-]/);
    if (parts.length >= 3) {
      setText("fill_11_P.1", parts[0]);
      setText("fill_12_P.1", parts[1]);
      setText("fill_13_P.1", parts[2]);
    }
  }
  // Signer name
  setText("fill_9_P.1", data.signerName);
  // Presenter name
  setText("fill_10_P.1", data.presentorName);
  // Presenter contact & address
  setText("fill_14_P.1", data.presentorContact);
  setText("fill_15_P.1", data.presentorAddress);

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
