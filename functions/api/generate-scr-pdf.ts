import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

interface Env {
  DB: D1Database;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHINESE_FONT_URL = 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2';
const BLACK = rgb(0, 0, 0);

// Landscape A4
const PAGE_W = 842;
const PAGE_H = 595;
const M = 28;
const CW = PAGE_W - M * 2; // 786pt

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Mixed-font helpers ──
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
    if (curAscii === null) { curAscii = ascii; }
    else if (ascii !== curAscii) {
      segments.push({ text: cur, useCjk: !curAscii });
      cur = ""; curAscii = ascii;
    }
    cur += ch;
  }
  if (cur) segments.push({ text: cur, useCjk: curAscii === null ? false : !curAscii });
  return segments;
}

function drawMixed(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; bold?: boolean }) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  let x = opts.x;
  const useBold = !!(opts.bold);
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, color: BLACK });
    if (useBold) { page.drawText(s.text, { x: x + 0.5, y: opts.y, size: opts.size, font, color: BLACK }); }
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function drawMixedRight(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; bold?: boolean }) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  const useBold = !!(opts.bold);
  let totalW = 0;
  for (const s of segs) totalW += (s.useCjk ? opts.cjk : opts.ascii).widthOfTextAtSize(s.text, opts.size);
  let x = opts.x - totalW;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, color: BLACK });
    if (useBold) { page.drawText(s.text, { x: x + 0.5, y: opts.y, size: opts.size, font, color: BLACK }); }
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function drawMixedCenter(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; bold?: boolean }) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  const useBold = !!(opts.bold);
  let totalW = 0;
  for (const s of segs) totalW += (s.useCjk ? opts.cjk : opts.ascii).widthOfTextAtSize(s.text, opts.size);
  let x = opts.x - totalW / 2;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, color: BLACK });
    if (useBold) { page.drawText(s.text, { x: x + 0.5, y: opts.y, size: opts.size, font, color: BLACK }); }
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function widthOfText(text: string, cjk: any, ascii: any, size: number): number {
  let w = 0;
  for (const s of segmentText(text || "")) w += (s.useCjk ? cjk : ascii).widthOfTextAtSize(s.text, size);
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

function rget(row: any, key: string, dflt: any = null): any {
  const v = row ? row[key] : undefined;
  return v !== null && v !== undefined ? v : dflt;
}

function hline(page: any, x1: number, x2: number, y: number, thickness: number = 0.3) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color: BLACK, thickness });
}

