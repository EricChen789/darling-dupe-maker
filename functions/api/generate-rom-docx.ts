// POST /api/generate-rom-docx
// Generate ROM (Register of Members) DOCX from Lung Shun - ROM.doc template (2026-08-13 rewrite).
// Uses pre-extracted DOCX ZIP entries from _template_rom_lungshun_template.ts.
// Cell semantics taken from the Lung Shun sample data (per-block):
//   R0: Name of Company (EN line + ZH line) | R1: Company Number
//   Info row: Full Name | Occupation | Date Entered as a Member
//   Addr row: Address | Date of Ceasing to be Member
//   5 tx rows × 15 cols: Date | Cert | From | To | Shares | Consideration | Deed |
//     Cert2 | From2 | To2 | Shares2 | Consid2 | Total | Remarks | Entry By
//   Row 0 = Subscription; subsequent = Allotment/Transfer In (acq half) / Transfer Out (xfer half)
// Block B (rows 14-23) is cloned for 3+ shareholders.
import { verifyAuthRequest, type Env } from './_auth';
import ROM_TEMPLATE from './_template_rom_lungshun_template';
import { sortRolesByAppointment, certNoOf, buildSeqByName, dateSortKey } from './_shareholder-seq';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Helpers ──
function rget(obj: any, key: string): string {
  const v = obj?.[key];
  return v != null ? String(v) : '';
}

function escXml(s: string): string {
  const escaped = (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // Encode as UTF-8 bytes represented as Latin1 chars, so btoa() doesn't choke
  // on non-Latin1 characters (e.g. Chinese names). atob()/btoa() work with byte
  // strings (chars 0-255); we must keep all characters in that range.
  const bytes = new TextEncoder().encode(escaped);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

function fillTemplate(entries: Record<string, string>, vars: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, b64] of Object.entries(entries)) {
    let content = atob(b64);
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      for (const [key, value] of Object.entries(vars)) {
        content = content.replaceAll(`{{${key}}}`, escXml(value));
      }
    }
    result[name] = btoa(content);
  }
  return result;
}

// ── ZIP builder (store, no compression) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

class ByteWriter {
  private parts: Uint8Array[] = [];
  private len = 0;
  u16(v: number) { this.parts.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff])); this.len += 2; }
  u32(v: number) {
    this.parts.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
    this.len += 4;
  }
  raw(b: Uint8Array) { this.parts.push(b); this.len += b.length; }
  get length() { return this.len; }
  build(): Uint8Array {
    const out = new Uint8Array(this.len);
    let pos = 0;
    for (const p of this.parts) { out.set(p, pos); pos += p.length; }
    return out;
  }
}

function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const lh = new ByteWriter();
    lh.u32(0x04034b50);
    lh.u16(20);
    lh.u16(0x0800);
    lh.u16(0);
    lh.u16(0);
    lh.u16(0);
    lh.u32(crc);
    lh.u32(size);
    lh.u32(size);
    lh.u16(nameBytes.length);
    lh.u16(0);
    lh.raw(nameBytes);
    const lhBytes = lh.build();
    local.push(lhBytes, f.data);

    const ch = new ByteWriter();
    ch.u32(0x02014b50);
    ch.u16(20);
    ch.u16(20);
    ch.u16(0x0800);
    ch.u16(0);
    ch.u16(0);
    ch.u16(0);
    ch.u32(crc);
    ch.u32(size);
    ch.u32(size);
    ch.u16(nameBytes.length);
    ch.u16(0);
    ch.u16(0);
    ch.u16(0);
    ch.u16(0);
    ch.u32(0);
    ch.u32(offset);
    ch.raw(nameBytes);
    central.push(ch.build());

    offset += lhBytes.length + f.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const eocd = new ByteWriter();
  eocd.u32(0x06054b50);
  eocd.u16(0);
  eocd.u16(0);
  eocd.u16(files.length);
  eocd.u16(files.length);
  eocd.u32(centralSize);
  eocd.u32(centralStart);
  eocd.u16(0);

  const all = [...local, ...central, eocd.build()];
  let total = 0;
  for (const p of all) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Buffer latin1 转换是原生 C++ 路径，比 JS 循环 String.fromCharCode 快 20-30ms CPU（大文件 503 关键）
  if (typeof Buffer !== "undefined") return btoa(Buffer.from(bytes).toString("latin1"));
  let binary = "";
  const chunk = 0x1000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

