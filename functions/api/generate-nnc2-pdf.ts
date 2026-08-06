// POST /api/generate-nnc2-pdf
// NNC2 更改公司名稱通知書 — 專用端點（Phase 2.2）
// 使用 R2 NNC2_fillable 模板 + pdf-lib AcroForm 填充
//   Strategy: 手动生成 AP stream（蓝底 + 文字），用页面内置字体
//     - CJK: /C2_0 (MingLiU subset, 已在 page Resources)
//     - ASCII: /Helv (已在 template DR)
//     - AP Form XObject 不设 Resources → 字体从 page 继承
//     - 蓝底 0.91 0.93 0.96 画在 AP 里（所有 reader 都显示）
//     - updateFieldAppearances: false → 保留我们手动设置的 AP
//   No fontkit, no external font embedding.
//
// Field mapping (new fillable template, P.1):
//   fill_1  → 商業登記號碼
//   fill_2  → 現有公司英文名稱
//   fill_3  → 現有公司中文名稱
//   fill_4-6 → 特別決議日期 DD/MM/YYYY
//   fill_7  → 擬用的公司英文名稱
//   fill_8  → 擬用的公司中文名稱
//   fill_9  → 簽署姓名
//   fill_10 → 簽署日期
//   fill_11 → 提交人中文姓名
//   fill_12 → 提交人英文姓名
//   fill_13 → 提交人地址
//   fill_14 → 提交人電話
//   fill_15 → 提交人傳真
//   fill_16 → 提交人電郵
//   fill_17 → 提交人檔號

import {
  PDFDocument, PDFName, PDFHexString,
  PDFArray, PDFNumber,
} from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64 } from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC2-template.pdf";

/** Generate a hex string for PDF Form XObject content stream (UTF-16BE with BOM) */
function toUtf16Hex(value: string): string {
  let hex = 'FEFF'; // BOM
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Handle surrogate pairs
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
      const lo = value.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        const cp = 0x10000 + (code - 0xD800) * 0x400 + (lo - 0xDC00);
        hex += cp.toString(16).padStart(8, '0').toUpperCase();
        i++;
        continue;
      }
    }
    hex += (code >> 8).toString(16).padStart(2, '0').toUpperCase();
    hex += (code & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  }
  return hex;
}

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

    // Collect field values first
    const fieldValues = new Map<string, string>();
    const fieldsData = data.fields || {};
    for (const [name, value] of Object.entries(fieldsData)) {
      const vstr = value != null ? String(value) : "";
      if (vstr) fieldValues.set(name, vstr);
    }

    // ── Generate AP streams for each text field widget ──
    // AP Form XObject: blue bg rect + text using page-internal fonts
    // Font /C2_0 = MingLiU (page Resources), /Helv = Helvetica (DR)
    const encoder = new TextEncoder();
    const allFields = form.getFields();
    for (const field of allFields) {
      try {
        const fieldName = field.getName();
        const value = fieldValues.get(fieldName);
        if (!value) continue;

        const widgets = field.acroField.getWidgets();
        for (const w of widgets) {
          try {
            const rect = w.getRectangle();
            const rw = rect.width;
            const rh = rect.height;
            if (rw <= 2 || rh <= 2) continue;

            const hasCjk = /[^\x00-\x7F]/.test(value);

            // Font size from DA or default
            const da = field.acroField.getDefaultAppearance() ?? '/Helv 10 Tf 0 g';
            const sizeMatch = String(da).match(/(\d+(?:\.\d+)?)\s+Tf/);
            const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 10;

            const fontName = hasCjk ? 'C2_0' : 'Helv';
            let textOp: string;
            if (hasCjk) {
              textOp = `<${toUtf16Hex(value)}> Tj`;
            } else {
              const escaped = value.replace(/([()\\])/g, '\\$1');
              textOp = `(${escaped}) Tj`;
            }

            // AP content: blue background + black text
            const textX = 2;
            const textY = Math.max(2, rh * 0.18);
            const boxW = rw.toFixed(1);
            const boxH = rh.toFixed(1);

            const apContent = [
              '/Tx BMC',
              'q',
              '0.91 0.93 0.96 rg',
              `0 0 ${boxW} ${boxH} re`,
              'f',
              'Q',
              'BT',
              `/${fontName} ${fontSize} Tf`,
              '0 0 0 rg',
              `${textX.toFixed(1)} ${textY.toFixed(1)} Td`,
              textOp,
              'ET',
              'EMC',
            ].join('\n');

            // Build Form XObject (no Resources — inherits from page)
            const bbox = PDFArray.withContext(ctx);
            bbox.push(PDFNumber.of(0));
            bbox.push(PDFNumber.of(0));
            bbox.push(PDFNumber.of(rw));
            bbox.push(PDFNumber.of(rh));

            const streamDict = ctx.obj({});
            streamDict.set(PDFName.of('Type'), PDFName.of('XObject'));
            streamDict.set(PDFName.of('Subtype'), PDFName.of('Form'));
            streamDict.set(PDFName.of('BBox'), bbox);

            const apStream = ctx.stream(encoder.encode(apContent), streamDict);
            const apRef = ctx.register(apStream);

            const apDict = ctx.obj({});
            apDict.set(PDFName.of('N'), apRef);
            (w as any).dict.set(PDFName.of('AP'), apDict);

            // Set /V (fallback for viewers that don't use /NeedAppearances)
            if (hasCjk) {
              (w as any).dict.set(PDFName.of('V'), PDFHexString.fromText(value));
            } else {
              (w as any).dict.set(PDFName.of('V'), PDFHexString.fromText(value));
            }
          } catch { /* skip unmodifiable widget */ }
        }
      } catch { /* skip inaccessible field */ }
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

    // ── Save: no flatten, no updateFieldAppearances → preserve our AP streams ──
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
