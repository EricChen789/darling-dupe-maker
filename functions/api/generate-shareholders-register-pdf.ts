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

function fmtMoney(val: any, dflt: string = "0.00"): string {
  if (val === null || val === undefined || val === "") return dflt;
  const n = Number(val);
  if (isNaN(n)) return dflt;
  return n.toFixed(2);
}

// ── RTF-style page header ──
function drawPageHeader(page: any, f: { cjk: any; ascii: any },
  title: string, company: any, quorum: number | null): number {
  const today = new Date().toLocaleDateString('en-GB');
  let y = PAGE_H - 45;

  drawMixed(page, (company as any).name || "", { x: MARGIN, y, size: 14, cjk: f.cjk, ascii: f.ascii, color: BLUE });
  y -= 20;

  const br = (company as any).company_number || "";
  drawMixed(page, `Company Number:  ${br}`, { x: MARGIN, y, size: 10, cjk: f.cjk, ascii: f.ascii, color: BLUE });

  if (quorum !== null) {
    drawMixedRight(page, `Quorum:  ${quorum}`, { x: PAGE_W - MARGIN, y, size: 9, cjk: f.cjk, ascii: f.ascii, color: BLUE });
  }
  y -= 22;

  drawMixed(page, `${title} AT ${today}`, { x: MARGIN, y, size: 12, cjk: f.cjk, ascii: f.ascii, color: BLUE });
  y -= 24;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0, 0, 0), thickness: 0.8 });
  return y - 10;
}

// ── Grey header row (RTF style) ──
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

