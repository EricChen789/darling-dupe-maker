// POST /api/generate-nnc2-pdf
// NNC2 更改公司名稱通知書 — 專用端點
// 使用 R2 NNC2_fillable 模板 + pdf-lib AcroForm 填充
//   Strategy: setText() + updateAppearances(cjk) → 嵌入字体生成 AP
//   + /MK /BG [0.91 0.93 0.96] 蓝底 + NeedAppearances
//   + updateFieldAppearances:false → 保留所有 widget 修改
//
// Field mapping (new fillable template, P.1):
//   fill_1  → 商業登記號碼
//   fill_2  → 現有公司英文名稱
//   fill_3  → 現有公司中文名稱
//   fill_4-6 → 特別決議日期 DD/MM/YYYY
//   fill_7  → 擬用的公司英文名稱
//   fill_8  → 擬用的公司中文名稱
//   fill_9  → 簽署姓名
//   Dropdown_1/2 → 董事/公司秘書
//   fill_10 → 簽署日期
//   fill_11 → 提交人中文姓名
//   fill_12 → 提交人英文姓名
//   fill_13 → 提交人地址
//   fill_14 → 提交人電話
//   fill_15 → 提交人傳真
//   fill_16 → 提交人電郵
//   fill_17 → 提交人檔號

import {
  PDFDocument, PDFName, PDFArray, PDFNumber, PDFBool, PDFDict,
} from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64, fetchAndEmbedFont } from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

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

    // Embed CJK font (Noto Sans TC from R2/CDN)
    const { cjk } = await fetchAndEmbedFont(pdfDoc, env as any);

    const form = pdfDoc.getForm();
    const ctx = (pdfDoc as any).context;

    // ── Fill text fields: setText() → /V with UTF-16BE BOM ──
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;
        const tf = form.getTextField(name);
        tf.setText(vstr);
        if (cjk) {
          const hasCjk = /[^\x00-\x7F]/.test(vstr);
          if (hasCjk) tf.updateAppearances(cjk);
        }
      } catch { /* skip */ }
    }

    // ── Dropdown fields ──
    for (const [name, option] of Object.entries(data.dropdowns || {})) {
      try {
        if (!option) continue;
        form.getDropdown(name).select(option);
      } catch { /* skip */ }
    }

    // ── Checkboxes ──
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // ── Blue background via /MK /BG on all widgets ──
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
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // ── Enable NeedAppearances ──
    try {
      const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
      if (acroForm) acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
    } catch { /* ignore */ }

    // ── Save: no flatten, no updateFieldAppearances → preserve /MK and AP ──
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
