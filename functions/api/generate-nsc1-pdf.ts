// POST /api/generate-nsc1-pdf
// NSC1 — Return of Allotment (股份配發申報書)
//
// Uses CR source template (Testing - NSC1_fillable - new form .pdf) which has:
//   - Standard AcroForm fields with PMingLiU DA font
//   - Blue field backgrounds via MK/BG strategy (no custom AP stream needed)
//   - Checkbox names: "Check Box1_P.2", "Check Box2_P.2", "Check Box3_P.2", "Check Box4_P.3"
//   - Toggle names: "toggle_1_P.1", "toggle_2_P.1"
//   - Dropdown names: "Dropdown1_P.3", "Dropdown2_P.3"
//
// Template widget layout (from PyMuPDF extraction):
//   P.1 y=121  fill_1       = BR Number
//   P.1 y=171  fill_2       = Company Name
//   P.1 y=242  fill_3/4/5   = Return Date  D/M/Y
//   P.1 y=242  fill_6/7/8   = Allotment Date D/M/Y
//   P.1 y=312  toggle_1     = "share capital increased"
//   P.1 y=376  fill_9/10    = Sec.B Row1: Currency / Amount
//   P.1 y=400  fill_11/12   = Sec.B Row2: Currency / Amount
//   P.1 y=424  fill_13/14   = Sec.B Row3
//   P.1 y=454  toggle_2     = "not increased"
//   P.1 y=594  fill_15~19   = Sec.D Row1: Class/Currency/Number/Paid/Unpaid
//   P.1 y=617  fill_20~24   = Sec.D Row2
//   P.1 y=640  fill_25~29   = Sec.D Row3
//   P.1 y=678  fill_30~35   = Presenter: Name/Address/Phone/Fax/Email/Ref
//   P.2 y=173  fill_2~6     = Allottees Row1 (5 cols)
//   P.2 y=196  fill_7~11    = Allottees Row2
//   P.2 y=219  fill_12~16   = Allottees Row3
//   P.2 y=304  Check Box1   = "wholly for cash"
//   P.2 y=414  Check Box3   = "allottees in Schedule 2"
//   P.2 y=504  fill_17      = Large text area
//   P.3 y=514  Dropdown1    = Director (index 1 = cross out)
//   P.3 y=534  Dropdown2    = Company Secretary (index 0 = keep)

import { PDFDocument, PDFName, PDFString, PDFDict, rgb, StandardFonts } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  DEFAULT_PRESENTER
} from './_pdf-utils';
import { verifyAuthRequest, type Env } from './_auth';
import { enableNeedAppearances } from './_acroform';

