// POST /api/generate-template-pdf
// 通用 AcroForm 模板填充器（ND4 / NDR1 / NSC1 / NN1 / NNC1 共用）
// 移植自 local-server/server.py:generate_template_pdf
// body: { template: 'ND4-template.pdf', fields: {'fill_1_P.1': 'v', ...}, checkboxes: ['cb_1_P.1', ...] }
// resp: { pdf: '<base64>' }

import { PDFDocument } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  fetchAndEmbedFont,
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const { user, errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      template?: string;
      fields?: Record<string, unknown>;
      checkboxes?: string[];
      brNumber?: string;
      removePages?: number[];  // 0-indexed page indices to delete (max→min is safest)
    };

    const template = data.template || "";
    // 安全校驗：只取文件名、必須 .pdf、不含路徑穿越
    if (!template.endsWith(".pdf") || template.includes("/") || template.includes("\\") || template.includes("..")) {
      return jsonResp({ error: "Invalid template name" }, 400);
    }

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) {
      return jsonResp({ error: "R2 bucket not available" }, 500);
    }

    const templateObj = await r2Bucket.get(template);
    if (!templateObj) return jsonResp({ error: `Template not found: ${template}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes);

    // 嵌入字體 (R2 → CDN → Helvetica fallback)
    const { cjk } = await fetchAndEmbedFont(pdfDoc, env as any);

    const form = pdfDoc.getForm();

    // 文本字段
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const tf = form.getTextField(name);
        tf.setText(value != null ? String(value) : "");
        if (cjk) tf.updateAppearances(cjk);
      } catch { /* 字段不存在或類型不符，跳過 */ }
    }

    // 勾選框
    for (const name of data.checkboxes || []) {
      try {
        form.getCheckBox(name).check();
      } catch { /* 跳過 */ }
    }

    form.flatten();

    // BR 號碼蓋印在所有頁面
    const brNumber = data.brNumber || "";
    if (brNumber) {
      const { StandardFonts } = await import("pdf-lib");
      const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
      }
    }

    // 移除指定頁面（倒序刪除以防索引偏移）
    const removePages = data.removePages || [];
    if (removePages.length > 0) {
      const sorted = [...removePages].sort((a, b) => b - a); // descending
      for (const idx of sorted) {
        if (idx >= 0 && idx < pdfDoc.getPageCount()) {
          pdfDoc.removePage(idx);
        }
      }
    }

    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("template-pdf generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
