import { PDFDocument, PDFName, PDFHexString } from "pdf-lib";

interface Env {
  PDF_TEMPLATES: R2Bucket;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const isAsciiOnly = (s: string) => /^[\x00-\x7F]*$/.test(s);

function safeSetText(form: any, fieldName: string, text: string) {
  if (!text) return;
  try {
    const field = form.getTextField(fieldName);
    if (isAsciiOnly(text)) {
      field.setText(text);
    } else {
      const dict = field.acroField.dict;
      dict.set(PDFName.of('V'), PDFHexString.fromText(text));
      dict.delete(PDFName.of('AP'));
    }
  } catch {}
}

interface ND2BData {
  brNumber: string;
  companyName: string;
  role: 'secretary' | 'director';
  identity: 'natural' | 'corporate';
  nameEnglish: string;
  nameChinese: string;
  idNumber: string;
  changeType: 'address' | 'name' | 'other';
  previousAddress: string;
  newAddress: string;
  effectiveDate: string;
  signerName: string;
  signDate: string;
  presentorName: string;
  presentorAddress: string;
  presentorContact: string;
  debug?: boolean;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const data: ND2BData = await request.json();
    console.log("Generating ND2B PDF for:", data.companyName);

    const templateObj = await env.PDF_TEMPLATES.get("ND2B-template.pdf");
    if (!templateObj) throw new Error("Failed to load ND2B template");

    const templateBytes = await templateObj.arrayBuffer();
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    if (data.debug) {
      const fields = form.getFields();
      for (const field of fields) {
        const name = field.getName();
        try {
          if (name.startsWith("fill_")) {
            form.getTextField(name).setText(name);
          } else if (name.startsWith("cb_")) {
            form.getCheckBox(name).check();
          }
        } catch {}
      }
    } else {
      const nameParts = (data.nameEnglish || '').trim().split(/\s+/);
      const surname = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0] || '';
      const otherNames = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';

      // === PAGE 1 (P.1) ===
      safeSetText(form, "fill_1_P.1", data.brNumber);
      safeSetText(form, "fill_2_P.1", data.companyName);

      if (data.identity === 'natural') {
        if (data.role === 'secretary') {
          try { form.getCheckBox("cb_1_P.1").check(); } catch {}
        } else {
          try { form.getCheckBox("cb_2_P.1").check(); } catch {}
        }
        safeSetText(form, "fill_3_P.1", data.nameChinese);
        safeSetText(form, "fill_4_P.1", surname);
        safeSetText(form, "fill_5_P.1", otherNames);
        safeSetText(form, "fill_7_P.1", data.idNumber);

        // === PAGE 2 (P.2) — Section B: Details of Changes ===
        if (data.changeType === 'address' && data.newAddress) {
          safeSetText(form, "fill_19_P.2", data.newAddress);
        }

        // === PAGE 6 (P.6) — PI-ND2B: Protected Information ===
        if (data.role === 'secretary') {
          try { form.getCheckBox("cb_1_P.6").check(); } catch {}
        } else {
          try { form.getCheckBox("cb_2_P.6").check(); } catch {}
        }
        safeSetText(form, "fill_2_P.6", data.nameChinese);
        safeSetText(form, "fill_3_P.6", surname);
        safeSetText(form, "fill_4_P.6", otherNames);
        safeSetText(form, "fill_9_P.6", data.newAddress);
      }

      // === Presentor (bottom of Page 1) ===
      safeSetText(form, "fill_8_P.1", data.presentorName);
      safeSetText(form, "fill_9_P.1", data.presentorAddress);
      safeSetText(form, "fill_10_P.1", data.presentorContact);

      // === PAGE 3 (P.3) — Signature ===
      safeSetText(form, "fill_30_P.3", data.signerName);
      safeSetText(form, "fill_31_P.3", data.signDate);
    }

    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    const base64 = uint8ToBase64(new Uint8Array(pdfBytes));

    return new Response(JSON.stringify({ pdf: base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("ND2B generation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