// ── ROM-specific: per-shareholder block filling ──
// Lung Shun template structure (24 rows): rows 0-2 = header, rows 3-12 = block A
// (info row + addr row + tx headers + 5 tx rows), row 13 = separator, rows 14-23 = block B.
// Both blocks carry the same generic {{SH_*}}/{{T*_*}} placeholders; each block region is
// filled separately per shareholder. Block B is cloned for 3+ shareholders.

const MAX_TX_ROWS = 5;
const TX_ACQ_FIELDS = ["DATE", "CERT", "FROM", "TO", "SHARES", "MONEY"];
const TX_XFER_FIELDS = ["DEED", "CERT2", "FROM2", "TO2", "SHARES2", "MONEY2"];

interface RomTxRow {
  side: 'acquired' | 'transferred';
  date: string; cert: string; shares: string; money: string; deed: string;
  from: string; to: string;   // Distinctive Nos 区间（用户 2026-08-20：From 从 0 起、To=From+股数）
  total: number; remarks: string;
}

interface RomShareholder {
  fullName: string;
  occupation: string;
  dateApp: string;
  addr: string;
  dateCea: string;
  rows: RomTxRow[];
}

function fillBlock(blockXml: string, sh: RomShareholder): string {
  const v: Record<string, string> = {
    SH_NAME: sh.fullName,
    SH_OCC: sh.occupation,
    SH_ENTRY: sh.dateApp,
    SH_ADDR: sh.addr,
    SH_CEASE: sh.dateCea,
  };
  for (let i = 0; i < MAX_TX_ROWS; i++) {
    const r = sh.rows[i];
    const p = (f: string) => `T${i + 1}_${f}`;
    const set = (f: string, val: string) => { v[p(f)] = val; };
    if (r && r.side === "acquired") {
      // 购入半边：Date/Cert/From/To（=证书号）/Shares/Consideration；转让半边留空
      set("DATE", r.date); set("CERT", r.cert); set("FROM", r.from); set("TO", r.to);
      set("SHARES", r.shares); set("MONEY", r.money);
      for (const f of TX_XFER_FIELDS) set(f, "");
    } else if (r && r.side === "transferred") {
      // 转让半边：Deed/Cert2/From2/To2/Shares2/Consid2；购入半边留空
      // ⚠️ Date 是整行共用的第一栏（不属于购入半边），转让行同样要有日期。
      //    必须在清空循环**之后**再写 —— TX_ACQ_FIELDS 头一项就是 DATE，
      //    先写会被循环二次清空（这正是转让行日期一直是空的原因）。
      for (const f of TX_ACQ_FIELDS) set(f, "");
      set("DATE", r.date);
      set("DEED", r.deed); set("CERT2", r.cert); set("FROM2", r.from); set("TO2", r.to);
      set("SHARES2", r.shares); set("MONEY2", r.money);
    } else {
      for (const f of [...TX_ACQ_FIELDS, ...TX_XFER_FIELDS]) set(f, "");
    }
    set("TOTAL", r ? String(r.total) : "");
    set("REMARKS", r ? r.remarks : "");
    set("ENTRYBY", "");
  }
  // 🔴 Word 只把段落级 rPr 用在段落标记上，不会下放给 run 里的文字。
  // 模板里转让半边的占位 run（DEED/CERT2/FROM2/TO2/SHARES2/MONEY2）只有段落级
  // rPr，Word 打开时这些格会回退到样式默认 Times New Roman 小四，整行比其他
  // 填入值（Arial 小五 sz=18）大一圈。LibreOffice 会下放段落级 rPr，所以转换
  // 渲染量字号完全看不出差异 —— 只能以 Word 的实际表现为准（用户 2026-08-19 报）。
  // 给所有缺 run 级 rPr 的占位 run 统一补上与其他格一致的 Arial 小五。
  let out = blockXml.replace(
    /<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g,
    (run) => {
      if (!run.includes('{{') || run.includes('<w:rPr')) return run;
      return run.replace(
        /<w:r(?:\s[^>]*)?>/,
        (tag) => tag + '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="PMingLiU" w:hAnsi="Arial" w:cs="Arial"/>'
          + '<w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:eastAsia="zh-TW"/></w:rPr>'
      );
    }
  );
  for (const [k, val] of Object.entries(v)) {
    out = out.replaceAll(`{{${k}}}`, escXml(val));
  }
  return out;
}

