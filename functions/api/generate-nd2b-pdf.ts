// POST /api/generate-nd2b-pdf
// 更改公司秘書及董事詳情通知書 —— 移植自 local-server/server.py:_fill_nd2b_pdf()
// body: { brNumber, companyName, role, identity, nameChinese, nameSurname, nameOtherNames,
//         idNumber, passportNumber, changeTypes[], newAddress/newFlat~newRegion,
//         newNameChinese, newNameSurname, newNameOtherNames, newAliasEnglish, newAliasChinese,
//         newIdNumber, newEmail, effectiveDate, signerName, signDate,
//         presentorName, presentorAddress, presentorPhone, presentorFax, presentorEmail, presentorReference,
//         companyId, personId }
// resp: { pdf: '<base64>' }
//
// ⚠️ CPU优化（2026-07-30）：改用 _acroform.ts 底层 helpers，去掉 CJK 字体嵌入 + flatten()
// ⚠️ 2026-08-02 更新：支持全部 4 种变更类型（address/name/id/contact）

import { PDFDocument } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  parseEnglishName, DEFAULT_PRESENTER
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";
import {
  createFormHelpers,
  rebuildAcroFormFields,
  enableNeedAppearances,
} from "./_acroform";

const TEMPLATE = "ND2B-template.pdf";

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as Record<string, any>;

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE}` }, 404);

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer());

    // Use low-level AcroForm helpers (no CJK font embedding → no CPU timeout)
    const { setText, check } = createFormHelpers(pdfDoc);

    const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

    // Parse English name
    const { surname, otherNames } = parseEnglishName(data.nameEnglish || "");

    // ── Parse change types (support both new array and old string) ──
    let changeTypes: string[] = data.changeTypes || [];
    if (typeof changeTypes === 'string') {
      changeTypes = changeTypes ? [changeTypes] : [];
    }
    // backward compat: old singular changeType
    const oldCt = data.changeType || '';
    if (oldCt && !changeTypes.includes(oldCt)) {
      changeTypes = [...changeTypes, oldCt];
    }

    // ── Parse effective date ──
    const effDate = data.effectiveDate || '';
    let effDay = '', effMonth = '', effYear = '';
    if (effDate) {
      const parts = effDate.split('-');
      if (parts.length === 3) {
        [effYear, effMonth, effDay] = parts;
      } else {
        const parts2 = effDate.split('/');
        if (parts2.length === 3) {
          [effDay, effMonth, effYear] = parts2;
        }
      }
    }

    // ── Build new address (dedup: skip parts already contained in an earlier part,
    //    e.g. flat "Unit 611, ... Tower 1, Harbour Centre" contains building "Harbour Centre",
    //    district "Hung Hom, Kowloon" contains region "Kowloon") ──
    const newAddrPartsRaw = [
      data.newFlat || '', data.newBuilding || '',
      data.newStreet || '', data.newDistrict || '', data.newRegion || ''
    ].map((p: any) => String(p || '').trim()).filter(Boolean);
    const newAddrParts: string[] = [];
    for (const p of newAddrPartsRaw) {
      if (newAddrParts.some(a => a.includes(p))) continue;
      newAddrParts.push(p);
    }
    const newAddress = newAddrParts.join(', ') || data.newAddress || '';

    // ── Helper: fill a 日/月/年 date triple (template columns are 日|月|年 left→right) ──
    const fillDateTriple = (dKey: string, mKey: string, yKey: string) => {
      if (!effDay) return;
      setText(dKey, effDay);
      setText(mKey, effMonth);
      setText(yKey, effYear);
    };

    // ── Build new English name ──
    let newSurname = data.newNameSurname || '';
    let newOther = data.newNameOtherNames || '';
    const newEnglish = `${newSurname} ${newOther}`.trim();
    const newChinese = data.newNameChinese || '';
    if (!newEnglish && data.newNameEnglish) {
      const nparts = data.newNameEnglish.trim().split(/\s+/);
      newSurname = nparts[0] || '';
      newOther = nparts.slice(1).join(' ');
    }

    // === PAGE 1 (P.1) — 公司資料 & 申報人資料 ===
    setText("fill_1_P.1", br8);
    setText("fill_2_P.1", data.companyName);

    const isNatural = (data.identity || "natural") === "natural";
    const role = data.role;

    if (isNatural) {
      check(role === "secretary" ? "cb_1_P.1" : "cb_2_P.1", true);
      setText("fill_3_P.1", data.nameChinese);
      setText("fill_4_P.1", surname);
      setText("fill_5_P.1", otherNames);
      // 身分識別：fill_6=香港身分證部分號碼，fill_7=護照部分號碼（模板坐标实测）
      setText("fill_6_P.1", (data.idNumber || '').replace(/[()\-\s]/g, '').toUpperCase().slice(0, 4), 'right');
      if (data.passportNumber) {
        setText("fill_7_P.1", (data.passportNumber || '').slice(0, 8), 'right');
      }

      // ── P.2: Change details (multi-type support) ──
      // 現時資料（姓名/HKID）在 P.1 A 部分；B 部分只填有更改的項目。
      // 欄位對照（模板坐标实测）：(a)中文姓名=fill_2 (b)姓氏=fill_6/名字=fill_7
      // (c)別名=fill_11中/fill_12英 (d)通常住址=仅日期fill_16/17/18（新住址填PI-ND2B頁）
      // (e)通訊地址=fill_19~23 (f)電郵=fill_27 (g)HKID=fill_31
      // (h)護照=fill_35簽發國家/fill_36部分號碼

      // (a) 姓名更改 — 新姓名（(a)中文姓名日期=3/4/5，(b)英文姓名日期=8/9/10）
      if (changeTypes.includes('name')) {
        if (newChinese) setText("fill_2_P.2", newChinese);
        if (newChinese) fillDateTriple('fill_3_P.2', 'fill_4_P.2', 'fill_5_P.2');
        if (newSurname) setText("fill_6_P.2", newSurname);
        if (newOther) setText("fill_7_P.2", newOther);
        if (newSurname || newOther) fillDateTriple('fill_8_P.2', 'fill_9_P.2', 'fill_10_P.2');
      }

      // (b) 別名 — 中文 / 英文
      const newAliasEng = data.newAliasEnglish || '';
      const newAliasCn = data.newAliasChinese || '';
      if (newAliasEng || newAliasCn) {
        if (newAliasCn) setText("fill_11_P.2", newAliasCn);
        if (newAliasEng) setText("fill_12_P.2", newAliasEng);
        fillDateTriple('fill_13_P.2', 'fill_14_P.2', 'fill_15_P.2');
      }

      // (d) 地址更改 — 董事新的通常住址須在 PI-ND2B 頁填報，此處只填生效日期
      if (changeTypes.includes('address')) {
        fillDateTriple('fill_16_P.2', 'fill_17_P.2', 'fill_18_P.2');
      }

      // (f) 聯絡資料更改
      if (changeTypes.includes('contact') && data.newEmail) {
        setText("fill_27_P.2", data.newEmail);
        fillDateTriple('fill_28_P.2', 'fill_29_P.2', 'fill_30_P.2');
      }

      // (g) 證件號碼更改 — HKID 部分號碼 + 護照
      if (changeTypes.includes('id')) {
        if (data.newIdNumber) {
          setText("fill_31_P.2", (data.newIdNumber || '').replace(/[()\-\s]/g, ''), 'right');
          fillDateTriple('fill_32_P.2', 'fill_33_P.2', 'fill_34_P.2');
        }
        if (data.passportPlaceOfIssue || data.passportCountry) {
          setText("fill_35_P.2", data.passportPlaceOfIssue || data.passportCountry);
        }
        if (data.passportNumber) {
          setText("fill_36_P.2", (data.passportNumber || '').slice(0, 8));
        }
        if (data.passportNumber || data.passportPlaceOfIssue || data.passportCountry) {
          fillDateTriple('fill_37_P.2', 'fill_38_P.2', 'fill_39_P.2');
        }
      }

      // ── P.6: PI-ND2B 受保護資料 ──
      check(role === "secretary" ? "cb_1_P.6" : "cb_2_P.6", true);
      setText("fill_2_P.6", data.nameChinese);
      setText("fill_3_P.6", surname);
      setText("fill_4_P.6", otherNames);
      // PI-ND2B 地址 5 行分項填寫：室/樓/座 → 大廈 → 街道 → 區 → 國家/地區
      if (changeTypes.includes('address')) {
        if (data.newFlat) setText("fill_9_P.6", data.newFlat);
        if (data.newBuilding) setText("fill_10_P.6", data.newBuilding);
        if (data.newStreet) setText("fill_11_P.6", data.newStreet);
        if (data.newDistrict) setText("fill_12_P.6", data.newDistrict);
        if (data.newRegion) setText("fill_13_P.6", data.newRegion);
      } else if (data.newAddress) {
        setText("fill_9_P.6", data.newAddress);
      }
      // PI 頁只填報有更改的項目：HKID 完整號碼（主號入 fill_5，括號內校驗碼入 fill_6）
      if (changeTypes.includes('id') && data.newIdNumber) {
        const newIdClean = String(data.newIdNumber || '').replace(/[()\-\s]/g, '').toUpperCase();
        setText("fill_5_P.6", newIdClean.length >= 8 ? newIdClean.slice(0, 7) : newIdClean, 'right');
        if (newIdClean.length >= 8) setText("fill_6_P.6", newIdClean.slice(7, 8));
      }
      // 護照：只在證件更改時填報
      if (changeTypes.includes('id')) {
        const ppoi = data.passportPlaceOfIssue || data.passportCountry || '';
        if (ppoi) setText("fill_7_P.6", ppoi);
        if (data.passportNumber) setText("fill_8_P.6", String(data.passportNumber).slice(0, 12));
      }
    }

    // ── P.1 提交人信息 ──
    setText("fill_8_P.1", data.presentorName || DEFAULT_PRESENTER.name);
    setText("fill_9_P.1", data.presentorAddress || DEFAULT_PRESENTER.address);
    setText("fill_10_P.1", data.presentorPhone || data.presentorContact || DEFAULT_PRESENTER.phone);
    setText("fill_11_P.1", data.presentorFax || DEFAULT_PRESENTER.fax);
    setText("fill_12_P.1", data.presentorEmail || DEFAULT_PRESENTER.email);
    setText("fill_13_P.1", data.presentorReference || DEFAULT_PRESENTER.reference);

    // ── P.3 簽署 ──
    setText("fill_30_P.3", data.signerName);
    // signDate 以 DD/MM/YYYY 显示（前端传 YYYY-MM-DD）
    const signDateRaw = String(data.signDate || '');
    const signParts = signDateRaw.split('-');
    const signDateDisplay = signParts.length === 3
      ? `${signParts[2].padStart(2, '0')}/${signParts[1].padStart(2, '0')}/${signParts[0]}`
      : signDateRaw;
    setText("fill_31_P.3", signDateDisplay);

    // ── Fill P.4 Continuation Sheet A (natural person) ──
    // Section A: Current registered particulars
    // Section B: Details of changes (continuation from P.2)
    if (isNatural) {
      // ═══ Section A: Current registered details ═══
      // 欄位對照（模板坐标实测）：fill_2=中文姓名 fill_3=姓氏 fill_4=名字
      // fill_5=香港身分證部分號碼 fill_6=護照部分號碼
      check(role === "secretary" ? "cb_1_P.4" : role === "alternate" ? "cb_3_P.4" : "cb_2_P.4", true);
      setText("fill_2_P.4", data.nameChinese);
      setText("fill_3_P.4", surname);
      setText("fill_4_P.4", otherNames);
      setText("fill_5_P.4", (data.idNumber || '').replace(/[()\-\s]/g, '').toUpperCase().slice(0, 4), 'right');
      if (data.passportNumber) {
        setText("fill_6_P.4", (data.passportNumber || '').slice(0, 8), 'right');
      }

      // ═══ Section B: Change details (mirror P.2) ═══
      // 欄位對照：(a)中文姓名=fill_7 (b)姓氏=fill_11/名字=fill_12 (c)別名=fill_16中/fill_17英
      // (d)通常住址=仅日期fill_21/22/23（新住址填PI-ND2B頁）
      // (e)通訊地址=fill_24~28 (f)電郵=fill_32 (g)HKID=fill_36 (h)護照=fill_40國家/fill_41號碼

      // (a)/(b) 姓名更改 — 新中文姓名 + 新英文姓名（姓氏/名字分框）
      if (changeTypes.includes('name')) {
        if (newChinese) setText("fill_7_P.4", newChinese);
        if (newChinese) fillDateTriple('fill_8_P.4', 'fill_9_P.4', 'fill_10_P.4');
        if (newSurname) setText("fill_11_P.4", newSurname);
        if (newOther) setText("fill_12_P.4", newOther);
        if (newSurname || newOther) fillDateTriple('fill_13_P.4', 'fill_14_P.4', 'fill_15_P.4');
      }

      // (c) 別名 — 中文 / 英文
      const p4AliasCn = data.newAliasChinese || '';
      const p4AliasEng = data.newAliasEnglish || '';
      if (p4AliasCn || p4AliasEng) {
        if (p4AliasCn) setText("fill_16_P.4", p4AliasCn);
        if (p4AliasEng) setText("fill_17_P.4", p4AliasEng);
        fillDateTriple('fill_18_P.4', 'fill_19_P.4', 'fill_20_P.4');
      }

      // (d) 地址更改 — 董事新的通常住址須在 PI-ND2B 頁填報，此處只填生效日期
      if (changeTypes.includes('address')) {
        fillDateTriple('fill_21_P.4', 'fill_22_P.4', 'fill_23_P.4');
      }

      // (f) 聯絡資料更改
      if (changeTypes.includes('contact') && data.newEmail) {
        setText("fill_32_P.4", data.newEmail);
        fillDateTriple('fill_33_P.4', 'fill_34_P.4', 'fill_35_P.4');
      }

      // (g) 證件號碼更改 — HKID 部分號碼
      if (changeTypes.includes('id') && data.newIdNumber) {
        setText("fill_36_P.4", (data.newIdNumber || '').replace(/[()\-\s]/g, ''), 'right');
        fillDateTriple('fill_37_P.4', 'fill_38_P.4', 'fill_39_P.4');
      }
      // (h) 護照 — 簽發國家/地區 + 部分號碼
      if (changeTypes.includes('id') && (data.passportNumber || data.passportPlaceOfIssue || data.passportCountry)) {
        if (data.passportPlaceOfIssue || data.passportCountry) {
          setText("fill_40_P.4", data.passportPlaceOfIssue || data.passportCountry);
        }
        if (data.passportNumber) {
          setText("fill_41_P.4", (data.passportNumber || '').slice(0, 8));
        }
        fillDateTriple('fill_42_P.4', 'fill_43_P.4', 'fill_44_P.4');
      }
    }

    // ── BR on all pages ──
    for (let pi = 2; pi <= pdfDoc.getPageCount(); pi++) {
      setText(`fill_1_P.${pi}`, br8);
    }

    // ── Delete unused continuation pages ──
    // Template has 14 pages. Remove irrelevant pages based on officer identity.
    const totalPages = pdfDoc.getPageCount();
    const pagesToRemove: number[] = [];
    if (isNatural) {
      // Keep: P.1(company+presenter), P.2(change details), P.3(signature),
      //       P.4(continuation A-natural current details), P.6(PI-ND2B)
      // Delete: P.5(body corp continuation B), P.7-P.14(empty/non-interactive)
      if (totalPages >= 5) pagesToRemove.push(4);              // P.5 (0-indexed)
      for (let pi = 6; pi < totalPages; pi++) pagesToRemove.push(pi); // P.7-P.14
    } else {
      // Body corporate:
      // Keep: P.1(company+presenter), P.3(body corp+signature), P.5(continuation B)
      // Delete: P.2(natural person), P.4(continuation A), P.6(PI), P.7-P.14
      if (totalPages >= 2) pagesToRemove.push(1);              // P.2
      if (totalPages >= 4) pagesToRemove.push(3);              // P.4
      if (totalPages >= 6) pagesToRemove.push(5);              // P.6
      for (let pi = 6; pi < totalPages; pi++) pagesToRemove.push(pi); // P.7-P.14
    }
    // Remove in reverse order so indices stay valid
    for (const pi of pagesToRemove.reverse()) {
      if (pi < pdfDoc.getPageCount()) {
        pdfDoc.removePage(pi);
      }
    }

    // Skip flatten() — use NeedAppearances instead (saves CPU, avoids 503)
    rebuildAcroFormFields(pdfDoc);
    enableNeedAppearances(pdfDoc);

    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("ND2B generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
