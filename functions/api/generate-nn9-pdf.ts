// POST /api/generate-nn9-pdf
// NN9 — Notice of Change of Address of Non-Hong Kong Company (非香港公司更改地址申報表)
// Template fill with CJK font support
// Accepts { fields: {...}, checkboxes: [...] } or semantic keys

import { PDFDocument } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  fetchAndEmbedFont
} from './_pdf-utils';
import { verifyAuthRequest, type Env } from './_auth';

const TEMPLATE = "NN9-template.pdf";

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const { user, errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as Record<string, any>;
    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) throw new Error("R2 bucket not available");

    const templateObj = await r2Bucket.get(TEMPLATE);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes);
    const { cjk } = await fetchAndEmbedFont(pdfDoc, env as any);
    const form = pdfDoc.getForm();

    const brNumber = String(rget(data, 'brNumber') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);

    // Collect fields
    const fields: Record<string, string> = {};
    if (data.fields && typeof data.fields === 'object') {
      Object.assign(fields, data.fields);
    }

    // BR number
    fields['fill_1_P.1'] = fields['fill_1_P.1'] || brNumber;

    // Company name
    fields['fill_2_P.1'] = fields['fill_2_P.1'] || rget(data, 'companyName') || rget(data, 'nameEnglish') || '';
    fields['fill_3_P.1'] = fields['fill_3_P.1'] || rget(data, 'companyChineseName') || rget(data, 'nameChinese') || '';

    // Old address
    fields['fill_4_P.1'] = fields['fill_4_P.1'] || rget(data, 'oldFlat') || '';
    fields['fill_5_P.1'] = fields['fill_5_P.1'] || rget(data, 'oldBuilding') || '';
    fields['fill_6_P.1'] = fields['fill_6_P.1'] || rget(data, 'oldStreet') || '';
    fields['fill_7_P.1'] = fields['fill_7_P.1'] || rget(data, 'oldDistrict') || '';

    // New address
    fields['fill_8_P.1'] = fields['fill_8_P.1'] || rget(data, 'newFlat') || rget(data, 'flat') || '';
    fields['fill_9_P.1'] = fields['fill_9_P.1'] || rget(data, 'newBuilding') || rget(data, 'building') || '';
    fields['fill_10_P.1'] = fields['fill_10_P.1'] || rget(data, 'newStreet') || rget(data, 'street') || '';
    fields['fill_11_P.1'] = fields['fill_11_P.1'] || rget(data, 'newDistrict') || rget(data, 'district') || '';

    // Change date
    const changeDate = rget(data, 'changeDate') || '';
    if (changeDate && changeDate.includes('/')) {
      const parts = String(changeDate).split('/');
      fields['fill_12_P.1'] = fields['fill_12_P.1'] || (parts[0] || '');
      fields['fill_13_P.1'] = fields['fill_13_P.1'] || (parts[1] || '');
      fields['fill_14_P.1'] = fields['fill_14_P.1'] || (parts[2] || '');
    }

    // Signer
    fields['fill_15_P.1'] = fields['fill_15_P.1'] || rget(data, 'signerName') || '';
    const signDate = rget(data, 'signDate') || '';
    if (signDate && signDate.includes('/')) {
      const parts = String(signDate).split('/');
      fields['fill_16_P.1'] = fields['fill_16_P.1'] || (parts[0] || '');
      fields['fill_17_P.1'] = fields['fill_17_P.1'] || (parts[1] || '');
      fields['fill_18_P.1'] = fields['fill_18_P.1'] || (parts[2] || '');
    }

    // Presenter
    fields['fill_19_P.1'] = fields['fill_19_P.1'] || rget(data, 'presentorName') || rget(data, 'presenterName') || '';
    fields['fill_20_P.1'] = fields['fill_20_P.1'] || rget(data, 'presentorAddress') || rget(data, 'presenterAddress') || '';
    fields['fill_21_P.1'] = fields['fill_21_P.1'] || rget(data, 'presentorContact') || rget(data, 'presenterContact') || '';

    // Fill all fields
    for (const [name, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        if (cjk) tf.updateAppearances(cjk);
      } catch { /* field not in template */ }
    }

    // Checkboxes
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    form.flatten();

    const pdfBytes = new Uint8Array(await pdfDoc.save());
    const filename = `NN9_${brNumber || 'form'}.pdf`;

    return jsonResp({ pdf: uint8ToBase64(pdfBytes), filename });
  } catch (e: any) {
    console.error("NN9 generation error:", e);
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}
