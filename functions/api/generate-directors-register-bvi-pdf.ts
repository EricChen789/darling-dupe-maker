import { PDFDocument, rgb } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  corsHeaders, uint8ToBase64,
  drawMixed, drawMixedRight, widthOfText, wrapText,
  fetchAndEmbedFont,
} from './_pdf-utils';

type Env = AuthEnv & {
  DB: D1Database;
  PDF_TEMPLATES?: R2Bucket;
  R2?: R2Bucket;
};

// Landscape A4
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 28;
const LINE_LIGHT = rgb(0.82, 0.82, 0.82);

// ── Page header ──
function drawPageHeader(page: any, f: { cjk: any; ascii: any },
  title: string, company: any, count: number | null): number {
  const today = new Date().toLocaleDateString('en-GB');
  let y = PAGE_H - 42;

  const coName = (company as any).name || "";
  const coNameW = widthOfText(coName, f.cjk, f.ascii, 13);
  drawMixed(page, coName, { x: PAGE_W / 2 - coNameW / 2, y, size: 13, cjk: f.cjk, ascii: f.ascii });
  y -= 18;

  const br = (company as any).company_number || "";
  const brLine = `Company Number:  ${br}`;
  const brW = widthOfText(brLine, f.cjk, f.ascii, 9);
  drawMixed(page, brLine, { x: PAGE_W / 2 - brW / 2, y, size: 9, cjk: f.cjk, ascii: f.ascii });

  if (count !== null) {
    drawMixedRight(page, `No. of Directors:  ${count}`, { x: PAGE_W - MARGIN, y, size: 8, cjk: f.cjk, ascii: f.ascii });
  }
  y -= 20;

  drawMixed(page, `${title} AT ${today}`, { x: MARGIN, y, size: 11, cjk: f.cjk, ascii: f.ascii });
  y -= 22;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0, 0, 0), thickness: 0.8 });
  return y - 8;
}

// ── Table header row ──
function drawTableHeaderRow(page: any, f: { cjk: any; ascii: any },
  cols: { x: number; w: number; label: string }[], y: number): number {
  const fontSize = 7.5;
  let maxLines = 1;
  const wrappedLabels: string[][] = [];
  for (const c of cols) {
    const lines = wrapText(c.label, f.cjk, f.ascii, fontSize, c.w - 6);
    wrappedLabels.push(lines);
    if (lines.length > maxLines) maxLines = lines.length;
  }
  const rowH = Math.max(maxLines * 11 + 8, 24);

  for (let i = 0; i < cols.length; i++) {
    for (let li = 0; li < wrappedLabels[i].length; li++) {
      drawMixed(page, wrappedLabels[i][li], {
        x: cols[i].x, y: y - 3 - li * 10, size: fontSize, cjk: f.cjk, ascii: f.ascii,
      });
    }
  }

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0, 0, 0), thickness: 0.5 });
  page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: PAGE_W - MARGIN, y: y - rowH }, color: rgb(0, 0, 0), thickness: 0.5 });

  return y - rowH;
}

// ── Data row ──
function drawDataRow(page: any, f: { cjk: any; ascii: any },
  cols: { x: number; w: number; label: string }[],
  values: string[], y: number): number {
  const fontSize = 8;
  let maxLines = 1;
  const wrapped: string[][] = [];
  for (let i = 0; i < values.length; i++) {
    const lines = wrapText(values[i] || "", f.cjk, f.ascii, fontSize, cols[i].w - 6);
    wrapped.push(lines);
    if (lines.length > maxLines) maxLines = lines.length;
  }
  const rowH = Math.max(maxLines * 11 + 8, 22);

  for (let i = 0; i < values.length; i++) {
    for (let li = 0; li < wrapped[i].length; li++) {
      drawMixed(page, wrapped[i][li], {
        x: cols[i].x, y: y - 3 - li * 10, size: fontSize, cjk: f.cjk, ascii: f.ascii,
      });
    }
  }

  page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: PAGE_W - MARGIN, y: y - rowH }, color: LINE_LIGHT, thickness: 0.3 });

  return y - rowH;
}

