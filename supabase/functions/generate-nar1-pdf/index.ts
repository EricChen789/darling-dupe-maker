import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
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

// Noto Sans SC font URL (Google Fonts CDN - subset for common Chinese characters)
const CHINESE_FONT_URL = "https://fonts.gstatic.com/s/notosanssc/v36/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYxNbPzS5HE.ttf";

async function loadChineseFont(): Promise<ArrayBuffer> {
  console.log("Loading Chinese font from Google Fonts...");
  const response = await fetch(CHINESE_FONT_URL);
  if (!response.ok) {
    throw new Error(`Failed to load Chinese font: ${response.status}`);
  }
  const fontBytes = await response.arrayBuffer();
  console.log(`Chinese font loaded successfully, size: ${fontBytes.byteLength} bytes`);
  return fontBytes;
}

async function createPDF(data: CompanyData): Promise<Uint8Array> {
  console.log("Creating PDF document...");
  
  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  
  // Load and embed Chinese font
  const chineseFontBytes = await loadChineseFont();
  const chineseFont = await pdfDoc.embedFont(chineseFontBytes, { subset: true });
  
  // Also embed a standard font for fallback
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const returnDate = data.returnDate || new Date().toISOString().split('T')[0];
  
  // Page 1 - Company Basic Info
  let page = pdfDoc.addPage([595, 842]); // A4 size
  const { height } = page.getSize();
  let y = height - 50;
  
  // Title
  page.drawText("NAR1 周年申報表 / Annual Return", {
    x: 50,
    y: y,
    size: 18,
    font: chineseFont,
    color: rgb(0, 0, 0),
  });
  y -= 30;
  
  page.drawText("香港公司註冊處 Companies Registry, Hong Kong", {
    x: 50,
    y: y,
    size: 10,
    font: chineseFont,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 40;
  
  // Helper function to draw labeled field
  const drawField = (label: string, value: string, fontSize: number = 10) => {
    page.drawText(label, {
      x: 50,
      y: y,
      size: fontSize,
      font: chineseFont,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 15;
    page.drawText(value || "-", {
      x: 70,
      y: y,
      size: fontSize,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    y -= 20;
  };
  
  // Section 1: Company Info
  page.drawText("1. 公司資料 Company Information", {
    x: 50,
    y: y,
    size: 12,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 25;
  
  drawField("商業登記號碼 Business Registration Number:", data.brNumber);
  drawField("公司名稱 Company Name:", data.name);
  drawField("商業名稱 Business Name:", data.tradingName);
  drawField("公司類別 Type of Company:", data.companyType);
  drawField("業務性質 Business Nature:", data.businessNature);
  drawField("業務代碼 Business Code:", data.businessCode);
  drawField("申報表結算日期 Return Date:", returnDate);
  
  // Section 2: Registered Office
  y -= 10;
  page.drawText("2. 註冊辦事處地址 Registered Office Address", {
    x: 50,
    y: y,
    size: 12,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 25;
  
  const office = data.registeredOffice || {};
  if (office.flat) drawField("室/樓/座 Flat/Floor/Block:", office.flat);
  if (office.building) drawField("大廈 Building:", office.building);
  if (office.street) drawField("街道 Street:", office.street);
  if (office.district) drawField("區 District:", office.district);
  drawField("地區 Region:", office.region || "香港 Hong Kong");
  
  // Page 2 - Directors
  page = pdfDoc.addPage([595, 842]);
  y = height - 50;
  
  page.drawText("3. 董事 Directors", {
    x: 50,
    y: y,
    size: 14,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 30;
  
  if (data.directors.length === 0) {
    page.drawText("無董事資料 No directors on record", {
      x: 70,
      y: y,
      size: 10,
      font: chineseFont,
      color: rgb(0.5, 0.5, 0.5),
    });
    y -= 25;
  } else {
    for (let i = 0; i < data.directors.length; i++) {
      const dir = data.directors[i];
      
      // Check if we need a new page
      if (y < 150) {
        page = pdfDoc.addPage([595, 842]);
        y = height - 50;
      }
      
      const identityLabel = dir.identity === 'natural' ? '自然人 Natural Person' : '法人團體 Body Corporate';
      
      page.drawText(`${i + 1}. ${identityLabel}`, {
        x: 50,
        y: y,
        size: 11,
        font: chineseFont,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 18;
      
      page.drawText(`中文姓名 Name in Chinese: ${dir.nameChinese}`, {
        x: 70,
        y: y,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`英文姓名 Name in English: ${dir.nameEnglish}`, {
        x: 70,
        y: y,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`電郵地址 Email: ${dir.email}`, {
        x: 70,
        y: y,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      if (dir.identity === 'corporate' && dir.brNumber) {
        page.drawText(`商業登記號碼 BR Number: ${dir.brNumber}`, {
          x: 70,
          y: y,
          size: 10,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        y -= 15;
      }
      
      y -= 15;
    }
  }
  
  // Page 3 - Secretaries
  if (y < 200) {
    page = pdfDoc.addPage([595, 842]);
    y = height - 50;
  } else {
    y -= 20;
  }
  
  page.drawText("4. 公司秘書 Company Secretary", {
    x: 50,
    y: y,
    size: 14,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 30;
  
  if (data.secretaries.length === 0) {
    page.drawText("無秘書資料 No secretaries on record", {
      x: 70,
      y: y,
      size: 10,
      font: chineseFont,
      color: rgb(0.5, 0.5, 0.5),
    });
    y -= 25;
  } else {
    for (let i = 0; i < data.secretaries.length; i++) {
      const sec = data.secretaries[i];
      
      if (y < 150) {
        page = pdfDoc.addPage([595, 842]);
        y = height - 50;
      }
      
      const identityLabel = sec.identity === 'natural' ? '自然人 Natural Person' : '法人團體 Body Corporate';
      
      page.drawText(`${i + 1}. ${identityLabel}`, {
        x: 50,
        y: y,
        size: 11,
        font: chineseFont,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 18;
      
      page.drawText(`中文名稱 Name in Chinese: ${sec.nameChinese}`, {
        x: 70,
        y: y,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`英文名稱 Name in English: ${sec.nameEnglish}`, {
        x: 70,
        y: y,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`電郵地址 Email: ${sec.email}`, {
        x: 70,
        y: y,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      if (sec.identity === 'corporate' && sec.brNumber) {
        page.drawText(`商業登記號碼 BR Number: ${sec.brNumber}`, {
          x: 70,
          y: y,
          size: 10,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        y -= 15;
      }
      
      y -= 15;
    }
  }
  
  // Page 4 - Shareholders
  if (y < 200) {
    page = pdfDoc.addPage([595, 842]);
    y = height - 50;
  } else {
    y -= 20;
  }
  
  page.drawText("5. 股東詳情 Shareholder Particulars", {
    x: 50,
    y: y,
    size: 14,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 30;
  
  if (data.shareholders.length === 0) {
    page.drawText("無股東資料 No shareholders on record", {
      x: 70,
      y: y,
      size: 10,
      font: chineseFont,
      color: rgb(0.5, 0.5, 0.5),
    });
  } else {
    for (let i = 0; i < data.shareholders.length; i++) {
      const sh = data.shareholders[i];
      
      if (y < 100) {
        page = pdfDoc.addPage([595, 842]);
        y = height - 50;
      }
      
      page.drawText(`${i + 1}. 股東名稱 Shareholder: ${sh.name}`, {
        x: 70,
        y: y,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`   股份數目 Shares: ${sh.shares.toLocaleString()}`, {
        x: 70,
        y: y,
        size: 10,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 25;
    }
  }
  
  // Footer on last page
  y = 50;
  page.drawText(`文件生成日期 Document Generated: ${new Date().toLocaleString('zh-TW')}`, {
    x: 50,
    y: y,
    size: 8,
    font: chineseFont,
    color: rgb(0.5, 0.5, 0.5),
  });
  
  console.log("PDF created successfully, serializing...");
  const pdfBytes = await pdfDoc.save();
  console.log(`PDF size: ${pdfBytes.byteLength} bytes`);
  
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
    
    // Create PDF with embedded Chinese font
    const pdfBytes = await createPDF(companyData);
    
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
