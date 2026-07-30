import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  corsHeaders, jsonResp, uint8ToBase64,
  drawMixed, drawMixedRight, widthOfText, segmentText, wrapText,
  fetchAndEmbedFont, type EmbeddedFonts,
} from './_pdf-utils';

type Env = AuthEnv & {
  DB: D1Database;
  PDF_TEMPLATES?: R2Bucket;
  R2?: R2Bucket;
};

// Landscape A4 — matching RTF sample (16838×11906 twips)
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 30;

// RTF colour constants
const LINE_LIGHT = rgb(0.82, 0.82, 0.82);

// ── Paul Tang page header (black & white) ──
function drawPageHeader(page: any, f: { cjk: any; ascii: any },
  title: string, company: any, quorum: number | null): number {
  const today = new Date().toLocaleDateString('en-GB');
  let y = PAGE_H - 45;

  // Company name — centered, black, 14pt
  const coName = (company as any).name || "";
  const coNameW = widthOfText(coName, f.cjk, f.ascii, 14);
  drawMixed(page, coName, { x: PAGE_W / 2 - coNameW / 2, y, size: 14, cjk: f.cjk, ascii: f.ascii });
  y -= 20;

  // Company Number — centered, black
  const br = (company as any).company_number || "";
  const brLine = `Company Number:  ${br}`;
  const brW = widthOfText(brLine, f.cjk, f.ascii, 10);
  drawMixed(page, brLine, { x: PAGE_W / 2 - brW / 2, y, size: 10, cjk: f.cjk, ascii: f.ascii });

  // Quorum — right-aligned
  if (quorum !== null) {
    drawMixedRight(page, `Quorum:  ${quorum}`, { x: PAGE_W - MARGIN, y, size: 9, cjk: f.cjk, ascii: f.ascii });
  }
  y -= 22;

  // Title — black
  drawMixed(page, `${title} AT ${today}`, { x: MARGIN, y, size: 12, cjk: f.cjk, ascii: f.ascii });
  y -= 24;

  // Black separator line
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

  // Header text — black, 9pt
  for (let i = 0; i < cols.length; i++) {
    for (let li = 0; li < wrappedLabels[i].length; li++) {
      drawMixed(page, wrappedLabels[i][li], {
        x: cols[i].x, y: y - 4 - li * 12, size: fontSize, cjk: f.cjk, ascii: f.ascii,
      });
    }
  }

  // Top + bottom borders only (black, no vertical dividers)
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0, 0, 0), thickness: 0.5 });
  page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: PAGE_W - MARGIN, y: y - rowH }, color: rgb(0, 0, 0), thickness: 0.5 });

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

    const [company, rolesResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'director'").bind(companyId).all(),
    ]);

    if (!company) throw new Error("Company not found");

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

    const pdf = await PDFDocument.create();
    const { cjk: cjkFont, ascii: asciiFont } = await fetchAndEmbedFont(pdf, env as any);
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

    const renderSection = (items: any[], isSecretary: boolean) => {
      for (const r of items) {
        const p = personMap.get(r.person_id) || {};
        const nameEn = p.name_english || p.name_chinese || "(unnamed)";
        const isNat = (p.identity || "natural") === "natural";

        // Name/Address block — keep it short to save CPU
        const addr = (isNat ? (p.address || "") : (p.registered_office || p.address || "")).slice(0, 50);
        const nameBlock = addr ? `${nameEn}\n${addr}` : nameEn;

        // DOB/Place/Nation block — single line for corporate
        const dobBlock = isNat
          ? `${p.date_of_birth || "-"}  ${p.place_of_birth || "-"}\n${p.nationality || "-"}`
          : `${p.place_incorporated || "-"} (Corporate)`;

        // ID block
        const idInfo = isNat
          ? (p.id_number || p.passport_number || "-")
          : (p.company_number_ref || "-");

        // Position
        const position = isSecretary ? "Secretary" : (r.is_reserve ? "Reserve Director" : "Director");

        // Date Appointed
        const dateApp = r.date_appointed || "-";

        // Date Ceased / Reason
        const reasonBlock = r.date_ceased ? `Resigned\n${r.date_ceased}` : "Current";

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

    // Note: Secretaries are generated by the separate /api/generate-secretaries-register-pdf endpoint
    // to keep each function within Cloudflare Workers CPU time limits.

    const bytes = await pdf.save();
    const byteArray = new Uint8Array(bytes);
    return new Response(JSON.stringify({ pdf: uint8ToBase64(byteArray) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-directors-register-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
