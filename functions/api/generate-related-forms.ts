// POST /api/generate-related-forms
// Phase 5.3: Batch generation of primary form + linked forms
// Translates data between forms and delegates to individual PDF generators.

import { PDFDocument, rgb } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  drawMixed, fetchAndEmbedFont, widthOfText,
} from './_pdf-utils';
import { verifyAuthRequest, type Env } from './_auth';

interface GenerateRelatedFormsRequest {
  primary_form: string;
  form_data: Record<string, any>;
  company_id: string;
  linked_forms: string[];
}

interface FormResult {
  form_code: string;
  pdf?: string;
  filename?: string;
  error?: string;
}

// ═══ Data Translators ═══
function translateFormData(
  primaryData: Record<string, any>,
  primaryForm: string,
  linkedForm: string
): Record<string, any> {
  if (primaryForm === "NR1" && linkedForm === "IRC3111A") {
    const newAddr = [
      primaryData.flat, primaryData.building,
      primaryData.street, primaryData.district, primaryData.region,
    ].filter(Boolean).join(", ");
    const effDate = [
      primaryData.addressEffectiveDay,
      primaryData.addressEffectiveMonth,
      primaryData.addressEffectiveYear,
    ].filter(Boolean).join("/");
    const signDate = [
      primaryData.signDateDay,
      primaryData.signDateMonth,
      primaryData.signDateYear,
    ].filter(Boolean).join("/");
    return {
      companyName: primaryData.companyName || "",
      brNumber: primaryData.brNumber || "",
      oldAddress: "",
      newAddress: newAddr,
      changeDate: effDate,
      signerName: primaryData.signerName || "",
      signDate: signDate,
    };
  }

  if (primaryForm === "NN9" && linkedForm === "IRC3111A") {
    const newAddr = [
      primaryData.newFlat || primaryData.flat,
      primaryData.newBuilding || primaryData.building,
      primaryData.newStreet || primaryData.street,
      primaryData.newDistrict || primaryData.district,
    ].filter(Boolean).join(", ");
    return {
      companyName: primaryData.companyName || "",
      brNumber: primaryData.brNumber || "",
      oldAddress: "",
      newAddress: newAddr,
      changeDate: primaryData.changeDate || "",
      signerName: primaryData.signerName || "",
      signDate: primaryData.signDate || "",
    };
  }

  if (primaryForm === "NDR1" && linkedForm === "IR1263") {
    return {
      companyName: primaryData.companyName || "",
      brNumber: primaryData.brNumber || "",
      applicationDate: primaryData.applicationDate || "",
    };
  }

  if (primaryForm === "ND2A" && linkedForm === "ND4") {
    return primaryData;
  }

  if (primaryForm === "NNC1" && linkedForm === "IRBR1") {
    return {
      irbr1_yes: true,
      brNumber: primaryData.brNumber || "",
    };
  }

  if (primaryForm === "NN1" && linkedForm === "IRBR2") {
    const fields = primaryData.fields || primaryData;
    return {
      brNumber: primaryData.brNumber || fields.br_number || "",
      businessNameChinese: primaryData.companyNameChinese || fields.nameChinese || "",
      businessNameEnglish: primaryData.companyName || fields.nameEnglish || "",
      businessNature: primaryData.businessNature || fields.businessNature || "",
      commencementDate: primaryData.commencementDate || fields.commencementDate || "",
      irbr2_registered: true,
      irbr2_elect3yr: true,
    };
  }

  return { ...primaryData };
}

// ═══ ND4 PDF Generator (template fill) ═══
async function generateND4Pdf(
  data: Record<string, any>,
  env: any
): Promise<Uint8Array> {
  // Load ND4 template from R2
  const r2Bucket = env.PDF_TEMPLATES || env.R2;
  if (!r2Bucket) throw new Error("R2 bucket not available");

  const templateObj = await r2Bucket.get("ND4-template.pdf");
  if (!templateObj) throw new Error("ND4-template.pdf not found in R2");

  const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
  const pdfDoc = await PDFDocument.load(templateBytes);
  const { cjk } = await fetchAndEmbedFont(pdfDoc, env);
  const form = pdfDoc.getForm();

  // Fill text fields with the same naming pattern as local Flask _fill_nd4_pdf
  const fields = data.fields || data;
  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    try {
      const tf = form.getTextField(name);
      tf.setText(String(value));
      if (cjk) tf.updateAppearances(cjk);
    } catch { /* field not found */ }
  }

  // Checkboxes
  for (const name of data.checkboxes || []) {
    try { form.getCheckBox(name).check(); } catch { /* skip */ }
  }

  form.flatten();
  return new Uint8Array(await pdfDoc.save());
}

