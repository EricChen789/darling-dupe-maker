// POST /api/generate-nnc1-pdf
// NNC1 法團成立表格（股份有限公司）— 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
// CPU优化: enableNeedAppearances 替代逐字段 updateAppearances（24页模板）
// 支援多自然人 → 自動複製 PI-NNC1 頁面（每頁一人）
//   策略：copyPages + 直接設 widget /V（零字體依賴，CPU 極輕）

import { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString } from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64 } from "./_pdf-utils";
import { enableNeedAppearances } from "./_acroform";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC1-template.pdf";

// PI-NNC1 widget → piPerson key mapping
// Widget names on P.14 template page
const PI_WIDGET_KEYS: Record<string, string> = {
  'fill_2_P.14': 'nameChinese',
  'fill_3_P.14': 'surname',
  'fill_4_P.14': 'otherNames',
  'fill_5_P.14': 'hkidMain',
  'fill_6_P.14': 'hkidCheck',
  'fill_7_P.14': 'passportCountry',
  'fill_8_P.14': 'passportNumber',
  'fill_9_P.14': 'addrFlat',
  'fill_10_P.14': 'addrBuilding',
  'fill_11_P.14': 'addrStreet',
  'fill_12_P.14': 'addrDistrict',
  'fill_13_P.14': 'addrRegion',
};
const PI_COMPANY_FIELD = 'fill_1_P.14'; // company name
const PI_CB1_FIELD = 'cb_1_P.14';      // 秘書 checkbox
const PI_CB2_FIELD = 'cb_2_P.14';      // 董事 checkbox

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

    // ── Fill text fields (Helvetica-only, no CJK updateAppearances to save CPU) ──
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;
        const tf = form.getTextField(name);
        tf.setText(vstr);
      } catch { /* field missing — skip */ }
    }

    // ── Check checkboxes ──
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // ── BR stamp on all pages (Helvetica, no CJK font needed) ──
    const brNumber = data.brNumber || "";
    if (brNumber) {
      const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
      }
    }

    // ── PI-NNC1 multi-page: copy pages for additional natural persons ──
    // Strategy: copy the PI-NNC1 page, then set /V directly on each widget
    // annotation of the copy. Widget-level /V overrides the shared parent field's /V.
    // This is pure PDF object manipulation — zero font embedding, zero draw calls.
    // Much lighter CPU than the overlay-text approach.
    const piPersons = data.piPersons || [];
    const PI_PAGE_INDEX = 13; // P.14 (0-indexed)

    if (piPersons.length > 1) {
      // Build a helper to set /V on a specific widget of a page
      const setWidgetValue = (page: any, fieldName: string, value: string, isCheckbox: boolean) => {
        try {
          const annots = page.node.lookup(PDFName.of("Annots")) as any;
          if (!annots || typeof annots.size !== "function") return;
          for (let i = 0; i < annots.size(); i++) {
            try {
              const wref = annots.get(i);
              const w = pdfDoc.context.lookup(wref) as any;
              if (!w || typeof w.get !== "function") continue;
              if (String(w.get(PDFName.of("Subtype"))) !== "/Widget") continue;
              const t = w.get(PDFName.of("T"));
              const wName = t ? (typeof t.decodeText === "function" ? t.decodeText() : String(t).replace(/^\((.*)\)$/s, "$1")) : "";
              if (wName !== fieldName) continue;
              if (isCheckbox) {
                w.set(PDFName.of("V"), PDFName.of(value));
              } else if (value) {
                // Use PDFString for ASCII, PDFHexString for CJK (FEFF = UTF-16BE BOM)
                if (/^[\x00-\x7F]*$/.test(value)) {
                  w.set(PDFName.of("V"), PDFString.of(value));
                } else {
                  const hex = [...new TextEncoder().encode(value)]
                    .map(b => b.toString(16).padStart(2, "0"))
                    .join("");
                  w.set(PDFName.of("V"), PDFHexString.of(`FEFF${hex}`));
                }
              }
            } catch { /* skip broken widget */ }
          }
        } catch { /* page has no annots */ }
      };

      for (let i = 1; i < piPersons.length; i++) {
        const pi = piPersons[i];

        // Copy the PI-NNC1 page
        const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [PI_PAGE_INDEX]);
        pdfDoc.insertPage(PI_PAGE_INDEX + i, copiedPage);

        // Set field values directly on the copied page's widgets
        for (const [fieldName, key] of Object.entries(PI_WIDGET_KEYS)) {
          const val = String((pi as any)[key] || "");
          if (val) setWidgetValue(copiedPage, fieldName, val, false);
        }
        // Company name
        const cnVal = pi.nameChinese || "";
        if (cnVal) setWidgetValue(copiedPage, PI_COMPANY_FIELD, cnVal, false);

        // Checkboxes: secretary vs director
        setWidgetValue(copiedPage, PI_CB1_FIELD, pi.isSecretary ? "Yes" : "Off", true);
        setWidgetValue(copiedPage, PI_CB2_FIELD, pi.isSecretary ? "Off" : "Yes", true);
      }

      // Adjust removePages for the new page count
      if (data.removePages) {
        const shift = piPersons.length - 1;
        data.removePages = data.removePages.map((p: number) => p + shift);
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

    // ── enableNeedAppearances: tells PDF reader to render field appearances ──
    enableNeedAppearances(pdfDoc);

    // ── Save (no flatten, no updateFieldAppearances = save CPU) ──
    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc1-pdf error:", err?.message || err);
    return jsonResp({ error: err?.message || String(err) || "Internal server error" }, 500);
  }
}
