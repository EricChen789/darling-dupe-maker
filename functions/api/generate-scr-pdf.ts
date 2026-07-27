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

// Portrait A4 — SCR stays Portrait per user spec (item 92)
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 35;
const CONTENT_W = PAGE_W - MARGIN * 2;

// RTF colour constants
const BLUE = rgb(0, 0, 1);
const GREY_HDR = rgb(227 / 255, 227 / 255, 227 / 255);
const LINE_DARK = rgb(0.4, 0.4, 0.4);
const LINE_LIGHT = rgb(0.82, 0.82, 0.82);

// ── Mixed-font helpers (ASCII → Helvetica, everything else → CJK font) ──
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

function drawMixed(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; color?: any }) {
  const clean = text.replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  let x = opts.x;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function widthOfText(text: string, cjk: any, ascii: any, size: number): number {
  let w = 0;
  for (const s of segmentText(text)) w += (s.useCjk ? cjk : ascii).widthOfTextAtSize(s.text, size);
  return w;
}

function wrapText(text: string, cjk: any, ascii: any, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
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

// ── Page header (blue company info, title with date) ──
function drawPageHeader(page: any, f: { cjk: any; ascii: any },
  title: string, company: any): number {
  const today = new Date().toLocaleDateString('en-GB');
  let y = PAGE_H - 45;

  drawMixed(page, (company as any).name || "", { x: MARGIN, y, size: 14, cjk: f.cjk, ascii: f.ascii, color: BLUE });
  y -= 20;

  const br = (company as any).company_number || "";
  drawMixed(page, `Company Number:  ${br}`, { x: MARGIN, y, size: 10, cjk: f.cjk, ascii: f.ascii, color: BLUE });
  y -= 22;

  drawMixed(page, `${title} AT ${today}`, { x: MARGIN, y, size: 12, cjk: f.cjk, ascii: f.ascii, color: BLUE });
  y -= 24;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0, 0, 0), thickness: 0.8 });
  return y - 10;
}

// ── Grey header row (RTF style: no vertical lines, 9pt) ──
function drawTableHeaderRow(page: any, f: { cjk: any; ascii: any },
  cols: { x: number; w: number; label: string }[], y: number): number {
  const fontSize = 9;
  let maxLines = 1;
  const wrappedLabels: string[][] = [];
  for (const c of cols) {
    const lines = wrapText(c.label, f.cjk, f.ascii, fontSize, c.w - 8);
    wrappedLabels.push(lines);
    if (lines.length > maxLines) maxLines = lines.length;
  }
  const rowH = Math.max(maxLines * 13 + 8, 26);

  page.drawRectangle({
    x: MARGIN, y: y - rowH, width: CONTENT_W, height: rowH,
    color: GREY_HDR,
  });

  for (let i = 0; i < cols.length; i++) {
    for (let li = 0; li < wrappedLabels[i].length; li++) {
      drawMixed(page, wrappedLabels[i][li], {
        x: cols[i].x, y: y - 4 - li * 12, size: fontSize, cjk: f.cjk, ascii: f.ascii,
      });
    }
  }

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: LINE_DARK, thickness: 0.5 });
  page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: PAGE_W - MARGIN, y: y - rowH }, color: LINE_DARK, thickness: 0.5 });

  return y - rowH;
}

