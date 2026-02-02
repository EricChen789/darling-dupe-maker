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
  
  // Load the template PDF
  const templateBytes = await loadPdfTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  
  // Load and embed Chinese font
  const chineseFontBytes = await loadChineseFont();
  const chineseFont = await pdfDoc.embedFont(chineseFontBytes);
  
  const pages = pdfDoc.getPages();
  console.log(`PDF has ${pages.length} pages`);
  
  const returnDate = data.returnDate || new Date().toISOString().split('T')[0];
  const [year, month, day] = returnDate.split('-');
  const office = data.registeredOffice || {};

  // Page 1 - Main company info
  if (pages.length >= 1) {
    const page1 = pages[0];
    const { height, width } = page1.getSize();
    console.log(`Page 1 size: ${width} x ${height}`);
    
    // Business Registration Number (top right)
    page1.drawText(data.brNumber, {
      x: 420,
      y: height - 88,
      size: 10,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    console.log(`Drew BR Number: ${data.brNumber}`);
    
    // 1. Company Name (公司名稱)
    page1.drawText(data.name, {
      x: 95,
      y: height - 168,
      size: 9,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    console.log(`Drew Company Name: ${data.name}`);
    
    // 2. Business Name (商業名稱)
    if (data.tradingName) {
      page1.drawText(data.tradingName, {
        x: 95,
        y: height - 210,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
    }
    
    // 3. Type of Company - checkboxes
    // 私人公司 checkbox at approximately x=95
    // 公眾公司 checkbox at approximately x=218
    // 擔保有限公司 checkbox at approximately x=330
    const companyTypeY = height - 265;
    if (data.companyType?.includes('私人') || data.companyType?.toLowerCase().includes('private')) {
      page1.drawText('✓', { x: 95, y: companyTypeY, size: 14, font: chineseFont, color: rgb(0, 0, 0) });
    } else if (data.companyType?.includes('公眾') || data.companyType?.toLowerCase().includes('public')) {
      page1.drawText('✓', { x: 218, y: companyTypeY, size: 14, font: chineseFont, color: rgb(0, 0, 0) });
    } else if (data.companyType?.includes('擔保')) {
      page1.drawText('✓', { x: 330, y: companyTypeY, size: 14, font: chineseFont, color: rgb(0, 0, 0) });
    }
    
    // 經營業務性質 - Business Nature
    // Code field
    page1.drawText(data.businessCode || '', {
      x: 140,
      y: height - 315,
      size: 9,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    
    // Description field
    page1.drawText(data.businessNature || '', {
      x: 290,
      y: height - 315,
      size: 8,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    
    // 4. Return Date (本申報表的結算日期)
    // DD MM YYYY format
    page1.drawText(day, { x: 398, y: height - 358, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
    page1.drawText(month, { x: 445, y: height - 358, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
    page1.drawText(year, { x: 498, y: height - 358, size: 10, font: chineseFont, color: rgb(0, 0, 0) });
    
    // 6. Registered Office Address (在香港的註冊辦事處地址)
    // 室／樓／座等
    page1.drawText(office.flat || '', {
      x: 300,
      y: height - 468,
      size: 9,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    
    // 大廈
    page1.drawText(office.building || '', {
      x: 300,
      y: height - 496,
      size: 9,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    
    // 街道／屋苑／地段／村等
    page1.drawText(office.street || '', {
      x: 300,
      y: height - 524,
      size: 9,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    
    // 區
    page1.drawText(office.district || '', {
      x: 300,
      y: height - 552,
      size: 9,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
  }
  
  // Page 2 - BR number header
  if (pages.length >= 2) {
    const page2 = pages[1];
    const { height } = page2.getSize();
    
    page2.drawText(data.brNumber, {
      x: 420,
      y: height - 48,
      size: 10,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
  }
  
  // Page 3 - Company Secretary (Natural Person)
  if (pages.length >= 3 && data.secretaries.length > 0) {
    const page3 = pages[2];
    const { height } = page3.getSize();
    
    // BR Number header
    page3.drawText(data.brNumber, {
      x: 420,
      y: height - 48,
      size: 10,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    
    const naturalSecretaries = data.secretaries.filter(s => s.identity === 'natural');
    if (naturalSecretaries.length > 0) {
      const sec = naturalSecretaries[0];
      
      // Parse English name - format: "FirstName LASTNAME"
      const nameParts = sec.nameEnglish.split(' ');
      const surname = nameParts[nameParts.length - 1] || '';
      const otherNames = nameParts.slice(0, -1).join(' ') || '';
      
      // 中文姓名
      page3.drawText(sec.nameChinese, {
        x: 170,
        y: height - 135,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 英文姓氏 (Surname)
      page3.drawText(surname, {
        x: 350,
        y: height - 135,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 其他英文名字 (Other Names)
      page3.drawText(otherNames, {
        x: 170,
        y: height - 162,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 電郵
      page3.drawText(sec.email, {
        x: 170,
        y: height - 310,
        size: 8,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      console.log(`Drew Secretary: ${sec.nameChinese}`);
    }
  }
  
  // Page 4 - Company Secretary (Corporate)
  if (pages.length >= 4) {
    const page4 = pages[3];
    const { height } = page4.getSize();
    
    page4.drawText(data.brNumber, {
      x: 420,
      y: height - 48,
      size: 10,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    
    const corporateSecretaries = data.secretaries.filter(s => s.identity === 'corporate');
    if (corporateSecretaries.length > 0) {
      const sec = corporateSecretaries[0];
      
      // 公司秘書名稱 (中文)
      page4.drawText(sec.nameChinese, {
        x: 170,
        y: height - 130,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 公司秘書名稱 (英文)
      page4.drawText(sec.nameEnglish, {
        x: 170,
        y: height - 157,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 商業登記號碼
      if (sec.brNumber) {
        page4.drawText(sec.brNumber, {
          x: 170,
          y: height - 240,
          size: 9,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
      }
    }
  }
  
  // Page 5 - Directors (Natural Person)
  if (pages.length >= 5 && data.directors.length > 0) {
    const page5 = pages[4];
    const { height } = page5.getSize();
    
    // BR Number header
    page5.drawText(data.brNumber, {
      x: 420,
      y: height - 48,
      size: 10,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    
    const naturalDirectors = data.directors.filter(d => d.identity === 'natural');
    if (naturalDirectors.length > 0) {
      const dir = naturalDirectors[0];
      
      // 董事 checkbox
      page5.drawText('✓', {
        x: 178,
        y: height - 105,
        size: 14,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      const nameParts = dir.nameEnglish.split(' ');
      const surname = nameParts[nameParts.length - 1] || '';
      const otherNames = nameParts.slice(0, -1).join(' ') || '';
      
      // 中文姓名
      page5.drawText(dir.nameChinese, {
        x: 170,
        y: height - 135,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 英文姓氏
      page5.drawText(surname, {
        x: 350,
        y: height - 135,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 其他英文名字
      page5.drawText(otherNames, {
        x: 170,
        y: height - 162,
        size: 9,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      // 電郵
      page5.drawText(dir.email, {
        x: 170,
        y: height - 310,
        size: 8,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      
      console.log(`Drew Director: ${dir.nameChinese}`);
    }
  }
  
  // Add BR number to all remaining pages
  for (let i = 5; i < pages.length; i++) {
    const page = pages[i];
    const { height } = page.getSize();
    
    page.drawText(data.brNumber, {
      x: 420,
      y: height - 48,
      size: 10,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
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
