// POST /api/generate-nn6-pdf
// 非香港公司更改秘書及董事（委任/停任）—— 移植自 local-server/server.py:_fill_nd2a_pdf(template='NN6-template.pdf')
// body: { brNumber, companyName, officers[], signerName, signDate, presentorName, presentorAddress, presentorContact }
// resp: { pdf: '<base64>' }

import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

interface Env {
  PDF_TEMPLATES: R2Bucket;
}

interface Officer {
  type?: "appointment" | "cessation";
  role?: "director" | "secretary";
  identity?: "natural" | "corporate";
  nameChinese?: string;
  nameEnglish?: string;
  idNumber?: string;
  address?: string;
  addrFlatBlock?: string;
  email?: string;
  dateAppointed?: string;
  dateCeased?: string;
  companyName?: string;
  companyNumber?: string;
  hasCessation?: boolean;
  cessationIdentity?: "natural" | "corporate";
  cessationRole?: "director" | "secretary" | "alternate";
  cessationAlternateTo?: string;
  cessationNameChinese?: string;
  cessationNameSurname?: string;
  cessationNameOtherNames?: string;
  cessationNameEnglish?: string;
  cessationIdNumber?: string;
  cessationPassportNumber?: string;
  cessationAlreadyDirector?: "yes" | "no" | "";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHINESE_FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2";

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
    const data = await request.json() as {
      brNumber?: string;
      companyName?: string;
      officers?: Officer[];
      signerName?: string;
      signDate?: string;
      presentorName?: string;
      presentorAddress?: string;
      presentorContact?: string;
    };

    const [templateObj, fontResponse] = await Promise.all([
      env.PDF_TEMPLATES.get("NN6-template.pdf"),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);
    if (!templateObj) return jsonResp({ error: "Template not found: NN6-template.pdf" }, 404);

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer());
    let font: any = undefined;
    if (fontResponse.ok) {
      pdfDoc.registerFontkit(fontkit);
      font = await pdfDoc.embedFont(await fontResponse.arrayBuffer());
    }
    const form = pdfDoc.getForm();

    const usedPages = new Set<number>([1]); // P.1 始終保留（1-based）

