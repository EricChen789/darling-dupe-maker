import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

interface Env {
  DB: D1Database;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHINESE_FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2";

// Landscape A4 — matching RTF sample (16838×11906 twips)
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 30;
const CONTENT_W = PAGE_W - MARGIN * 2; // ~782pt

// RTF colour constants
const BLUE = rgb(0, 0, 1);
const GREY_HDR = rgb(227 / 255, 227 / 255, 227 / 255); // fillColor 14935011
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

function drawMixedRight(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; color?: any }) {
  // Right-align at given x
  const clean = text.replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  let totalW = 0;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    totalW += font.widthOfTextAtSize(s.text, opts.size);
  }
  let x = opts.x - totalW;
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

// ── RTF-style page header ──
function drawPageHeader(page: any, f: { cjk: any; ascii: any },
  title: string, company: any, quorum: number | null): number {
  const today = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
  let y = PAGE_H - 45;

  // Company name — blue bold (simulated with blue colour since Noto Sans TC has one weight)
  drawMixed(page, (company as any).name || "", { x: MARGIN, y, size: 14, cjk: f.cjk, ascii: f.ascii, color: BLUE });
  y -= 20;

  // Company Number — blue
  const br = (company as any).company_number || "";
  drawMixed(page, `Company Number:  ${br}`, { x: MARGIN, y, size: 10, cjk: f.cjk, ascii: f.ascii, color: BLUE });

  // Quorum — right-aligned small
  if (quorum !== null) {
    drawMixedRight(page, `Quorum:  ${quorum}`, { x: PAGE_W - MARGIN, y, size: 9, cjk: f.cjk, ascii: f.ascii, color: BLUE });
  }
  y -= 22;

  // Title — blue
  drawMixed(page, `${title} AT ${today}`, { x: MARGIN, y, size: 12, cjk: f.cjk, ascii: f.ascii, color: BLUE });
  y -= 24;

  // Black separator line
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0, 0, 0), thickness: 0.8 });
  return y - 10;
}

// ── Grey header row (RTF style: no vertical lines, 9pt black text) ──
function drawTableHeaderRow(page: any, f: { cjk: any; ascii: any },
  cols: { x: number; w: number; label: string }[], y: number): number {
  const fontSize = 9;
  // Calculate row height from wrapped header labels
  let maxLines = 1;
  const wrappedLabels: string[][] = [];
  for (const c of cols) {
    const lines = wrapText(c.label, f.cjk, f.ascii, fontSize, c.w - 8);
    wrappedLabels.push(lines);
    if (lines.length > maxLines) maxLines = lines.length;
  }
  const rowH = Math.max(maxLines * 13 + 8, 26);

  // Grey background
  page.drawRectangle({
    x: MARGIN, y: y - rowH, width: CONTENT_W, height: rowH,
    color: GREY_HDR,
  });

  // Header text — black, 9pt
  for (let i = 0; i < cols.length; i++) {
    for (let li = 0; li < wrappedLabels[i].length; li++) {
      drawMixed(page, wrappedLabels[i][li], {
        x: cols[i].x, y: y - 4 - li * 12, size: fontSize, cjk: f.cjk, ascii: f.ascii,
      });
    }
  }

  // Top + bottom borders only (no vertical dividers)
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: LINE_DARK, thickness: 0.5 });
  page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: PAGE_W - MARGIN, y: y - rowH }, color: LINE_DARK, thickness: 0.5 });

  return y - rowH;
}