// ═══ IR1263 PDF Generator (from scratch) ═══
async function generateIR1263Pdf(
  data: Record<string, any>,
  env: any
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { cjk, ascii } = await fetchAndEmbedFont(doc, env);

  const PAGE_W = 595, PAGE_H = 842;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = 800;
  const M = 50;
  const LH = 18;
  const BLUE = rgb(0, 0.2, 0.6);

  const drawLine = (text: string, size = 10, color?: any) => {
    if (y < 60) { page = doc.addPage([PAGE_W, PAGE_H]); y = 800; }
    drawMixed(page, text, { x: M, y, size, cjk, ascii, color });
    y -= LH;
  };

  const drawTitle = (text: string, size = 14) => {
    const w = widthOfText(text, cjk, ascii, size);
    drawMixed(page, text, { x: (PAGE_W - w) / 2, y, size, cjk, ascii, color: BLUE });
    y -= LH + 6;
  };

  const companyName = data.companyName || "";
  const brNumber = data.brNumber || "";
  const appDate = data.applicationDate || "";

  drawTitle("IR1263 — Notice of Cessation of Business", 14);
  drawTitle("IR1263 — 結束營業通知書", 12);
  y -= 8;

  drawLine("Inland Revenue Department  稅務局", 11, true);
  y -= 4;

  // Company info table
  const info: [string, string][] = [
    ["Company Name / 公司名稱", companyName],
    ["Business Registration No. / 商業登記號碼", brNumber],
    ["Date of Cessation / 結束營業日期", appDate],
  ];
  for (const [label, val] of info) {
    drawLine(label + "：", 10, true);
    drawLine("    " + (val || "＿＿＿＿＿＿＿＿＿"), 11);
    y -= 2;
  }

  // Declaration
  y -= 10;
  drawLine("Declaration / 聲明", 10, true);
  y -= 4;
  drawLine("I hereby declare that the above-mentioned business has ceased operation.", 9);
  drawLine("本人特此聲明上述業務已結束營業。", 9);

  // Signature
  y -= 16;
  drawLine("Signature / 簽署：＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿", 10);
  drawLine("Date / 日期：＿＿＿＿＿＿＿＿＿＿＿＿", 10);

  // Footer
  const today = new Date().toISOString().slice(0, 10);
  y -= 20;
  drawLine(`Generated by Company Secretary Management System · ${today}`, 7);

  return new Uint8Array(await doc.save());
}

