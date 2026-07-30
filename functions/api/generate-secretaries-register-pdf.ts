import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';

type Env = AuthEnv & {
  DB: D1Database;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHINESE_FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2";

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32KB chunks — avoids O(n²) string building
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Landscape A4 — matching RTF sample
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 30;
const CONTENT_W = PAGE_W - MARGIN * 2; // ~782pt

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

function drawMixedRight(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; color?: any }) {
  const clean = text.replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  let totalW = 0;
  for (const s of segs) {
    totalW += (s.useCjk ? opts.cjk : opts.ascii).widthOfTextAtSize(s.text, opts.size);
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

// ── Paul Tang page header (black & white) ──
function drawPageHeader(page: any, f: { cjk: any; ascii: any },
  title: string, company: any, quorum: number | null): number {
  const today = new Date().toLocaleDateString('en-GB');
  let y = PAGE_H - 45;

  // Company name — centered, black
  const coName = (company as any).name || "";
  const coNameW = widthOfText(coName, f.cjk, f.ascii, 14);
  drawMixed(page, coName, { x: PAGE_W / 2 - coNameW / 2, y, size: 14, cjk: f.cjk, ascii: f.ascii });
  y -= 20;

  // Company Number — centered, black
  const br = (company as any).company_number || "";
  const brLine = `Company Number:  ${br}`;
  const brW = widthOfText(brLine, f.cjk, f.ascii, 10);
  drawMixed(page, brLine, { x: PAGE_W / 2 - brW / 2, y, size: 10, cjk: f.cjk, ascii: f.ascii });

  if (quorum !== null) {
    drawMixedRight(page, `Quorum:  ${quorum}`, { x: PAGE_W - MARGIN, y, size: 9, cjk: f.cjk, ascii: f.ascii });
  }
  y -= 22;

  drawMixed(page, `${title} AT ${today}`, { x: MARGIN, y, size: 12, cjk: f.cjk, ascii: f.ascii });
  y -= 24;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0, 0, 0), thickness: 0.8 });
  return y - 10;
}

// ── White header row (Paul Tang style: no grey fill, no vertical lines) ──
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

  // White background — no fill

  for (let i = 0; i < cols.length; i++) {
    for (let li = 0; li < wrappedLabels[i].length; li++) {
      drawMixed(page, wrappedLabels[i][li], {
        x: cols[i].x, y: y - 4 - li * 12, size: fontSize, cjk: f.cjk, ascii: f.ascii,
      });
    }
  }

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0, 0, 0), thickness: 0.5 });
  page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: PAGE_W - MARGIN, y: y - rowH }, color: rgb(0, 0, 0), thickness: 0.5 });

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
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const { companyId } = await request.json();
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [company, rolesResult, fontResp] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'secretary'").bind(companyId).all(),
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

    const fontBytes = await fontResp.arrayBuffer();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const cjkFont = await pdf.embedFont(fontBytes);
    const asciiFont = await pdf.embedFont(StandardFonts.Helvetica);
    const f = { cjk: cjkFont, ascii: asciiFont };

    // ── Register of Secretaries — Landscape, ROD-style layout ──
    const quorum = roles.length || null;
    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = drawPageHeader(page, f, "REGISTER OF COMPANY SECRETARIES", company, quorum);

    // ROD-style columns with TCSP information
    const x0 = MARGIN + 3;
    const cols = [
      { label: "Name / Service /\nResidential Address",         x: x0,       w: 207 },
      { label: "ID No / Passport\nor Company No",               x: x0 + 208, w: 144 },
      { label: "TCSP Licence /\nBusiness Registration",          x: x0 + 353, w: 144 },
      { label: "Position",                                      x: x0 + 498, w: 112 },
      { label: "Date(s) Appointed\n/Meeting",                   x: x0 + 611, w: 83 },
      { label: "Reason / Date(s)\nCeased",                      x: x0 + 695, w: 96 },
    ];

    y = drawTableHeaderRow(page, f, cols, y);
    let rowNum = 0;

    if (roles.length === 0) {
      drawMixed(page, "(No secretaries / 尚無公司秘書記錄)", {
        x: MARGIN + 5, y: y - 18, size: 9, cjk: f.cjk, ascii: f.ascii, color: rgb(0.5, 0.5, 0.5),
      });
    } else {
      for (const r of roles) {
        const p = personMap.get(r.person_id) || {};
        const nameEn = p.name_english || p.name_chinese || "(unnamed)";
        const nameCh = p.name_english ? (p.name_chinese || "") : "";
        const isNat = (p.identity || "natural") === "natural";

        // Name/Address block
        const addr = isNat ? (p.address || "") : (p.registered_office || p.address || "");
        let nameBlock = nameEn;
        if (nameCh) nameBlock += "\n" + nameCh;
        if (addr) nameBlock += "\n" + addr.slice(0, 120);

        // ID block
        const idInfo = isNat
          ? (p.id_number || p.passport_number || "-")
          : (p.company_number_ref || "-");

        // TCSP / Company reg
        const tcspInfo = p.tcsp_number || (isNat ? "-" : (p.company_number_ref || "-"));

        // Position
        const position = "Secretary";

        // Dates
        const dateApp = r.date_appointed || "-";
        const dateCea = r.date_ceased;
        const reasonBlock = dateCea ? `Resigned\n${dateCea}` : "Current\n現任";

        rowNum++;

        if (y - 50 < 50) {
          page = pdf.addPage([PAGE_W, PAGE_H]);
          y = drawPageHeader(page, f, "REGISTER OF COMPANY SECRETARIES (Cont'd)", company, quorum);
          y = drawTableHeaderRow(page, f, cols, y);
        }

        const values = [nameBlock, idInfo, tcspInfo, position, dateApp, reasonBlock];
        y = drawDataRow(page, f, cols, values, y);
      }
    }

    const bytes = await pdf.save();
    const byteArray = new Uint8Array(bytes);
    return new Response(JSON.stringify({ pdf: uint8ToBase64(byteArray) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-secretaries-register-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
