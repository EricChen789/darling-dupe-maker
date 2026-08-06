// POST /api/generate-nnc2-pdf
// NNC2 更改公司名稱通知書 — 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充 + Noto Sans TC CJK 字體
//   Key change: 不 flatten — 保留所有 widget annotations（蓝色可编辑框）
//   CJK fields get updateAppearances(cjk) for correct text rendering
//   ASCII fields get pdf-lib default AP generation during save

import { PDFDocument } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  fetchAndEmbedFont
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC2-template.pdf";

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
    };

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE_NAME);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

    // R2-first font loading — needed for CJK updateAppearances
    const { cjk } = await fetchAndEmbedFont(pdfDoc, env as any);

    const form = pdfDoc.getForm();

    // Fill text fields — setText + updateAppearances for CJK (text renders correctly)
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;
        const tf = form.getTextField(name);
        tf.setText(vstr);
        if (cjk) {
          const hasCjk = /[^\x00-\x7F]/.test(vstr);
          if (hasCjk) tf.updateAppearances(cjk);
        }
      } catch { /* field missing — skip */ }
    }

    // Check checkboxes
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // ⚠️ 不 flatten — 保留 widget annotations（蓝色可编辑框）
    //    pdf-lib save 会自动为非 CJK 字段生成 AP（ASCII 文字正确）
    //    CJK 字段的 AP 已由 updateAppearances(cjk) 生成（中文正确）
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
