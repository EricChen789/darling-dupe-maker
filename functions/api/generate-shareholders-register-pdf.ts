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

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Portrait A4 — Paul Tang reference format
const PAGE_W = 595;
const PAGE_H = 842;
const M = 28;  // margin
const CW = PAGE_W - M * 2;  // content width ≈ 539pt

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
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  let x = opts.x;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function drawMixedCenter(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; color?: any }) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
  const segs = segmentText(clean);
  let totalW = 0;
  for (const s of segs) {
    totalW += (s.useCjk ? opts.cjk : opts.ascii).widthOfTextAtSize(s.text, opts.size);
  }
  let x = opts.x - totalW / 2;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    page.drawText(s.text, { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
    x += font.widthOfTextAtSize(s.text, opts.size);
  }
}

function drawMixedRight(page: any, text: string, opts: { x: number; y: number; size: number; cjk: any; ascii: any; color?: any }) {
  const clean = (text || "").replace(/[\n\r\t]/g, ' ');
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
  for (const s of segmentText(text || "")) w += (s.useCjk ? cjk : ascii).widthOfTextAtSize(s.text, size);
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

// ── Number formatting ──
function fmtNum(val: any, dflt: string = "0"): string {
  if (val === null || val === undefined || val === "") return dflt;
  const n = Number(val);
  if (isNaN(n)) return dflt;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function rget(row: any, key: string, dflt: any = null): any {
  const v = row ? row[key] : undefined;
  return v !== null && v !== undefined ? v : dflt;
}

// ── Draw horizontal line ──
function hline(page: any, x1: number, x2: number, y: number, thickness: number = 0.3, color: any = rgb(0, 0, 0)) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color, thickness });
}

// ── Draw vertical line ──
function vline(page: any, x: number, y1: number, y2: number, thickness: number = 0.2, color: any = rgb(0.6, 0.6, 0.6)) {
  page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, color, thickness });
}

// ── Paul Tang page header for continuation pages ──
function drawContHeader(page: any, f: { cjk: any; ascii: any }, coName: string, br: string): number {
  let y = PAGE_H - 35;
  drawMixedCenter(page, coName, { x: PAGE_W / 2, y, size: 12, cjk: f.cjk, ascii: f.ascii });
  y -= 18;
  drawMixedCenter(page, `Company Number: ${br}`, { x: PAGE_W / 2, y, size: 9, cjk: f.cjk, ascii: f.ascii });
  drawMixedRight(page, "REGISTER OF MEMBERS (Cont'd)", { x: PAGE_W - M, y: PAGE_H - 35, size: 13, cjk: f.cjk, ascii: f.ascii });
  y -= 14;
  hline(page, M, PAGE_W - M, y, 0.4);
  return y;
}

