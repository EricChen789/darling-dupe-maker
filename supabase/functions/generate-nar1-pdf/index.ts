import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CompanyData {
  name: string;
  brNumber: string;
  tradingName: string;
  businessNature: string;
  businessCode: string;
  companyType: string;
  registeredOffice?: {
    flat?: string;
    building?: string;
    street?: string;
    district?: string;
    region?: string;
  };
  directors: Array<{
    nameChinese: string;
    nameEnglish: string;
    email: string;
    identity: 'natural' | 'corporate';
    brNumber?: string;
  }>;
  secretaries: Array<{
    nameChinese: string;
    nameEnglish: string;
    email: string;
    identity: 'natural' | 'corporate';
    brNumber?: string;
  }>;
  shareholders: Array<{
    name: string;
    shares: number;
  }>;
  returnDate?: string;
}

// NAR1 PDF Template URL from Supabase Storage
const TEMPLATE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/NAR1-template.pdf";

// Chinese font URL
const CHINESE_FONT_URL = "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf";

async function loadChineseFont(): Promise<ArrayBuffer> {
  console.log("Loading Chinese font...");
  const response = await fetch(CHINESE_FONT_URL, { headers: { 'Accept': '*/*' } });
  if (!response.ok) {
    throw new Error(`Failed to load font: ${response.status}`);
  }
  const fontBytes = await response.arrayBuffer();
  console.log(`Font loaded, size: ${fontBytes.byteLength} bytes`);
  return fontBytes;
}

async function loadPdfTemplate(): Promise<ArrayBuffer> {
  console.log("Loading NAR1 PDF template...");
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) {
    throw new Error(`Failed to load PDF template: ${response.status}`);
  }
  const pdfBytes = await response.arrayBuffer();
  console.log(`Template loaded, size: ${pdfBytes.byteLength} bytes`);
  return pdfBytes;
}

async function fillPdfTemplate(data: CompanyData): Promise<Uint8Array> {
  console.log("Loading and filling PDF template...");

  const templateBytes = await loadPdfTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);

  const chineseFontBytes = await loadChineseFont();
  const chineseFont = await pdfDoc.embedFont(chineseFontBytes);

  const pages = pdfDoc.getPages();
  console.log(`PDF has ${pages.length} pages`);

  const form = pdfDoc.getForm();

  const returnDate = data.returnDate || new Date().toISOString().split("T")[0];
  const [year, month, day] = returnDate.split("-");
  const office = data.registeredOffice || {};

  const safeSetText = (fieldName: string, value: string) => {
    try {
      const field = form.getTextField(fieldName);
      field.setText(value ?? "");
      console.log(`✓ ${fieldName} = ${JSON.stringify(value)}`);
      return true;
    } catch (e) {
      console.warn(`⚠ Missing text field: ${fieldName}`, e);
      return false;
    }
  };

  const safeCheck = (fieldName: string, shouldCheck: boolean) => {
    if (!shouldCheck) return false;
    try {
      const field = form.getCheckBox(fieldName);
      field.check();
      console.log(`✓ Checked ${fieldName}`);
      return true;
    } catch (e) {
      console.warn(`⚠ Missing checkbox field: ${fieldName}`, e);
      return false;
    }
  };

  const parseEnglishName = (fullName: string) => {
    const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
    const surname = parts.length ? parts[parts.length - 1] : "";
    const otherNames = parts.slice(0, -1).join(" ");
    return { surname, otherNames };
  };

  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

  // Page 1
  safeSetText("fill_1_P.1", br8);
  safeSetText("fill_2_P.1", data.brNumber || "");
  safeSetText("fill_3_P.1", data.name || "");
  safeSetText("fill_4_P.1", data.tradingName || "");
  safeCheck(
    "cb_1_P.1",
    data.companyType?.includes("私人") || data.companyType?.toLowerCase().includes("private") || false,
  );
  safeCheck(
    "cb_2_P.1",
    data.companyType?.includes("公眾") || data.companyType?.toLowerCase().includes("public") || false,
  );
  safeCheck("cb_3_P.1", data.companyType?.includes("擔保") || false);

  // Page 2 (date + business nature)
  safeSetText("fill_1_P.2", day || "");
  safeSetText("fill_2_P.2", month || "");
  safeSetText("fill_3_P.2", year || "");
  safeSetText("fill_4_P.2", data.businessCode || "");
  safeSetText("fill_5_P.2", data.businessNature || "");

  // Page 3 (registered office)
  safeSetText("fill_1_P.3", office.flat || "");
  safeSetText("fill_2_P.3", office.building || "");
  safeSetText("fill_3_P.3", office.street || "");
  safeSetText("fill_4_P.3", office.district || "");

  // Page 4 (company secretary - natural person) - first natural
  const naturalSecretaries = (data.secretaries || []).filter((s) => s.identity === "natural");
  if (naturalSecretaries.length > 0) {
    const sec = naturalSecretaries[0];
    const { surname, otherNames } = parseEnglishName(sec.nameEnglish);
    safeSetText("fill_1_P.4", sec.nameChinese || "");
    safeSetText("fill_2_P.4", surname);
    safeSetText("fill_3_P.4", otherNames);
    safeSetText("fill_5_P.4", sec.email || "");
    console.log(`Filled Secretary: ${sec.nameChinese}`);
  }

  // Page 6 (director - natural person) - first natural
  const naturalDirectors = (data.directors || []).filter((d) => d.identity === "natural");
  if (naturalDirectors.length > 0) {
    const dir = naturalDirectors[0];
    const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
    safeCheck("cb_1_P.6", true);
    safeSetText("fill_1_P.6", dir.nameChinese || "");
    safeSetText("fill_2_P.6", surname);
    safeSetText("fill_3_P.6", otherNames);
    safeSetText("fill_5_P.6", dir.email || "");
    console.log(`Filled Director: ${dir.nameChinese}`);
  }

  // Key fix: ensure Chinese renders in form field appearances before flattening
  form.updateFieldAppearances(chineseFont);
  form.flatten();
  console.log("Form flattened");

  console.log("PDF filled, serializing...");
  const pdfBytes = await pdfDoc.save();
  console.log(`Final PDF size: ${pdfBytes.byteLength} bytes`);
  return pdfBytes;
}

serve(async (req: Request) => {
  console.log(`Received ${req.method} request`);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const companyData: CompanyData = await req.json();
    console.log(`Generating PDF for company: ${companyData.name} (BR: ${companyData.brNumber})`);
    
    // Fill the NAR1 PDF template
    const pdfBytes = await fillPdfTemplate(companyData);
    
    // Return PDF as download
    return new Response(pdfBytes.buffer as ArrayBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="NAR1_${companyData.brNumber}_${Date.now()}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error generating PDF:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
