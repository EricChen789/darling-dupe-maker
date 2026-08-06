// POST /api/generate-nn1-pdf
// NN1 註冊非香港公司註冊申請書 — 專用端點（Phase 2.2）
// 使用 R2 模板 + _acroform.ts 底層 helpers
//
// PI-NN1 (P.17) 多自然人支援：借鑒 NNC1 v9 widget AP stream 方案
//   - Cross-document copyPages → 每個自然人獨立 PI 頁面
//   - detachWidget + setWidgetApV9 → 避免 widget 共享導致值覆蓋
//   - /C2_1 (PMingLiU) for CJK, /Helv for ASCII → 字體繼承自頁面 Resources

import {
  PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString,
  PDFArray, PDFNumber, rgb,
} from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";
import {
  createFormHelpers,
  rebuildAcroFormFields,
  enableNeedAppearances,
  detachWidget,
} from "./_acroform";

const TEMPLATE_NAME = "NN1-template.pdf";

// PI-NN1 field definitions (P.17)
// Field name suffix → person data key + CJK flag + HKID/passport filter
const PI_FIELDS: Array<{ suffix: string; key: string; isCjk: boolean }> = [
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
  { suffix: 'fill_13', key: 'addrCountry',     isCjk: true  },
];

/** Generate AP stream using page's internal font names. No Resources dict.
 *  Borrowed from NNC1 v9 — font resolution inherits from page Resources. */