// ── Data row (RTF style: no vertical lines, no alternating colour) ──
function drawDataRow(page: any, f: { cjk: any; ascii: any },
  cols: { x: number; w: number; label: string }[],
  values: string[], y: number): number {
  const fontSize = 9;
  let maxLines = 1;
  const wrapped: string[][] = [];
  for (let i = 0; i < values.length; i++) {
    const lines = wrapText(values[i] || "", f.cjk, f.ascii, fontSize, cols[i].w - 8);
    wrapped.push(lines);
    if (lines.length > maxLines) maxLines = lines.length;
  }
  const rowH = Math.max(maxLines * 13 + 8, 24);

  for (let i = 0; i < values.length; i++) {
    for (let li = 0; li < wrapped[i].length; li++) {
      drawMixed(page, wrapped[i][li], {
        x: cols[i].x, y: y - 4 - li * 12, size: fontSize, cjk: f.cjk, ascii: f.ascii,
      });
    }
  }

  page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: PAGE_W - MARGIN, y: y - rowH }, color: LINE_LIGHT, thickness: 0.3 });

  return y - rowH;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { companyId } = await request.json();
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

    // ── SCR Register — Portrait A4, RTF-matched styling ──
    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = drawPageHeader(page, f, "SIGNIFICANT CONTROLLERS REGISTER\n重要控制人登記冊", company);

    // 7-column layout (Portrait-optimised)
    const x0 = MARGIN + 2;
    const scrCols = [
      { label: "Entry\nDate",                 x: x0,       w: 42 },
      { label: "Name of\nController",         x: x0 + 43,  w: 105 },
      { label: "ID / Company\nNumber",        x: x0 + 149, w: 68 },
      { label: "Address",                     x: x0 + 218, w: 118 },
      { label: "Nature of\nControl",          x: x0 + 337, w: 72 },
      { label: "Date Became\n/ Ceased",       x: x0 + 410, w: 60 },
      { label: "Remarks",                     x: x0 + 471, w: 58 },
    ];

    y = drawTableHeaderRow(page, f, scrCols, y);
    let rowNum = 0;

    if (scrs.length === 0) {
      drawMixed(page, '(No significant controllers / 尚無重要控制人記錄)', {
        x: MARGIN + 5, y: y - 18, size: 9, cjk: f.cjk, ascii: f.ascii, color: rgb(0.5, 0.5, 0.5),
      });
    } else {
      for (const s of scrs) {
        const natures: string[] = [];
        if (s.nature_shares) natures.push('Shares >25%');
        if (s.nature_voting) natures.push('Voting >25%');
        if (s.nature_appoint) natures.push('Appoint Director');
        if (s.nature_influence) natures.push('Sig. Influence');
        if (s.nature_trust) natures.push('Trust Control');
        if (s.nature_other) natures.push(s.nature_other);

        const isNatural = (s.identity || "natural") === "natural";
        const idInfo = isNatural
          ? (s.id_number || s.passport_number || "-")
          : (s.company_number_ref || "-");
        const enteredDate = s.date_became || s.created_at?.slice(0, 10) || "-";

        const values = [
          enteredDate,
          s.name_english || s.name_chinese || '(unnamed)',
          idInfo,
          (s.address || "").slice(0, 55),
          natures.join(', ') || '-',
          `${s.date_became || "-"}${s.date_ceased ? "\nCeased: " + s.date_ceased : ""}`,
          s.date_ceased ? "Ceased" : "Current",
        ];

        rowNum++;

        if (y - 40 < 60) {
          page = pdf.addPage([PAGE_W, PAGE_H]);
          y = drawPageHeader(page, f, "SIGNIFICANT CONTROLLERS REGISTER (Cont'd)\n重要控制人登記冊（續）", company);
          y = drawTableHeaderRow(page, f, scrCols, y);
        }

        y = drawDataRow(page, f, scrCols, values, y);

        // Designated representative note
        if (s.is_designated_rep && s.designated_rep_name) {
          y -= 2;
          if (y < 60) {
            page = pdf.addPage([PAGE_W, PAGE_H]);
            y = drawPageHeader(page, f, "SIGNIFICANT CONTROLLERS REGISTER (Cont'd)\n重要控制人登記冊（續）", company);
          }
          drawMixed(page, `  > Designated Rep / 指定代表: ${s.designated_rep_name || "-"}  |  Contact / 聯絡: ${s.designated_rep_contact || "-"}`, {
            x: MARGIN + 5, y, size: 8, cjk: f.cjk, ascii: f.ascii, color: rgb(0.3, 0.3, 0.6),
          });
          y -= 14;
        }
      }
    }

    const bytes = await pdf.save();
    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="SCR_${(company as any).company_number || 'company'}.pdf"`,
      },
    });
  } catch (e: any) {
    console.error('SCR PDF error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
