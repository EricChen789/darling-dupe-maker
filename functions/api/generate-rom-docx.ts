// POST /api/generate-rom-docx
// Generate ROM (Register of Members) DOCX from original Register of members.doc template.
// Uses pre-extracted DOCX ZIP entries from _template_rom_register_template.ts.
// Replaces {{PLACEHOLDER}} markers with actual company/shareholder data.
// Handles 5-row block cloning per shareholder (row 9-13: data + address + spacer + separator).
import { verifyAuthRequest, type Env } from './_auth';
import ROM_TEMPLATE from './_template_rom_register_template';

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
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

// ── ROM-specific: 5-row block cloning ──
// Template from Register of members.doc has 5-row blocks per shareholder:
//   Row 9:  Name + share data (19 cols with {{SH_*}} placeholders)
//   Row 10: Address (merged, with {{SH_ADDR}})
//   Row 11-12: Empty supplementary rows
//   Row 13: Separator (gridSpan=19 full-width row)
// We extract rows 9-13 as a template block, clone for each shareholder.

function buildRomRows(docXml: string, shareholders: RomShareholder[]): string {
  const marker = "{{SH_NAME}}";
  const markerIdx = docXml.indexOf(marker);
  if (markerIdx < 0) {
    // No template row found — leave as-is
    return docXml;
  }

  // Find Row 9 (contains SH_NAME)
  const row9Start = docXml.lastIndexOf("<w:tr ", markerIdx);
  const row9End = docXml.indexOf("</w:tr>", markerIdx);
  if (row9Start < 0 || row9End < 0) return docXml;

  // Find Rows 10-13: next 4 </w:tr> after row9End
  let searchFrom = row9End + "</w:tr>".length;
  let blockEnd = searchFrom;
  for (let i = 0; i < 4; i++) {
    const trEnd = docXml.indexOf("</w:tr>", searchFrom);
    if (trEnd < 0) break;
    blockEnd = trEnd + "</w:tr>".length;
    searchFrom = blockEnd;
  }

  const blockXml = docXml.substring(row9Start, blockEnd);

  // Build 5-row blocks for each shareholder
  const blocks: string[] = [];
  for (const sh of shareholders) {
    let b = blockXml;
    // Row 9: data row
    b = b.replaceAll("{{SH_NAME}}", escXml(sh.fullName));
    b = b.replaceAll("{{SH_CERT_ACQ}}", escXml(sh.certAcq));
    b = b.replaceAll("{{SH_DIST_FM}}", escXml(sh.distFm));
    b = b.replaceAll("{{SH_DIST_TO}}", escXml(sh.distTo));
    b = b.replaceAll("{{SH_SHARES_ACQ}}", escXml(String(sh.sharesAcq)));
    b = b.replaceAll("{{SH_OCCUPATION}}", escXml(sh.occupation));
    b = b.replaceAll("{{SH_CONS_ACQ}}", escXml(sh.consAcq));
    b = b.replaceAll("{{SH_DATE_APP}}", escXml(sh.dateApp));
    b = b.replaceAll("{{SH_DATE_CEA}}", escXml(sh.dateCea));
    b = b.replaceAll("{{SH_CERT_XFER}}", escXml(sh.certXfer));
    b = b.replaceAll("{{SH_TOTAL}}", escXml(String(sh.totalShares)));
    b = b.replaceAll("{{SH_REMARKS}}", escXml(sh.remarks || ""));
    b = b.replaceAll("{{SH_ENTRY_BY}}", escXml(sh.entryBy));
    // Row 10: address row
    b = b.replaceAll("{{SH_ADDR}}", escXml(sh.addr));
    blocks.push(b);
  }

  if (blocks.length === 0) {
    let b = blockXml;
    b = b.replaceAll("{{SH_NAME}}", escXml("(No shareholders / 尚無股東記錄)"));
    const phs = ["SH_CERT_ACQ","SH_DIST_FM","SH_DIST_TO","SH_SHARES_ACQ","SH_OCCUPATION",
      "SH_CONS_ACQ","SH_DATE_APP","SH_DATE_CEA","SH_CERT_XFER","SH_TOTAL",
      "SH_REMARKS","SH_ENTRY_BY","SH_ADDR"];
    for (const ph of phs) b = b.replaceAll(`{{${ph}}}`, "");
    blocks.push(b);
  }

  const before = docXml.substring(0, row9Start);
  const after = docXml.substring(blockEnd);
  return before + blocks.join("") + after;
}

