// POST /api/generate-irbr1-pdf
// IRBR1 致商業登記署通知書 — 申請公司註冊補充表格
// 1 page, 2 radio buttons (Yes/No)

import { PDFDocument } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "IRBR1-template.pdf";

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      irbr1_yes?: boolean;
    };

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE_NAME);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

    const form = pdfDoc.getForm();
    const irbr1Yes = data.irbr1_yes !== false; // default true (Yes)

    // Radio button group: topmostSubform[0].Page1[0].RadioButtonList[0]
    try {
      const radioGroup = form.getRadioGroup('topmostSubform[0].Page1[0].RadioButtonList[0]');
      // Try selecting by common export values
      const options = radioGroup.getOptions();
      if (options.length >= 2) {
        radioGroup.select(irbr1Yes ? options[0] : options[1]);
      }
    } catch (e) {
      console.warn("IRBR1 radio group selection error:", e);
    }

    // Flatten for clean output (1 page, cheap CPU)
    form.flatten();
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-irbr1-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
