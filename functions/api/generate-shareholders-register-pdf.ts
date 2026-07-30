// POST /api/generate-shareholders-register-pdf
// Register of Members (ROM) — uses Paul Tang RTF template as background PDF
// Overlays real data on top via pdf-lib (same pattern as SCR)
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  uint8ToBase64, fetchAndEmbedFont, rget,
  segmentText, drawMixed, drawMixedRight, widthOfText,
} from './_pdf-utils';

type Env = AuthEnv & {
  DB: D1Database;
  PDF_TEMPLATES: R2Bucket;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Landscape A4
const PW = 842, PH = 595;

const BLUE = rgb(0, 51 / 255, 153 / 255);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);

// ── Marker positions (from PyMuPDF analysis of RTF→PDF, origin top-left) ──
// pdf-lib uses bottom-left origin, so: pdfY = PH - pymupdf_y1
// Font sizes matching RTF template
const FS = { header: 12, title: 13, label: 9, body: 9, table: 7 };

interface Pos {
  x: number;
  y: number;   // pdf-lib y (already converted from PyMuPDF)
  size: number; // font size
  bold?: boolean;
  color?: any;
  align?: "L" | "R" | "C";
  w?: number;   // available width hint for truncation
  coverX?: number; // separate x for white cover (when text align differs from marker x)
  coverW?: number; // override cover width
}

const POSITIONS: Record<string, Pos> = {
  // ── Company header ──
  co_name:       { x: 71,  y: 535, size: FS.header, bold: true, color: BLUE },
  co_br:         { x: 153, y: 518, size: FS.body,   bold: true, color: BLUE },
  // Title date: marker at x≈203 (left), but date is right-aligned in the RTF
  report_date:   { x: 800, y: 503, size: FS.title,  bold: true, color: BLUE, align: "R", coverX: 203, coverW: 140 },

  // ── SH1 info ──
  sh1_name:      { x: 98,  y: 483, size: FS.label, bold: true, color: BLUE, w: 500 },
  sh1_addr:      { x: 105, y: 471, size: FS.label, color: BLUE, w: 500 },
  sh1_security:  { x: 113, y: 455, size: FS.label, bold: true, color: BLUE, w: 500 },

  // ── SH2 info ──
  sh2_name:      { x: 98,  y: 363, size: FS.label, bold: true, color: BLUE, w: 500 },
  sh2_addr:      { x: 105, y: 351, size: FS.label, color: BLUE, w: 500 },
  sh2_security:  { x: 113, y: 335, size: FS.label, bold: true, color: BLUE, w: 500 },
};

// Transaction table data row y positions (baseline, pdf-lib coords)
const SH1_DATA_Y = [410, 395];  // row 0, row 1 (distinctive)
const SH2_DATA_Y = [289, 274, 259];  // row 0, row 1, row 2
const SH_DATA_Y_OFFSET = 289 - 410;  // offset between SH1 and SH2 data rows

// Column x positions (left edge of each column cell, from rom-positions.json _table.columns)
const TX_COL_X = {
  date: 35,
  type: 95,
  units: 212,
  par: 270,
  paidup: 329,
  cert: 392,
  balance: 775,
  transfer: 563,
  distinct: 440,
};

// ── Helpers (shared helpers from _pdf-utils) ──

// Draw white rectangle to cover marker, then overlay real text
function drawOverlay(page: any, pos: Pos, text: string, fo: { cjk: any; ascii: any }) {
  if (!text) return;
  const str = String(text);
  // Cover the marker area with white
  const cx = pos.coverX !== undefined ? pos.coverX : pos.x;
  const coverW = pos.coverW || pos.w || 500;
  const coverH = pos.size + 4;
  page.drawRectangle({
    x: cx - 2,
    y: pos.y - pos.size - 2,
    width: coverW + 4,
    height: coverH,
    color: WHITE,
  });
  // Draw real text at pos.x
  if (pos.align === "R") {
    drawMixedRight(page, str, { x: pos.x, y: pos.y, size: pos.size, cjk: fo.cjk, ascii: fo.ascii, bold: pos.bold, color: pos.color });
  } else {
    drawMixed(page, str, { x: pos.x, y: pos.y, size: pos.size, cjk: fo.cjk, ascii: fo.ascii, bold: pos.bold, color: pos.color });
  }
}

