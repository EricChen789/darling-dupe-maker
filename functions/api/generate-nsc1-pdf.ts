// POST /api/generate-nsc1-pdf
// NSC1 — Return of Allotment (股份配發申報書)
//
// Template: NSC1_fillable.pdf (from 秘书系统文件/登记册/)
//   14 pages, 226 widgets, fill_N_P.X / cb_N_P.X / DropdownN_P.X naming
//
// Key pages (from Qwen VL analysis):
//   P.1: BR, Company Name, Return Date (D/M/Y), Allotment Date (D/M/Y),
//        Section B (2-col: Currency/Amount, rows 9-14),
//        Section D (5-col: Class/Currency/Number/Paid/Unpaid, rows 15-29),
//        Presenter (fill_30-35)
//   P.2: BR, Allottees 5-col table (fill_2-16, 3 rows),
//        4 checkboxes (cb_1-4), Details text area (fill_17)
//   P.3: BR, 2 checkboxes (cb_1-2), Share Capital 6-col table (fill_2-19, 3 rows),
//        Rights table (fill_20-21), Continuation counts (fill_22-26),
//        Signature name (fill_27), Dropdowns (Dropdown1/2), Date (fill_28)
//   P.4-P.8: Continuation pages (fill_1 only — BR)
//   P.9-P.10: Schedule 2 allottee details
//   P.11-P.14: Instructions (no widgets)

