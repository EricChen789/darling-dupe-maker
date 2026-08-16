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
import {
  createFormHelpers, decodePdfText, enableNeedAppearances, rebuildAcroFormFields
} from './_acroform';

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
          const allTotal = allPaid + allUnpaid;
          fields['fill_2_P.3'] = '普通股 Ordinary';
          fields['fill_3_P.3'] = currencies[0] || 'HKD';
          fields['fill_4_P.3'] = String(allShares);
          if (allPaid > 0) fields['fill_5_P.3'] = allPaid.toFixed(2);
          fields['fill_6_P.3'] = allUnpaid > 0 ? allUnpaid.toFixed(2) : '0.00';
          fields['fill_7_P.3'] = allTotal.toFixed(2);
          totalShares = allShares; totalPaid = allPaid; totalUnpaid = allUnpaid;
        } else {
          let idx = 0;
          for (const [clsName, v] of Object.entries(byClass)) {
            if (idx >= 3) break;
            const base = 2 + idx * 6;
            const total = v.paid + v.unpaid;
            fields[`fill_${base}_P.3`] = clsName;
            fields[`fill_${base+1}_P.3`] = v.currency || 'HKD';
            fields[`fill_${base+2}_P.3`] = String(v.shares);
            if (v.paid > 0) fields[`fill_${base+3}_P.3`] = v.paid.toFixed(2);
            fields[`fill_${base+4}_P.3`] = v.unpaid > 0 ? v.unpaid.toFixed(2) : '0.00';
            fields[`fill_${base+5}_P.3`] = total.toFixed(2);
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

    // P.7 顶部总表：股份類別 Class of Shares + 配發此類別股份的總數 Total Shares Allotted
    // （2026-08-16 用户要求：这两个字段此前从未填入）
    const sched2ClassRaw = String(shareClass || '').trim();
    const sched2Class = (!sched2ClassRaw || /^ordinary$/i.test(sched2ClassRaw) ||
      sched2ClassRaw === '普通股' || sched2ClassRaw === '普通')
      ? '普通股 Ordinary' : sched2ClassRaw;
    const allotteeSharesSum = allotteesList.reduce((s, a) => s + (Number(a?.shares) || 0), 0);
    const sched2TotalShares = allotteeSharesSum > 0 ? allotteeSharesSum : (Number(shares) || 0);

    if (hasAllottees) {
      // Structured allottees list (new format)
      // P.7 widget layout (verified by Qwen VL + PyMuPDF text labels 2026-08-04):
      //   Allottee 1: fill_4=nameZh, fill_5=surname, fill_6=otherNames,
      //               fill_8=flat, fill_9=building, fill_10=street, fill_11=district, fill_12=country,
      //               fill_13=shares, cb_1=jointlyHeld
      //   Allottee 2: fill_15=nameZh, fill_16=surname, fill_17=otherNames,
      //               fill_19=flat, fill_20=building, fill_21=street, fill_22=district, fill_23=country,
      //               fill_24=shares, cb_2=jointlyHeld
      //   Note: fill_2/3 are section-level (filled below), fill_7/18 "英文名稱" removed per user request
      //   Each P.7 page fits 2 allottees; >2 → dynamic continuation pages (see page management)
      for (let i = 0; i < Math.min(allotteesList.length, 2); i++) {
        const specs = i === 0 ? P7_SPECS_1 : P7_SPECS_2;
        const merged = buildAllotteeMerged(allotteesList[i] || {});
        for (const [field, key] of specs) {
          const val = merged[key] || '';
          if (val) setIfEmpty(field, val);
        }
        // Jointly held checkbox
        if (allotteesList[i]?.jointlyHeld) {
          const cbName = i === 0 ? 'cb_1_P.7' : 'cb_2_P.7';
          try { form.getCheckBox(cbName).check(); } catch { /* skip */ }
        }
      }
      // P.7 顶部总表：股份類別 + 配發此類別股份的總數（2026-08-16）
      setIfEmpty('fill_2_P.7', sched2Class);
      if (sched2TotalShares > 0) setIfEmpty('fill_3_P.7', String(sched2TotalShares));
      // P.7 bottom page counter: "附表二第 _ 頁 Schedule 2 Page _"（页码语义，非总数）
      // Each P.7 fits 2 allottees → pages = ceil(allotteesCount / 2)；原页固定第 1 頁，续页 k+1
      const sched2Pages = Math.max(1, Math.ceil(allotteesList.length / 2));
      try {
        const tf26 = form.getTextField('fill_26_P.7');
        tf26.setText('1');
        tf26.updateAppearances(helv);
      } catch { /* skip */ }
      try {
        const tf27 = form.getTextField('fill_27_P.7');
        tf27.setText('1');
        tf27.updateAppearances(helv);
      } catch { /* skip */ }
    } else if (allotteeName || allotteeNameZh) {
      // Backward compatibility: flat allottee fields
      if (allotteeNameZh) setIfEmpty('fill_4_P.7', allotteeNameZh);
      if (allotteeName) {
        const nameParts = allotteeName.trim().split(/\s+/);
        if (nameParts.length >= 2) {
          setIfEmpty('fill_5_P.7', nameParts[0]);  // HK: first word = surname
          setIfEmpty('fill_6_P.7', nameParts.slice(1).join(' '));
        } else {
          setIfEmpty('fill_5_P.7', allotteeName);
        }
      }
      if (allotteeFlat) setIfEmpty('fill_8_P.7', allotteeFlat);
      if (allotteeBuilding) setIfEmpty('fill_9_P.7', allotteeBuilding);
      if (allotteeStreet) setIfEmpty('fill_10_P.7', allotteeStreet);
      if (allotteeDistrict) setIfEmpty('fill_11_P.7', allotteeDistrict);
      if (allotteeCountry) setIfEmpty('fill_12_P.7', allotteeCountry);
      if (allotteeAddress && !allotteeFlat) setIfEmpty('fill_8_P.7', allotteeAddress);
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
      // P.3 continuation counters: fill_26 = Schedule 2 page count
      // (verified by Qwen VL: 5 boxes = A/B/C/Schedule1/Schedule2, fill_26 is rightmost)
      const sched2Pages = Math.max(1, Math.ceil(allotteesList.length / 2));
      try {
        const tf = form.getTextField('fill_26_P.3');
        tf.setText(String(sched2Pages));
        tf.updateAppearances(helv);
      } catch { /* skip */ }
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
    // ⚠ fill_1_* 是 BR-only 键（NSC1GeneratorForm 每页都传），不构成保留依据，
    //   否则 P.4-P.10 空白续页全被保留。BR 由下方 remaining pages 循环统一补填。
    for (const name of Object.keys(fields)) {
      if (name.startsWith('fill_1_P.')) continue;
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

    // ═══ Schedule 2 动态续页：获配人 >2 时复制 P.7（每页 2 人）═══
    // 2026-08-16：用户要求「多名股东就要加附表二」。模式借鉴 ND2A 动态续页：
    //   - 复制页插到 P.7 之后（删页后 P.7 新位置 = 原 6 号页之前保留的页数）
    //   - ⚠ 每页单独 copyPages（同源多副本一次调用会共享 widget 对象，改名互相覆盖）
    //   - renameDynamicWidgets：复制页 widget /T 加后缀（_S1/_S2…）、继承 FT/DA/Ff/Q/
    //     DV/Opt/MaxLen、删 Parent；填完后 rebuildAcroFormFields 重建 /Fields
    //   - 顶部 Class/Total、BR、底部计数器（附表二第 _ 頁 / Schedule 2 Page _）每页相同
    const sched2PageCount = Math.max(1, Math.ceil(allotteesList.length / 2));
    if (hasAllottees && sched2PageCount > 1) {
      const p7NewIndex = [...keepIndices].filter((i) => i < 6).length;
      const freshDoc = await PDFDocument.load(templateBytes);
      for (let k = 1; k < sched2PageCount; k++) {
        const [pg] = await pdfDoc.copyPages(freshDoc, [6]);
        pdfDoc.insertPage(p7NewIndex + k, pg);
        renameDynamicWidgets(pdfDoc, pg, `S${k}`);  // 函数内拼 `${fullName}_${suffix}`，勿带下划线
      }
      rebuildAcroFormFields(pdfDoc);

      // 动态页填充走 createFormHelpers（静态填充用的 pdf-lib form API 缓存
      // 不含改名后的新字段）
      const h = createFormHelpers(pdfDoc);
      for (let k = 1; k < sched2PageCount; k++) {
        const sfx = `_S${k}`;
        h.setText(`fill_1_P.7${sfx}`, brNumber);  // BR（每页右上角）
        h.setText(`fill_2_P.7${sfx}`, sched2Class);
        if (sched2TotalShares > 0) h.setText(`fill_3_P.7${sfx}`, String(sched2TotalShares));
        h.setText(`fill_26_P.7${sfx}`, String(k + 1));  // 附表二第 _ 頁（页码）
        h.setText(`fill_27_P.7${sfx}`, String(k + 1));  // Schedule 2 Page _（页码）
        for (let slot = 0; slot < 2; slot++) {
          const ai = 2 * k + slot;
          if (ai >= allotteesList.length) break;
          const a = allotteesList[ai] || {};
          const specs = slot === 0 ? P7_SPECS_1 : P7_SPECS_2;
          const merged = buildAllotteeMerged(a);
          for (const [field, key] of specs) {
            const val = merged[key] || '';
            if (val) h.setText(`${field}${sfx}`, val);
          }
          if (a.jointlyHeld) h.check(`cb_${slot + 1}_P.7${sfx}`, true);
        }
      }
    }

    // ── BR on remaining pages via widget-name iteration ──
    // 删页后页序已变，不能按 pageNo 猜字段名（如 P.7 保留后变成第 4 页）。
    // 直接遍历仍存活的 fill_1_P.* 字段填 BR。
    if (brNumber) {
      for (const f of form.getFields()) {
        const n = f.getName();
        if (!/^fill_1_P\.\d+$/.test(n)) continue;
        try {
          const tf = form.getTextField(n);
          tf.setText(brNumber);
          tf.updateAppearances(helv);
        } catch { /* skip */ }
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

// ═══ P.7 附表二获配人槽位字段映射 ═══
// 获配人 1（fill_4-14 + cb_1）/ 获配人 2（fill_15-25 + cb_2），结构镜像。
// fill_7/18 = 英文名稱大框（用户之前要求不填，保持）；fill_2/3 = 顶部总表（section-level）
const P7_SPECS_1: [string, string][] = [
  ['fill_4_P.7', 'nameZh'], ['fill_5_P.7', 'surname'], ['fill_6_P.7', 'otherNames'],
  ['fill_8_P.7', 'flat'], ['fill_9_P.7', 'building'],
  ['fill_10_P.7', 'street'], ['fill_11_P.7', 'district'], ['fill_12_P.7', 'country'],
  ['fill_13_P.7', 'shares'], ['fill_14_P.7', 'remarks'],
];
const P7_SPECS_2: [string, string][] = [
  ['fill_15_P.7', 'nameZh'], ['fill_16_P.7', 'surname'], ['fill_17_P.7', 'otherNames'],
  ['fill_19_P.7', 'flat'], ['fill_20_P.7', 'building'],
  ['fill_21_P.7', 'street'], ['fill_22_P.7', 'district'], ['fill_23_P.7', 'country'],
  ['fill_24_P.7', 'shares'], ['fill_25_P.7', 'remarks'],
];

// 获配人数据规范化：英文名自动拆姓/名（HK 惯例：首词 = 姓）
function buildAllotteeMerged(a: any): Record<string, string> {
  const nameEn = String(a.nameEn || '').trim();
  let surname = String(a.surname || '').trim();
  let otherNames = String(a.otherNames || '').trim();
  if (nameEn && !surname) {
    const parts = nameEn.split(/\s+/);
    if (parts.length >= 2) {
      surname = parts[0];  // HK convention: first word = surname
      otherNames = parts.slice(1).join(' ');
    } else {
      surname = nameEn;
    }
  }
  return {
    nameZh: String(a.nameZh || '').trim(),
    nameEn,
    surname,
    otherNames,
    flat: String(a.flat || '').trim(),
    building: String(a.building || '').trim(),
    street: String(a.street || '').trim(),
    district: String(a.district || '').trim(),
    postal: String(a.postal || '').trim(),
    country: String(a.country || '').trim() || 'Hong Kong',
    shares: String(a.shares || '').trim(),
    remarks: String(a.remarks || '').trim(),
  };
}

// ═══ 动态续页：复制模板页 → widget 全名加 suffix → 脱离 parent ═══
// （与 ND2A renameDynamicWidgets 同款；NSC1 动态页调用）
function renameDynamicWidgets(pdfDoc: PDFDocument, page: any, suffix: string) {
  const ctx = (pdfDoc as any).context;
  const annots = page.node.lookup(PDFName.of("Annots")) as any;
  if (!annots || typeof annots.size !== "function") return;
  for (let i = 0; i < annots.size(); i++) {
    try {
      const widget = ctx.lookup(annots.get(i)) as any;
      if (!widget || typeof widget.get !== "function") continue;
      if (String(widget.get(PDFName.of("Subtype"))) !== "/Widget") continue;
      const parentRef = widget.get(PDFName.of("Parent"));
      let field: any = widget;
      if (parentRef) {
        try { field = ctx.lookup(parentRef) as any; } catch { field = widget; }
      }
      const parentName = decodePdfText(field.get(PDFName.of("T")));
      const widgetName = decodePdfText(widget.get(PDFName.of("T")));
      let fullName = parentName || widgetName;
      const gpRef = field && field !== widget ? field.get?.(PDFName.of("Parent")) : undefined;
      if (gpRef) {
        try {
          const gp = ctx.lookup(gpRef) as any;
          const gpName = decodePdfText(gp.get(PDFName.of("T")));
          if (gpName) fullName = widgetName ? `${gpName}.${widgetName}` : `${gpName}.${parentName}`;
        } catch { /* keep */ }
      } else if (parentName && widgetName && widgetName !== parentName) {
        fullName = `${parentName}.${widgetName}`;
      }
      if (!fullName || /^\d+$/.test(fullName)) continue; // 无法解析全名的跳过
      // 继承键（FT/DA/Ff/Q/DV/Opt/MaxLen）后脱离
      for (const k of ["FT", "DA", "Ff", "Q", "DV", "Opt", "MaxLen"]) {
        const key = PDFName.of(k);
        if (!widget.get(key)) {
          const v = field && field !== widget ? field.get(key) : undefined;
          if (v !== undefined && v !== null) widget.set(key, v);
        }
      }
      widget.set(PDFName.of("T"), PDFString.of(`${fullName}_${suffix}`));
      widget.delete(PDFName.of("Parent"));
    } catch { /* skip */ }
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
