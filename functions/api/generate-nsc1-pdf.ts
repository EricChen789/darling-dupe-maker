// POST /api/generate-nsc1-pdf
// NSC1 — Return of Allotment (股份配發申報書)
//
// Template: NSC1_fillable.pdf (from 秘书系统文件/登记册/)
//   14 pages, 226 widgets, fill_N_P.X / cb_N_P.X / DropdownN_P.X naming
//
// Page structure (verified by Qwen VL 2026-08-04):
//   P.1: BR, Company Name, Allotment Date FROM/TO (D/M/Y),
//        cb_1 (share capital increased?), Section B (Currency|Amount, 3 rows),
//        cb_2 (no increase), Section D (Class|Currency|Number|Paid|Unpaid, 3 rows),
//        Presenter (fill_30-35)
//   P.2: BR, Allottees 5-col table (fill_2-16, 3 rows, for non-cash),
//        4 checkboxes (cb_1-4), Particulars text area (fill_17)
//   P.3: BR, 2 checkboxes (cb_1-2, allottee details location),
//        Share Capital table 6-col (fill_2-19, 3 rows) — TOTAL post-allotment,
//        Rights table (fill_20-21), Continuation counters (fill_22-26),
//        Signature name (fill_27), Dropdowns (Director/Secretary), Date (fill_28)
//   P.4-P.6: Continuation sheets (miscellaneous, rarely used)
//   P.7: Schedule 2 — Allottee personal details (name, address, shares, 2 allottees)
//   P.8: Continuation sheet (large text area)
//   P.9-P.10: Share Capital continuation (6-col table, 10 rows per page)
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
    let brNumber: string = String(rget(data, 'brNumber') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);

    // ── Auto-populate company from DB ──
    let companyName = '';
    let companyData: any = null;
    const companyId = rget(data, 'company_id') || rget(data, 'companyId');
    if (companyId && (env as any).DB) {
      try {
        const db = (env as any).DB as D1Database;
        const row = await db.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first();
        if (row) {
          const c = row as any;
          companyData = c;
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
    const allotDate = rget(data, 'allotmentDate') || todayStr;
    // Parse allotment date parts
    let allotDD = '', allotMM = '', allotYYYY = '';
    if (allotDate) {
      const parts = String(allotDate).split('/');
      allotDD = parts[0] || '';
      allotMM = parts[1] || '';
      allotYYYY = parts[2] || '';
    }

    // ═══ P.1 Header ═══
    // BR on always-kept pages P.1-P.3 (other pages filled after page management)
    setIfEmpty('fill_1_P.1', brNumber);
    setIfEmpty('fill_1_P.2', brNumber);
    setIfEmpty('fill_1_P.3', brNumber);
    setIfEmpty('fill_2_P.1', companyName || rget(data, 'companyName') || '');

    // P.1 Allotment Date Range: fill_3-5 = FROM (D/M/Y), fill_6-8 = TO (D/M/Y)
    // For a single-date allotment, FROM = TO = the allotment date
    setIfEmpty('fill_3_P.1', allotDD);
    setIfEmpty('fill_4_P.1', allotMM);
    setIfEmpty('fill_5_P.1', allotYYYY);
    setIfEmpty('fill_6_P.1', allotDD);
    setIfEmpty('fill_7_P.1', allotMM);
    setIfEmpty('fill_8_P.1', allotYYYY);

    // P.1 Section B: Total consideration by currency (3 rows: Currency | Amount)
    // Fill row 1 from data, leave rows 2-3 for multi-currency scenarios
    const secBCurrency = rget(data, 'sectionB_currency') || rget(data, 'currency') || 'HKD';
    const secBAmount = rget(data, 'sectionB_amount') || rget(data, 'totalConsideration') || '';
    setIfEmpty('fill_9_P.1', secBCurrency);
    if (secBAmount) setIfEmpty('fill_10_P.1', String(secBAmount));
    // Rows 2-3 are left for manual fill if multi-currency

    // P.1 Section D: New allotment details (3 rows × 5 cols: Class|Currency|Number|Paid|Unpaid)
    const shareClass = rget(data, 'shareClass') || rget(data, 'allotteeClass') || 'Ordinary';
    const shares = rget(data, 'shares') || rget(data, 'allotteeShares') || '';
    const pricePerShare = rget(data, 'pricePerShare') || '';
    const secDCurrency = rget(data, 'sectionD_currency') || rget(data, 'currency') || 'HKD';
    const unpaidPerShare = rget(data, 'unpaidPerShare') || '0.00';
    setIfEmpty('fill_15_P.1', shareClass);
    setIfEmpty('fill_16_P.1', secDCurrency);
    if (shares) setIfEmpty('fill_17_P.1', String(shares));
    if (pricePerShare) setIfEmpty('fill_18_P.1', String(pricePerShare));
    setIfEmpty('fill_19_P.1', String(unpaidPerShare));
    // Rows 2-3 (fill_20-29) left for multi-class scenarios

    // ═══ P.1 Presenter (Twinsail defaults) ═══
    setIfEmpty('fill_30_P.1', rget(data, 'presentorName') || rget(data, 'presenterName') || DEFAULT_PRESENTER.name);
    setIfEmpty('fill_31_P.1', rget(data, 'presentorAddress') || rget(data, 'presenterAddress') || DEFAULT_PRESENTER.address);
    setIfEmpty('fill_32_P.1', rget(data, 'presentorPhone') || DEFAULT_PRESENTER.phone);
    setIfEmpty('fill_33_P.1', rget(data, 'presentorFax') || DEFAULT_PRESENTER.fax);
    setIfEmpty('fill_34_P.1', rget(data, 'presentorEmail') || DEFAULT_PRESENTER.email);
    setIfEmpty('fill_35_P.1', rget(data, 'presentorReference') || DEFAULT_PRESENTER.reference);

    // ═══ P.3 Share Capital Table (TOTAL post-allotment) ═══
    // Query company share capital from DB
    let totalShares = 0, totalPaid = 0, totalUnpaid = 0;
    let shareCapitalCurrency = 'HKD';
    if (companyId && (env as any).DB) {
      try {
        const db = (env as any).DB as D1Database;
        // Get all share capital records for this company
        const scRows = await db.prepare(
          "SELECT * FROM share_capital WHERE company_id = ? ORDER BY class_name"
        ).bind(companyId).all();
        if (scRows.results && scRows.results.length > 0) {
          // Fill P.3 share capital table from DB (up to 3 rows)
          for (let i = 0; i < Math.min(scRows.results.length, 3); i++) {
            const sc = scRows.results[i] as any;
            const base = 2 + i * 6; // fill_2, fill_8, fill_14
            fields[`fill_${base}_P.3`] = sc.class_name || sc.className || '';
            fields[`fill_${base+1}_P.3`] = sc.currency || shareCapitalCurrency;
            fields[`fill_${base+2}_P.3`] = String(sc.total_number || sc.totalNumber || '');
            fields[`fill_${base+3}_P.3`] = String(sc.total_amount || sc.totalAmount || '');
            fields[`fill_${base+4}_P.3`] = String(sc.paid_up || sc.paidUp || '');
            fields[`fill_${base+5}_P.3`] = String(sc.unpaid || '0');
            totalShares += Number(sc.total_number || sc.totalNumber || 0);
            totalPaid += Number(sc.paid_up || sc.paidUp || 0);
            totalUnpaid += Number(sc.unpaid || 0);
          }
        } else {
          // No share_capital table — compute from share_transactions
          const txRows = await db.prepare(
            "SELECT COALESCE(SUM(shares), 0) as total_shares, share_type, currency FROM share_transactions WHERE company_id = ? GROUP BY share_type"
          ).bind(companyId).all();
          if (txRows.results && txRows.results.length > 0) {
            for (let i = 0; i < Math.min(txRows.results.length, 3); i++) {
              const tx = txRows.results[i] as any;
              const base = 2 + i * 6;
              fields[`fill_${base}_P.3`] = tx.share_type || tx.shareType || 'Ordinary';
              fields[`fill_${base+1}_P.3`] = tx.currency || 'HKD';
              fields[`fill_${base+2}_P.3`] = String(tx.total_shares || '');
              fields[`fill_${base+3}_P.3`] = ''; // total amount unknown
              fields[`fill_${base+4}_P.3`] = ''; // paid unknown
              fields[`fill_${base+5}_P.3`] = '';
              totalShares += Number(tx.total_shares || 0);
            }
          }
        }
      } catch { /* non-critical */ }
    }

    // ═══ P.7 Schedule 2: Allottee personal details ═══
    const allotteeName = rget(data, 'allotteeName') || '';
    const allotteeNameZh = rget(data, 'allotteeNameZh') || '';
    // Allottee address: accept flat format or structured
    const allotteeAddress = rget(data, 'allotteeAddress') || '';
    const allotteeFlat = rget(data, 'allotteeFlat') || '';
    const allotteeBuilding = rget(data, 'allotteeBuilding') || '';
    const allotteeStreet = rget(data, 'allotteeStreet') || '';
    const allotteeDistrict = rget(data, 'allotteeDistrict') || '';
    const allotteeCountry = rget(data, 'allotteeCountry') || 'Hong Kong';

    if (allotteeName || allotteeNameZh) {
      // Allottee 1: fill_2=Chinese name, fill_3=English name
      if (allotteeNameZh) setIfEmpty('fill_2_P.7', allotteeNameZh);
      if (allotteeName) setIfEmpty('fill_3_P.7', allotteeName);
      // Parse English name into surname/other names
      if (allotteeName && !allotteeNameZh) {
        const nameParts = allotteeName.trim().split(/\s+/);
        if (nameParts.length >= 2) {
          setIfEmpty('fill_4_P.7', nameParts[nameParts.length - 1]); // surname = last word
          setIfEmpty('fill_5_P.7', nameParts.slice(0, -1).join(' ')); // other names
        } else {
          setIfEmpty('fill_4_P.7', allotteeName);
        }
      }
      // Address: fill_6-11 (flat/building/street/district/postal/country)
      if (allotteeFlat) setIfEmpty('fill_6_P.7', allotteeFlat);
      if (allotteeBuilding) setIfEmpty('fill_7_P.7', allotteeBuilding);
      if (allotteeStreet) setIfEmpty('fill_8_P.7', allotteeStreet);
      if (allotteeDistrict) setIfEmpty('fill_9_P.7', allotteeDistrict);
      if (allotteeCountry) setIfEmpty('fill_11_P.7', allotteeCountry);
      // If flat address provided, use it as primary
      if (allotteeAddress && !allotteeFlat) setIfEmpty('fill_6_P.7', allotteeAddress);
      // Shares allotted
      if (shares) setIfEmpty('fill_13_P.7', String(shares));
    }

    // ═══ Fill all text fields from fields dict ═══
    for (const [name, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        tf.updateAppearances(helv);
      } catch { /* field not in template */ }
    }

    // ═══ Checkboxes ═══
    const checkboxes: string[] = data.checkboxes || [];
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

    // P.1: cb_1 = share capital increased → check for normal allotment
    try { form.getCheckBox('cb_1_P.1').check(); } catch { /* skip */ }

    // P.2: Default — wholly for cash (cb_1) + allottees in Schedule 2 (cb_3)
    try { form.getCheckBox('cb_1_P.2').check(); } catch { /* skip */ }
    try { form.getCheckBox('cb_3_P.2').check(); } catch { /* skip */ }

    // P.3: cb_1 = allottee details in Schedule 2 (paper)
    if (allotteeName || allotteeNameZh) {
      try { form.getCheckBox('cb_1_P.3').check(); } catch { /* skip */ }
    }

    // ═══ P.3 Signature: Director crossed out (index 1), Secretary kept (index 0) ═══
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
    try {
      const tf = form.getTextField('fill_28_P.3');
      tf.setText(signDate || todayStr);
      tf.updateAppearances(helv);
    } catch { /* skip */ }

    // ═══ Strip white backgrounds from AP streams ═══
    stripWhiteBackgrounds(pdfDoc);

    // ═══ Page management ═══
    // Keep: P.1-P.3 always, P.7 if allottee data, P.9-P.10 if share capital >3 classes
    const allPages = pdfDoc.getPages();
    const keepIndices = new Set([0, 1, 2]);  // P.1, P.2, P.3

    if (allotteeName || allotteeNameZh) {
      keepIndices.add(6);  // P.7 = Schedule 2 allottee details
    }

    // Keep pages referenced in fields dict (beyond P.3)
    for (const name of Object.keys(fields)) {
      const m = name.match(/_P\.?(\d+)$/);
      if (m) {
        const idx = parseInt(m[1]) - 1;
        if (idx >= 3 && idx < allPages.length) keepIndices.add(idx);
      }
    }

    // Delete pages from end to keep indices stable
    for (let i = allPages.length - 1; i >= 0; i--) {
      if (!keepIndices.has(i)) pdfDoc.removePage(i);
    }

    // ── BR on remaining pages (P.7+) via direct widget fill ──
    if (brNumber) {
      const remainingPages = pdfDoc.getPages();
      for (let i = 3; i < remainingPages.length; i++) {
        const pageNo = i + 1;
        try {
          const tf = form.getTextField(`fill_1_P.${pageNo}`);
          tf.setText(brNumber);
          tf.updateAppearances(helv);
        } catch { /* skip if field doesn't exist on this page */ }
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

// ═══ Strip white background fill from text-field appearance streams ═══
function stripWhiteBackgrounds(pdfDoc: PDFDocument) {
  const form = pdfDoc.getForm();
  const fields = form.getFields();
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
          const contents = (nStream as any).contents;
          if (!contents || contents.length === 0) continue;
          let contentStr: string;
          try {
            contentStr = new TextDecoder('utf-8').decode(contents);
          } catch {
            contentStr = String.fromCharCode(...Array.from(contents as Uint8Array));
          }
          if (!contentStr || contentStr.length < 30) continue;
          const newContent = contentStr.replace(whiteFillRe, '\n');
          if (newContent !== contentStr) {
            const newBytes = new TextEncoder().encode(newContent);
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
