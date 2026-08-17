// POST /api/generate-shareholders-register-pdf
// Register of Members (ROM) — Paul Tang「Lung Shun - ROM」模板（2026-08-13 重写）
// R2 背景模板 = Lung Shun ROM 样本第 1 页（黑色表格、15 列交易表、每股东 5 行交易）
// 叠加真实数据（白块覆盖样本值 + 重绘）→ 与 Paul Tang 样本排版一致
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
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
  // 白块覆盖样本值（下延至边框线上方 ~0.2pt，盖住样本文字下伸笔画 — 2026-08-13 像素仲裁）
  covers: {
    en: { x: 133.7, y: 508.0, w: 177, h: 16.6 },
    zh: { x: 133.7, y: 496.7, w: 91,  h: 14.0 },
    br: { x: 132.9, y: 476.7, w: 55,  h: 15.6 },
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
      name:    { x: 135.3, y: 458.8, w: 98,   h: 12.2 },
      occ:     { x: 419,   y: 458.8, w: 42,   h: 11.7 },
      entered: { x: 737.5, y: 458.8, w: 49.5, h: 11.7 },
      addr:    { x: 115.8, y: 446.9, w: 402,  h: 11.0 },
    },
    rowsTop:    [399.3, 375.0, 350.8, 326.7, 302.4],
    rowsBottom: [375.0, 350.8, 326.7, 302.4, 278.2],
  },
  {
    name: { x: 136.3, y: 259.9 }, occ: { x: 420, y: 259.4 },
    entered: { x: 738.5, y: 259.4 }, addr: { x: 116.8, y: 245.2 },
    cease: { x: 712, y: 245.2 },
    covers: {
      name:    { x: 135.3, y: 258.2, w: 98,   h: 12.2 },
      occ:     { x: 419,   y: 258.2, w: 42,   h: 11.7 },
      entered: { x: 737.5, y: 258.2, w: 49.5, h: 11.7 },
      addr:    { x: 115.8, y: 244.3, w: 402,  h: 11.6 },
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
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const m2 = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m2) return `${m2[1]}/${m2[2]}/${m2[3]}`;
  return s.slice(0, 10);
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
// 快速路径：预烘焙画布 + 运行时增量追加（2026-08-13 CPU 优化）
// 慢路径每次请求 pdf.save() 16-28ms，CF 30ms CPU 限额边缘 → 间歇 503。
// 快速路径 = R2 预烘焙画布（模板页+白块覆盖+全字符子集字体已嵌入，离线生成
// 见 scripts/build_rom_canvas.cjs）+ 运行时纯字符串追加文本流对象（hex Tj，
// 无字体嵌入/无 save()），CPU ~3-5ms。缺失字符/画布缺失 → 回退慢路径。
// ══════════════════════════════════════════════════════════════

// Helvetica AFM 宽度表（1/1000 em）— 与 pdf-lib StandardFonts.Helvetica 一致
const HELV_W: Record<number, number> = {
  32:278,33:278,34:355,35:556,36:556,37:889,38:667,39:191,40:333,41:333,42:389,43:584,44:278,45:333,46:278,47:278,
  48:556,49:556,50:556,51:556,52:556,53:556,54:556,55:556,56:556,57:556,58:278,59:278,60:584,61:584,62:584,63:556,
  64:1015,65:667,66:667,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:500,75:667,76:556,77:833,78:722,79:778,
  80:667,81:778,82:722,83:667,84:611,85:722,86:667,87:944,88:667,89:667,90:611,91:278,92:278,93:278,94:469,95:556,
  96:333,97:556,98:556,99:500,100:556,101:556,102:278,103:556,104:556,105:222,106:222,107:500,108:222,109:833,110:556,
  111:556,112:556,113:556,114:333,115:500,116:278,117:556,118:500,119:722,120:500,121:500,122:500,123:334,124:260,125:334,126:584,
};

interface RomCanvasStruct {
  startxref: number;
  maxObj: number;
  pageRef: string;
  pagesRef: string;
  rootRef: string;
  coverStreamRef: string;
  pageDict: string;
  pagesDict: string;
  cjkName: string;
  arialName?: string;   // Arial 子集字体（与模板背景 Arial 一致，2026-08-17）
  helvName?: string;    // 旧画布兼容（Helvetica）
  chars: Record<string, { c: string; w: number }>;
  asciiChars?: Record<string, { c: string; w: number }>;  // ASCII+Latin1 → Arial 码表
}

// 模块级缓存：同 isolate 内跨请求复用（CF 模块作用域持久）
// ⚠️ TTL 10 分钟强制重取：isolate 可存活数分钟~数小时，画布更新后不重取会一直用旧版（2026-08-17 教训）
const ROM_CANVAS_TTL_MS = 10 * 60 * 1000;
let romCanvas: { bytes: Uint8Array; struct: RomCanvasStruct; at: number } | null = null;
let romCanvasFailed = false;
let romCanvasFailedAt = 0;

async function getRomCanvas(env: Env): Promise<{ bytes: Uint8Array; struct: RomCanvasStruct } | null> {
  const now = Date.now();
  if (romCanvas && now - romCanvas.at < ROM_CANVAS_TTL_MS) return romCanvas;
  if (romCanvasFailed && now - romCanvasFailedAt < ROM_CANVAS_TTL_MS) return null;
  try {
    const [pdfObj, jsonObj] = await Promise.all([
      env.PDF_TEMPLATES.get("rom-canvas.pdf"),
      env.PDF_TEMPLATES.get("rom-canvas.json"),
    ]);
    if (!pdfObj || !jsonObj) {
      romCanvasFailed = true;
      romCanvasFailedAt = now;
      return null;
    }
    romCanvas = {
      bytes: new Uint8Array(await pdfObj.arrayBuffer()),
      struct: JSON.parse(await jsonObj.text()),
      at: now,
    };
    romCanvasFailed = false;
    return romCanvas;
  } catch (e: any) {
    console.error("ROM canvas load failed:", e?.message || e);
    romCanvasFailed = true;
    romCanvasFailedAt = now;
    return null;
  }
}

// 快速路径文本宽度（pt）— ASCII/Latin1 用 Arial 码表，CJK 用画布字符表
function fastFontOf(S: RomCanvasStruct, ch: string): "a" | "c" {
  const c = ch.charCodeAt(0);
  if (c <= 0x7F) return "a";
  if (S.asciiChars && S.asciiChars[ch]) return "a"; // Latin-1 扩展（é £ ¥ €…）→ Arial
  return "c";
}

function fastTextWidth(S: RomCanvasStruct, text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    if (fastFontOf(S, ch) === "a") {
      const aw = S.asciiChars && S.asciiChars[ch] ? S.asciiChars[ch].w : HELV_W[ch.charCodeAt(0)] || 500;
      w += (aw / 1000) * size;
    } else {
      w += ((S.chars[ch] ? S.chars[ch].w : 1000) / 1000) * size;
    }
  }
  return w;
}

