import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, PDFName, PDFString, PDFHexString } from "https://esm.sh/pdf-lib@1.17.1";

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

interface OfficerData {
  nameChinese: string;
  nameEnglish: string;
  email: string;
  identity: 'natural' | 'corporate';
  brNumber?: string;
  address?: string;
  idNumber?: string;
  dateAppointed?: string;
  placeIncorporated?: string;
  companyNumberRef?: string;
}

interface ShareholderData {
  name: string;
  nameEnglish?: string;
  nameChinese?: string;
  shares: number;
  identity?: string;
  idNumber?: string;
  address?: string;
  shareType?: string;
}

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
  directors: OfficerData[];
  secretaries: OfficerData[];
  shareholders: ShareholderData[];
  returnDate?: string;
}

const TEMPLATE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/NAR1-template-v2.pdf";

async function loadPdfTemplate(): Promise<ArrayBuffer> {
  console.log("Loading NAR1 PDF template...");
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) throw new Error(`Failed to load PDF template: ${response.status}`);
  return await response.arrayBuffer();
}

async function listAllFormFields(): Promise<{ fields: Array<{name: string; type: string}> }> {
  const templateBytes = await loadPdfTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const allFields = form.getFields();
  const fields = allFields.map(f => ({ name: f.getName(), type: f.constructor.name }));
  fields.sort((a, b) => a.name.localeCompare(b.name));
  return { fields };
}

const parseEnglishName = (fullName: string) => {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  const surname = parts.length ? parts[parts.length - 1] : "";
  const otherNames = parts.slice(0, -1).join(" ");
  return { surname, otherNames };
};

// Parse a full address string into components
const parseAddress = (addr: string) => {
  if (!addr) return { flat: '', building: '', street: '', district: '', country: '' };
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return { flat: '', building: '', street: addr, district: '', country: '' };
  
  // Last part is usually country/region
  const country = parts[parts.length - 1] || '';
  // Second-to-last is district
  const district = parts.length > 2 ? parts[parts.length - 2] : '';
  // First part is flat/room
  const flat = parts[0] || '';
  // Middle parts are building and street
  const middle = parts.slice(1, Math.max(1, parts.length - 2));
  const building = middle.length > 0 ? middle[0] : '';
  const street = middle.length > 1 ? middle.slice(1).join(', ') : '';
  
  return { flat, building, street, district, country };
};

// Parse HKID partial (first letter + last 3 digits before check digit)
const parseHkidPartial = (idNumber: string) => {
  if (!idNumber) return '';
  // Match HKID pattern like A123456(7) or AB123456(7)
  const m = idNumber.match(/^([A-Z]{1,2}\d{6})\s*\((\d)\)$/);
  if (m) {
    // Return partial: first letter(s) + *** + last digit + (check)
    const full = m[1];
    return full.charAt(0) + '***' + full.slice(-1) + '(' + m[2] + ')';
  }
  return '';
};

