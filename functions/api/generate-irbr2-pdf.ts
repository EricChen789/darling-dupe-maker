// POST /api/generate-irbr2-pdf
// IRBR2 致商業登記署通知書 — 非香港公司的補充表格
// 学 IRBR1：删 XFA → 纯 AcroForm，acroField.setValue() 保留原始外观，不 flatten。

import { PDFDocument, PDFName, PDFDict, PDFString } from "pdf-lib";
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

    // ── 学 IRBR1：删 XFA → 纯 AcroForm ──
    try {
      const acroDict = pdfDoc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
      acroDict.delete(PDFName.of('XFA'));
    } catch (e) { console.warn("XFA removal error:", e); }

    const brNumber = (data.brNumber || "").trim();
    const nameCn = (data.businessNameChinese || "").trim();
    const nameEn = (data.businessNameEnglish || "").trim();
    const nature = (data.businessNature || "").trim();
    const commencement = (data.commencementDate || "").trim();
    const irbr2Registered = data.irbr2_registered !== false;
    const irbr2Elect3yr = data.irbr2_elect3yr !== false;

    const form = pdfDoc.getForm();

    // ── Text fields: acroField.setValue() — 只设 /V，不重新生成外观，保留蓝框 ──
    if (brNumber) form.getTextField('topmostSubform[0].Page1[0].TextField1[0]').acroField.setValue(PDFString.of(brNumber));
    if (nameCn) form.getTextField('topmostSubform[0].Page1[0].TextField2[0]').acroField.setValue(PDFString.of(nameCn));
    if (nameEn) form.getTextField('topmostSubform[0].Page1[0].TextField2[1]').acroField.setValue(PDFString.of(nameEn));
    if (nature) form.getTextField('topmostSubform[0].Page1[0].TextField2[2]').acroField.setValue(PDFString.of(nature));
    if (commencement) form.getTextField('topmostSubform[0].Page1[0].DateTimeField1[0]').acroField.setValue(PDFString.of(commencement));

    // ── RadioButtonList[1] (top): Already registered under Cap.310? ──
    try {
      const rg1 = form.getRadioGroup('topmostSubform[0].Page1[0].RadioButtonList[1]');
      const o1 = rg1.getOptions();
      if (o1.length >= 2) rg1.acroField.setValue(PDFName.of(irbr2Registered ? o1[0] : o1[1]));
    } catch (e) { console.warn("IRBR2 RadioButtonList[1] error:", e); }

    // ── RadioButtonList[0] (bottom): Elect 3-year certificate? ──
    try {
      const rg0 = form.getRadioGroup('topmostSubform[0].Page1[0].RadioButtonList[0]');
      const o0 = rg0.getOptions();
      if (o0.length >= 2) rg0.acroField.setValue(PDFName.of(irbr2Elect3yr ? o0[0] : o0[1]));
    } catch (e) { console.warn("IRBR2 RadioButtonList[0] error:", e); }

    // ── Save — keep form interactive, keep editable blue boxes ──
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-irbr2-pdf error:", err);
    return jsonResp({ error: err.message || "Internal server error" }, 500);
  }
}
