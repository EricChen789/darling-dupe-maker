// POST /api/generate-nn3-pdf
// NN3 — Annual Return of Registered Non-Hong Kong Company (註冊非香港公司周年申報表)
// Template fill with CJK font support
// Accepts { fields: {...}, checkboxes: [...] } or semantic keys

import { PDFDocument } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
} from './_pdf-utils';
import { verifyAuthRequest, type Env } from './_auth';
import { enableNeedAppearances } from './_acroform';

const TEMPLATE = "NN3-template.pdf";

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
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    // NOTE: Intentionally skip fetchAndEmbedFont for NN3 — the template has many pages
    // and embedding WOFF2 font triggers error 1102 CPU timeout.
    // Form field text uses pdf-lib's default appearance stream; ASCII + dates + numbers render fine.
    const form = pdfDoc.getForm();

    const brNumber = String(rget(data, 'brNumber') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);

    // Collect all fields
    const fields: Record<string, string> = {};
    if (data.fields && typeof data.fields === 'object') {
      Object.assign(fields, data.fields);
    }

    // BR number
    fields['fill_1_P.1'] = fields['fill_1_P.1'] || brNumber;

    // Company name
    fields['fill_2_P.1'] = fields['fill_2_P.1'] || rget(data, 'companyName') || rget(data, 'nameEnglish') || '';
    fields['fill_3_P.1'] = fields['fill_3_P.1'] || rget(data, 'companyChineseName') || rget(data, 'nameChinese') || '';

    // Place of incorporation
    fields['fill_4_P.1'] = fields['fill_4_P.1'] || rget(data, 'placeOfIncorporation') || '';

    // Registered office address
    fields['fill_5_P.1'] = fields['fill_5_P.1'] || rget(data, 'flat') || rget(data, 'regFlat') || '';
    fields['fill_6_P.1'] = fields['fill_6_P.1'] || rget(data, 'building') || rget(data, 'regBuilding') || '';
    fields['fill_7_P.1'] = fields['fill_7_P.1'] || rget(data, 'street') || rget(data, 'regStreet') || '';
    fields['fill_8_P.1'] = fields['fill_8_P.1'] || rget(data, 'district') || rget(data, 'regDistrict') || '';
    fields['fill_9_P.1'] = fields['fill_9_P.1'] || rget(data, 'region') || rget(data, 'regRegion') || '';

    // Return period dates
    const returnDate = rget(data, 'returnDate') || '';
    if (returnDate) {
      const parts = String(returnDate).split('/');
      fields['fill_10_P.1'] = fields['fill_10_P.1'] || (parts[0] || '');
      fields['fill_11_P.1'] = fields['fill_11_P.1'] || (parts[1] || '');
      fields['fill_12_P.1'] = fields['fill_12_P.1'] || (parts[2] || '');
    }

    // Presenter
    fields['fill_13_P.1'] = fields['fill_13_P.1'] || rget(data, 'presentorName') || rget(data, 'presenterName') || '';
    fields['fill_14_P.1'] = fields['fill_14_P.1'] || rget(data, 'presentorAddress') || rget(data, 'presenterAddress') || '';
    fields['fill_15_P.1'] = fields['fill_15_P.1'] || rget(data, 'presentorContact') || rget(data, 'presenterContact') || '';

    // Fill all fields
    for (const [name, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
      } catch { /* field not in template */ }
    }

    // Checkboxes
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // SKIP flatten() — NN3 template has 20+ pages, flatten() exceeds Workers CPU budget
    // Instead set NeedAppearances=true so PDF viewers render form appearances on open
    enableNeedAppearances(pdfDoc);

    const pdfBytes = new Uint8Array(await pdfDoc.save());
    const filename = `NN3_${brNumber || 'form'}.pdf`;

    return jsonResp({ pdf: uint8ToBase64(pdfBytes), filename });
  } catch (e: any) {
    console.error("NN3 generation error:", e);
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}
