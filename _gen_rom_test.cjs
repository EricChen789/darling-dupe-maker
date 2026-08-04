#!/usr/bin/env node
/**
 * ROM Layout Test — generates Register of Members PDF using the exact
 * same layout code as the Cloudflare Function (v6).
 * No auth required — runs locally with pdf-lib.
 */
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

// ── Page (Landscape A4) ──
const PW = 842, PH = 595;
const MARGIN = 42;
const CONTENT_R = PW - MARGIN;
const TABLE_R = CONTENT_R;

// ── Colors ──
const BLACK = rgb(0, 0, 0);
const LINE_COLOR = rgb(0.3, 0.3, 0.3);
const LABEL_COLOR = rgb(0.15, 0.15, 0.15);

// ── Font sizes ──
const FSZ = {
  co: 11, title: 13,
  shLabel: 9, shVal: 11,
  thGroup: 9, thCol: 8, td: 9,
  footer: 9,
};

// ── Y positions ──
const HEADER = { coName: 555, coBR: 533, title: 508, sep: 494 };
const SH = [
  { name: 488, addr: 460, occ: 432, dateEnt: 432, dateCea: 406, tableTop: 382 },
  { name: 275, addr: 247, occ: 219, dateEnt: 219, dateCea: 193, tableTop: 169 },
];
const SH_SEP_Y = 290;
const ROW_H = 22, GROUP_H = 18;

// ── Columns ──
const COLS = [
  { x: 42,  w: 54, label: 'Date',                     group: 'acq' },
  { x: 96,  w: 48, label: 'Certificate\nNumber',      group: 'acq' },
  { x: 144, w: 44, label: 'Distinctive\nNos. (From)', group: 'acq' },
  { x: 188, w: 44, label: 'Distinctive\nNos. (To)',   group: 'acq' },
  { x: 232, w: 52, label: 'No. of\nShares',           group: 'acq' },
  { x: 284, w: 58, label: 'Consideration\nPaid',      group: 'acq' },
  { x: 342, w: 48, label: 'No. of\nTransfer Deed',    group: 'xfer' },
  { x: 390, w: 48, label: 'Certificate\nNumber',      group: 'xfer' },
  { x: 438, w: 44, label: 'Distinctive\nNos. (From)', group: 'xfer' },
  { x: 482, w: 44, label: 'Distinctive\nNos. (To)',   group: 'xfer' },
  { x: 526, w: 52, label: 'No. of\nShares',           group: 'xfer' },
  { x: 578, w: 58, label: 'Consideration\nPaid',      group: 'xfer' },
  { x: 636, w: 52, label: 'Total Shares\nHeld',       group: 'sum' },
  { x: 688, w: 56, label: 'Remarks',                  group: 'sum' },
  { x: 744, w: 56, label: 'Entry Made\nBy',           group: 'sum' },
];

// ── CJK/ASCII detection ──
function isAsciiChar(ch) { return ch.charCodeAt(0) <= 0x7F; }
function hasCjk(text) {
  for (const ch of text || '') {
    const c = ch.charCodeAt(0);
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3000 && c <= 0x303F) ||
        (c >= 0xFF00 && c <= 0xFFEF) || (c >= 0x2E80 && c <= 0x2FDF) ||
        (c >= 0x3400 && c <= 0x4DBF)) return true;
  }
  return false;
}
function segmentText(text) {
  const segs = [];
  if (!text) return segs;
  let cur = '', curAscii = null;
  for (const ch of text) {
    const ascii = isAsciiChar(ch);
    if (curAscii === null) curAscii = ascii;
    else if (ascii !== curAscii) { segs.push({ text: cur, useCjk: !curAscii }); cur = ''; curAscii = ascii; }
    cur += ch;
  }
  if (cur) segs.push({ text: cur, useCjk: curAscii === null ? false : !curAscii });
  return segs;
}
function widthOfText(text, size, cjkFont, asciiFont) {
  let w = 0;
  for (const s of segmentText(text || '')) {
    const font = s.useCjk ? cjkFont : asciiFont;
    w += font.widthOfTextAtSize(s.text, size);
  }
  return w;
}
function drawMixed(pg, text, opts) {
  const segs = segmentText(text || '');
  let x = opts.x;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    const drawOpts = { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) };
    try { pg.drawText(s.text, drawOpts); if (opts.bold) pg.drawText(s.text, { ...drawOpts, x: x + 0.5 }); x += font.widthOfTextAtSize(s.text, opts.size); } catch {}
  }
}
function drawMixedRight(pg, text, opts) {
  const totalW = widthOfText(text || '', opts.size, opts.cjk, opts.ascii);
  drawMixed(pg, text, { ...opts, x: opts.x - totalW });
}