function setWidgetApV9(
  ctx: any,
  widget: any,
  value: string,
  isCjk: boolean,
): void {
  const fontName = isCjk ? "C2_1" : "Helv";
  const fontSize = 10;

  let textOp: string;
  if (isCjk) {
    let hex = 'FEFF'; // UTF-16BE BOM
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

  if (isCjk) {
    widget.set(PDFName.of('V'), PDFHexString.fromText(value));
  } else {
    widget.set(PDFName.of('V'), PDFString.of(value));
  }

  widget.set(PDFName.of('DA'), PDFString.of(`/${fontName} ${fontSize} Tf 0 g`));
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const { user, errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      fields?: Record<string, unknown>;
      checkboxes?: string[];
      removePages?: number[];
      /** Per-field font size override (e.g. { 'fill_12_P.1': 8 }) */
      fieldFontSizes?: Record<string, number>;
      /** Signatory capacity: cross out unused capacities on P.10 */
      signatoryCapacity?: 'director' | 'secretary' | 'manager' | 'authorizedRep';
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
        addrCountry: string;
        isAR: boolean;
        isSec: boolean;
        isDir: boolean;
        isAltDir: boolean;
      }>;
    };

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE_NAME);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes);

    // ── Fill P.1-P.10 using simple form API ──
    const { setText, check } = createFormHelpers(pdfDoc);

    const fields = data.fields || {};
    // Skip P.17 fields (handled via widget-level PI fill below)
    for (const [name, value] of Object.entries(fields)) {
      if (name.endsWith('_P.17')) continue;
      if (value != null && String(value).length > 0) {
        setText(name, String(value));
      }
    }

    // Apply per-field font size overrides (re-set with smaller font)
    const fieldFontSizes = data.fieldFontSizes || {};
    for (const [name, fontSize] of Object.entries(fieldFontSizes)) {
      const value = (fields as any)?.[name];
      if (value != null && String(value).length > 0) {
        setText(name, String(value), Number(fontSize));
      }
    }

    for (const name of data.checkboxes || []) {
      if (name.endsWith('_P.17')) continue;
      check(name, true);
    }

    // ═══ P.10 Signatory Capacity — use template dropdowns ═══
    // Each capacity has Dropdown1-4 with two /Opt entries:
    //   [['Yes', '  '], ['Yes', '─────────────────────────────']]
    // Both have export value 'Yes' so we rewrite /Opt to distinct values
    // and set /V accordingly. This avoids ambiguous match on duplicate exports.
    const signatoryCapacity = data.signatoryCapacity;
    if (signatoryCapacity) {
      const allCaps = ['director', 'secretary', 'manager', 'authorizedRep'];
      const p10 = pdfDoc.getPages()[9]; // P.10 (0-indexed)
      if (p10) {
        const ctx = (pdfDoc as any).context;
        const annots = p10.node.lookup(PDFName.of('Annots')) as any;
        if (annots && typeof annots.size === 'function') {
          for (let i = 0; i < annots.size(); i++) {
            try {
              const widget = ctx.lookup(annots.get(i)) as any;
              if (!widget || String(widget.get(PDFName.of('Subtype'))) !== '/Widget') continue;

              // Read /FT and /T from widget or parent (NN1 P.10 has them on parent)
              let ft = widget.get(PDFName.of('FT'));
              let fieldName = '';
              const t = widget.get(PDFName.of('T'));
              if (t instanceof PDFString) fieldName = t.decodeText();

              // If no /FT or /T on widget, try parent
              const pRef = widget.get(PDFName.of('Parent'));
              let parentObj: any = null;
              if (pRef) {
                try {
                  parentObj = ctx.lookup(pRef) as any;
                  if (!ft) ft = parentObj?.get?.(PDFName.of('FT'));
                  if (!fieldName) {
                    const pT = parentObj?.get?.(PDFName.of('T'));
                    if (pT instanceof PDFString) fieldName = pT.decodeText();
                  }
                } catch { /* skip */ }
              }

              // Skip non-choice fields (dropdowns are /Ch)
              if (!ft || String(ft) !== '/Ch') continue;
              const ddMatch = fieldName.match(/^Dropdown(\d)$/);
              if (!ddMatch) continue;
              const ddIdx = parseInt(ddMatch[1]);
              const capForDD = allCaps[ddIdx - 1];
              if (!capForDD) continue;

              const isSelected = capForDD === signatoryCapacity;

              // Detach widget from parent so rebuildAcroFormFields includes it
              if (parentObj) detachWidget(widget, parentObj);

              // Rewrite /Opt with distinct export values so /V can disambiguate:
              //   [ ['blank', ' '] ['line', '──────────'] ]
              const newOpt = PDFArray.withContext(ctx);
              const opt0 = PDFArray.withContext(ctx);
              opt0.push(PDFString.of('blank'));
              opt0.push(PDFString.of(' '));
              const opt1 = PDFArray.withContext(ctx);
              opt1.push(PDFString.of('line'));
              opt1.push(PDFString.of('─────────────────────────────'));
              newOpt.push(opt0);
              newOpt.push(opt1);
              widget.set(PDFName.of('Opt'), newOpt);
              // /V picks which option — 'blank' or 'line'
              widget.set(PDFName.of('V'), PDFString.of(isSelected ? 'blank' : 'line'));
              widget.delete(PDFName.of('AP'));
            } catch (_) { /* skip */ }
          }
        }
      }
    }

    // ═══ PI-NN1 (P.17): Widget-level fill with generated AP streams ═══
    // Same v9 approach as NNC1 PI-NNC1:
    //   1) Cross-document copyPages for independent widget objects per page
    //   2) detachWidget: copy /T, inherit FT/DA/Ff, delete /Parent
    //   3) Generate NEW AP stream using page's internal font names
    //   4) AP has NO Resources dict → font resolution inherits from page
    //   5) rebuildAcroFormFields: rebuilds /Fields + sets NeedAppearances=true

    const piPersons = data.piPersons || [];
    const PI_PAGE_IDX = 16; // P.17 (0-indexed)

    if (piPersons.length > 0) {
      const companyName = (data.fields as any)?.['fill_1_P.1'] || '';

      // 1) Copy extra P.17 pages for additional persons
      //    Cross-document: load SECOND template so each copied page gets
      //    INDEPENDENT widget objects (different xref numbers).
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

      // 2) For each person, detach + fill widgets on their PI-NN1 page
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

            const ft = widget.get(PDFName.of("FT"));
            const fieldType = ft ? String(ft) : '';

            // Read field name — try parent first (NN1 may have parent/child hierarchy)
            let fieldName = "";
            const parentRef = widget.get(PDFName.of("Parent"));
            let parentObj: any = null;
            if (parentRef) {
              try { parentObj = ctx.lookup(parentRef); } catch { /* skip */ }
              if (parentObj) {
                try {
                  const pT = parentObj.get(PDFName.of("T"));
                  if (pT instanceof PDFString) fieldName = pT.decodeText();
                } catch { /* skip */ }
              }
            }
            // Fallback: read /T from widget itself (flat widget structure)
            if (!fieldName) {
              const wT = widget.get(PDFName.of("T"));
              if (wT instanceof PDFString) fieldName = wT.decodeText();
            }
            if (!fieldName) continue;

            // Normalize field name: strip _P suffix for parent-based names
            // "fill_2_P" → "fill_2", "fill_2_P.17" → "fill_2_P.17" (flat)
            const suffix = fieldName.replace(/_P$/, "");

            // ── Detach widget from shared parent ──
            if (parentObj) detachWidget(widget, parentObj);
            // Add page suffix to /T to avoid name collisions across PI pages
            const currentT = widget.get(PDFName.of("T"));
            if (currentT instanceof PDFString) {
              widget.set(PDFName.of("T"), PDFString.of(`${currentT.decodeText()}.p${pageIdx}`));
            }

            if (fieldType === '/Tx') {
              // ── Text field ──
              // Extract "fill_N" root for exact matching
              const rootMatch = suffix.match(/^(fill_\d+)/);
              const root = rootMatch ? rootMatch[1] : suffix;
              if (root === 'fill_1') {
                // Company name (CJK-safe)
                setWidgetApV9(ctx, widget, companyName, true);
              } else {
                const mapping = PI_FIELDS.find(f => f.suffix === root);
                if (!mapping) continue;
                const val = String((person as any)[mapping.key] ?? "").trim();
                if (!val) continue;
                setWidgetApV9(ctx, widget, val, mapping.isCjk);
              }
            } else if (fieldType === '/Btn') {
              // ── Checkbox ──
              widget.set(PDFName.of("V"), PDFName.of("Off"));
              widget.set(PDFName.of("AS"), PDFName.of("Off"));

              const shouldCheck =
                (suffix.includes('cb_1') && person.isAR) ||
                (suffix.includes('cb_2') && person.isSec) ||
                (suffix.includes('cb_3') && person.isDir) ||
                (suffix.includes('cb_4') && person.isAltDir);

              if (shouldCheck) {
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
      }

      // 3) Rebuild AcroForm /Fields + set NeedAppearances=true
      rebuildAcroFormFields(pdfDoc);

      // 4) No need to override fill_15_P.10 — frontend already sends correct count via fields
    }

    // ── Remove pages (descending order) ──
    const removePages = data.removePages || [];
    if (removePages.length > 0) {
      const sorted = [...removePages].sort((a, b) => b - a);
      for (const idx of sorted) {
        if (idx >= 0 && idx < pdfDoc.getPageCount()) {
          pdfDoc.removePage(idx);
        }
      }
    }

    // SKIP flatten() — NN1 template is large, flatten() exceeds Workers CPU budget
    rebuildAcroFormFields(pdfDoc);
    enableNeedAppearances(pdfDoc);

    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("NN1 generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
