// POST /api/generate-nn1-pdf
// NN1 註冊非香港公司註冊申請書 — 專用端點（Phase 2.2）
// 使用 R2 模板 + Noto Sans TC CJK 字體填充

import { PDFDocument } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  fetchAndEmbedFont
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NN1-template.pdf";

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
    };

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE_NAME);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

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
      try { form.getCheckBox(name).check(); } catch { /* 跳過 */ }
    }

    form.flatten();
    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("NN1 generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
