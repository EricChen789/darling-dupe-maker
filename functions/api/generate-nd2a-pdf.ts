import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

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

interface OfficerChange {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director';
  identity: 'natural' | 'corporate';
  // Natural person
  nameChinese: string;
  nameSurname?: string;
  nameOtherNames?: string;
  nameEnglish?: string;
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

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const data: ND2AData = await request.json();
    console.log("Generating ND2A PDF for:", data.companyName);

    const [templateObj, fontResponse] = await Promise.all([
      env.PDF_TEMPLATES.get("ND2A-template.pdf"),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    if (!templateObj) throw new Error("Failed to load ND2A template");
    if (!fontResponse.ok) throw new Error("Failed to load Chinese font");

    const [templateBytes, fontBytes] = await Promise.all([
      templateObj.arrayBuffer(),
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
      for (let i = 0; i < Math.min(data.officers.length, 3); i++) {
        const officer = data.officers[i];
        const pageIdx = i === 0 ? 2 : (i === 1 ? 4 : 6); // Pages for natural persons

        if (officer.identity === 'natural') {
          const p = `.${pageIdx}`;
          // Split English name: prefer explicit surname/otherNames, fallback to parse
          const eng = officer.nameEnglish || '';
          let surname = officer.nameSurname || '';
          let other = officer.nameOtherNames || '';
          if (!surname && eng) {
            const parts = eng.trim().split(/\s+/);
            surname = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '');
            other = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
          }
          try {
            const chField = form.getTextField(`fill_2_P${p}`);
            chField.setText(officer.nameChinese);
            if (customFont) chField.updateAppearances(customFont);
          } catch {}
          try {
            const surnameField = form.getTextField(`fill_3_P${p}`);
            surnameField.setText(surname);
          } catch {}
          try {
            const otherField = form.getTextField(`fill_4_P${p}`);
            otherField.setText(other);
          } catch {}
          try {
            form.getTextField(`fill_7_P${p}`).setText(officer.idNumber);
          } catch {}
          try {
            const addrField = form.getTextField(`fill_8_P${p}`);
            addrField.setText(officer.address);
            if (customFont) addrField.updateAppearances(customFont);
          } catch {}
          // Date: fill_9/10/11 = 委任日期，只填委任，停任不写
          if (officer.type === 'appointment' && officer.dateAppointed) {
            const parts = officer.dateAppointed.split(/[-/]/);
            if (parts.length >= 3) {
              try { form.getTextField(`fill_9_P${p}`).setText(parts[2]); } catch {}
              try { form.getTextField(`fill_10_P${p}`).setText(parts[1]); } catch {}
              try { form.getTextField(`fill_11_P${p}`).setText(parts[0]); } catch {}
            }
          }
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

      // P.1: Signer & presentor info
      // Signer date (fill_11/12/13 are D/M/Y triplet at y=612)
      if (data.signDate) {
        const parts = data.signDate.split(/[\/\-]/);
        if (parts.length >= 3) {
          try { form.getTextField("fill_11_P.1").setText(parts[0]); } catch {}
          try { form.getTextField("fill_12_P.1").setText(parts[1]); } catch {}
          try { form.getTextField("fill_13_P.1").setText(parts[2]); } catch {}
        }
      }
      // Signer & presenter names → wide fields at y=492,531
      try {
        const sf = form.getTextField("fill_9_P.1");
        sf.setText(data.signerName);
        if (customFont) sf.updateAppearances(customFont);
      } catch {}
      try {
        const pf = form.getTextField("fill_10_P.1");
        pf.setText(data.presentorName);
        if (customFont) pf.updateAppearances(customFont);
      } catch {}
      // Presentor address & contact
      // NOTE: fill_15_P.1 is the tall multi-line address field (44px),
      // fill_14_P.1 is the short single-line contact field (14px)
      try {
        form.getTextField("fill_14_P.1").setText(data.presentorContact);
      } catch {}
      try {
        const af = form.getTextField("fill_15_P.1");
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
}
