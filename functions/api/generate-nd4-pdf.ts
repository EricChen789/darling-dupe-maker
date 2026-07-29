// POST /api/generate-nd4-pdf
// ND4 — Notice of Resignation of Company Secretary and Director
// Template fill with CJK font support, matching local Flask _fill_nd4_pdf
// Accepts { fields: {...}, checkboxes: [...] } or semantic keys

import { PDFDocument } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  fetchAndEmbedFont
} from './_pdf-utils';
import { verifyAuthRequest, type Env } from './_auth';

const TEMPLATE = "ND4-template.pdf";

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as Record<string, any>;
    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes);
    const { cjk } = await fetchAndEmbedFont(pdfDoc, env as any);
    const form = pdfDoc.getForm();

    const brNumber = String(rget(data, 'brNumber') || rget(data, 'br_number') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
    const officerType = rget(data, 'officerType') || rget(data, 'officer_type') || 'director';
    const identity = rget(data, 'identity') || 'natural';

    // Build fields from payload
    const fields: Record<string, string> = {};
    if (data.fields && typeof data.fields === 'object') Object.assign(fields, data.fields);

    // BR stamp
    if (brNumber) fields['fill_1_P.1'] = brNumber;

    if (identity === 'natural') {
      fields['fill_3_P.1'] = fields['fill_3_P.1'] || rget(data, 'nameChinese') || '';
      fields['fill_4_P.1'] = fields['fill_4_P.1'] || rget(data, 'surname') || '';
      fields['fill_5_P.1'] = fields['fill_5_P.1'] || rget(data, 'otherNames') || '';
      fields['fill_6_P.1'] = fields['fill_6_P.1'] || rget(data, 'hkidPartial') || '';
      fields['fill_7_P.1'] = fields['fill_7_P.1'] || rget(data, 'passportCountry') || '';
      fields['fill_8_P.1'] = fields['fill_8_P.1'] || rget(data, 'passportPartial') || '';
    } else {
      fields['fill_9_P.1'] = fields['fill_9_P.1'] || rget(data, 'corporateName') || '';
      fields['fill_10_P.1'] = fields['fill_10_P.1'] || rget(data, 'corporateNumber') || '';
    }

    // Resignation date
    const rd = String(rget(data, 'resignationDay') || '');
    const rm = String(rget(data, 'resignationMonth') || '');
    const ry = String(rget(data, 'resignationYear') || '');
    if (rd) fields['fill_11_P.1'] = rd;
    if (rm) fields['fill_12_P.1'] = rm;
    if (ry) fields['fill_13_P.1'] = ry;

    // Signer
    const sn = rget(data, 'signerName');
    if (sn) fields['fill_14_P.1'] = sn;
    const sdd = String(rget(data, 'signDateDay') || '');
    const sdm = String(rget(data, 'signDateMonth') || '');
    const sdy = String(rget(data, 'signDateYear') || '');
    if (sdd) fields['fill_15_P.1'] = sdd;
    if (sdm) fields['fill_16_P.1'] = sdm;
    if (sdy) fields['fill_17_P.1'] = sdy;

    // Presenter
    const pn = rget(data, 'presentorName') || rget(data, 'presenterName');
    if (pn) fields['fill_18_P.1'] = pn;
    const pa = rget(data, 'presentorAddress') || rget(data, 'presenterAddress');
    if (pa) fields['fill_19_P.1'] = pa;
    const pp = rget(data, 'presentorPhone') || rget(data, 'presenterPhone') || rget(data, 'presentorContact');
    if (pp) fields['fill_20_P.1'] = pp;
    const pf = rget(data, 'presentorFax') || rget(data, 'presenterFax');
    if (pf) fields['fill_21_P.1'] = pf;
    const pe = rget(data, 'presentorEmail') || rget(data, 'presenterEmail');
    if (pe) fields['fill_22_P.1'] = pe;
    const pr = rget(data, 'presentorReference') || rget(data, 'presenterReference');
    if (pr) fields['fill_23_P.1'] = pr;

    // Fill text fields (only non-empty values)
    for (const [name, value] of Object.entries(fields)) {
      if (!value) continue;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        if (cjk) tf.updateAppearances(cjk);
      } catch { /* skip */ }
    }

    // Checkboxes
    const checkboxes: string[] = Array.isArray(data.checkboxes) ? [...data.checkboxes] : [];
    if (officerType === 'secretary') checkboxes.push('cb_1_P.1');
    else if (officerType === 'alternate' || officerType === 'reserve_director') checkboxes.push('cb_3_P.1');
    else checkboxes.push('cb_2_P.1'); // default: director

    for (const name of checkboxes) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    form.flatten();
    const pdfBytes = new Uint8Array(await pdfDoc.save());
    const filename = `ND4_${brNumber || 'form'}.pdf`;

    return jsonResp({ pdf: uint8ToBase64(pdfBytes), filename });
  } catch (e: any) {
    console.error("ND4 generation error:", e);
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}
