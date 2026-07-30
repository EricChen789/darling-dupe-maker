// POST /api/generate-nn1-pdf
// NN1 註冊非香港公司註冊申請書 — 專用端點（Phase 2.2）
// 使用 R2 模板 + _acroform.ts 底層 helpers（Helvetica-only，無 CJK 字體嵌入）
//
// ⚠️ CPU優化（2026-07-30）：去掉 fetchAndEmbedFont → 改用 _acroform.ts 底層 helpers
// 消除冷啟動 503（仿 NN6 Helvetica-only 模式）

import { PDFDocument } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";
import {
  createFormHelpers,
  rebuildAcroFormFields,
  enableNeedAppearances,
} from "./_acroform";

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

    // Use low-level AcroForm helpers (no CJK font embedding → no CPU timeout)
    const { setText, check } = createFormHelpers(pdfDoc);

    // 文本字段
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      if (value != null && String(value).length > 0) {
        setText(name, String(value));
      }
    }

    // 勾選框
    for (const name of data.checkboxes || []) {
      check(name, true);
    }

    // SKIP flatten() — NN1 template has 27 pages, flatten() exceeds Workers CPU budget
    rebuildAcroFormFields(pdfDoc);
    enableNeedAppearances(pdfDoc);

    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("NN1 generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
