// POST /api/generate-nn6-pdf
// 非香港公司更改秘書及董事（委任/停任）—— 移植自 local-server/server.py:_fill_nd2a_pdf(template='NN6-template.pdf')
// body: { brNumber, companyName, officers[], signerName, signDate, presentorName, presentorAddress, presentorContact }

import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

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
  corpSignerName?: string;
  corpSignDate?: string;
}

const TEMPLATE = "NN6-template.pdf";

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

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

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE}` }, 404);

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer());
    // Skip CJK font embedding for NN6 (large template, limited CPU)
    // Use Helvetica only — ASCII fields still render correctly
    const asciiFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const cjk = asciiFont; // fallback for ASCII-only
    const form = pdfDoc.getForm();

    const setF = (name: string, value?: string) => {
      if (value == null || value === "") return;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        // skip updateAppearances to save CPU for large templates
      } catch { /* skip */ }
    };
    const checkF = (name: string) => {
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    };

    const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);
    setF("fill_1_P.1", br8);
    setF("fill_2_P.1", data.companyName);

    const officers = (data.officers || []).slice(0, 3);
    officers.forEach((officer, i) => {
      const isNatural = (officer.identity || "natural") === "natural";
      const p = isNatural ? i * 2 + 2 : i * 2 + 3; // 自然人 P.2/4/6，法人 P.3/5/7

      if (isNatural) {
        setF(`fill_3_P.${p}`, officer.nameEnglish);
        setF(`fill_4_P.${p}`, officer.nameChinese);
        setF(`fill_7_P.${p}`, officer.idNumber);
        setF(`fill_8_P.${p}`, officer.address);
        if (officer.type !== 'cessation' && officer.dateAppointed) {
          const parts = officer.dateAppointed.split(/[-/]/);
          if (parts.length >= 3) {
            setF(`fill_9_P.${p}`, parts[2]);
            setF(`fill_10_P.${p}`, parts[1]);
            setF(`fill_11_P.${p}`, parts[0]);
          }
        }
      } else {
        setF(`fill_3_P.${p}`, officer.nameChinese || "");
        setF(`fill_4_P.${p}`, officer.companyName || officer.nameEnglish || "");
        setF(`fill_11_P.${p}`, officer.companyNumber || "");
        setF(`fill_10_P.${p}`, officer.email || "");
        setF(`fill_5_P.${p}`, (officer as any).addrFlatBlock || officer.address || "");
        if (officer.type !== 'cessation' && officer.dateAppointed) {
          const corpParts = officer.dateAppointed.split(/[-/]/);
          if (corpParts.length >= 3) {
            setF(`fill_12_P.${p}`, corpParts[2]);
            setF(`fill_13_P.${p}`, corpParts[1]);
            setF(`fill_14_P.${p}`, corpParts[0]);
          }
        }
        setF(`fill_19_P.${p}`, (officer as any).corpSignerName || "");
        const signDate = (officer as any).corpSignDate || "";
        if (signDate) setF(`fill_20_P.${p}`, signDate);
        if ((officer as any).hasCessation && officer.dateCeased) {
          setF(`fill_15_P.${p}`, "1");
        }
      }

      checkF(officer.role === "secretary" ? `cb_1_P.${p}` : `cb_2_P.${p}`);
      checkF(officer.type === "appointment" ? `cb_3_P.${p}` : `cb_4_P.${p}`);

      // Cessation handling
      if ((officer as any).hasCessation && officer.dateCeased) {
        const cessId = (officer as any).cessationIdentity || 'natural';
        if (cessId === 'natural') {
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

    // Signer + Presenter (P.1 bottom)
    const sd = (data.signDate || "").split(/[-/]/);
    if (sd.length >= 3) setF("fill_11_P.1", `${sd[2]}/${sd[1]}/${sd[0]}`);
    setF("fill_12_P.1", data.signerName);
    setF("fill_13_P.1", data.presentorName);
    setF("fill_14_P.1", data.presentorContact);
    setF("fill_15_P.1", data.presentorAddress);

    // Don't flatten — saves CPU for large templates
    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("NN6 generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
