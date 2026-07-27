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
const CHINESE_FONT_BOLD_URL = 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-700-normal.woff2';

// Landscape A4 — Paul Tang reference format
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

function drawMixed(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; cjkBold?: any; asciiBold?: any; bold?: boolean; color?: any }) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  let x = opts.x;
  const useBold = !!(opts.bold);
  for (const s of segs) {
    let font;
    if (s.useCjk) font = useBold && opts.cjkBold ? opts.cjkBold : opts.cjk;
    else font = useBold && opts.asciiBold ? opts.asciiBold : opts.ascii;
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function drawMixedRight(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; cjkBold?: any; asciiBold?: any; bold?: boolean; color?: any }) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  const useBold = !!(opts.bold);
  let totalW = 0;
  for (const s of segs) {
    const font = s.useCjk ? (useBold && opts.cjkBold ? opts.cjkBold : opts.cjk) : (useBold && opts.asciiBold ? opts.asciiBold : opts.ascii);
    totalW += font.widthOfTextAtSize(s.text, opts.size);
  }
  let x = opts.x - totalW;
  for (const s of segs) {
    const font = s.useCjk ? (useBold && opts.cjkBold ? opts.cjkBold : opts.cjk) : (useBold && opts.asciiBold ? opts.asciiBold : opts.ascii);
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function drawMixedCenter(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; cjkBold?: any; asciiBold?: any; bold?: boolean; color?: any }) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  const useBold = !!(opts.bold);
  let totalW = 0;
  for (const s of segs) {
    const font = s.useCjk ? (useBold && opts.cjkBold ? opts.cjkBold : opts.cjk) : (useBold && opts.asciiBold ? opts.asciiBold : opts.ascii);
    totalW += font.widthOfTextAtSize(s.text, opts.size);
  }
  let x = opts.x - totalW / 2;
  for (const s of segs) {
    const font = s.useCjk ? (useBold && opts.cjkBold ? opts.cjkBold : opts.cjk) : (useBold && opts.asciiBold ? opts.asciiBold : opts.ascii);
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function widthOfText(text: string, cjk: any, ascii: any, size: number, cjkBold?: any, asciiBold?: any, bold?: boolean): number {
  let w = 0;
  const useBold = !!(bold);
  for (const s of segmentText(text || "")) {
    const font = s.useCjk
      ? (useBold && cjkBold ? cjkBold : cjk)
      : (useBold && asciiBold ? asciiBold : ascii);
    w += font.widthOfTextAtSize(s.text, size);
  }
  return w;
}

function wrapText(text: string, cjk: any, ascii: any, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = (text || "").split('\n');
  for (const para of paragraphs) {
    if (!para) { lines.push(""); continue; }
    let current = "";
    for (const ch of para) {
      const test = current + ch;
      if (widthOfText(test, cjk, ascii, fontSize) > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
      } else { current = test; }
    }
    if (current) lines.push(current);
  }
  if (lines.length === 0) lines.push("");
  return lines;
}

function rget(row: any, key: string, dflt: any = null): any {
  const v = row ? row[key] : undefined;
  return v !== null && v !== undefined ? v : dflt;
}

function hline(page: any, x1: number, x2: number, y: number, thickness: number = 0.3, color: any = rgb(0, 0, 0)) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color, thickness });
}

function vline(page: any, x: number, y1: number, y2: number, thickness: number = 0.2, color: any = rgb(0, 0, 0)) {
  page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, color, thickness });
}