function fmtDateRom(d: string): string {
  if (!d || d === '-') return d === '-' ? '-' : '';
  const s = String(d);
  // Format: YYYY-MM-DD → DD/MM/YYYY
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // Format: 8-digit DDMMYYYY → DD/MM/YYYY
  const m2 = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m2) return `${m2[1]}/${m2[2]}/${m2[3]}`;
  return s.slice(0, 10);
}

function fmtMoney(cur: string, amt: number): string {
  if (!isFinite(amt) || amt <= 0) return '';
  return `${cur} ${amt.toFixed(2)}`;
}

// ══════════════════════════════════════════════════════════
// Main handler
// ══════════════════════════════════════════════════════════
export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const { companyId } = await request.json() as any;
    if (!companyId) {
      return json({ error: "companyId required" }, 400);
    }

    // ── Fetch data ──
    const [company, rolesResult, txResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare(
        "SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'shareholder'"
      ).bind(companyId).all(),
      env.DB.prepare(
        "SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date"
      ).bind(companyId).all(),
    ]);

    if (!company) throw new Error("Company not found");

    // 股東按「成為股東的時間」排序 —— SQL 端沒有 ORDER BY（date_appointed 混用
    // ISO/DD-MM-YYYY/DDMMYYYY 三種格式，字符串排序會排錯），統一在 TS 歸一化後排。
    // 排序同時決定證書編號：第 i 位股東 = 編號 i+1。
    const roles = sortRolesByAppointment((rolesResult.results || []) as any[]);
    // transaction_date 同樣混用三種格式，SQL 的字符串 ORDER BY 排不對 → TS 再排一次
    // （逐行記帳的結餘欄依賴這個順序）
    const transactions = ((txResult.results || []) as any[])
      .map((t, i) => ({ t, i, k: dateSortKey(t?.transaction_date) }))
      .sort((a, b) => {
        if (!a.k !== !b.k) return a.k ? -1 : 1;
        if (a.k !== b.k) return a.k < b.k ? -1 : 1;
        return a.i - b.i;
      })
      .map(x => x.t);

    // Map persons
    const personIds = roles.map((r: any) => r.person_id).filter(Boolean);
    const personMap = new Map<string, any>();
    if (personIds.length > 0) {
      const ph = personIds.map(() => '?').join(',');
      const result = await env.DB.prepare(
        `SELECT * FROM persons WHERE id IN (${ph})`
      ).bind(...personIds).all();
      (result.results || []).forEach((p: any) => personMap.set(p.id, p));
    }

    // Build tx_by_name map，**買賣雙方都要索引**（key 比對 person 英文名）。
    // 舊版 key = from_name || to_name：轉讓交易 from_name 一填，這筆就只掛在轉讓方
    // 名下，受讓人永遠看不到自己的「Transfer In」行（會被誤記成 Subscription）。
    const txByName = new Map<string, any[]>();
    for (const t of transactions) {
      const seen = new Set<string>();
      for (const side of ['from_name', 'to_name']) {
        const key = rget(t, side).trim().toUpperCase();
        if (!key || seen.has(key)) continue;   // 同一人自轉自不重複記兩行
        seen.add(key);
        if (!txByName.has(key)) txByName.set(key, []);
        txByName.get(key)!.push(t);
      }
    }

    // 姓名 → 股東編號（轉讓行要記「受讓人」的號）
    const seqByName = buildSeqByName(roles, (id) => personMap.get(id));

    // ── Distinctive Nos 分配（用户 2026-08-20 规则，二次修正）──
    // 每笔「获得」（Subscription/Allotment）：**首笔 [0, 股数]**（含 0 号，用户坚持 0-1000），
    // 之后 From = 上一笔 To + 1、To = From + 股数 − 1（闭区间）
    // （用户例：0-1000、1001-2000、2001-4000；dawda：Shea [0,1000]、Zhao [1001,3000]、PEAK [3001,4800]）
    // 转让：编号跟股份走 —— 从转出方持有区间**末端**割让 n 股 [t−n+1, t]，剩余末端变 t−n；
    // 转出行 From2/To2 显示末端变迁（用户例：Shea 转 100 股 → From2=1000、To2=900）；
    // 受让人 Transfer In 行 = 割让区间 [t−n+1, t]。
    interface Seg { from: number; to: number; shares: number; }
    const segsByKey = new Map<string, Seg[]>();
    let globalCursor = 0;
    const distOf = (shares: number): Seg => {
      if (globalCursor === 0) {
        // 首笔：0 ~ 股数（含 0 号在内，号数比股数多 1）
        const s = { from: 0, to: shares, shares };
        globalCursor = shares + 1;
        return s;
      }
      const s = { from: globalCursor, to: globalCursor + shares - 1, shares };
      globalCursor += shares;
      return s;
    };
    const pushSeg = (key: string, s: Seg) => {
      const q = segsByKey.get(key);
      if (q) q.push(s); else segsByKey.set(key, [s]);
    };
    const subSegByKey = new Map<string, Seg>();
    const allotSegByTx = new Map<any, Seg>();
    const xferSegByTx = new Map<any, Seg>();
    // 转出行末端变迁（before = 割让前持有末端，after = 割让后持有末端）
    const xferEndsByTx = new Map<any, { before: number; after: number }>();
    // 轉出方單價表（姓名鍵 → 該股東 issue_price）：轉讓價按轉出方持有單價算
    // （用户例：2 塊錢的股票 1000 股，轉 100 股 = 100×2）
    const fromPriceByKey = new Map<string, number>();

    // Phase A：每人的初始認購（Subscription）事件 + 轉出方單價表。
    // roles 已按成為股東時間排好 → subEvs 天然按任命日期排序。
    const subEvs: { k: string; key: string; shares0: number }[] = [];
    roles.forEach((role: any) => {
      const p = personMap.get(role.person_id) || {};
      const personNameKey = (rget(p, 'name_english') || rget(p, 'name_chinese')).trim().toUpperCase();
      const heldShares = parseInt(rget(role, 'shares') || '0', 10) || 0;
      const issuePrice = Number(rget(role, 'issue_price') || 0);
      fromPriceByKey.set(personNameKey, issuePrice);
      const myTx = (txByName.get(personNameKey) || [])
        .map((tx: any) => {
          const n = parseInt(rget(tx, 'shares') || '0', 10) || 0;
          const isAllot = rget(tx, 'transaction_type').toLowerCase().includes('allot');
          const isOut = !isAllot && rget(tx, 'from_name').trim().toUpperCase() === personNameKey;
          return { n, isOut };
        })
        .filter((x: any) => x.n > 0);
      const netFromTx = myTx.reduce((s: number, x: any) => s + (x.isOut ? -x.n : x.n), 0);
      const shares0 = Math.max(0, heldShares - netFromTx);
      if (shares0 > 0) {
        subEvs.push({ k: dateSortKey(role.date_appointed), key: personNameKey, shares0 });
      }
    });

    // Phase B：Sub 事件與交易合併成單一時間線（同日 Sub 在前），
    // Allotment 開全局新段；轉讓從轉出方段隊列**隊尾**割讓（可跨段）
    let si = 0, ti = 0;
    const txKeys = transactions.map((t: any) => dateSortKey(t?.transaction_date));
    while (si < subEvs.length || ti < transactions.length) {
      const sub = subEvs[si];
      // 空日期交易按「最後發生」處理（transactions 排序同款：空 key 排末尾）
      const tk = ti < transactions.length ? (txKeys[ti] || '99999999') : null;
      if (sub && (tk === null || sub.k <= tk)) {
        const seg = distOf(sub.shares0);
        // 🔴 行級快照存副本：seg 對象推入隊列後會被轉讓割讓 mutate（to 前移），
        // 共享引用會讓已填的 Subscription 行顯示「割讓後殘段」
        subSegByKey.set(sub.key, { from: seg.from, to: seg.to, shares: seg.shares });
        pushSeg(sub.key, seg);
        si++;
        continue;
      }
      const tx = transactions[ti];
      const n = parseInt(rget(tx, 'shares') || '0', 10) || 0;
      if (n > 0) {
        const isAllot = rget(tx, 'transaction_type').toLowerCase().includes('allot');
        const toKey = rget(tx, 'to_name').trim().toUpperCase();
        if (isAllot) {
          const seg = distOf(n);
          allotSegByTx.set(tx, { from: seg.from, to: seg.to, shares: seg.shares });
          pushSeg(toKey, seg);
        } else {
          const fromKey = rget(tx, 'from_name').trim().toUpperCase();
          const q = segsByKey.get(fromKey);
          if (q && q.length > 0) {   // 段隊列為空（數據缺失）→ 該行編號留空
            // 從隊尾逐段割讓（unshift 保證 carved[0] 是最小編號段）
            let remain = n;
            const carved: Seg[] = [];
            while (remain > 0 && q.length > 0) {
              const seg = q[q.length - 1];
              if (seg.shares > remain) {
                carved.unshift({ from: seg.to - remain + 1, to: seg.to, shares: remain });
                seg.to -= remain;
                seg.shares -= remain;
                remain = 0;
              } else {
                carved.unshift({ from: seg.from, to: seg.to, shares: seg.shares });
                remain -= seg.shares;
                q.pop();
              }
            }
            if (remain === 0 && carved.length > 0) {
              const xs = { from: carved[0].from, to: carved[carved.length - 1].to, shares: n };
              xferSegByTx.set(tx, xs);
              // 轉出行末端變遷：割讓前 = 原隊尾段 to；割讓後 = 剩餘隊尾段 to（無剩 → 0）
              xferEndsByTx.set(tx, {
                before: carved[carved.length - 1].to,
                after: q.length > 0 ? q[q.length - 1].to : 0,
              });
              // 隊列裡推副本：受讓人日後再轉出時 mutate 的是隊列對象，不動行快照
              pushSeg(toKey, { from: xs.from, to: xs.to, shares: xs.shares });
            }
          }
        }
      }
      ti++;
    }

    // 考慮金助手：Sub 默認每股 HKD 1 全額（用户「基本默认全部缴费」）；
    // 轉讓 = 股數×轉出方單價（issue_price → tx 單價 → tx 總價/股數 → 1）
    const priceOf = (tx: any) => Number(String(rget(tx, 'price_per_share') || '').replace(/,/g, ''));
    const xferMoney = (tx: any, n: number): string => {
      const fromPrice = fromPriceByKey.get(rget(tx, 'from_name').trim().toUpperCase()) || 0;
      const totalConsid = Number(rget(tx, 'total_consideration') || 0);
      const unit = fromPrice > 0 ? fromPrice
        : priceOf(tx) > 0 ? priceOf(tx)
        : totalConsid > 0 ? totalConsid / n
        : 1;
      return fmtMoney(rget(tx, 'currency') || 'HKD', n * unit);
    };
    const allotMoney = (tx: any, n: number): string => {
      const totalConsid = Number(rget(tx, 'total_consideration') || 0);
      return priceOf(tx) > 0 ? fmtMoney(rget(tx, 'currency') || 'HKD', n * priceOf(tx))
        : totalConsid > 0 ? fmtMoney(rget(tx, 'currency') || 'HKD', totalConsid)
        : fmtMoney(rget(tx, 'currency') || 'HKD', n);
    };

    // ── Company data ──
    const coNameEn = rget(company, 'name').slice(0, 40);
    const coNameZh = (rget(company, 'chinese_name') || rget(company, 'name_chinese') || '').slice(0, 18);
    const coBr = rget(company, 'company_number').slice(0, 15);

    // ── Build shareholder list（样本语义与 PDF 端点一致）──
    // 行0 = 初始 Subscription（date=入册日、cert=证书号、from/to=Distinctive Nos 区间、
    // shares、Consideration、total、Remarks=Subscription）
    // 后续 = 交易：Allotment/Transfer In → 购入半边；Transfer Out → 转让半边
    // Total Shares Held = 累计结余；Entry Made By 留空
    const shareholders: RomShareholder[] = [];
    roles.forEach((role: any, roleIdx: number) => {
      const p = personMap.get(role.person_id) || {};
      const nameEn = (rget(p, 'name_english') || rget(p, 'name_chinese') || '(unnamed)').slice(0, 40);
      const nameZh = rget(p, 'name_chinese').slice(0, 12);
      const fullName = [nameEn, nameZh].filter(Boolean).join(' ').slice(0, 45);

      let addr = [
        rget(p, 'addr_flat'), rget(p, 'addr_building'),
        rget(p, 'addr_street'), rget(p, 'addr_district'),
      ].filter(Boolean).join(', ');
      const region = rget(p, 'addr_region') || '';
      if (!addr) addr = rget(p, 'address');
      if (region && !addr.includes(region)) addr = addr ? `${addr}, ${region}` : region;
      addr = addr.slice(0, 100);

      // 股东名字不含 limited/ltd（非公司）→ occupation 默认 Merchant（香港惯例），DB 有值则保留
      const isCorpName = /limited|ltd\b/i.test(nameEn);
      const occupation = (rget(p, 'occupation') || (isCorpName ? '' : 'Merchant')).slice(0, 30);
      const dateAppRaw = rget(role, 'date_appointed');
      const dateApp = dateAppRaw ? fmtDateRom(dateAppRaw) : '-';
      const dateCeaRaw = rget(role, 'date_ceased');
      const dateCea = dateCeaRaw ? fmtDateRom(dateCeaRaw) : '';
      const heldShares = parseInt(rget(role, 'shares') || '0', 10) || 0;
      // 證書編號 = 這位股東在時序中的名次（手填值優先，目前全庫皆空）
      const certNo = certNoOf(role, roleIdx + 1).slice(0, 20);
      const currency = rget(role, 'currency') || 'HKD';
      const issuePrice = Number(rget(role, 'issue_price') || 0);
      // 姓名鍵用**未截斷**的原始英文名，才對得上 txByName 的 from_name/to_name
      const personNameKey = (rget(p, 'name_english') || rget(p, 'name_chinese')).trim().toUpperCase();

      // 先把這位股東的交易分類一次（下面算初始認購數和逐行記帳共用）
      const myTx = (txByName.get(personNameKey) || [])
        .map((tx: any) => {
          const n = parseInt(rget(tx, 'shares') || '0', 10) || 0;
          const isAllot = rget(tx, 'transaction_type').toLowerCase().includes('allot');
          const isOut = !isAllot && rget(tx, 'from_name').trim().toUpperCase() === personNameKey;
          return { tx, n, isAllot, isOut };
        })
        .filter((x: any) => x.n > 0);

      // ⚠️ role.shares 是「當前持股結餘」不是初始認購數（實測：轉出 100 股後
      // 該欄已由 1000 減成 900）。把交易造成的增減扣回去才是首行認購數，
      // 否則結餘欄會一路算錯（舊版：認購 900 → 轉出 100 → 結餘 800，實際持有 900）。
      const netFromTx = myTx.reduce((s: number, x: any) => s + (x.isOut ? -x.n : x.n), 0);
      const shares0 = Math.max(0, heldShares - netFromTx);

      const rows: RomTxRow[] = [];
      let balance = shares0;
      if (shares0 > 0) {
        const subSeg = subSegByKey.get(personNameKey);
        rows.push({
          side: 'acquired',
          date: dateApp, cert: certNo, shares: String(shares0),
          // 無發行價默認每股 HKD 1 全額繳付（用户「基本默认全部缴费」）
          money: fmtMoney(currency, shares0 * (issuePrice > 0 ? issuePrice : 1)),
          deed: '',
          from: subSeg ? String(subSeg.from) : '',
          to: subSeg ? String(subSeg.to) : '',
          total: balance, remarks: 'Subscription',
        });
      }
      for (const { tx, n: txShares, isAllot, isOut } of myTx) {
        if (rows.length >= MAX_TX_ROWS) break;
        const date = fmtDateRom(rget(tx, 'transaction_date'));
        const deed = rget(tx, 'instrument_number').slice(0, 20);

        if (isOut) {
          balance -= txShares;
          // 轉讓半邊記的是**受讓人**的證書號 —— 這筆轉讓開出的新證書是給受讓人的
          // （用戶原話：轉 100 股出去那行編號應該是 4，因為第四個股東因這筆轉讓出現）
          const toSeq = seqByName.get(rget(tx, 'to_name').trim().toUpperCase());
          // From2/To2 = 持有末端變遷（用户 2026-08-20 二修：Shea 轉 100 股 → 1000 / 900）
          const ends = xferEndsByTx.get(tx);
          rows.push({
            side: 'transferred', date, cert: toSeq ? String(toSeq) : certNo,
            shares: String(txShares),
            money: xferMoney(tx, txShares), deed,
            from: ends ? String(ends.before) : '',
            to: ends ? String(ends.after) : '',
            total: balance, remarks: 'Transfer Out',
          });
        } else {
          balance += txShares;
          const seg = isAllot ? allotSegByTx.get(tx) : xferSegByTx.get(tx);
          rows.push({
            side: 'acquired', date, cert: certNo, shares: String(txShares),
            money: isAllot ? allotMoney(tx, txShares) : xferMoney(tx, txShares),
            deed: '',
            from: seg ? String(seg.from) : '',
            to: seg ? String(seg.to) : '',
            total: balance, remarks: isAllot ? 'Allotment' : 'Transfer In',
          });
        }
      }

      shareholders.push({ fullName, occupation, dateApp, addr, dateCea, rows });
    });

    // ── Get template ──
    const template = ROM_TEMPLATE;
    if (!template) throw new Error("ROM template not found in data");

    // ── Fill header placeholders ──
    const entries = fillTemplate(template, {
      CO_NAME_EN: coNameEn,
      CO_NAME_ZH: coNameZh,
      CO_BR: coBr,
    });

    // ── Fill shareholder blocks (region-scoped; 每页 2 个股东，第 3 个起整体移到新页) ──
    let docXml = atob(entries["word/document.xml"]);
    const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
    const m: RegExpExecArray[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = rowRe.exec(docXml))) m.push(mm);
    if (m.length < 24) throw new Error(`Unexpected template structure: ${m.length} rows`);

    const rowStart = (i: number) => m[i].index;
    const rowEnd = (i: number) => m[i].index + m[i][0].length;
    const prefix = docXml.slice(0, rowStart(3));
    const blockA = docXml.slice(rowStart(3), rowStart(13));
    const sepXml = m[13][0];
    const blockB = docXml.slice(rowStart(14), rowEnd(23));
    const suffix = docXml.slice(rowEnd(23));

    // 拆文档骨架：每页 = tbl 开标签 + 表头行（tblPr/tblGrid + rows 0-2）；页尾段落仅放末页
    const tblOpenM = /<w:tbl\b[^>]*>/.exec(prefix);
    if (!tblOpenM) throw new Error('tbl open tag not found');
    const tblOpen = tblOpenM[0];
    const docHead = prefix.slice(0, tblOpenM.index);
    const headerXml = prefix.slice(tblOpenM.index + tblOpen.length);
    const tblClose = '</w:tbl>';
    const tblCloseIdx = suffix.indexOf(tblClose);
    if (tblCloseIdx < 0) throw new Error('tbl close tag not found');
    // 尾段落处理：① 删除段落内嵌 sectPr → 整个文档单节（Word 对 header/footer 尺寸不同的
    // continuous 节会强制分页 → 末页空白页）② 空段落压缩到 1pt 行高防溢出
    const docTail = suffix.slice(tblCloseIdx + tblClose.length)
      .replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, '')
      .replace(/<w:sz w:val="\d+"\/>/g, '<w:sz w:val="2"/>')
      .replace(/<w:szCs w:val="\d+"\/>/g, '<w:szCs w:val="2"/>');

    const fillPage = (segs: string[]): string =>
      tblOpen + headerXml + segs.join('') + tblClose;
    // 分页段落：最小行高（1pt）的 page break，页 2+ 表格几乎贴页顶
    const pageBreakP =
      '<w:p><w:pPr><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:br w:type="page"/></w:r></w:p>';

    let body: string;
    if (shareholders.length === 0) {
      // 无股东：单块占位提示（与旧行为一致）
      body = fillPage([fillBlock(blockA, {
        fullName: '(No shareholders / 尚無股東記錄)',
        occupation: '', dateApp: '', addr: '', dateCea: '', rows: [],
      })]);
    } else {
      const blocks = shareholders.map((sh, i) => fillBlock(i === 0 ? blockA : blockB, sh));
      const pages: string[] = [];
      for (let i = 0; i < blocks.length; i += 2) {
        const segs = [blocks[i]];
        if (blocks[i + 1]) segs.push(sepXml + blocks[i + 1]);
        pages.push(fillPage(segs));
      }
      body = pages.join(pageBreakP);
    }
    docXml = docHead + body + docTail;
    entries["word/document.xml"] = btoa(docXml);

    // ── Build ZIP ──
    const files = Object.entries(entries).map(([name, b64]) => ({
      name,
      data: Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0)),
    }));
    const zipBytes = buildZip(files);
    const docxB64 = uint8ToBase64(zipBytes);

    return json({
      success: true,
      docx: docxB64,
      filename: `RegisterOfMembers_${coBr}_${coNameEn.slice(0, 30)}.docx`,
    });
  } catch (e: any) {
    console.error("generate-rom-docx error:", e);
    return json({ error: e.message || String(e) }, 500);
  }
}
