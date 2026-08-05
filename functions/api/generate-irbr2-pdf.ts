// POST /api/generate-irbr2-pdf
// IRBR2 致商業登記署通知書 — 非香港公司的補充表格
// 1 page, 5 text fields + 2 radio button groups
// Dual-layer approach: XFA datasets XML (for Adobe/XFA viewers) + AcroForm (for non-XFA viewers)
// Keep form interactive (no flatten) — preserve editable blue boxes.
//
// XFA datasets XML contains placeholders like <TextField1/> <RadioButtonList/>
// which we replace with actual values.

import {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFRef,
  decodePDFRawStream
} from "pdf-lib";
import {
  corsHeaders, jsonResp, uint8ToBase64,
} from "./_pdf-utils";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "IRBR2-template.pdf";

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      brNumber?: string;
      businessNameChinese?: string;
      businessNameEnglish?: string;
      businessNature?: string;
      commencementDate?: string;
      irbr2_registered?: boolean;
      irbr2_elect3yr?: boolean;
    };

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE_NAME);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

    const brNumber = (data.brNumber || "").trim();
    const nameCn = (data.businessNameChinese || "").trim();
    const nameEn = (data.businessNameEnglish || "").trim();
    const nature = (data.businessNature || "").trim();
    const commencement = (data.commencementDate || "").trim();
    const irbr2Registered = data.irbr2_registered !== false;
    const irbr2Elect3yr = data.irbr2_elect3yr !== false;

    // ── 1. Modify XFA datasets XML (for XFA-aware viewers like Adobe Acrobat) ──
    try {
      const acroFormDict = pdfDoc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
      const xfaArray = acroFormDict.lookup(PDFName.of('XFA'), PDFArray);
      // XFA array: [key0=string, ref0, key1=string, ref1, ...]
      // "datasets" is the 4th key → its ref is at index 7
      const datasetsRef = xfaArray.get(7) as any as PDFRef;
      const datasetsStream = pdfDoc.context.lookup(datasetsRef, PDFStream);
      const decoded = decodePDFRawStream(datasetsStream);
      let xmlText = new TextDecoder().decode(decoded.decode ? decoded.decode() : decoded);

      // Replace fields in document order:
      // TextField1 → brNumber, 3× TextField2 → nameCn/nameEn/nature,
      // DateTimeField1 → commencement, RadioButtonList[0] → elect3yr, RadioButtonList[1] → registered
      xmlText = xmlText.replace(
        /<TextField1\s*\/>/,
        brNumber ? `<TextField1>${escXml(brNumber)}</TextField1>` : '<TextField1/>'
      );
      xmlText = xmlText.replace(
        /<TextField2\s*\/>/,
        nameCn ? `<TextField2>${escXml(nameCn)}</TextField2>` : '<TextField2/>'
      );
      xmlText = xmlText.replace(
        /<TextField2\s*\/>/,
        nameEn ? `<TextField2>${escXml(nameEn)}</TextField2>` : '<TextField2/>'
      );
      xmlText = xmlText.replace(
        /<TextField2\s*\/>/,
        nature ? `<TextField2>${escXml(nature)}</TextField2>` : '<TextField2/>'
      );
      xmlText = xmlText.replace(
        /<DateTimeField1\s*\/>/,
        commencement ? `<DateTimeField1>${escXml(commencement)}</DateTimeField1>` : '<DateTimeField1/>'
      );
      // RadioButtonList[0] (first in XFA) = Elect 3-year certificate? (bottom)
      xmlText = xmlText.replace(
        /<RadioButtonList\s*\/>/,
        `<RadioButtonList>${irbr2Elect3yr ? '1' : '2'}</RadioButtonList>`
      );
      // RadioButtonList[1] (second in XFA) = Already registered under Cap.310? (top)
      xmlText = xmlText.replace(
        /<RadioButtonList\s*\/>/,
        `<RadioButtonList>${irbr2Registered ? '1' : '2'}</RadioButtonList>`
      );

      const newBytes = new TextEncoder().encode(xmlText);
      const newStream = pdfDoc.context.flateStream(newBytes);
      const newRef = pdfDoc.context.register(newStream);
      xfaArray.set(7, newRef);
    } catch (e) {
      console.warn("IRBR2 XFA modification error:", e);
    }

    // ── 2. Set AcroForm fields (for non-XFA viewers) ──
    const form = pdfDoc.getForm();
    try { if (brNumber) form.getTextField('topmostSubform[0].Page1[0].TextField1[0]').setText(brNumber); } catch (_) {}
    try { if (nameCn) form.getTextField('topmostSubform[0].Page1[0].TextField2[0]').setText(nameCn); } catch (_) {}
    try { if (nameEn) form.getTextField('topmostSubform[0].Page1[0].TextField2[1]').setText(nameEn); } catch (_) {}
    try { if (nature) form.getTextField('topmostSubform[0].Page1[0].TextField2[2]').setText(nature); } catch (_) {}
    try { if (commencement) form.getTextField('topmostSubform[0].Page1[0].DateTimeField1[0]').setText(commencement); } catch (_) {}

    // RadioButtonList[1] (top): Already registered under Cap.310?
    try {
      const rg1 = form.getRadioGroup('topmostSubform[0].Page1[0].RadioButtonList[1]');
      const o1 = rg1.getOptions();
      if (o1.length >= 2) rg1.select(irbr2Registered ? o1[0] : o1[1]);
    } catch (e) { console.warn("IRBR2 RadioButtonList[1] error:", e); }

    // RadioButtonList[0] (bottom): Elect 3-year certificate?
    try {
      const rg0 = form.getRadioGroup('topmostSubform[0].Page1[0].RadioButtonList[0]');
      const o0 = rg0.getOptions();
      if (o0.length >= 2) rg0.select(irbr2Elect3yr ? o0[0] : o0[1]);
    } catch (e) { console.warn("IRBR2 RadioButtonList[0] error:", e); }

    // ── 3. Save — keep XFA, keep form interactive, keep editable blue boxes ──
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-irbr2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