const escHex = (s: string) =>
  s.split("").map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");

// 一行文本 → 内容流操作符（按 Arial/CJK 分段；bold = 同字体 x+0.5 重绘，与 drawMixed 一致）
function fastTextOps(S: RomCanvasStruct, x: number, y: number, size: number, text: string, bold: boolean): string {
  const clean = (text || "").replace(/[\n\r\t]/g, " ");
  let ops = "";
  let seg = "", segKind: "a" | "c" | null = null;
  const flush = () => {
    if (!seg) return;
    const fontName = segKind === "a" ? (S.arialName || S.helvName || S.cjkName) : S.cjkName;
    let hex = "";
    for (const ch of seg) {
      if (segKind === "a") hex += S.asciiChars && S.asciiChars[ch] ? S.asciiChars[ch].c : escHex(ch);
      else hex += S.chars[ch].c;
    }
    ops += `BT /${fontName} ${size} Tf 1 0 0 1 ${x} ${y} Tm <${hex}> Tj ET\n`;
    if (bold) ops += `BT /${fontName} ${size} Tf 1 0 0 1 ${x + 0.5} ${y} Tm <${hex}> Tj ET\n`;
    x += fastTextWidth(S, seg, size);
    seg = ""; segKind = null;
  };
  for (const ch of clean) {
    const kind = fastFontOf(S, ch);
    if (segKind === null) segKind = kind;
    else if (segKind !== kind) { flush(); segKind = kind; }
    seg += ch;
  }
  flush();
  return ops;
}