// ── Line helpers ──
function hLine(pg, y, x1 = MARGIN, x2 = TABLE_R, c = LINE_COLOR, t = 0.4) {
  pg.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color: c, thickness: t });
}
function vLine(pg, x, y1, y2, c = LINE_COLOR, t = 0.3) {
  pg.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, color: c, thickness: t });
}

// ── Times Roman label helpers ──
function drawLabel(pg, text, opts) { pg.drawText(text, { ...opts, color: LABEL_COLOR }); }
function drawLabelR(pg, text, opts) {
  pg.drawText(text, { x: opts.x - opts.font.widthOfTextAtSize(text, opts.size), y: opts.y, size: opts.size, font: opts.font, color: LABEL_COLOR });
}

// ═══════════════════════════════════════════════════════
// Test Data
// ═══════════════════════════════════════════════════════
const company = { name: 'PHYSICAL HEALTH CENTRE (TST) LIMITED', company_number: '22141993' };
const reportDate = '30 JULY 2026';

const shareholders = [
  {
    fullName: 'LUK Ngai Keung 陸毅強 (HKID: A123456(7))',
    occupation: 'Company Director',
    addr: 'Room 2301, 23/F, AIA Tower, 183 Electric Road, North Point, Hong Kong',
    dateApp: '23/04/2026', dateCea: '',
    sharesHeld: 5000, certNo: 'SH-001',
    currency: 'HKD', issuePrice: '1.00',
    txs: [
      { date: '23/04/2026', shares: 5000, to_name: 'Timothy Tang', cert: 'SH-001', currency: 'HKD', price: '1.00', deed: 'TD-001' },
    ],
  },
  {
    fullName: 'Physical Beauty & Fitness Holdings Limited (CI: 12345678)',
    occupation: 'Corporate Shareholder',
    addr: 'Unit 501, 5/F, Tower A, Regent Centre, 63 Wo Yi Hop Road, Kwai Chung, New Territories',
    dateApp: '18/04/2026', dateCea: '',
    sharesHeld: 10000, certNo: 'SH-002',
    currency: 'HKD', issuePrice: '1.00',
    txs: [
      { date: '18/04/2026', shares: 5000, to_name: 'Timothy Tang', cert: 'SH-002', currency: 'HKD', price: '1.00', deed: 'TD-002' },
      { date: '25/05/2026', shares: 3000, from_name: 'Alice Wong', cert: 'SH-003', currency: 'HKD', price: '2.50', deed: 'TD-003' },
    ],
  },
];

