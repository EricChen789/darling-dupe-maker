// POST /api/generate-nn7-pdf
// 非香港公司更改秘书及董事详情 —— 移植自 local-server/server.py:_fill_nd2b_pdf(template='NN7-template.pdf')
// body: { brNumber, companyName, role, identity, nameEnglish, nameChinese, idNumber, address,
//         changeType, newNameEnglish, newNameChinese, newIdNumber, newAddress, changeDescription,
//         effectiveDate, signerName, signDate, presentorName, presentorAddress, presentorContact }
// resp: { pdf: '<base64>' }

import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

interface Env {
  PDF_TEMPLATES: R2Bucket;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const data = await request.json() as Record<string, string>;

    const [templateObj, fontResponse] = await Promise.all([
      env.PDF_TEMPLATES.get("NN7-template.pdf"),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);
    if (!templateObj) return jsonResp({ error: "Template not found: NN7-template.pdf" }, 404);

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer());
    let font: any = undefined;
    if (fontResponse.ok) {
      pdfDoc.registerFontkit(fontkit);
      font = await pdfDoc.embedFont(await fontResponse.arrayBuffer());
    }
    const form = pdfDoc.getForm();

    const usedPages = new Set<number>([1]);
    const pageOf = (name: string): number | null => {
      const m = name.match(/_P\.(\d+)$/);
      return m ? parseInt(m[1], 10) : null;
    };
    const setF = (name: string, value?: string) => {
      if (value == null || value === "") return;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        if (font) tf.updateAppearances(font);
        const pg = pageOf(name);
        if (pg) usedPages.add(pg);
      } catch { /* skip */ }
    };
    const checkF = (name: string) => {
      try {
        form.getCheckBox(name).check();
        const pg = pageOf(name);
        if (pg) usedPages.add(pg);
      } catch { /* skip */ }
    };

    const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

    // 英文姓名拆分：姓=最后一段，其余=前面所有段
    const nameParts = (data.nameEnglish || "").trim().split(/\s+/).filter(Boolean);
    let surname = "", other = "";
    if (nameParts.length > 1) {
      surname = nameParts[nameParts.length - 1];
      other = nameParts.slice(0, -1).join(" ");
    } else if (nameParts.length === 1) {
      surname = nameParts[0];
    }

    setF("fill_1_P.1", br8);
    setF("fill_2_P.1", data.companyName);

    const isNatural = (data.identity || "natural") === "natural";
    const role = data.role;

    if (isNatural) {
      checkF(role === "secretary" ? "cb_1_P.1" : "cb_2_P.1");
      setF("fill_3_P.1", data.nameChinese);
      setF("fill_4_P.1", surname);
      setF("fill_5_P.1", other);
      setF("fill_7_P.1", data.idNumber);

      // P.2 变更详情：目前后端仅支持地址变更
      if (data.changeType === "address" && data.newAddress) {
        setF("fill_19_P.2", data.newAddress);
      }

      // P.6 受保护资料
      checkF(role === "secretary" ? "cb_1_P.6" : "cb_2_P.6");
      setF("fill_2_P.6", data.nameChinese);
      setF("fill_3_P.6", surname);
      setF("fill_4_P.6", other);
      setF("fill_9_P.6", data.newAddress);
    }

    // 提交人（P.1 底部）
    setF("fill_8_P.1", data.presentorName);
    setF("fill_9_P.1", data.presentorAddress);
    setF("fill_10_P.1", data.presentorContact);

    // P.3 签署（signDate 原样，不拆分）
    setF("fill_30_P.3", data.signerName);
    setF("fill_31_P.3", data.signDate);

    form.flatten();

    for (let pi = pdfDoc.getPageCount() - 1; pi >= 1; pi--) {
      if (!usedPages.has(pi + 1)) pdfDoc.removePage(pi);
    }

    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("NN7 generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
