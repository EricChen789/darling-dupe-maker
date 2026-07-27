// POST /api/generate-shareholders-register-pdf
// Register of Members (ROM) — Paul Tang free-form layout
// Landscape A4, per-shareholder blocks with transaction sub-table
// Mirrors local Flask server.py RTF/DOCX Paul Tang format
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

// Landscape A4
const PW = 842, PH = 595;
const M = 28;
const CW = PW - M * 2;

// Paul Tang RTF colours
const BLUE = rgb(0, 51 / 255, 153 / 255);  // #003399
const GREY_HDR = rgb(227 / 255, 227 / 255, 227 / 255);
const BLACK = rgb(0, 0, 0);
const LINE_GREY = rgb(0.71, 0.71, 0.71);

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

function drawMixed(page: any, text: string, opts: {
  x: number; y: number; size: number; cjk: any; ascii: any;
  color?: any; bold?: boolean;
}) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  let x = opts.x;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    if (opts.bold) {
      page.drawText(s.text, { x: x + 0.5, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    }
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function drawMixedRight(page: any, text: string, opts: {
  x: number; y: number; size: number; cjk: any; ascii: any;
  color?: any; bold?: boolean;
}) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  let totalW = 0;
  for (const s of segs) totalW += (s.useCjk ? opts.cjk : opts.ascii).widthOfTextAtSize(s.text, opts.size);
  let x = opts.x - totalW;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    if (opts.bold) {
      page.drawText(s.text, { x: x + 0.5, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    }
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
    if (widthOfText(para, cjk, ascii, fontSize) <= maxWidth) { lines.push(para); continue; }
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

function hline(page: any, x1: number, x2: number, y: number, thickness = 0.3, color = BLACK) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color, thickness });
}

function vline(page: any, x: number, y1: number, y2: number, thickness = 0.2, color = BLACK) {
  page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, color, thickness });
}

// ── Compact currency display (matching local) ──
const COMPACT_CCY: Record<string, string> = {
  HKD: 'HK$', USD: 'US$', CNY: '\xa5', RMB: '\xa5',
  GBP: '\xa3', EUR: '€', JPY: '\xa5',
  AUD: 'A$', SGD: 'S$', CAD: 'C$', TWD: 'NT$',
};
function compactCurrency(ccy: string): string {
  return COMPACT_CCY[ccy?.toUpperCase()] || (ccy?.length >= 2 ? ccy.slice(0, 2) + '$' : (ccy || '') + '$');
}

