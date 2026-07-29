// POST /api/generate-nsc1-pdf
// NSC1 — Return of Allotment (股份配發申報書)
// Template fill with CJK font support, matching local Flask _fill_nsc1_pdf
// Accepts { company_id } for auto-populate, or { fields: {...}, checkboxes: [...] }

import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  fmtDate, buildAddress
} from './_pdf-utils';
import { enableNeedAppearances } from './_acroform';
import { verifyAuthRequest, type Env } from './_auth';

const TEMPLATE = "NSC1-template.pdf";

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
    // Skip CJK font embedding — saves CPU for large templates (avoid error 1102)
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const form = pdfDoc.getForm();

    // Auto-populate from DB if company_id provided
    let companyData: any = null;
    const companyId = rget(data, 'company_id') || rget(data, 'companyId');
    let brNumber = String(rget(data, 'brNumber') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);

    if (companyId && (env as any).DB) {
      try {
        const db = (env as any).DB as D1Database;
        const row = await db.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first();
        if (row) {
          companyData = row as any;
          if (!brNumber) {
            brNumber = String(companyData.company_number || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
          }
        }
      } catch { /* non-critical */ }
    }

    // Build fields
    const fields: Record<string, string> = {};

    // Use explicit fields dict if provided
    if (data.fields && typeof data.fields === 'object') {
      Object.assign(fields, data.fields);
    }

    // BR number on P.1
    fields['fill_1_P.1'] = fields['fill_1_P.1'] || brNumber;

    // Company name
    if (companyData) {
      fields['fill_2_P.1'] = fields['fill_2_P.1'] || companyData.name || '';
      fields['fill_3_P.1'] = fields['fill_3_P.1'] || companyData.chinese_name || '';
    }
    fields['fill_2_P.1'] = fields['fill_2_P.1'] || rget(data, 'companyName') || '';
    fields['fill_3_P.1'] = fields['fill_3_P.1'] || rget(data, 'companyChineseName') || '';

    // Allotment details — P.1 fields
    fields['fill_4_P.1'] = fields['fill_4_P.1'] || rget(data, 'allotmentDay') || '';
    fields['fill_5_P.1'] = fields['fill_5_P.1'] || rget(data, 'allotmentMonth') || '';
    fields['fill_6_P.1'] = fields['fill_6_P.1'] || rget(data, 'allotmentYear') || '';

    // Share class
    fields['fill_8_P.1'] = fields['fill_8_P.1'] || rget(data, 'shareClass') || '';

    // Number of shares allotted
    fields['fill_9_P.1'] = fields['fill_9_P.1'] || String(rget(data, 'sharesAllotted') || '');

    // Total shares after allotment
    fields['fill_10_P.1'] = fields['fill_10_P.1'] || String(rget(data, 'totalSharesAfter') || '');

    // Paid/unpaid amounts (P.2)
    fields['fill_11_P.2'] = fields['fill_11_P.2'] || String(rget(data, 'paidUpPerShare') || '');
    fields['fill_12_P.2'] = fields['fill_12_P.2'] || String(rget(data, 'totalPaidUp') || '');
    fields['fill_13_P.2'] = fields['fill_13_P.2'] || String(rget(data, 'totalUnpaid') || '');

    // Allottee names (P.2)
    fields['fill_14_P.2'] = fields['fill_14_P.2'] || rget(data, 'allottee1') || '';
    fields['fill_15_P.2'] = fields['fill_15_P.2'] || rget(data, 'allottee2') || '';
    fields['fill_16_P.2'] = fields['fill_16_P.2'] || rget(data, 'allottee3') || '';

    // Signer info
    fields['fill_17_P.1'] = fields['fill_17_P.1'] || rget(data, 'signerName') || '';
    fields['fill_18_P.1'] = fields['fill_18_P.1'] || String(rget(data, 'signDateDay') || '');
    fields['fill_19_P.1'] = fields['fill_19_P.1'] || String(rget(data, 'signDateMonth') || '');
    fields['fill_20_P.1'] = fields['fill_20_P.1'] || String(rget(data, 'signDateYear') || '');

    // Presenter
    fields['fill_21_P.1'] = fields['fill_21_P.1'] || rget(data, 'presentorName') || rget(data, 'presenterName') || '';
    fields['fill_22_P.1'] = fields['fill_22_P.1'] || rget(data, 'presentorAddress') || rget(data, 'presenterAddress') || '';
    fields['fill_23_P.1'] = fields['fill_23_P.1'] || rget(data, 'presentorContact') || rget(data, 'presenterContact') || '';

    // Fill all text fields (skip updateAppearances — saves CPU, reader rebuilds via NeedAppearances)
    for (const [name, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        // skip updateAppearances to save CPU for large templates
      } catch { /* field not in template */ }
    }

    // Checkboxes
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // Skip flatten() — saves CPU; enableNeedAppearances lets PDF reader rebuild
    enableNeedAppearances(pdfDoc);

    // BR stamp on all pages (Helvetica only for ASCII BR number)
    if (brNumber) {
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
      }
    }

    const pdfBytes = new Uint8Array(await pdfDoc.save());
    const filename = `NSC1_${brNumber || 'form'}.pdf`;

    return jsonResp({ pdf: uint8ToBase64(pdfBytes), filename });
  } catch (e: any) {
    console.error("NSC1 generation error:", e);
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}
