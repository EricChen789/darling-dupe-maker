// POST /api/generate-ndr1-pdf
// NDR1 撤銷註冊申請書 — Cloudflare Functions (pdf-lib)
// Updated 2026-08-02: applicant capacity checkbox fix, P.2 name split, P.3 Section 2C, presenter fields

import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  parseEnglishName
} from "./_pdf-utils";
import { enableNeedAppearances } from "./_acroform";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE = "NDR1-template.pdf";

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as Record<string, any>;
    if (!data) return jsonResp({ error: "Empty request body" }, 400);

    // ── Load template & fonts ──
    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE}` }, 404);

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer());
    enableNeedAppearances(pdfDoc);
    const asciiFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const form = pdfDoc.getForm();

    // ── Helpers ──
    const setF = (name: string, value: any) => {
      if (value === null || value === undefined || value === "") return;
      try { form.getTextField(name).setText(String(value)); } catch { /* skip */ }
    };
    const checkF = (name: string, shouldCheck: any) => {
      if (!shouldCheck) return;
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    };

    const br8 = String(data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);
    const appCapacity = data.applicantCapacity || "";
    const appType = appCapacity === "company" ? "corporate" : "natural";

    // ═══ P.1: Company Info ═══
    setF("fill_1_P.1", br8);
    setF("fill_2_P.1", data.companyName);

    // ═══ P.1: A. Applicant Capacity checkboxes (cb_1~cb_3_P.1) ═══
    // cb_1 = 上述公司, cb_2 = 上述公司的一名董事, cb_3 = 上述公司的一名成員
    checkF("cb_1_P.1", appCapacity === "company");
    checkF("cb_2_P.1", appCapacity === "director");
    checkF("cb_3_P.1", appCapacity === "member");

    // ═══ P.1 左下角: Presenter info ═══
    setF("fill_3_P.1", data.presenterNameCN);
    setF("fill_4_P.1", data.presenterNameEN);
    setF("fill_5_P.1", data.presenterAddress1);
    setF("fill_6_P.1", data.presenterAddress2);
    setF("fill_7_P.1", data.presenterAddress3);
    setF("fill_8_P.1", data.presenterTel);
    setF("fill_9_P.1", data.presenterFax);
    setF("fill_10_P.1", data.presenterEmail);
    setF("fill_11_P.1", data.presenterReference);

    // ═══ P.2: B. Applicant Details ═══
    setF("fill_1_P.2", br8);

    if (appType === "corporate") {
      // Body corporate — only fill body corp name
      setF("fill_5_P.2", data.appBodyCorpName || data.companyName);
    } else {
      // Natural person — Chinese name, English surname, English other names
      let surname = data.appSurname || "";
      let other = data.appOtherNames || "";
      // Fallback: parse from flat name field
      if (!surname && !other) {
        const en = data.appName || data.applicantNameEN || "";
        if (en) {
          const parsed = parseEnglishName(en);
          surname = parsed.surname;
          other = parsed.otherNames;
        }
      }
      setF("fill_2_P.2", data.appChineseName || data.applicantNameCN);
      setF("fill_3_P.2", surname);
      setF("fill_4_P.2", other);
    }

    // P.2 Address (5 lines)
    setF("fill_6_P.2", data.appAddrFlat);
    setF("fill_7_P.2", data.appAddrBuilding);
    setF("fill_8_P.2", data.appAddrStreet);
    setF("fill_9_P.2", data.appAddrDistrict);
    setF("fill_10_P.2", data.appAddrCountry);
    setF("fill_11_P.2", data.appEmail);
    if (data.appFax || data.appTel) setF("fill_12_P.2", data.appFax || data.appTel);

    // ═══ P.3: C. Nominated Natural Person (only if applicant is the company) ═══
    if (appCapacity === "company") {
      let nomSurname = data.nomSurname || "";
      let nomOther = data.nomOtherNames || "";
      if (!nomSurname && !nomOther) {
        const nomEn = data.nomName || data.nomNameEnglish || "";
        if (nomEn) {
          const parsed = parseEnglishName(nomEn);
          nomSurname = parsed.surname;
          nomOther = parsed.otherNames;
        }
      }
      setF("fill_2_P.3", data.nomChineseName);
      setF("fill_3_P.3", nomSurname);
      setF("fill_4_P.3", nomOther);
      setF("fill_6_P.3", data.nomAddrFlat);
      setF("fill_7_P.3", data.nomAddrBuilding);
      setF("fill_8_P.3", data.nomAddrStreet);
      setF("fill_9_P.3", data.nomAddrDistrict);
      setF("fill_10_P.3", data.nomAddrCountry);
      setF("fill_11_P.3", data.nomEmail);
      if (data.nomFax) setF("fill_12_P.3", data.nomFax);
    }

    // ═══ P.4: Signer ═══
    setF("fill_1_P.4", br8);
    setF("fill_2_P.4", data.signerName);

    let signDate = data.signDate || "";
    if (signDate && signDate.includes("-")) {
      const parts = signDate.split("-");
      if (parts.length >= 3) signDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    setF("fill_3_P.4", signDate);

    // P.4 declarations
    checkF("cb_1_P.4", true);  // 已獲全體成員書面同意
    checkF("cb_2_P.4", true);  // 已遵守公司條例要求

    // ── Stamp BR on all pages ──
    for (let pi = 2; pi <= pdfDoc.getPageCount(); pi++) {
      try { form.getTextField(`fill_1_P.${pi}`).setText(br8); } catch { /* no BR field */ }
    }

    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("[NDR1] generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
