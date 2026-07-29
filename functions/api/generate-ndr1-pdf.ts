// POST /api/generate-ndr1-pdf
// NDR1 撤銷註冊申請書 — Cloudflare Functions (pdf-lib)
// Ported from local-server/server.py:_fill_ndr1_pdf
//
// Template layout (from PDF):
//   P.1: BR + Company Name + declarations (3 checkboxes) + applicant info
//   P.2-P.3: Natural person applicant details (name/address/email/tel)
//   P.4: Signer name + date

import { PDFDocument } from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
  fetchAndEmbedFont, parseEnglishName
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE = "NDR1-template.pdf";

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
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
    const { cjk, ascii } = await fetchAndEmbedFont(pdfDoc, env as any);
    const form = pdfDoc.getForm();

    // ── Helper: set text field ──
    const setF = (name: string, value: any) => {
      if (value === null || value === undefined || value === "") return;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        if (cjk) tf.updateAppearances(cjk);
      } catch { /* skip */ }
    };

    // ── Helper: checkbox ──
    const checkF = (name: string, shouldCheck: any) => {
      if (!shouldCheck) return;
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    };

    // ── Clean BR number ──
    const br8 = String(data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

    // ═══ P.1: Company Info ═══
    setF("fill_1_P.1", br8);
    setF("fill_2_P.1", data.companyName);

    // Declarations
    checkF("cb_1_P.1", data.noOngoingBusiness);
    checkF("cb_2_P.1", data.noOutstandingLiabilities);
    checkF("cb_3_P.1", data.noLegalProceedings);

    // Applicant info
    setF("fill_3_P.1", data.applicantNameCN);
    setF("fill_4_P.1", data.applicantNameEN);
    setF("fill_5_P.1", data.applicantAddress);
    setF("fill_6_P.1", data.applicantAddress2);
    setF("fill_7_P.1", data.applicantAddress3);
    setF("fill_8_P.1", data.applicantTel);
    setF("fill_9_P.1", data.applicantFax);
    setF("fill_10_P.1", data.applicantEmail);
    setF("fill_11_P.1", data.applicantReference);

    // ═══ P.4: Signer + Date ═══
    setF("fill_2_P.4", data.signerName);

    let signDate = data.signDate || "";
    if (signDate && signDate.includes("-")) {
      const parts = signDate.split("-");
      if (parts.length >= 3) signDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
    } else if (!signDate) {
      const dd = data.signDateDay || "";
      const mm = data.signDateMonth || "";
      const yy = data.signDateYear || "";
      if (dd && mm && yy) signDate = `${dd}/${mm}/${yy}`;
    }
    setF("fill_3_P.4", signDate);

    // ═══ P.2-P.3: Natural Person Applicant Details ═══
    const person = data.selectedPerson;
    if (person) {
      const cn = person.nameChinese || "";
      const en = person.nameEnglish || "";
      const { surname, otherNames } = parseEnglishName(en);
      const flat = person.addrFlat || "";
      const building = person.addrBuilding || "";
      const street = person.addrStreet || "";
      const district = person.addrDistrict || "";
      const region = person.addrRegion || "";
      const email = person.email || "";
      const tel = person.phone || "";

      // P.2: 1st natural person applicant
      setF("fill_1_P.2", br8);
      setF("fill_2_P.2", cn);
      setF("fill_3_P.2", surname);
      setF("fill_4_P.2", otherNames);
      setF("fill_6_P.2", flat);
      setF("fill_7_P.2", building);
      setF("fill_8_P.2", street);
      setF("fill_9_P.2", district);
      setF("fill_10_P.2", region);
      setF("fill_11_P.2", email);
      if (tel) setF("fill_12_P.2", tel);
    }

    // ── Stamp BR on all pages ──
    for (let pi = 2; pi <= pdfDoc.getPageCount(); pi++) {
      try {
        const tf = form.getTextField(`fill_1_P.${pi}`);
        if (tf) {
          tf.setText(br8);
          if (cjk) tf.updateAppearances(cjk);
        }
      } catch { /* no BR field */ }
    }

    // ── Flatten and save ──
    form.flatten();
    const pdfBytes = await pdfDoc.save();
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("[NDR1] generation error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
