// POST /api/generate-scr-pdf
// SCR Register PDF — background template + text overlay (Paul Tang format)
// Template has all static elements pre-drawn; this only overlays dynamic text.
// Much simpler and lighter than the old draw-from-scratch approach.
import { PDFDocument, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';

type Env = AuthEnv & {
  DB: D1Database;
  R2: R2Bucket;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PW = 842, PH = 595; // Landscape A4
const M = 28;
const CHINESE_FONT_URL = 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2';

// Column positions (from template generator, same as local server.py)
const COL_X = [28, 107.3, 219.1, 366.4, 506.9, 631.4, 719.8];
const COL_W = [79.3, 111.9, 147.3, 140.5, 124.5, 88.4, 94.2];
const DATA_ROW_H = 20;
const DATA_SIZE = 8;
const CELL_PAD = 3;

// Header value positions (pdf-lib y = PH - fpdf2_y)
const Y_NAME_EN = PH - 22;   // y where company name EN goes
const Y_NAME_CN = PH - 34;   // y where company name CN goes
const Y_BR_EN = PH - 50;     // y where BR EN goes
const Y_BR_CN = PH - 64;     // y where BR CN goes
const Y_TABLE_TOP = PH - 178; // y of first data row top (after table headers)
const ROW_CAPACITY_P1 = 10;   // rows before overlapping Additional Matters on page 1
const ROW_CAPACITY_CONT = 14; // rows per continuation page

// ── Helpers ──
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function rget(row: any, key: string, dflt: any = null): any {
  const v = row ? row[key] : undefined;
  return v !== null && v !== undefined ? v : dflt;
}

function isAsciiChar(ch: string): boolean { return ch.charCodeAt(0) <= 0x7F; }

function hasCjk(text: string): boolean {
  for (const ch of text || "") {
    const c = ch.charCodeAt(0);
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3000 && c <= 0x303F) || (c >= 0xFF00 && c <= 0xFFEF)) return true;
  }
  return false;
}

function segmentText(text: string): { text: string; useCjk: boolean }[] {
  const segments: { text: string; useCjk: boolean }[] = [];
  if (!text) return segments;
  let cur = "", curAscii: boolean | null = null;
  for (const ch of text) {
    const ascii = isAsciiChar(ch);
    if (curAscii === null) curAscii = ascii;
    else if (ascii !== curAscii) {
      segments.push({ text: cur, useCjk: !curAscii });
      cur = ""; curAscii = ascii;
    }
    cur += ch;
  }
  if (cur) segments.push({ text: cur, useCjk: curAscii === null ? false : !curAscii });
  return segments;
}

function widthOfText(text: string, cjk: any, ascii: any, size: number): number {
  let w = 0;
  for (const s of segmentText(text || "")) {
    w += (s.useCjk ? cjk : ascii).widthOfTextAtSize(s.text, size);
  }
  return w;
}

