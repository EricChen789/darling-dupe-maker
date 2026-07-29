// POST /api/generate-nn7-pdf
// 非香港公司更改秘書及董事詳情 —— 移植自 local-server/server.py:_fill_nd2b_pdf(template='NN7-template.pdf')
// body: { brNumber, companyName, role, identity, nameEnglish, nameChinese, idNumber,
//         changeType, newAddress, effectiveDate, signerName, signDate,
//         presentorName, presentorAddress, presentorContact }

import { PDFDocument, PDFName } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  fetchAndEmbedFont, parseEnglishName
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE = "NN7-template.pdf";

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as Record<string, string>;

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE}` }, 404);

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer());
    const { cjk } = await fetchAndEmbedFont(pdfDoc, env as any);
    const form = pdfDoc.getForm();

    const setF = (name: string, value?: string, align?: 'left' | 'center' | 'right') => {
      if (value == null || value === "") return;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        // skip updateAppearances to save CPU for large templates
        if (align === 'right') {
          (tf as any).acroField?.dict?.set(PDFName.of('Q'), 2);
        } else if (align === 'center') {
          (tf as any).acroField?.dict?.set(PDFName.of('Q'), 1);
        }
      } catch { /* skip */ }
    };
    const checkF = (name: string) => {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    };

    const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

    // Parse English name
    const { surname, otherNames } = parseEnglishName(data.nameEnglish || "");

    setF("fill_1_P.1", br8);
    setF("fill_2_P.1", data.companyName);

    const isNatural = (data.identity || "natural") === "natural";
    const role = data.role;

    if (isNatural) {
      checkF(role === "secretary" ? "cb_1_P.1" : "cb_2_P.1");
      setF("fill_3_P.1", data.nameChinese);
      setF("fill_4_P.1", surname);
      setF("fill_5_P.1", otherNames);
      setF("fill_7_P.1", data.idNumber, 'right');

      // P.2 變更詳情
      if (data.changeType === "address" && data.newAddress) {
        setF("fill_19_P.2", data.newAddress);
      }

      // P.6 受保護資料
      checkF(role === "secretary" ? "cb_1_P.6" : "cb_2_P.6");
      setF("fill_2_P.6", data.nameChinese);
      setF("fill_3_P.6", surname);
      setF("fill_4_P.6", otherNames);
      setF("fill_9_P.6", data.newAddress);
    }

    // Presenter
    setF("fill_8_P.1", data.presentorName);
    setF("fill_9_P.1", data.presentorAddress);
    setF("fill_10_P.1", data.presentorContact);

    // P.3 Signer
    setF("fill_30_P.3", data.signerName);
    setF("fill_31_P.3", data.signDate);

    // BR on all pages
    for (let pi = 2; pi <= pdfDoc.getPageCount(); pi++) {
      setF(`fill_1_P.${pi}`, br8);
    }

    // Don't flatten — saves CPU for large templates
    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("NN7 generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
