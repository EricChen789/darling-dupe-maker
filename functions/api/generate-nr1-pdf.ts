import { PDFDocument } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import { corsHeaders, uint8ToBase64 } from './_pdf-utils';
import {
  collectFormFields,
  rebuildAcroFormFields,
  enableNeedAppearances,
  createFormHelpers,
} from './_acroform';

type Env = AuthEnv & { PDF_TEMPLATES: R2Bucket };

// ── NR1 Data ──

interface NR1Data {
  brNumber: string;
  companyName: string;
  flat: string;
  building: string;
  street: string;
  district: string;
  region: string;
  addressEffectiveDay: string;
  addressEffectiveMonth: string;
  addressEffectiveYear: string;
  email: string;
  emailEffectiveDay: string;
  emailEffectiveMonth: string;
  emailEffectiveYear: string;
  phone: string;
  phoneEffectiveDay: string;
  phoneEffectiveMonth: string;
  phoneEffectiveYear: string;
  signerName: string;
  signDateDay: string;
  signDateMonth: string;
  signDateYear: string;
  presentorName: string;
  presentorAddress: string;
  presentorContact: string;
  debug?: boolean;
}

// ── Main handler ──

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data: NR1Data = await request.json();
    console.log("Generating NR1 PDF for:", data.companyName);

    const templateObj = await env.PDF_TEMPLATES.get("NR1-template.pdf");
    if (!templateObj) throw new Error("Failed to load NR1 template from R2");
    const templateBytes = await templateObj.arrayBuffer();

    const pdfDoc = await PDFDocument.load(templateBytes);
    const { setText, check, selectDropdown } = createFormHelpers(pdfDoc);

    if (data.debug) {
      const fields = collectFormFields(pdfDoc);
      for (const [name] of fields) {
        if (name.startsWith("fill_") || name.startsWith("cb_") || name.startsWith("Dropdown")) {
          try {
            if (name.startsWith("fill_")) setText(name, name);
            else if (name.startsWith("cb_")) check(name, true);
          } catch (_) { /* ignore */ }
        }
      }
    } else {
      // Company info
      setText("fill_1_P.1", data.brNumber);
      setText("fill_2_P.1", data.companyName);

      // 2(a) New address
      setText("fill_3_P.1", data.flat);
      setText("fill_4_P.1", data.building);
      setText("fill_5_P.1", data.street);
      setText("fill_6_P.1", data.district);
      setText("fill_7_P.1", data.addressEffectiveDay);
      setText("fill_8_P.1", data.addressEffectiveMonth);
      setText("fill_9_P.1", data.addressEffectiveYear);

      // 2(b) Email
      setText("fill_10_P.1", data.email);
      setText("fill_11_P.1", data.emailEffectiveDay);
      setText("fill_12_P.1", data.emailEffectiveMonth);
      setText("fill_13_P.1", data.emailEffectiveYear);

      // 2(c) Phone
      setText("fill_14_P.1", data.phone);
      setText("fill_15_P.1", data.phoneEffectiveDay);
      setText("fill_16_P.1", data.phoneEffectiveMonth);
      setText("fill_17_P.1", data.phoneEffectiveYear);

      // Signature
      setText("fill_18_P.1", data.signerName);
      setText("fill_19_P.1", `${data.signDateDay || ""}/${data.signDateMonth || ""}/${data.signDateYear || ""}`);

      // Presentor
      setText("fill_20_P.1", data.presentorName);
      setText("fill_21_P.1", data.presentorAddress);
      setText("fill_22_P.1", data.presentorContact);

      // Region dropdown
      if (data.region) {
        selectDropdown("Dropdown1_P.1", data.region);
      }
    }

    rebuildAcroFormFields(pdfDoc);
    enableNeedAppearances(pdfDoc);

    const pdfBytes = await pdfDoc.save();
    const base64 = uint8ToBase64(new Uint8Array(pdfBytes));

    return new Response(JSON.stringify({ pdf: base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("NR1 generation error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
