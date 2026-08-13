// POST /api/generate-shareholders-register-pdf
// Register of Members (ROM) — Paul Tang「Lung Shun - ROM」模板（2026-08-13 重写）
// R2 背景模板 = Lung Shun ROM 样本第 1 页（黑色表格、15 列交易表、每股东 5 行交易）
// 叠加真实数据（白块覆盖样本值 + 重绘）→ 与 Paul Tang 样本排版一致
import { PDFDocument, rgb } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  uint8ToBase64, fetchAndEmbedFont, rget,
  drawMixed, widthOfText,
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

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

// ══════════════════════════════════════════════════════════════
// 几何数据来自 Lung Shun - ROM 样本 PDF（PyMuPDF 提取，pdf-lib 坐标）
// 表格：15 列；信息块 2 行（FullName / Address）；交易表 5 行
// 对齐：Date 左对齐；其余列全部居中对齐；字号 9（表头 11）
// ══════════════════════════════════════════════════════════════

const MAX_TX_ROWS = 5;

// ── 页眉（公司名 EN/ZH 两行 + Company Number，黑色）──
const HEADER = {
  nameEn: { x: 134.7, y: 511.1, size: 11 },
  nameZh: { x: 134.7, y: 498.5, size: 11 },
  br:     { x: 133.9, y: 478.9, size: 11, bold: true },
  // 白块覆盖样本值（精确 bbox ±1pt，避开下划线 496.9）
  covers: {
    en: { x: 133.7, y: 510,   w: 177, h: 14.6 },
    zh: { x: 133.7, y: 497.4, w: 91,  h: 13.3 },
    br: { x: 132.9, y: 477.4, w: 55,  h: 14.9 },
  },
  // BR 覆盖块压住了下划线 478.9 → 重绘
  brUnderline: { x0: 134.7, x1: 340, y: 478.9 },
};

interface Block {
  name:    { x: number; y: number };
  occ:     { x: number; y: number };
  entered: { x: number; y: number };
  addr:    { x: number; y: number };
  cease:   { x: number; y: number };
  covers: {
    name:    { x: number; y: number; w: number; h: number };
    occ:     { x: number; y: number; w: number; h: number };
    entered: { x: number; y: number; w: number; h: number };
    addr:    { x: number; y: number; w: number; h: number };
  };
  rowsTop: number[];     // 5 行交易表每行上边框
  rowsBottom: number[];
}

// 每页 2 个股东区块（SH1 上、SH2 下），结构相同
const BLOCKS: Block[] = [
  {
    name: { x: 136.3, y: 460.3 }, occ: { x: 420, y: 459.8 },
    entered: { x: 738.5, y: 459.8 }, addr: { x: 116.8, y: 447.3 },
    cease: { x: 712, y: 447.3 },
    covers: {
      name:    { x: 135.3, y: 459.5, w: 98,   h: 11.5 },
      occ:     { x: 419,   y: 459.5, w: 42,   h: 11 },
      entered: { x: 737.5, y: 459.5, w: 49.5, h: 11 },
      addr:    { x: 115.8, y: 447.6, w: 402,  h: 10.3 },
    },
    rowsTop:    [399.3, 375.0, 350.8, 326.7, 302.4],
    rowsBottom: [375.0, 350.8, 326.7, 302.4, 278.2],
  },
  {
    name: { x: 136.3, y: 259.9 }, occ: { x: 420, y: 259.4 },
    entered: { x: 738.5, y: 259.4 }, addr: { x: 116.8, y: 245.2 },
    cease: { x: 712, y: 245.2 },
    covers: {
      name:    { x: 135.3, y: 258.9, w: 98,   h: 11.5 },
      occ:     { x: 419,   y: 258.9, w: 42,   h: 11 },
      entered: { x: 737.5, y: 258.9, w: 49.5, h: 11 },
      addr:    { x: 115.8, y: 245.6, w: 402,  h: 10.3 },
    },
    rowsTop:    [195.5, 171.2, 147.0, 122.9, 98.6],
    rowsBottom: [171.2, 147.0, 122.9, 98.6, 74.4],
  },
];

