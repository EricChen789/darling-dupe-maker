// POST /api/generate-template-pdf
// 通用 AcroForm 模板填充器（ND4 / NDR1 / NSC1 / NN1 / NNC1 共用）
// 移植自 local-server/server.py:generate_template_pdf
// body: { template: 'ND4-template.pdf', fields: {'fill_1_P.1': 'v', ...}, checkboxes: ['cb_1_P.1', ...] }
// resp: { pdf: '<base64>' }

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

const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

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
      template?: string;
      fields?: Record<string, unknown>;
      checkboxes?: string[];
    };

    const template = data.template || "";
    // 安全校验：只取文件名、必须 .pdf、不含路径穿越
    if (!template.endsWith(".pdf") || template.includes("/") || template.includes("\\") || template.includes("..")) {
      return jsonResp({ error: "Invalid template name" }, 400);
    }

    const [templateObj, fontResponse] = await Promise.all([
      env.PDF_TEMPLATES.get(template),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);
    if (!templateObj) return jsonResp({ error: `Template not found: ${template}` }, 404);

    const templateBytes = await templateObj.arrayBuffer();
    const pdfDoc = await PDFDocument.load(templateBytes);

    let customFont: any = undefined;
    if (fontResponse.ok) {
      pdfDoc.registerFontkit(fontkit);
      customFont = await pdfDoc.embedFont(await fontResponse.arrayBuffer());
    }

    const form = pdfDoc.getForm();

    // 文本字段
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const tf = form.getTextField(name);
        tf.setText(value != null ? String(value) : "");
        if (customFont) tf.updateAppearances(customFont);
      } catch { /* 字段不存在或类型不符，跳过 */ }
    }

    // 勾选框（通用端点用 check()，等价于 field_value = True）
    for (const name of data.checkboxes || []) {
      try {
        form.getCheckBox(name).check();
      } catch { /* 跳过 */ }
    }

    form.flatten();
    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("template-pdf generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
