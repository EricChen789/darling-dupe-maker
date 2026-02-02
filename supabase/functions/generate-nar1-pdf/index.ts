import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

function uint8ToBase64(bytes: Uint8Array): string {
  // Avoid call stack overflow by chunking.
  let binary = "";
  const chunkSize = 0x8000; // 32768
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

// NAR1 PDF Template URL from Supabase Storage (v2 has BR number fields on all pages)
const TEMPLATE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/NAR1-template-v2.pdf";

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

async function listAllFormFields(): Promise<{ fields: Array<{name: string; type: string}> }> {
  const templateBytes = await loadPdfTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const allFields = form.getFields();
  
  const fields: Array<{name: string; type: string}> = [];
  
  for (const field of allFields) {
    const name = field.getName();
    const type = field.constructor.name;
    fields.push({ name, type });
    console.log(`Field: ${name} (${type})`);
  }
  
  // Sort by field name for easier reading
  fields.sort((a, b) => a.name.localeCompare(b.name));
  
  console.log(`Total fields found: ${fields.length}`);
  return { fields };
}

async function fillPdfTemplate(data: CompanyData, debugMode = false): Promise<Uint8Array> {
  console.log("Loading and filling PDF template...");

  const templateBytes = await loadPdfTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);

  const pages = pdfDoc.getPages();
  console.log(`PDF has ${pages.length} pages`);

  const form = pdfDoc.getForm();

  // Debug mode: lightweight version - no font embedding, no flattening
  if (debugMode) {
    console.log("Debug mode: filling all text fields with identifiers (no font, no flatten for speed)");
    const fields = form.getFields();
    for (const field of fields) {
      const name = field.getName();

      if (name.startsWith("fill_")) {
        try {
          const textField = form.getTextField(name);
          const maxLength = textField.getMaxLength();
          const match = name.match(/fill_(\d+)_P\.(\d+)/);
          let textToSet = match ? `${match[1]}.${match[2]}` : name.slice(0, 8);
          if (maxLength && textToSet.length > maxLength) {
            textToSet = match ? match[1] : textToSet.slice(0, maxLength);
          }
          textField.setText(textToSet);
        } catch (e) {
          console.warn(`⚠ ${name}`, e);
        }
      } else if (name.startsWith("cb_")) {
        try {
          form.getCheckBox(name).check();
        } catch (e) {
          console.warn(`⚠ ${name}`, e);
        }
      }
      // Skip radio/dropdown
    }

    console.log("Debug PDF ready, saving (no flatten)...");
    const pdfBytes = await pdfDoc.save();
    console.log(`Debug PDF size: ${pdfBytes.byteLength} bytes`);
    return pdfBytes;
  }

  // Normal mode: load Chinese font
  pdfDoc.registerFontkit(fontkit);
  const chineseFontBytes = await loadChineseFont();
  const chineseFont = await pdfDoc.embedFont(chineseFontBytes);

  const returnDate = data.returnDate || new Date().toISOString().split("T")[0];
  const [year, month, day] = returnDate.split("-");
  const office = data.registeredOffice || {};

  const safeSetText = (fieldName: string, value: string) => {
    try {
      const field = form.getTextField(fieldName);
      const maxLength = field.getMaxLength();
      let textToSet = value ?? "";
      if (maxLength && textToSet.length > maxLength) {
        textToSet = textToSet.slice(0, maxLength);
      }
      field.setText(textToSet);
      console.log(`✓ ${fieldName} = ${JSON.stringify(textToSet)}`);
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

  // ============ Page 1 - Company Info / Business Nature / Return Date / Address ============
  // Header BR number (8 chars max)
  safeSetText("fill_1_P.1", br8);
  // 1. Company Name
  safeSetText("fill_2_P.1", data.name || "");
  // 2. Business Name (if any)
  safeSetText("fill_3_P.1", data.tradingName || "");
  // 3. Company Type checkboxes
  safeCheck("cb_1_P.1", data.companyType?.includes("私人") || data.companyType?.toLowerCase().includes("private") || false);
  safeCheck("cb_2_P.1", data.companyType?.includes("公眾") || data.companyType?.toLowerCase().includes("public") || false);
  safeCheck("cb_3_P.1", data.companyType?.includes("擔保") || false);
  // 9. Business Nature - Code
  safeSetText("fill_4_P.1", data.businessCode || "");
  // 9. Business Nature - Description
  safeSetText("fill_5_P.1", data.businessNature || "");
  // 4. Return Date - Day
  safeSetText("fill_6_P.1", day || "");
  // 4. Return Date - Month
  safeSetText("fill_7_P.1", month || "");
  // 4. Return Date - Year
  safeSetText("fill_8_P.1", year || "");
  // 6. Registered Office Address
  safeSetText("fill_15_P.1", office.flat || "");
  safeSetText("fill_16_P.1", office.building || "");
  safeSetText("fill_17_P.1", office.street || "");
  safeSetText("fill_18_P.1", office.district || "");

  // ============ Page 2 - Mortgages / Members / Share Capital ============
  // BR Number header
  safeSetText("fill_1_P.2", br8);

  // ============ Page 3 - Company Secretary (Natural Person) 12A ============
  // BR Number header
  safeSetText("fill_1_P.3", br8);
  const naturalSecretaries = (data.secretaries || []).filter((s) => s.identity === "natural");
  if (naturalSecretaries.length > 0 || debugMode) {
    const sec = naturalSecretaries[0] || { nameChinese: "", nameEnglish: "", email: "" };
    const { surname, otherNames } = parseEnglishName(sec.nameEnglish);
    // 15. Chinese Name
    safeSetText("fill_2_P.3", sec.nameChinese || "");
    // 15. English Name - Surname
    safeSetText("fill_3_P.3", surname);
    // 15. English Name - Other Names
    safeSetText("fill_4_P.3", otherNames);
    // 17. Email Address
    safeSetText("fill_13_P.3", sec.email || "");
    console.log(`Filled Secretary (Natural): ${sec.nameChinese}`);
  }

  // ============ Page 4 - Company Secretary (Body Corporate) 12B ============
  // BR Number header
  safeSetText("fill_1_P.4", br8);
  const corporateSecretaries = (data.secretaries || []).filter((s) => s.identity === "corporate");
  if (corporateSecretaries.length > 0 || debugMode) {
    const sec = corporateSecretaries[0] || { nameChinese: "", nameEnglish: "", email: "", brNumber: "" };
    // 21. Chinese Name
    safeSetText("fill_2_P.4", sec.nameChinese || "");
    // 21. English Name
    safeSetText("fill_3_P.4", sec.nameEnglish || "");
    // 17. Email Address
    safeSetText("fill_8_P.4", sec.email || "");
    // 19. BR Number
    safeSetText("fill_9_P.4", sec.brNumber || "");
    console.log(`Filled Secretary (Corporate): ${sec.nameChinese || sec.nameEnglish}`);
  }

  // ============ Page 5 - Director (Natural Person) 13A ============
  // BR Number header
  safeSetText("fill_1_P.5", br8);
  const naturalDirectors = (data.directors || []).filter((d) => d.identity === "natural");
  if (naturalDirectors.length > 0 || debugMode) {
    const dir = naturalDirectors[0] || { nameChinese: "", nameEnglish: "", email: "" };
    const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
    // 23. Capacity - Director checkbox
    safeCheck("cb_1_P.5", true);
    // 24. Chinese Name
    safeSetText("fill_2_P.5", dir.nameChinese || "");
    // 24. English Name - Surname
    safeSetText("fill_3_P.5", surname);
    // 24. English Name - Other Names
    safeSetText("fill_4_P.5", otherNames);
    // 26. Email Address
    safeSetText("fill_14_P.5", dir.email || "");
    console.log(`Filled Director (Natural): ${dir.nameChinese}`);
  }

  // ============ Page 6 - Director (Body Corporate) 13B ============
  // BR Number header
  safeSetText("fill_1_P.6", br8);
  const corporateDirectors = (data.directors || []).filter((d) => d.identity === "corporate");
  if (corporateDirectors.length > 0 || debugMode) {
    const dir = corporateDirectors[0] || { nameChinese: "", nameEnglish: "", email: "", brNumber: "" };
    // 23. Capacity - Director checkbox
    safeCheck("cb_1_P.6", true);
    // Chinese Name
    safeSetText("fill_2_P.6", dir.nameChinese || "");
    // English Name
    safeSetText("fill_3_P.6", dir.nameEnglish || "");
    // Email Address
    safeSetText("fill_8_P.6", dir.email || "");
    // BR Number
    safeSetText("fill_9_P.6", dir.brNumber || "");
    console.log(`Filled Director (Corporate): ${dir.nameChinese || dir.nameEnglish}`);
  }

  // ============ Pages 7-15 - Fill BR Number on ALL pages ============
  // Page 7 - Reserve Director
  safeSetText("fill_1_P.7", br8);
  // Page 8 - Service Agent
  safeSetText("fill_1_P.8", br8);
  // Page 9 - Schedule 1
  safeSetText("fill_1_P.9", br8);
  // Page 10 - Schedule 2
  safeSetText("fill_1_P.10", br8);
  // Page 11
  safeSetText("fill_1_P.11", br8);
  // Page 12
  safeSetText("fill_1_P.12", br8);
  // Page 13
  safeSetText("fill_1_P.13", br8);
  // Page 14 - Declaration
  safeSetText("fill_1_P.14", br8);
  // Page 15 - Contact
  safeSetText("fill_1_P.15", br8);

  // Schedule pages (9-15) also have split BR number fields (fill_4 to fill_7)
  // These are 2-digit segments of the BR number
  for (let page = 9; page <= 15; page++) {
    safeSetText(`fill_4_P.${page}`, br8.substring(0, 2));
    safeSetText(`fill_5_P.${page}`, br8.substring(2, 4));
    safeSetText(`fill_6_P.${page}`, br8.substring(4, 6));
    safeSetText(`fill_7_P.${page}`, br8.substring(6, 8));
  }
  
  console.log("Filled BR number on ALL pages (1-15) including split fields on schedule pages");

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
    const requestBody = await req.json();
    
    // List fields mode - return JSON with all field names
    if (requestBody.listFields === true) {
      console.log("Listing all form fields...");
      const fields = await listAllFormFields();
      return new Response(JSON.stringify(fields, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const companyData: CompanyData = requestBody;
    const debugMode = requestBody.debugMode === true;
    console.log(`Generating PDF for company: ${companyData.name} (BR: ${companyData.brNumber}) debugMode: ${debugMode}`);
    
    // Fill the NAR1 PDF template
    const pdfBytes = await fillPdfTemplate(companyData, debugMode);
    
    // For debug mode or when explicitly requested, return as base64 JSON
    if (debugMode) {
      // Convert Uint8Array to base64 safely (avoid stack overflow)
      const base64 = uint8ToBase64(pdfBytes);
      return new Response(JSON.stringify({ pdf: base64 }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }
    
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
