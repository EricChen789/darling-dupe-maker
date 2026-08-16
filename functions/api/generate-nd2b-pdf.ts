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

    // ── Build new address ──
    const newAddrParts = [
      data.newFlat || '', data.newBuilding || '',
      data.newStreet || '', data.newDistrict || '', data.newRegion || ''
    ];
    const newAddress = newAddrParts.filter(Boolean).join(', ') || data.newAddress || '';

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
      setText("fill_7_P.1", (data.idNumber || '').replace(/[()\-\s]/g, '').toUpperCase().slice(0, 4), 'right');
      if (data.passportCountry || data.passportPlaceOfIssue) {
        setText("fill_7b_P.1", data.passportCountry || data.passportPlaceOfIssue);
      }
      if (data.passportNumber) {
        setText("fill_7c_P.1", (data.passportNumber || '').slice(0, 8));
      }

      // ── P.2: Change details (multi-type support) ──
      // Current name (item 14) — ALWAYS filled to identify the person
      const currentNameEn = data.nameEnglish || `${surname} ${otherNames}`.trim();
      const currentNameDisplay = [data.nameChinese, currentNameEn].filter(Boolean).join(' ');
      setText("fill_2_P.2", currentNameDisplay);

      // Effective date (shared across rows)
      if (effDay) {
        setText("fill_5_P.2", effDay);
        setText("fill_4_P.2", effMonth);
        setText("fill_3_P.2", effYear);
      }

      // (a) 姓名更改
      if (changeTypes.includes('name')) {
        // fill_2 already filled above with current name
        if (newChinese) setText("fill_6_P.2", newChinese);
        if (newEnglish) setText("fill_7_P.2", newEnglish);
        if (effDay) {
          setText("fill_10_P.2", effDay);
          setText("fill_9_P.2", effMonth);
          setText("fill_8_P.2", effYear);
        }
      }

      // (b) 別名
      const newAliasEng = data.newAliasEnglish || '';
      const newAliasCn = data.newAliasChinese || '';
      if (newAliasEng || newAliasCn) {
        setText("fill_12_P.2", `${newAliasEng} ${newAliasCn}`.trim());
        if (effDay) {
          setText("fill_15_P.2", effDay);
          setText("fill_14_P.2", effMonth);
          setText("fill_13_P.2", effYear);
        }
      }

      // (d) 地址更改
      if (changeTypes.includes('address')) {
        setText("fill_19_P.2", data.newFlat || newAddress);
        setText("fill_20_P.2", data.newBuilding);
        setText("fill_21_P.2", data.newStreet);
        setText("fill_22_P.2", data.newDistrict);
        setText("fill_23_P.2", data.newRegion);
        if (effDay) {
          setText("fill_26_P.2", effDay);
          setText("fill_25_P.2", effMonth);
          setText("fill_24_P.2", effYear);
        }
      }

      // (f) 聯絡資料更改
      if (changeTypes.includes('contact') && data.newEmail) {
        setText("fill_27_P.2", data.newEmail);
        if (effDay) {
          setText("fill_30_P.2", effDay);
          setText("fill_29_P.2", effMonth);
          setText("fill_28_P.2", effYear);
        }
      }

      // (g) 證件號碼更改
      if (changeTypes.includes('id')) {
        if (data.newIdNumber) {
          setText("fill_35_P.2", (data.newIdNumber || '').replace(/[()\-\s]/g, ''), 'right');
          if (effDay) {
            setText("fill_34_P.2", effDay);
            setText("fill_33_P.2", effMonth);
            setText("fill_32_P.2", effYear);
          }
        }
        if (data.passportNumber) {
          setText("fill_37_P.2", (data.passportNumber || '').slice(0, 8));
        }
        if (data.passportPlaceOfIssue || data.passportCountry) {
          setText("fill_36_P.2", data.passportPlaceOfIssue || data.passportCountry);
        }
      }

      // ── P.6: PI-ND2B 受保護資料 ──
      check(role === "secretary" ? "cb_1_P.6" : "cb_2_P.6", true);
      setText("fill_2_P.6", data.nameChinese);
      setText("fill_3_P.6", surname);
      setText("fill_4_P.6", otherNames);
      if (changeTypes.includes('address') && newAddress) {
        setText("fill_9_P.6", newAddress);
      } else if (data.newAddress) {
        setText("fill_9_P.6", data.newAddress);
      }
      // HKID
      if (changeTypes.includes('id') && data.newIdNumber) {
        setText("fill_5_P.6", (data.newIdNumber || '').replace(/[()\-\s]/g, ''), 'right');
      } else {
        setText("fill_5_P.6", (data.idNumber || '').replace(/[()\-\s]/g, ''), 'right');
      }
      // Passport country
      const ppoi = data.passportPlaceOfIssue || data.passportCountry || '';
      if (ppoi) setText("fill_7_P.6", ppoi);
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
    setText("fill_31_P.3", data.signDate);

    // ── Fill P.4 Continuation Sheet A (natural person) ──
    // Section A: Current registered particulars
    // Section B: Details of changes (continuation from P.2)
    if (isNatural) {
      // ═══ Section A: Current registered details ═══
      check(role === "secretary" ? "cb_1_P.4" : role === "alternate" ? "cb_3_P.4" : "cb_2_P.4", true);
      setText("fill_2_P.4", data.nameChinese);
      setText("fill_5_P.4", surname);
      setText("fill_6_P.4", otherNames);
      setText("fill_7_P.4", (data.idNumber || '').replace(/[()\-\s]/g, '').toUpperCase().slice(0, 4), 'right');

      // ═══ Section B: Change details (mirror P.2) ═══
      // (a) Name change
      if (changeTypes.includes('name')) {
        if (newChinese) setText("fill_16_P.4", newChinese);
        const newEngName = `${newSurname} ${newOther}`.trim();
        if (newEngName) setText("fill_17_P.4", newEngName);
        if (effDay) {
          setText("fill_20_P.4", effDay);
          setText("fill_19_P.4", effMonth);
          setText("fill_18_P.4", effYear);
        }
      }

      // (d) Address change
      if (changeTypes.includes('address')) {
        if (data.newFlat) setText("fill_24_P.4", data.newFlat);
        else if (data.newAddress) setText("fill_24_P.4", data.newAddress);
        if (data.newBuilding) setText("fill_25_P.4", data.newBuilding);
        if (data.newStreet) setText("fill_26_P.4", data.newStreet);
        if (data.newDistrict) setText("fill_27_P.4", data.newDistrict);
        if (data.newRegion) setText("fill_28_P.4", data.newRegion);
        if (effDay) {
          setText("fill_31_P.4", effDay);
          setText("fill_30_P.4", effMonth);
          setText("fill_29_P.4", effYear);
        }
      }

      // (g) ID change
      if (changeTypes.includes('id')) {
        if (data.newIdNumber) setText("fill_32_P.4", (data.newIdNumber || '').replace(/[()\-\s]/g, ''), 'right');
        // P.4 passport: fill_36=issuing country, fill_37=passport number (matches P.2 layout)
        if (data.passportCountry || data.passportPlaceOfIssue) {
          setText("fill_36_P.4", data.passportCountry || data.passportPlaceOfIssue);
        }
        if (data.passportNumber) setText("fill_37_P.4", (data.passportNumber || '').slice(0, 8));
        if (effDay) {
          setText("fill_35_P.4", effDay);
          setText("fill_34_P.4", effMonth);
          setText("fill_33_P.4", effYear);
        }
      }

      // (f) Contact change
      if (changeTypes.includes('contact') && data.newEmail) {
        setText("fill_40_P.4", data.newEmail);
        if (effDay) {
          setText("fill_44_P.4", effDay);
          setText("fill_43_P.4", effMonth);
          setText("fill_42_P.4", effYear);
        }
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
