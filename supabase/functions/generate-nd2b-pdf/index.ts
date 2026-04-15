import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

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
const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

interface ND2BData {
  brNumber: string;
  companyName: string;
  // Officer whose details changed
  role: 'secretary' | 'director';
  identity: 'natural' | 'corporate';
  nameEnglish: string;
  nameChinese: string;
  idNumber: string;
  // Change details
  changeType: 'address' | 'name' | 'other';
  previousAddress: string;
  newAddress: string;
  effectiveDate: string;
  // Signature
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

    const [templateResponse, fontResponse] = await Promise.all([
      fetch(ND2B_TEMPLATE_URL),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    if (!templateResponse.ok) throw new Error("Failed to load ND2B template");
    if (!fontResponse.ok) throw new Error("Failed to load Chinese font");

    const [templateBytes, fontBytes] = await Promise.all([
      templateResponse.arrayBuffer(),
      fontResponse.arrayBuffer(),
    ]);

    const pdfDoc = await PDFDocument.load(templateBytes);
    pdfDoc.registerFontkit(fontkit);

    let customFont;
    if (!data.debug) {
      customFont = await pdfDoc.embedFont(fontBytes);
    }

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
      try {
        const tf = form.getTextField("fill_2_P.1");
        tf.setText(data.companyName);
        if (customFont) tf.updateAppearances(customFont);
      } catch {}

      // Officer info - Page 2 (natural person) or Page 3 (corporate)
      if (data.identity === 'natural') {
        const p = ".2";
        try {
          const f = form.getTextField(`fill_3_P${p}`);
          f.setText(data.nameEnglish);
          if (customFont) f.updateAppearances(customFont);
        } catch {}
        try {
          const f = form.getTextField(`fill_4_P${p}`);
          f.setText(data.nameChinese);
          if (customFont) f.updateAppearances(customFont);
        } catch {}
        try { form.getTextField(`fill_7_P${p}`).setText(data.idNumber); } catch {}
        
        // New address
        try {
          const f = form.getTextField(`fill_8_P${p}`);
          f.setText(data.newAddress);
          if (customFont) f.updateAppearances(customFont);
        } catch {}

        // Effective date
        if (data.effectiveDate) {
          const parts = data.effectiveDate.split(/[-/]/);
          if (parts.length >= 3) {
            try { form.getTextField(`fill_9_P${p}`).setText(parts[2]); } catch {}
            try { form.getTextField(`fill_10_P${p}`).setText(parts[1]); } catch {}
            try { form.getTextField(`fill_11_P${p}`).setText(parts[0]); } catch {}
          }
        }

        // Role checkbox
        if (data.role === 'secretary') {
          try { form.getCheckBox(`cb_1_P${p}`).check(); } catch {}
        } else {
          try { form.getCheckBox(`cb_2_P${p}`).check(); } catch {}
        }
      }

      // Signature page
      try {
        const sf = form.getTextField("fill_1_P.5");
        sf.setText(data.signerName);
        if (customFont) sf.updateAppearances(customFont);
      } catch {}

      // Presentor
      try {
        const pf = form.getTextField("fill_1_P.6");
        pf.setText(data.presentorName);
        if (customFont) pf.updateAppearances(customFont);
      } catch {}
      try {
        const af = form.getTextField("fill_2_P.6");
        af.setText(data.presentorAddress);
        if (customFont) af.updateAppearances(customFont);
      } catch {}
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
