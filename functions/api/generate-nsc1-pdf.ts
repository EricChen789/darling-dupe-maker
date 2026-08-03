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

import { PDFDocument, PDFName, PDFString, PDFTextField, rgb, StandardFonts } from 'pdf-lib';
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

    // ── Fill all text fields (setText only — transparent APs built later) ──
    for (const [name, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        // Don't call updateAppearances here — it generates white-background APs
        // that cover table grid lines. We build transparent APs in post-processing.
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

    // P.3: Signature date (setText only — transparent APs built later)
    const signDate = rget(data, 'signDate') || '';
    const finalSignDate = signDate || todayStr;
    try {
      const tf = form.getTextField('fill_28_P.3');
      tf.setText(finalSignDate);
    } catch { /* skip */ }

    // ── Build transparent AP streams for all filled text fields ──
    // We build custom appearance streams WITHOUT any background fill rectangle.
    // This way the template's table grid lines show through the field widgets,
    // unlike pdf-lib's default updateAppearances() which paints a white background.
    buildTransparentAppearances(pdfDoc, helv);

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

// ═══ Build transparent AP streams for all filled text fields ═══
// Unlike pdf-lib's default updateAppearances() (which paints a white background
// rectangle), this builds appearance streams with NO background fill — so the
// template's table grid lines show through the field widgets.
// Call AFTER all setText() calls, BEFORE pdfDoc.save().
function buildTransparentAppearances(pdfDoc: PDFDocument, font: any) {
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  const fontRef = font.ref;

  for (const field of fields) {
    if (!(field instanceof PDFTextField)) continue;
    try {
      const value = String(field.getText() ?? '');
      if (!value) continue;

      const widgets = field.acroField.getWidgets();
      for (const widget of widgets) {
        try {
          const rect = widget.getRectangle();
          const w = rect.width;
          const h = rect.height;
          if (w <= 2 || h <= 2) continue;

          // Use font size from the field's DA string, default to 9pt
          const da = String(field.acroField.getDefaultAppearance() ?? '/Helv 9 Tf 0 g');
          const sizeMatch = da.match(/(\d+(?:\.\d+)?)\s+Tf/);
          const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 9;

          const textX = 2;
          const textY = Math.max(2, h * 0.15);

          // Escape PDF literal string special characters
          const escaped = String(value)
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/[\n\r\t]/g, ' ');

          // Content stream: text only, NO background fill rectangle
          const content = [
            '/Tx BMC',
            'BT',
            `/F1 ${fontSize} Tf`,
            '0 0 0 rg',
            `${textX.toFixed(1)} ${textY.toFixed(1)} Td`,
            `(${escaped}) Tj`,
            'ET',
            'EMC',
          ].join('\n');

          const contentBytes = new TextEncoder().encode(content);
          const streamDict = pdfDoc.context.obj({
            Type: PDFName.of('XObject'),
            Subtype: PDFName.of('Form'),
            FormType: 1,
            BBox: [0, 0, w, h],
            Resources: { Font: { F1: fontRef } },
          }) as any;
          const apStream = pdfDoc.context.stream(contentBytes, streamDict);

          // Set /AP /N on the widget
          const apDict = pdfDoc.context.obj({ N: apStream }) as any;
          widget.dict.set(PDFName.of('AP'), apDict);
        } catch { /* skip unmodifiable widget */ }
      }
    } catch { /* skip inaccessible field */ }
  }
}
