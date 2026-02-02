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

// Use Noto Sans SC Regular (static, not variable) - this URL points to the full static font
const CHINESE_FONT_URL = "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";

// Fallback to a smaller but reliable font
const FALLBACK_FONT_URL = "https://cdn.jsdelivr.net/npm/source-han-sans-sc@1.0.0/SourceHanSansSC-Regular.otf";

async function loadChineseFont(): Promise<ArrayBuffer> {
  console.log("Loading Chinese font...");
  
  // Try primary font first
  try {
    const response = await fetch(CHINESE_FONT_URL, {
      headers: {
        'Accept': 'application/octet-stream,*/*',
      }
    });
    if (response.ok) {
      const fontBytes = await response.arrayBuffer();
      console.log(`Chinese font loaded successfully from primary source, size: ${fontBytes.byteLength} bytes`);
      return fontBytes;
    }
  } catch (e) {
    console.log("Primary font source failed, trying fallback...");
  }

  // Try fallback font
  try {
    const response = await fetch(FALLBACK_FONT_URL);
    if (response.ok) {
      const fontBytes = await response.arrayBuffer();
      console.log(`Chinese font loaded from fallback, size: ${fontBytes.byteLength} bytes`);
      return fontBytes;
    }
  } catch (e) {
    console.log("Fallback font source also failed");
  }
  
  throw new Error("Failed to load Chinese font from all sources");
}

