import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  corsHeaders, jsonResp, uint8ToBase64,
  drawMixed, fetchAndEmbedFont,
} from './_pdf-utils';

// IRC3111A — Notification of Change of Business Address (税務局更改業務地址通知)
// Drawn from scratch with pdf-lib (no AcroForm template).
// Uses fetchAndEmbedFont for R2-first CJK font loading (same as other PDF endpoints).

const PW = 595, PH = 842; // A4 portrait
const M = 50;
const labelX = M;
const valueX = M + 170;
const BLACK = rgb(0, 0, 0);

export interface IRC3111AData {
  companyName?: string;
  brNumber?: string;
  oldAddress?: string;
  newAddress?: string;
  changeDate?: string;
  signerName?: string;
  signDate?: string;
}

export async function generateIRC3111APdf(data: IRC3111AData, r2Bucket: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PW, PH]); // A4 portrait

  // Use shared R2-first font loading (handles fontkit registration + fallback)
  const { cjk: cjkFont, ascii: asciiFont, cjkMissing } = await fetchAndEmbedFont(pdfDoc, { R2: r2Bucket });
  const f = { cjk: cjkFont, ascii: asciiFont };

  // Bold simulated via drawMixed bold option
  const boldDrawOpts = { cjk: f.cjk, ascii: f.ascii, bold: true, color: BLACK } as const;

  function drawValue(value: string, y: number, fontSize = 11): number {
    const display = value || "";
    drawMixed(page, display, { x: valueX, y, size: fontSize, cjk: f.cjk, ascii: f.ascii, color: BLACK });
    // Underline
    const tw = display ? asciiFont.widthOfTextAtSize(display, fontSize) + 4 : PW - valueX - M - 10;
    page.drawLine({
      start: { x: valueX, y: y - 3 },
      end: { x: Math.min(valueX + tw, PW - M), y: y - 3 },
      color: BLACK, thickness: 0.5,
    });
    return y;
  }

  let y = 792; // start from near top

  // ── Header ──
  page.drawText("Inland Revenue Department", { x: PW / 2 - 75, y, size: 9, font: asciiFont, color: BLACK });
  if (!cjkMissing) {
    page.drawText("税 務 局", { x: PW / 2 - 25, y: y - 12, size: 9, font: cjkFont, color: BLACK });
  }
  y -= 35;

  drawMixed(page, "IR 3111A", { x: PW / 2 - 30, y, size: 16, ...boldDrawOpts });
  y -= 22;
  drawMixed(page, "Notification of Change of Business Address", { x: PW / 2 - 115, y, size: 12, ...boldDrawOpts });
  if (!cjkMissing) {
    page.drawText("通知更改業務地址", { x: PW / 2 - 60, y: y - 16, size: 10, font: cjkFont, color: BLACK });
  }
  y -= 48;

  // Separator
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, color: BLACK, thickness: 1.2 });
  y -= 22;

  const cn = data.companyName || "";
  const br = data.brNumber || "";
  const oldAddr = data.oldAddress || "";
  const newAddr = data.newAddress || "";
  const effDate = data.changeDate || "";
  const signer = data.signerName || "";
  const signDate = data.signDate || "";

  function drawLabel(cnLabel: string, enLabel: string, yPos: number, fontSize = 11): void {
    if (!cjkMissing) {
      page.drawText(cnLabel, { x: labelX, y: yPos, size: fontSize, font: cjkFont, color: BLACK });
    }
    page.drawText(enLabel, { x: labelX, y: yPos - fontSize - 3, size: fontSize - 2, font: asciiFont, color: BLACK });
  }

  drawLabel("商業登記號碼", "Business Registration No.", y); drawValue(br, y - 14); y -= 50;
  drawLabel("商業名稱", "Name of Business", y); drawValue(cn, y - 14); y -= 58;
  drawLabel("舊業務地址", "Old Business Address", y); drawValue(oldAddr, y - 14); y -= 58;
  drawLabel("新業務地址", "New Business Address", y); drawValue(newAddr, y - 14); y -= 58;
  drawLabel("更改生效日期", "Effective Date of Change", y); drawValue(effDate, y - 14); y -= 58;

  // Declaration
  drawMixed(page, "Declaration / 聲明", { x: labelX, y, size: 11, ...boldDrawOpts });
  y -= 22;
  drawMixed(page,
    "I hereby declare that the above particulars are true and correct. 本人謹此聲明，以上填報的詳情均屬真實和正確。",
    { x: labelX + 5, y, size: 9, cjk: f.cjk, ascii: f.ascii, color: BLACK }
  );
  y -= 28;

  drawLabel("簽署人姓名", "Name of Signatory", y); drawValue(signer, y - 14); y -= 50;
  drawLabel("日期", "Date", y); drawValue(signDate, y - 14); y -= 50;

  // Footer
  drawMixed(page, "Notes / 註：", { x: labelX, y, size: 8, ...boldDrawOpts });
  y -= 14;
  drawMixed(page, "1. Submit within 1 month of change. 須於更改後1個月內提交。",
    { x: labelX + 5, y, size: 7.5, cjk: f.cjk, ascii: f.ascii, color: BLACK }
  );

  return pdfDoc.save();
}

// HTTP handler
export async function onRequest(context: { request: Request; env: AuthEnv }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const data: IRC3111AData = await request.json();
    const pdfBytes = await generateIRC3111APdf(data, r2Bucket);
    const b64 = uint8ToBase64(new Uint8Array(pdfBytes));
    return jsonResp({ pdf: b64 });
  } catch (e: any) {
    return jsonResp({ error: e.message || String(e) }, 500);
  }
}
