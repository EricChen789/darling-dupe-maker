import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

async function loadChineseFont(): Promise<ArrayBuffer> {
  const response = await fetch(CHINESE_FONT_URL);
  if (!response.ok) throw new Error(`Failed to load font: ${response.status}`);
  return response.arrayBuffer();
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
      // Split English name into surname + other names
      const nameParts = (data.nameEnglish || '').trim().split(/\s+/);
      const surname = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0] || '';
      const otherNames = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';

      // === PAGE 1 (P.1) ===
      // BR Number
      try { form.getTextField("fill_1_P.1").setText(data.brNumber); } catch {}
      // Section 1: Company Name
      try { form.getTextField("fill_2_P.1").setText(data.companyName); } catch {}

      if (data.identity === 'natural') {
        // Section 2A: Currently Registered Particulars (原本資料)
        // Capacity checkbox
        if (data.role === 'secretary') {
          try { form.getCheckBox("cb_1_P.1").check(); } catch {}
        } else {
          try { form.getCheckBox("cb_2_P.1").check(); } catch {}
        }
        // Chinese Name
        try { form.getTextField("fill_3_P.1").setText(data.nameChinese); } catch {}
        // English Surname
        try { form.getTextField("fill_4_P.1").setText(surname); } catch {}
        // English Other Names
        try { form.getTextField("fill_5_P.1").setText(otherNames); } catch {}
        // ID Number (passport partial)
        try { form.getTextField("fill_7_P.1").setText(data.idNumber); } catch {}

        // === PAGE 2 (P.2) — Section B: Details of Changes ===
        // For address change, fill correspondence address (e) with new address
        if (data.changeType === 'address' && data.newAddress) {
          try { form.getTextField("fill_19_P.2").setText(data.newAddress); } catch {}
        }

        // === PAGE 6 (P.6) — PI-ND2B: Protected Information ===
        // Capacity checkbox
        if (data.role === 'secretary') {
          try { form.getCheckBox("cb_1_P.6").check(); } catch {}
        } else {
          try { form.getCheckBox("cb_2_P.6").check(); } catch {}
        }
        // Names
        try { form.getTextField("fill_2_P.6").setText(data.nameChinese); } catch {}
        try { form.getTextField("fill_3_P.6").setText(surname); } catch {}
        try { form.getTextField("fill_4_P.6").setText(otherNames); } catch {}
        // New residential address
        try { form.getTextField("fill_9_P.6").setText(data.newAddress); } catch {}
      }

      // === Presentor (bottom of Page 1) ===
      try { form.getTextField("fill_8_P.1").setText(data.presentorName); } catch {}
      try { form.getTextField("fill_9_P.1").setText(data.presentorAddress); } catch {}
      try { form.getTextField("fill_10_P.1").setText(data.presentorContact); } catch {}

      // === PAGE 3 (P.3) — Signature ===
      try { form.getTextField("fill_30_P.3").setText(data.signerName); } catch {}
      if (data.signDate) {
        try { form.getTextField("fill_31_P.3").setText(data.signDate); } catch {}
      }
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