// 15 列中心 x（Date 列左对齐特殊处理）
const COLS = {
  date:    { cx: 38.6,  align: "L" as const },
  cert:    { cx: 118.1 },
  from:    { cx: 163.85 },
  to:      { cx: 206.35 },
  shares:  { cx: 251.95 },
  consid:  { cx: 309.3 },
  deed:    { cx: 369.25 },
  cert2:   { cx: 420.35 },
  from2:   { cx: 465.75 },
  to2:     { cx: 511.7 },
  shares2: { cx: 560.8 },
  consid2: { cx: 618.2 },
  total:   { cx: 679.1 },
  remarks: { cx: 740.2 },
  entry:   { cx: 794.65 },
};

const ROW_BASE = -18;  // 数据基线 = 行上边框 - 18

// ── 小工具 ──

function fmtDate(v: string): string {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(v).slice(0, 10);
}

function fmtMoney(cur: string, amt: number): string {
  if (!isFinite(amt) || amt <= 0) return '';
  return `${cur} ${amt.toFixed(2)}`;
}

function cover(page: any, c: { x: number; y: number; w: number; h: number }) {
  page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: WHITE });
}

// 居中画文字（混合中英文字体）
function drawCenter(page: any, text: string, cx: number, y: number, size: number, fo: { cjk: any; ascii: any }) {
  if (!text) return;
  const str = String(text);
  const w = widthOfText(str, fo.cjk, fo.ascii, size);
  drawMixed(page, str, { x: cx - w / 2, y, size, cjk: fo.cjk, ascii: fo.ascii, color: BLACK });
}

