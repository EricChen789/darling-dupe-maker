// POST /api/generate-nnc2-pdf
// NNC2 更改公司名稱通知書 — 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充 + Noto Sans TC CJK 字體
//   Strategy: setText() + updateAppearances(cjk) 确保 CJK 文字正确渲染
//   + /MK /BG 添加蓝色背景 + 不 flatten 保留可编辑框
//   + save({ updateFieldAppearances: false }) 保留自定义修改

import { PDFDocument, PDFName, PDFArray, PDFNumber } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  fetchAndEmbedFont
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC2-template.pdf";

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    // Embed fonts — Noto Sans TC for CJK rendering
    const { cjk } = await fetchAndEmbedFont(pdfDoc, env as any);

    const form = pdfDoc.getForm();

    // Fill text fields
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
      } catch { /* skip */ }
    }

    // Check checkboxes
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // Set blue background via /MK /BG on each text field widget
    // pdf-lib's generated AP doesn't draw a white background (uses clip path),
    // so /MK /BG should show through as blue editable box.
    const ctx = (pdfDoc as any).context;
    const blueBg = ctx.obj([0.91, 0.93, 0.96]);
    const allFields = form.getFields();
    for (const field of allFields) {
      try {
        const widgets = field.acroField.getWidgets();
        for (const w of widgets) {
          try {
            const mkDict = ctx.obj({ BG: blueBg });
            (w as any).dict.set(PDFName.of("MK"), mkDict);
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // Save — 不 flatten 保留 widgets, updateFieldAppearances:false 保留 /MK 修改
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
