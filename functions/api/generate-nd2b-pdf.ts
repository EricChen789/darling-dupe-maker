// POST /api/generate-nd2b-pdf
// 更改公司秘書及董事詳情通知書 —— 移植自 local-server/server.py:_fill_nd2b_pdf()
// body: { brNumber, companyName, role, identity, nameEnglish, nameChinese, idNumber,
//         changeType, newAddress, effectiveDate, signerName, signDate,
//         presentorName, presentorAddress, presentorContact }
// resp: { pdf: '<base64>' }
//
// ⚠️ CPU优化（2026-07-30）：改用 _acroform.ts 底层 helpers，去掉 CJK 字体嵌入 + flatten()
// 仿 NN6 Helvetica-only 模式，消除冷启动 503

import { PDFDocument } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  parseEnglishName
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
    const data = await request.json() as Record<string, string>;

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

      // P.2: 變更詳情（地址變更）
      if (data.changeType === "address" && data.newAddress) {
        setText("fill_19_P.2", data.newAddress);
      }

      // P.6: PI-ND2B 受保護資料
      check(role === "secretary" ? "cb_1_P.6" : "cb_2_P.6", true);
      setText("fill_2_P.6", data.nameChinese);
      setText("fill_3_P.6", surname);
      setText("fill_4_P.6", otherNames);
      if (data.newAddress) {
        setText("fill_9_P.6", data.newAddress);
      }
    }

    // 提交人（P.1 底部）
    setText("fill_8_P.1", data.presentorName);
    setText("fill_9_P.1", data.presentorAddress);
    setText("fill_10_P.1", data.presentorContact);

    // P.3 簽署
    setText("fill_30_P.3", data.signerName);
    setText("fill_31_P.3", data.signDate);

    // BR on all pages
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