// ── Main handler ──
export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { companyId } = await request.json() as any;
    if (!companyId) {
      return new Response(JSON.stringify({ error: 'companyId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [company, scrResult, fontResp] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY created_at").bind(companyId).all(),
      fetch(CHINESE_FONT_URL, { headers: { Accept: '*/*' } }),
    ]);

    if (!company) throw new Error("Company not found");
    if (!fontResp.ok) throw new Error('Failed to load Chinese font');
    const scrs = (scrResult.results || []) as any[];

    const fontBytes = await fontResp.arrayBuffer();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const cjkFont = await pdf.embedFont(fontBytes);
    const asciiFont = await pdf.embedFont(StandardFonts.Helvetica);
    const f = { cjk: cjkFont, ascii: asciiFont };

    const coName = rget(company, 'name') || '';
    const coNameCh = rget(company, 'chinese_name') || '';
    const br = rget(company, 'company_number') || '';

    // ═══════════════════════════════ HEADER ═══════════════════════════════
    // 坐标：pdf-lib 原点左下，y 向上。用 top-down 逻辑：yTop = PAGE_H - offset
    let y = PAGE_H - 22;  // 22pt from top = local `y = 22` in fpdf2
    const hdrSize = 8;

    // Title — right side, bold
    drawMixedRight(page, "SIGNIFICANT CONTROLLERS REGISTER", { x: PAGE_W - M, y, size: 13, cjk: f.cjk, ascii: f.ascii, bold: true });
    drawMixedRight(page, "重要控制人登記冊", { x: PAGE_W - M, y: y - 18, size: 11, cjk: f.cjk, ascii: f.ascii, bold: true });

    // Header: NAME OF COMPANY full width, then COMPANY NUMBER || JURISDICTION side by side
    const colA = M;

    // Row 1 (English): NAME OF COMPANY
    drawMixed(page, "NAME OF COMPANY:  ", { x: colA, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii, bold: true });
    const ncLabelW = widthOfText("NAME OF COMPANY:  ", f.cjk, f.ascii, hdrSize);
    drawMixed(page, coName, { x: colA + ncLabelW, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    const nameValW = widthOfText(coName, f.cjk, f.ascii, hdrSize);
    hline(page, colA + ncLabelW, colA + ncLabelW + Math.max(nameValW, 150), y - 2, 0.5);

    y -= 14;  // local: y += 14

    // Row 2 (Chinese): 公司名稱
    drawMixed(page, "公司名稱:  ", { x: colA, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    const cnLabelW = widthOfText("公司名稱:  ", f.cjk, f.ascii, hdrSize);
    drawMixed(page, coNameCh || coName, { x: colA + cnLabelW, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    const cnValW = widthOfText(coNameCh || coName, f.cjk, f.ascii, hdrSize);
    hline(page, colA + cnLabelW, colA + cnLabelW + Math.max(cnValW, 150), y - 2, 0.5);

    y -= 16;  // local: y += 16

    // Row 3 (English): COMPANY NUMBER _______  JURISDICTION: HONG KONG
    drawMixed(page, "COMPANY NUMBER:  ", { x: colA, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii, bold: true });
    const numLabelW = widthOfText("COMPANY NUMBER:  ", f.cjk, f.ascii, hdrSize);
    drawMixed(page, br, { x: colA + numLabelW, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    const brValW = widthOfText(br, f.cjk, f.ascii, hdrSize);
    const brUnderlineEnd = colA + numLabelW + Math.max(brValW, 100);
    hline(page, colA + numLabelW, brUnderlineEnd, y - 2, 0.5);

    // JURISDICTION right after COMPANY NUMBER underline
    const jurX = brUnderlineEnd + 24;
    drawMixed(page, "JURISDICTION:  ", { x: jurX, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii, bold: true });
    const jlw = widthOfText("JURISDICTION:  ", f.cjk, f.ascii, hdrSize);
    drawMixed(page, "HONG KONG", { x: jurX + jlw, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    const jurValW = widthOfText("HONG KONG", f.cjk, f.ascii, hdrSize);
    hline(page, jurX + jlw, jurX + jlw + Math.max(jurValW, 80), y - 2, 0.5);

    y -= 14;  // local: y += 14

    // Row 4 (Chinese): 公司編號 _______  司法管轄區: HONG KONG
    drawMixed(page, "公司編號:  ", { x: colA, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    const num2LabelW = widthOfText("公司編號:  ", f.cjk, f.ascii, hdrSize);
    drawMixed(page, br, { x: colA + num2LabelW, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    const br2ValW = widthOfText(br, f.cjk, f.ascii, hdrSize);
    const br2UnderlineEnd = colA + num2LabelW + Math.max(br2ValW, 100);
    hline(page, colA + num2LabelW, br2UnderlineEnd, y - 2, 0.5);

    drawMixed(page, "司法管轄區:  HONG KONG", { x: jurX, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    hline(page, jurX, jurX + 120, y - 2, 0.5);

    y -= 16;  // local: y += 16

    // Separator
    hline(page, M, PAGE_W - M, y, 0.5);
    y -= 12;  // local: y += 12

    // ═══════════════════════════════ DATA TABLE ═══════════════════════════════
    // Column widths — EXACT match with local Flask
    const colRatios = [1526, 2154, 2835, 2551, 2551, 1701, 1814];
    const totalDxa = colRatios.reduce((a, b) => a + b, 0);
    const col_w = colRatios.map(r => r * CW / totalDxa);
    col_w[3] += 8;  // widen ID column
    col_w[4] -= 8;  // narrow Nature column

    const col_x: number[] = [M];
    for (let i = 0; i < col_w.length - 1; i++) col_x.push(col_x[i] + col_w[i]);
    const endX = PAGE_W - M;

    function drawCellBorder(x0: number, y0: number, w: number, h: number) {
      page.drawRectangle({ x: x0, y: y0 - h, width: w, height: h, borderColor: BLACK, borderWidth: 0.3 });
    }

    // ── Table headers (matching local: hdr_line_h=10, font size 7 bold, hdr_h = max_lines*10+6) ──
    const hdrLabels: [string, number][] = [
      ["Entry Date", 0],
      ["Name", 1],
      ["Correspondence Address\n (for Registrable Person)\n通訊地址（自然人）\nRegistered Office Address (for Legal Entity)\n註冊／主要營業地址\n（法律實體）", 2],
      ["ID / PPT No. (Issuing Country)\n(for Registrable Person)\n身份證／護照號碼\n（簽發國家）（自然人）\nCompany No. (Place of Incorp.)\nLegal Form (for Legal Entity)\n公司編號（成立地方）\n法律形式（法律實體）", 3],
      ["Nature of Control\n控制性質", 4],
      ["Becoming Date\n(Cessation Date)\n起始日期\n（終止日期）", 5],
      ["Remarks\n備註", 6],
    ];

    const hdrLineH = 10;      // matches local hdr_line_h = 10
    const maxHdrLines = Math.max(...hdrLabels.map(([l]) => l.split('\n').length));
    const hdrH = maxHdrLines * hdrLineH + 6;  // matches local hdr_h = max*10 + 6

    function drawTableHeaders(atY: number) {
      for (const [label, ci] of hdrLabels) {
        const x0 = col_x[ci];
        const cwVal = ci < col_w.length ? col_w[ci] : (endX - col_x[ci]);
        drawCellBorder(x0, atY, cwVal, hdrH);
        const lines = label.split('\n');
        const textBlockH = lines.length * hdrLineH;
        // local: text_start_y = y + (hdr_h - text_block_h) / 2
        // pdf-lib: text baseline = atY - (hdrH - textBlockH) / 2
        const textStartY = atY - (hdrH - textBlockH) / 2;
        for (let li = 0; li < lines.length; li++) {
          const lineText = lines[li];
          if (!lineText) continue;
          const lw = widthOfText(lineText, f.cjk, f.ascii, 7);
          const lx = x0 + (cwVal - lw) / 2;
          // local: text at text_start_y + li*hdr_line_h, with bold font
          // pdf-lib: text baseline = textStartY - li * hdrLineH
          drawMixed(page, lineText, { x: lx, y: textStartY - li * hdrLineH, size: 7, cjk: f.cjk, ascii: f.ascii, bold: true });
        }
      }
    }

    drawTableHeaders(y);
    y -= hdrH;  // local: y += hdr_h

    // ── Data Rows ──
    const dataSize = 8;       // matches local data_size = 8
    const minRowH = 20;       // matches local min_row_h = 20

    if (scrs.length === 0) {
      const emptyH = minRowH;
      for (let ci = 0; ci < col_x.length; ci++) {
        const cwVal = ci < col_w.length ? col_w[ci] : (endX - col_x[ci]);
        drawCellBorder(col_x[ci], y, cwVal, emptyH);
      }
      drawMixed(page, "(No SCR records / 尚無重要控制人記錄)", { x: M + 4, y: y - 4 - 8, size: 8, cjk: f.cjk, ascii: f.ascii });
      y -= emptyH;
    } else {
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
        let dateDisplay = dateCea ? `${dateBecame}  /  ${dateCea}` : `${dateBecame}  /`;

        let entryDate = rget(s, 'created_at') || '';
        if (entryDate && entryDate.length > 10) entryDate = entryDate.slice(0, 10);

        // Remarks: "Current / 現任" goes here per Paul Tang format, + designated rep + user remarks
        const remarksParts: string[] = [];
        if (!dateCea) remarksParts.push("Current / 現任");
        if (rget(s, 'is_designated_rep') && rget(s, 'designated_rep_name')) {
          remarksParts.push(`Rep: ${rget(s, 'designated_rep_name')}`);
        }
        const userRemarks = rget(s, 'remarks') || '';
        if (userRemarks) remarksParts.push(userRemarks);
        const remarks = remarksParts.join('\n');
        const rowData = [entryDate, nameDisplay, addr, idBlock, natureText, dateDisplay, remarks];

        // Calculate row height (matching local logic)
        let rowH = minRowH;
        for (let ci = 0; ci < rowData.length; ci++) {
          const txt = rowData[ci];
          if (!txt) continue;
          const cellPad = 4;
          const cwAvail = Math.max((ci < col_w.length ? col_w[ci] : (endX - col_x[ci])) - cellPad, 20);
          const lines = wrapText(String(txt), f.cjk, f.ascii, dataSize, cwAvail);
          rowH = Math.max(rowH, lines.length * (dataSize + 4) + 4);
        }

        // Page break — local: if y + row_h > PH - 70
        if (y - rowH < 70) {
          hline(page, M, endX, y, 0.5);
          const pg2 = pdf.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - 22;  // local: y = 22
          // Continuation header
          drawMixedCenter(page, "SIGNIFICANT CONTROLLERS REGISTER (Cont'd)", { x: PAGE_W / 2, y, size: 13, cjk: f.cjk, ascii: f.ascii, bold: true });
          y -= 16;  // local: y += 16
          drawMixedCenter(page, "重要控制人登記冊（續）", { x: PAGE_W / 2, y, size: 11, cjk: f.cjk, ascii: f.ascii, bold: true });
          y -= 14;  // local: y += 14
          hline(page, M, PAGE_W - M, y, 0.5);
          y -= 8;   // local: y += 8
          drawTableHeaders(y);
          y -= hdrH;
          // Switch drawing to new page
          page = pg2;
        }

        // Draw row cells
        for (let ci = 0; ci < rowData.length; ci++) {
          const x0 = col_x[ci];
          const cwVal = ci < col_w.length ? col_w[ci] : (endX - col_x[ci]);
          drawCellBorder(x0, y, cwVal, rowH);

          const txt = rowData[ci];
          if (txt) {
            const cellPad = 3;
            const cwAvail = Math.max(cwVal - cellPad * 2, 20);
            const lines = wrapText(String(txt), f.cjk, f.ascii, dataSize, cwAvail);
            const isRemarksCol = (ci === 6);  // Remarks column — center per Paul Tang format
            for (let li = 0; li < lines.length; li++) {
              const lineText = lines[li];
              if (!lineText) continue;
              const lineY = y - 2 - li * (dataSize + 4) - dataSize;
              const font = hasCjk(lineText) ? f.cjk : f.ascii;
              if (isRemarksCol) {
                const lw = font.widthOfTextAtSize(lineText, dataSize);
                const lx = x0 + (cwVal - lw) / 2;
                page.drawText(lineText, { x: lx, y: lineY, size: dataSize, font, color: BLACK });
              } else {
                page.drawText(lineText, { x: x0 + cellPad, y: lineY, size: dataSize, font, color: BLACK });
              }
            }
          }
        }
        y -= rowH;
      }
    }

    // Table bottom border
    hline(page, M, endX, y, 0.5);
    y -= 14;  // local: y += 14

    // ═══════════════════════════════ ADDITIONAL MATTERS ═══════════════════════════════
    const addHdrH = 26;
    const addContentH = 48;
    const addW = CW * 0.5;

    // Row 0: Headers — vertically centered with more bottom padding, Remarks centered
    drawCellBorder(M, y, addW, addHdrH);
    drawCellBorder(M + addW, y, addW, addHdrH);
    drawMixed(page, "Additional Matterse", { x: M + 3, y: y - 4, size: 7, cjk: f.cjk, ascii: f.ascii, bold: true });
    drawMixed(page, "额外事項", { x: M + 3, y: y - 14, size: 7, cjk: f.cjk, ascii: f.ascii });
    // Remarks — centered horizontally
    const rmkW = f.ascii.widthOfTextAtSize("Remarks", 7);
    drawMixed(page, "Remarks", { x: M + addW + (addW - rmkW) / 2, y: y - 4, size: 7, cjk: f.cjk, ascii: f.ascii, bold: true });
    const rmkChW = f.cjk.widthOfTextAtSize("備註", 7);
    drawMixed(page, "備註", { x: M + addW + (addW - rmkChW) / 2, y: y - 14, size: 7, cjk: f.cjk, ascii: f.ascii });
    y -= addHdrH;

    // Row 1: Empty content cells
    drawCellBorder(M, y, addW, addContentH);
    drawCellBorder(M + addW, y, addW, addContentH);
    // y not decremented further

    const bytes = new Uint8Array(await pdf.save());
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
