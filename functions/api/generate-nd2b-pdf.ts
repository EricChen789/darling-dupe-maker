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
      setText("fill_7_P.1", data.idNumber, 'right');
      if (data.passportCountry || data.passportPlaceOfIssue) {
        setText("fill_7b_P.1", data.passportCountry || data.passportPlaceOfIssue);
      }
      if (data.passportNumber) {
        setText("fill_7c_P.1", (data.passportNumber || '').slice(0, 8));
      }

      // ── P.2: Change details (multi-type support) ──
      // Effective date (shared across rows)
      if (effDay) {
        setText("fill_5_P.2", effDay);
        setText("fill_4_P.2", effMonth);
        setText("fill_3_P.2", effYear);
      }

      // (a) 姓名更改
      if (changeTypes.includes('name')) {
        const currentName = data.nameEnglish || `${surname} ${otherNames}`.trim();
        setText("fill_2_P.2", currentName);
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
          setText("fill_35_P.2", data.newIdNumber, 'right');
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
        setText("fill_5_P.6", data.newIdNumber, 'right');
      } else {
        setText("fill_5_P.6", data.idNumber, 'right');
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

    // ── BR on all pages ──
    for (let pi = 2; pi <= pdfDoc.getPageCount(); pi++) {
      setText(`fill_1_P.${pi}`, br8);
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
