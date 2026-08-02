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

import { PDFDocument, PDFName, PDFString, rgb, StandardFonts } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  DEFAULT_PRESENTER
} from './_pdf-utils';
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

    // Embed fonts: Helvetica only (built-in, fast)
    // CJK rendering is left to the PDF reader via NeedAppearances + widget DA strings
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
      // Guard: don't set empty/whitespace values — they'd be skipped by the fill loop
      // and would prevent future calls (e.g. from DB lookup) from filling the field.
      if (!value || !value.trim()) return;
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

    // ── P.3: Signature — Company Secretary signs (cross out Director) ──
    // Both dropdowns have options with export value 'Yes', distinguished by /I index
    // /I 0 = keep (blank display), /I 1 = cross out (strike-through line display)
    // Low-level dict API required — pdf-lib select() can't disambiguate by index
    try {
      const dd1 = form.getDropdown('Dropdown1_P.3');  // Director
      dd1.acroField.dict.set(PDFName.of('I'), pdfDoc.context.obj([1])); // strike
      dd1.acroField.dict.set(PDFName.of('V'), PDFString.of('Yes'));
      const w1 = dd1.acroField.getWidgets();
      if (w1.length > 0) w1[0].dict.delete(PDFName.of('AP')); // force regen
    } catch { /* skip */ }
    try {
      const dd2 = form.getDropdown('Dropdown2_P.3');  // Secretary
      dd2.acroField.dict.set(PDFName.of('I'), pdfDoc.context.obj([0])); // keep
      dd2.acroField.dict.set(PDFName.of('V'), PDFString.of('Yes'));
      const w2 = dd2.acroField.getWidgets();
      if (w2.length > 0) w2[0].dict.delete(PDFName.of('AP')); // force regen
    } catch { /* skip */ }

    // P.3: Signature date — use caller-provided signDate, fallback to today
    const signDate = rget(data, 'signDate') || '';
    const todayStr = new Date().toLocaleDateString('en-GB');
    const finalSignDate = signDate || todayStr;
    try { form.getTextField('fill_28_P.3').setText(finalSignDate); } catch { /* skip */ }

    // P.3: Continuation sheets counter — leave blank (user: don't write 0)

    // ── Build blue field appearances via MK/BG + delete AP + NeedAppearances ──
    // Set MK/BG (light blue background) on ALL text field widgets, delete old AP stream,
    // enable NeedAppearances — the PDF reader regenerates appearances with blue bg.
    // This makes all editable fields visually blue, matching standard PDF form appearance.
    for (const field of form.getFields()) {
      const name = field.getName();
      // ── Text fields: set MK/BG blue + delete AP (ALL fields, not just filled ones) ──
      try {
        const tf = form.getTextField(name);
        const widgets = tf.acroField.getWidgets();
        for (const w of widgets) {
          try {
            // Set MK dict with BG (light blue background)
            w.dict.set(PDFName.of('MK'), pdfDoc.context.obj({ BG: [0.91, 0.93, 0.96] }));
            // Delete old AP so reader regenerates with our MK/BG color
            w.dict.delete(PDFName.of('AP'));
          } catch { /* skip unmodifiable widget */ }
        }
        continue;
      } catch {}
      // ── Checkboxes: delete old AP so NeedAppearances regenerates it correctly ──
      try {
        const cb = form.getCheckBox(name);
        const widgets = cb.acroField.getWidgets();
        for (const w of widgets) {
          try { w.dict.delete(PDFName.of('AP')); } catch { /* skip */ }
        }
        continue;
      } catch {}
    }
    // Enable NeedAppearances — reader will regenerate APs with our MK/BG blue backgrounds
    try {
      const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm')) as any;
      if (acroForm && typeof acroForm.set === 'function') {
        acroForm.set(PDFName.of('NeedAppearances'), PDFName.of('true'));
      }
    } catch { /* ignore */ }

    // ── BR stamp on every page BEFORE page removal ──
    // MUST be done before removePage() — otherwise pdf-lib may not render drawText
    // on remaining pages (matching proven pattern in NAR1 & ND4).
    if (brNumber) {
      for (const page of pdfDoc.getPages()) {
        try {
          page.drawText(brNumber, { x: 465, y: 828, size: 9, font: helv, color: rgb(0, 0, 0) });
        } catch { /* skip */ }
      }
    }

    // ── Page management: keep P.1-P.3 always, plus any pages referenced in fields ──
    const allPages = pdfDoc.getPages();
    const keepPages = new Set([0, 1, 2]);  // P.1, P.2, P.3 always kept
    for (const name of Object.keys(fields)) {
      const m = name.match(/_P\.?(\d+)$/);
      if (m) {
        const pageIdx = parseInt(m[1]) - 1;  // P.1 → index 0
        if (pageIdx >= 0 && pageIdx < allPages.length) {
          keepPages.add(pageIdx);
        }
      }
    }
    // Also keep Schedule 2 pages if allottee data present (P.9-P.10 → index 8-9)
    const allotteeName = rget(data, 'allotteeName') || '';
    if (allotteeName) {
      keepPages.add(8).add(9);  // P.9, P.10 = Schedule 2 (附表二)
    }
    for (let i = allPages.length - 1; i >= 0; i--) {
      if (!keepPages.has(i)) {
        pdfDoc.removePage(i);
      }
    }

    // ── Schedule 2 (P.9-P.10): allottee details (for QuickFormDialog simple case) ──
    // NSC1GeneratorForm sends these fields directly, this is the fallback auto-fill
    if (allotteeName) {
      const allotDate = rget(data, 'allotmentDate') || todayStr;
      const [dd, mm, yyyy] = allotDate.split('/');
      try { form.getTextField('fill_1_P.9').setText(dd || ''); } catch { /* skip */ }
      try { form.getTextField('fill_2_P.9').setText(mm || ''); } catch { /* skip */ }
      try { form.getTextField('fill_3_P.9').setText(yyyy || ''); } catch { /* skip */ }
      try { form.getTextField('fill_4_P.9').setText(brNumber); } catch { /* skip */ }
      try { form.getTextField('fill_7_P.9').setText(allotteeName); } catch { /* skip */ }
    }

    const pdfBytes = new Uint8Array(await pdfDoc.save());
    const filename = `NSC1_${brNumber || 'form'}.pdf`;

    return jsonResp({ pdf: uint8ToBase64(pdfBytes), filename });
  } catch (e: any) {
    console.error("NSC1 generation error:", e);
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}
