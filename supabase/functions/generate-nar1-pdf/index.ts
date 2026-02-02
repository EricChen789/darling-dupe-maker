import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

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

async function createPDF(data: CompanyData): Promise<Uint8Array> {
  console.log("Creating PDF document without embedded fonts...");
  
  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  
  // Use Helvetica as fallback - Chinese will display if viewer has CJK fonts
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const returnDate = data.returnDate || new Date().toISOString().split('T')[0];
  
  // Page 1 - Company Basic Info
  let page = pdfDoc.addPage([595, 842]); // A4 size
  const { height } = page.getSize();
  let y = height - 50;
  
  const titleSize = 16;
  const headingSize = 12;
  const labelSize = 9;
  const textSize = 10;
  
  // Helper to draw text - pdf-lib will use system fonts for CJK characters
  const drawText = (text: string, x: number, yPos: number, size: number, font = helveticaFont, color = rgb(0, 0, 0)) => {
    try {
      page.drawText(text, { x, y: yPos, size, font, color });
    } catch {
      // If font can't render, draw placeholder
      page.drawText(text.replace(/[^\x00-\x7F]/g, '?'), { x, y: yPos, size, font, color });
    }
  };
  
  // Title
  drawText("NAR1 Annual Return", 50, y, titleSize, helveticaBold);
  y -= 20;
  drawText("周年申報表", 50, y, titleSize - 2, helveticaFont);
  y -= 20;
  
  drawText("Companies Registry, Hong Kong", 50, y, labelSize, helveticaFont, rgb(0.4, 0.4, 0.4));
  y -= 35;
  
  // Helper function to draw labeled field
  const drawField = (englishLabel: string, chineseLabel: string, value: string) => {
    // English label
    drawText(englishLabel, 50, y, labelSize, helveticaFont, rgb(0.3, 0.3, 0.3));
    // Chinese label
    drawText(chineseLabel, 50, y - 11, labelSize - 1, helveticaFont, rgb(0.5, 0.5, 0.5));
    // Value - note Chinese may show as boxes without CJK fonts
    drawText(value || "-", 200, y - 6, textSize, helveticaFont);
    y -= 28;
  };
  
  // Section 1: Company Info
  drawText("1. Company Information", 50, y, headingSize, helveticaBold, rgb(0, 0, 0.6));
  y -= 25;
  
  drawField("Business Registration Number", "商業登記號碼", data.brNumber);
  drawField("Company Name", "公司名稱", data.name);
  drawField("Business Name", "商業名稱", data.tradingName);
  drawField("Type of Company", "公司類別", data.companyType);
  drawField("Business Nature", "業務性質", data.businessNature);
  drawField("Business Code", "業務代碼", data.businessCode);
  drawField("Return Date", "申報表結算日期", returnDate);
  
  // Section 2: Registered Office
  y -= 10;
  drawText("2. Registered Office", 50, y, headingSize, helveticaBold, rgb(0, 0, 0.6));
  y -= 25;
  
  const office = data.registeredOffice || {};
  if (office.flat) drawField("Flat/Floor/Block", "室/樓/座", office.flat);
  if (office.building) drawField("Building", "大廈", office.building);
  if (office.street) drawField("Street", "街道", office.street);
  if (office.district) drawField("District", "區", office.district);
  drawField("Region", "地區", office.region || "Hong Kong");
  
  // Page 2 - Directors
  page = pdfDoc.addPage([595, 842]);
  y = height - 50;
  
  drawText("3. Directors", 50, y, headingSize, helveticaBold, rgb(0, 0, 0.6));
  y -= 30;
  
  if (data.directors.length === 0) {
    drawText("No directors on record", 70, y, textSize, helveticaFont, rgb(0.5, 0.5, 0.5));
    y -= 25;
  } else {
    for (let i = 0; i < data.directors.length; i++) {
      const dir = data.directors[i];
      
      // Check if we need a new page
      if (y < 150) {
        page = pdfDoc.addPage([595, 842]);
        y = height - 50;
      }
      
      const identityText = dir.identity === 'natural' ? 'Natural Person' : 'Body Corporate';
      
      drawText(`Director ${i + 1}: ${identityText}`, 50, y, textSize, helveticaBold, rgb(0.2, 0.2, 0.2));
      y -= 18;
      
      drawText(`Chinese Name: ${dir.nameChinese}`, 70, y, textSize, helveticaFont);
      y -= 15;
      
      drawText(`English Name: ${dir.nameEnglish}`, 70, y, textSize, helveticaFont);
      y -= 15;
      
      drawText(`Email: ${dir.email}`, 70, y, textSize, helveticaFont);
      y -= 15;
      
      if (dir.identity === 'corporate' && dir.brNumber) {
        drawText(`BR Number: ${dir.brNumber}`, 70, y, textSize, helveticaFont);
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
  
  drawText("4. Company Secretary", 50, y, headingSize, helveticaBold, rgb(0, 0, 0.6));
  y -= 30;
  
  if (data.secretaries.length === 0) {
    drawText("No secretaries on record", 70, y, textSize, helveticaFont, rgb(0.5, 0.5, 0.5));
    y -= 25;
  } else {
    for (let i = 0; i < data.secretaries.length; i++) {
      const sec = data.secretaries[i];
      
      if (y < 150) {
        page = pdfDoc.addPage([595, 842]);
        y = height - 50;
      }
      
      const identityText = sec.identity === 'natural' ? 'Natural Person' : 'Body Corporate';
      
      drawText(`Secretary ${i + 1}: ${identityText}`, 50, y, textSize, helveticaBold, rgb(0.2, 0.2, 0.2));
      y -= 18;
      
      drawText(`Chinese Name: ${sec.nameChinese}`, 70, y, textSize, helveticaFont);
      y -= 15;
      
      drawText(`English Name: ${sec.nameEnglish}`, 70, y, textSize, helveticaFont);
      y -= 15;
      
      drawText(`Email: ${sec.email}`, 70, y, textSize, helveticaFont);
      y -= 15;
      
      if (sec.identity === 'corporate' && sec.brNumber) {
        drawText(`BR Number: ${sec.brNumber}`, 70, y, textSize, helveticaFont);
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
  
  drawText("5. Shareholders", 50, y, headingSize, helveticaBold, rgb(0, 0, 0.6));
  y -= 30;
  
  if (data.shareholders.length === 0) {
    drawText("No shareholders on record", 70, y, textSize, helveticaFont, rgb(0.5, 0.5, 0.5));
  } else {
    for (let i = 0; i < data.shareholders.length; i++) {
      const sh = data.shareholders[i];
      
      if (y < 100) {
        page = pdfDoc.addPage([595, 842]);
        y = height - 50;
      }
      
      drawText(`Shareholder ${i + 1}: ${sh.name}`, 70, y, textSize, helveticaFont);
      y -= 15;
      
      drawText(`Shares: ${sh.shares.toLocaleString()}`, 70, y, textSize, helveticaFont);
      y -= 25;
    }
  }
  
  // Footer on last page
  y = 50;
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  
  drawText(`Generated: ${dateStr}`, 50, y, 8, helveticaFont, rgb(0.5, 0.5, 0.5));
  drawText("Note: Chinese characters require a CJK-compatible PDF viewer", 50, y - 12, 7, helveticaFont, rgb(0.6, 0.6, 0.6));
  
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
    
    // Create PDF without embedded Chinese font
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