function wrapText(text: string, cjk: any, ascii: any, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = (text || "").split('\n');
  for (const para of paragraphs) {
    if (!para) { lines.push(""); continue; }
    if (widthOfText(para, cjk, ascii, fontSize) <= maxWidth) {
      lines.push(para);
      continue;
    }
    let start = 0;
    while (start < para.length) {
      let lo = start + 1, hi = para.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        if (widthOfText(para.slice(start, mid), cjk, ascii, fontSize) <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      if (lo === start) lo = start + 1;
      lines.push(para.slice(start, lo));
      start = lo;
    }
  }
  if (lines.length === 0) lines.push("");
  return lines;
}

// ══════════════════════════════════════════════════════════════
//  Main handler
// ══════════════════════════════════════════════════════════════
export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const { companyId } = await request.json() as any;
    if (!companyId) {
      return new Response(JSON.stringify({ error: 'companyId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // R2 bucket binding (use same pattern as other endpoints)
    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2 || env.R2;
    if (!r2Bucket) throw new Error("R2 bucket not available");

    // Fetch company, SCR data, template, and font in parallel
    const [company, scrResult, templateObj, fontResp] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY created_at").bind(companyId).all(),
      r2Bucket.get("scr-template-bg.pdf"),
      fetch(CHINESE_FONT_URL, { headers: { Accept: '*/*' } }),
    ]);

    if (!company) throw new Error("Company not found");
    if (!templateObj) throw new Error("SCR template not found in R2");
    if (!fontResp.ok) throw new Error('Failed to load Chinese font');

    const scrs = (scrResult.results || []) as any[];
    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const fontBytes = await fontResp.arrayBuffer();

    // Load PDFs and fonts
    const [templatePdf, outPdf] = await Promise.all([
      PDFDocument.load(templateBytes),
      PDFDocument.create(),
    ]);
    outPdf.registerFontkit(fontkit);

    const [cjkFont, asciiFont] = await Promise.all([
      outPdf.embedFont(fontBytes),
      outPdf.embedFont(StandardFonts.Helvetica),
    ]);

    const templatePages = templatePdf.getPages();
    const tplPage1 = templatePages[0];  // full header + rows + Additional Matters
    const tplPageCont = templatePages.length > 1 ? templatePages[1] : templatePages[0]; // continuation

    // Embed template pages as FormXObjects
    const [tplRef1, tplRefCont] = await Promise.all([
      outPdf.embedPage(tplPage1),
      outPdf.embedPage(tplPageCont),
    ]);

    // ── Company data ──
    const coName = rget(company, 'name') || '';
    const coNameCh = rget(company, 'chinese_name') || '';
    const br = rget(company, 'company_number') || '';

    // ── Build all data rows ──
    interface DataRow { texts: string[]; rowH: number; }
    const allRows: DataRow[] = [];

    for (const s of scrs) {
      const natures: string[] = [];
      if (rget(s, 'nature_shares')) natures.push('>25% shares');
      if (rget(s, 'nature_voting')) natures.push('>25% voting');
      if (rget(s, 'nature_appoint')) natures.push('Appoint/remove directors');
      if (rget(s, 'nature_influence')) natures.push('Sig. influence');
      if (rget(s, 'nature_trust')) natures.push('Trust control');
      if (rget(s, 'nature_other')) natures.push(rget(s, 'nature_other'));

      const isNat = rget(s, 'identity') !== 'corporate';
      const nameEn = rget(s, 'name_english') || '';
      const nameCh = rget(s, 'name_chinese') || '';
      const nameDisplay = nameCh ? `${nameCh}  ${nameEn}`.trim() : (nameEn || '(unnamed)');

      let idBlock: string;
      if (isNat) {
        const idNo = rget(s, 'id_number') || rget(s, 'passport_number') || '-';
        const passportCountry = rget(s, 'passport_country') || '';
        idBlock = `ID/PPT: ${idNo}`;
        if (passportCountry) idBlock += ` (${passportCountry})`;
        idBlock += " | Natural Person";
      } else {
        const compNo = rget(s, 'company_number_ref') || '-';
        const placeIncorp = rget(s, 'place_of_incorporation') || '';
        const legalForm = rget(s, 'legal_form') || '';
        idBlock = `Co No: ${compNo}`;
        if (placeIncorp) idBlock += ` (${placeIncorp})`;
        if (legalForm) idBlock += ` | ${legalForm}`;
        idBlock += " | Body Corporate";
      }

      const addr = (rget(s, 'address') || '').slice(0, 200);
      const natureText = natures.join(', ') || '-';
      const dateBecame = rget(s, 'date_became') || '-';
      const dateCea = rget(s, 'date_ceased') || '';
      const dateDisplay = dateCea ? `${dateBecame}  /  ${dateCea}` : `${dateBecame}  /`;

      let entryDate = rget(s, 'created_at') || '';
      if (entryDate && entryDate.length > 10) entryDate = entryDate.slice(0, 10);

      const remarksParts: string[] = [];
      if (!dateCea) remarksParts.push("Current / 現任");
      if (rget(s, 'is_designated_rep') && rget(s, 'designated_rep_name')) {
        remarksParts.push(`Rep: ${rget(s, 'designated_rep_name')}`);
      }
      const userRemarks = rget(s, 'remarks') || '';
      if (userRemarks) remarksParts.push(userRemarks);
      const remarks = remarksParts.join('\n');

      const rowTexts = [entryDate, nameDisplay, addr, idBlock, natureText, dateDisplay, remarks];

      // Calculate row height
      let rowH = DATA_ROW_H;
      for (let ci = 0; ci < rowTexts.length; ci++) {
        const txt = rowTexts[ci];
        if (!txt) continue;
        const cwAvail = Math.max((COL_W[ci] || 94.2) - CELL_PAD, 20);
        const lines = wrapText(String(txt), cjkFont, asciiFont, DATA_SIZE, cwAvail);
        rowH = Math.max(rowH, lines.length * (DATA_SIZE + 2) + 4);
      }

      allRows.push({ texts: rowTexts, rowH });
    }

    // ── Layout pages ──
    // Page 1: header + up to ROW_CAPACITY_P1 rows + Additional Matters
    // Continuation pages: continuation header + up to ROW_CAPACITY_CONT rows

    const pages: { tplRef: any; rows: DataRow[]; isPage1: boolean }[] = [];
    let rowIdx = 0;

    if (allRows.length === 0) {
      pages.push({ tplRef: tplRef1, rows: [], isPage1: true });
    } else {
      // Page 1
      const p1rows = allRows.slice(0, ROW_CAPACITY_P1);
      pages.push({ tplRef: tplRef1, rows: p1rows, isPage1: true });
      rowIdx = p1rows.length;

      // Continuation pages
      while (rowIdx < allRows.length) {
        const contRows = allRows.slice(rowIdx, rowIdx + ROW_CAPACITY_CONT);
        pages.push({ tplRef: tplRefCont, rows: contRows, isPage1: false });
        rowIdx += contRows.length;
      }
    }

    // ── Render pages ──
    const lastPageIdx = pages.length - 1;

    for (let pi = 0; pi < pages.length; pi++) {
      const { tplRef, rows, isPage1 } = pages[pi];
      const page = outPdf.addPage([PW, PH]);

      // Draw template background
      page.drawPage(tplRef);

      // Draw header values (only on page 1)
      if (isPage1) {
        // Company name EN after "NAME OF COMPANY:  " label
        const labelEnW = asciiFont.widthOfTextAtSize("NAME OF COMPANY:  ", 8);
        page.drawText(coName || coNameCh, { x: M + labelEnW + 2, y: Y_NAME_EN, size: 8, font: asciiFont });

        // Company name CN after "公司名稱:  " label
        const labelCnW = cjkFont.widthOfTextAtSize("公司名稱:  ", 8);
        const cnVal = coNameCh || coName;
        page.drawText(cnVal, { x: M + labelCnW + 2, y: Y_NAME_CN, size: 8, font: cjkFont });
        // Underline under CN name
        const cnValW = hasCjk(cnVal) ? cjkFont.widthOfTextAtSize(cnVal, 8) : asciiFont.widthOfTextAtSize(cnVal, 8);
        const ulStart = M + labelCnW;
        const ulEnd = Math.max(ulStart + cnValW + 2, ulStart + 150);
        page.drawLine({ start: { x: ulStart, y: Y_NAME_CN - 11 }, end: { x: ulEnd, y: Y_NAME_CN - 11 }, thickness: 0.3 });

        // BR EN after "COMPANY NUMBER:  " label
        const labelBrEnW = asciiFont.widthOfTextAtSize("COMPANY NUMBER:  ", 8);
        page.drawText(br || '', { x: M + labelBrEnW + 2, y: Y_BR_EN, size: 8, font: asciiFont });

        // BR CN after "公司編號:  " label
        const labelBrCnW = cjkFont.widthOfTextAtSize("公司編號:  ", 8);
        page.drawText(br || '', { x: M + labelBrCnW + 2, y: Y_BR_CN, size: 8, font: asciiFont });
        // Underline under BR CN
        const brValW = asciiFont.widthOfTextAtSize(br || '', 8);
        const brUlStart = M + labelBrCnW;
        const brUlEnd = Math.max(brUlStart + brValW + 2, brUlStart + 100);
        page.drawLine({ start: { x: brUlStart, y: Y_BR_CN - 11 }, end: { x: brUlEnd, y: Y_BR_CN - 11 }, thickness: 0.3 });
      }

      // ── Draw data rows ──
      let rowY = Y_TABLE_TOP;
      for (const row of rows) {
        const { texts, rowH } = row;
        for (let ci = 0; ci < texts.length && ci < COL_X.length; ci++) {
          const txt = texts[ci];
          if (!txt) continue;
          const cwAvail = Math.max(COL_W[ci] - CELL_PAD * 2, 20);
          const lines = wrapText(String(txt), cjkFont, asciiFont, DATA_SIZE, cwAvail);
          const font = hasCjk(String(txt)) ? cjkFont : asciiFont;

          // Center text vertically in cell
          const textBlockH = lines.length * (DATA_SIZE + 2);
          const textStartY = rowY - (rowH - textBlockH) / 2 - DATA_SIZE;

          for (let li = 0; li < lines.length; li++) {
            const lineY = textStartY - li * (DATA_SIZE + 2);
            // Remarks column (ci=6) centered, others left-aligned
            if (ci === 6) {
              const lw = font.widthOfTextAtSize(lines[li], DATA_SIZE);
              const lx = COL_X[ci] + (COL_W[ci] - lw) / 2;
              page.drawText(lines[li], { x: lx, y: lineY, size: DATA_SIZE, font });
            } else {
              page.drawText(lines[li], { x: COL_X[ci] + CELL_PAD, y: lineY, size: DATA_SIZE, font });
            }
          }
        }
        rowY -= rowH;
      }

      // ── Additional Matters text (only on last page) ──
      if (pi === lastPageIdx && isPage1 && rows.length > 0) {
        // Template page 1 already has AM borders+labels pre-drawn.
        // AM is at bottom of page — no additional text to draw here
        // (AM content area is for manual handwritten notes)
      }
    }

    const bytes = new Uint8Array(await outPdf.save());
    return new Response(JSON.stringify({ pdf: uint8ToBase64(bytes) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('SCR PDF error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
