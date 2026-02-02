import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, rgb } from "https://esm.sh/pdf-lib@1.17.1";
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

// Chinese font URLs
const CHINESE_FONT_URLS = [
  "https://fonts.gstatic.com/ea/notosanstc/v1/NotoSansTC-Regular.otf",
  "https://fonts.gstatic.com/ea/notosanssc/v1/NotoSansSC-Regular.otf",
];

async function loadChineseFont(): Promise<ArrayBuffer> {
  console.log("Loading Chinese font...");
  
  for (const url of CHINESE_FONT_URLS) {
    try {
      console.log(`Trying font URL: ${url}`);
      const response = await fetch(url, { headers: { 'Accept': '*/*' } });
      
      if (response.ok) {
        const fontBytes = await response.arrayBuffer();
        console.log(`Font loaded successfully, size: ${fontBytes.byteLength} bytes`);
        return fontBytes;
      }
    } catch (e) {
      console.log(`Font URL ${url} failed: ${e}`);
    }
  }
  
  throw new Error("Failed to load Chinese font");
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
  
  // Load the template PDF
  const templateBytes = await loadPdfTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  
  // Load and embed Chinese font
  const chineseFontBytes = await loadChineseFont();
  const chineseFont = await pdfDoc.embedFont(chineseFontBytes);
  
  // Try to get form fields
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  
  console.log(`Found ${fields.length} form fields in template`);
  
  // Log all field names for debugging
  fields.forEach((field, index) => {
    console.log(`Field ${index}: ${field.getName()} (${field.constructor.name})`);
  });
  
  // If the PDF has form fields, try to fill them
  if (fields.length > 0) {
    console.log("PDF has form fields, attempting to fill...");
    
    // Try to fill common field patterns
    try {
      // Update field appearances with Chinese font
      form.updateFieldAppearances(chineseFont);
    } catch (e) {
      console.log("Could not update field appearances:", e);
    }
    
    // Try to flatten the form after filling
    try {
      form.flatten();
    } catch (e) {
      console.log("Could not flatten form:", e);
    }
  } else {
    // No form fields - we need to draw text directly on the PDF
    console.log("No form fields found, drawing text directly on PDF pages...");
    
    const pages = pdfDoc.getPages();
    const returnDate = data.returnDate || new Date().toISOString().split('T')[0];
    const [year, month, day] = returnDate.split('-');
    
    // Page 1 - Main company info
    if (pages.length >= 1) {
      const page1 = pages[0];
      const { height } = page1.getSize();
      
      // Business Registration Number (top right area)
      page1.drawText(data.brNumber, {
        x: 460,
        y: height - 85,
        size: 11,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 1. Company Name
      page1.drawText(data.name, {
        x: 100,
        y: height - 165,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 2. Business Name
      page1.drawText(data.tradingName || '', {
        x: 100,
        y: height - 215,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 3. Type of Company - draw a checkmark
      const companyTypeY = height - 275;
      if (data.companyType?.includes('私人') || data.companyType?.toLowerCase().includes('private')) {
        page1.drawText('✓', { x: 100, y: companyTypeY, size: 14, font: chineseFont, color: rgb(0, 0, 0) });
      } else if (data.companyType?.includes('公眾') || data.companyType?.toLowerCase().includes('public')) {
        page1.drawText('✓', { x: 205, y: companyTypeY, size: 14, font: chineseFont, color: rgb(0, 0, 0) });
      } else if (data.companyType?.includes('擔保')) {
        page1.drawText('✓', { x: 318, y: companyTypeY, size: 14, font: chineseFont, color: rgb(0, 0, 0) });
      }
      
      // Business Nature - Code and Description
      page1.drawText(data.businessCode || '', {
        x: 158,
        y: height - 330,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      page1.drawText(data.businessNature || '', {
        x: 290,
        y: height - 330,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 4. Return Date (DD MM YYYY)
      page1.drawText(day, { x: 430, y: height - 370, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
      page1.drawText(month, { x: 475, y: height - 370, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
      page1.drawText(year, { x: 520, y: height - 370, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
      
      // 6. Registered Office Address
      const office = data.registeredOffice || {};
      const officeStartY = height - 500;
      
      if (office.flat) {
        page1.drawText(office.flat, { x: 170, y: officeStartY, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
      }
      if (office.building) {
        page1.drawText(office.building, { x: 170, y: officeStartY - 30, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
      }
      if (office.street) {
        page1.drawText(office.street, { x: 170, y: officeStartY - 60, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
      }
      if (office.district) {
        page1.drawText(office.district, { x: 170, y: officeStartY - 90, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
      }
    }
    
    // Page 2 - Continue with BR number at top
    if (pages.length >= 2) {
      const page2 = pages[1];
      const { height } = page2.getSize();
      
      // BR Number at top
      page2.drawText(data.brNumber, {
        x: 460,
        y: height - 48,
        size: 11,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
    }
    
    // Page 3 - Company Secretary (Natural Person)
    if (pages.length >= 3 && data.secretaries.length > 0) {
      const page3 = pages[2];
      const { height } = page3.getSize();
      
      // BR Number at top
      page3.drawText(data.brNumber, {
        x: 460,
        y: height - 48,
        size: 11,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      const naturalSecretaries = data.secretaries.filter(s => s.identity === 'natural');
      if (naturalSecretaries.length > 0) {
        const sec = naturalSecretaries[0];
        
        // Chinese name
        page3.drawText(sec.nameChinese, {
          x: 180,
          y: height - 145,
          size: 10,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        
        // English name - split into surname and other names
        const nameParts = sec.nameEnglish.split(' ');
        const surname = nameParts[nameParts.length - 1] || '';
        const otherNames = nameParts.slice(0, -1).join(' ') || '';
        
        page3.drawText(surname, {
          x: 350,
          y: height - 145,
          size: 10,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        
        page3.drawText(otherNames, {
          x: 180,
          y: height - 170,
          size: 10,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        
        // Email
        page3.drawText(sec.email, {
          x: 180,
          y: height - 320,
          size: 9,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
      }
    }
    
    // Page 5 - Directors (Natural Person)
    if (pages.length >= 5 && data.directors.length > 0) {
      const page5 = pages[4];
      const { height } = page5.getSize();
      
      // BR Number at top
      page5.drawText(data.brNumber, {
        x: 460,
        y: height - 48,
        size: 11,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      const naturalDirectors = data.directors.filter(d => d.identity === 'natural');
      if (naturalDirectors.length > 0) {
        const dir = naturalDirectors[0];
        
        // Check "董事" box
        page5.drawText('✓', {
          x: 185,
          y: height - 115,
          size: 14,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        
        // Chinese name
        page5.drawText(dir.nameChinese, {
          x: 180,
          y: height - 145,
          size: 10,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        
        // English name
        const nameParts = dir.nameEnglish.split(' ');
        const surname = nameParts[nameParts.length - 1] || '';
        const otherNames = nameParts.slice(0, -1).join(' ') || '';
        
        page5.drawText(surname, {
          x: 350,
          y: height - 145,
          size: 10,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        
        page5.drawText(otherNames, {
          x: 180,
          y: height - 170,
          size: 10,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        
        // Email
        page5.drawText(dir.email, {
          x: 180,
          y: height - 320,
          size: 9,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
      }
    }
    
    // Add BR number to remaining pages
    for (let i = 1; i < pages.length; i++) {
      const page = pages[i];
      const { height } = page.getSize();
      
      // Most pages have BR number at top right
      if (i !== 0) {
        page.drawText(data.brNumber, {
          x: 460,
          y: height - 48,
          size: 11,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
      }
    }
  }
  
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