// ══════════════════════════════════════════════════════════════
//  Main handler
// ══════════════════════════════════════════════════════════════
export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { companyId } = await request.json() as any;
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [company, rolesResult, txResult, fontResp] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare(
        "SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'shareholder'"
      ).bind(companyId).all(),
      env.DB.prepare(
        "SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date"
      ).bind(companyId).all(),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    if (!company) throw new Error("Company not found");
    if (!fontResp.ok) throw new Error("Failed to load Chinese font");

    const roles = (rolesResult.results || []) as any[];
    const transactions = (txResult.results || []) as any[];

    // Map persons
    const personIds = roles.map((r: any) => r.person_id).filter(Boolean);
    let personMap = new Map<string, any>();
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

    // Load font
    const fontBytes = await fontResp.arrayBuffer();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const cjkFont = await pdf.embedFont(fontBytes);
    const asciiFont = await pdf.embedFont(StandardFonts.Helvetica);
    const f = { cjk: cjkFont, ascii: asciiFont };

    // ── Company data ──
    const coName = rget(company, 'name') || '';
    const br = rget(company, 'company_number') || '';
    const today = new Date();
    const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
      'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    const reportDate = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;

    // ── Render ──
    let page = pdf.addPage([PW, PH]);
    let pageNum = 1;

    // Continuation page helper
    function newPage(): void {
      page = pdf.addPage([PW, PH]);
      pageNum++;
      // Continuation header
      drawMixed(page, coName, { x: PW / 2, y: PH - 35, size: 12, cjk: f.cjk, ascii: f.ascii, bold: true, color: BLUE });
      drawMixedRight(page, "REGISTER OF MEMBERS (Cont'd)", {
        x: PW - M, y: PH - 35, size: 13, cjk: f.cjk, ascii: f.ascii, bold: true, color: BLUE,
      });
      hline(page, M, PW - M, PH - 52, 1.0, BLUE);
    }

    // ── Page 1 Header ──
    let y = PH - 35;
    // Company name — blue bold left
    drawMixed(page, coName, { x: M, y, size: 12, cjk: f.cjk, ascii: f.ascii, bold: true, color: BLUE });
    y -= 18;
    // Company Number + Quorum — blue
    const quorum = roles.length || 1;
    drawMixed(page, `Company Number: ${br}`, { x: M, y, size: 9, cjk: f.cjk, ascii: f.ascii, color: BLUE });
    drawMixedRight(page, `Quorum:  ${quorum}`, { x: PW - M, y, size: 8, cjk: f.cjk, ascii: f.ascii, color: BLUE });
    // Title — right-aligned blue bold
    drawMixedRight(page, `REGISTER OF MEMBERS AT ${reportDate}`, {
      x: PW - M, y: PH - 35, size: 13, cjk: f.cjk, ascii: f.ascii, bold: true, color: BLUE,
    });
    y -= 16;
    // Thick separator
    hline(page, M, PW - M, y, 1.5, BLUE);
    y -= 12;

    // ── Render each shareholder ──
    for (let si = 0; si < roles.length; si++) {
      const r = roles[si];
      const p = personMap.get(r.person_id) || {};

      const nameEn = (rget(p, 'name_english') || rget(p, 'name_chinese') || '(unnamed)').slice(0, 80);
      const nameCh = (rget(p, 'name_chinese') || '').slice(0, 40);
      const idType = rget(p, 'id_type') || 'HKID';
      const idNo = rget(p, 'id_number') || '';
      const idStr = idNo ? `(${idType} No: ${idNo})` : '';
      const fullNameLine = [nameEn, nameCh, idStr].filter(Boolean).join(' ').trim();

      // Address
      let addr = [
        rget(p, 'addr_flat'), rget(p, 'addr_building'),
        rget(p, 'addr_street'), rget(p, 'addr_district'),
      ].filter(Boolean).join(', ');
      const region = rget(p, 'addr_region') || '';
      if (!addr) addr = (rget(p, 'address') || '').slice(0, 100);
      if (region && !addr.includes(region)) addr = addr ? `${addr}, ${region}` : region;
      addr = addr.slice(0, 100);

      const dateApp = rget(r, 'date_appointed') || '-';
      const dateCea = rget(r, 'date_ceased') || '';
      const sharesHeld = Number(rget(r, 'shares') || 0);
      const certNo = rget(r, 'certificate_number') || '-';
      const currency = rget(r, 'currency') || 'HKD';
      const issuePrice = rget(r, 'issue_price') || '1.00';
      const ccyCompact = compactCurrency(currency);
      const shareClass = `ORD - ${currency}$${issuePrice} ORDINARY FULLY PAID (${currency})`;

      const personNameKey = nameEn.trim().toUpperCase();
      const personTxs = txByName.get(personNameKey) || [];

      // Check if we need a page break (~200pt needed for a shareholder block)
      if (y < 200) {
        newPage();
        y = PH - 70;
      }

      // ── Name row ──
      const labelSize = 9;
      const labelW = 70; // width for "Name:", "Address:", "Security:" labels

      drawMixed(page, "Name:", { x: M, y, size: labelSize, cjk: f.cjk, ascii: f.ascii, bold: true, color: BLUE });
      drawMixed(page, fullNameLine, { x: M + labelW, y, size: labelSize, cjk: f.cjk, ascii: f.ascii, bold: true, color: BLUE });
      y -= 16;

      // ── Address row ──
      drawMixed(page, "Address:", { x: M, y, size: labelSize, cjk: f.cjk, ascii: f.ascii, color: BLUE });
      drawMixed(page, addr, { x: M + labelW, y, size: labelSize, cjk: f.cjk, ascii: f.ascii, color: BLUE });
      y -= 16;

      // Separator
      hline(page, M, PW - M, y + 6, 1.0, BLUE);
      y -= 6;

      // ── Security row (with Date / Date Ceased on right) ──
      drawMixed(page, "Security:", { x: M, y, size: labelSize, cjk: f.cjk, ascii: f.ascii, bold: true, color: BLUE });
      drawMixed(page, shareClass, { x: M + labelW, y, size: labelSize, cjk: f.cjk, ascii: f.ascii, bold: true, color: BLUE });
      // Date on right
      drawMixedRight(page, `Date: ${dateApp}`, {
        x: PW - M - 100, y, size: labelSize, cjk: f.cjk, ascii: f.ascii, color: BLUE,
      });
      y -= 14;
      if (dateCea && dateCea !== '-') {
        drawMixedRight(page, `Date Ceased: ${dateCea}`, {
          x: PW - M - 100, y, size: labelSize, cjk: f.cjk, ascii: f.ascii, color: BLUE,
        });
        y -= 14;
      }
      y -= 4;

      // ── Transaction sub-table ──
      const txCols = [
        { label: "Date Entered\n/ Ceased", w: 78 },
        { label: "Transaction\nType", w: 72 },
        { label: "Units", w: 62 },
        { label: "Par Value\nPer Share", w: 72 },
        { label: "Paid Up Value\nPer Share", w: 72 },
        { label: "Certificate\nNo", w: 56 },
        { label: "Balance", w: 62 },
        { label: "Transferred To/From,\nRedeemed, Reissued", w: 120 },
        { label: "Distinctive\nNumbers", w: 70 },
      ];
      const txTotalW = txCols.reduce((s, c) => s + c.w, 0);
      const txX0 = M + (CW - txTotalW) / 2; // center the sub-table
      const txX: number[] = [txX0];
      for (let i = 0; i < txCols.length - 1; i++) txX.push(txX[i] + txCols[i].w);

      const txHdrSize = 7;
      const txDataSize = 7;
      const txRowH = 18;

      // Grey header
      const hdrY0 = y;
      for (let ci = 0; ci < txCols.length; ci++) {
        const lines = txCols[ci].label.split('\n');
        for (let li = 0; li < lines.length; li++) {
          drawMixed(page, lines[li], {
            x: txX[ci] + 1, y: y - 2 - li * 9, size: txHdrSize,
            cjk: f.cjk, ascii: f.ascii, bold: true,
          });
        }
      }
      // Draw grey header background (using a filled rectangle behind text)
      page.drawRectangle({
        x: txX0 - 1, y: y - 26, width: txTotalW + 2, height: 26,
        color: GREY_HDR,
      });
      // Redraw header text on top of grey background
      for (let ci = 0; ci < txCols.length; ci++) {
        const lines = txCols[ci].label.split('\n');
        for (let li = 0; li < lines.length; li++) {
          drawMixed(page, lines[li], {
            x: txX[ci] + 1, y: y - 2 - li * 9, size: txHdrSize,
            cjk: f.cjk, ascii: f.ascii, bold: true,
          });
        }
      }
      // Header bottom line
      const hdrH = 26;
      hline(page, txX0, txX0 + txTotalW, y - hdrH, 0.5);
      y -= hdrH;

      // Initial subscription/allotment row
      const initBalance = sharesHeld;
      const initRow = [
        dateApp,
        initBalance > 0 ? 'Subscription' : '-',
        initBalance > 0 ? String(initBalance) : '-',
        initBalance > 0 ? `${ccyCompact}${issuePrice}` : '-',
        initBalance > 0 ? `${ccyCompact}${issuePrice}` : '-',
        String(certNo),
        String(initBalance),
        '', '',
      ];
      for (let ci = 0; ci < initRow.length && ci < txCols.length; ci++) {
        if (initRow[ci]) {
          drawMixed(page, String(initRow[ci]).slice(0, 40), {
            x: txX[ci] + 1, y: y - 2, size: txDataSize, cjk: f.cjk, ascii: f.ascii,
          });
        }
      }
      y -= txRowH;

      // Transaction rows
      let balance = initBalance;
      for (const tx of personTxs) {
        if (y < 60) {
          newPage();
          y = PH - 70;
          // Redraw sub-table header on new page
          for (let ci = 0; ci < txCols.length; ci++) {
            const lines = txCols[ci].label.split('\n');
            for (let li = 0; li < lines.length; li++) {
              drawMixed(page, lines[li], {
                x: txX[ci] + 1, y: y - 2 - li * 9, size: txHdrSize,
                cjk: f.cjk, ascii: f.ascii, bold: true,
              });
            }
          }
          page.drawRectangle({
            x: txX0 - 1, y: y - 26, width: txTotalW + 2, height: 26,
            color: GREY_HDR,
          });
          for (let ci = 0; ci < txCols.length; ci++) {
            const lines = txCols[ci].label.split('\n');
            for (let li = 0; li < lines.length; li++) {
              drawMixed(page, lines[li], {
                x: txX[ci] + 1, y: y - 2 - li * 9, size: txHdrSize,
                cjk: f.cjk, ascii: f.ascii, bold: true,
              });
            }
          }
          hline(page, txX0, txX0 + txTotalW, y - 26, 0.5);
          y -= 26;
        }

        const txShares = Number(rget(tx, 'shares') || 0);
        const txDate = rget(tx, 'transaction_date') || '-';
        const txInst = rget(tx, 'instrument_number') || '-';
        const txCert = rget(tx, 'certificate_number') || certNo;
        const txPrice = rget(tx, 'price_per_share') || issuePrice;
        const txCcy = rget(tx, 'currency') || currency;
        const txCcyCompact = compactCurrency(txCcy);

        const isIn = (rget(tx, 'to_name') || '').trim().toUpperCase() === personNameKey;
        const isOut = (rget(tx, 'from_name') || '').trim().toUpperCase() === personNameKey;

        let txType: string, counterparty: string;
        if (isIn) {
          balance += txShares;
          txType = 'Transfer In';
          counterparty = rget(tx, 'from_name') || '';
        } else if (isOut) {
          balance -= txShares;
          txType = 'Transfer Out';
          counterparty = rget(tx, 'to_name') || '';
        } else {
          balance += txShares;
          txType = 'Allotment';
          counterparty = '';
        }

        const txRow = [
          txDate, txType, String(txShares),
          `${txCcyCompact}${txPrice}`, `${txCcyCompact}${txPrice}`,
          String(txCert), String(balance), counterparty, txInst,
        ];
        for (let ci = 0; ci < txRow.length && ci < txCols.length; ci++) {
          if (txRow[ci]) {
            drawMixed(page, String(txRow[ci]).slice(0, 40), {
              x: txX[ci] + 1, y: y - 2, size: txDataSize, cjk: f.cjk, ascii: f.ascii,
            });
          }
        }
        y -= txRowH;
      }

      // Sub-table bottom border
      hline(page, txX0, txX0 + txTotalW, y, 0.5);

      // Vertical borders for sub-table
      vline(page, txX0, y, hdrY0, 0.5);
      vline(page, txX0 + txTotalW, y, hdrY0, 0.5);

      // Spacer between shareholders
      y -= 14;
    }

    // ── Footer ──
    if (y < 40) {
      newPage();
      y = PH - 70;
    }
    y -= 10;
    drawMixed(page, `- ${pageNum} -`, {
      x: PW / 2, y, size: 8, cjk: f.cjk, ascii: f.ascii,
    });

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
