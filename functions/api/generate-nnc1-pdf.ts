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
  PDFArray, PDFNumber,
} from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64 } from "./_pdf-utils";
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

    // ═══ PI-NNC1 (P.14): Widget-level fill with generated AP streams ═══
    // Field hierarchy on P.14:
    //   Intermediate parent:  /T fill_2_P  /Kids[...]         (no /FT)
    //   Terminal = Widget:    /FT /Tx      /T (14)  /Parent
    //
    // v9 Approach:
    //   1) Cross-document copyPages for independent widget objects per page
    //   2) detachWidget: copy /T to "fill_2_P.14", inherit FT/DA/Ff, delete /Parent
    //   3) Generate NEW AP stream using page's internal font names:
    //      - /C2_1 for CJK (PMingLiU Type0, Identity-H) — resolves via page Resources
    //      - /Helv for ASCII (Helvetica Type1, added by embedFont)
    //   4) AP has NO Resources dict → font resolution inherits from page
    //      → works correctly on both original and copied pages (different font xrefs!)
    //   5) rebuildAcroFormFields: rebuilds /Fields + sets NeedAppearances=true
    //
    // This avoids the v8 bug where AP's hardcoded DescendantFonts xref (526)
    // pointed to the wrong font object on cross-document copied pages.

    /** Generate AP stream using page's internal font names. No Resources dict. */
    const setWidgetApV9 = (
      ctx: any,
      widget: any,
      value: string,
      isCjk: boolean,
    ): void => {
      const fontName = isCjk ? "C2_1" : "Helv";
      const fontSize = 10;

      let textOp: string;
      if (isCjk) {
        // UTF-16BE hex with BOM
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
        textOp = `<${hex}> Tj`;
      } else {
        const escaped = value.replace(/([()\\])/g, '\\$1');
        textOp = `(${escaped}) Tj`;
      }

      const apContent = `/${fontName} ${fontSize} Tf\n0 g\nBT\n2 2 Td\n${textOp}\nET`;

      // Build Form XObject (NO Resources — inherits from page)
      const bbox = PDFArray.withContext(ctx);
      bbox.push(PDFNumber.of(0));
      bbox.push(PDFNumber.of(0));
      bbox.push(PDFNumber.of(1000));
      bbox.push(PDFNumber.of(1000));

      const dict = ctx.obj({});
      dict.set(PDFName.of('Type'), PDFName.of('XObject'));
      dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
      dict.set(PDFName.of('BBox'), bbox);

      const apStream = ctx.stream(new TextEncoder().encode(apContent), dict);
      const apRef = ctx.register(apStream);

      const apDict = ctx.obj({});
      apDict.set(PDFName.of('N'), apRef);
      widget.set(PDFName.of('AP'), apDict);

      // Set /V
      if (isCjk) {
        widget.set(PDFName.of('V'), PDFHexString.fromText(value));
      } else {
        widget.set(PDFName.of('V'), PDFString.of(value));
      }

      // Set /DA (fallback)
      widget.set(PDFName.of('DA'), PDFString.of(`/${fontName} ${fontSize} Tf 0 g`));
    };

    const piPersons = data.piPersons || [];
    const PI_PAGE_IDX = 13; // P.14 (0-indexed)

    if (piPersons.length > 0) {
      const companyName = (data.fields as any)?.['fill_1_P.1'] || '';

      // 1) Copy extra P.14 pages for additional persons
      // ⚠️ Cross-document copyPages: copy from a SECOND template load so each
      //    copied page gets INDEPENDENT widget objects (different xref numbers).
      //    Same-document copyPages reuses object refs → setting /V on the last
      //    page overwrites all previous pages' widget values.
      if (piPersons.length > 1) {
        const freshBytes = new Uint8Array(templateBytes);
        const freshDoc = await PDFDocument.load(freshBytes, { ignoreEncryption: true });
        for (let i = 1; i < piPersons.length; i++) {
          const [copiedPage] = await pdfDoc.copyPages(freshDoc, [PI_PAGE_IDX]);
          pdfDoc.insertPage(PI_PAGE_IDX + i, copiedPage);
        }
        // Adjust removePages indices for inserted pages
        if (data.removePages) {
          const shift = piPersons.length - 1;
          data.removePages = data.removePages.map((p: number) =>
            p > PI_PAGE_IDX ? p + shift : p
          );
        }
      }

      // 2) For each person, detach + fill widgets on their PI-NNC1 page
      const ctx = (pdfDoc as any).context;
      for (let pi = 0; pi < piPersons.length; pi++) {
        const pageIdx = PI_PAGE_IDX + pi;
        const person = piPersons[pi];
        const pages = pdfDoc.getPages();
        const page = pages[pageIdx];
        if (!page) continue;

        const annots = page.node.lookup(PDFName.of("Annots")) as any;
        if (!annots || typeof annots.size !== "function") continue;

        for (let j = 0; j < annots.size(); j++) {
          try {
            const widget = ctx.lookup(annots.get(j)) as any;
            if (!widget || typeof widget.get !== "function") continue;
            const subtype = widget.get(PDFName.of("Subtype"));
            if (!subtype || String(subtype) !== "/Widget") continue;

            // Read FT from widget (terminal field has /FT)
            const ft = widget.get(PDFName.of("FT"));
            const fieldType = ft ? String(ft) : '';

            // Read T from PARENT (intermediate node has meaningful name like fill_2_P)
            let parentName = "";
            const parentRef = widget.get(PDFName.of("Parent"));
            let parentObj: any = null;
            if (parentRef) {
              try { parentObj = ctx.lookup(parentRef); } catch { /* skip */ }
              if (parentObj) {
                try {
                  const pT = parentObj.get(PDFName.of("T"));
                  if (pT instanceof PDFString) parentName = pT.decodeText();
                } catch { /* skip */ }
              }
            }
            if (!parentName) continue;

            // Strip _P suffix: fill_2_P → fill_2, cb_1_P → cb_1
            const suffix = parentName.replace(/_P$/, "");

            // ── Detach widget from shared parent ──
            detachWidget(widget, parentObj);
            // Add page suffix to /T — avoids name collision across PI-NNC1 pages
            // (without this, 2 pages with same field names → PDF reader shows same value)
            const currentT = widget.get(PDFName.of("T"));
            if (currentT instanceof PDFString) {
              widget.set(PDFName.of("T"), PDFString.of(`${currentT.decodeText()}.p${pageIdx}`));
            }

            if (fieldType === '/Tx') {
              // ── Text field ──
              if (suffix === "fill_1") {
                // Company name (CJK-safe)
                setWidgetApV9(ctx, widget, companyName, true);
              } else {
                const mapping = PI_FIELDS.find(f => f.suffix === suffix);
                if (!mapping) continue;
                if ((suffix === 'fill_5' || suffix === 'fill_6') && !person.isHkid) continue;
                if ((suffix === 'fill_7' || suffix === 'fill_8') && person.isHkid) continue;
                const val = String(person[mapping.key] ?? "").trim();
                if (!val) continue;

                setWidgetApV9(ctx, widget, val, mapping.isCjk);
              }
            } else if (fieldType === '/Btn') {
              // ── Checkbox ──
              // Default: Off
              widget.set(PDFName.of("V"), PDFName.of("Off"));
              widget.set(PDFName.of("AS"), PDFName.of("Off"));

              if ((suffix === "cb_1" && person.isSecretary) ||
                  (suffix === "cb_2" && !person.isSecretary)) {
                // Discover the On state name from AP dict
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
              // Checkbox AP is needed for visual checkmark; keep it
            }
          } catch { /* skip malformed widget */ }
        }
      }

      // 3) Rebuild AcroForm /Fields + set NeedAppearances=true
      //    Registers copied-page widgets (orphaned from original /Kids).
      rebuildAcroFormFields(pdfDoc);

      // 4) P.8 續頁計數器
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
