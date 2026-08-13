// POST /api/generate-transfer-docx
// Generate Transfer Resolutions DOCX from Testing - Transfer resolutions.docx template.
// Paragraph-based template — simple fillTemplate replacement, no row cloning.
// Fills company info + transaction seller/buyer/shares + director signatory.

import { verifyAuthRequest, type Env } from './_auth';
import TRANSFER_TEMPLATE from './_template_transfer_resolutions_template';

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
  // Encode the escaped string as UTF-8 bytes represented as Latin1 chars.
  // atob() produces a binary-safe string where each char represents one byte (0-255).
  // Replacements must match: non-Latin1 chars (e.g. Chinese) must be UTF-8 encoded
  // before insertion, or btoa() will throw "can only operate on characters in the Latin1 range".
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
    lh.u32(0x04034b50); lh.u16(20); lh.u16(0x0800); lh.u16(0); lh.u16(0); lh.u16(0);
    lh.u32(crc); lh.u32(size); lh.u32(size);
    lh.u16(nameBytes.length); lh.u16(0);
    lh.raw(nameBytes);
    const lhBytes = lh.build();
    local.push(lhBytes, f.data);
    const ch = new ByteWriter();
    ch.u32(0x02014b50); ch.u16(20); ch.u16(20); ch.u16(0x0800); ch.u16(0); ch.u16(0); ch.u16(0);
    ch.u32(crc); ch.u32(size); ch.u32(size);
    ch.u16(nameBytes.length); ch.u16(0); ch.u16(0); ch.u16(0); ch.u16(0);
    ch.u32(0); ch.u32(offset);
    ch.raw(nameBytes);
    central.push(ch.build());
    offset += lhBytes.length + f.data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const eocd = new ByteWriter();
  eocd.u32(0x06054b50); eocd.u16(0); eocd.u16(0);
  eocd.u16(files.length); eocd.u16(files.length);
  eocd.u32(centralSize); eocd.u32(centralStart); eocd.u16(0);
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

// ══════════════════════════════════════════════════════════════
// Main handler
// ══════════════════════════════════════════════════════════════
export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const { companyId, transactionId } = await request.json() as any;
    if (!companyId) return json({ error: "companyId required" }, 400);

    // ── Fetch data ──
    const [company, directorsResult, txResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare(
        "SELECT pcr.*, p.name_english, p.name_chinese, p.id_number, p.passport_number FROM person_company_roles pcr JOIN persons p ON pcr.person_id = p.id WHERE pcr.company_id = ? AND pcr.role = 'director' LIMIT 1"
      ).bind(companyId).all(),
      transactionId
        ? env.DB.prepare("SELECT * FROM share_transactions WHERE id = ? AND company_id = ?").bind(transactionId, companyId).first()
        : env.DB.prepare(
            "SELECT * FROM share_transactions WHERE company_id = ? ORDER BY transaction_date DESC LIMIT 1"
          ).bind(companyId).first(),
    ]);

    if (!company) throw new Error("Company not found");

    const coName = rget(company, 'name') || '';
    const coBr = rget(company, 'company_number') || '';

    // ── Director (signatory) ──
    const directors = (directorsResult.results || []) as any[];
    const director = directors[0] || null;
    const dirName = director
      ? (rget(director, 'name_english') || rget(director, 'name_chinese') || '(unnamed)')
      : '(Director)';

    // ── Transaction ──
    const tx = txResult as any;
    const sellerName = tx ? (rget(tx, 'from_name') || '—') : '—';
    const buyerName = tx ? (rget(tx, 'to_name') || '—') : '—';
    const shares = tx ? (parseInt(rget(tx, 'shares') || '0', 10) || 0).toLocaleString('en-US') : '—';
    const shareType = tx ? (rget(tx, 'share_type') || 'Ordinary') : 'Ordinary';
    const currency = tx ? (rget(tx, 'currency') || 'HKD') : 'HKD';
    const pricePerShare = tx ? (rget(tx, 'price_per_share') || '1.00') : '1.00';
    const shareDesc = `${currency} $${pricePerShare} ${shareType} Fully Paid`;

    // Seller/Buyer ID hints (from transaction or placeholder)
    const sellerId = tx ? (rget(tx, 'from_id') || '—') : '—';
    const buyerId = tx ? (rget(tx, 'to_id') || '—') : '—';

    // Authorized persons (director + optional secretary)
    const authPersons = dirName;

    // Signature date (today)
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const sigDate = `${dd}/${mm}/${yyyy}`;

    // ── Get template ──
    const template = TRANSFER_TEMPLATE;
    if (!template) throw new Error("Transfer Resolutions template not found in data");

    // ── Fill template ──
    const entries = fillTemplate(template, {
      CO_NAME: coName,
      CO_BR: coBr,
      SELLER_NAME: sellerName,
      SELLER_ID: sellerId,
      BUYER_NAME: buyerName,
      BUYER_ID: buyerId,
      SHARES: shares,
      SHARE_DESC: shareDesc,
      AUTH_PERSONS: authPersons,
      SIG_DATE: sigDate,
      DIRECTOR_NAME: dirName,
    });

    // ── Build ZIP ──
    const files = Object.entries(entries).map(([name, b64]) => ({
      name,
      data: Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0)),
    }));
    const zipBytes = buildZip(files);
    const docxB64 = uint8ToBase64(zipBytes);

    const txRef = tx ? (rget(tx, 'instrument_number') || tx.id).slice(0, 20) : coBr;
    return json({
      success: true,
      docx: docxB64,
      filename: `TransferResolutions_${txRef}_${coName.slice(0, 20)}.docx`,
    });
  } catch (e: any) {
    console.error("generate-transfer-docx error:", e);
    return json({ error: e.message || String(e) }, 500);
  }
}
