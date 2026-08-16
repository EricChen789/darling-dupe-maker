// POST /api/generate-nn7-pdf
// 非香港公司更改秘書及董事詳情 —— 移植自 local-server/server.py:_fill_nd2b_pdf(template='NN7-template.pdf')
// body: { brNumber, companyName, role, identity, nameEnglish, nameChinese, idNumber,
//         changeType, newAddress, effectiveDate, signerName, signDate,
//         presentorName, presentorAddress, presentorContact }

import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  parseEnglishName, DEFAULT_PRESENTER
} from "./_pdf-utils";
import { enableNeedAppearances } from "./_acroform";
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

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer(), { ignoreEncryption: true });
    // Skip CJK font embedding — saves CPU for large templates (avoid error 1102)
    // (Helvetica embedding removed — unused, saves CPU)
    const form = pdfDoc.getForm();

    const setF = (name: string, value?: string, align?: 'left' | 'center' | 'right') => {
      if (value == null || value === "") return;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        // skip updateAppearances to save CPU for large templates
        if (align === 'right') {
          // 必须用 PDFNumber —— 直接塞原始数字会在 save() 序列化时炸
          // ("value.sizeInBytes is not a function")
          tf.acroField.dict.set(PDFName.of('Q'), PDFNumber.of(2));
        } else if (align === 'center') {
          tf.acroField.dict.set(PDFName.of('Q'), PDFNumber.of(1));
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
      setF("fill_7_P.1", (data.idNumber || '').replace(/[()\-\s]/g, '').toUpperCase().slice(0, 4), 'right');

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
    setF("fill_8_P.1", data.presentorName || DEFAULT_PRESENTER.name);
    setF("fill_9_P.1", data.presentorAddress || DEFAULT_PRESENTER.address);
    setF("fill_10_P.1", data.presentorContact || DEFAULT_PRESENTER.contact);

    // P.3 Signer
    setF("fill_30_P.3", data.signerName);
    setF("fill_31_P.3", data.signDate);

    // BR on all pages
    for (let pi = 2; pi <= pdfDoc.getPageCount(); pi++) {
      setF(`fill_1_P.${pi}`, br8);
    }

    // Don't flatten — saves CPU for large templates; NeedAppearances lets reader rebuild
    enableNeedAppearances(pdfDoc);
    // useObjectStreams: false saves significant CPU on large templates
    // updateFieldAppearances: false — 中文名会触发 WinAnsi encode 500（NN6 同款处理）
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("NN7 generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
