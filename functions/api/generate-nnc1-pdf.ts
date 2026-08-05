// POST /api/generate-nnc1-pdf
// NNC1 法團成立表格（股份有限公司）— 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
// 支援多自然人 → 自動複製 PI-NNC1 頁面（每頁一人）
//   Strategy: detachWidget + generate AP using page's internal font names
//     - Widgets detached from shared parent → independent per page
//     - AP streams reference /C2_1 (PMingLiU) and /Helv (Helvetica) — NO Resources dict
//       so font resolution inherits from page Resources → works on copied pages too
//     - No fontkit, no manual font embedding → stays under Workers CPU limit

import {
  PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString,
  PDFArray, PDFNumber, rgb,
} from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64, hasCjk } from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";
import {
  enableNeedAppearances,
  rebuildAcroFormFields,
  detachWidget,
  decodePdfText,
  buildCjkDA,
  buildHelvDA,
} from "./_acroform";

const TEMPLATE_NAME = "NNC1-template.pdf";

// PI-NNC1 field definitions
interface PiField {
  suffix: string;    // parent /T suffix e.g. "fill_2"
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

    // ── Fill text fields (skip P.14 — handled via widget-level below) ──
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

    // ═══ PI-NNC1 (P.14): Page-content injection (bypasses widgets entirely) ═══
    // v10 Approach: Widgets on copied pages share PDF objects → impossible to
    //    reliably set different values per page via widgets. Solution:
    //    1) Pre-scan original P.14 widget rects to know field positions & types
    //    2) Same-document copy P.14 for additional persons
    //    3) Remove ALL widget annotations from every PI-NNC1 page
    //    4) Draw text directly on page content streams:
    //       - ASCII: page.drawText() with embedded Helvetica
    //       - CJK: inject raw content operators referencing /C2_1 (PMingLiU)
    //       - Checkboxes: draw rectangle + checkmark manually
    //    No fontkit needed. Works within Workers CPU budget.

