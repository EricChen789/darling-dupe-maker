#!/usr/bin/env node
/**
 * ROD + Secretaries Register Test — generates both registers locally
 * using the EXACT same layout code as the Cloudflare Functions
 * (generate-directors-register-pdf.ts / generate-secretaries-register-pdf.ts).
 *
 * Usage: node _gen_rod_sec_test.cjs
 * Output: _rom_check_output/rod_test.pdf, _rom_check_output/sec_test.pdf
 */
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '_rom_check_output');

// ── Helpers (matching _pdf-utils.ts) ──
function rget(row, key, dflt) { if (!row) return dflt || ''; const v = row[key]; return v !== null && v !== undefined ? v : (dflt || ''); }
function isAsciiChar(ch) { return ch.charCodeAt(0) <= 0x7F; }
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
function widthOfText(text, cjkFont, asciiFont, size) {
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
    try { pg.drawText(s.text, { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
      if (opts.bold) pg.drawText(s.text, { x: x + 0.5, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) });
      x += font.widthOfTextAtSize(s.text, opts.size); } catch {}
  }
}
function drawMixedRight(pg, text, opts) {
  const totalW = widthOfText(text || '', opts.cjk, opts.ascii, opts.size);
  drawMixed(pg, text, { ...opts, x: opts.x - totalW });
}
function wrapText(text, cjk, ascii, size, maxW) {
  const lines = [];
  if (!text) return [''];
  for (const line of text.split('\n')) {
    if (!line) { lines.push(''); continue; }
    let cur = '';
    for (const ch of line) {
      const test = cur + ch;
      if (widthOfText(test, cjk, ascii, size) > maxW) { lines.push(cur); cur = ch; }
      else cur = test;
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [''];
}

// ── Test data ──
const company = { name: 'GRAND POWER LOGISTICS INTERNATIONAL LIMITED 裕程物流集團有限公司', company_number: '21710682' };
const directors = [
  {
    name_english: 'CHAN Tai Man', name_chinese: '陳大文',
    identity: 'natural', id_number: 'A123456(7)',
    addr_flat: 'Flat A', addr_building: '21/F', addr_street: 'Wing On Centre', addr_district: 'Central', addr_region: 'Hong Kong',
    date_of_birth: '15/03/1975', place_of_birth: 'Hong Kong', nationality: 'Chinese',
    date_appointed: '01/06/2022', is_reserve: false,
  },
  {
    name_english: 'WONG Siu Ming', name_chinese: '王小明',
    identity: 'natural', id_number: 'B987654(3)',
    address: 'Room 502, 5/F, Harbour Centre, 25 Harbour Road, Wan Chai, Hong Kong',
    date_of_birth: '22/08/1980', place_of_birth: 'Kowloon, Hong Kong', nationality: 'Chinese',
    date_appointed: '15/03/2023', date_ceased: '30/09/2025', is_reserve: false,
  },
  {
    name_english: 'LEE Ka Wing', name_chinese: '李家榮',
    identity: 'natural', id_number: 'C345678(9)',
    address: 'Block 3, 12/F, Tuen Mun Park, Tuen Mun, New Territories, Hong Kong',
    date_of_birth: '10/11/1985', place_of_birth: 'New Territories, Hong Kong', nationality: 'Chinese',
    date_appointed: '01/06/2022', is_reserve: true,
  },
];
const secretaries = [
  {
    name_english: 'Twinsail Consultants Limited',
    identity: 'corporate', company_number_ref: '12345678', tcsp_number: 'TCSP-2023-001',
    address: 'Unit 2301, 23/F, Wing On Centre, 111 Connaught Road Central, Hong Kong',
    date_appointed: '01/06/2022',
  },
];

// ═══════════════════════════════════════════════════════════
// Shared constants (matching both CF functions)
// ═══════════════════════════════════════════════════════════
const PW = 842, PH = 595, MARGIN = 42;
const BLACK = rgb(0,0,0), GRAY_BG = rgb(0.89,0.89,0.89), LINE_LIGHT = rgb(0.82,0.82,0.82);
const TABLE_LEFT = MARGIN;
const TABLE_RIGHT = MARGIN + 800;

// ═══════════════════════════════════════════════════════════
// ROD (Register of Directors) — exact copy of generate-directors-register-pdf.ts
// ═══════════════════════════════════════════════════════════
const ROD_COL = [
  { x: MARGIN,       w: 196, label: "Name / Service /\nResidential Address" },
  { x: MARGIN + 196, w: 138, label: "Date / Place Birth /\nPlace Incorporated /\nOccupation /" },
  { x: MARGIN + 334, w: 138, label: "ID No / Passport\nDetails" },
  { x: MARGIN + 472, w: 90,  label: "Position" },
  { x: MARGIN + 562, w: 90,  label: "Date(s) Appointed\n/Meeting" },
  { x: MARGIN + 652, w: 148, label: "Reason / Date(s)\nCeased" },
];

function rodDrawHeader(pg, f, co, reportDate, quorum) {
  let y = PH - 30;
  const coName = (rget(co, 'name') || '').slice(0, 150);
  drawMixed(pg, coName, { x: MARGIN, y, size: 12, cjk: f.cjk, ascii: f.ascii, bold: true });
  y -= 18;
  const br = rget(co, 'company_number') || '';
  drawMixed(pg, `Company Number:  ${br}`, { x: MARGIN, y, size: 10, cjk: f.cjk, ascii: f.ascii });
  y -= 14;
  const rodTitle = `REGISTER OF OFFICERS AT ${reportDate}`;
  drawMixed(pg, rodTitle, { x: MARGIN, y, size: 11, cjk: f.cjk, ascii: f.ascii, bold: true });
  if (quorum !== null) {
    const titleW = widthOfText(rodTitle, f.cjk, f.ascii, 11);
    const quorumText = `Quorum:  ${quorum}`;
    const quorumW = widthOfText(quorumText, f.cjk, f.ascii, 9);
    const qX = Math.max(MARGIN + titleW + 24, TABLE_RIGHT - quorumW);
    drawMixed(pg, quorumText, { x: qX, y, size: 9, cjk: f.cjk, ascii: f.ascii });
  }
  y -= 16;
  pg.drawLine({ start: { x: MARGIN, y }, end: { x: TABLE_RIGHT, y }, color: BLACK, thickness: 0.5 });
  return y - 8;
}

function rodDrawTableHeader(pg, f, y) {
  const fs = 9;
  let maxLines = 1;
  const wrapped = ROD_COL.map(c => wrapText(c.label, f.cjk, f.ascii, fs, c.w - 6));
  wrapped.forEach(l => { if (l.length > maxLines) maxLines = l.length; });
  const rowH = maxLines * 12 + 8;
  pg.drawRectangle({ x: TABLE_LEFT - 2, y: y - rowH, width: TABLE_RIGHT - TABLE_LEFT + 4, height: rowH, color: GRAY_BG });
  ROD_COL.forEach((c, i) => {
    wrapped[i].forEach((line, li) => {
      drawMixed(pg, line, { x: c.x + 2, y: y - 4 - li * 12, size: fs, cjk: f.cjk, ascii: f.ascii });
    });
  });
  pg.drawLine({ start: { x: TABLE_LEFT, y }, end: { x: TABLE_RIGHT, y }, color: BLACK, thickness: 0.5 });
  pg.drawLine({ start: { x: TABLE_LEFT, y: y - rowH }, end: { x: TABLE_RIGHT, y: y - rowH }, color: BLACK, thickness: 0.5 });
  return y - rowH;
}

function rodDrawDataRow(pg, f, values, y, isLast) {
  const fs = 9;
  let maxLines = 1;
  const wrapped = values.map((v, i) => wrapText(v || '', f.cjk, f.ascii, fs, ROD_COL[i].w - 6));
  wrapped.forEach(l => { if (l.length > maxLines) maxLines = l.length; });
  const rowH = Math.max(maxLines * 12 + 6, 22);
  values.forEach((v, i) => {
    wrapped[i].forEach((line, li) => {
      drawMixed(pg, line, { x: ROD_COL[i].x + 2, y: y - 4 - li * 12, size: fs, cjk: f.cjk, ascii: f.ascii });
    });
  });
  // Last row gets BLACK border to close the table
  const borderColor = isLast ? BLACK : LINE_LIGHT;
  const borderThickness = isLast ? 0.5 : 0.3;
  pg.drawLine({ start: { x: TABLE_LEFT, y: y - rowH }, end: { x: TABLE_RIGHT, y: y - rowH }, color: borderColor, thickness: borderThickness });
  return y - rowH;
}

function rodBuildRow(r, isSecretary, personMap) {
  const p = personMap.get(r.person_id) || {};
  const nameEn = (rget(p, 'name_english') || rget(p, 'name_chinese') || '(unnamed)').slice(0, 80);
  const nameZh = (rget(p, 'name_chinese') || '').slice(0, 40);
  const isNat = (rget(p, 'identity') || 'natural') === 'natural';

  // Col 1: Name + Address
  let addr = '';
  if (isNat) {
    addr = [rget(p, 'addr_flat'), rget(p, 'addr_building'), rget(p, 'addr_street'), rget(p, 'addr_district')].filter(Boolean).join(', ');
    if (!addr) addr = (rget(p, 'address') || '').slice(0, 80);
    const region = rget(p, 'addr_region') || '';
    if (region && !addr.includes(region)) addr = addr ? `${addr}, ${region}` : region;
  } else {
    addr = (rget(p, 'registered_office') || rget(p, 'address') || '').slice(0, 80);
  }
  const nameBlock = [nameEn, nameZh, addr].filter(Boolean).join('\n').slice(0, 200);

  // Col 2: DOB/Place/Nation
  let dobBlock;
  if (isNat) {
    dobBlock = `${rget(p, 'date_of_birth') || '-'}\n${rget(p, 'place_of_birth') || '-'}\n${rget(p, 'nationality') || '-'}`;
  } else {
    dobBlock = `${rget(p, 'place_incorporated') || '-'}\n(Corporate)`;
  }

  // Col 3: ID
  const idInfo = isNat ? (rget(p, 'id_number') || rget(p, 'passport_number') || '-') : (rget(p, 'company_number_ref') || '-');

  // Col 4: Position
  let position;
  if (isSecretary) position = 'Secretary';
  else if (rget(r, 'is_reserve')) position = 'Reserve Director';
  else position = 'Director';

  // Col 5: Date Appointed
  const dateApp = rget(r, 'date_appointed') || '-';

  // Col 6: Reason / Date Ceased
  let reasonBlock;
  if (rget(r, 'date_ceased')) reasonBlock = `Resigned\n${rget(r, 'date_ceased')}`;
  else reasonBlock = 'Current';

  return { values: [nameBlock, dobBlock, idInfo, position, dateApp, reasonBlock] };
}

async function buildROD(f, pdf) {
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const reportDate = `${dd} ${months[today.getMonth()]} ${today.getFullYear()}`;
  const quorum = directors.length || null;

  // Build personMap (simulating D1 query)
  const personMap = new Map();
  // Use array index as person_id for test
  directors.forEach((d, i) => { d.person_id = `p_dir_${i}`; personMap.set(d.person_id, d); });
  secretaries.forEach((s, i) => { s.person_id = `p_sec_${i}`; personMap.set(s.person_id, s); });

  // Build role objects matching CF's person_company_roles query
  const dirRoles = directors.map(d => ({ person_id: d.person_id, role: 'director', date_appointed: d.date_appointed, date_ceased: d.date_ceased, is_reserve: d.is_reserve }));
  const secRoles = secretaries.map(s => ({ person_id: s.person_id, role: 'secretary', date_appointed: s.date_appointed, date_ceased: s.date_ceased }));

  const officers = [];
  for (const d of dirRoles) officers.push(rodBuildRow(d, false, personMap));
  for (const s of secRoles) officers.push(rodBuildRow(s, true, personMap));

  // Render
  const allPages = [];
  let pageNum = 1;

  function newPage(isCont) {
    const pg = pdf.addPage([PW, PH]);
    let y = rodDrawHeader(pg, f, company, reportDate, quorum);
    y = rodDrawTableHeader(pg, f, y);
    drawMixed(pg, `- ${pageNum} -`, { x: PW / 2 - 15, y: 28, size: 8, cjk: f.cjk, ascii: f.ascii });
    allPages.push(pg);
    return y;
  }

  let y = newPage(false);

  for (let i = 0; i < officers.length; i++) {
    if (y < 80) { pageNum++; y = newPage(true); }
    const isLast = (i === officers.length - 1);
    y = rodDrawDataRow(allPages[allPages.length - 1], f, officers[i].values, y, isLast);
  }

  if (officers.length === 0) {
    drawMixed(allPages[allPages.length - 1], '(No directors or secretaries)', {
      x: MARGIN + 5, y: y - 18, size: 9, cjk: f.cjk, ascii: f.ascii, color: rgb(0.5, 0.5, 0.5),
    });
  }
}

// ═══════════════════════════════════════════════════════════
// SEC (Register of Secretaries) — exact copy of generate-secretaries-register-pdf.ts
// ═══════════════════════════════════════════════════════════
const SEC_COL = [
  { x: MARGIN,       w: 196, label: "Name / Service /\nResidential Address" },
  { x: MARGIN + 196, w: 138, label: "ID No / Passport /\nCompany No / TCSP" },
  { x: MARGIN + 334, w: 138, label: "Place Incorporated /\nRegistered Office" },
  { x: MARGIN + 472, w: 90,  label: "Position" },
  { x: MARGIN + 562, w: 90,  label: "Date(s) Appointed\n/Meeting" },
  { x: MARGIN + 652, w: 148, label: "Reason / Date(s)\nCeased" },
];

function secDrawHeader(pg, f, co, reportDate, quorum) {
  let y = PH - 30;
  // LEFT-aligned (matching ROD style)
  const coName = (rget(co, 'name') || '').slice(0, 150);
  drawMixed(pg, coName, { x: MARGIN, y, size: 12, cjk: f.cjk, ascii: f.ascii, bold: true });
  y -= 18;
  const br = rget(co, 'company_number') || '';
  drawMixed(pg, `Company Number:  ${br}`, { x: MARGIN, y, size: 10, cjk: f.cjk, ascii: f.ascii });
  y -= 14;
  const secTitle = `REGISTER OF COMPANY SECRETARIES AT ${reportDate}`;
  drawMixed(pg, secTitle, { x: MARGIN, y, size: 11, cjk: f.cjk, ascii: f.ascii, bold: true });
  if (quorum !== null) {
    const titleW = widthOfText(secTitle, f.cjk, f.ascii, 11);
    const quorumText = `Quorum:  ${quorum}`;
    const quorumW = widthOfText(quorumText, f.cjk, f.ascii, 9);
    const qX = Math.max(MARGIN + titleW + 24, TABLE_RIGHT - quorumW);
    drawMixed(pg, quorumText, { x: qX, y, size: 9, cjk: f.cjk, ascii: f.ascii });
  }
  y -= 16;
  pg.drawLine({ start: { x: MARGIN, y }, end: { x: TABLE_RIGHT, y }, color: BLACK, thickness: 0.5 });
  return y - 8;
}

function secDrawTableHeader(pg, f, y) {
  const fs = 9;
  let maxLines = 1;
  const wrapped = SEC_COL.map(c => wrapText(c.label, f.cjk, f.ascii, fs, c.w - 6));
  wrapped.forEach(l => { if (l.length > maxLines) maxLines = l.length; });
  const rowH = maxLines * 12 + 8;
  pg.drawRectangle({ x: TABLE_LEFT - 2, y: y - rowH, width: TABLE_RIGHT - TABLE_LEFT + 4, height: rowH, color: GRAY_BG });
  SEC_COL.forEach((c, i) => {
    wrapped[i].forEach((line, li) => {
      drawMixed(pg, line, { x: c.x + 2, y: y - 4 - li * 12, size: fs, cjk: f.cjk, ascii: f.ascii });
    });
  });
  pg.drawLine({ start: { x: TABLE_LEFT, y }, end: { x: TABLE_RIGHT, y }, color: BLACK, thickness: 0.5 });
  pg.drawLine({ start: { x: TABLE_LEFT, y: y - rowH }, end: { x: TABLE_RIGHT, y: y - rowH }, color: BLACK, thickness: 0.5 });
  return y - rowH;
}

function secDrawDataRow(pg, f, values, y, isLast) {
  const fs = 9;
  let maxLines = 1;
  const wrapped = values.map((v, i) => wrapText(v || '', f.cjk, f.ascii, fs, SEC_COL[i].w - 6));
  wrapped.forEach(l => { if (l.length > maxLines) maxLines = l.length; });
  const rowH = Math.max(maxLines * 12 + 6, 22);
  values.forEach((v, i) => {
    wrapped[i].forEach((line, li) => {
      drawMixed(pg, line, { x: SEC_COL[i].x + 2, y: y - 4 - li * 12, size: fs, cjk: f.cjk, ascii: f.ascii });
    });
  });
  const borderColor = isLast ? BLACK : LINE_LIGHT;
  const borderThickness = isLast ? 0.5 : 0.3;
  pg.drawLine({ start: { x: TABLE_LEFT, y: y - rowH }, end: { x: TABLE_RIGHT, y: y - rowH }, color: borderColor, thickness: borderThickness });
  return y - rowH;
}

async function buildSEC(f, pdf) {
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const today = new Date();
  const reportDate = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;

  // Build personMap (simulating D1 query — uses same test data)
  const personMap = new Map();
  secretaries.forEach((s, i) => { s.person_id = `p_sec_${i}`; personMap.set(s.person_id, s); });

  const secRoles = secretaries.map(s => ({ person_id: s.person_id, role: 'secretary', date_appointed: s.date_appointed, date_ceased: s.date_ceased }));
  const quorum = secRoles.length || null;

  // Build secretary rows (matching CF logic)
  const secRows = [];
  for (const r of secRoles) {
    const p = personMap.get(r.person_id) || {};
    const nameEn = (rget(p, 'name_english') || rget(p, 'name_chinese') || '(unnamed)').slice(0, 80);
    const nameZh = (rget(p, 'name_chinese') || '').slice(0, 40);
    const isNat = (rget(p, 'identity') || 'natural') === 'natural';

    // Col 1: Name + Address
    let addr = '';
    if (isNat) {
      addr = [rget(p, 'addr_flat'), rget(p, 'addr_building'), rget(p, 'addr_street'), rget(p, 'addr_district')].filter(Boolean).join(', ');
      if (!addr) addr = (rget(p, 'address') || '').slice(0, 80);
      const region = rget(p, 'addr_region') || '';
      if (region && !addr.includes(region)) addr = addr ? `${addr}, ${region}` : region;
    } else {
      addr = (rget(p, 'registered_office') || rget(p, 'address') || '').slice(0, 80);
    }
    const nameBlock = [nameEn, nameZh, addr].filter(Boolean).join('\n').slice(0, 200);

    // Col 2: ID / Passport / Company No / TCSP
    const tcsp = rget(p, 'tcsp_number') || '';
    let idBlock;
    if (isNat) {
      idBlock = rget(p, 'id_number') || rget(p, 'passport_number') || '-';
      if (tcsp) idBlock += `\nTCSP: ${tcsp}`;
    } else {
      idBlock = rget(p, 'company_number_ref') || '-';
      if (tcsp) idBlock += `\nTCSP: ${tcsp}`;
    }

    // Col 3: Place Incorporated / Registered Office
    const placeBlock = isNat
      ? (rget(p, 'nationality') || rget(p, 'place_of_birth') || '-')
      : (rget(p, 'place_incorporated') || rget(p, 'registered_office') || '-');

    // Col 4: Position
    const position = 'Secretary';

    // Col 5: Date Appointed
    const dateApp = rget(r, 'date_appointed') || '-';

    // Col 6: Reason / Date Ceased
    let reasonBlock;
    if (rget(r, 'date_ceased')) reasonBlock = `Resigned\n${rget(r, 'date_ceased')}`;
    else reasonBlock = 'Current';

    secRows.push({ values: [nameBlock, idBlock, placeBlock, position, dateApp, reasonBlock] });
  }

  // Render
  const allPages = [];
  let pageNum = 1;

  function newPage(isCont) {
    const pg = pdf.addPage([PW, PH]);
    let y = secDrawHeader(pg, f, company, reportDate, quorum);
    y = secDrawTableHeader(pg, f, y);
    drawMixed(pg, `- ${pageNum} -`, { x: PW / 2 - 15, y: 28, size: 8, cjk: f.cjk, ascii: f.ascii });
    allPages.push(pg);
    return y;
  }

  let y = newPage(false);

  for (let i = 0; i < secRows.length; i++) {
    if (y < 80) { pageNum++; y = newPage(true); }
    const isLast = (i === secRows.length - 1);
    y = secDrawDataRow(allPages[allPages.length - 1], f, secRows[i].values, y, isLast);
  }

  if (secRows.length === 0) {
    drawMixed(allPages[allPages.length - 1], '(No company secretaries)', {
      x: MARGIN + 5, y: y - 18, size: 9, cjk: f.cjk, ascii: f.ascii, color: rgb(0.5, 0.5, 0.5),
    });
  }
}

// ═══════════════════════════════════════════════════════════
async function main() {
  // Try local font first, then CDN (matching _pdf-utils.ts fallback chain)
  const CDN_URL = 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2';
  const localPaths = [
    'D:/myproject/秘书系统文件/NotoSansTC.woff2',
    'D:/myproject/darling-dupe-maker/NotoSansTC.woff2',
  ];
  let cjkBytes = null;
  for (const p of localPaths) {
    if (fs.existsSync(p)) { cjkBytes = fs.readFileSync(p); console.log('📦 CJK font loaded from:', p); break; }
  }
  if (!cjkBytes) {
    console.log('🌐 Downloading CJK font from CDN...');
    try {
      const resp = await fetch(CDN_URL);
      if (resp.ok) {
        cjkBytes = Buffer.from(await resp.arrayBuffer());
        console.log('✅ CJK font downloaded from CDN');
      }
    } catch (e) { console.error('CDN download failed:', e.message); }
  }
  if (!cjkBytes) { console.error('❌ CJK font not available'); process.exit(1); }

  async function makeFonts(pdf) {
    pdf.registerFontkit(fontkit);
    const ascii = await pdf.embedFont(StandardFonts.Helvetica);
    const cjk = cjkBytes ? await pdf.embedFont(cjkBytes) : ascii;
    return { cjk, ascii };
  }

  fs.mkdirSync(OUT, { recursive: true });

  // Generate ROD
  console.log('🏗️  Generating ROD test PDF...');
  const rodPdf = await PDFDocument.create();
  const fRod = await makeFonts(rodPdf);
  await buildROD(fRod, rodPdf);
  fs.writeFileSync(path.join(OUT, 'rod_test.pdf'), await rodPdf.save());
  console.log('✅ ROD PDF saved → _rom_check_output/rod_test.pdf');

  // Generate Secretaries
  console.log('🏗️  Generating Secretaries test PDF...');
  const secPdf = await PDFDocument.create();
  const fSec = await makeFonts(secPdf);
  await buildSEC(fSec, secPdf);
  fs.writeFileSync(path.join(OUT, 'sec_test.pdf'), await secPdf.save());
  console.log('✅ Secretaries PDF saved → _rom_check_output/sec_test.pdf');

  console.log('\n📋 Ready for 千问 VL review. Upload both PDFs and compare against:');
  console.log('   ROD reference: 秘书系统文件/rod rom/Testing ROD.rtf');
  console.log('   SEC reference: should match ROD style (same columns, left-aligned header)');
}

main().catch(e => { console.error(e); process.exit(1); });