interface RomShareholder {
  fullName: string;
  addr: string;
  occupation: string;
  dateApp: string;
  dateCea: string;
  certAcq: string;
  distFm: string;
  distTo: string;
  sharesAcq: number;
  consAcq: string;
  certXfer: string;
  totalShares: number;
  remarks: string;
  entryBy: string;
}

function fmtDateRom(d: string): string {
  if (!d || d === '-') return '-';
  const s = String(d);
  // Format: YYYY-MM-DD → DD/MM/YYYY
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // Format: 8-digit DDMMYYYY → DD/MM/YYYY
  const m2 = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m2) return `${m2[1]}/${m2[2]}/${m2[3]}`;
  return s.slice(0, 10);
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

    // Build tx_by_name map
    const txByName = new Map<string, any[]>();
    for (const t of transactions) {
      const key = (rget(t, 'from_name') || rget(t, 'to_name') || '').trim().toUpperCase();
      if (key) {
        if (!txByName.has(key)) txByName.set(key, []);
        txByName.get(key)!.push(t);
      }
    }

    // ── Company data ──
    const coName = rget(company, 'name') || '';
    const coBr = rget(company, 'company_number') || '';
    const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
      'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    const today = new Date();
    const reportDate = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;

    // ── Build shareholder list ──
    const shareholders: RomShareholder[] = [];
    for (const role of roles) {
      const p = personMap.get(role.person_id) || {};
      const nameEn = (rget(p, 'name_english') || rget(p, 'name_chinese') || '(unnamed)').slice(0, 80);

      // Build address from structured fields or raw
      let addr = [
        rget(p, 'addr_flat'), rget(p, 'addr_building'),
        rget(p, 'addr_street'), rget(p, 'addr_district'),
      ].filter(Boolean).join(', ');
      const region = rget(p, 'addr_region') || '';
      if (!addr) addr = (rget(p, 'address') || '').slice(0, 120);
      if (region && !addr.includes(region)) addr = addr ? `${addr}, ${region}` : region;
      addr = addr.slice(0, 120);

      const occupation = rget(p, 'occupation') || '';
      const dateApp = fmtDateRom(rget(role, 'date_appointed') || '-');
      const dateCea = rget(role, 'date_ceased') ? fmtDateRom(rget(role, 'date_ceased')) : '-';
      const sharesHeld = parseInt(rget(role, 'shares') || '0', 10) || 0;
      const certNo = rget(role, 'certificate_number') || '-';
      const currency = rget(role, 'currency') || 'HKD';
      const issuePrice = rget(role, 'issue_price') || '1.00';

      // Calculate total shares including transactions
      const personNameKey = nameEn.trim().toUpperCase();
      const personTxs = txByName.get(personNameKey) || [];
      let totalShares = sharesHeld;
      for (const tx of personTxs) {
        const txShares = parseInt(rget(tx, 'shares') || '0', 10) || 0;
        const isIn = (rget(tx, 'to_name') || '').trim().toUpperCase() === personNameKey;
        const isOut = (rget(tx, 'from_name') || '').trim().toUpperCase() === personNameKey;
        if (isIn) totalShares += txShares;
        else if (isOut) totalShares -= txShares;
      }

      shareholders.push({
        fullName: nameEn,
        addr,
        occupation,
        dateApp,
        dateCea,
        certAcq: certNo,
        distFm: '-',
        distTo: '-',
        sharesAcq: sharesHeld,
        consAcq: `${currency} $${issuePrice}`,
        certXfer: '',
        totalShares: Math.max(0, totalShares),
        remarks: '',
        entryBy: '',
      });
    }

    // ── Get template ──
    const template = ROM_TEMPLATE;
    if (!template) throw new Error("ROM template not found in data");

    // ── Fill header placeholders ──
    let entries = fillTemplate(template, {
      CO_NAME: coName,
      CO_BR: coBr,
      REPORT_DATE: reportDate,
    });

    // ── Build table rows ──
    let docXml = atob(entries["word/document.xml"]);
    docXml = buildRomRows(docXml, shareholders);
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
      filename: `RegisterOfMembers_${coBr}_${coName.slice(0, 30)}.docx`,
    });
  } catch (e: any) {
    console.error("generate-rom-docx error:", e);
    return json({ error: e.message || String(e) }, 500);
  }
}