// ── Format date from YYYY-MM-DD to DD/MM/YYYY ──
function fmtDate(s: string | null | undefined): string {
  if (!s) return "-";
  const t = String(s).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return t;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const body = await request.json() as any;
    const { companyId, format } = body; // format: "individual" | "corporate"
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isCorporate = format === "corporate";

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

    // Filter by identity
    const filtered = roles.filter((r: any) => {
      const p = personMap.get(r.person_id);
      const isNat = !p || (p.identity || "natural") === "natural";
      return isCorporate ? !isNat : isNat;
    });

    const pdf = await PDFDocument.create();
    const { cjk: cjkFont, ascii: asciiFont } = await fetchAndEmbedFont(pdf, env as any);
    const f = { cjk: cjkFont, ascii: asciiFont };

    const title = isCorporate
      ? "REGISTER OF DIRECTORS (For Corporate Director)"
      : "REGISTER OF DIRECTORS (For Individual Director)";
    const count = filtered.length || null;

    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = drawPageHeader(page, f, title, company, count);

    // ── Column definitions matching Excel template ──
    const CONTENT_W = PAGE_W - MARGIN * 2;
    const x0 = MARGIN + 2;

    let cols: { x: number; w: number; label: string }[];

    if (isCorporate) {
      // 9 columns for Corporate Director (matching Excel Sheet 2)
      const cw = CONTENT_W;
      cols = [
        { label: "Date of\nAppointment",                              x: x0,                       w: cw * 0.085 },
        { label: "Corporate Name",                                    x: x0 + cw * 0.085,         w: cw * 0.155 },
        { label: "Corporate\nNumber",                                  x: x0 + cw * 0.240,         w: cw * 0.100 },
        { label: "Date of\nIncorporation",                             x: x0 + cw * 0.340,         w: cw * 0.100 },
        { label: "Place of\nIncorporation",                            x: x0 + cw * 0.440,         w: cw * 0.105 },
        { label: "Registered Office / Principal\nOffice Address",      x: x0 + cw * 0.545,         w: cw * 0.175 },
        { label: "Address (BVI:\nstate Corp No only)",                 x: x0 + cw * 0.720,         w: cw * 0.100 },
        { label: "Date of\nCessation",                                 x: x0 + cw * 0.820,         w: cw * 0.090 },
        { label: "Entry\nMade By",                                     x: x0 + cw * 0.910,         w: cw * 0.090 },
      ];
    } else {
      // 9 columns for Individual Director (matching Excel Sheet 1)
      const cw = CONTENT_W;
      cols = [
        { label: "Date of\nAppointment",                   x: x0,                   w: cw * 0.085 },
        { label: "Full Name",                              x: x0 + cw * 0.085,     w: cw * 0.155 },
        { label: "Former Name\n(if any)",                   x: x0 + cw * 0.240,     w: cw * 0.105 },
        { label: "Date and Place\nof Birth",                x: x0 + cw * 0.345,     w: cw * 0.105 },
        { label: "Nationality and\nID / PPT No.",           x: x0 + cw * 0.450,     w: cw * 0.115 },
        { label: "Address for the\nService of Documents",   x: x0 + cw * 0.565,     w: cw * 0.155 },
        { label: "Occupation",                             x: x0 + cw * 0.720,     w: cw * 0.080 },
        { label: "Date of\nCessation",                      x: x0 + cw * 0.800,     w: cw * 0.090 },
        { label: "Entry\nMade By",                          x: x0 + cw * 0.890,     w: cw * 0.110 },
      ];
    }

    y = drawTableHeaderRow(page, f, cols, y);

    if (filtered.length === 0) {
      const msg = isCorporate ? "(No corporate directors / 尚無法人董事記錄)" : "(No individual directors / 尚無自然人董事記錄)";
      drawMixed(page, msg, {
        x: MARGIN + 5, y: y - 16, size: 8, cjk: f.cjk, ascii: f.ascii, color: rgb(0.5, 0.5, 0.5),
      });
    } else {
      for (const r of filtered) {
        const p = personMap.get(r.person_id) || {};
        const isNat = !p || (p.identity || "natural") === "natural";

        // Build row values based on format
        let values: string[];

        if (isCorporate) {
          // Corporate Director columns
          const corpName = p.name_english || p.name_chinese || "(unnamed)";
          const corpNo = p.company_number_ref || "-";
          const incorpDate = fmtDate(p.date_of_incorporation);
          const placeIncorp = p.place_incorporated || "-";
          const regOffice = (p.registered_office || p.address || "").slice(0, 150);

          // BVI special: if place is BVI, show corp number; otherwise show address
          const placeLower = placeIncorp.toLowerCase();
          const isBVI = placeLower.includes("bvi") || placeLower.includes("british virgin");
          const bviAddr = isBVI ? (p.company_number_ref || "-") : regOffice;

          const dateApp = r.date_appointed || "-";
          const dateCea = r.date_ceased || (r.date_ceased ? fmtDate(r.date_ceased) : "Current");
          const entryBy = ""; // Entry Made By — manual field, left blank

          values = [dateApp, corpName, corpNo, incorpDate, placeIncorp, regOffice, bviAddr, dateCea, entryBy];
        } else {
          // Individual Director columns
          const fullName = p.name_english || p.name_chinese || "(unnamed)";
          const formerName = p.previous_name || p.alias || "";
          const dob = fmtDate(p.date_of_birth);
          const pob = p.place_of_birth || "-";
          const dobPlace = dob !== "-" ? `${dob}  ${pob}` : pob;
          const nationality = p.nationality || "-";
          const idNo = p.id_number || p.passport_number || "-";
          const natId = `${nationality}\n${idNo}`;
          const addr = (p.address || "").slice(0, 150);
          const occupation = p.occupation || "-";
          const dateApp = r.date_appointed || "-";
          const dateCea = r.date_ceased ? fmtDate(r.date_ceased) : "Current";
          const entryBy = "";

          values = [dateApp, fullName, formerName, dobPlace, natId, addr, occupation, dateCea, entryBy];
        }

        // Page break
        if (y - 40 < 40) {
          page = pdf.addPage([PAGE_W, PAGE_H]);
          y = drawPageHeader(page, f, `${title} (Cont'd)`, company, count);
          y = drawTableHeaderRow(page, f, cols, y);
        }

        y = drawDataRow(page, f, cols, values, y);
      }
    }

    // ── Footer note (from Excel template) ──
    if (y > 50) {
      y -= 16;
      const noteY = y;
      drawMixed(page, "PLEASE NOTE:", { x: MARGIN, y: noteY, size: 6.5, cjk: f.cjk, ascii: f.ascii });
      drawMixed(page,
        "(1) THE FIRST REGISTERED AGENT OF THE COMPANY SHALL, WITHIN 6 MONTHS FROM THE DATE OF INCORPORATION OF THE COMPANY, " +
        "APPOINT ONE OR MORE PERSONS AS THE FIRST DIRECTORS OF THE COMPANY. THE ORIGINAL OR COPY OF THIS REGISTER MUST BE KEPT " +
        "AT THE OFFICE OF THE COMPANY'S REGISTERED AGENT.",
        { x: MARGIN, y: noteY - 10, size: 5.5, cjk: f.cjk, ascii: f.ascii, color: rgb(0.3, 0.3, 0.3) });
      drawMixed(page,
        "(2) THE INITIAL COPY OF THE REGISTER OF DIRECTORS SHALL BE FILED FOR REGISTRATION BY THE REGISTRAR WITHIN 21 DAYS " +
        "OF THE APPOINTMENT OF FIRST DIRECTORS. ANY SUBSEQUENT CHANGES IN THE REGISTER WILL ALSO NEED TO BE FILED WITHIN 30 DAYS " +
        "OF ANY CHANGES OCCURRING.",
        { x: MARGIN, y: noteY - 18, size: 5.5, cjk: f.cjk, ascii: f.ascii, color: rgb(0.3, 0.3, 0.3) });
    }

    const bytes = await pdf.save();
    const byteArray = new Uint8Array(bytes);
    return new Response(JSON.stringify({ pdf: uint8ToBase64(byteArray) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-directors-register-bvi-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
