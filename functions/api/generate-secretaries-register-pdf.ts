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

// Landscape A4 — matching RTF sample
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

    const [company, rolesResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'secretary'").bind(companyId).all(),
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

    const pdf = await PDFDocument.create();
    const { cjk: cjkFont, ascii: asciiFont } = await fetchAndEmbedFont(pdf, env as any);
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