// ══════════════════════════════════════════════════════════════
export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const { companyId } = await request.json() as any;
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [company, rolesResult, txResult, templateObj] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'shareholder' ORDER BY date_appointed")
        .bind(companyId).all(),
      env.DB.prepare("SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date")
        .bind(companyId).all(),
      env.PDF_TEMPLATES.get("rom-template-bg.pdf"),
    ]);

    if (!company) throw new Error("Company not found");
    if (!templateObj) throw new Error("ROM template not found in R2");

    const roles = (rolesResult.results || []) as any[];
    const transactions = (txResult.results || []) as any[];

    const personIds = roles.map((r: any) => r.person_id).filter(Boolean);
    const personMap = new Map<string, any>();
    if (personIds.length > 0) {
      const placeholders = personIds.map(() => '?').join(',');
      const result = await env.DB.prepare(
        `SELECT * FROM persons WHERE id IN (${placeholders})`
      ).bind(...personIds).all();
      (result.results || []).forEach((p: any) => personMap.set(p.id, p));
    }

    const txByName = new Map<string, any[]>();
    for (const t of transactions) {
      const key = (rget(t, 'from_name') || rget(t, 'to_name') || "").trim().toUpperCase();
      if (key) {
        if (!txByName.has(key)) txByName.set(key, []);
        txByName.get(key)!.push(t);
      }
    }

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdf = await PDFDocument.create();
    const { cjk: cjkFont, ascii: asciiFont } = await fetchAndEmbedFont(pdf, env as any);
    const fo = { cjk: cjkFont, ascii: asciiFont };

    const templateDoc = await PDFDocument.load(templateBytes);
    // 只用第 1 页（模板第 2 页为空白页）
    const [templatePage] = await pdf.embedPages([templateDoc.getPage(0)]);

    const coNameEn = (rget(company, 'name') || '').slice(0, 40);
    const coNameZh = (rget(company, 'chinese_name') || rget(company, 'name_chinese') || '').slice(0, 18);
    const br = (rget(company, 'company_number') || '').slice(0, 15);

    // ── 股东数据（样本格式：Full Name "EN ZH" / Occupation / Date Entered / Address / Date Ceasing）──
    interface TxRow {
      side: 'acquired' | 'transferred';
      date: string; cert: string; shares: string;
      money: string; deed: string;
      total: number; remarks: string;
    }
    interface ShData {
      fullName: string; occ: string; addr: string;
      dateApp: string; dateCea: string;
      rows: TxRow[];
    }
    const shareholders: ShData[] = [];
    for (const r of roles) {
      const p = personMap.get(r.person_id) || {};
      const nameEn = (rget(p, 'name_english') || '(unnamed)').slice(0, 30);
      const nameZh = (rget(p, 'name_chinese') || '').slice(0, 12);
      const fullName = [nameEn, nameZh].filter(Boolean).join(' ').slice(0, 45);

      let addr = [
        rget(p, 'addr_flat'), rget(p, 'addr_building'),
        rget(p, 'addr_street'), rget(p, 'addr_district'),
      ].filter(Boolean).join(', ');
      const region = rget(p, 'addr_region') || '';
      if (!addr) addr = rget(p, 'address') || '';
      if (region && !addr.includes(region)) addr = addr ? `${addr}, ${region}` : region;
      addr = addr.slice(0, 100);

      const occ = (rget(p, 'occupation') || '').slice(0, 30);
      const dateApp = fmtDate(rget(r, 'date_appointed'));
      const dateCea = fmtDate(rget(r, 'date_ceased'));
      const shares0 = Number(rget(r, 'shares') || 0);
      const certNo = (rget(r, 'certificate_number') || '-').slice(0, 20);
      const currency = rget(r, 'currency') || 'HKD';
      const issuePrice = Number(rget(r, 'issue_price') || 0);
      const personNameKey = nameEn.trim().toUpperCase();

      // ── 交易行（样本语义）──
      // 行0 = 初始 Subscription（date=入册日、cert/from/to=证书号、shares、HKD 代价、total、Remarks=Subscription）
      // 后续 = 交易：Allotment/Transfer In → 购入半边；Transfer Out → 转让半边
      // Total Shares Held = 累计结余（居中）；Entry Made By 留空
      const rows: TxRow[] = [];
      let balance = shares0;
      if (shares0 > 0) {
        rows.push({
          side: 'acquired',
          date: dateApp, cert: certNo, shares: String(shares0),
          money: issuePrice > 0 ? fmtMoney(currency, shares0 * issuePrice) : '',
          deed: '',
          total: balance, remarks: 'Subscription',
        });
      }
      for (const tx of (txByName.get(personNameKey) || [])) {
        if (rows.length >= MAX_TX_ROWS) break;
        const txShares = Number(rget(tx, 'shares') || 0);
        if (!txShares) continue;
        const cur = rget(tx, 'currency') || currency;
        const totalConsid = Number(rget(tx, 'total_consideration') || 0);
        const priceEach = Number(rget(tx, 'price_per_share') || 0);
        const money = totalConsid > 0 ? fmtMoney(cur, totalConsid)
          : priceEach > 0 ? fmtMoney(cur, txShares * priceEach) : '';
        const date = fmtDate(rget(tx, 'transaction_date'));
        const deed = (rget(tx, 'instrument_number') || '').slice(0, 20);

        const isAllot = (rget(tx, 'transaction_type') || '').toLowerCase().includes('allot');
        const isIn = !isAllot && (rget(tx, 'to_name') || '').trim().toUpperCase() === personNameKey;
        const isOut = !isAllot && (rget(tx, 'from_name') || '').trim().toUpperCase() === personNameKey;
        if (isOut) {
          balance -= txShares;
          rows.push({
            side: 'transferred', date, cert: certNo, shares: String(txShares),
            money, deed,
            total: balance, remarks: 'Transfer Out',
          });
        } else {
          balance += txShares;
          rows.push({
            side: 'acquired', date, cert: certNo, shares: String(txShares),
            money, deed: '',
            total: balance, remarks: isAllot ? 'Allotment' : 'Transfer In',
          });
        }
      }

      shareholders.push({ fullName, occ, addr, dateApp, dateCea, rows });
    }

    // ── 渲染 ──
    const drawHeader = (page: any) => {
      for (const k of ['en', 'zh', 'br'] as const) cover(page, HEADER.covers[k]);
      drawMixed(page, coNameEn, { x: HEADER.nameEn.x, y: HEADER.nameEn.y, size: HEADER.nameEn.size, cjk: fo.cjk, ascii: fo.ascii, color: BLACK });
      if (coNameZh) drawMixed(page, coNameZh, { x: HEADER.nameZh.x, y: HEADER.nameZh.y, size: HEADER.nameZh.size, cjk: fo.cjk, ascii: fo.ascii, color: BLACK });
      if (br) drawMixed(page, br, { x: HEADER.br.x, y: HEADER.br.y, size: HEADER.br.size, cjk: fo.cjk, ascii: fo.ascii, bold: true, color: BLACK });
      // BR 下划线被覆盖块压住 → 重绘
      page.drawLine({
        start: { x: HEADER.brUnderline.x0, y: HEADER.brUnderline.y },
        end: { x: HEADER.brUnderline.x1, y: HEADER.brUnderline.y },
        thickness: 0.5, color: BLACK,
      });
    };

    // 覆盖一个股东区块的全部样本值（信息块 + 5 行交易带，边框线保留）
    const coverBlock = (page: any, b: Block) => {
      for (const k of ['name', 'occ', 'entered', 'addr'] as const) cover(page, b.covers[k]);
      for (let i = 0; i < MAX_TX_ROWS; i++) {
        const top = b.rowsTop[i], bottom = b.rowsBottom[i];
        page.drawRectangle({
          x: 29, y: bottom + 1.2, width: 816 - 29, height: (top - bottom) - 2.4, color: WHITE,
        });
      }
    };

    const drawShareholder = (page: any, sh: ShData, b: Block) => {
      drawMixed(page, sh.fullName, { x: b.name.x, y: b.name.y, size: 9, cjk: fo.cjk, ascii: fo.ascii, color: BLACK });
      if (sh.occ) drawMixed(page, sh.occ, { x: b.occ.x, y: b.occ.y, size: 9, cjk: fo.cjk, ascii: fo.ascii, color: BLACK });
      if (sh.dateApp) drawMixed(page, sh.dateApp, { x: b.entered.x, y: b.entered.y, size: 9, cjk: fo.cjk, ascii: fo.ascii, color: BLACK });
      if (sh.addr) drawMixed(page, sh.addr, { x: b.addr.x, y: b.addr.y, size: 9, cjk: fo.cjk, ascii: fo.ascii, color: BLACK });
      if (sh.dateCea) drawMixed(page, sh.dateCea, { x: b.cease.x, y: b.cease.y, size: 9, cjk: fo.cjk, ascii: fo.ascii, color: BLACK });

      sh.rows.forEach((row, i) => {
        if (i >= MAX_TX_ROWS) return;
        const y = b.rowsTop[i] + ROW_BASE;
        if (row.side === 'acquired') {
          drawMixed(page, row.date, { x: COLS.date.cx, y, size: 9, cjk: fo.cjk, ascii: fo.ascii, color: BLACK });
          drawCenter(page, row.cert, COLS.cert.cx, y, 9, fo);
          drawCenter(page, row.cert, COLS.from.cx, y, 9, fo);
          drawCenter(page, row.cert, COLS.to.cx, y, 9, fo);
          drawCenter(page, row.shares, COLS.shares.cx, y, 9, fo);
          drawCenter(page, row.money, COLS.consid.cx, y, 9, fo);
        } else {
          drawCenter(page, row.deed, COLS.deed.cx, y, 9, fo);
          drawCenter(page, row.cert, COLS.cert2.cx, y, 9, fo);
          drawCenter(page, row.cert, COLS.from2.cx, y, 9, fo);
          drawCenter(page, row.cert, COLS.to2.cx, y, 9, fo);
          drawCenter(page, row.shares, COLS.shares2.cx, y, 9, fo);
          drawCenter(page, row.money, COLS.consid2.cx, y, 9, fo);
        }
        drawCenter(page, String(row.total), COLS.total.cx, y, 9, fo);
        drawCenter(page, row.remarks, COLS.remarks.cx, y, 9, fo);
        // Entry Made By 按样本留空
      });
    };

    let page = pdf.addPage([PW, PH]);
    page.drawPage(templatePage);
    drawHeader(page);

    let shIdx = 0;
    while (shIdx < shareholders.length) {
      const sh = shareholders[shIdx];
      const block = BLOCKS[shIdx % 2];
      coverBlock(page, block);
      drawShareholder(page, sh, block);
      shIdx++;
      // 每页 2 个股东，翻页时重贴背景 + 页眉
      if (shIdx < shareholders.length && shIdx % 2 === 0) {
        page = pdf.addPage([PW, PH]);
        page.drawPage(templatePage);
        drawHeader(page);
      }
    }

    // 奇数股东时覆盖本页未使用的 SH2 区块样本值（保留空白表格结构）
    if (shareholders.length % 2 === 1) {
      coverBlock(page, BLOCKS[1]);
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
