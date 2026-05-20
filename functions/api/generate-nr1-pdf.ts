import { PDFDocument } from "pdf-lib";

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

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const data: NR1Data = await request.json();
    console.log("Generating NR1 PDF for:", data.companyName);

    // Load template from R2
    const templateObj = await env.PDF_TEMPLATES.get("NR1-template.pdf");
    if (!templateObj) throw new Error("Failed to load NR1 template");
    const templateBytes = await templateObj.arrayBuffer();

    const pdfDoc = await PDFDocument.load(templateBytes);

    const form = pdfDoc.getForm();
    const fields = form.getFields();

    if (data.debug) {
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
      const fieldMap: Record<string, string> = {
        "fill_1_P.1": data.brNumber,
        "fill_2_P.1": data.companyName,
        "fill_3_P.1": data.flat,
        "fill_4_P.1": data.building,
        "fill_5_P.1": data.street,
        "fill_6_P.1": data.district,
        "fill_7_P.1": data.addressEffectiveDay,
        "fill_8_P.1": data.addressEffectiveMonth,
        "fill_9_P.1": data.addressEffectiveYear,
        "fill_10_P.1": data.email,
        "fill_11_P.1": data.emailEffectiveDay,
        "fill_12_P.1": data.emailEffectiveMonth,
        "fill_13_P.1": data.emailEffectiveYear,
        "fill_14_P.1": data.phone,
        "fill_15_P.1": data.phoneEffectiveDay,
        "fill_16_P.1": data.phoneEffectiveMonth,
        "fill_17_P.1": data.phoneEffectiveYear,
        "fill_18_P.1": data.signerName,
        "fill_19_P.1": `${data.signDateDay}/${data.signDateMonth}/${data.signDateYear}`,
        "fill_20_P.1": data.presentorName,
        "fill_21_P.1": data.presentorAddress,
        "fill_22_P.1": data.presentorContact,
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
      }

      if (data.region) {
        try {
          const dropdown = form.getDropdown("Dropdown1_P.1");
          const options = dropdown.getOptions();
          console.log("Region dropdown options:", options);
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
}
