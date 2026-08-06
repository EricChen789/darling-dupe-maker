// POST /api/generate-nnc2-pdf
// NNC2 更改公司名稱通知書 — 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
//   Strategy: 自定义 AP 流 = 蓝色背景 + 文字
//   - 蓝色背景: 0.91 0.93 0.96 (浅蓝，与 PyMuPDF 一致)
//   - CJK 文字: 使用页面内建 /PMingLiU 字体 (无 font embedding，省 CPU)
//   - ASCII 文字: 使用 StandardFonts.Helvetica
//   - 不 flatten — 保留 widget annotations
//   - updateFieldAppearances:false — 保留自定义 AP

import {
  PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString,
  PDFArray, PDFNumber,
} from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC2-template.pdf";

/** Generate a custom AP stream for a widget: blue background + text.
 *  Uses page-internal font names: /C2_1 for PMingLiU (CJK), /Helv for Helvetica.
 *  No Resources dict in AP → font resolution inherits from page Resources. */
function setBlueAp(
  ctx: any,
  widget: any,
  value: string,
  isCjk: boolean,
  fontSize: number,
  rect: { w: number; h: number },
): void {
  const fontName = isCjk ? "C2_1" : "Helv";

  let textOp: string;
  if (isCjk) {
    // UTF-16BE hex with BOM
    let hex = "FEFF";
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
        const lo = value.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          const cp = 0x10000 + (code - 0xD800) * 0x400 + (lo - 0xDC00);
          hex += cp.toString(16).padStart(8, "0").toUpperCase();
          i++;
          continue;
        }
      }
      hex += (code >> 8).toString(16).padStart(2, "0").toUpperCase();
      hex += (code & 0xFF).toString(16).padStart(2, "0").toUpperCase();
    }
    textOp = `<${hex}> Tj`;
  } else {
    const escaped = value.replace(/([()\\])/g, "\\$1");
    textOp = `(${escaped}) Tj`;
  }

  const w = rect.w;
  const h = rect.h;
  const textX = 2;
  const textY = Math.max(2, h * 0.15);

  // AP content: blue background + black text
  const apContent = [
    "/Tx BMC",
    "q",
    "0.91 0.93 0.96 rg",
    `0 0 ${w.toFixed(1)} ${h.toFixed(1)} re`,
    "f",
    "Q",
    "BT",
    `/${fontName} ${fontSize} Tf`,
    "0 0 0 rg",
    `${textX.toFixed(1)} ${textY.toFixed(1)} Td`,
    textOp,
    "ET",
    "EMC",
  ].join("\n");

  // Build Form XObject (NO Resources — inherits from page)
  const bbox = PDFArray.withContext(ctx);
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(Math.ceil(w)));
  bbox.push(PDFNumber.of(Math.ceil(h)));

  const dict = ctx.obj({});
  dict.set(PDFName.of("Type"), PDFName.of("XObject"));
  dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  dict.set(PDFName.of("BBox"), bbox);

  const apStream = ctx.stream(new TextEncoder().encode(apContent), dict);
  const apRef = ctx.register(apStream);

  const apDict = ctx.obj({});
  apDict.set(PDFName.of("N"), apRef);
  widget.set(PDFName.of("AP"), apDict);

  // Set /V
  if (isCjk) {
    widget.set(PDFName.of("V"), PDFHexString.fromText(value));
  } else {
    widget.set(PDFName.of("V"), PDFString.of(value));
  }
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      fields?: Record<string, unknown>;
      checkboxes?: string[];
    };

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE_NAME);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

    // Embed Helvetica (lightweight Standard font) for ASCII fields
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const form = pdfDoc.getForm();
    const ctx = (pdfDoc as any).context;
    const pages = pdfDoc.getPages();

    // Fill text fields with custom blue AP
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;

        // Use standard API to register with form model
        form.getTextField(name).setText(vstr);

        // Find widget and generate custom blue AP
        const hasCjk = /[^\x00-\x7F]/.test(vstr);
        // Determine fontSize from widget /DA or default 10
        let fontSize = hasCjk ? 11 : 10;

        // Walk pages to find the widget annotation for this field
        for (const page of pages) {
          const annots = page.node.lookup(PDFName.of("Annots")) as any;
          if (!annots || typeof annots.size !== "function") continue;

          for (let j = 0; j < annots.size(); j++) {
            try {
              const widget = ctx.lookup(annots.get(j)) as any;
              if (!widget || typeof widget.get !== "function") continue;
              const subtype = widget.get(PDFName.of("Subtype"));
              if (!subtype || String(subtype) !== "/Widget") continue;

              // Check if this widget belongs to our field
              let widgetName = "";
              const tVal = widget.get(PDFName.of("T"));
              if (tVal instanceof PDFString) widgetName = tVal.decodeText();

              // Also check parent name
              if (!widgetName) {
                const parentRef = widget.get(PDFName.of("Parent"));
                if (parentRef) {
                  try {
                    const parent = ctx.lookup(parentRef);
                    const pT = parent.get(PDFName.of("T"));
                    if (pT instanceof PDFString) widgetName = pT.decodeText();
                  } catch { /* skip */ }
                }
              }

              // pdf-lib may rename fields internally — match by suffix
              if (widgetName !== name && !name.endsWith(widgetName) && !widgetName.endsWith(name)) continue;

              // Get rect
              const rectArr = widget.get(PDFName.of("Rect")) as any;
              if (!rectArr || typeof rectArr.get !== "function") continue;
              const w = rectArr.get(2).valueOf() - rectArr.get(0).valueOf();
              const h = rectArr.get(3).valueOf() - rectArr.get(1).valueOf();
              if (w <= 2 || h <= 2) continue;

              setBlueAp(ctx, widget, vstr, hasCjk, fontSize, { w, h });
              break; // Only process first matching widget
            } catch { /* skip */ }
          }
        }
      } catch { /* field missing — skip */ }
    }

    // Check checkboxes
    for (const name of data.checkboxes || []) {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    }

    // Save — 不 flatten，updateFieldAppearances:false 保留自定义蓝框 AP
    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