// ── Data row (RTF style: no alternating colour, no vertical lines, thin bottom border) ──
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

  // Black text — no alternating background
  for (let i = 0; i < values.length; i++) {
    for (let li = 0; li < wrapped[i].length; li++) {
      drawMixed(page, wrapped[i][li], {
        x: cols[i].x, y: y - 4 - li * 12, size: fontSize, cjk: f.cjk, ascii: f.ascii,
      });
    }
  }

  // Thin bottom border only (no vertical lines)
  page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: PAGE_W - MARGIN, y: y - rowH }, color: LINE_LIGHT, thickness: 0.3 });

  return y - rowH;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { companyId } = await request.json();
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [company, rolesResult, fontResp] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role IN ('director', 'secretary')").bind(companyId).all(),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    if (!company) throw new Error("Company not found");
    if (!fontResp.ok) throw new Error("Failed to load Chinese font");

    const roles = (rolesResult.results || []) as any[];
    const personIds = roles.map((r: any) => r.person_id).filter(Boolean);
    let personsResult: any[] = [];
    if (personIds.length > 0) {
      const placeholders = personIds.map(() => '?').join(',');
      const result = await env.DB.prepare(`SELECT * FROM persons WHERE id IN (${placeholders})`)
        .bind(...personIds).all();
      personsResult = (result.results || []) as any[];
    }
    const personMap = new Map<string, any>();
    personsResult.forEach((p: any) => personMap.set(p.id, p));

    const directors = roles.filter((r: any) => r.role === "director");
    const secretaries = roles.filter((r: any) => r.role === "secretary");

    const fontBytes = await fontResp.arrayBuffer();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const cjkFont = await pdf.embedFont(fontBytes);
    const asciiFont = await pdf.embedFont(StandardFonts.Helvetica);
    const f = { cjk: cjkFont, ascii: asciiFont };

    // ── Register of Officers (ROD) — Landscape, RTF-matched layout ──
    const quorum = directors.length || null;
    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = drawPageHeader(page, f, "REGISTER OF OFFICERS", company, quorum);

    // ROD columns matching RTF sample — 6 columns, landscape-optimised
    // RTF exact widths scaled proportionally to fill CONTENT_W ≈ 782pt
    const x0 = MARGIN + 3;
    const rodCols = [
      { label: "Name / Service /\nResidential Address",         x: x0,       w: 207 },
      { label: "Date / Place Birth /\nPlace Incorporated /\nOccupation /", x: x0 + 208, w: 144 },
      { label: "ID No / Passport\nDetails",                     x: x0 + 353, w: 144 },
      { label: "Position",                                      x: x0 + 498, w: 112 },
      { label: "Date(s) Appointed\n/Meeting",                   x: x0 + 611, w: 83 },
      { label: "Reason / Date(s)\nCeased",                      x: x0 + 695, w: 96 },
    ];

    y = drawTableHeaderRow(page, f, rodCols, y);

    let rowNum = 0;

    const renderSection = (items: any[], isSecretary: boolean) => {
      for (const r of items) {
        const p = personMap.get(r.person_id) || {};
        const nameEn = p.name_english || p.name_chinese || "(unnamed)";
        const nameCh = p.name_english ? (p.name_chinese || "") : "";
        const isNat = (p.identity || "natural") === "natural";

        // Name/Address block
        const addr = isNat ? (p.address || "") : (p.registered_office || p.address || "");
        let nameBlock = nameEn;
        if (nameCh) nameBlock += "\n" + nameCh;
        if (addr) nameBlock += "\n" + addr.slice(0, 120);

        // DOB/Place/Nation block
        let dobBlock: string;
        if (isNat) {
          dobBlock = `${p.date_of_birth || "-"}\n${p.place_of_birth || "-"}\n${p.nationality || "-"}`;
        } else {
          dobBlock = `${p.place_incorporated || "-"}\n-\n-`;
        }

        // ID block
        const idInfo = isNat
          ? (p.id_number || p.passport_number || "-")
          : (p.company_number_ref || "-");

        // Position
        const position = isSecretary ? "Secretary" : (r.is_reserve ? "Reserve Director" : "Director");

        // Date Appointed
        const dateApp = r.date_appointed || "-";

        // Date Ceased / Reason
        const dateCea = r.date_ceased;
        const reasonBlock = dateCea ? `Resigned\n${dateCea}` : "Current\n現任";

        rowNum++;

        // Page break check
        if (y - 50 < 50) {
          page = pdf.addPage([PAGE_W, PAGE_H]);
          y = drawPageHeader(page, f, "REGISTER OF OFFICERS (Cont'd)", company, quorum);
          y = drawTableHeaderRow(page, f, rodCols, y);
        }

        const values = [nameBlock, dobBlock, idInfo, position, dateApp, reasonBlock];
        y = drawDataRow(page, f, rodCols, values, y);
      }
    }

    // Directors first
    if (directors.length > 0) {
      renderSection(directors, false);
    } else {
      drawMixed(page, "(No directors / 尚無董事記錄)", {
        x: MARGIN + 5, y: y - 18, size: 9, cjk: f.cjk, ascii: f.ascii, color: rgb(0.5, 0.5, 0.5),
      });
      y -= 25;
    }

    // Secretaries below (same column layout)
    if (secretaries.length > 0) {
      y -= 6;
      if (y - 40 < 50) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        y = drawPageHeader(page, f, "REGISTER OF OFFICERS (Cont'd)", company, quorum);
        y = drawTableHeaderRow(page, f, rodCols, y);
      }
      renderSection(secretaries, true);
    }

    const bytes = await pdf.save();
    return new Response(bytes, {
      headers: { ...corsHeaders, "Content-Type": "application/pdf" },
    });
  } catch (e: any) {
    console.error("generate-directors-register-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
