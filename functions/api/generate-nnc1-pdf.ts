// POST /api/generate-nnc1-pdf
// NNC1 法團成立表格（股份有限公司）— 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
// CPU优化: enableNeedAppearances 替代逐字段 updateAppearances（24页模板）
// 支援多自然人 → 自動複製 PI-NNC1 頁面（每頁一人）
//   策略：
//     全部人員 → copyPages(如需) + 白底矩形 + drawText 疊加文字
//     form API + NeedAppearances + updateFieldAppearances:false 不可靠：
//     模板的 AP 顯示空白字段，且許多 PDF 閱讀器不認 NeedAppearances
//     改用 drawText 直接繪製覆蓋在所有 PI-NNC1 頁面上

import { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString, rgb } from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64, fetchAndEmbedFont, drawMixed } from "./_pdf-utils";
import { enableNeedAppearances, isAscii } from "./_acroform";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC1-template.pdf";

// PI-NNC1 field positions (pdf-lib coords: origin bottom-left, y = 842 - PyMuPDF y1)
const PI_FIELD_RECTS: Array<{ key: string; x: number; y: number; w: number; h: number; isCjk: boolean }> = [
  { key: 'nameChinese',  x: 207, y: 436, w: 355, h: 22, isCjk: true  },  // fill_2
  { key: 'surname',      x: 207, y: 406, w: 355, h: 23, isCjk: false },  // fill_3
  { key: 'otherNames',   x: 207, y: 378, w: 355, h: 22, isCjk: false },  // fill_4
  { key: 'hkidMain',     x: 257, y: 338, w: 256, h: 22, isCjk: false },  // fill_5
  { key: 'hkidCheck',    x: 526, y: 338, w:  24, h: 22, isCjk: false },  // fill_6
  { key: 'passportCountry', x: 257, y: 310, w: 305, h: 22, isCjk: true }, // fill_7
  { key: 'passportNumber',  x: 257, y: 282, w: 305, h: 22, isCjk: false },// fill_8
  { key: 'addrFlat',     x: 207, y: 230, w: 355, h: 27, isCjk: true  },  // fill_9
  { key: 'addrBuilding', x: 207, y: 196, w: 355, h: 27, isCjk: true  },  // fill_10
  { key: 'addrStreet',   x: 207, y: 162, w: 355, h: 27, isCjk: true  },  // fill_11
  { key: 'addrDistrict', x: 207, y: 128, w: 355, h: 27, isCjk: true  },  // fill_12
  { key: 'addrRegion',   x: 207, y:  94, w: 355, h: 27, isCjk: true  },  // fill_13
];

// Checkbox positions for overlay (pdf-lib coords)
const PI_CB_RECTS = [
  { isSecretary: true,  x: 207, y: 472, w: 15, h: 14 },  // cb_1_P.14
  { isSecretary: false, x: 314, y: 472, w: 15, h: 14 },  // cb_2_P.14
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

    // ── Fill text fields ──
    // NO LONGER skip _P.14 fields — person 0 data goes through form API (field-level /V)
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
      try {
        form.getCheckBox(name).check();
      } catch { /* skip */ }
    }

    // ── BR stamp on all pages ──
    const brNumber = data.brNumber || "";
    if (brNumber) {
      const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
      }
    }

    // ── PI-NNC1 multi-page ──
    // ALL persons use drawText overlay (white rect + drawMixed).
    // form API + NeedAppearances + updateFieldAppearances:false is unreliable:
    // the template AP shows blank fields and many viewers don't honor NeedAppearances.
    // So we draw overlay for person 0 too, not just person 1+.
    const piPersons = data.piPersons || [];
    const PI_PAGE_INDEX = 13; // P.14 (0-indexed)

    if (piPersons.length > 0) {
      // Copy extra pages FIRST (before any overlay drawing that could be copied)
      for (let i = 1; i < piPersons.length; i++) {
        const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [PI_PAGE_INDEX]);
        pdfDoc.insertPage(PI_PAGE_INDEX + i, copiedPage);
      }

      // Adjust removePages for extra PI-NNC1 pages
      if (data.removePages && piPersons.length > 1) {
        const shift = piPersons.length - 1;
        data.removePages = data.removePages.map((p: number) => p + shift);
      }

      // ── Draw text overlays for ALL piPersons (including person 0) ──
      // Embed fonts ONCE (not per page) to avoid CPU timeout
      const fonts = await fetchAndEmbedFont(pdfDoc, env);
      const white = rgb(1, 1, 1);

      for (let p = 0; p < piPersons.length; p++) {
        const pi = piPersons[p];
        const page = pdfDoc.getPages()[PI_PAGE_INDEX + p];

        // Draw text fields
        for (const rect of PI_FIELD_RECTS) {
          const val = String((pi as any)[rect.key] || "").trim();
          if (!val) continue;

          try {
            // White rectangle to cover underlying form field (template AP or form API value)
            page.drawRectangle({
              x: rect.x - 2, y: rect.y - 2,
              width: rect.w + 4, height: rect.h + 4,
              color: white,
            });

            // Draw text
            drawMixed(page, val, {
              x: rect.x + 2,
              y: rect.y + rect.h - 3,  // baseline from bottom of rect
              size: 8,
              cjk: fonts.cjk!,
              ascii: fonts.ascii,
            });
          } catch { /* skip */ }
        }

        // Draw checkbox overlay
        const cbRect = PI_CB_RECTS.find(r => r.isSecretary === pi.isSecretary);
        if (cbRect) {
          try {
            // White rectangle to cover underlying checkbox
            page.drawRectangle({
              x: cbRect.x - 2, y: cbRect.y - 2,
              width: cbRect.w + 4, height: cbRect.h + 4,
              color: white,
            });
            // Draw ✓ symbol
            page.drawText('✓', {
              x: cbRect.x + 1, y: cbRect.y + 2,
              size: 9,
              font: fonts.ascii,
            });
          } catch { /* skip */ }
        }
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

    // ── enableNeedAppearances ──
    enableNeedAppearances(pdfDoc);

    // ── Save ──
    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc1-pdf error:", err?.message || err);
    return jsonResp({ error: err?.message || String(err) || "Internal server error" }, 500);
  }
}