// CR source template filename in R2
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

    // Embed Helvetica for drawText BR stamps
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

    // ── Schedule 2 (P.9-P.10) allottee data ──
    const allotteeName = rget(data, 'allotteeName') || '';
    const todayStr = new Date().toLocaleDateString('en-GB');
    if (allotteeName) {
      const allotDate = rget(data, 'allotmentDate') || todayStr;
      const [dd, mm, yyyy] = allotDate.split('/');
      if (dd) setIfEmpty('fill_1_P.9', dd);
      if (mm) setIfEmpty('fill_2_P.9', mm);
      if (yyyy) setIfEmpty('fill_3_P.9', yyyy);
      setIfEmpty('fill_4_P.9', brNumber);
      setIfEmpty('fill_7_P.9', allotteeName);
    }

    // ── Fill all text fields via standard pdf-lib API ──
    for (const [name, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
      } catch { /* field not in template */ }
    }

    // ═══ Blue editable fields — MK/BG strategy ═══
    // Set light blue background on all text widgets via MK dict + NeedAppearances.
    // The CR source template may already have blue fields; this is a safety net.
    // We only iterate text fields (skip dropdown/checkbox/radio) to minimize work.
    const BLUE_RGB = pdfDoc.context.obj([0.91, 0.93, 0.96]);
    const allFields = form.getFields();
    for (const field of allFields) {
      // Only patch text fields — skip dropdowns, checkboxes, radio buttons
      const acroField = (field as any).acroField;
      const ft = acroField?.dict?.get?.(PDFName.of('FT')) as any;
      const isText = ft === PDFName.of('Tx');
      if (!isText) continue;

      try {
        const widgets = acroField.getWidgets();
        for (const w of widgets) {
          try {
            const wDict = (w as any).dict;
            if (!wDict) continue;
            const mk = wDict.lookup(PDFName.of('MK'), PDFDict);
            if (mk) mk.set(PDFName.of('BG'), BLUE_RGB);
          } catch { /* widget not modifiable */ }
        }
      } catch { /* field not modifiable */ }
    }

    // Delete AP on dropdowns so viewers regenerate with correct /I index
    for (const field of allFields) {
      const acroField = (field as any).acroField;
      const ft = acroField?.dict?.get?.(PDFName.of('FT')) as any;
      if (ft !== PDFName.of('Ch')) continue;
      try {
        const widgets = acroField.getWidgets();
        for (const w of widgets) {
          try { (w as any).dict?.delete?.(PDFName.of('AP')); } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // ── Checkboxes ──
    // P.1: toggle_1 = share capital increased, toggle_2 = not increased
    // Use data.checkboxes array + also handle CR source naming (Check Box* / toggle_*)
    const checkboxes: string[] = data.checkboxes || [];
    // Map old cb_* names to CR source toggle_*/Check Box* names
    const cbAliases: Record<string, string> = {
      'cb_1_P.1': 'toggle_1_P.1',
      'cb_2_P.1': 'toggle_2_P.1',
      'cb_1_P.2': 'Check Box1_P.2',
      'cb_2_P.2': 'Check Box2_P.2',
      'cb_3_P.2': 'Check Box3_P.2',
      'cb_4_P.3': 'Check Box4_P.3',
    };
    for (const name of checkboxes) {
      const realName = cbAliases[name] || name;
      try { form.getCheckBox(realName).check(); } catch { /* skip */ }
    }

    // P.2: Mark as cash consideration + allottees in Schedule 2
    try { form.getCheckBox('Check Box1_P.2').check(); } catch { /* skip */ }
    try { form.getCheckBox('Check Box3_P.2').check(); } catch { /* skip */ }

    // P.3: Signature — Company Secretary signs (cross out Director)
    // Both dropdowns have options with export value 'Yes', distinguished by /I index
    // /I 0 = keep (blank display), /I 1 = cross out (strike-through line display)
    try {
      const dd1 = form.getDropdown('Dropdown1_P.3');  // Director → strike
      dd1.acroField.dict.set(PDFName.of('I'), pdfDoc.context.obj([1]));
      dd1.acroField.dict.set(PDFName.of('V'), PDFString.of('Yes'));
    } catch { /* skip */ }
    try {
      const dd2 = form.getDropdown('Dropdown2_P.3');  // Secretary → keep
      dd2.acroField.dict.set(PDFName.of('I'), pdfDoc.context.obj([0]));
      dd2.acroField.dict.set(PDFName.of('V'), PDFString.of('Yes'));
    } catch { /* skip */ }

    // P.3: Signature date — use caller-provided signDate, fallback to today
    const signDate = rget(data, 'signDate') || '';
    const finalSignDate = signDate || todayStr;
    try { form.getTextField('fill_28_P.3').setText(finalSignDate); } catch { /* skip */ }

    // P.3: Continuation sheets counter — leave blank

    // ── BR stamp on every page BEFORE page removal ──
    // MUST be done before removePage() — otherwise pdf-lib may not render drawText
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
        const pageIdx = parseInt(m[1]) - 1;
        if (pageIdx >= 0 && pageIdx < allPages.length) {
          keepPages.add(pageIdx);
        }
      }
    }
    // Also keep Schedule 2 pages if allottee data present (P.9-P.10 → index 8-9)
    if (allotteeName) {
      keepPages.add(8).add(9);
    }
    for (let i = allPages.length - 1; i >= 0; i--) {
      if (!keepPages.has(i)) {
        pdfDoc.removePage(i);
      }
    }

    enableNeedAppearances(pdfDoc);
    const pdfBytes = new Uint8Array(await pdfDoc.save({ updateFieldAppearances: false }));
    const filename = `NSC1_${brNumber || 'form'}.pdf`;

    return jsonResp({ pdf: uint8ToBase64(pdfBytes), filename });
  } catch (e: any) {
    console.error("NSC1 generation error:", e);
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}