    /** Encode a string as UTF-16BE hex with BOM (for CJK content streams). */
    const encodeUtf16Hex = (value: string): string => {
      let hex = 'FEFF';
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
          const lo = value.charCodeAt(i + 1);
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            const cp = 0x10000 + (code - 0xD800) * 0x400 + (lo - 0xDC00);
            hex += cp.toString(16).padStart(8, '0').toUpperCase();
            i++;
            continue;
          }
        }
        hex += (code >> 8).toString(16).padStart(2, '0').toUpperCase();
        hex += (code & 0xFF).toString(16).padStart(2, '0').toUpperCase();
      }
      return hex;
    };

    /** Inject a raw content stream onto a page (for CJK text using /C2_1 font). */
    const injectCjkText = (
      ctx: any, page: any,
      text: string, x: number, y: number, fontSize: number,
    ): void => {
      const hex = encodeUtf16Hex(text);
      const content = `q\n/C2_1 ${fontSize} Tf\n0 g\nBT\n${x} ${y} Td\n<${hex}> Tj\nET\nQ`;
      const stream = ctx.stream(new TextEncoder().encode(content), ctx.obj({}));
      const ref = ctx.register(stream);

      const contents = page.node.Contents();
      if (!contents) {
        page.node.set(PDFName.of('Contents'), ref);
      } else if (typeof contents.push === 'function') {
        // PDFArray: append
        contents.push(ref);
      } else {
        // Single stream: wrap in array
        const arr = PDFArray.withContext(ctx);
        arr.push(contents);
        arr.push(ref);
        page.node.set(PDFName.of('Contents'), arr);
      }
    };

    const piPersons = data.piPersons || [];
    const PI_PAGE_IDX = 13; // P.14 (0-indexed)

    if (piPersons.length > 0) {
      const companyName = (data.fields as any)?.['fill_1_P.1'] || '';
      const ctx = (pdfDoc as any).context;

      // ── 1) Pre-scan original P.14 widget rects ──
      interface WidgetPos {
        suffix: string;   // fill_2, fill_3, ... cb_1, cb_2
        x: number; y: number; w: number; h: number; // pdf-lib coords (bottom-left origin)
        fieldType: string; // /Tx, /Btn
      }
      const widgetPositions: WidgetPos[] = [];
      {
        const origPage = pdfDoc.getPages()[PI_PAGE_IDX];
        const annots = origPage?.node?.lookup?.(PDFName.of("Annots")) as any;
        if (annots && typeof annots.size === "function") {
          for (let j = 0; j < annots.size(); j++) {
            try {
              const widget = ctx.lookup(annots.get(j)) as any;
              if (!widget || typeof widget.get !== "function") continue;
              if (String(widget.get(PDFName.of("Subtype"))) !== "/Widget") continue;

              // Get field type from /FT (on widget itself)
              const ft = widget.get(PDFName.of("FT"));
              const fieldType = ft ? String(ft) : '';

              // Get field name from PARENT (intermediate node)
              let parentName = "";
              const parentRef = widget.get(PDFName.of("Parent"));
              if (parentRef) {
                try {
                  const pObj = ctx.lookup(parentRef) as any;
                  const pT = pObj?.get?.(PDFName.of("T"));
                  if (pT instanceof PDFString) parentName = pT.decodeText();
                } catch { /* skip */ }
              }
              if (!parentName) continue;
              const suffix = parentName.replace(/_P$/, "");

              // Get widget rect
              const rect = widget.get(PDFName.of("Rect")) as any;
              if (!rect || typeof rect.get !== "function") continue;
              const x0 = Number(rect.get(0));
              const y0 = Number(rect.get(1));
              const x1 = Number(rect.get(2));
              const y1 = Number(rect.get(3));

              widgetPositions.push({
                suffix,
                x: x0, y: y0, w: x1 - x0, h: y1 - y0,
                fieldType,
              });
            } catch { /* skip */ }
          }
        }
      }

      // ── 2) Same-document copy P.14 for additional persons ──
      if (piPersons.length > 1) {
        for (let i = 1; i < piPersons.length; i++) {
          const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [PI_PAGE_IDX]);
          pdfDoc.insertPage(PI_PAGE_IDX + i, copiedPage);
        }
        if (data.removePages) {
          const shift = piPersons.length - 1;
          data.removePages = data.removePages.map((p: number) =>
            p > PI_PAGE_IDX ? p + shift : p
          );
        }
      }

      // ── 3) For each person, remove widgets + draw text on their PI-NNC1 page ──
      const fontSize = 8;
      for (let pi = 0; pi < piPersons.length; pi++) {
        const page = pdfDoc.getPages()[PI_PAGE_IDX + pi];
        if (!page) continue;
        const person = piPersons[pi];

        // 3a) Remove ALL widget annotations from this page
        const annots = page.node.lookup(PDFName.of("Annots")) as any;
        if (annots && typeof annots.clear === "function") {
          annots.clear();
        }

        // 3b) Draw each field as page content
        for (const pos of widgetPositions) {
          if (pos.fieldType === '/Tx') {
            let val = "";
            let isCjk = false;

            if (pos.suffix === "fill_1") {
              val = companyName;
              isCjk = hasCjk(companyName);
            } else {
              const mapping = PI_FIELDS.find(f => f.suffix === pos.suffix);
              if (!mapping) continue;
              // Skip HKID/passport fields based on person type
              if ((pos.suffix === 'fill_5' || pos.suffix === 'fill_6') && !person.isHkid) continue;
              if ((pos.suffix === 'fill_7' || pos.suffix === 'fill_8') && person.isHkid) continue;
              val = String(person[mapping.key] ?? "").trim();
              isCjk = mapping.isCjk;
            }
            if (!val) continue;

            // Draw white rectangle to cover original widget background
            page.drawRectangle({
              x: pos.x, y: pos.y,
              width: pos.w, height: pos.h,
              color: rgb(1, 1, 1) as any,
            });

            // Draw text (y adjusted for baseline — text goes at bottom of rect + offset)
            const textY = pos.y + 2;
            const textX = pos.x + 2;

            if (!isCjk || !hasCjk(val)) {
              // ASCII: use page.drawText with Helvetica
              page.drawText(val, {
                x: textX, y: textY,
                size: fontSize,
                font: helv as any,
              });
            } else {
              // CJK: inject raw content stream with /C2_1 font
              injectCjkText(ctx, page, val, textX, textY, fontSize);
            }
          } else if (pos.fieldType === '/Btn') {
            // ── Checkbox ──
            const isChecked = (pos.suffix === "cb_1" && person.isSecretary) ||
                              (pos.suffix === "cb_2" && !person.isSecretary);

            // White rectangle to cover original widget
            page.drawRectangle({
              x: pos.x, y: pos.y,
              width: pos.w, height: pos.h,
              color: rgb(1, 1, 1) as any,
            });

            // Checkbox border (borderColor only, no fill)
            page.drawRectangle({
              x: pos.x, y: pos.y,
              width: pos.w, height: pos.h,
              borderWidth: 0.5,
              borderColor: rgb(0, 0, 0) as any,
            });

            // Checkmark if checked
            if (isChecked) {
              const cx = pos.x + pos.w / 2;
              const cy = pos.y + pos.h / 2;
              page.drawLine({
                start: { x: cx - 3.5, y: cy },
                end: { x: cx - 1, y: cy + 4 },
                thickness: 1,
                color: rgb(0, 0, 0) as any,
              });
              page.drawLine({
                start: { x: cx - 1, y: cy + 4 },
                end: { x: cx + 4, y: cy - 3 },
                thickness: 1,
                color: rgb(0, 0, 0) as any,
              });
            }
          }
        }
      }

      // ── 4) P.8 續頁計數器 ──
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
    // updateFieldAppearances:false — we generate our own AP streams (setWidgetApV9)
    // for PI-NNC1 pages. Other pages use pdf-lib form API which generates AP correctly.
    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc1-pdf error:", err?.message || err);
    return jsonResp({ error: err?.message || String(err) || "Internal server error" }, 500);
  }
}