    const setF = (name: string, value?: string) => {
      if (value == null || value === "") return;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        if (font) tf.updateAppearances(font);
      } catch { /* skip */ }
    };
    const checkF = (name: string) => {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    };

    // BR：去非字母數字後取前 8 位
    const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);
    setF("fill_1_P.1", br8);
    setF("fill_2_P.1", data.companyName);

    const officers = (data.officers || []).slice(0, 3);
    officers.forEach((officer, i) => {
      const isNatural = (officer.identity || "natural") === "natural";
      const p = isNatural ? i * 2 + 2 : i * 2 + 3; // 自然人 P.2/4/6，法人 P.3/5/7
      usedPages.add(p);

      if (isNatural) {
        setF(`fill_3_P.${p}`, officer.nameEnglish);
        setF(`fill_4_P.${p}`, officer.nameChinese);
        setF(`fill_7_P.${p}`, officer.idNumber);
        setF(`fill_8_P.${p}`, officer.address);
        // fill_9/10/11 = 委任日期，只填委任，停任不写
        if (officer.type !== 'cessation' && officer.dateAppointed) {
          const parts = officer.dateAppointed.split(/[-/]/);
          if (parts.length >= 3) {
            setF(`fill_9_P.${p}`, parts[2]);  // 日
            setF(`fill_10_P.${p}`, parts[1]); // 月
            setF(`fill_11_P.${p}`, parts[0]); // 年
          }
        }
      } else {
        // 法人：中文名、英文名、商業登記號碼、電郵、地址
        setF(`fill_3_P.${p}`, officer.nameChinese || "");
        setF(`fill_4_P.${p}`, officer.companyName || officer.nameEnglish || "");
        setF(`fill_11_P.${p}`, officer.companyNumber || "");
        setF(`fill_10_P.${p}`, officer.email || "");
        setF(`fill_5_P.${p}`, (officer as any).addrFlatBlock || officer.address || "");
        // 委任日期（法人）：只填委任，停任不写
        if (officer.type !== 'cessation' && officer.dateAppointed) {
          const corpParts = officer.dateAppointed.split(/[-/]/);
          if (corpParts.length >= 3) {
            setF(`fill_12_P.${p}`, corpParts[2]);  // 日
            setF(`fill_13_P.${p}`, corpParts[1]);  // 月
            setF(`fill_14_P.${p}`, corpParts[0]);  // 年
          }
        }
        // 簽署人姓名 + 簽署日期（P.3 底部）
        setF(`fill_19_P.${p}`, (officer as any).corpSignerName || "");
        const signDate = (officer as any).corpSignDate || "";
        if (signDate) {
          setF(`fill_20_P.${p}`, signDate);
        }
        // 續頁頁數
        if ((officer as any).hasCessation && officer.dateCeased) {
          setF(`fill_15_P.${p}`, "1");  // 續頁A
        }
      }

      // checkbox：角色 & 委任/停任
      checkF(officer.role === "secretary" ? `cb_1_P.${p}` : `cb_2_P.${p}`);
      checkF(officer.type === "appointment" ? `cb_3_P.${p}` : `cb_4_P.${p}`);

      // 停任操作
      if ((officer as any).hasCessation && officer.dateCeased) {
        const cessId = (officer as any).cessationIdentity || 'natural';
        if (cessId === 'natural') {
          // P.4 自然人停任
          usedPages.add(4);
          setF('fill_3_P.4', (officer as any).cessationNameChinese || '');
          setF('fill_4_P.4', (officer as any).cessationNameSurname || '');
          setF('fill_5_P.4', (officer as any).cessationNameOtherNames || '');
          setF('fill_6_P.4', (officer as any).cessationIdNumber || '');
          setF('fill_7_P.4', (officer as any).cessationPassportNumber || '');
          const d = officer.dateCeased.split(/[-/]/);
          if (d.length >= 3) { setF('fill_10_P.4', d[2]); setF('fill_11_P.4', d[1]); setF('fill_12_P.4', d[0]); }
          const cr = (officer as any).cessationRole || officer.role || 'director';
          checkF(cr === 'secretary' ? 'cb_1_P.4' : 'cb_2_P.4');
        } else {
          // P.5 法人停任
          usedPages.add(5);
          setF('fill_3_P.5', (officer as any).cessationNameEnglish || officer.companyName || officer.nameEnglish || '');
          setF('fill_4_P.5', (officer as any).cessationNameChinese || officer.nameChinese || '');
          setF('fill_5_P.5', officer.companyNumber || '');
          const d = officer.dateCeased.split(/[-/]/);
          if (d.length >= 3) { setF('fill_11_P.5', d[2]); setF('fill_12_P.5', d[1]); setF('fill_13_P.5', d[0]); }
          const cr = (officer as any).cessationRole || officer.role || 'director';
          checkF(cr === 'secretary' ? 'cb_1_P.5' : 'cb_2_P.5');
        }
      }
    });

    // 簽署人 + 提交人（P.1 底部）
    const sd = (data.signDate || "").split(/[-/]/);
    if (sd.length >= 3) setF("fill_11_P.1", `${sd[2]}/${sd[1]}/${sd[0]}`); // 反轉成 D/M/Y
    setF("fill_12_P.1", data.signerName);
    setF("fill_13_P.1", data.presentorName);
    // fill_15 is tall multi-line (44px) → address; fill_14 is short (14px) → contact
    setF("fill_14_P.1", data.presentorContact);
    setF("fill_15_P.1", data.presentorAddress);

    form.flatten();

    // ⚠️ 不删页：保留模板全部页面（仅 NAR1 可以删空页）
    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("NN6 generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
