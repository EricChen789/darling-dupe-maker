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

    // ═══ Build blue-background appearance streams for ALL text widgets ═══
    // pdf-lib's setText() generates APs with WHITE background. We replace them
    // with APs that have LIGHT BLUE background — matching the standard CR form look.
    //
    // Strategy: ONE shared blue-only AP for empty widgets (no text),
    // individual APs for filled widgets (blue bg + text). This minimises CPU.
    const encoder = new TextEncoder();

    // ── Shared blue-background AP (for empty widgets) ──
    // BBox [0,0,1000,1000] — PDF maps this to the widget rect, so the blue
    // rectangle at (0,0)-(1000,1000) fills the entire widget area regardless of size.
    const sharedBlueAP = pdfDoc.context.stream(
      encoder.encode('/Tx BMC\nq\n0.91 0.93 0.96 rg\n0 0 1000 1000 re\nf\nQ\nEMC'),
      pdfDoc.context.obj({
        Type: PDFName.of('XObject'),
        Subtype: PDFName.of('Form'),
        FormType: 1,
        BBox: [0, 0, 1000, 1000],
      })
    );

    for (const field of form.getFields()) {
      // ── Text fields ──
      try {
        const tf = form.getTextField(field.getName());
        const value = (() => { try { return tf.getText() ?? ''; } catch { return ''; } })();
        const hasValue = value && String(value).trim();

        const widgets = tf.acroField.getWidgets();
        for (const w of widgets) {
          try {
            if (hasValue) {
              // ── Filled widget: create AP with blue bg + text ──
              const rect = w.getRectangle();
              const ww = rect.width;
              const wh = rect.height;
              if (ww <= 2 || wh <= 2) continue;

              const da = tf.acroField.getDefaultAppearance() ?? '/Helv 10 Tf 0 g';
              const sizeMatch = String(da).match(/(\d+(?:\.\d+)?)\s+Tf/);
              const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 10;
              const escaped = String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
              const textY = Math.max(2, wh * 0.15);

              const content = [
                '/Tx BMC',
                'q',
                '0.91 0.93 0.96 rg',
                `0 0 ${ww.toFixed(1)} ${wh.toFixed(1)} re`,
                'f',
                'Q',
                'BT',
                `/Helv ${fontSize} Tf`,
                '0 0 0 rg',
                `2 ${textY.toFixed(1)} Td`,
                `(${escaped}) Tj`,
                'ET',
                'EMC',
              ].join('\n');

              const streamDict = pdfDoc.context.obj({
                Type: PDFName.of('XObject'),
                Subtype: PDFName.of('Form'),
                FormType: 1,
                BBox: [0, 0, ww, wh],
                Resources: { Font: { Helv: helv.ref } },
              });
              const apStream = pdfDoc.context.stream(encoder.encode(content), streamDict);
              const apDict = pdfDoc.context.obj({ N: apStream });
              w.dict.set(PDFName.of('AP'), apDict);
            } else {
              // ── Empty widget: use shared blue AP ──
              const apDict = pdfDoc.context.obj({ N: sharedBlueAP });
              w.dict.set(PDFName.of('AP'), apDict);
            }
          } catch { /* skip unmodifiable widget */ }
        }
        continue;
      } catch {}
      // ── Checkboxes: delete old AP so NeedAppearances regenerates it ──
      try {
        const cb = form.getCheckBox(field.getName());
        const widgets = cb.acroField.getWidgets();
        for (const w of widgets) {
          try { w.dict.delete(PDFName.of('AP')); } catch { /* skip */ }
        }
        continue;
      } catch {}
    }
    // Set NeedAppearances so checkboxes regenerate correctly
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
