import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

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

const ND2B_TEMPLATE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/ND2B-template.pdf";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const data: ND2BData = await req.json();
    console.log("Generating ND2B PDF for:", data.companyName);

    const templateResponse = await fetch(ND2B_TEMPLATE_URL);
    if (!templateResponse.ok) throw new Error("Failed to load ND2B template");

    const templateBytes = await templateResponse.arrayBuffer();
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
      // Page 1: Company info
      try { form.getTextField("fill_1_P.1").setText(data.brNumber); } catch {}
      try { form.getTextField("fill_2_P.1").setText(data.companyName); } catch {}

      // Officer info - Page 2 (natural person)
      if (data.identity === 'natural') {
        const p = ".2";
        try { form.getTextField(`fill_3_P${p}`).setText(data.nameEnglish); } catch {}
        try { form.getTextField(`fill_4_P${p}`).setText(data.nameChinese); } catch {}
        try { form.getTextField(`fill_7_P${p}`).setText(data.idNumber); } catch {}
        try { form.getTextField(`fill_8_P${p}`).setText(data.previousAddress); } catch {}

        if (data.effectiveDate) {
          const parts = data.effectiveDate.split(/[-/]/);
          if (parts.length >= 3) {
            try { form.getTextField(`fill_9_P${p}`).setText(parts[2]); } catch {}
            try { form.getTextField(`fill_10_P${p}`).setText(parts[1]); } catch {}
            try { form.getTextField(`fill_11_P${p}`).setText(parts[0]); } catch {}
          }
        }

        if (data.role === 'secretary') {
          try { form.getCheckBox(`cb_1_P${p}`).check(); } catch {}
        } else {
          try { form.getCheckBox(`cb_2_P${p}`).check(); } catch {}
        }
      }

      // Signature page
      try { form.getTextField("fill_1_P.5").setText(data.signerName); } catch {}

      // Presentor
      try { form.getTextField("fill_1_P.6").setText(data.presentorName); } catch {}
      try { form.getTextField("fill_2_P.6").setText(data.presentorAddress); } catch {}
    }

    form.flatten();
    const pdfBytes = await pdfDoc.save();
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
});