async function fillPdfTemplate(data: CompanyData, debugMode = false): Promise<Uint8Array> {
  console.log("Loading and filling PDF template...");
  const templateBytes = await loadPdfTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  if (debugMode) {
    const fields = form.getFields();
    for (const field of fields) {
      const name = field.getName();
      if (name.startsWith("fill_")) {
        try {
          const textField = form.getTextField(name);
          const maxLength = textField.getMaxLength();
          const match = name.match(/fill_(\d+)_P\.(\d+)/);
          let textToSet = match ? `${match[1]}.${match[2]}` : name.slice(0, 8);
          if (maxLength && textToSet.length > maxLength) textToSet = match ? match[1] : textToSet.slice(0, maxLength);
          textField.setText(textToSet);
        } catch (e) { console.warn(`⚠ ${name}`, e); }
      } else if (name.startsWith("cb_")) {
        try { form.getCheckBox(name).check(); } catch (e) { console.warn(`⚠ ${name}`, e); }
      }
    }
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  }

  // Normal mode - no font embedding, PDF viewer uses system fonts for CJK

  const returnDate = data.returnDate || new Date().toISOString().split("T")[0];
  const [year, month, day] = returnDate.split("-");
  const office = data.registeredOffice || {};

  // Check if string contains non-ASCII (CJK) characters
  const hasNonAscii = (s: string) => /[^\x00-\x7F]/.test(s);

  const safeSetText = (fieldName: string, value: string) => {
    try {
      const field = form.getTextField(fieldName);
      let textToSet = value ?? "";
      const maxLength = field.getMaxLength();
      if (maxLength && textToSet.length > maxLength) textToSet = textToSet.slice(0, maxLength);
      
      if (hasNonAscii(textToSet)) {
        // For CJK text: set the value directly without appearance streams
        const dict = field.acroField.dict;
        dict.set(PDFName.of('V'), PDFHexString.fromText(textToSet));
        dict.delete(PDFName.of('AP'));
      } else {
        field.setText(textToSet);
      }
      return true;
    } catch (e) {
      console.warn(`⚠ Missing: ${fieldName}`, e);
      return false;
    }
  };

  const safeCheck = (fieldName: string, shouldCheck: boolean) => {
    if (!shouldCheck) return false;
    try { form.getCheckBox(fieldName).check(); return true; }
    catch (e) { return false; }
  };

  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

  // ============ Page 1 - Company Info ============
  safeSetText("fill_1_P.1", br8);
  safeSetText("fill_2_P.1", data.name || "");
  safeSetText("fill_3_P.1", data.tradingName || "");
  safeCheck("cb_1_P.1", data.companyType?.includes("私人") || data.companyType?.toLowerCase().includes("private") || false);
  safeCheck("cb_2_P.1", data.companyType?.includes("公眾") || data.companyType?.toLowerCase().includes("public") || false);
  safeCheck("cb_3_P.1", data.companyType?.includes("擔保") || false);
  safeSetText("fill_4_P.1", data.businessCode || "");
  safeSetText("fill_5_P.1", data.businessNature || "");
  safeSetText("fill_6_P.1", day || "");
  safeSetText("fill_7_P.1", month || "");
  safeSetText("fill_8_P.1", year || "");
  safeSetText("fill_15_P.1", office.flat || "");
  safeSetText("fill_16_P.1", office.building || "");
  safeSetText("fill_17_P.1", office.street || "");
  safeSetText("fill_18_P.1", office.district || "");

  // ============ Page 2 - Share Capital ============
  safeSetText("fill_1_P.2", br8);
  
  // Fill share capital from shareholder data - aggregate by share type
  const shareTypeMap = new Map<string, { shares: number; currency: string; className: string; paidUp: string }>();
  for (const sh of data.shareholders) {
    const st = sh.shareType || 'ORD';
    if (!shareTypeMap.has(st)) {
      // Parse share type like "ORD - HK$1.00 ORDINARY FULLY PAID (HK$)"
      const currMatch = st.match(/\((\w+\$?)\)/) || st.match(/(HK\$|USD|RMB|GBP)/);
      const parMatch = st.match(/(\w+\$?[\d.]+)/);
      shareTypeMap.set(st, {
        shares: 0,
        currency: currMatch ? currMatch[1] : 'HK$',
        className: st.split(' - ')[0] || 'ORD',
        paidUp: parMatch ? parMatch[1] : '',
      });
    }
    const entry = shareTypeMap.get(st)!;
    entry.shares += sh.shares;
  }
  
  let shareIdx = 0;
  for (const [, info] of shareTypeMap) {
    if (shareIdx >= 6) break;
    const base = 4 + shareIdx * 4;
    safeSetText(`fill_${base}_P.2`, info.className);
    safeSetText(`fill_${base + 1}_P.2`, info.currency);
    safeSetText(`fill_${base + 2}_P.2`, info.shares.toLocaleString());
    safeSetText(`fill_${base + 3}_P.2`, info.paidUp);
    shareIdx++;
  }

  // ============ Page 3 - Secretary (Natural Person) 12A ============
  safeSetText("fill_1_P.3", br8);
  const naturalSecretaries = (data.secretaries || []).filter(s => s.identity === "natural");
  if (naturalSecretaries.length > 0) {
    const sec = naturalSecretaries[0];
    const { surname, otherNames } = parseEnglishName(sec.nameEnglish);
    safeSetText("fill_2_P.3", sec.nameChinese || "");
    safeSetText("fill_3_P.3", surname);
    safeSetText("fill_4_P.3", otherNames);
    // Address
    const addr = parseAddress(sec.address || '');
    safeSetText("fill_9_P.3", addr.flat);
    safeSetText("fill_10_P.3", addr.building);
    safeSetText("fill_11_P.3", addr.street);
    safeSetText("fill_12_P.3", addr.district);
    safeSetText("fill_13_P.3", sec.email || "");
    // HKID partial
    const hkid = parseHkidPartial(sec.idNumber || '');
    if (hkid) safeSetText("fill_14_P.3", hkid);
    console.log(`Filled Secretary (Natural): ${sec.nameEnglish || sec.nameChinese}`);
  }

  // ============ Page 4 - Secretary (Body Corporate) 12B ============
  safeSetText("fill_1_P.4", br8);
  const corporateSecretaries = (data.secretaries || []).filter(s => s.identity === "corporate");
  if (corporateSecretaries.length > 0) {
    const sec = corporateSecretaries[0];
    safeSetText("fill_2_P.4", sec.nameChinese || "");
    safeSetText("fill_3_P.4", sec.nameEnglish || "");
    const addr = parseAddress(sec.address || '');
    safeSetText("fill_4_P.4", addr.flat);
    safeSetText("fill_5_P.4", addr.building);
    safeSetText("fill_6_P.4", addr.street);
    safeSetText("fill_7_P.4", addr.district);
    safeSetText("fill_8_P.4", sec.email || "");
    safeSetText("fill_9_P.4", sec.companyNumberRef || sec.brNumber || "");
    console.log(`Filled Secretary (Corporate): ${sec.nameEnglish || sec.nameChinese}`);
  }

  // ============ Page 5 - Director (Natural Person) 13A ============
  safeSetText("fill_1_P.5", br8);
  const naturalDirectors = (data.directors || []).filter(d => d.identity === "natural");
  if (naturalDirectors.length > 0) {
    const dir = naturalDirectors[0];
    const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
    safeCheck("cb_1_P.5", true);
    safeSetText("fill_2_P.5", dir.nameChinese || "");
    safeSetText("fill_3_P.5", surname);
    safeSetText("fill_4_P.5", otherNames);
    // Address
    const addr = parseAddress(dir.address || '');
    safeSetText("fill_9_P.5", addr.flat);
    safeSetText("fill_10_P.5", addr.building);
    safeSetText("fill_11_P.5", addr.street);
    safeSetText("fill_12_P.5", addr.district);
    safeSetText("fill_13_P.5", addr.country);
    safeSetText("fill_14_P.5", dir.email || "");
    // HKID
    const hkid = parseHkidPartial(dir.idNumber || '');
    if (hkid) safeSetText("fill_15_P.5", hkid);
    console.log(`Filled Director (Natural): ${dir.nameEnglish || dir.nameChinese}`);
  }

  // ============ Page 6 - Director (Body Corporate) 13B ============
  safeSetText("fill_1_P.6", br8);
  const corporateDirectors = (data.directors || []).filter(d => d.identity === "corporate");
  if (corporateDirectors.length > 0) {
    const dir = corporateDirectors[0];
    safeCheck("cb_1_P.6", true);
    safeSetText("fill_2_P.6", dir.nameChinese || "");
    safeSetText("fill_3_P.6", dir.nameEnglish || "");
    const addr = parseAddress(dir.address || '');
    safeSetText("fill_4_P.6", addr.flat);
    safeSetText("fill_5_P.6", addr.building);
    safeSetText("fill_6_P.6", addr.street);
    safeSetText("fill_7_P.6", addr.district);
    safeSetText("fill_8_P.6", dir.email || "");
    safeSetText("fill_9_P.6", dir.companyNumberRef || dir.brNumber || "");
    // Place of incorporation
    if (dir.placeIncorporated) {
      const isHK = dir.placeIncorporated.toUpperCase().includes('HONG KONG');
      safeCheck("cb_3_P.6", isHK);
      safeCheck("cb_4_P.6", !isHK);
      if (!isHK) {
        safeSetText("fill_10_P.6", dir.placeIncorporated);
      }
    }
    console.log(`Filled Director (Corporate): ${dir.nameEnglish || dir.nameChinese}`);
  }

  // ============ Pages 7-8 - BR Number ============
  safeSetText("fill_1_P.7", br8);
  safeSetText("fill_1_P.8", br8);

  // ============ Pages 9-13 - Schedule: Members (Shareholders) ============
  // Page 9 header fields
  for (let page = 9; page <= 13; page++) {
    safeSetText(`fill_4_P.${page}`, br8);
  }

  // Fill shareholder details on page 9+ (schedule pages)
  // NAR1 schedule page 9 has specific fields for listing shareholders
  // Each shareholder entry needs: name, address, shares held, share class
  // The exact field layout depends on the template - we fill what we can
  
  // ============ Pages 14-15 - Declaration ============
  safeSetText("fill_1_P.14", br8);
  safeSetText("fill_1_P.15", br8);

  // Keep form interactive so PDF viewer renders CJK with system fonts
  console.log("PDF filled with all data, serializing...");
  const pdfBytes = await pdfDoc.save();
  console.log(`Final PDF size: ${pdfBytes.byteLength} bytes`);
  return pdfBytes;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    
    if (requestBody.listFields === true) {
      const fields = await listAllFormFields();
      return new Response(JSON.stringify(fields, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const companyData: CompanyData = requestBody;
    const debugMode = requestBody.debugMode === true;
    console.log(`Generating PDF for: ${companyData.name} (BR: ${companyData.brNumber}) debug: ${debugMode}`);
    
    const pdfBytes = await fillPdfTemplate(companyData, debugMode);
    
    if (debugMode) {
      const base64 = uint8ToBase64(pdfBytes);
      return new Response(JSON.stringify({ pdf: base64 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
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
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});