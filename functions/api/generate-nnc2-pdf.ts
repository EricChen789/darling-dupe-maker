// POST /api/generate-nnc2-pdf
// NNC2 更改公司名稱通知書 — 專用端點（Phase 2.2）
// 使用 R2 NNC2_fillable 模板 + pdf-lib AcroForm 填充
//   Strategy: acroField.setValue(PDFString.of(v)) → UTF-16BE BOM /V
//   + NeedAppearances true → viewer regenerates AP using DR's PMingLiU
//   + /MK /BG [0.91 0.93 0.96] blue background on all widgets
//   + updateFieldAppearances:false → preserve template widget appearances
//   No font embedding needed — PMingLiU is in AcroForm /DR.
//
// Field mapping (new fillable template, P.1):
//   fill_1  → 商業登記號碼 BR Number
//   fill_2  → 現有公司英文名稱 Existing English Company Name
//   fill_3  → 現有公司中文名稱 Existing Chinese Company Name
//   fill_4  → 特別決議日期 DD
//   fill_5  → 特別決議日期 MM
//   fill_6  → 特別決議日期 YYYY
//   fill_7  → 擬用的公司英文名稱 Intended English Company Name
//   fill_8  → 擬用的公司中文名稱 Intended Chinese Company Name
//   fill_9  → 簽署姓名 Signed Name
//   Dropdown_1 → 董事 Director／公司秘書 Company Secretary
//   Dropdown_2 → *請刪去不適用者
//   fill_10 → 簽署日期 Date
//   fill_11 → 提交人中文姓名 Presenter Name (Chinese)
//   fill_12 → 提交人英文姓名 Presenter Name (English)
//   fill_13 → 提交人地址 Presenter Address
//   fill_14 → 提交人電話 Presenter Tel
//   fill_15 → 提交人傳真 Presenter Fax
//   fill_16 → 提交人電郵 Presenter Email
//   fill_17 → 提交人檔號 Presenter Reference

import {
  PDFDocument, PDFName, PDFString,
  PDFArray, PDFNumber,
} from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64 } from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";
import { enableNeedAppearances } from "./_acroform";

const TEMPLATE_NAME = "NNC2-template.pdf";

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      fields?: Record<string, unknown>;
      dropdowns?: Record<string, string>;
      checkboxes?: string[];
    };

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE_NAME);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

    const form = pdfDoc.getForm();
    const ctx = (pdfDoc as any).context;

    // ── Fill text fields: acroField.setValue(PDFString.of()) ──
    // PDFString.of() adds UTF-16BE BOM for non-ASCII text → correct CJK in /V
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;
        const tf = form.getTextField(name);
        tf.acroField.setValue(PDFString.of(vstr));
      } catch { /* skip missing/readonly fields */ }
    }

    // ── Dropdown fields ──
    const dropdowns = data.dropdowns || {};
    for (const [name, option] of Object.entries(dropdowns)) {
      try {
        if (!option) continue;
        const dd = form.getDropdown(name);
        dd.select(option);
      } catch { /* skip */ }
    }

    // ── Checkboxes ──
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // ── Blue background via /MK /BG on all text field widgets ──
    for (const field of form.getFields()) {
      try {
        const widgets = field.acroField.getWidgets();
        for (const w of widgets) {
          try {
            const bgArr = PDFArray.withContext(ctx);
            bgArr.push(PDFNumber.of(0.91));
            bgArr.push(PDFNumber.of(0.93));
            bgArr.push(PDFNumber.of(0.96));
            const mkDict = ctx.obj({});
            mkDict.set(PDFName.of("BG"), bgArr);
            (w as any).dict.set(PDFName.of("MK"), mkDict);
          } catch { /* skip unmodifiable widget */ }
        }
      } catch { /* skip inaccessible field */ }
    }

    // ── Enable NeedAppearances — viewer regenerates AP with DR's PMingLiU font ──
    enableNeedAppearances(pdfDoc);

    // ── Save: no flatten, no updateFieldAppearances → preserve template state ──
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
