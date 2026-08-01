// POST /api/generate-nsc1-pdf
// NSC1 — Return of Allotment (股份配發申報書)
//
// Template widget layout (from PyMuPDF extraction):
//   P.1 y=121  fill_1       = BR Number
//   P.1 y=171  fill_2       = Company Name
//   P.1 y=242  fill_3/4/5   = Return Date  D/M/Y
//   P.1 y=242  fill_6/7/8   = Allotment Date D/M/Y
//   P.1 y=313  cb_1         = "share capital increased"
//   P.1 y=376  fill_9/10    = Sec.B Row1: Currency / Amount
//   P.1 y=400  fill_11/12   = Sec.B Row2: Currency / Amount
//   P.1 y=424  fill_13/14   = Sec.B Row3
//   P.1 y=456  cb_2         = "not increased"
//   P.1 y=594  fill_15~19   = Sec.D Row1: Class/Number/Paid/Unpaid/Total
//   P.1 y=617  fill_20~24   = Sec.D Row2
//   P.1 y=640  fill_25~29   = Sec.D Row3
//   P.1 y=678  fill_30~35   = Presenter: Name/Address/Phone/Fax/Email/Ref
//   P.2 y=173  fill_2~6     = Allottees Row1 (5 cols)
//   P.2 y=196  fill_7~11    = Allottees Row2
//   P.2 y=219  fill_12~16   = Allottees Row3
//   P.2 y=504  fill_17      = Large text area

import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  DEFAULT_PRESENTER
} from './_pdf-utils';
import { enableNeedAppearances } from './_acroform';
import { verifyAuthRequest, type Env } from './_auth';

const TEMPLATE = "NSC1-template.pdf";

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const form = pdfDoc.getForm();

    // ── BR number ──
    let brNumber = String(rget(data, 'brNumber') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);

    // ── Auto-populate company header from DB if company_id provided ──
    let companyName = '';
    const companyId = rget(data, 'company_id') || rget(data, 'companyId');
    if (companyId && (env as any).DB) {
      try {
        const db = (env as any).DB as D1Database;
        const row = await db.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first();
        if (row) {
          const c = row as any;
          if (!brNumber) {
            brNumber = String(c.company_number || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
          }
          companyName = c.name || '';
        }
      } catch { /* non-critical */ }
    }

    // ── Build fields from caller data ──
    const fields: Record<string, string> = {};

    // Merge explicit fields dict (from QuickFormDialog / API caller)
    if (data.fields && typeof data.fields === 'object') {
      Object.assign(fields, data.fields);
    }

    // Fill defaults for unfilled fields
    const setIfEmpty = (name: string, value: string) => {
      if (!fields[name] || !fields[name].trim()) fields[name] = value;
    };

    // Header — BR on every main page fill_1
    setIfEmpty('fill_1_P.1', brNumber);
    setIfEmpty('fill_1_P.2', brNumber);
    setIfEmpty('fill_1_P.3', brNumber);
    setIfEmpty('fill_2_P.1', companyName || rget(data, 'companyName') || '');

    // ── Presenter defaults (Twinsail) ──
    setIfEmpty('fill_30_P.1', rget(data, 'presentorName') || rget(data, 'presenterName') || DEFAULT_PRESENTER.name);
    setIfEmpty('fill_31_P.1', rget(data, 'presentorAddress') || rget(data, 'presenterAddress') || DEFAULT_PRESENTER.address);
    setIfEmpty('fill_32_P.1', rget(data, 'presentorPhone') || DEFAULT_PRESENTER.phone);
    setIfEmpty('fill_33_P.1', rget(data, 'presentorFax') || DEFAULT_PRESENTER.fax);
    setIfEmpty('fill_34_P.1', rget(data, 'presentorEmail') || DEFAULT_PRESENTER.email);
    setIfEmpty('fill_35_P.1', rget(data, 'presentorReference') || DEFAULT_PRESENTER.reference);

    // ── Fill all text fields ──
    for (const [name, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
      } catch { /* field not in template */ }
    }

    // ── Checkboxes ──
    for (const name of (data.checkboxes || [])) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // ── P.2: Mark as cash consideration ──
    try { form.getCheckBox('cb_1_P.2').check(); } catch { /* skip */ }
    // ── P.2 §5: 獲配發股份者的詳情列於附表二 / Details of Allottee(s) are listed in Schedule 2 ──
    try { form.getCheckBox('cb_3_P.2').check(); } catch { /* skip */ }

    // ── P.3: Signature — Company Secretary (cross out Director) ──
    // Dropdown1=Director, Dropdown2=Secretary; index 0=keep, index 1=cross out
    try {
      const dd1 = form.getDropdown('Dropdown1_P.3');
      dd1.select(['Yes']);  // Cross out Director
    } catch { /* skip */ }
    try {
      const dd2 = form.getDropdown('Dropdown2_P.3');
      // For pdf-lib, select the first option to keep Secretary
      const opts = dd2.getOptions();
      if (opts.length > 0) dd2.select(opts[0]);
    } catch { /* skip */ }

    // P.3: Signature date only (signer name left blank per user request)
    const todayStr = new Date().toLocaleDateString('en-GB');
    try { form.getTextField('fill_28_P.3').setText(todayStr); } catch { /* skip */ }

    // P.3: Continuation sheets counter — leave blank (user: don't write 0)

    // ── Enable NeedAppearances (reader rebuilds appearances, saves CPU) ──
    enableNeedAppearances(pdfDoc);

    // ── Page management: keep P.1-P.3 always; P.9-P.10 (Schedule 2) only if allottee data ──
    const allotteeName = rget(data, 'allotteeName') || '';
    const keepPages = new Set([0, 1, 2]);  // P.1, P.2, P.3
    if (allotteeName) {
      keepPages.add(8).add(9);  // P.9, P.10 = Schedule 2 (附表二)
    }
    const allPages = pdfDoc.getPages();
    for (let i = allPages.length - 1; i >= 0; i--) {
      if (!keepPages.has(i)) {
        pdfDoc.removePage(i);
      }
    }

    // ── Schedule 2 (now P.4, index 3): allottee details ──
    if (allotteeName) {
      const allotDate = rget(data, 'allotmentDate') || todayStr;
      const [dd, mm, yyyy] = allotDate.split('/');
      try { form.getTextField('fill_1_P.9').setText(dd || ''); } catch { /* skip */ }
      try { form.getTextField('fill_2_P.9').setText(mm || ''); } catch { /* skip */ }
      try { form.getTextField('fill_3_P.9').setText(yyyy || ''); } catch { /* skip */ }
      try { form.getTextField('fill_4_P.9').setText(brNumber); } catch { /* skip */ }
      // Allottee name
      try { form.getTextField('fill_7_P.9').setText(allotteeName); } catch { /* skip */ }
    }

    // ── BR stamp on remaining pages ──
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
