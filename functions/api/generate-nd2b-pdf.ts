// POST /api/generate-nd2b-pdf
// 更改公司秘書及董事詳情通知書 —— 移植自 local-server/server.py:_fill_nd2b_pdf()
// body: { brNumber, companyName, role, identity, nameEnglish, nameChinese, idNumber,
//         changeType, newAddress, effectiveDate, signerName, signDate,
//         presentorName, presentorAddress, presentorContact }
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

// Font loaded from R2 (more reliable than external CDN in Workers runtime)

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Split address like Flask: comma OR space before known HK address prefix
const ADDR_SPLIT_RE = /,\s*|\s+(?=(?:rm|room|flat|unit|suite|shop|floor|flr|fl|block|blk|blc|tower|twr)\b)/i;

function splitAddress(raw: string): string[] {
  return raw.split(ADDR_SPLIT_RE).map(p => p.trim()).filter(Boolean);
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const data = await request.json() as Record<string, string>;

    const [templateObj, fontObj] = await Promise.all([
      env.PDF_TEMPLATES.get("ND2B-template.pdf"),
      env.PDF_TEMPLATES.get("NotoSansTC.woff2").catch(() => null),
    ]);
    if (!templateObj) return jsonResp({ error: "Template not found: ND2B-template.pdf" }, 404);

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer());
    let font: any = undefined;
    let fontError: string | null = null;
    if (fontObj) {
      try {
        pdfDoc.registerFontkit(fontkit);
        font = await pdfDoc.embedFont(await fontObj.arrayBuffer());
        console.log("Font embedded from R2:", font.name);
      } catch (e: any) {
        fontError = e.message || String(e);
        console.error("Font embed error:", fontError);
      }
    } else {
      fontError = "Font not found in R2 (NotoSansTC.woff2)";
      console.error(fontError);
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

    // 英文姓名拆分：姓=第一個詞，其餘=後面所有詞（與 Flask _parse_english_name 一致）
    const nameParts = (data.nameEnglish || "").trim().split(/\s+/).filter(Boolean);
    let surname = "", other = "";
    if (nameParts.length > 1) {
      surname = nameParts[0];           // first word = surname (matches Flask)
      other = nameParts.slice(1).join(" ");
    } else if (nameParts.length === 1) {
      surname = nameParts[0];
    }

    // === PAGE 1 (P.1) — 公司資料 & 申報人資料 ===
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

      // === PAGE 2 (P.2) — Section B: 變更詳情（地址變更） ===
      if (data.changeType === "address" && data.newAddress) {
        const parts = splitAddress(data.newAddress);
        if (parts.length > 0) setF("fill_19_P.2", parts[0]);
        if (parts.length > 1) setF("fill_20_P.2", parts[1]);
        if (parts.length > 2) setF("fill_21_P.2", parts[2]);
        if (parts.length > 3) setF("fill_22_P.2", parts[3]);
        if (parts.length > 4) setF("fill_23_P.2", parts.slice(4).join(", "));
      }

      // === PAGE 6 (P.6) — PI-ND2B: 受保護資料 ===
      checkF(role === "secretary" ? "cb_1_P.6" : "cb_2_P.6");
      setF("fill_2_P.6", data.nameChinese);
      setF("fill_3_P.6", surname);
      setF("fill_4_P.6", other);
      if (data.newAddress) {
        const parts6 = splitAddress(data.newAddress);
        if (parts6.length > 0) setF("fill_9_P.6", parts6[0]);
        if (parts6.length > 1) setF("fill_10_P.6", parts6[1]);
        if (parts6.length > 2) setF("fill_11_P.6", parts6[2]);
        if (parts6.length > 3) setF("fill_12_P.6", parts6[3]);
        if (parts6.length > 4) setF("fill_13_P.6", parts6.slice(4).join(", "));
      }
    }

    // === 提交人（P.1 底部） ===
    setF("fill_8_P.1", data.presentorName);
    setF("fill_9_P.1", data.presentorAddress);
    setF("fill_10_P.1", data.presentorContact);

    // === PAGE 3 (P.3) — 簽署 ===
    setF("fill_30_P.3", data.signerName);
    setF("fill_31_P.3", data.signDate);

    // === BR on all pages ===
    for (let pi = 2; pi <= pdfDoc.getPageCount(); pi++) {
      setF(`fill_1_P.${pi}`, br8);
    }

    // Flatten form fields into page content (makes values visible in all viewers)
    form.flatten();

    // ⚠️ 不删页：保留模板全部页面（仅 NAR1 可以删空页）
    const pdfBytes = await pdfDoc.save();
    const result: any = { pdf: uint8ToBase64(new Uint8Array(pdfBytes)) };
    if (fontError) result._fontError = fontError;
    if (!font) result._fontMissing = true;
    return jsonResp(result);
  } catch (err: any) {
    console.error("ND2B generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
