// POST /api/generate-resolution-docx
// Generate resolution DOCX from Paul Tang templates.
// Uses pre-extracted DOCX ZIP entries from _resolution_template_data.ts.
// Replaces {{PLACEHOLDER}} markers with actual data, then re-packs ZIP.
// Returns base64 DOCX.
import { verifyAuthRequest, type Env } from './_auth';
import { RESOLUTION_TEMPLATES } from './_resolution_template_data';

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

// ── Placeholder replacements ──
function fillTemplate(entries: Record<string, string>, vars: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, b64] of Object.entries(entries)) {
    let content = atob(b64);
    // Only process XML/text files to avoid corrupting binary
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      for (const [key, value] of Object.entries(vars)) {
        content = content.replaceAll(`{{${key}}}`, escXml(value));
      }
    }
    result[name] = btoa(content);
  }
  return result;
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

// ── Main handler ──
export async function onRequest(context: { request: Request; env: Env }) {
  const { request } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, context.env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      resolutionType: 'sole_director' | 'members' | 'members_consent' | 'members_resolution';
      includeConsent?: boolean;
      companyName?: string;
      oldName?: string;
      oldChineseName?: string;
      newName?: string;
      newChineseName?: string;
      ciNumber?: string;
      resolutionDate?: string;  // YYYY-MM-DD
      meetingTime?: string;
      signer1Name?: string;
      signer2Name?: string;
    };

    // Map frontend type names to template keys
    const TYPE_MAP: Record<string, string> = {
      'sole_director': 'sole_director',
      'members': 'members_resolution',
      'members_resolution': 'members_resolution',
      'members_consent': 'members_consent',
    };
    const rt = TYPE_MAP[data.resolutionType];
    if (!rt || !RESOLUTION_TEMPLATES[rt]) {
      return json({ error: `Unknown resolution type: ${rt}. Valid: ${Object.keys(RESOLUTION_TEMPLATES).join(', ')}` }, 400);
    }

    // Format date as DD/MM/YYYY
    const d = (data.resolutionDate || '').split('-'); // YYYY-MM-DD → DD/MM/YYYY
    const dateDDMMYYYY = d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : data.resolutionDate || '';
    const dateBlank = dateDDMMYYYY; // For signature date blanks

    const companyName = data.oldName || data.companyName || '';
    const newName = data.newName || '';
    const oldNameFull = data.oldChineseName
      ? `${companyName} (${data.oldChineseName})`
      : companyName;

    const vars: Record<string, string> = {
      COMPANY_NAME_EN: companyName,
      CI_NUMBER: data.ciNumber || '',
      NEW_NAME_EN: newName,
      DATE_DDMMYYYY: dateDDMMYYYY,
      DATE_BLANK: dateBlank,
      TIME: data.meetingTime || '10:00AM',
      SIGNER_1: data.signer1Name || '',
      SIGNER_2: data.signer2Name || '',
    };

    // Fill template
    const filledEntries = fillTemplate(RESOLUTION_TEMPLATES[rt], vars);

    // Build ZIP
    const files = Object.entries(filledEntries).map(([name, b64]) => {
      const decoded = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return { name, data: decoded };
    });

    const zipBytes = buildZip(files);
    const docxB64 = uint8ToBase64(zipBytes);

    const filename = `Resolution_${rt}_${companyName.replace(/[^a-zA-Z0-9]/g, '_')}.docx`;

    return json({ success: true, docx: docxB64, filename, doc_type: rt });

  } catch (e: any) {
    console.error("generate-resolution-docx error:", e);
    return json({ error: e.message || String(e) }, 500);
  }
}
