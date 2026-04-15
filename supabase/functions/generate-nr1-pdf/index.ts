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

const TEMPLATE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/NR1-template.pdf";
const CHINESE_FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2";

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

    // Load template
    const templateResponse = await fetch(TEMPLATE_URL);
    if (!templateResponse.ok) throw new Error("Failed to load NR1 template");
    const templateBytes = await templateResponse.arrayBuffer();

    const pdfDoc = await PDFDocument.load(templateBytes);

    const form = pdfDoc.getForm();
    const fields = form.getFields();

    if (data.debug) {
      // Debug mode: fill all text fields with their names
      for (const field of fields) {
        const name = field.getName();
        const type = field.constructor.name;
        console.log(`Field: ${name} (${type})`);
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
      // Field mapping based on NR1 template
      const fieldMap: Record<string, string> = {
        "fill_1_P.1": data.brNumber,
        "fill_2_P.1": data.companyName,
        // Address
        "fill_3_P.1": data.flat,
        "fill_4_P.1": data.building,
        "fill_5_P.1": data.street,
        "fill_6_P.1": data.district,
        // Region is Dropdown1_P.1 (handled separately)
        // Address effective date
        "fill_7_P.1": data.addressEffectiveDay,
        "fill_8_P.1": data.addressEffectiveMonth,
        "fill_9_P.1": data.addressEffectiveYear,
        // Email
        "fill_10_P.1": data.email,
        "fill_11_P.1": data.emailEffectiveDay,
        "fill_12_P.1": data.emailEffectiveMonth,
        "fill_13_P.1": data.emailEffectiveYear,
        // Phone
        "fill_14_P.1": data.phone,
        "fill_15_P.1": data.phoneEffectiveDay,
        "fill_16_P.1": data.phoneEffectiveMonth,
        "fill_17_P.1": data.phoneEffectiveYear,
        // Signer
        "fill_18_P.1": data.signerName,
        "fill_19_P.1": data.signDateDay,
        "fill_20_P.1": data.signDateMonth,
        "fill_21_P.1": data.signDateYear,
        // Presentor
        "fill_22_P.1": data.presentorName,
        "fill_23_P.1": data.presentorAddress,
        "fill_24_P.1": data.presentorContact,
      };

      for (const [fieldName, value] of Object.entries(fieldMap)) {
        if (value) {
          try {
            const tf = form.getTextField(fieldName);
            tf.setText(value);
          } catch (e) {
            console.warn(`Field ${fieldName} not found or error:`, e);
          }
        }


      // Handle region dropdown
      if (data.region) {
        try {
          const dropdown = form.getDropdown("Dropdown1_P.1");
          const options = dropdown.getOptions();
          console.log("Region dropdown options:", options);
          // Try to select matching option
          const match = options.find((o: string) => data.region.includes(o) || o.includes(data.region));
          if (match) dropdown.select(match);
        } catch (e) {
          console.warn("Region dropdown error:", e);
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
