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

const ND2A_TEMPLATE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/ND2A-template.pdf";
const ND2B_TEMPLATE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/ND2B-template.pdf";
const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

interface OfficerChange {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director';
  identity: 'natural' | 'corporate';
  // Natural person
  nameChinese: string;
  nameEnglish: string;
  formerNameChinese?: string;
  formerNameEnglish?: string;
  idNumber: string;
  address: string;
  dateAppointed?: string;
  dateCeased?: string;
  // Corporate
  companyName?: string;
  companyNumber?: string;
  placeIncorporated?: string;
}

interface ND2AData {
  brNumber: string;
  companyName: string;
  officers: OfficerChange[];
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
    const data: ND2AData = await req.json();
    console.log("Generating ND2A PDF for:", data.companyName);

    const [templateResponse, fontResponse] = await Promise.all([
      fetch(ND2A_TEMPLATE_URL),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    if (!templateResponse.ok) throw new Error("Failed to load ND2A template");
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

      // Fill officer data into pages 2-7 (up to 6 officers)
      // Pages alternate: natural person pages and corporate pages
      // Page 2 (P.2) = first secretary/director appointment (natural)
      // Page 3 (P.3) = first secretary/director appointment (corporate)
      // etc.
      for (let i = 0; i < Math.min(data.officers.length, 3); i++) {
        const officer = data.officers[i];
        const pageIdx = i === 0 ? 2 : (i === 1 ? 4 : 6); // Pages for natural persons

        if (officer.identity === 'natural') {
          const p = `.${pageIdx}`;
          try {
            const nameField = form.getTextField(`fill_3_P${p}`);
            nameField.setText(officer.nameEnglish);
            if (customFont) nameField.updateAppearances(customFont);
          } catch {}
          try {
            const nameField = form.getTextField(`fill_4_P${p}`);
            nameField.setText(officer.nameChinese);
            if (customFont) nameField.updateAppearances(customFont);
          } catch {}
          try {
            form.getTextField(`fill_7_P${p}`).setText(officer.idNumber);
          } catch {}
          try {
            const addrField = form.getTextField(`fill_8_P${p}`);
            addrField.setText(officer.address);
            if (customFont) addrField.updateAppearances(customFont);
          } catch {}
          if (officer.dateAppointed) {
            const parts = officer.dateAppointed.split(/[-/]/);
            if (parts.length >= 3) {
              try { form.getTextField(`fill_9_P${p}`).setText(parts[2]); } catch {}
              try { form.getTextField(`fill_10_P${p}`).setText(parts[1]); } catch {}
              try { form.getTextField(`fill_11_P${p}`).setText(parts[0]); } catch {}
            }
          }
          // Check appropriate checkboxes for role
          if (officer.role === 'secretary') {
            try { form.getCheckBox(`cb_1_P${p}`).check(); } catch {}
          } else {
            try { form.getCheckBox(`cb_2_P${p}`).check(); } catch {}
          }
          if (officer.type === 'appointment') {
            try { form.getCheckBox(`cb_3_P${p}`).check(); } catch {}
          } else {
            try { form.getCheckBox(`cb_4_P${p}`).check(); } catch {}
          }
        }
      }

      // Presentor info (last page)
      try {
        const pf = form.getTextField("fill_1_P.7");
        pf.setText(data.presentorName);
        if (customFont) pf.updateAppearances(customFont);
      } catch {}
      try {
        const af = form.getTextField("fill_2_P.7");
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
    console.error("ND2A generation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
