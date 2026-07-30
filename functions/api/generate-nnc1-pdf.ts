// POST /api/generate-nnc1-pdf
// NNC1 法團成立表格（股份有限公司）— 專用端點（Phase 2.2）
// 使用 R2 模板 + Noto Sans TC CJK 字體填充

import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
} from "./_pdf-utils";
import { enableNeedAppearances } from "./_acroform";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC1-template.pdf";

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
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    // Skip CJK font embedding — saves CPU for large templates (avoid error 1102)
    // (Helvetica is a StandardFont — embedding is a no-op, removed to save CPU)

    const form = pdfDoc.getForm();

    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const tf = form.getTextField(name);
        tf.setText(value != null ? String(value) : "");
        // skip updateAppearances to save CPU for large templates
      } catch { /* skip */ }
    }

    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // Skip flatten — saves CPU; NeedAppearances lets PDF reader rebuild
    enableNeedAppearances(pdfDoc);
    // useObjectStreams: false saves significant CPU on large templates (24-page NNC1)
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc1-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
