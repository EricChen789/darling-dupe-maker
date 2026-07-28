// POST /api/generate-nnc2-pdf
// NNC2 更改公司名稱通知書 — 專用端點（Phase 2.2）
// 使用 R2 模板 + Noto Sans TC CJK 字體填充

import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

interface Env {
  PDF_TEMPLATES: R2Bucket;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHINESE_FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2";
const TEMPLATE_NAME = "NNC2-template.pdf";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const data = await request.json() as {
      fields?: Record<string, unknown>;
      checkboxes?: string[];
    };

    const [templateObj, fontResponse] = await Promise.all([
      env.PDF_TEMPLATES.get(TEMPLATE_NAME),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

    const templateBytes = await templateObj.arrayBuffer();
    const pdfDoc = await PDFDocument.load(templateBytes);

    let customFont: any = undefined;
    if (fontResponse.ok) {
      pdfDoc.registerFontkit(fontkit);
      customFont = await pdfDoc.embedFont(await fontResponse.arrayBuffer());
    }

    const form = pdfDoc.getForm();

    // Text fields — CJK-aware via updateAppearances(customFont)
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const tf = form.getTextField(name);
        tf.setText(value != null ? String(value) : "");
        if (customFont) tf.updateAppearances(customFont);
      } catch { /* skip missing/incompatible fields */ }
    }

    // Checkboxes
    for (const name of data.checkboxes || []) {
      try {
        form.getCheckBox(name).check();
      } catch { /* skip */ }
    }

    // Don't flatten — keep widgets visible as blue boxes with readable CJK text
    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
