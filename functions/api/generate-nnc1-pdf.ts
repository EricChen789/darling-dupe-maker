// POST /api/generate-nnc1-pdf
// NNC1 法團成立表格（股份有限公司）— 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
// CPU优化: enableNeedAppearances 替代逐字段 updateAppearances（24页模板）

import { PDFDocument } from "pdf-lib";
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
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      fields?: Record<string, unknown>;
      checkboxes?: string[];
      brNumber?: string;
      removePages?: number[];
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
      const { StandardFonts } = await import("pdf-lib");
      const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
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

    // ── enableNeedAppearances: tells PDF reader to render field appearances
    //    Much cheaper than per-field updateAppearances(cjkFont) for 24-page template ──
    enableNeedAppearances(pdfDoc);

    // ── Flatten & save ──
    form.flatten();
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc1-pdf error:", err?.message || err);
    return jsonResp({ error: err?.message || String(err) || "Internal server error" }, 500);
  }
}
