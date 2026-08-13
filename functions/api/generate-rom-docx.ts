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
      set("DATE", r.date); set("CERT", r.cert); set("FROM", r.cert); set("TO", r.cert);
      set("SHARES", r.shares); set("MONEY", r.money);
      for (const f of TX_XFER_FIELDS) set(f, "");
    } else if (r && r.side === "transferred") {
      // 转让半边：Deed/Cert2/From2/To2/Shares2/Consid2；购入半边与 Date 留空（与 PDF 端点一致）
      set("DATE", "");
      for (const f of TX_ACQ_FIELDS) set(f, "");
      set("DEED", r.deed); set("CERT2", r.cert); set("FROM2", r.cert); set("TO2", r.cert);
      set("SHARES2", r.shares); set("MONEY2", r.money);
    } else {
      for (const f of [...TX_ACQ_FIELDS, ...TX_XFER_FIELDS]) set(f, "");
    }
    set("TOTAL", r ? String(r.total) : "");
    set("REMARKS", r ? r.remarks : "");
    set("ENTRYBY", "");
  }
  let out = blockXml;
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

    const roles = (rolesResult.results || []) as any[];
    const transactions = (txResult.results || []) as any[];

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

    // Build tx_by_name map (key = from_name || to_name, matched against person English name)
    const txByName = new Map<string, any[]>();
    for (const t of transactions) {
      const key = (rget(t, 'from_name') || rget(t, 'to_name') || '').trim().toUpperCase();
      if (key) {
        if (!txByName.has(key)) txByName.set(key, []);
        txByName.get(key)!.push(t);
      }
    }

    // ── Company data ──
    const coNameEn = rget(company, 'name').slice(0, 40);
    const coNameZh = (rget(company, 'chinese_name') || rget(company, 'name_chinese') || '').slice(0, 18);
    const coBr = rget(company, 'company_number').slice(0, 15);

    // ── Build shareholder list（样本语义与 PDF 端点一致）──
    // 行0 = 初始 Subscription（date=入册日、cert/from/to=证书号、shares、HKD 代价、total、Remarks=Subscription）
    // 后续 = 交易：Allotment/Transfer In → 购入半边；Transfer Out → 转让半边
    // Total Shares Held = 累计结余；Entry Made By 留空
    const shareholders: RomShareholder[] = [];
    for (const role of roles) {
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

      const occupation = rget(p, 'occupation').slice(0, 30);
      const dateAppRaw = rget(role, 'date_appointed');
      const dateApp = dateAppRaw ? fmtDateRom(dateAppRaw) : '-';
      const dateCeaRaw = rget(role, 'date_ceased');
      const dateCea = dateCeaRaw ? fmtDateRom(dateCeaRaw) : '';
      const shares0 = parseInt(rget(role, 'shares') || '0', 10) || 0;
      const certNo = (rget(role, 'certificate_number') || '-').slice(0, 20);
      const currency = rget(role, 'currency') || 'HKD';
      const issuePrice = Number(rget(role, 'issue_price') || 0);
      const personNameKey = nameEn.trim().toUpperCase();

      const rows: RomTxRow[] = [];
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
        const txShares = parseInt(rget(tx, 'shares') || '0', 10) || 0;
        if (!txShares) continue;
        const cur = rget(tx, 'currency') || currency;
        const totalConsid = Number(rget(tx, 'total_consideration') || 0);
        const priceEach = Number(rget(tx, 'price_per_share') || 0);
        const money = totalConsid > 0 ? fmtMoney(cur, totalConsid)
          : priceEach > 0 ? fmtMoney(cur, txShares * priceEach) : '';
        const date = fmtDateRom(rget(tx, 'transaction_date'));
        const deed = rget(tx, 'instrument_number').slice(0, 20);

        const isAllot = rget(tx, 'transaction_type').toLowerCase().includes('allot');
        const isIn = !isAllot && rget(tx, 'to_name').trim().toUpperCase() === personNameKey;
        const isOut = !isAllot && rget(tx, 'from_name').trim().toUpperCase() === personNameKey;
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

      shareholders.push({ fullName, occupation, dateApp, addr, dateCea, rows });
    }

    // ── Get template ──
    const template = ROM_TEMPLATE;
    if (!template) throw new Error("ROM template not found in data");

    // ── Fill header placeholders ──
    const entries = fillTemplate(template, {
      CO_NAME_EN: coNameEn,
      CO_NAME_ZH: coNameZh,
      CO_BR: coBr,
    });

    // ── Fill shareholder blocks (region-scoped, block B cloned for 3+) ──
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

    let body: string;
    if (shareholders.length === 0) {
      // 无股东：单块占位提示（与旧行为一致）
      body = fillBlock(blockA, {
        fullName: '(No shareholders / 尚無股東記錄)',
        occupation: '', dateApp: '', addr: '', dateCea: '', rows: [],
      });
    } else {
      const blocks: string[] = [fillBlock(blockA, shareholders[0])];
      for (let i = 1; i < shareholders.length; i++) {
        blocks.push(sepXml + fillBlock(blockB, shareholders[i]));
      }
      body = blocks.join('');
    }
    docXml = prefix + body + suffix;
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
