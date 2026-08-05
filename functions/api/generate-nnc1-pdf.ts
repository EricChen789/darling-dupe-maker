// POST /api/generate-nnc1-pdf
// NNC1 法團成立表格（股份有限公司）— 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
// 支援多自然人 → 自動複製 PI-NNC1 頁面（每頁一人）
//   Strategy: Manual AP stream generation referencing template fonts (/PMingLiU, /Helv)
//     - No fontkit → stays under Workers CPU limit
//     - Real AP streams on widgets → no NeedAppearances dependency
//     - Widget-level control → no field-name sharing issues across copied pages

import {
  PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString,
  PDFArray, PDFNumber, PDFOperator,
} from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64 } from "./_pdf-utils";
import { enableNeedAppearances } from "./_acroform";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC1-template.pdf";

// ═══ PI-NNC1 (P.14) — 受保護資料頁 ═══
// Manual AP stream approach:
//   For each widget on each PI-NNC1 page, generate a real AP Form XObject stream
//   referencing the template's built-in /PMingLiU (CJK) or /Helv (ASCII) font.
//   No fontkit, no custom font embedding — stays under Workers CPU limit.
//   Widget-level values → each copied page is independent (no field sharing).

// PI-NNC1 field definitions
interface PiField {
  suffix: string;    // widget suffix e.g. "fill_2"
  key: string;       // person data key
  isCjk: boolean;
}

const PI_FIELDS: PiField[] = [
  { suffix: 'fill_2',  key: 'nameChinese',     isCjk: true  },
  { suffix: 'fill_3',  key: 'surname',         isCjk: false },
  { suffix: 'fill_4',  key: 'otherNames',      isCjk: false },
  { suffix: 'fill_5',  key: 'hkidMain',        isCjk: false },
  { suffix: 'fill_6',  key: 'hkidCheck',       isCjk: false },
  { suffix: 'fill_7',  key: 'passportCountry', isCjk: true  },
  { suffix: 'fill_8',  key: 'passportNumber',  isCjk: false },
  { suffix: 'fill_9',  key: 'addrFlat',        isCjk: true  },
  { suffix: 'fill_10', key: 'addrBuilding',    isCjk: true  },
  { suffix: 'fill_11', key: 'addrStreet',      isCjk: true  },
  { suffix: 'fill_12', key: 'addrDistrict',    isCjk: true  },
  { suffix: 'fill_13', key: 'addrRegion',      isCjk: true  },
];

/** Convert string to UTF-16BE hex (with BOM) for PDF hex string encoding. */
function toUtf16BEHex(value: string): string {
  let hex = 'FEFF'; // BOM
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Handle surrogate pairs for characters outside BMP
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
      const hi = code;
      const lo = value.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        const cp = 0x10000 + (hi - 0xD800) * 0x400 + (lo - 0xDC00);
        hex += (cp >> 24).toString(16).padStart(2, '0').toUpperCase();
        hex += ((cp >> 16) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        hex += ((cp >> 8) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        hex += (cp & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        i++; // skip low surrogate
        continue;
      }
    }
    hex += (code >> 8).toString(16).padStart(2, '0').toUpperCase();
    hex += (code & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  }
  return hex;
}

/** Escape special characters in a PDF literal string. */
function escapePdfString(value: string): string {
  return value.replace(/([()\\])/g, '\\$1');
}

/** Generate and set a widget-level AP stream (Form XObject) + /V + /DA.
 *  References template's built-in /PMingLiU (CJK) or /Helv (ASCII) font.
 *  No fontkit needed — stays under Workers CPU limit. */
function setWidgetAp(
  pdfDoc: PDFDocument,
  widget: any,
  value: string,
  isCjk: boolean,
): void {
  const fontPsName = isCjk ? "PMingLiU" : "Helv";
  const fontSize = 10;
  const context = (pdfDoc as any).context;

  // Build text operation
  let textOp: string;
  if (isCjk) {
    const hex = toUtf16BEHex(value);
    textOp = `<${hex}> Tj`;
  } else {
    const escaped = escapePdfString(value);
    textOp = `(${escaped}) Tj`;
  }

  // AP stream content — simple text drawing
  const apContent = `/${fontPsName} ${fontSize} Tf\n0 g\nBT\n2 2 Td\n${textOp}\nET`;
  const apBytes = new TextEncoder().encode(apContent);

  // Create Form XObject BBox [0, 0, 1000, 1000] — large, PDF reader maps to widget rect
  const bbox = PDFArray.withContext(context);
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(1000));
  bbox.push(PDFNumber.of(1000));

  const dict = context.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  dict.set(PDFName.of('BBox'), bbox);

  // Create AP stream and register
  const apStream = context.stream(apBytes, dict);
  const apRef = context.register(apStream);

  // Create AP dictionary: << /N apRef >>
  const apDict = context.obj({});
  apDict.set(PDFName.of('N'), apRef);

  // Set on widget
  widget.set(PDFName.of('AP'), apDict);

  // Set /V — widget-level value (overrides field /V for this widget only)
  if (isCjk) {
    widget.set(PDFName.of('V'), PDFHexString.fromText(value));
  } else {
    widget.set(PDFName.of('V'), PDFString.of(value));
  }

  // Set /DA — default appearance string (fallback if AP is missing)
  widget.set(PDFName.of('DA'), PDFString.of(`/${fontPsName} ${fontSize} Tf 0 g`));
}