// ═══════════════════════════════════════════════════════
async function main() {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const asciiFont = await pdf.embedFont(StandardFonts.Helvetica);
  const timesFont = await pdf.embedFont(StandardFonts.TimesRoman);
  let cjkFont = asciiFont;
  try {
    const cjkPath = 'D:/myproject/秘书系统文件/NotoSansTC.woff2';
    if (fs.existsSync(cjkPath)) cjkFont = await pdf.embedFont(fs.readFileSync(cjkPath));
  } catch {}

  const f = { cjk: cjkFont, ascii: asciiFont };
  const tm = timesFont;

  // ── Page 1 ──
  const pg = pdf.addPage([PW, PH]);

  // Frame
  const ft = 565, fb = 30;
  hLine(pg, ft, MARGIN, TABLE_R, BLACK, 0.5);
  hLine(pg, fb, MARGIN, TABLE_R, BLACK, 0.5);
  vLine(pg, MARGIN, fb, ft, BLACK, 0.5);
  vLine(pg, TABLE_R, fb, ft, BLACK, 0.5);

  // Header
  drawMixed(pg, company.name, { x: MARGIN, y: HEADER.coName, size: FSZ.co, cjk: f.cjk, ascii: f.ascii, bold: true });
  drawMixed(pg, `Company Number:  ${company.company_number}`, { x: MARGIN, y: HEADER.coBR, size: FSZ.co, cjk: f.cjk, ascii: f.ascii });
  drawMixedRight(pg, `as at ${reportDate}`, { x: CONTENT_R, y: HEADER.coBR, size: FSZ.co, cjk: f.cjk, ascii: f.ascii });
  const title = 'REGISTER OF MEMBERS';
  drawMixed(pg, title, { x: (TABLE_R + MARGIN) / 2 - widthOfText(title, FSZ.title, f.cjk, f.ascii) / 2, y: HEADER.title, size: FSZ.title, cjk: f.cjk, ascii: f.ascii, bold: true });
  hLine(pg, HEADER.sep, MARGIN, TABLE_R, BLACK, 0.6);

  // Footer
  drawMixed(pg, '- 1 -', { x: PW / 2 - 18, y: 25, size: FSZ.footer, cjk: f.cjk, ascii: f.ascii });

  // ── Shareholders ──
  for (let si = 0; si < shareholders.length; si++) {
    const sh = shareholders[si];
    const s = SH[si];

    if (si === 1) hLine(pg, SH_SEP_Y, MARGIN, TABLE_R, BLACK, 0.5);

    // ── Info ──
    const VX = 145, RX = 500, RVX = 640;
    drawLabel(pg, 'Full Name:',  { x: MARGIN, y: s.name,    size: FSZ.shLabel, font: tm });
    drawLabel(pg, 'Address:',    { x: MARGIN, y: s.addr,    size: FSZ.shLabel, font: tm });
    drawLabel(pg, 'Occupation:', { x: MARGIN, y: s.occ,     size: FSZ.shLabel, font: tm });
    drawLabelR(pg, 'Date Entered as a Member:',  { x: RX, y: s.dateEnt, size: FSZ.shLabel, font: tm });
    drawLabelR(pg, 'Date of Ceasing to be Member:', { x: RX, y: s.dateCea, size: FSZ.shLabel, font: tm });

    drawMixed(pg, sh.fullName,   { x: VX,  y: s.name,    size: FSZ.shVal, cjk: f.cjk, ascii: f.ascii });
    drawMixed(pg, sh.addr,       { x: VX,  y: s.addr,    size: FSZ.shVal, cjk: f.cjk, ascii: f.ascii });
    drawMixed(pg, sh.occupation, { x: VX,  y: s.occ,     size: FSZ.shVal, cjk: f.cjk, ascii: f.ascii });
    drawMixed(pg, sh.dateApp,    { x: RVX, y: s.dateEnt, size: FSZ.shVal, cjk: f.cjk, ascii: f.ascii });
    if (sh.dateCea) drawMixed(pg, sh.dateCea, { x: RVX, y: s.dateCea, size: FSZ.shVal, cjk: f.cjk, ascii: f.ascii });

    // ── Table ──
    const T = s.tableTop;
    const y = [T, T - GROUP_H, T - GROUP_H - ROW_H, T - GROUP_H - ROW_H * 2, T - GROUP_H - ROW_H * 3, T - GROUP_H - ROW_H * 4];

    hLine(pg, y[0], MARGIN, TABLE_R, BLACK, 0.6);
    const acqMid = 42 + (335 - 42) / 2;
    const xferMid = 335 + (627 - 335) / 2;
    drawMixed(pg, 'Shares Acquired', { x: acqMid - widthOfText('Shares Acquired', FSZ.thGroup, f.cjk, f.ascii) / 2, y: y[0] - 12, size: FSZ.thGroup, cjk: f.cjk, ascii: f.ascii, bold: true });
    drawMixed(pg, 'Shares Transferred', { x: xferMid - widthOfText('Shares Transferred', FSZ.thGroup, f.cjk, f.ascii) / 2, y: y[0] - 12, size: FSZ.thGroup, cjk: f.cjk, ascii: f.ascii, bold: true });
    hLine(pg, y[1], MARGIN, TABLE_R, BLACK, 0.4);

    for (const c of COLS) {
      const lines = c.label.split('\n');
      for (let li = 0; li < Math.min(lines.length, 2); li++)
        drawLabel(pg, lines[li], { x: c.x + 2, y: y[1] - 5 - li * 10, size: FSZ.thCol, font: tm });
    }
    hLine(pg, y[2], MARGIN, TABLE_R, BLACK, 0.4);

    // ── Data rows ──
    const ct = (ci, text, ty, align) => {
      if (!text) return;
      const s = String(text).slice(0, 60);
      const c = COLS[ci];
      const tw = widthOfText(s, FSZ.td, f.cjk, f.ascii);
      const maxW = c.w - 4;
      let dx = c.x + 3;
      if (align === 'R') dx = c.x + c.w - tw - 3;
      if (tw > maxW) s2 = s.slice(0, Math.floor(s.length * maxW / tw));
      const final = tw > maxW ? s.slice(0, Math.floor(s.length * maxW / tw)) : s;
      drawMixed(pg, final, { x: dx, y: ty, size: FSZ.td, cjk: f.cjk, ascii: f.ascii });
    };

    let balance = sh.sharesHeld;

    // Row 0: Subscription
    let rY = y[2] - 6;
    ct(0, sh.dateApp, rY); ct(1, sh.certNo, rY); ct(4, String(balance), rY, 'R');
    ct(5, `${sh.currency}$${sh.issuePrice}`, rY); ct(12, String(balance), rY, 'R'); ct(13, 'Subscription', rY);
    hLine(pg, y[3], MARGIN, TABLE_R, LINE_COLOR, 0.4);

    // Remaining rows: Transactions
    let ri = 1;
    for (const tx of (sh.txs || [])) {
      if (ri >= 3) break;
      const txShares = Number(tx.shares || 0);
      const isOut = tx.to_name && !tx.from_name;
      const isIn = tx.from_name && !tx.to_name;
      const isBoth = tx.to_name && tx.from_name;

      // Simple: first check if to_name exists (transfer out)
      if (tx.to_name) balance -= txShares;
      else balance += txShares;

      rY = y[2 + ri] - 6;
      const isXfer = !!(tx.to_name || tx.from_name);
      if (isXfer) {
        ct(0, tx.date, rY); ct(6, tx.deed, rY); ct(7, tx.cert, rY);
        ct(10, String(txShares), rY, 'R'); ct(11, `${tx.currency || sh.currency}$${tx.price || sh.issuePrice}`, rY);
        ct(1, `(${balance})`, rY);
        const cp = tx.to_name ? `To: ${tx.to_name}` : `From: ${tx.from_name}`;
        ct(13, cp.slice(0, 30), rY);
      } else {
        ct(0, tx.date, rY); ct(1, tx.cert, rY); ct(4, String(txShares), rY, 'R');
        ct(5, `${tx.currency || sh.currency}$${tx.price || sh.issuePrice}`, rY);
      }
      ct(12, String(balance), rY, 'R');
      hLine(pg, y[2 + ri + 1], MARGIN, TABLE_R, LINE_COLOR, 0.4);
      ri++;
    }

    // Fill remaining rows
    while (ri < 3) {
      rY = y[2 + ri] - 6;
      ct(1, `(${balance})`, rY); ct(12, String(balance), rY, 'R');
      hLine(pg, y[2 + ri + 1], MARGIN, TABLE_R, LINE_COLOR, 0.4);
      ri++;
    }

    // Vertical lines after all hLines
    vLine(pg, MARGIN, y[5], y[0], LINE_COLOR, 0.4);
    for (const c of COLS) vLine(pg, c.x + c.w, y[5], y[0], LINE_COLOR, 0.4);
  }

  const bytes = await pdf.save();
  const outPath = path.join(__dirname, '_rom_check_output', 'rom_v6_test.pdf');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, bytes);
  console.log(`✅ ROM PDF saved: ${outPath} (${bytes.length} bytes)`);
  console.log(`   Company: ${company.name}`);
  console.log(`   Shareholders: ${shareholders.length}`);
  console.log(`   Pages: 1`);
}

main().catch(e => { console.error(e); process.exit(1); });
