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

const TEMPLATE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/NR1-template.pdf";
const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

interface NR1Data {
  brNumber: string;
  companyName: string;
  // New address
  flat: string;
  building: string;
  street: string;
  district: string;
  region: string;
  addressEffectiveDay: string;
  addressEffectiveMonth: string;
  addressEffectiveYear: string;
  // Email
  email: string;
  emailEffectiveDay: string;
  emailEffectiveMonth: string;
  emailEffectiveYear: string;
  // Phone
  phone: string;
  phoneEffectiveDay: string;
  phoneEffectiveMonth: string;
  phoneEffectiveYear: string;
  // Signature
  signerName: string;
  signDateDay: string;
  signDateMonth: string;
  signDateYear: string;
  // Presentor
  presentorName: string;
  presentorAddress: string;
  presentorContact: string;
  // Debug mode
  debug?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const data: NR1Data = await req.json();
    console.log("Generating NR1 PDF for:", data.companyName);

    // Load template and font in parallel
    const [templateResponse, fontResponse] = await Promise.all([
      fetch(TEMPLATE_URL),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    if (!templateResponse.ok) throw new Error("Failed to load NR1 template");
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
    const fields = form.getFields();

    if (data.debug) {
      // Debug mode: fill all text fields with their names
      for (const field of fields) {
        const name = field.getName();
        try {
          if (name.startsWith("fill_")) {
            const tf = form.getTextField(name);
            tf.setText(name);
          } else if (name.startsWith("cb_")) {
            const cb = form.getCheckBox(name);
            cb.check();
          }
        } catch {}
      }
    } else {
      // Field mapping based on NR1 specimen
      const fieldMap: Record<string, string> = {
        "fill_1_P.1": data.brNumber,
        "fill_2_P.1": data.companyName,
        // Address
        "fill_3_P.1": data.flat,
        "fill_4_P.1": data.building,
        "fill_5_P.1": data.street,
        "fill_6_P.1": data.district,
        "fill_7_P.1": data.region,
        // Address effective date
        "fill_8_P.1": data.addressEffectiveDay,
        "fill_9_P.1": data.addressEffectiveMonth,
        "fill_10_P.1": data.addressEffectiveYear,
        // Email
        "fill_11_P.1": data.email,
        "fill_12_P.1": data.emailEffectiveDay,
        "fill_13_P.1": data.emailEffectiveMonth,
        "fill_14_P.1": data.emailEffectiveYear,
        // Phone
        "fill_15_P.1": data.phone,
        "fill_16_P.1": data.phoneEffectiveDay,
        "fill_17_P.1": data.phoneEffectiveMonth,
        "fill_18_P.1": data.phoneEffectiveYear,
        // Signer
        "fill_19_P.1": data.signerName,
        "fill_20_P.1": data.signDateDay,
        "fill_21_P.1": data.signDateMonth,
        "fill_22_P.1": data.signDateYear,
        // Presentor
        "fill_23_P.1": data.presentorName,
        "fill_24_P.1": data.presentorAddress,
        "fill_25_P.1": data.presentorContact,
      };

      for (const [fieldName, value] of Object.entries(fieldMap)) {
        if (value) {
          try {
            const tf = form.getTextField(fieldName);
            tf.setText(value);
            if (customFont) {
              tf.updateAppearances(customFont);
            }
          } catch (e) {
            console.warn(`Field ${fieldName} not found or error:`, e);
          }
        }
      }
    }

    form.flatten();
    const pdfBytes = await pdfDoc.save();
    const base64 = uint8ToBase64(new Uint8Array(pdfBytes));

    return new Response(JSON.stringify({ pdf: base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("NR1 generation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