// 居中画（cx = 中心 x）— 与 drawCenter 一致
function fastCenterOps(S: RomCanvasStruct, cx: number, y: number, size: number, text: string, bold: boolean): string {
  if (!text) return "";
  const t = String(text);
  return fastTextOps(S, cx - fastTextWidth(S, t, size) / 2, y, size, t, bold);
}

// 预扫描：任一字符不在画布字体码表（Arial Latin1 或 CJK）→ 返回该字符（走慢路径，防字形字节错位）
function fastPathMissingChar(S: RomCanvasStruct, texts: string[]): string | null {
  for (const t of texts) {
    for (const ch of t) {
      if (ch.charCodeAt(0) > 0x7F) {
        if (S.asciiChars && S.asciiChars[ch]) continue; // Latin-1 扩展 → Arial 码表
        if (!S.chars[ch]) return ch;
      }
    }
  }
  return null;
}

// 单页文本流（页眉 + 2 股东区块）— 几何与慢路径 drawHeader/drawShareholder 完全一致
interface FastSh {
  fullName: string; occ: string; addr: string;
  dateApp: string; dateCea: string;
  rows: { side: string; date: string; cert: string; shares: string; money: string; deed: string; total: number; remarks: string }[];
}
function buildFastPageText(S: RomCanvasStruct, co: { en: string; zh: string; br: string }, shs: FastSh[]): string {
  let ops = "";
  ops += fastTextOps(S, HEADER.nameEn.x, HEADER.nameEn.y, HEADER.nameEn.size, co.en, false);
  if (co.zh) ops += fastTextOps(S, HEADER.nameZh.x, HEADER.nameZh.y, HEADER.nameZh.size, co.zh, false);
  if (co.br) ops += fastTextOps(S, HEADER.br.x, HEADER.br.y, HEADER.br.size, co.br, true);
  shs.forEach((sh, i) => {
    const b = BLOCKS[i % 2];
    ops += fastTextOps(S, b.name.x, b.name.y, 9, sh.fullName, false);
    if (sh.occ) ops += fastTextOps(S, b.occ.x, b.occ.y, 9, sh.occ, false);
    if (sh.dateApp) ops += fastTextOps(S, b.entered.x, b.entered.y, 9, sh.dateApp, false);
    if (sh.addr) ops += fastTextOps(S, b.addr.x, b.addr.y, 9, sh.addr, false);
    if (sh.dateCea) ops += fastTextOps(S, b.cease.x, b.cease.y, 9, sh.dateCea, false);
    sh.rows.forEach((row, ri) => {
      if (ri >= MAX_TX_ROWS) return;
      const y = b.rowsTop[ri] + ROW_BASE;
      if (row.side === "acquired") {
        ops += fastTextOps(S, COLS.date.cx, y, 9, row.date, false);
        ops += fastCenterOps(S, COLS.cert.cx, y, 9, row.cert, false);
        ops += fastCenterOps(S, COLS.from.cx, y, 9, row.cert, false);
        ops += fastCenterOps(S, COLS.to.cx, y, 9, row.cert, false);
        ops += fastCenterOps(S, COLS.shares.cx, y, 9, row.shares, false);
        ops += fastCenterOps(S, COLS.consid.cx, y, 9, row.money, false);
      } else {
        ops += fastCenterOps(S, COLS.deed.cx, y, 9, row.deed, false);
        ops += fastCenterOps(S, COLS.cert2.cx, y, 9, row.cert, false);
        ops += fastCenterOps(S, COLS.from2.cx, y, 9, row.cert, false);
        ops += fastCenterOps(S, COLS.to2.cx, y, 9, row.cert, false);
        ops += fastCenterOps(S, COLS.shares2.cx, y, 9, row.shares, false);
        ops += fastCenterOps(S, COLS.consid2.cx, y, 9, row.money, false);
      }
      ops += fastCenterOps(S, COLS.total.cx, y, 9, String(row.total), false);
      ops += fastCenterOps(S, COLS.remarks.cx, y, 9, row.remarks, false);
    });
  });
  return ops;
}