// ═══ Main Handler ═══
export async function onRequest(context: any) {
  const { request, env } = context;

  // Auth
  const { user, errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: GenerateRelatedFormsRequest = await request.json();
    const { primary_form, form_data, company_id } = body;
    const linked_forms: string[] = body.linked_forms || body.forms || [];
    if (!linked_forms.length) {
      return jsonResp({ error: "No linked_forms or forms specified" }, 400);
    }
    const results: FormResult[] = [];

    // Fetch company data for old address context
    let companyData: any = null;
    if (company_id && env.DB) {
      try {
        const stmt = env.DB.prepare(
          "SELECT reg_flat, reg_building, reg_street, reg_district, reg_region, name, company_number FROM companies WHERE id = ?"
        );
        companyData = await stmt.bind(company_id).first();
      } catch (_) { /* non-critical */ }
    }

    for (const formCode of linked_forms) {
      try {
        const linkedData = translateFormData(form_data, primary_form, formCode);

        // Fill old address from company data for IRC3111A
        if (formCode === "IRC3111A" && companyData) {
          linkedData.oldAddress = [
            companyData.reg_flat, companyData.reg_building,
            companyData.reg_street, companyData.reg_district, companyData.reg_region,
          ].filter(Boolean).join(", ");
        }

        if (formCode === "IRC3111A") {
          // Dynamically import IRC3111A generator
          const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
          const { generateIRC3111APdf } = await import("./generate-irc3111a-pdf");
          const pdfBytes = await generateIRC3111APdf(linkedData, r2Bucket);
          results.push({
            form_code: formCode,
            pdf: uint8ToBase64(new Uint8Array(pdfBytes)),
            filename: `IRC3111A_${linkedData.companyName || "form"}.pdf`,
          });
        } else if (formCode === "ND4") {
          const pdfBytes = await generateND4Pdf(linkedData, env);
          results.push({
            form_code: formCode,
            pdf: uint8ToBase64(pdfBytes),
            filename: `ND4_${linkedData.companyName || "form"}.pdf`,
          });
        } else if (formCode === "IR1263") {
          const pdfBytes = await generateIR1263Pdf(linkedData, env);
          results.push({
            form_code: formCode,
            pdf: uint8ToBase64(pdfBytes),
            filename: `IR1263_${linkedData.companyName || "form"}.pdf`,
          });
        } else if (formCode === "IRBR1" || formCode === "IRBR2") {
          // IRBR forms: load fillable template from R2, fill AcroForm widgets only
          // New fillable templates have empty XFA streams — AcroForm API is the way.
          const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
          const templateName = formCode === "IRBR1" ? "IRBR1-template.pdf" : "IRBR2-template.pdf";
          const templateObj = await r2Bucket.get(templateName);
          if (!templateObj) throw new Error(`${templateName} not found in R2`);
          const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
          const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

          const form = pdfDoc.getForm();
          if (formCode === "IRBR1") {
            // Simple checkboxes: cb_1_P.1=Yes (left), cb_2_P.1=No (right) — No XFA
            const irbr1Yes = linkedData.irbr1_yes !== false;
            try { if (irbr1Yes) form.getCheckBox('cb_1_P.1').check(); else form.getCheckBox('cb_2_P.1').check(); } catch (_) {}
          } else {
            // IRBR2: 5 text fields + 2 radio groups
            const br = linkedData.brNumber || "";
            try { if (br) form.getTextField('topmostSubform[0].Page1[0].TextField1[0]').setText(br); } catch (_) {}
            try { if (linkedData.businessNameChinese) form.getTextField('topmostSubform[0].Page1[0].TextField2[0]').setText(linkedData.businessNameChinese); } catch (_) {}
            try { if (linkedData.businessNameEnglish) form.getTextField('topmostSubform[0].Page1[0].TextField2[1]').setText(linkedData.businessNameEnglish); } catch (_) {}
            try { if (linkedData.businessNature) form.getTextField('topmostSubform[0].Page1[0].TextField2[2]').setText(linkedData.businessNature); } catch (_) {}
            try { if (linkedData.commencementDate) form.getTextField('topmostSubform[0].Page1[0].DateTimeField1[0]').setText(linkedData.commencementDate); } catch (_) {}
            try {
              const rg1 = form.getRadioGroup('topmostSubform[0].Page1[0].RadioButtonList[1]');
              const o1 = rg1.getOptions();
              if (o1.length >= 2) rg1.select(linkedData.irbr2_registered !== false ? o1[0] : o1[1]);
            } catch (_) {}
            try {
              const rg0 = form.getRadioGroup('topmostSubform[0].Page1[0].RadioButtonList[0]');
              const o0 = rg0.getOptions();
              if (o0.length >= 2) rg0.select(linkedData.irbr2_elect3yr !== false ? o0[0] : o0[1]);
            } catch (_) {}
          }

          // Keep form interactive — preserve editable blue boxes (no flatten)
          const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
          results.push({
            form_code: formCode,
            pdf: uint8ToBase64(new Uint8Array(pdfBytes)),
            filename: `${formCode}_${linkedData.companyName || linkedData.businessNameEnglish || "form"}.pdf`,
          });
        } else {
          results.push({
            form_code: formCode,
            error: `Unsupported form: ${formCode}`,
          });
        }
      } catch (e: any) {
        results.push({
          form_code: formCode,
          error: e.message || String(e),
        });
      }
    }

    return jsonResp({ success: true, forms: results });
  } catch (e: any) {
    return jsonResp({ error: e.message || String(e) }, 500);
  }
}