function drawTxnDataRow(page: any, f: { cjk: any; ascii: any },
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

  try {
    const { companyId } = await request.json();
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

    // Map transactions by person name for grouping
    const txByName = new Map<string, any[]>();
    for (const t of transactions) {
      const key = ((t.from_name || t.to_name || "") as string).trim().toUpperCase();
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

    // ── ROM transaction sub-columns (9 cols, Landscape-optimised) ──
    const x0 = MARGIN + 5;
    const txnCols = [
      { label: "Date Entered\n/ Ceased",           x: x0,       w: 62 },
      { label: "Transaction\nType",                 x: x0 + 62,  w: 65 },
      { label: "Units",                             x: x0 + 127, w: 82 },
      { label: "Par Value\nPer Share",              x: x0 + 209, w: 82 },
      { label: "Paid Up Value\nPer Share",          x: x0 + 291, w: 82 },
      { label: "Certificate\nNo",                   x: x0 + 373, w: 58 },
      { label: "Distinctive\nNumbers",              x: x0 + 431, w: 130 },
      { label: "Balance",                           x: x0 + 561, w: 75 },
      { label: "Transferred To/From,\nRedeemed, Reissued", x: x0 + 636, w: 145 },
    ];

    // ── Register of Members (ROM) — Landscape, RTF-matched layout ──
    const quorum = roles.length || null;
    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = drawPageHeader(page, f, "REGISTER OF MEMBERS", company, quorum);

    const labelX = MARGIN + 3;   // ~33pt
    const valX = MARGIN + 58;    // ~88pt — enough space after "Name" / "Address" labels

    if (roles.length === 0) {
      drawMixed(page, "(No shareholders / 尚無股東記錄)", {
        x: MARGIN + 5, y: y - 18, size: 9, cjk: f.cjk, ascii: f.ascii, color: rgb(0.5, 0.5, 0.5),
      });
    } else {
      let rowNum = 0;

      for (const r of roles) {
        const p = personMap.get(r.person_id) || {};
        const nameEn = p.name_english || p.name_chinese || "(unnamed)";
        const nameCh = p.name_english ? (p.name_chinese || "") : "";
        const addr = p.address || "";
        const hkid = p.id_number || p.passport_number || "";
        const isNat = (p.identity || "natural") === "natural";

        // Page break check for member block
        if (y - 140 < 50) {
          page = pdf.addPage([PAGE_W, PAGE_H]);
          y = drawPageHeader(page, f, "REGISTER OF MEMBERS (Cont'd)", company, quorum);
        }

        // Member separator (thick line)
        if (rowNum > 0) {
          page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0, 0, 0), thickness: 0.6 });
          y -= 6;
        }
        rowNum++;
        const y0 = y;

        // ── Name line ──
        let nameDisplay = nameEn;
        if (isNat && hkid) {
          nameDisplay = `${nameEn} (Hong Kong ID No: ${hkid})`;
        } else if (!isNat && hkid) {
          nameDisplay = `${nameEn} (Company No: ${hkid})`;
        }
        drawMixed(page, "Name", { x: labelX, y, size: 9, cjk: f.cjk, ascii: f.ascii, color: BLUE });
        drawMixed(page, nameDisplay, { x: valX, y, size: 9, cjk: f.cjk, ascii: f.ascii });
        if (nameCh) {
          drawMixed(page, nameCh, { x: valX + 20, y, size: 8, cjk: f.cjk, ascii: f.ascii });
        }
        y -= 16;

        // ── Address line ──
        drawMixed(page, "Address", { x: labelX, y, size: 9, cjk: f.cjk, ascii: f.ascii, color: BLUE });
        const addrLines = wrapText(addr, f.cjk, f.ascii, 9, CONTENT_W - 90);
        for (let ai = 0; ai < addrLines.length; ai++) {
          drawMixed(page, addrLines[ai], { x: valX, y: y - ai * 11, size: 9, cjk: f.cjk, ascii: f.ascii });
        }
        y -= Math.max(addrLines.length, 1) * 12 + 4;

        // Thin separator before shareholding details
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: rgb(0.78, 0.78, 0.78), thickness: 0.3 });
        y -= 6;

        // ── Security + Dates line ──
        const shareType = r.share_type || "ORD";
        const currency = r.currency || "HKD";
        const issuePrice = fmtMoney(r.issue_price, "1.00");
        const paidUp = fmtMoney(r.paid_up, issuePrice);
        const secDesc = `${shareType} - ${currency}$${issuePrice} ORDINARY FULLY PAID (${currency}$)`;

        drawMixed(page, "Security", { x: labelX, y, size: 9, cjk: f.cjk, ascii: f.ascii, color: BLUE });
        drawMixed(page, secDesc, { x: valX, y, size: 9, cjk: f.cjk, ascii: f.ascii });

        // Date + Date Ceased on the right side
        const dateApp = r.date_appointed || "-";
        const dateCea = r.date_ceased;
        const dateLabelX = PAGE_W - MARGIN - 210;
        drawMixed(page, "Date", { x: dateLabelX, y, size: 9, cjk: f.cjk, ascii: f.ascii, color: BLUE });
        drawMixed(page, dateApp, { x: dateLabelX + 40, y, size: 9, cjk: f.cjk, ascii: f.ascii });
        const ceasedLabelX = dateLabelX + 110;
        drawMixed(page, "Date Ceased", { x: ceasedLabelX, y, size: 9, cjk: f.cjk, ascii: f.ascii, color: BLUE });
        drawMixed(page, dateCea || "", { x: ceasedLabelX + 65, y, size: 9, cjk: f.cjk, ascii: f.ascii });
        y -= 18;

        // ── Share Transactions Grey Header + Data Rows ──
        if (y - 60 < 50) {
          page = pdf.addPage([PAGE_W, PAGE_H]);
          y = drawPageHeader(page, f, "REGISTER OF MEMBERS (Cont'd)", company, quorum);
        }
        y = drawTableHeaderRow(page, f, txnCols, y);

        // Collect relevant transactions for this shareholder
        const personNameKey = nameEn.trim().toUpperCase();
        const personTxs = txByName.get(personNameKey) || [];

        if (personTxs.length === 0) {
          // Show summary row from role data
          const sharesCount = fmtNum(r.shares || 0);
          const values = [
            dateApp,
            "Allotment",
            sharesCount,
            `${currency}$${issuePrice}`,
            `${currency}$${paidUp}`,
            r.certificate_number || "-",
            "-",
            sharesCount,
            "-",
          ];
          y = drawTxnDataRow(page, f, txnCols, values, y);
        } else {
          let runningBalance = 0;
          for (const tx of personTxs) {
            if (y - 28 < 50) {
              page = pdf.addPage([PAGE_W, PAGE_H]);
              y = drawPageHeader(page, f, "REGISTER OF MEMBERS (Cont'd)", company, quorum);
              y = drawTableHeaderRow(page, f, txnCols, y);
            }

            const txType = tx.transaction_type || "Transfer";
            const txDate = tx.transaction_date || "-";
            const txShares = Number(tx.shares || 0);
            const txPrice = fmtMoney(tx.price_per_share, issuePrice);
            const txCurrency = tx.currency || currency;
            const txFrom = (tx.from_name || "") as string;
            const txTo = (tx.to_name || "") as string;
            const txInst = tx.instrument_number || "-";

            const isOut = txFrom.trim().toUpperCase() === personNameKey;
            const isIn = txTo.trim().toUpperCase() === personNameKey;

            if (isIn) {
              runningBalance += txShares;
            } else if (isOut) {
              runningBalance -= txShares;
            } else {
              runningBalance += txShares;
            }
            const tfrInfo = isOut ? `To: ${txTo}` : isIn ? txFrom : "";

            const values = [
              txDate,
              txType,
              fmtNum(txShares),
              `${txCurrency}$${txPrice}`,
              `${txCurrency}$${txPrice}`,
              txInst,
              "-",
              fmtNum(runningBalance),
              tfrInfo,
            ];
            y = drawTxnDataRow(page, f, txnCols, values, y);
          }
        }

        y -= 12; // spacing after each member
      }
    }

    // ── Share Transfer History (separate section after members) ──
    if (transactions.length > 0) {
      y -= 15;
      if (y - 100 < 50) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        y = drawPageHeader(page, f, "REGISTER OF MEMBERS (Cont'd)", company, quorum);
      }

      drawMixed(page, "Share Transfer History / 股份轉讓記錄", {
        x: MARGIN, y, size: 11, cjk: f.cjk, ascii: f.ascii,
      });
      y -= 18;

      const txCols = [
        { label: "#",                              x: MARGIN + 2,  w: 22 },
        { label: "Date",                           x: MARGIN + 25, w: 62 },
        { label: "Type",                           x: MARGIN + 88, w: 54 },
        { label: "Transferor\nFrom",               x: MARGIN + 143, w: 94 },
        { label: "Transferee\nTo",                 x: MARGIN + 238, w: 94 },
        { label: "Shares / Class",                 x: MARGIN + 333, w: 72 },
        { label: "Price\nPer Share",               x: MARGIN + 406, w: 62 },
        { label: "Total\nConsideration",           x: MARGIN + 469, w: 68 },
        { label: "Instrument\nNo.",                x: MARGIN + 538, w: 54 },
      ];

      y = drawTableHeaderRow(page, f, txCols, y);
      let txNum = 0;

      for (const t of transactions) {
        if (y - 28 < 50) {
          page = pdf.addPage([PAGE_W, PAGE_H]);
          y = drawPageHeader(page, f, "REGISTER OF MEMBERS (Cont'd)", company, quorum);
          y = drawTableHeaderRow(page, f, txCols, y);
        }
        txNum++;
        const shareCount = fmtNum(t.shares || 0);
        const values = [
          String(txNum),
          t.transaction_date || "-",
          t.transaction_type || "transfer",
          t.from_name || "-",
          t.to_name || "-",
          `${shareCount} / ${t.share_type || "-"}`,
          `${t.currency || "HKD"} ${t.price_per_share || "-"}`,
          t.total_consideration || "-",
          t.instrument_number || "-",
        ];
        y = drawTxnDataRow(page, f, txCols, values, y);
      }
    }

    const bytes = await pdf.save();
    return new Response(bytes, {
      headers: { ...corsHeaders, "Content-Type": "application/pdf" },
    });
  } catch (e: any) {
    console.error("generate-shareholders-register-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
