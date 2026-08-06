// POST /api/generate-nnc2-pdf
// NNC2 更改公司名稱通知書 — 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
//   Strategy (学 NNC1 v9): 遍历页面 annotations → 直接修改 raw widget dict
//   - 自定义 AP = 蓝色背景 (0.91 0.93 0.96) + 文字
//   - CJK: 页面内建 /PMingLiU 字体 (无 font embedding，省 CPU)
//   - ASCII: StandardFonts.Helvetica
//   - widget.dict.set(/V) + widget.dict.set(/AP) 直接修改底层 dict
//   - 不 flatten + updateFieldAppearances:false

import {
  PDFDocument, StandardFonts, PDFName, PDFString,
  PDFArray, PDFNumber,
} from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC2-template.pdf";

/** Generate a custom AP stream with blue background + text.
 *  Sets /AP and /V on the raw widget dict (widget is a raw PDFDict from ctx.lookup).
 *  Font names resolve through page Resources (NO Resources dict in AP). */
function setBlueApOnDict(
  ctx: any,
  widget: any,  // raw PDFDict from ctx.lookup(annotRef)
  value: string,
  isCjk: boolean,
  fontSize: number,
  rectW: number,
  rectH: number,
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

  const w = rectW;
  const h = rectH;
  const textX = 2;
  const textY = Math.max(2, h * 0.15);

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

  // Build Form XObject
  const bbox = PDFArray.withContext(ctx);
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(Math.ceil(w)));
  bbox.push(PDFNumber.of(Math.ceil(h)));

  const xobjDict = ctx.obj({});
  xobjDict.set(PDFName.of("Type"), PDFName.of("XObject"));
  xobjDict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  xobjDict.set(PDFName.of("BBox"), bbox);

  const apStream = ctx.stream(new TextEncoder().encode(apContent), xobjDict);
  const apRef = ctx.register(apStream);

  const apDict = ctx.obj({});
  apDict.set(PDFName.of("N"), apRef);

  // Set /AP and /V on the raw widget dict (this is a PDFDict, .set() works)
  widget.set(PDFName.of("AP"), apDict);
  widget.set(PDFName.of("V"), PDFString.of(value));
}

/** Build a mapping from field suffix (e.g. "fill_2") to { pageIdx, annotIdx } */
function buildFieldMap(pdfDoc: any): Map<string, Array<{ pageIdx: number; annotIdx: number; fieldType: string; parentName: string }>> {
  const ctx = (pdfDoc as any).context;
  const pages = pdfDoc.getPages();
  const map = new Map<string, Array<{ pageIdx: number; annotIdx: number; fieldType: string; parentName: string }>>();

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const annots = page.node.lookup(PDFName.of("Annots")) as any;
    if (!annots || typeof annots.size !== "function") continue;

    for (let j = 0; j < annots.size(); j++) {
      try {
        const w = ctx.lookup(annots.get(j)) as any;
        if (!w || typeof w.get !== "function") continue;
        const subtype = w.get(PDFName.of("Subtype"));
        if (!subtype || String(subtype) !== "/Widget") continue;

        // Get field type
        const ft = w.get(PDFName.of("FT"));
        const fieldType = ft ? String(ft) : "";

        // Get field name from parent
        let parentName = "";
        const parentRef = w.get(PDFName.of("Parent"));
        if (parentRef) {
          try {
            const parent = ctx.lookup(parentRef);
            const pT = parent.get(PDFName.of("T"));
            if (pT instanceof PDFString) parentName = pT.decodeText();
          } catch { /* skip */ }
        }

        // Fallback: use widget's own /T
        if (!parentName) {
          const tVal = w.get(PDFName.of("T"));
          if (tVal instanceof PDFString) parentName = tVal.decodeText();
        }

        if (!parentName) continue;

        // Strip _P suffix (fill_2_P → fill_2)
        const suffix = parentName.replace(/_P$/, "");

        if (!map.has(suffix)) map.set(suffix, []);
        map.get(suffix)!.push({ pageIdx: pi, annotIdx: j, fieldType, parentName });

        // Also register full name: fill_2_P.1
        const fullName = `${suffix}_P.${pi + 1}`;
        if (fullName !== suffix) {
          if (!map.has(fullName)) map.set(fullName, []);
          map.get(fullName)!.push({ pageIdx: pi, annotIdx: j, fieldType, parentName });
        }
      } catch { /* skip */ }
    }
  }

  return map;
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    // Embed Helvetica for AP streams
    await pdfDoc.embedFont(StandardFonts.Helvetica);

    const ctx = (pdfDoc as any).context;
    const pages = pdfDoc.getPages();
    const form = pdfDoc.getForm();

    // Pre-scan: build field name → widget location map
    const fieldMap = buildFieldMap(pdfDoc);

    // Fill text fields with custom blue AP
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;

        const locations = fieldMap.get(name);
        if (!locations || locations.length === 0) continue;

        const hasCjk = /[^\x00-\x7F]/.test(vstr);
        const fontSize = hasCjk ? 11 : 10;

        for (const loc of locations) {
          if (loc.fieldType === "/Btn") continue; // Skip checkboxes

          const page = pages[loc.pageIdx];
          const annots = page.node.lookup(PDFName.of("Annots")) as any;
          const w = ctx.lookup(annots.get(loc.annotIdx)) as any;

          // Get rect
          const rectArr = w.get(PDFName.of("Rect")) as any;
          if (!rectArr || typeof rectArr.get !== "function") continue;
          const rw = rectArr.get(2).valueOf() - rectArr.get(0).valueOf();
          const rh = rectArr.get(3).valueOf() - rectArr.get(1).valueOf();
          if (rw <= 2 || rh <= 2) continue;

          setBlueApOnDict(ctx, w, vstr, hasCjk, fontSize, rw, rh);
        }

        // Also register with form model (so /Fields array is maintained)
        try { form.getTextField(name); } catch { /* skip */ }
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
