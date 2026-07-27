// POST /api/generate-ndr1-pdf
// NDR1 撤銷註冊申請書 — Cloudflare Functions (pdf-lib)
// Ported from local-server/server.py:_fill_ndr1_pdf
//
// Template layout (from PDF):
//   P.1: BR + Company Name + declarations (3 checkboxes) + applicant info (name/address/tel/fax/email/ref)
//   P.2-P.3: Natural person applicant details (name/address/email/tel)
//   P.4: Signer name + date
//
// body: { brNumber, companyName, noOngoingBusiness?, noOutstandingLiabilities?,
//         noLegalProceedings?, applicantNameCN?, applicantNameEN?, applicantAddress?,
//         applicantAddress2?, applicantAddress3?, applicantTel?, applicantFax?,
//         applicantEmail?, applicantReference?, signerName?, signDate?,
//         selectedPerson?: { nameChinese, nameEnglish, addrFlat, addrBuilding,
//           addrStreet, addrDistrict, addrRegion, email, phone } }

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

const CHINESE_FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2";
// Fallback: use a standard PDF font for ASCII; embed Noto Sans TC for CJK
const ASCII_FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans@latest/latin-400-normal.woff2";

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

/** Parse "CHAN TAI MAN" → { surname: "CHAN", other: "TAI MAN" } */
function parseEnglishName(fullName: string): { surname: string; other: string } {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0) return { surname: "", other: "" };
  if (parts.length === 1) return { surname: parts[0], other: "" };
  return { surname: parts[0], other: parts.slice(1).join(" ") };
}

/** Check if string contains CJK characters */
function hasCJK(text: string): boolean {
  return /[一-鿿㐀-䶿豈-﫿]/.test(text);
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const data = await request.json() as Record<string, any>;
    if (!data) return jsonResp({ error: "Empty request body" }, 400);

    // ── Load template & fonts ──
    const templateObj = await env.PDF_TEMPLATES.get("NDR1-template.pdf");
    if (!templateObj) return jsonResp({ error: "Template not found: NDR1-template.pdf" }, 404);

    const [templateBytes, cjkFontResp, asciiFontResp] = await Promise.all([
      templateObj.arrayBuffer(),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
      fetch(ASCII_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    const pdfDoc = await PDFDocument.load(templateBytes);
    pdfDoc.registerFontkit(fontkit);

    let cjkFont: any = undefined;
    let asciiFont: any = undefined;

    if (cjkFontResp.ok) {
      try {
        cjkFont = await pdfDoc.embedFont(await cjkFontResp.arrayBuffer());
      } catch (e) { /* fall through */ }
    }
    if (asciiFontResp.ok) {
      try {
        asciiFont = await pdfDoc.embedFont(await asciiFontResp.arrayBuffer());
      } catch (e) { /* fall through */ }
    }

    const form = pdfDoc.getForm();
    const font = cjkFont || asciiFont; // prefer CJK for mixed text

    // ── Helper: set text field value ──
    function setField(name: string, value: any, options?: { font?: any; fontSize?: number }) {
      if (value === null || value === undefined || value === "") return;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        const f = options?.font || font;
        if (f) {
          try {
            tf.updateAppearances(f);
          } catch { /* ok */ }
        }
      } catch { /* field not found, skip */ }
    }

    // ── Helper: check a checkbox ──
    function checkBox(name: string, shouldCheck: any) {
      if (!shouldCheck) return;
      try {
        form.getCheckBox(name).check();
      } catch { /* skip */ }
    }

    // ── Clean BR number ──
    const br8 = String(data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

    // ═══ P.1: Company Info ═══
    setField("fill_1_P.1", br8);
    setField("fill_2_P.1", data.companyName);

    // Declarations (3 checkboxes)
    checkBox("cb_1_P.1", data.noOngoingBusiness);
    checkBox("cb_2_P.1", data.noOutstandingLiabilities);
    checkBox("cb_3_P.1", data.noLegalProceedings);

    // Applicant info (P.1 bottom-left)
    setField("fill_3_P.1", data.applicantNameCN);      // Chinese name
    setField("fill_4_P.1", data.applicantNameEN);      // English name
    setField("fill_5_P.1", data.applicantAddress);      // Address line 1
    setField("fill_6_P.1", data.applicantAddress2);     // Address line 2
    setField("fill_7_P.1", data.applicantAddress3);     // Address line 3
    setField("fill_8_P.1", data.applicantTel);
    setField("fill_9_P.1", data.applicantFax);
    setField("fill_10_P.1", data.applicantEmail);
    setField("fill_11_P.1", data.applicantReference);

    // ═══ P.4: Signer + Date ═══
    setField("fill_2_P.4", data.signerName);

    // Date: YYYY-MM-DD → DD/MM/YYYY
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
    setField("fill_3_P.4", signDate);

    // ═══ P.2-P.3: Natural Person Applicant Details (when a person is selected) ═══
    const person = data.selectedPerson;
    if (person) {
      const cn = person.nameChinese || "";
      const en = person.nameEnglish || "";
      const { surname, other } = parseEnglishName(en);
      const flat = person.addrFlat || "";
      const building = person.addrBuilding || "";
      const street = person.addrStreet || "";
      const district = person.addrDistrict || "";
      const region = person.addrRegion || "";
      const email = person.email || "";
      const tel = person.phone || "";

      // P.2: 1st natural person applicant
      setField("fill_1_P.2", br8);
      setField("fill_2_P.2", cn);          // Chinese name (centered in Flask)
      setField("fill_3_P.2", surname);
      setField("fill_4_P.2", other);
      setField("fill_6_P.2", flat);
      setField("fill_7_P.2", building);
      setField("fill_8_P.2", street);
      setField("fill_9_P.2", district);
      setField("fill_10_P.2", region);
      setField("fill_11_P.2", email);
      if (tel) setField("fill_12_P.2", tel);
    }

    // ── Stamp BR on all pages that have a BR field ──
    const pages = pdfDoc.getPages();
    for (let i = 1; i < pages.length; i++) {
      try {
        const tf = form.getTextField(`fill_1_P.${i + 1}`);
        if (tf) {
          tf.setText(br8);
          if (font) tf.updateAppearances(font);
        }
      } catch { /* no BR field on this page */ }
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
