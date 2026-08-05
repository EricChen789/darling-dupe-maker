// POST /api/generate-nnc1-pdf
// NNC1 法團成立表格（股份有限公司）— 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
// CPU优化: enableNeedAppearances + updateFieldAppearances:false（24页模板）
// 支援多自然人 → 自動複製 PI-NNC1 頁面（每頁一人）
//   策略：
//     Person 0 → form API + updateAppearances(cjkFont) — 真實 AP，像打字填入
//     Person 1+ → copyPages + drawMixed overlay — 繞過 widget field-name 共享
//     嵌入 Noto Sans TC（R2）提供 CJK 渲染

import { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString } from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64 } from "./_pdf-utils";
import { enableNeedAppearances } from "./_acroform";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC1-template.pdf";

// ═══ PI-NNC1 (P.14) — 受保護資料頁 ═══
// Strategy: widget-level /V + /DA on copied pages, using template's built-in /PMingLiU font.
//   No font embedding needed → CPU stays under Workers limit.
//   Key insight: copyPages BEFORE touching any form fields → copied widgets are blank.
//   Then set widget-level /V on each page independently.

// PI-NNC1 widget suffix → person data key
const PI_KEY_MAP: Record<string, { key: string; isCjk: boolean }> = {
  'fill_2':  { key: 'nameChinese',     isCjk: true  },
  'fill_3':  { key: 'surname',         isCjk: false },
  'fill_4':  { key: 'otherNames',      isCjk: false },
  'fill_5':  { key: 'hkidMain',        isCjk: false },
  'fill_6':  { key: 'hkidCheck',       isCjk: false },
  'fill_7':  { key: 'passportCountry', isCjk: true  },
  'fill_8':  { key: 'passportNumber',  isCjk: false },
  'fill_9':  { key: 'addrFlat',        isCjk: true  },
  'fill_10': { key: 'addrBuilding',    isCjk: true  },
  'fill_11': { key: 'addrStreet',      isCjk: true  },
  'fill_12': { key: 'addrDistrict',    isCjk: true  },
  'fill_13': { key: 'addrRegion',      isCjk: true  },
};

/** Set widget-level /V and /DA on a single PI-NNC1 page.
 *  Works on both original and copied pages — uses template's /PMingLiU font.
 *  Deletes widget /AP so PDF reader regenerates appearance from /V + /DA. */
function fillPiWidgets(
  pdfDoc: any,
  pageIndex: number,
  piPerson: Record<string, any>,
  companyName: string
): void {
  const page = pdfDoc.getPages()[pageIndex];
  if (!page) return;
  const annots = page.node.lookup(PDFName.of("Annots")) as any;
  if (!annots || typeof annots.size !== "function") return;

  for (let i = 0; i < annots.size(); i++) {
    try {
      const widget = pdfDoc.context.lookup(annots.get(i)) as any;
      if (!widget || typeof widget.get !== "function") continue;
      const subtype = widget.get(PDFName.of("Subtype"));
      if (!subtype || String(subtype) !== "/Widget") continue;

      const parentRef = widget.get(PDFName.of("Parent"));
      const field = parentRef ? (pdfDoc.context.lookup(parentRef) as any) : widget;
      const ft = field.get(PDFName.of("FT"));
      const fieldType = ft ? String(ft) : "";

      // Get field/widget name
      const fieldName = _decode(field.get(PDFName.of("T")));
      const widgetName = _decode(widget.get(PDFName.of("T")));
      const name = widgetName || fieldName || "";
      if (!name) continue;

      // Extract suffix: "fill_2_P.14" → "fill_2"
      const suffix = name.replace(/_P\.\d+$/, "").replace(/_P\d+$/, "");

      if (fieldType === "/Tx") {
        let val = "";
        if (suffix === "fill_1") {
          val = companyName;
        } else {
          const mapping = PI_KEY_MAP[suffix];
          if (mapping) val = String(piPerson[mapping.key] ?? "").trim();
        }
        if (!val) continue;

        // Build DA string using template's PMingLiU for CJK, Helv for ASCII
        const mapping = PI_KEY_MAP[suffix];
        const useCjk = mapping?.isCjk && !_isAscii(val);
        const da = useCjk
          ? "/PMingLiU 10 Tf 0 g"
          : "/Helv 10 Tf 0 g";

        widget.set(PDFName.of("DA"), PDFString.of(da));
        widget.set(PDFName.of("V"), useCjk ? PDFHexString.fromText(val) : PDFString.of(val));
        widget.delete(PDFName.of("AP")); // force reader to regenerate from /V+/DA
      } else if (fieldType === "/Btn") {
        // Checkbox: cb_1 = 秘書, cb_2 = 董事
        const isSec = piPerson['isSecretary'];
        if ((suffix === 'cb_1' && isSec) || (suffix === 'cb_2' && !isSec)) {
          // Discover On state name from AP dict
          let onState = "Yes";
          try {
            const ap = widget.get(PDFName.of("AP")) as any;
            const apN = ap?.get?.(PDFName.of("N")) as any;
            const dict = apN?.dict;
            if (dict && typeof dict.keys === "function") {
              for (const k of dict.keys()) {
                if (k !== "Off") { onState = k; break; }
              }
            }
          } catch { /* use default */ }
          widget.set(PDFName.of("AS"), PDFName.of(onState));
          widget.delete(PDFName.of("AP"));
        }
      }
    } catch { /* skip malformed widget */ }
  }
}