/** Inject raw text drawing operators into a page's content stream.
 *  Used to draw checkmark indicators (✓) at checkbox positions
 *  for Person 1+ pages where field sharing prevents per-page checkbox state. */
function injectPageText(
  pdfDoc: PDFDocument,
  pageIndex: number,
  text: string,
  x: number,
  y: number,
  size: number,
  isCjk: boolean,
): void {
  const context = (pdfDoc as any).context;
  const pages = pdfDoc.getPages();
  const page = pages[pageIndex];
  if (!page) return;

  const fontPsName = isCjk ? "PMingLiU" : "Helv";

  let textOp: string;
  if (isCjk) {
    const hex = toUtf16BEHex(text);
    textOp = `<${hex}> Tj`;
  } else {
    const escaped = escapePdfString(text);
    textOp = `(${escaped}) Tj`;
  }

  const contentStr = `BT /${fontPsName} ${size} Tf 0 g ${x} ${y} Td ${textOp} ET`;
  const contentBytes = new TextEncoder().encode(contentStr);

  // Create stream and add to page contents
  const dict = context.obj({});
  const stream = context.stream(contentBytes, dict);
  const ref = context.register(stream);

  const contentsArr = page.node.Contents();
  if (contentsArr && typeof contentsArr.push === "function") {
    contentsArr.push(ref);
  }
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      fields?: Record<string, unknown>;
      checkboxes?: string[];
      brNumber?: string;
      removePages?: number[];
      piPersons?: Array<{
        nameChinese: string;
        surname: string;
        otherNames: string;
        hkidMain: string;
        hkidCheck: string;
        isHkid: boolean;
        passportCountry: string;
        passportNumber: string;
        addrFlat: string;
        addrBuilding: string;
        addrStreet: string;
        addrDistrict: string;
        addrRegion: string;
        isSecretary: boolean;
      }>;
    };

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) {
      return jsonResp({ error: "R2 bucket not available" }, 500);
    }

    // ── Load template ──
    const templateObj = await r2Bucket.get(TEMPLATE_NAME);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

    const form = pdfDoc.getForm();

    // ── BR stamp on all pages ──
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const brNumber = data.brNumber || "";
    if (brNumber) {
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
      }
    }

    // ── Fill text fields (skip P.14 — handled via manual AP below) ──
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      if (name.endsWith('_P.14')) continue;
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;
        form.getTextField(name).setText(vstr);
      } catch { /* field missing — skip */ }
    }

    // ── Check checkboxes (skip P.14 — handled below) ──
    for (const name of data.checkboxes || []) {
      if (name.endsWith('_P.14')) continue;
      try {
        form.getCheckBox(name).check();
      } catch { /* skip */ }
    }

    // ═══ PI-NNC1 (P.14): Manual AP stream for ALL persons ═══
    // No fontkit, no form API on P.14 fields — each page gets independent widget AP
    const piPersons = data.piPersons || [];
    const PI_PAGE_IDX = 13; // P.14 (0-indexed)

    if (piPersons.length > 0) {
      const companyName = (data.fields as any)?.['fill_1_P.1'] || '';

      // 1) Copy extra P.14 pages first (while form fields are untouched)
      if (piPersons.length > 1) {
        for (let i = 1; i < piPersons.length; i++) {
          const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [PI_PAGE_IDX]);
          pdfDoc.insertPage(PI_PAGE_IDX + i, copiedPage);
        }
        // Adjust removePages indices for inserted pages (only pages AFTER PI_PAGE_IDX shift)
        if (data.removePages) {
          const shift = piPersons.length - 1;
          data.removePages = data.removePages.map((p: number) =>
            p > PI_PAGE_IDX ? p + shift : p
          );
        }
      }

      // 2) For each person, set widget AP on their PI-NNC1 page
      for (let pi = 0; pi < piPersons.length; pi++) {
        const pageIdx = PI_PAGE_IDX + pi;
        const person = piPersons[pi];
        const pages = pdfDoc.getPages();
        const page = pages[pageIdx];
        if (!page) continue;

        // Collect all widget annotations on this page
        const annots = page.node.lookup(PDFName.of("Annots")) as any;
        if (!annots || typeof annots.size !== "function") continue;

        for (let j = 0; j < annots.size(); j++) {
          try {
            const widget = (pdfDoc as any).context.lookup(annots.get(j)) as any;
            if (!widget || typeof widget.get !== "function") continue;
            const subtype = widget.get(PDFName.of("Subtype"));
            if (!subtype || String(subtype) !== "/Widget") continue;

            // Get widget/field name
            const parentRef = widget.get(PDFName.of("Parent"));
            const field = parentRef ? ((pdfDoc as any).context.lookup(parentRef) as any) : widget;

            // Extract parent field name (fT = meaningful, wT = just page number like "14")
            const fT = field.get(PDFName.of("T"));
            let name = "";
            try {
              if (fT instanceof PDFString) name = fT.decodeText();
            } catch { /* skip */ }
            if (!name) continue;

            // Strip _P suffix to get base field name: "fill_2_P" → "fill_2", "cb_1_P" → "cb_1"
            const suffix = name.replace(/_P$/, "");

            // Determine field type by name prefix (FT lookup via pdf-lib returns null
            // on this template's P.14 fields — the FT is stored in parent field-tree nodes).
            // fill_* = text field, cb_* = checkbox.
            if (name.startsWith('fill_')) {
              // ── Text field ──
              if (suffix === "fill_1") {
                // Company name — same for all persons
                setWidgetAp(pdfDoc, widget, companyName, /*isCjk*/ true);
              } else {
                const mapping = PI_FIELDS.find(f => f.suffix === suffix);
                if (!mapping) continue;
                // HKID fields (fill_5, fill_6) — only fill if person has HKID
                if ((suffix === 'fill_5' || suffix === 'fill_6') && !person.isHkid) continue;
                // Passport fields (fill_7, fill_8) — only fill if person does NOT have HKID
                if ((suffix === 'fill_7' || suffix === 'fill_8') && person.isHkid) continue;
                const val = String(person[mapping.key] ?? "").trim();
                if (!val) continue;
                setWidgetAp(pdfDoc, widget, val, mapping.isCjk);
              }
            } else if (name.startsWith('cb_')) {
              // ── Checkbox ──
              // Set widget-level /V + /AS. Widget annotations on different
              // pages can have independent /V values that override the shared
              // field /V. /AS alone is not enough — PDF readers need /V.
              // Default both checkboxes to Off on every page.
              widget.set(PDFName.of("V"), PDFName.of("Off"));
              widget.set(PDFName.of("AS"), PDFName.of("Off"));

              // For this person, set the correct checkbox to On
              if ((suffix === "cb_1" && person.isSecretary) ||
                  (suffix === "cb_2" && !person.isSecretary)) {
                // Discover On state name from existing AP
                let onState = "On";
                try {
                  const ap = widget.get(PDFName.of("AP")) as any;
                  const apN = ap?.get?.(PDFName.of("N")) as any;
                  if (apN && typeof apN.entries === "function") {
                    for (const [k] of apN.entries()) {
                      const kStr = String(k);
                      if (kStr !== "/Off") {
                        onState = kStr.startsWith("/") ? kStr.slice(1) : kStr;
                        break;
                      }
                    }
                  }
                } catch { /* use default "On" */ }
                widget.set(PDFName.of("V"), PDFName.of(onState));
                widget.set(PDFName.of("AS"), PDFName.of(onState));
              }
            }
          } catch { /* skip malformed widget */ }
        }

        // 3) Widget /V + /AS is set above for all persons. As a backup for
        //    Person 1+ pages (where shared fields may override widget /V),
        //    also inject ✓ into the page content stream.
        if (pi > 0) {
          if (person.isSecretary) {
            injectPageText(pdfDoc, pageIdx, '✓', 209, 478, 10, /*isCjk*/ true);
          } else {
            injectPageText(pdfDoc, pageIdx, '✓', 316, 478, 10, /*isCjk*/ true);
          }
        }
      }

      // 4) P.8 續頁計數器 — fill_6 = total PI-NNC1 person count (matching Flask)
      try {
        form.getTextField('fill_6_P.8').setText(String(piPersons.length));
      } catch { /* skip */ }
    }

    // ── Remove pages (0-indexed, descending order) ──
    const removePages = data.removePages || [];
    if (removePages.length > 0) {
      const sorted = [...removePages].sort((a, b) => b - a);
      for (const idx of sorted) {
        if (idx >= 0 && idx < pdfDoc.getPageCount()) {
          pdfDoc.removePage(idx);
        }
      }
    }

    // ── Save ──
    // updateFieldAppearances:false — P.14 widgets have manual AP, non-P.14 have form API AP.
    // enableNeedAppearances as safety net for any field without AP.
    enableNeedAppearances(pdfDoc);
    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc1-pdf error:", err?.message || err);
    return jsonResp({ error: err?.message || String(err) || "Internal server error" }, 500);
  }
}