function drawRect(page: any, x: number, y: number, w: number, h: number, thickness: number = 0.3) {
  page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: thickness });
}

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

    const [company, scrResult, fontResp, fontBoldResp] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY created_at").bind(companyId).all(),
      fetch(CHINESE_FONT_URL, { headers: { Accept: '*/*' } }),
      fetch(CHINESE_FONT_BOLD_URL, { headers: { Accept: '*/*' } }),
    ]);

    if (!company) throw new Error("Company not found");
    if (!fontResp.ok) throw new Error('Failed to load Chinese font');
    const scrs = (scrResult.results || []) as any[];

    const [fontBytes, fontBoldBytes] = await Promise.all([
      fontResp.arrayBuffer(),
      fontBoldResp.ok ? fontBoldResp.arrayBuffer() : null,
    ]);
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const cjkFont = await pdf.embedFont(fontBytes);
    const asciiFont = await pdf.embedFont(StandardFonts.Helvetica);
    const asciiBoldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    // Bold CJK: use dedicated bold font if available, otherwise fallback to regular
    const cjkBoldFont = fontBoldBytes ? await pdf.embedFont(fontBoldBytes) : cjkFont;
    const f = { cjk: cjkFont, ascii: asciiFont, cjkBold: cjkBoldFont, asciiBold: asciiBoldFont };

    const coName = rget(company, 'name') || '';
    const coNameCh = rget(company, 'chinese_name') || '';
    const br = rget(company, 'company_number') || '';

    let page = pdf.addPage([PAGE_W, PAGE_H]);
    const hdrSize = 8;
    let y = PAGE_H - 22; // 573 — top of page

    // ═══════════════════════════════════════════════
    // HEADER: NAME OF COMPANY || COMPANY NUMBER side by side + title right
    // ═══════════════════════════════════════════════

    // Title — right side (bold matching local)
    drawMixedRight(page, "SIGNIFICANT CONTROLLERS REGISTER", { x: PAGE_W - M, y, size: 13, cjk: f.cjk, ascii: f.ascii, cjkBold: f.cjkBold, asciiBold: f.asciiBold, bold: true });
    drawMixedRight(page, "重要控制人登記冊", { x: PAGE_W - M, y: y - 18, size: 11, cjk: f.cjk, ascii: f.ascii, cjkBold: f.cjkBold, asciiBold: f.asciiBold, bold: true });

    // Company info — left side: NAME || NUMBER side by side
    const colA = M;
    const colB = M + 380;

    // Row 1 (English) — labels bold, values regular (matching local)
    drawMixed(page, "NAME OF COMPANY:  ", { x: colA, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii, cjkBold: f.cjkBold, asciiBold: f.asciiBold, bold: true });
    const ncLabelW = widthOfText("NAME OF COMPANY:  ", f.cjk, f.ascii, hdrSize, f.cjkBold, f.asciiBold, true);
    drawMixed(page, coName, { x: colA + ncLabelW, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });

    drawMixed(page, "COMPANY NUMBER:  ", { x: colB, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii, cjkBold: f.cjkBold, asciiBold: f.asciiBold, bold: true });
    const numLabelW = widthOfText("COMPANY NUMBER:  ", f.cjk, f.ascii, hdrSize, f.cjkBold, f.asciiBold, true);
    drawMixed(page, br, { x: colB + numLabelW, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });

    // Underlines below English row — match local spacing (11pt below text top)
    const nameValW = widthOfText(coName, f.cjk, f.ascii, hdrSize);
    hline(page, colA + ncLabelW, colA + ncLabelW + Math.max(nameValW, 150), y - 2, 0.5);
    const brValW = widthOfText(br, f.cjk, f.ascii, hdrSize);
    hline(page, colB + numLabelW, colB + numLabelW + Math.max(brValW, 100), y - 2, 0.5);

    y -= 14;

    // Row 2 (Chinese) — labels regular, values regular (matching local)
    drawMixed(page, "公司名稱:  ", { x: colA, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    const cnLabelW = widthOfText("公司名稱:  ", f.cjk, f.ascii, hdrSize);
    drawMixed(page, coNameCh || coName, { x: colA + cnLabelW, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });

    drawMixed(page, "公司編號:  ", { x: colB, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    const num2LabelW = widthOfText("公司編號:  ", f.cjk, f.ascii, hdrSize);
    drawMixed(page, br, { x: colB + num2LabelW, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });

    // Underlines below Chinese row
    const cnValW = widthOfText(coNameCh || coName, f.cjk, f.ascii, hdrSize);
    hline(page, colA + cnLabelW, colA + cnLabelW + Math.max(cnValW, 150), y - 2, 0.5);
    hline(page, colB + num2LabelW, colB + num2LabelW + Math.max(brValW, 100), y - 2, 0.5);

    y -= 20;

    // ── JURISDICTION (below header, per docx order) — label bold (matching local) ──
    drawMixed(page, "JURISDICTION:  ", { x: M, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii, cjkBold: f.cjkBold, asciiBold: f.asciiBold, bold: true });
    const jlw = widthOfText("JURISDICTION:  ", f.cjk, f.ascii, hdrSize, f.cjkBold, f.asciiBold, true);
    drawMixed(page, "HONG KONG", { x: M + jlw, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    y -= 11;
    drawMixed(page, "司法管轄區:  HONG KONG", { x: M, y, size: hdrSize, cjk: f.cjk, ascii: f.ascii });
    y -= 16;

    // Separator
    hline(page, M, PAGE_W - M, y, 0.5);
    y -= 12;

    // ═══════════════════════════════════════════════
    // DATA TABLE (7 cols, grid borders, bilingual headers)
    // Column widths per docx gridCol, ID column widened
    // ═══════════════════════════════════════════════
    const colRatios = [1526, 2154, 2835, 2551, 2551, 1701, 1814];
    const totalDxa = colRatios.reduce((a, b) => a + b, 0);
    const col_w = colRatios.map(r => r * CW / totalDxa);
    col_w[3] += 8;  // widen ID column
    col_w[4] -= 8;  // narrow Nature column

    const col_x: number[] = [M];
    for (let i = 0; i < col_w.length - 1; i++) col_x.push(col_x[i] + col_w[i]);
    const endX = PAGE_W - M;

    // ── Bilingual Multi-line Table Headers ──
    const hdrLabels: [string, number][] = [
      ["Entry Date\n錄入日期", 0],
      ["Name\n姓名／名稱", 1],
      ["Correspondence Address\n(for Registrable Person)\n通訊地址（自然人）\nRegistered Office Address\n(for Legal Entity)\n註冊／主要營業地址（法人）", 2],
      ["ID / PPT No. (Issuing Country)\n(for Registrable Person)\n身份證／護照號碼\n（簽發國家）（自然人）\nCompany No. (Place of Incorp.)\n/ Legal Form\n公司編號（成立地方）\n／法律形式（法人）", 3],
      ["Nature of Control\n控制性質", 4],
      ["Becoming Date\n(Cessation Date)\n開始日期\n（終止日期）", 5],
      ["Remarks\n備註", 6],
    ];

    const hdrLineH = 10;
    const maxHdrLines = Math.max(...hdrLabels.map(([l]) => l.split('\n').length));
    const hdrH = maxHdrLines * hdrLineH + 6;
    const hdrY0 = y;

    for (const [label, ci] of hdrLabels) {
      const x0 = col_x[ci];
      const cwVal = ci < col_w.length ? col_w[ci] : (endX - col_x[ci]);
      drawRect(page, x0, y, cwVal, hdrH);
      const lines = label.split('\n');
      const textBlockH = lines.length * hdrLineH;
      const textStartY = y - (hdrH - textBlockH) / 2;
      for (let li = 0; li < lines.length; li++) {
        const lineText = lines[li];
        const hasCjk = /[一-鿿　-〿＀-￯]/.test(lineText);
        const font = hasCjk ? f.cjkBold : f.asciiBold;
        const lw = font.widthOfTextAtSize(lineText, 7);
        const lx = x0 + (cwVal - lw) / 2;
        page.drawText(lineText, { x: lx, y: textStartY - li * hdrLineH, size: 7, font });
      }
    }

    y -= hdrH;
    const tableTopY = hdrY0;

    // ── Data Rows ──
    const dataSize = 8;
    const minRowH = 20;

    // Continuation header helper (bold matching local)
    const drawContHdr = (): number => {
      let cy = PAGE_H - 22;
      drawMixedCenter(page, "SIGNIFICANT CONTROLLERS REGISTER (Cont'd)", { x: PAGE_W / 2, y: cy, size: 13, cjk: f.cjk, ascii: f.ascii, cjkBold: f.cjkBold, asciiBold: f.asciiBold, bold: true });
      cy -= 16;
      drawMixedCenter(page, "重要控制人登記冊（續）", { x: PAGE_W / 2, y: cy, size: 11, cjk: f.cjk, ascii: f.ascii, cjkBold: f.cjkBold, asciiBold: f.asciiBold, bold: true });
      cy -= 14;
      hline(page, M, PAGE_W - M, cy, 0.5);
      cy -= 8;
      for (const [label, ci] of hdrLabels) {
        const x0 = col_x[ci];
        const cwVal = ci < col_w.length ? col_w[ci] : (endX - col_x[ci]);
        drawRect(page, x0, cy, cwVal, hdrH);
        const lines = label.split('\n');
        const textBlockH = lines.length * hdrLineH;
        const textStartY = cy - (hdrH - textBlockH) / 2;
        for (let li = 0; li < lines.length; li++) {
          const lineText = lines[li];
          const hasCjk = /[一-鿿　-〿＀-￯]/.test(lineText);
          const font = hasCjk ? f.cjk : f.ascii;
          const lw = font.widthOfTextAtSize(lineText, 7);
          const lx = x0 + (cwVal - lw) / 2;
          page.drawText(lineText, { x: lx, y: textStartY - li * hdrLineH, size: 7, font });
        }
      }
      cy -= hdrH;
      return cy;
    };

    if (scrs.length === 0) {
      const emptyH = minRowH;
      for (let ci = 0; ci < col_x.length; ci++) {
        const cwVal = ci < col_w.length ? col_w[ci] : (endX - col_x[ci]);
        drawRect(page, col_x[ci], y, cwVal, emptyH);
      }
      drawMixed(page, "(No SCR records / 尚無重要控制人記錄)", { x: M + 4, y: y - 16, size: 8, cjk: f.cjk, ascii: f.ascii });
      y -= emptyH;
    } else {
      for (const s of scrs) {
        // Build nature of control
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

        // ID / Company info
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
        let dateDisplay = dateCea ? `${dateBecame}  /  ${dateCea}` : `${dateBecame}  /  Current`;

        if (rget(s, 'is_designated_rep') && rget(s, 'designated_rep_name')) {
          const repName = rget(s, 'designated_rep_name');
          dateDisplay += `\nRep: ${repName}`;
        }

        let entryDate = rget(s, 'created_at') || '';
        if (entryDate && entryDate.length > 10) entryDate = entryDate.slice(0, 10);

        const remarks = rget(s, 'remarks') || '';
        const rowData = [entryDate, nameDisplay, addr, idBlock, natureText, dateDisplay, remarks];

        // Calculate row height
        let rowH = minRowH;
        const cellLinesList: number[] = [];
        for (let ci = 0; ci < rowData.length; ci++) {
          const txt = rowData[ci];
          if (!txt) { cellLinesList.push(1); continue; }
          const cellPad = 4;
          const cwAvail = (ci < col_w.length ? col_w[ci] : (endX - col_x[ci])) - cellPad;
          const lines = wrapText(String(txt), f.cjk, f.ascii, dataSize, Math.max(cwAvail, 20));
          cellLinesList.push(lines.length);
          rowH = Math.max(rowH, lines.length * (dataSize + 4) + 4);
        }

        // Page break
        if (y - rowH < 50) {
          hline(page, M, endX, y, 0.5);
          page = pdf.addPage([PAGE_W, PAGE_H]);
          y = drawContHdr();
        }

        // Draw row cells
        for (let ci = 0; ci < rowData.length; ci++) {
          const x0 = col_x[ci];
          const cwVal = ci < col_w.length ? col_w[ci] : (endX - col_x[ci]);
          drawRect(page, x0, y, cwVal, rowH);

          const txt = rowData[ci];
          if (txt) {
            const cellPad = 3;
            const cwAvail = Math.max(cwVal - cellPad * 2, 20);
            const lines = wrapText(String(txt), f.cjk, f.ascii, dataSize, cwAvail);
            for (let li = 0; li < lines.length; li++) {
              const lineText = lines[li];
              if (!lineText) continue;
              const hasCjk = /[一-鿿　-〿＀-￯]/.test(lineText);
              const font = hasCjk ? f.cjk : f.ascii;
              page.drawText(lineText, {
                x: x0 + cellPad,
                y: y - 2 - li * (dataSize + 4) - dataSize,
                size: dataSize,
                font,
              });
            }
          }
        }
        y -= rowH;
      }
    }

    // Table bottom border
    hline(page, M, endX, y, 0.5);
    y -= 14;

    // ═══════════════════════════════════════════════
    // ADDITIONAL MATTERS — 2×2 table (header row + content row)
    // ═══════════════════════════════════════════════
    const addHdrH = 20;
    const addContentH = 48;
    const addW = CW * 0.5;

    // Row 0: Headers
    drawRect(page, M, y, addW, addHdrH);
    drawRect(page, M + addW, y, addW, addHdrH);
    drawMixed(page, "Additional Matters", { x: M + 3, y: y - 3, size: 7, cjk: f.cjk, ascii: f.ascii, cjkBold: f.cjkBold, asciiBold: f.asciiBold, bold: true });
    drawMixed(page, "附加事項", { x: M + 3, y: y - 12, size: 7, cjk: f.cjk, ascii: f.ascii });
    drawMixed(page, "Remarks", { x: M + addW + 3, y: y - 3, size: 7, cjk: f.cjk, ascii: f.ascii, cjkBold: f.cjkBold, asciiBold: f.asciiBold, bold: true });
    drawMixed(page, "備註", { x: M + addW + 3, y: y - 12, size: 7, cjk: f.cjk, ascii: f.ascii });
    y -= addHdrH;

    // Row 1: Empty content cells
    drawRect(page, M, y, addW, addContentH);
    drawRect(page, M + addW, y, addW, addContentH);
    // y not decremented further — these are the last elements

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
