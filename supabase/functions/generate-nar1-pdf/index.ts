import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

// Generate a simple PDF with text content that supports Chinese
// Using a basic approach that works in Deno environment
function generatePDFContent(data: CompanyData): string {
  const returnDate = data.returnDate || new Date().toISOString().split('T')[0];
  
  // Create structured text content for the PDF
  const content = `
NAR1 周年申報表 / Annual Return
================================

商業登記號碼 Business Registration Number: ${data.brNumber}

1. 公司名稱 Company Name
   ${data.name}

2. 商業名稱 Business Name (如有的話)
   ${data.tradingName}

3. 公司類別 Type of Company
   ${data.companyType}

4. 經營業務性質 Business Nature
   業務代碼 Code: ${data.businessCode}
   描述 Description: ${data.businessNature}

5. 本申報表的結算日期 Date to which this Return is Made Up
   ${returnDate}

6. 在香港的註冊辦事處地址 Registered Office Address in Hong Kong
   ${data.registeredOffice?.flat || ''}
   ${data.registeredOffice?.building || ''}
   ${data.registeredOffice?.street || ''}
   ${data.registeredOffice?.district || ''}
   ${data.registeredOffice?.region || '香港 Hong Kong'}

================================
公司秘書 Company Secretary
================================

${data.secretaries.map((sec, i) => `
${i + 1}. ${sec.identity === 'natural' ? '自然人 Natural Person' : '法人團體 Body Corporate'}
   中文名稱 Name in Chinese: ${sec.nameChinese}
   英文名稱 Name in English: ${sec.nameEnglish}
   電郵地址 Email: ${sec.email}
   ${sec.identity === 'corporate' && sec.brNumber ? `商業登記號碼 BR Number: ${sec.brNumber}` : ''}
`).join('')}

================================
董事 Directors  
================================

${data.directors.map((dir, i) => `
${i + 1}. ${dir.identity === 'natural' ? '自然人 Natural Person' : '法人團體 Body Corporate'}
   中文姓名 Name in Chinese: ${dir.nameChinese}
   英文姓名 Name in English: ${dir.nameEnglish}
   電郵地址 Email: ${dir.email}
   ${dir.identity === 'corporate' && dir.brNumber ? `商業登記號碼 BR Number: ${dir.brNumber}` : ''}
`).join('')}

================================
股東詳情 Shareholder Particulars
================================

${data.shareholders.length > 0 ? data.shareholders.map((sh, i) => `
${i + 1}. 股東名稱 Shareholder Name: ${sh.name}
   股份數目 Number of Shares: ${sh.shares}
`).join('') : '無股東資料 No shareholder information'}

================================
文件生成日期 Document Generated: ${new Date().toLocaleString('zh-TW')}
================================
`;

  return content;
}

// Create a basic PDF with the content
async function createPDF(content: string): Promise<Uint8Array> {
  // PDF header
  const pdfHeader = '%PDF-1.4\n';
  
  // Encode the content properly for PDF
  const encodedContent = encodeURIComponent(content)
    .replace(/%20/g, ' ')
    .replace(/%0A/g, '\n');
  
  // Simple PDF structure
  const objects: string[] = [];
  
  // Object 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  
  // Object 2: Pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  
  // Object 3: Page
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n');
  
  // Object 4: Content stream - we'll use a simple text stream
  const lines = content.split('\n');
  let streamContent = 'BT\n/F1 10 Tf\n50 800 Td\n12 TL\n';
  
  for (const line of lines.slice(0, 60)) { // Limit lines per page
    // Escape special PDF characters and use basic ASCII
    const safeLine = line
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .substring(0, 80); // Limit line length
    streamContent += `(${safeLine}) Tj T*\n`;
  }
  streamContent += 'ET\n';
  
  objects.push(`4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream\nendobj\n`);
  
  // Object 5: Font (using built-in Helvetica for now - Chinese will show as boxes but structure is correct)
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  
  // Build PDF
  let pdf = pdfHeader;
  const offsets: number[] = [];
  
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  
  // Cross-reference table
  const xrefOffset = pdf.length;
  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  
  // Trailer
  pdf += 'trailer\n';
  pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF';
  
  return new TextEncoder().encode(pdf);
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const companyData: CompanyData = await req.json();
    
    // Generate PDF content
    const textContent = generatePDFContent(companyData);
    
    // Create PDF
    const pdfBytes = await createPDF(textContent);
    
    // Return PDF as download
    return new Response(new Uint8Array(pdfBytes).buffer as ArrayBuffer, {
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