async function createPDF(data: CompanyData): Promise<Uint8Array> {
  console.log("Creating PDF document...");
  
  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  
  // Load and embed Chinese font - DO NOT use subset for CJK fonts
  const chineseFontBytes = await loadChineseFont();
  const chineseFont = await pdfDoc.embedFont(chineseFontBytes);
  
  const returnDate = data.returnDate || new Date().toISOString().split('T')[0];
  
  // Page 1 - Company Basic Info
  let page = pdfDoc.addPage([595, 842]); // A4 size
  const { height } = page.getSize();
  let y = height - 50;
  
  const titleSize = 16;
  const headingSize = 12;
  const labelSize = 9;
  const textSize = 10;
  
  // Title
  page.drawText("NAR1 周年申報表", {
    x: 50,
    y: y,
    size: titleSize,
    font: chineseFont,
    color: rgb(0, 0, 0),
  });
  
  page.drawText("Annual Return", {
    x: 200,
    y: y,
    size: titleSize,
    font: chineseFont,
    color: rgb(0, 0, 0),
  });
  y -= 25;
  
  page.drawText("香港公司註冊處 Companies Registry, Hong Kong", {
    x: 50,
    y: y,
    size: labelSize,
    font: chineseFont,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 35;
  
  // Helper function to draw labeled field with proper spacing
  const drawField = (chineseLabel: string, englishLabel: string, value: string) => {
    // Chinese label
    page.drawText(chineseLabel, {
      x: 50,
      y: y,
      size: labelSize,
      font: chineseFont,
      color: rgb(0.3, 0.3, 0.3),
    });
    // English label
    page.drawText(englishLabel, {
      x: 50,
      y: y - 12,
      size: labelSize - 1,
      font: chineseFont,
      color: rgb(0.5, 0.5, 0.5),
    });
    // Value
    page.drawText(value || "-", {
      x: 200,
      y: y - 6,
      size: textSize,
      font: chineseFont,
      color: rgb(0, 0, 0),
    });
    y -= 30;
  };
  
  // Section 1: Company Info
  page.drawText("1. 公司資料 Company Information", {
    x: 50,
    y: y,
    size: headingSize,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 25;
  
  drawField("商業登記號碼", "Business Registration Number", data.brNumber);
  drawField("公司名稱", "Company Name", data.name);
  drawField("商業名稱", "Business Name", data.tradingName);
  drawField("公司類別", "Type of Company", data.companyType);
  drawField("業務性質", "Business Nature", data.businessNature);
  drawField("業務代碼", "Business Code", data.businessCode);
  drawField("申報表結算日期", "Return Date", returnDate);
  
  // Section 2: Registered Office
  y -= 10;
  page.drawText("2. 註冊辦事處地址 Registered Office", {
    x: 50,
    y: y,
    size: headingSize,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 25;
  
  const office = data.registeredOffice || {};
  if (office.flat) drawField("室/樓/座", "Flat/Floor/Block", office.flat);
  if (office.building) drawField("大廈", "Building", office.building);
  if (office.street) drawField("街道", "Street", office.street);
  if (office.district) drawField("區", "District", office.district);
  drawField("地區", "Region", office.region || "香港 Hong Kong");
  
  // Page 2 - Directors
  page = pdfDoc.addPage([595, 842]);
  y = height - 50;
  
  page.drawText("3. 董事 Directors", {
    x: 50,
    y: y,
    size: headingSize,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 30;
  
  if (data.directors.length === 0) {
    page.drawText("無董事資料 No directors on record", {
      x: 70,
      y: y,
      size: textSize,
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
      
      const identityText = dir.identity === 'natural' ? '自然人 Natural Person' : '法人團體 Body Corporate';
      
      page.drawText(`董事 ${i + 1}: ${identityText}`, {
        x: 50,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 18;
      
      page.drawText(`中文姓名: ${dir.nameChinese}`, {
        x: 70,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`英文姓名: ${dir.nameEnglish}`, {
        x: 70,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`電郵地址: ${dir.email}`, {
        x: 70,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      if (dir.identity === 'corporate' && dir.brNumber) {
        page.drawText(`商業登記號碼: ${dir.brNumber}`, {
          x: 70,
          y: y,
          size: textSize,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        y -= 15;
      }
      
      y -= 15;
    }
  }
  
  // Secretaries section
  if (y < 200) {
    page = pdfDoc.addPage([595, 842]);
    y = height - 50;
  } else {
    y -= 20;
  }
  
  page.drawText("4. 公司秘書 Company Secretary", {
    x: 50,
    y: y,
    size: headingSize,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 30;
  
  if (data.secretaries.length === 0) {
    page.drawText("無秘書資料 No secretaries on record", {
      x: 70,
      y: y,
      size: textSize,
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
      
      const identityText = sec.identity === 'natural' ? '自然人 Natural Person' : '法人團體 Body Corporate';
      
      page.drawText(`秘書 ${i + 1}: ${identityText}`, {
        x: 50,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 18;
      
      page.drawText(`中文名稱: ${sec.nameChinese}`, {
        x: 70,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`英文名稱: ${sec.nameEnglish}`, {
        x: 70,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`電郵地址: ${sec.email}`, {
        x: 70,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      if (sec.identity === 'corporate' && sec.brNumber) {
        page.drawText(`商業登記號碼: ${sec.brNumber}`, {
          x: 70,
          y: y,
          size: textSize,
          font: chineseFont,
          color: rgb(0, 0, 0),
        });
        y -= 15;
      }
      
      y -= 15;
    }
  }
  
  // Shareholders section
  if (y < 200) {
    page = pdfDoc.addPage([595, 842]);
    y = height - 50;
  } else {
    y -= 20;
  }
  
  page.drawText("5. 股東詳情 Shareholders", {
    x: 50,
    y: y,
    size: headingSize,
    font: chineseFont,
    color: rgb(0, 0, 0.6),
  });
  y -= 30;
  
  if (data.shareholders.length === 0) {
    page.drawText("無股東資料 No shareholders on record", {
      x: 70,
      y: y,
      size: textSize,
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
      
      page.drawText(`股東 ${i + 1}: ${sh.name}`, {
        x: 70,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 15;
      
      page.drawText(`股份數目: ${sh.shares.toLocaleString()}`, {
        x: 70,
        y: y,
        size: textSize,
        font: chineseFont,
        color: rgb(0, 0, 0),
      });
      y -= 25;
    }
  }
  
  // Footer on last page
  y = 50;
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  
  page.drawText(`文件生成日期: ${dateStr}`, {
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