// Draw text in a table cell
function drawCell(page: any, text: string, x: number, y: number, size: number, fo: { cjk: any; ascii: any }, align = "L") {
  if (!text) return;
  const str = String(text).slice(0, 50);
  if (align === "R") {
    drawMixedRight(page, str, { x, y, size, cjk: fo.cjk, ascii: fo.ascii });
  } else {
    drawMixed(page, str, { x: x + 1, y, size, cjk: fo.cjk, ascii: fo.ascii });
  }
}

// ══════════════════════════════════════════════════════════════
export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const { companyId } = await request.json() as any;
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch data + template in parallel ──
    const [company, rolesResult, txResult, templateObj] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'shareholder'")
        .bind(companyId).all(),
      env.DB.prepare("SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date")
        .bind(companyId).all(),
      env.PDF_TEMPLATES.get("rom-template-bg.pdf"),
    ]);

    if (!company) throw new Error("Company not found");
    if (!templateObj) throw new Error("ROM template not found in R2");

    const roles = (rolesResult.results || []) as any[];
    const transactions = (txResult.results || []) as any[];

    // Map persons
    const personIds = roles.map((r: any) => r.person_id).filter(Boolean);
    const personMap = new Map<string, any>();
    if (personIds.length > 0) {
      const placeholders = personIds.map(() => '?').join(',');
      const result = await env.DB.prepare(
        `SELECT * FROM persons WHERE id IN (${placeholders})`
      ).bind(...personIds).all();
      (result.results || []).forEach((p: any) => personMap.set(p.id, p));
    }

    // Map transactions by person name
    const txByName = new Map<string, any[]>();
    for (const t of transactions) {
      const key = (rget(t, 'from_name') || rget(t, 'to_name') || "").trim().toUpperCase();
      if (key) {
        if (!txByName.has(key)) txByName.set(key, []);
        txByName.get(key)!.push(t);
      }
    }

    // Fonts — use R2-first shared helper (avoids CDN fetch CPU timeout)
    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());

    const pdf = await PDFDocument.create();
    const { cjk: cjkFont, ascii: asciiFont } = await fetchAndEmbedFont(pdf, env as any);
    const fo = { cjk: cjkFont, ascii: asciiFont };

    // Load template PDF
    const templateDoc = await PDFDocument.load(templateBytes);
    const [templatePage] = await pdf.embedPages(templateDoc.getPages().map(p => p));

    // ── Company data ──
    const coName = rget(company, 'name') || '';
    const br = rget(company, 'company_number') || '';
    const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
      'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    const today = new Date();
    const reportDate = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;

    // ── Build shareholder data ──
    interface ShData {
      nameEn: string; nameZh: string; idStr: string; fullName: string;
      addr: string; shareClass: string;
      dateApp: string; dateCea: string;
      sharesHeld: number; certNo: string;
      currency: string; issuePrice: string;
      personNameKey: string; txs: any[];
    }
    const shareholders: ShData[] = [];
    for (const r of roles) {
      const p = personMap.get(r.person_id) || {};
      const nameEn = (rget(p, 'name_english') || rget(p, 'name_chinese') || '(unnamed)').slice(0, 80);
      const nameZh = (rget(p, 'name_chinese') || '').slice(0, 40);
      const idType = rget(p, 'id_type') || 'HKID';
      const idNo = rget(p, 'id_number') || '';
      const idStr = idNo ? `(${idType} No: ${idNo})` : '';
      const fullName = [nameEn, nameZh, idStr].filter(Boolean).join(' ').trim();

      let addr = [
        rget(p, 'addr_flat'), rget(p, 'addr_building'),
        rget(p, 'addr_street'), rget(p, 'addr_district'),
      ].filter(Boolean).join(', ');
      const region = rget(p, 'addr_region') || '';
      if (!addr) addr = (rget(p, 'address') || '').slice(0, 100);
      if (region && !addr.includes(region)) addr = addr ? `${addr}, ${region}` : region;
      addr = addr.slice(0, 100);

      const currency = rget(r, 'currency') || 'HKD';
      const issuePrice = rget(r, 'issue_price') || '1.00';
      const shareClass = `ORD - ${currency}$${issuePrice} ORDINARY FULLY PAID (${currency})`;
      const personNameKey = nameEn.trim().toUpperCase();

      shareholders.push({
        nameEn, nameZh, idStr, fullName,
        addr, shareClass,
        dateApp: rget(r, 'date_appointed') || '-',
        dateCea: rget(r, 'date_ceased') || '',
        sharesHeld: Number(rget(r, 'shares') || 0),
        certNo: rget(r, 'certificate_number') || '-',
        currency, issuePrice,
        personNameKey,
        txs: txByName.get(personNameKey) || [],
      });
    }

    // ── Render page ──
    let page = pdf.addPage([PW, PH]);
    page.drawPage(templatePage);  // background
    let pageNum = 1;
    let shIdx = 0;
    const allPages = [page];  // track all pages for footer numbering

    function newPage() {
      page = pdf.addPage([PW, PH]);
      page.drawPage(templatePage);
      pageNum++;
      allPages.push(page);
    }

    // Cover markers & draw company info
    drawOverlay(page, POSITIONS.co_name, coName, fo);
    drawOverlay(page, POSITIONS.co_br, br, fo);
    drawOverlay(page, POSITIONS.report_date, reportDate, fo);

    // ── Render shareholders (up to 2 per page from template) ──
    while (shIdx < shareholders.length) {
      const sh = shareholders[shIdx];
      const posOnPage = shIdx % 2;  // 0 = SH1 positions, 1 = SH2 positions
      const prefix = posOnPage === 0 ? "sh1" : "sh2";

      // Cover & draw name/addr/security
      drawOverlay(page, POSITIONS[`${prefix}_name`], sh.fullName, fo);
      drawOverlay(page, POSITIONS[`${prefix}_addr`], sh.addr, fo);
      drawOverlay(page, POSITIONS[`${prefix}_security`], sh.shareClass, fo);

      // Cover transaction data markers + Date/Ceased area with white
      const dataYs = posOnPage === 0 ? SH1_DATA_Y : SH2_DATA_Y;
      const coverX0 = 25;
      const coverX1 = 820;
      for (const dy of dataYs) {
        page.drawRectangle({
          x: coverX0, y: dy - 11, width: coverX1 - coverX0, height: 14, color: WHITE,
        });
      }

      // Draw transaction data
      // Row layout: [0]=Subscription, [1..N-1]=Transaction rows, [N]=Distinctive (LAST)
      const initBalance = sh.sharesHeld;
      const lastRowIdx = dataYs.length - 1;  // distinctive goes on last row

      // Row 0: Subscription / initial holding
      const row0y = dataYs[0];
      drawCell(page, sh.dateApp, TX_COL_X.date, row0y, FS.table, fo);
      drawCell(page, initBalance > 0 ? 'Subscription' : '-', TX_COL_X.type, row0y, FS.table, fo);
      drawCell(page, initBalance > 0 ? String(initBalance) : '-', TX_COL_X.units, row0y, FS.table, fo, "R");
      drawCell(page, initBalance > 0 ? `${sh.currency}$${sh.issuePrice}` : '-', TX_COL_X.par, row0y, FS.table, fo);
      drawCell(page, initBalance > 0 ? `${sh.currency}$${sh.issuePrice}` : '-', TX_COL_X.paidup, row0y, FS.table, fo);
      drawCell(page, String(sh.certNo), TX_COL_X.cert, row0y, FS.table, fo);
      drawCell(page, String(initBalance), TX_COL_X.balance, row0y, FS.table, fo, "R");

      // Transaction rows (use rows 1 to lastRowIdx-1, leave last row for distinctive)
      let balance = initBalance;
      for (let ti = 0; ti < sh.txs.length; ti++) {
        const txRowIdx = ti + 1;  // row 1, 2, ...
        if (txRowIdx >= lastRowIdx) break;  // stop before distinctive row
        const rowY = dataYs[txRowIdx];
        if (rowY === undefined) break;

        const tx = sh.txs[ti];
        const txShares = Number(rget(tx, 'shares') || 0);
        const txDate = rget(tx, 'transaction_date') || '-';
        const txInst = rget(tx, 'instrument_number') || '-';
        const txCert = rget(tx, 'certificate_number') || sh.certNo;
        const txPrice = rget(tx, 'price_per_share') || sh.issuePrice;
        const txCurrency = rget(tx, 'currency') || sh.currency;

        const isIn = (rget(tx, 'to_name') || '').trim().toUpperCase() === sh.personNameKey;
        const isOut = (rget(tx, 'from_name') || '').trim().toUpperCase() === sh.personNameKey;

        let txType: string, counterparty: string;
        if (isIn) { balance += txShares; txType = 'Transfer In'; counterparty = rget(tx, 'from_name') || ''; }
        else if (isOut) { balance -= txShares; txType = 'Transfer Out'; counterparty = rget(tx, 'to_name') || ''; }
        else { balance += txShares; txType = 'Allotment'; counterparty = ''; }

        drawCell(page, txDate, TX_COL_X.date, rowY, FS.table, fo);
        drawCell(page, txType, TX_COL_X.type, rowY, FS.table, fo);
        drawCell(page, String(txShares), TX_COL_X.units, rowY, FS.table, fo, "R");
        drawCell(page, `${txCurrency}$${txPrice}`, TX_COL_X.par, rowY, FS.table, fo);
        drawCell(page, `${txCurrency}$${txPrice}`, TX_COL_X.paidup, rowY, FS.table, fo);
        drawCell(page, String(txCert), TX_COL_X.cert, rowY, FS.table, fo);
        drawCell(page, String(balance), TX_COL_X.balance, rowY, FS.table, fo, "R");
        drawCell(page, counterparty, TX_COL_X.transfer, rowY, FS.table, fo);
        drawCell(page, txInst, TX_COL_X.distinct, rowY, FS.table, fo);
      }

      // Distinctive numbers — ALWAYS on the LAST data row
      if (dataYs.length > 1) {
        const distY = dataYs[lastRowIdx];
        page.drawRectangle({
          x: TX_COL_X.distinct - 5, y: distY - 11, width: 130, height: 14, color: WHITE,
        });
        drawCell(page, `(${balance})`, TX_COL_X.distinct, distY, FS.table, fo);
      }

      shIdx++;
      // If more shareholders and current page is full (2 per page), add new page
      if (shIdx < shareholders.length && shIdx % 2 === 0) {
        newPage();
        // Redraw company overlay on new page
        drawOverlay(page, POSITIONS.co_name, coName, fo);
        drawOverlay(page, POSITIONS.co_br, br, fo);
        drawOverlay(page, POSITIONS.report_date, reportDate, fo);
      }
    }

    // ── Cover unused SH2 on last page if odd number of shareholders ──
    if (shareholders.length % 2 === 1) {
      // Cover SH2 name/addr/security markers
      const sh2CoverW = 500, sh2CoverH = 16;
      page.drawRectangle({
        x: 90, y: POSITIONS.sh2_name.y - 14, width: sh2CoverW, height: sh2CoverH, color: WHITE,
      });
      page.drawRectangle({
        x: 90, y: POSITIONS.sh2_addr.y - 14, width: sh2CoverW, height: sh2CoverH, color: WHITE,
      });
      page.drawRectangle({
        x: 90, y: POSITIONS.sh2_security.y - 14, width: sh2CoverW, height: sh2CoverH, color: WHITE,
      });
      // Cover SH2 transaction data area
      for (const dy of SH2_DATA_Y) {
        page.drawRectangle({
          x: 25, y: dy - 12, width: 795, height: 15, color: WHITE,
        });
      }
    }

    // ── Footer page numbers ──
    // Template has "- 1 -" at bottom center (~y=25 in pdf-lib coords).
    // Cover and redraw for ALL pages.
    const FOOTER_Y = 23;  // pdf-lib y (baseline)
    const FOOTER_SIZE = 8;
    for (let pi = 0; pi < allPages.length; pi++) {
      const pg = allPages[pi];
      // Cover template "- 1 -" (centered, ~100pt wide, near bottom)
      pg.drawRectangle({
        x: 360, y: FOOTER_Y - FOOTER_SIZE, width: 120, height: FOOTER_SIZE + 4, color: WHITE,
      });
      drawMixed(pg, `- ${pi + 1} -`, {
        x: 400, y: FOOTER_Y, size: FOOTER_SIZE,
        cjk: fo.cjk, ascii: fo.ascii,
      });
    }

    const bytes = await pdf.save();
    return new Response(JSON.stringify({ pdf: uint8ToBase64(new Uint8Array(bytes)) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-shareholders-register-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