// ── Draw simplified table headers for continuation pages ──
function drawContTableHeaders(page: any, f: { cjk: any; ascii: any }, col_x: number[], col_w: number[],
  sacq_cx: number, strf_cx: number): { y: number; table_top_y: number } {
  const hdr_size = 6.5;
  const row_h1 = 26;
  const row_h2 = 22;
  let y = drawContHeader(page, f, "", ""); // header drawn by caller
  // Actually, drawContHeader already draws company info. Let me redesign.

  // This function draws just the column headers below the page header.
  // We need y passed in. Let me restructure.

  return { y: 0, table_top_y: 0 }; // Placeholder - will inline
}

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
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'shareholder'").bind(companyId).all(),
      env.DB.prepare("SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date").bind(companyId).all(),
      fetch(CHINESE_FONT_URL, { headers: { Accept: "*/*" } }),
    ]);

    if (!company) throw new Error("Company not found");
    if (!fontResp.ok) throw new Error("Failed to load Chinese font");

    const roles = (rolesResult.results || []) as any[];
    const transactions = (txResult.results || []) as any[];
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

    // Map transactions by person name
    const txByName = new Map<string, any[]>();
    for (const t of transactions) {
      const key = (rget(t, 'from_name') || rget(t, 'to_name') || "").trim().toUpperCase();
      if (key) {
        if (!txByName.has(key)) txByName.set(key, []);
        txByName.get(key)!.push(t);
      }
    }

    const fontBytes = await fontResp.arrayBuffer();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const cjkFont = await pdf.embedFont(fontBytes);
    const asciiFont = await pdf.embedFont(StandardFonts.Helvetica);
    const f = { cjk: cjkFont, ascii: asciiFont };

    const coName = rget(company, 'name') || '';
    const br = rget(company, 'company_number') || '';

    // ── 18-column layout (Paul Tang reference) ──
    const col_w = [
      54, 60, 37, 37, 40, 40,  // Full Name, Address, Occupation, Merchant, Date Entered, Date Ceasing
      28, 46, 28, 30, 30,       // Shares Acquired: Cert No, Distinctive Nos, No. of Shares, Consideration, Transfer Deed No
      28, 46, 28, 30,           // Shares Transferred: Cert No, Distinctive Nos, No. of Shares, Consideration
      30, 32, 32,               // Total Shares Held, Remarks, Entry Made By
    ];
    const col_x: number[] = [M];
    for (let i = 0; i < col_w.length - 1; i++) {
      col_x.push(col_x[i] + col_w[i]);
    }
    // Centers for merged headers
    const sacq_x1 = col_x[6];
    const sacq_x2 = col_x[10] + col_w[10];
    const sacq_cx = (sacq_x1 + sacq_x2) / 2;
    const strf_x1 = col_x[11];
    const strf_x2 = col_x[14] + col_w[14];
    const strf_cx = (strf_x1 + strf_x2) / 2;

    const hdr_size = 6.5;
    const row_h1 = 26;
    const row_h2 = 22;
    const data_size = 6.5;
    const data_row_h = 16;

    // Helper: draw full table headers (row 1 + row 2)
    const drawFullHeaders = (startY: number): { y: number; table_top_y: number } => {
      const table_top_y = startY;
      let y = startY;

      // Row 1: Main headers
      const hdr1: [string, number][] = [
        ["Full\nName", 0], ["Address", 1], ["Occupation", 2], ["Merchant", 3],
        ["Date Entered\nas Member", 4], ["Date Ceasing\nto be Member", 5],
      ];
      for (const [label, ci] of hdr1) {
        drawMixed(page, label, { x: col_x[ci] + 1, y: y + 1, size: hdr_size, cjk: f.cjk, ascii: f.ascii });
      }
      drawMixedCenter(page, "Shares Acquired", { x: sacq_cx, y: y + 1, size: hdr_size, cjk: f.cjk, ascii: f.ascii });
      drawMixedCenter(page, "Shares Transferred", { x: strf_cx, y: y + 1, size: hdr_size, cjk: f.cjk, ascii: f.ascii });
      for (const [label, ci] of [["Total\nShares Held", 15], ["Remarks", 16], ["Entry\nMade By", 17]] as [string, number][]) {
        drawMixed(page, label, { x: col_x[ci] + 1, y: y + 1, size: hdr_size, cjk: f.cjk, ascii: f.ascii });
      }

      y -= row_h1;
      hline(page, M, PAGE_W - M, y, 0.3);

      // Vertical separators for header row 1
      for (const ci of [0, 1, 2, 3, 4, 5, 6, 11, 15, 16, 17]) {
        vline(page, col_x[ci], y, table_top_y, 0.2);
      }
      vline(page, col_x[10] + col_w[10], y, table_top_y, 0.2);
      vline(page, col_x[14] + col_w[14], y, table_top_y, 0.2);

      // Row 2: Sub-headers
      const hdr_y1 = y;
      const sub_labels: [string, number][] = [
        ["Cert\nNo", 6], ["Distinctive Nos.\n(From-To)", 7],
        ["No. of\nShares", 8], ["Consideration\nPaid", 9], ["Transfer\nDeed No", 10],
        ["Cert\nNo", 11], ["Distinctive Nos.\n(From-To)", 12],
        ["No. of\nShares", 13], ["Consideration\nPaid", 14],
      ];
      for (const [label, ci] of sub_labels) {
        drawMixed(page, label, { x: col_x[ci] + 1, y: y + 1, size: 6, cjk: f.cjk, ascii: f.ascii });
      }
      y -= row_h2;
      hline(page, M, PAGE_W - M, y, 0.4);

      return { y, table_top_y };
    };

    // Helper: draw simplified continuation page headers
    const drawContHeaders = (): { y: number; table_top_y: number } => {
      let y = PAGE_H - 35;
      drawMixedCenter(page, coName, { x: PAGE_W / 2, y, size: 12, cjk: f.cjk, ascii: f.ascii });
      y -= 18;
      drawMixedCenter(page, `Company Number: ${br}`, { x: PAGE_W / 2, y, size: 9, cjk: f.cjk, ascii: f.ascii });
      drawMixedRight(page, "REGISTER OF MEMBERS (Cont'd)", { x: PAGE_W - M, y: PAGE_H - 35, size: 13, cjk: f.cjk, ascii: f.ascii });
      y -= 14;
      hline(page, M, PAGE_W - M, y, 0.4);
      y -= 8;

      const table_top_y = y;
      const hdr1: [string, number][] = [
        ["Full Name", 0], ["Address", 1], ["Occupation", 2], ["Merchant", 3],
        ["Date Entered as Member", 4], ["Date Ceasing to be Member", 5],
      ];
      for (const [label, ci] of hdr1) {
        drawMixed(page, label, { x: col_x[ci] + 1, y: y + 1, size: hdr_size, cjk: f.cjk, ascii: f.ascii });
      }
      drawMixedCenter(page, "Shares Acquired", { x: sacq_cx, y: y + 1, size: hdr_size, cjk: f.cjk, ascii: f.ascii });
      drawMixedCenter(page, "Shares Transferred", { x: strf_cx, y: y + 1, size: hdr_size, cjk: f.cjk, ascii: f.ascii });
      for (const [label, ci] of [["Total Shares Held", 15], ["Remarks", 16], ["Entry Made By", 17]] as [string, number][]) {
        drawMixed(page, label, { x: col_x[ci] + 1, y: y + 1, size: hdr_size, cjk: f.cjk, ascii: f.ascii });
      }
      y -= row_h1;
      hline(page, M, PAGE_W - M, y, 0.3);

      const sub_labels: [string, number][] = [
        ["Cert No", 6], ["Distinctive Nos.", 7], ["No. of Shares", 8], ["Consideration Paid", 9], ["Transfer Deed No", 10],
        ["Cert No", 11], ["Distinctive Nos.", 12], ["No. of Shares", 13], ["Consideration Paid", 14],
      ];
      for (const [label, ci] of sub_labels) {
        drawMixed(page, label, { x: col_x[ci] + 1, y: y + 1, size: 6, cjk: f.cjk, ascii: f.ascii });
      }
      y -= row_h2;
      hline(page, M, PAGE_W - M, y, 0.4);

      return { y, table_top_y };
    };

    // ── Build PDF ──
    let page = pdf.addPage([PAGE_W, PAGE_H]);

    // Page header
    let y = PAGE_H - 35;
    drawMixedCenter(page, coName, { x: PAGE_W / 2, y, size: 12, cjk: f.cjk, ascii: f.ascii });
    y -= 18;
    drawMixedCenter(page, `Company Number: ${br}`, { x: PAGE_W / 2, y, size: 9, cjk: f.cjk, ascii: f.ascii });
    y -= 2;
    drawMixedRight(page, "REGISTER OF MEMBERS", { x: PAGE_W - M, y: PAGE_H - 35, size: 13, cjk: f.cjk, ascii: f.ascii });
    y -= 14;
    hline(page, M, PAGE_W - M, y, 0.4);
    y -= 8;

    let { y: curY, table_top_y } = drawFullHeaders(y);
    y = curY;
    let table_bottom_y = y;

    if (roles.length === 0) {
      drawMixed(page, "(No shareholders / 尚無股東記錄)", {
        x: M + 3, y: y + 8, size: 9, cjk: f.cjk, ascii: f.ascii, color: rgb(0.5, 0.5, 0.5),
      });
      y -= 24;
    } else {
      for (const r of roles) {
        const p = personMap.get(r.person_id) || {};
        const nameEn = rget(p, 'name_english') || rget(p, 'name_chinese') || '(unnamed)';
        const isNat = rget(p, 'identity') !== 'corporate';
        const addr = rget(p, 'address') || '';
        const occupation = rget(p, 'occupation') || '';
        const merchant = rget(p, 'merchant') || '';
        const dateApp = rget(r, 'date_appointed') || '-';
        const dateCea = rget(r, 'date_ceased') || '';
        const shareType = rget(r, 'share_type') || 'ORD';
        const currency = rget(r, 'currency') || 'HKD';
        const issuePrice = rget(r, 'issue_price') || '1.00';
        const shares = rget(r, 'shares', 0);
        const certNo = rget(r, 'certificate_number') || '-';
        const personNameKey = nameEn.trim().toUpperCase();
        const personTxs = txByName.get(personNameKey) || [];

        // Page break if needed
        if (y - 80 < 50) {
          page = pdf.addPage([PAGE_W, PAGE_H]);
          const h = drawContHeaders();
          y = h.y;
          table_top_y = h.table_top_y;
        }

        if (personTxs.length === 0) {
          // Single row
          const rowData = [
            nameEn, addr, occupation, merchant, dateApp, dateCea,
            certNo, '-', String(shares), `${currency}$${issuePrice}`, '-',
            '-', '-', '-', '-',
            String(shares), '', '',
          ];
          for (let i = 0; i < rowData.length; i++) {
            drawMixed(page, String(rowData[i]).slice(0, 30), {
              x: col_x[i] + 1, y: y + 1, size: data_size, cjk: f.cjk, ascii: f.ascii,
            });
          }
          y -= data_row_h;
        } else {
          let runningBalance = 0;
          for (let ti = 0; ti < personTxs.length; ti++) {
            if (y - data_row_h < 50) {
              page = pdf.addPage([PAGE_W, PAGE_H]);
              const h = drawContHeaders();
              y = h.y;
              table_top_y = h.table_top_y;
            }

            const tx = personTxs[ti];
            const txType = rget(tx, 'transaction_type') || 'Transfer';
            const txDate = rget(tx, 'transaction_date') || '-';
            const txShares = Number(rget(tx, 'shares', 0));
            const txPrice = rget(tx, 'price_per_share') || issuePrice;
            const txCurrency = rget(tx, 'currency') || currency;
            const txFrom = rget(tx, 'from_name') || '';
            const txTo = rget(tx, 'to_name') || '';
            const txInst = rget(tx, 'instrument_number') || '-';
            const txCert = rget(tx, 'certificate_number') || certNo;

            const isIn = txTo.trim().toUpperCase() === personNameKey;
            const isOut = txFrom.trim().toUpperCase() === personNameKey;
            if (isIn) runningBalance = txShares;
            else if (isOut) runningBalance = -txShares;
            else runningBalance = txShares;

            if (ti === 0) {
              const firstRow = [
                nameEn, addr, occupation, merchant, dateApp, dateCea,
                txCert, txInst, String(txShares), `${txCurrency}$${txPrice}`, txInst,
                '-', '-', '-', '-',
                String(runningBalance), '', '',
              ];
              for (let i = 0; i < firstRow.length; i++) {
                drawMixed(page, String(firstRow[i]).slice(0, 30), {
                  x: col_x[i] + 1, y: y + 1, size: data_size, cjk: f.cjk, ascii: f.ascii,
                });
              }
            } else {
              // Subsequent tx rows
              const isIn2 = txTo.trim().toUpperCase() === personNameKey;
              const isOut2 = txFrom.trim().toUpperCase() === personNameKey;
              if (isIn2) runningBalance += txShares;
              else if (isOut2) runningBalance -= txShares;
              else runningBalance += txShares;

              const txRow = [
                '', '', '', '', txDate, '',
                txCert, txInst, String(txShares), `${txCurrency}$${txPrice}`, txInst,
                '-', '-', '-', '-',
                String(runningBalance), '', '',
              ];
              for (let i = 0; i < txRow.length; i++) {
                if (txRow[i]) {
                  drawMixed(page, String(txRow[i]).slice(0, 30), {
                    x: col_x[i] + 1, y: y + 1, size: data_size, cjk: f.cjk, ascii: f.ascii,
                  });
                }
              }
            }
            y -= data_row_h;
          }
        }

        // Row separator
        hline(page, M, PAGE_W - M, y, 0.2, rgb(0.71, 0.71, 0.71));
        table_bottom_y = y;
      }
    }

    // Draw outer table border
    hline(page, M, PAGE_W - M, table_top_y, 0.5);
    hline(page, M, PAGE_W - M, table_bottom_y, 0.5);
    vline(page, M, table_bottom_y, table_top_y, 0.5, rgb(0, 0, 0));
    vline(page, PAGE_W - M, table_bottom_y, table_top_y, 0.5, rgb(0, 0, 0));

    const bytes = await pdf.save();
    const byteArray = new Uint8Array(bytes);
    return new Response(JSON.stringify({ pdf: uint8ToBase64(byteArray) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-shareholders-register-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
