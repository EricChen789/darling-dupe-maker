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

    // ═══ P.3 Share Capital Table (TOTAL post-allotment, Section 6) ═══
    // 1. Query existing share_capital from DB  2. Add new allotment  3. Single-currency → consolidate
    let totalShares = 0, totalPaid = 0, totalUnpaid = 0;
    let shareCapitalCurrency = 'HKD';
    const byClass: Record<string, {currency: string; shares: number; paid: number; unpaid: number}> = {};
    if (companyId && (env as any).DB) {
      try {
        const db = (env as any).DB as D1Database;
        // Get all share capital records
        const scRows = await db.prepare(
          "SELECT class_name, currency, COALESCE(total_number,0) as total_number, "
          + "COALESCE(total_amount,0) as total_amount, COALESCE(paid_up,0) as paid_up, "
          + "COALESCE(unpaid,0) as unpaid FROM share_capital WHERE company_id = ? ORDER BY class_name"
        ).bind(companyId).all();
        if (scRows.results && scRows.results.length > 0) {
          for (const sc of scRows.results as any[]) {
            const cls = (sc.class_name || sc.className || 'Ordinary').trim();
            const cur = (sc.currency || 'HKD').trim();
            if (!byClass[cls]) byClass[cls] = {currency: cur, shares: 0, paid: 0, unpaid: 0};
            byClass[cls].shares += Number(sc.total_number || sc.totalNumber || 0);
            byClass[cls].paid += Number(sc.total_amount || sc.totalAmount || 0);
            byClass[cls].unpaid += Number(sc.unpaid || 0);
          }
        } else {
          // Fall back to share_transactions
          const txRows = await db.prepare(
            "SELECT COALESCE(SUM(shares), 0) as total_shares, share_type, currency "
            + "FROM share_transactions WHERE company_id = ? GROUP BY share_type"
          ).bind(companyId).all();
          if (txRows.results && txRows.results.length > 0) {
            for (const tx of txRows.results as any[]) {
              const cls = (tx.share_type || tx.shareType || 'Ordinary').trim();
              const cur = (tx.currency || 'HKD').trim();
              if (!byClass[cls]) byClass[cls] = {currency: cur, shares: 0, paid: 0, unpaid: 0};
              byClass[cls].shares += Number(tx.total_shares || 0);
            }
          }
        }
        // Add new allotment to totals
        const newClass = (rget(data, 'shareClass') || rget(data, 'allotteeClass') || 'Ordinary').trim();
        const newShares = Number(rget(data, 'shares') || rget(data, 'allotteeShares') || 0);
        const newCurrency = (rget(data, 'currency') || 'HKD').trim();
        const newPaidPerShare = Number(rget(data, 'pricePerShare') || 0);
        if (!byClass[newClass]) byClass[newClass] = {currency: newCurrency, shares: 0, paid: 0, unpaid: 0};
        byClass[newClass].currency = byClass[newClass].currency || newCurrency;
        byClass[newClass].shares += newShares;
        byClass[newClass].paid += newShares * newPaidPerShare;
        // Fill P.3 table (3 rows max, 6 cols)
        const currencies = [...new Set(Object.values(byClass).map(v => v.currency).filter(Boolean))];
        if (currencies.length === 1 && Object.keys(byClass).length > 0) {
          // Single currency: consolidate all classes
          const allShares = Object.values(byClass).reduce((s, v) => s + v.shares, 0);
          const allPaid = Object.values(byClass).reduce((s, v) => s + v.paid, 0);
          const allUnpaid = Object.values(byClass).reduce((s, v) => s + v.unpaid, 0);
          fields['fill_2_P.3'] = '普通股 Ordinary';
          fields['fill_3_P.3'] = currencies[0] || 'HKD';
          fields['fill_4_P.3'] = String(allShares);
          if (allPaid > 0) fields['fill_5_P.3'] = allPaid.toFixed(2);
          fields['fill_6_P.3'] = allUnpaid > 0 ? allUnpaid.toFixed(2) : '0.00';
          totalShares = allShares; totalPaid = allPaid; totalUnpaid = allUnpaid;
        } else {
          let idx = 0;
          for (const [clsName, v] of Object.entries(byClass)) {
            if (idx >= 3) break;
            const base = 2 + idx * 6;
            fields[`fill_${base}_P.3`] = clsName;
            fields[`fill_${base+1}_P.3`] = v.currency || 'HKD';
            fields[`fill_${base+2}_P.3`] = String(v.shares);
            if (v.paid > 0) fields[`fill_${base+3}_P.3`] = v.paid.toFixed(2);
            fields[`fill_${base+4}_P.3`] = v.unpaid > 0 ? v.unpaid.toFixed(2) : '0.00';
            totalShares += v.shares; totalPaid += v.paid; totalUnpaid += v.unpaid;
            idx++;
          }
        }
      } catch { /* non-critical */ }
    }

    // ═══ P.7 Schedule 2: Allottee personal details ═══
    const allotteeName = rget(data, 'allotteeName') || '';
    const allotteeNameZh = rget(data, 'allotteeNameZh') || '';
    const allotteeAddress = rget(data, 'allotteeAddress') || '';
    const allotteeFlat = rget(data, 'allotteeFlat') || '';
    const allotteeBuilding = rget(data, 'allotteeBuilding') || '';
    const allotteeStreet = rget(data, 'allotteeStreet') || '';
    const allotteeDistrict = rget(data, 'allotteeDistrict') || '';
    const allotteeCountry = rget(data, 'allotteeCountry') || 'Hong Kong';
    // Allottees list (new structured format)
    const allotteesList: any[] = data.allottees || [];
    if ((allotteeName || allotteeNameZh) && allotteesList.length === 0) {
      allotteesList.push({nameEn: allotteeName, nameZh: allotteeNameZh, address: allotteeAddress});
    }
    const hasAllottees = allotteesList.length > 0 &&
      allotteesList.some((a: any) => (a.nameEn || a.nameZh || '').trim());

    if (hasAllottees) {
      // Structured allottees list (new format)
      const p7Specs1: [string, string][] = [
        ['fill_2_P.7', 'nameZh'], ['fill_3_P.7', 'nameEn'], ['fill_4_P.7', 'surname'],
        ['fill_5_P.7', 'otherNames'], ['fill_6_P.7', 'flat'], ['fill_7_P.7', 'building'],
        ['fill_8_P.7', 'street'], ['fill_9_P.7', 'district'], ['fill_10_P.7', 'postal'],
        ['fill_11_P.7', 'country'], ['fill_13_P.7', 'shares'],
      ];
      const p7Specs2: [string, string][] = [
        ['fill_15_P.7', 'nameZh'], ['fill_16_P.7', 'nameEn'], ['fill_17_P.7', 'surname'],
        ['fill_18_P.7', 'otherNames'], ['fill_19_P.7', 'flat'], ['fill_20_P.7', 'building'],
        ['fill_21_P.7', 'street'], ['fill_22_P.7', 'district'], ['fill_23_P.7', 'country'],
        ['fill_24_P.7', 'shares'],
      ];
      for (let i = 0; i < Math.min(allotteesList.length, 2); i++) {
        const specs = i === 0 ? p7Specs1 : p7Specs2;
        const a = allotteesList[i] || {};
        for (const [field, key] of specs) {
          const val = String(a[key] || '').trim();
          if (val) setIfEmpty(field, val);
        }
      }
    } else if (allotteeName || allotteeNameZh) {
      // Backward compatibility: flat allottee fields
      if (allotteeNameZh) setIfEmpty('fill_2_P.7', allotteeNameZh);
      if (allotteeName) setIfEmpty('fill_3_P.7', allotteeName);
      if (allotteeName && !allotteeNameZh) {
        const nameParts = allotteeName.trim().split(/\s+/);
        if (nameParts.length >= 2) {
          setIfEmpty('fill_4_P.7', nameParts[nameParts.length - 1]);
          setIfEmpty('fill_5_P.7', nameParts.slice(0, -1).join(' '));
        } else {
          setIfEmpty('fill_4_P.7', allotteeName);
        }
      }
      if (allotteeFlat) setIfEmpty('fill_6_P.7', allotteeFlat);
      if (allotteeBuilding) setIfEmpty('fill_7_P.7', allotteeBuilding);
      if (allotteeStreet) setIfEmpty('fill_8_P.7', allotteeStreet);
      if (allotteeDistrict) setIfEmpty('fill_9_P.7', allotteeDistrict);
      if (allotteeCountry) setIfEmpty('fill_11_P.7', allotteeCountry);
      if (allotteeAddress && !allotteeFlat) setIfEmpty('fill_6_P.7', allotteeAddress);
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

    // ═══ Non-cash consideration (P.1 + P.2 Section C) ═══
    const nonCash = !!(rget(data, 'nonCashConsideration'));
    if (nonCash) {
      try { form.getCheckBox('cb_2_P.1').check(); } catch { /* skip */ }  // P.1 non-cash indicator
      const nonCashTypes: string[] = data.nonCashTypes || [];
      const TYPE_TO_CB: Record<string, string> = {
        'division2_part13': 'cb_1_P.2',
        'credited_fully_paid': 'cb_2_P.2',
        'written_contract_s142': 'cb_3_P.2',
      };
      for (const t of nonCashTypes) {
        const cbName = TYPE_TO_CB[t];
        if (cbName) {
          try { form.getCheckBox(cbName).check(); } catch { /* skip */ }
        }
      }
      // Fill Section C details text area
      const nonCashDetails = rget(data, 'nonCashDetails') || '';
      if (nonCashDetails) {
        try {
          const tf = form.getTextField('fill_17_P.2');
          tf.setText(nonCashDetails);
          tf.updateAppearances(helv);
        } catch { /* skip */ }
      }
    }

    // P.2/P.3: Allottee details in Schedule 2
    if (hasAllottees) {
      try { form.getCheckBox('cb_4_P.3').check(); } catch { /* skip */ }  // P.2 bottom
      try { form.getCheckBox('cb_1_P.3').check(); } catch { /* skip */ }  // P.3 Section 5
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

    if (hasAllottees) {
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