// Mini helpers to avoid importing _acroform (reduces bundle)
function _decode(v: any): string {
  if (!v) return "";
  try {
    if (v instanceof PDFString) return v.decodeText();
    if (v instanceof PDFHexString) return v.decodeText();
    return String(v).replace(/^\(|\)$/g, "");
  } catch { return ""; }
}
function _isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) return false;
  }
  return true;
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
    // Embed Helvetica (lightweight, always needed for BR stamp)
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const brNumber = data.brNumber || "";
    if (brNumber) {
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
      }
    }

    // ── Fill text fields (skip P.14 — handled below via fillPiDrawText) ──
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      if (name.endsWith('_P.14')) continue;
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;
        const tf = form.getTextField(name);
        tf.setText(vstr);
      } catch { /* field missing — skip */ }
    }

    // ── Check checkboxes (skip P.14 — handled below) ──
    for (const name of data.checkboxes || []) {
      if (name.endsWith('_P.14')) continue;
      try {
        form.getCheckBox(name).check();
      } catch { /* skip */ }
    }

    // ── PI-NNC1: Copy blank P.14 FIRST, then widget /V for ALL persons ──
    const piPersons = data.piPersons || [];
    const PI_PAGE_IDX = 13; // P.14 (0-indexed)

    if (piPersons.length > 0) {
      const companyName = (data.fields as any)?.['fill_1_P.1'] || '';

      // 1) Copy extra blank P.14 pages FIRST (while widgets are still blank)
      if (piPersons.length > 1) {
        for (let i = 1; i < piPersons.length; i++) {
          const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [PI_PAGE_IDX]);
          pdfDoc.insertPage(PI_PAGE_IDX + i, copiedPage);
        }
        if (data.removePages) {
          const shift = piPersons.length - 1;
          data.removePages = data.removePages.map((p: number) => p + shift);
        }
      }

      // 2) Set widget /V on ALL PI-NNC1 pages (uses template /PMingLiU font)
      for (let i = 0; i < piPersons.length; i++) {
        fillPiWidgets(pdfDoc, PI_PAGE_IDX + i, piPersons[i], companyName);
      }

      // 3) P.8 續頁計數器
      const piContPages = piPersons.length - 1;
      if (piContPages > 0) {
        try {
          form.getTextField('fill_4_P.8').setText(String(piContPages));
        } catch { /* skip */ }
      }
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
    // enableNeedAppearances as safety net for any fields without AP.
    // updateFieldAppearances:false — Person 0 has real AP from updateAppearances(),
    //   non-P.14 fields have AP from setText(), Person 1+ uses drawText (page stream).
    enableNeedAppearances(pdfDoc);
    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc1-pdf error:", err?.message || err);
    return jsonResp({ error: err?.message || String(err) || "Internal server error" }, 500);
  }
}