// 增量更新组装：文本流+页对象追加 + 新 xref table + /Prev trailer（纯字符串拼接）
function buildFastPdf(canvas: { bytes: Uint8Array; struct: RomCanvasStruct }, pagesText: string[]): Uint8Array {
  const S = canvas.struct;
  const numPages = pagesText.length;
  const pageRefNum = Number(S.pageRef.split(" ")[0]);
  const pagesRefNum = Number(S.pagesRef.split(" ")[0]);
  const rootRefNum = Number(S.rootRef.split(" ")[0]);

  const objMap = new Map<number, string>();
  let nextObj = S.maxObj + 1;
  const addObj = (num: number, bytes: string) => { objMap.set(num, bytes); return num; };

  // 文本流 + 页对象（第 1 页重写原页号，后续新建）
  const textRefs: number[] = [];
  const pageRefs: number[] = [pageRefNum];
  for (let p = 0; p < numPages; p++) {
    const body = pagesText[p];
    const num = nextObj++;
    addObj(num, `${num} 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`);
    textRefs.push(num);
    if (p > 0) pageRefs.push(nextObj++);
  }
  for (let p = 0; p < numPages; p++) {
    const contents = `[ ${S.coverStreamRef} ${textRefs[p]} 0 R ]`;
    const pageDict = S.pageDict.replace(/\/Contents\s*\[[^\]]*\]/, "/Contents " + contents);
    addObj(pageRefs[p], `${pageRefs[p]} 0 obj\n${pageDict}\nendobj\n`);
  }
  // Pages 树重写（多页时）
  if (numPages > 1) {
    const kids = pageRefs.map((n) => `${n} 0 R`).join(" ");
    const pagesDict = S.pagesDict
      .replace(/\/Kids\s*\[[^\]]*\]/, `/Kids [ ${kids} ]`)
      .replace(/\/Count\s+\d+/, `/Count ${numPages}`);
    addObj(pagesRefNum, `${pagesRefNum} 0 obj\n${pagesDict}\nendobj\n`);
  }

  // 组装（对象按 num 升序写；所有字节均为 latin1 → 字符串长度即字节数）
  const listed = [...objMap.keys()].sort((a, b) => a - b);
  let objsBytes = "";
  let cursor = canvas.bytes.length + 1;
  const byteOffsets: Record<number, number> = {};
  for (const num of listed) {
    byteOffsets[num] = cursor;
    const b = objMap.get(num)!;
    objsBytes += b;
    cursor += b.length;
  }
  const xrefOffset = canvas.bytes.length + 1 + objsBytes.length;

  // xref 子段（连续对象号合并）
  const subsections: { start: number; count: number }[] = [];
  for (const n of listed) {
    const last = subsections[subsections.length - 1];
    if (last && last.start + last.count === n) last.count++;
    else subsections.push({ start: n, count: 1 });
  }
  let xrefStr = "xref\n";
  for (const s of subsections) xrefStr += `${s.start} ${s.count}\n`;
  for (const n of listed) xrefStr += `${String(byteOffsets[n]).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${nextObj} /Root ${rootRefNum} 0 R /Prev ${S.startxref} >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const head = new Uint8Array(canvas.bytes.length + 1 + objsBytes.length + xrefStr.length + trailer.length);
  head.set(canvas.bytes, 0);
  let pos = canvas.bytes.length;
  const appendStr = (s: string) => {
    for (let i = 0; i < s.length; i++) head[pos++] = s.charCodeAt(i) & 0xFF;
  };
  appendStr("\n" + objsBytes);
  appendStr(xrefStr + trailer);
  return head;
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

    const [company, rolesResult, txResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'shareholder' ORDER BY date_appointed")
        .bind(companyId).all(),
      env.DB.prepare("SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date")
        .bind(companyId).all(),
    ]);

    if (!company) throw new Error("Company not found");

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
      const nameEn = (rget(p, 'name_english') || '(unnamed)').slice(0, 40);
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

      // 股东名字不含 limited/ltd（非公司）→ occupation 默认 Merchant（香港惯例），DB 有值则保留
      const isCorpName = /limited|ltd\b/i.test(nameEn);
      const occ = (rget(p, 'occupation') || (isCorpName ? '' : 'Merchant')).slice(0, 30);
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

    // ── 渲染：快速路径（画布+增量追加）优先，缺字/无画布 → 回退慢路径 ──
    const canvas = await getRomCanvas(env);
    if (canvas && shareholders.length > 0) {
      const allTexts = [coNameEn, coNameZh, br];
      for (const sh of shareholders) {
        allTexts.push(sh.fullName, sh.occ, sh.addr, sh.dateApp, sh.dateCea);
        for (const r of sh.rows) allTexts.push(r.date, r.cert, r.shares, r.money, r.deed, String(r.total), r.remarks);
      }
      if (!fastPathMissingChar(canvas.struct, allTexts)) {
        try {
          const pagesText: string[] = [];
          for (let i = 0; i < shareholders.length; i += 2) {
            pagesText.push(buildFastPageText(canvas.struct, { en: coNameEn, zh: coNameZh, br }, shareholders.slice(i, i + 2)));
          }
          const out = buildFastPdf(canvas, pagesText);
          return new Response(JSON.stringify({ pdf: uint8ToBase64(out) }), {
            headers: {
              ...corsHeaders, "Content-Type": "application/json",
              "X-Rom-Path": "fast",
              "X-Rom-Canvas": `${canvas.bytes.length}:${canvas.struct.arialName || canvas.struct.helvName || "?"}`,
            },
          });
        } catch (e: any) {
          console.error("ROM fast path failed — falling back to slow path:", e?.message || e);
        }
      }
    }

    // ── 慢路径（原 pdf-lib 渲染逻辑）──
    const templateObj = await env.PDF_TEMPLATES.get("rom-template-bg.pdf");
    if (!templateObj) throw new Error("ROM template not found in R2");
    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdf = await PDFDocument.create();
    const { cjk: cjkFont } = await fetchAndEmbedFont(pdf, env as any);
    // ASCII 字体用 Arial 子集（与模板背景 Arial 字体一致，2026-08-17 字体统一）；缺失回退 Helvetica
    let asciiFont: any = null;
    try {
      const arialObj = await env.PDF_TEMPLATES.get("fonts/arial-subset.ttf");
      if (arialObj) {
        pdf.registerFontkit(fontkit);
        asciiFont = await pdf.embedFont(await arialObj.arrayBuffer());
      }
    } catch (e: any) {
      console.error("ROM Arial subset embed failed:", e?.message || e);
    }
    if (!asciiFont) asciiFont = await pdf.embedFont(StandardFonts.Helvetica);
    const fo = { cjk: cjkFont, ascii: asciiFont };
    const templateDoc = await PDFDocument.load(templateBytes);
    // 只用第 1 页（模板第 2 页为空白页）
    const [templatePage] = await pdf.embedPages([templateDoc.getPage(0)]);

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
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-Rom-Path": "slow" },
    });
  } catch (e: any) {
    console.error("generate-shareholders-register-pdf error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
