// POST /api/generate-nnc2-pdf
// NNC2 更改公司名稱通知書 — 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
//   Strategy (学 IRBR2): acroField.setValue() 只设 /V，不重新生成外观
//   + save({ updateFieldAppearances: false }) 保留模板原始蓝色可编辑框
//   + 不 flatten — 保留所有 widget annotations

import { PDFDocument, PDFString } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";
import { enableNeedAppearances } from "./_acroform";

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

    const form = pdfDoc.getForm();

    // Fill text fields — acroField.setValue() 只设 /V，不重新生成外观，保留蓝框
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;
        form.getTextField(name).acroField.setValue(PDFString.of(vstr));
      } catch { /* field missing — skip */ }
    }

    // Check checkboxes — check() 设 /V=/On，配合 updateFieldAppearances:false 保留原始 ✓ 外观
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // NeedAppearances=true — 让 PDF 阅读器从 /V 重新生成外观
    // （蓝框来自 widget /MK /BG，文字来自 /V + /DA，两者都不依赖模板旧的 AP 流）
    enableNeedAppearances(pdfDoc);

    // Save — 不 flatten，updateFieldAppearances:false 保留模板原始蓝色可编辑框
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