import { PDFDocument, PDFName, PDFString, rgb, StandardFonts } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  DEFAULT_PRESENTER
} from './_pdf-utils';
import { verifyAuthRequest, type Env } from './_auth';
import { enableNeedAppearances } from './_acroform';

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

    // ── Auto-populate company from DB ──
    let companyName = '';
    const companyId = rget(data, 'company_id') || rget(data, 'companyId');
    if (companyId && (env as any).DB) {
      try {
        const db = (env as any).DB as D1Database;
        const row = await db.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first();
        if (row) {
          const c = row as any;
          if (!brNumber) brNumber = String(c.company_number || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
          companyName = c.name || '';
        }
      } catch { /* non-critical */ }
    }

    // ── Build fields dict ──
    const fields: Record<string, string> = {};
    if (data.fields && typeof data.fields === 'object') Object.assign(fields, data.fields);

    const setIfEmpty = (name: string, value: string) => {
      if (!value || !value.trim()) return;
      if (!fields[name] || !fields[name].trim()) fields[name] = value;
    };

    const todayStr = new Date().toLocaleDateString('en-GB');

    // ── P.1 Header ──
    setIfEmpty('fill_1_P.1', brNumber);
    setIfEmpty('fill_2_P.1', companyName || rget(data, 'companyName') || '');

    // ── P.1 Presenter defaults (Twinsail) ──
    setIfEmpty('fill_30_P.1', rget(data, 'presentorName') || rget(data, 'presenterName') || DEFAULT_PRESENTER.name);
    setIfEmpty('fill_31_P.1', rget(data, 'presentorAddress') || rget(data, 'presenterAddress') || DEFAULT_PRESENTER.address);
    setIfEmpty('fill_32_P.1', rget(data, 'presentorPhone') || DEFAULT_PRESENTER.phone);
    setIfEmpty('fill_33_P.1', rget(data, 'presentorFax') || DEFAULT_PRESENTER.fax);
    setIfEmpty('fill_34_P.1', rget(data, 'presentorEmail') || DEFAULT_PRESENTER.email);
    setIfEmpty('fill_35_P.1', rget(data, 'presentorReference') || DEFAULT_PRESENTER.reference);

    // ── Schedule 2 (P.9-P.10) allottee data ──
    const allotteeName = rget(data, 'allotteeName') || '';
    if (allotteeName) {
      const allotDate = rget(data, 'allotmentDate') || todayStr;
      const [dd, mm, yyyy] = allotDate.split('/');
      if (dd) setIfEmpty('fill_2_P.9', dd);
      if (mm) setIfEmpty('fill_3_P.9', mm);
      if (yyyy) setIfEmpty('fill_4_P.9', yyyy);
      setIfEmpty('fill_5_P.9', brNumber);
      setIfEmpty('fill_8_P.9', allotteeName);
    }

    // ── Fill all text fields ──
    for (const [name, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        tf.updateAppearances(helv);
      } catch { /* field not in template */ }
    }

    // ── Checkboxes ──
    const checkboxes: string[] = data.checkboxes || [];
    // Map old alias names (from QuickFormDialog) to actual template field names
    const cbAliases: Record<string, string> = {
      'cb_1_P.1': 'cb_1_P.1',
      'cb_2_P.1': 'cb_2_P.1',
      'cb_1_P.2': 'cb_1_P.2',
      'cb_2_P.2': 'cb_2_P.2',
      'cb_3_P.2': 'cb_3_P.2',
      'cb_4_P.2': 'cb_4_P.3',  // Template quirk: cb_4 on P.2 is named _P.3
      'cb_1_P.3': 'cb_1_P.3',
      'cb_2_P.3': 'cb_2_P.3',
    };
    for (const name of checkboxes) {
      const realName = cbAliases[name] || name;
      try { form.getCheckBox(realName).check(); } catch { /* skip */ }
    }

    // P.2: Default — wholly for cash + allottees in Schedule 2
    try { form.getCheckBox('cb_1_P.2').check(); } catch { /* skip */ }
    try { form.getCheckBox('cb_3_P.2').check(); } catch { /* skip */ }

    // ── P.3 Signature ──
    // Director → index 1 (strike out), Secretary → index 0 (keep)
    try {
      const dd1 = form.getDropdown('Dropdown1_P.3');
      dd1.acroField.dict.set(PDFName.of('I'), pdfDoc.context.obj([1]));
      dd1.acroField.dict.set(PDFName.of('V'), PDFString.of('Yes'));
      const w1 = dd1.acroField.getWidgets();
      if (w1.length > 0) (w1[0] as any).dict?.delete?.(PDFName.of('AP'));
    } catch { /* skip */ }
    try {
      const dd2 = form.getDropdown('Dropdown2_P.3');
      dd2.acroField.dict.set(PDFName.of('I'), pdfDoc.context.obj([0]));
      dd2.acroField.dict.set(PDFName.of('V'), PDFString.of('Yes'));
      const w2 = dd2.acroField.getWidgets();
      if (w2.length > 0) (w2[0] as any).dict?.delete?.(PDFName.of('AP'));
    } catch { /* skip */ }

    // P.3: Signature date
    const signDate = rget(data, 'signDate') || '';
    const finalSignDate = signDate || todayStr;
    try {
      const tf = form.getTextField('fill_28_P.3');
      tf.setText(finalSignDate);
      tf.updateAppearances(helv);
    } catch { /* skip */ }

    // ── Strip white backgrounds from text-field appearance streams ──
    // pdf-lib's updateAppearances() generates APs with a white fill rectangle
    // (1 1 1 rg ... re f) that covers table grid lines underneath.
    // We strip that white fill so the template's table lines show through.
    stripWhiteBackgrounds(pdfDoc);

    // ── BR stamp on every page BEFORE page removal ──
    if (brNumber) {
      for (const page of pdfDoc.getPages()) {
        try {
          page.drawText(brNumber, { x: 465, y: 828, size: 9, font: helv, color: rgb(0, 0, 0) });
        } catch { /* skip */ }
      }
    }

    // ── Page management: keep P.1-P.3 always, plus Schedule 2 if allottee data ──
    const allPages = pdfDoc.getPages();
    const keepIndices = new Set([0, 1, 2]);  // P.1, P.2, P.3
    // Keep any pages referenced in fields dict
    for (const name of Object.keys(fields)) {
      const m = name.match(/_P\.?(\d+)$/);
      if (m) {
        const idx = parseInt(m[1]) - 1;
        if (idx >= 0 && idx < allPages.length) keepIndices.add(idx);
      }
    }
    if (allotteeName) {
      keepIndices.add(8).add(9);  // P.9, P.10
    }
    for (let i = allPages.length - 1; i >= 0; i--) {
      if (!keepIndices.has(i)) pdfDoc.removePage(i);
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

// ═══ Strip white background fill from text-field appearance streams ═══
// pdf-lib's updateAppearances() generates content streams like:
//   /Tx BMC q 1 1 1 rg 0 0 W H re f Q BT ... ET EMC
// The "1 1 1 rg ... re f" fills a white rectangle that covers table lines.
// We remove that fill operation so the template grid shows through.
function stripWhiteBackgrounds(pdfDoc: PDFDocument) {
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  // Regex to match the white-background fill block that pdf-lib generates
  // Pattern: q 1 1 1 rg 0 0 <number> <number> re f Q
  const whiteFillRe = /\nq\n1 1 1 rg\n0 0 [\d.]{1,6} [\d.]{1,6} re\nf\nQ\n/;

  for (const field of fields) {
    try {
      const widgets = field.acroField.getWidgets();
      for (const widget of widgets) {
        try {
          const apDict = widget.dict.get(PDFName.of('AP'));
          if (!apDict) continue;
          const nStream = (apDict as any).get?.(PDFName.of('N'));
          if (!nStream) continue;
          // Get the raw content bytes
          const contents = (nStream as any).contents;
          if (!contents || contents.length === 0) continue;
          // Try to decode and strip
          let contentStr: string;
          try {
            contentStr = new TextDecoder('utf-8').decode(contents);
          } catch {
            // If not UTF-8, try ASCII
            contentStr = String.fromCharCode(...Array.from(contents as Uint8Array));
          }
          if (!contentStr || contentStr.length < 30) continue;
          // Strip the white fill block
          const newContent = contentStr.replace(whiteFillRe, '\n');
          if (newContent !== contentStr) {
            const newBytes = new TextEncoder().encode(newContent);
            // Create a new content stream with the same dictionary
            const streamDict = (nStream as any).dict;
            const newStream = pdfDoc.context.stream(newBytes, streamDict);
            const newApDict = pdfDoc.context.obj({ N: newStream }) as any;
            widget.dict.set(PDFName.of('AP'), newApDict);
          }
        } catch { /* skip individual widget */ }
      }
    } catch { /* skip field */ }
  }
}
