// POST /api/generate-rod-docx
// Generate ROD (Register of Officers) DOCX from Paul Tang RTF→DOCX template.
// Paragraph-based layout: header + director blocks + secretary blocks.
// Each officer takes ~12 paragraphs (name, address lines, DOB/POB/nation, ID, position, dates).
import { verifyAuthRequest, type Env } from './_auth';
import ROD_TEMPLATE from './_template_rod_register_template';

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

// ── ZIP builder (same as other endpoints) ──
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

// ── ROD-specific: paragraph-based officer blocks ──
// The template has:
//   DIR1_* block (P13-P24): 12 paragraphs (Name + Addr1-3 + DOB/POB/Nation + ID + Position + DateApp + Reason + DateCea)
//   "Secretary" label (P25-P26): static label rows — NOT cloned
//   DIR2_* block (P27-P36): 10 paragraphs (Name + Addr1-3 + DOB/POB/Nation + ID + Position + DateApp)
// We extract each block as a template and clone by officer type (director→DIR1, secretary→DIR2).
// IMPORTANT: each field is filled individually to avoid literal \n inside <w:t> which corrupts Word rendering.

interface Officer {
  name: string;           // Name only (single line)
  addr1: string;          // Address line 1
  addr2: string;          // Address line 2
  addr3: string;          // Address line 3
  dob: string;            // Date of Birth (or place incorporated for corporate)
  pob: string;            // Place of Birth
  nation: string;         // Nationality
  idInfo: string;         // ID / Passport / Company Number
  position: string;       // Director / Reserve Director / Secretary
  dateApp: string;        // Date appointed
  reason: string;         // Reason ceased (or "Current")
  dateCea: string;        // Date ceased (or "")
}

/** Split a long address into max 3 lines, breaking at comma/space boundaries.
 *  maxLen 40: the template's own sample line "ROOM 405 TUNG NING BUILDING, 249-253 "
 *  (40 chars @ 9pt) is the widest that fits the name/address column (916→4846 twips). */
function splitAddr(addr: string): [string, string, string] {
  const maxLen = 40;
  const lines: string[] = [];
  let remaining = addr.trim();
  while (remaining && lines.length < 2) {
    if (remaining.length <= maxLen) { lines.push(remaining); remaining = ''; break; }
    let cut = maxLen;
    const comma = remaining.lastIndexOf(',', maxLen);
    const space = remaining.lastIndexOf(' ', maxLen);
    if (comma > maxLen * 0.6) cut = comma + 1;
    else if (space > maxLen * 0.6) cut = space;
    lines.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) lines.push(remaining.slice(0, maxLen));
  while (lines.length < 3) lines.push('');
  return [lines[0] || '', lines[1] || '', lines[2] || ''];
}

// ── Absolute-positioned template layout (twips, from Testing ROD.rtf) ──
// Every paragraph carries w:framePr vAnchor="page", so identical clones stack on
// top of each other unless their y coordinates are offset per officer.
// DIR1 block occupies y=2521..3241 (4 lines @240 twips). The next template row
// (Secretary) starts at y=3706 → per-row step = 1185 twips. Landscape A4 is
// 11906 twips tall and content must stay above the page-number line (~10801)
// → 7 officer rows fit per page.
const ROW_STEP = 1185;
const ROWS_PER_PAGE = 7;

/** Shift every framePr y coordinate in a block by `offset` twips. */
function shiftBlockY(blockXml: string, offset: number): string {
  if (offset <= 0) return blockXml;
  return blockXml.replace(/w:y="(\d+)"/g, (_m, y: string) => `w:y="${parseInt(y, 10) + offset}"`);
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** 0.75pt 全宽黑色横线（VML bar，与模板页框线同机制），topPt = 页面绝对 y（pt） */
function vmlBar(topPt: number, id: string): string {
  return `<w:p><w:pPr><w:widowControl w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:adjustRightInd w:val="0"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:rect id="${id}" style="position:absolute;margin-left:42.75pt;margin-top:${topPt.toFixed(2)}pt;width:756.75pt;height:.75pt;z-index:-251629568;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" o:allowincell="f" fillcolor="black" stroked="f"><w10:wrap anchorx="page" anchory="page"/></v:rect></w:pict></w:r></w:p>`;
}

// ══════════════════════════════════════════════════════════════
export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const { companyId } = await request.json() as any;
    if (!companyId) return json({ error: "companyId required" }, 400);

    // ── Fetch data ──
    const [company, rolesResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      // 董事登記冊先只出董事（秘书走独立 SEC 端点；DIR2 克隆代码保留以便将来恢复）
      env.DB.prepare(
        "SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'director'"
      ).bind(companyId).all(),
    ]);

    if (!company) throw new Error("Company not found");

    const roles = (rolesResult.results || []) as any[];
    const personIds = roles.map((r: any) => r.person_id).filter(Boolean);
    const personMap = new Map<string, any>();
    if (personIds.length > 0) {
      const ph = personIds.map(() => '?').join(',');
      const result = await env.DB.prepare(
        `SELECT * FROM persons WHERE id IN (${ph})`
      ).bind(...personIds).all();
      (result.results || []).forEach((p: any) => personMap.set(p.id, p));
    }

    const directors = roles.filter((r: any) => r.role === "director");
    const quorum = directors.length || 0;

    // Company data
    const coName = rget(company, 'name') || '';
    const coBr = rget(company, 'company_number') || '';
    const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
      'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    const today = new Date();
    const reportDate = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;

    // Build officers list
    const officers: Officer[] = [];
    const addOfficer = (r: any, position: string) => {
      const p = personMap.get(r.person_id) || {};
      const nameEn = rget(p, 'name_english') || rget(p, 'name_chinese') || '(unnamed)';
      const isNat = (rget(p, 'identity') || 'natural') === 'natural';

      // Address split into individual lines (max 3)
      const rawAddr = (isNat ? rget(p, 'address') : rget(p, 'registered_office') || rget(p, 'address') || '');
      const [a1, a2, a3] = splitAddr(rawAddr);

      // DOB / Place of Birth / Nationality (individual fields, no \n)
      let dob: string, pob: string, nation: string;
      if (isNat) {
        dob = rget(p, 'date_of_birth') || '-';
        pob = rget(p, 'place_of_birth') || '-';
        nation = rget(p, 'nationality') || '-';
      } else {
        dob = rget(p, 'place_incorporated') || '-';
        pob = '-';
        nation = '-';
      }

      const idInfo = isNat
        ? (rget(p, 'id_number') || rget(p, 'passport_number') || '-')
        : (rget(p, 'company_number_ref') || '-');

      const dateApp = rget(r, 'date_appointed') || '-';
      const dateCea = rget(r, 'date_ceased') || '';
      const reason = dateCea ? 'Resigned' : 'Current';

      officers.push({
        name: escXml(nameEn),
        addr1: escXml(a1),
        addr2: escXml(a2),
        addr3: escXml(a3),
        dob: escXml(dob),
        pob: escXml(pob),
        nation: escXml(nation),
        idInfo: escXml(idInfo),
        position: escXml(position),
        dateApp: escXml(dateApp),
        reason: escXml(reason),
        dateCea: escXml(dateCea),
      });
    };

    for (const d of directors) {
      const pos = rget(d, 'is_reserve') === '1' ? 'Reserve Director' : 'Director';
      addOfficer(d, pos);
    }

    // ── Get template ──
    const template = ROD_TEMPLATE;
    if (!template) throw new Error("ROD template not found in data");

    // Fill header
    let entries = fillTemplate(template, {
      CO_NAME: coName,
      CO_BR: coBr,
      REPORT_DATE: reportDate,
      QUORUM: String(quorum),
    });

    let docXml = atob(entries["word/document.xml"]);

    // 灰表头块上下分界线（参考 Testing ROD y=78.7/116.6，0.75pt 黑线）
    const grayIdx = docXml.indexOf("_x0000_s2057");
    if (grayIdx >= 0) {
      const grayParaEnd = docXml.indexOf("</w:p>", grayIdx);
      if (grayParaEnd >= 0) {
        docXml = docXml.slice(0, grayParaEnd + 6)
          + vmlBar(78.7, "_x0000_s3A01")
          + vmlBar(116.6, "_x0000_s3A02")
          + docXml.slice(grayParaEnd + 6);
      }
    }

    // ── Build officer paragraph blocks ──
    // Extract DIR1 block (12 paragraphs: Name→DateCeased) and DIR2 block (10 paragraphs: Name→DateApp)
    // The "Secretary" label rows (P25-P26) between them are template boilerplate — NOT cloned.
    const findParaStart = (xml: string, idx: number) => xml.lastIndexOf("<w:p ", idx);
    const findParaEnd = (xml: string, idx: number) => {
      const end = xml.indexOf("</w:p>", idx);
      return end >= 0 ? end + "</w:p>".length : idx;
    };

    const dir1NameIdx = docXml.indexOf("{{DIR1_NAME}}");
    const dir1DateCeaIdx = docXml.indexOf("{{DIR1_DATE_CEA}}");
    const dir2NameIdx = docXml.indexOf("{{DIR2_NAME}}");
    const dir2DateAppIdx = docXml.indexOf("{{DIR2_DATE_APP}}");
    const dataEndIdx = docXml.indexOf("{{ROD_DATA_END}}");

    const dirBlockStart = dir1NameIdx >= 0 ? findParaStart(docXml, dir1NameIdx) : -1;
    // DIR1 block ends after DIR1_DATE_CEA paragraph (excludes Secretary label)
    const dirBlockEnd = dir1DateCeaIdx >= 0 ? findParaEnd(docXml, dir1DateCeaIdx) : -1;
    const dirBlockXml = dirBlockStart >= 0 && dirBlockEnd > dirBlockStart
      ? docXml.substring(dirBlockStart, dirBlockEnd) : "";

    // DIR2 block: shorter (no Reason/Ceased fields)
    const secBlockStart = dir2NameIdx >= 0 ? findParaStart(docXml, dir2NameIdx) : -1;
    const secBlockEnd = dir2DateAppIdx >= 0 ? findParaEnd(docXml, dir2DateAppIdx) : -1;
    const secBlockXml = secBlockStart >= 0 && secBlockEnd > secBlockStart
      ? docXml.substring(secBlockStart, secBlockEnd) : "";

    if (dirBlockStart >= 0 && dataEndIdx >= 0) {
      const generatedParas: string[] = [];

      // Column-header block (P4-P12) — cloned at the top of continuation pages
      const hdrNameIdx = docXml.indexOf('Name / Service / Residential Address');
      const hdrCeasedIdx = docXml.indexOf('Ceased');
      const hdrBlockStart = hdrNameIdx >= 0 ? findParaStart(docXml, hdrNameIdx) : -1;
      const hdrBlockEnd = hdrCeasedIdx >= 0 ? findParaEnd(docXml, hdrCeasedIdx) : -1;
      const headerBlockXml = hdrBlockStart >= 0 && hdrBlockEnd > hdrBlockStart
        ? docXml.substring(hdrBlockStart, hdrBlockEnd) : '';

      for (const [i, off] of officers.entries()) {
        const isDirector = off.position === 'Director' || off.position === 'Reserve Director';
        const block = isDirector && dirBlockXml ? dirBlockXml : (secBlockXml || dirBlockXml);
        const prefix = isDirector && dirBlockXml ? 'DIR1' : (secBlockXml ? 'DIR2' : 'DIR1');

        let b = block;
        b = b.replaceAll(`{{${prefix}_NAME}}`, off.name);
        b = b.replaceAll(`{{${prefix}_ADDR1}}`, off.addr1);
        b = b.replaceAll(`{{${prefix}_ADDR2}}`, off.addr2);
        b = b.replaceAll(`{{${prefix}_ADDR3}}`, off.addr3);
        b = b.replaceAll(`{{${prefix}_DOB}}`, off.dob);
        b = b.replaceAll(`{{${prefix}_POB}}`, off.pob);
        b = b.replaceAll(`{{${prefix}_NATION}}`, off.nation);
        b = b.replaceAll(`{{${prefix}_ID}}`, off.idInfo);
        b = b.replaceAll(`{{${prefix}_POSITION}}`, off.position);
        b = b.replaceAll(`{{${prefix}_DATE_APP}}`, off.dateApp);
        // DIR1-only fields (Reason + DateCeased)
        if (prefix === 'DIR1') {
          b = b.replaceAll(`{{DIR1_REASON}}`, off.reason);
          b = b.replaceAll(`{{DIR1_DATE_CEA}}`, off.dateCea);
        }
        // Clean opposite prefix placeholders
        const dir1OnlyPHs = ['REASON', 'DATE_CEA'];
        const commonPHs = ['NAME','ADDR1','ADDR2','ADDR3','DOB','POB','NATION','ID','POSITION','DATE_APP'];
        const toClean = prefix === 'DIR1'
          ? commonPHs.map(p => `DIR2_${p}`)
          : [...commonPHs.map(p => `DIR1_${p}`), ...dir1OnlyPHs.map(p => `DIR1_${p}`)];
        for (const ph of toClean) {
          b = b.replaceAll(`{{${ph}}}`, '');
        }

        // Reposition: shift the block down one row slot per officer, and start
        // a new page (with a cloned column-header row) when the page is full.
        // The first page keeps the original header rows above the data area.
        const rowOnPage = i % ROWS_PER_PAGE;
        if (rowOnPage > 0) {
          b = shiftBlockY(b, rowOnPage * ROW_STEP);
        }
        if (i > 0 && rowOnPage === 0) {
          b = PAGE_BREAK + headerBlockXml + b;
        }
        generatedParas.push(b);

        // 董事间分界线：每个董事块之后一条 0.75pt 黑线（参考 Testing ROD 惯例：
        // 董事组间细线 + 末位董事后数据区底线；像素实测参考所有线统一 0.75pt）
        // 块原生占 y=2521..3241tw，末行文字底≈3481tw，下一块顶 3706tw → 间隙中心 3550tw
        const sepTopPt = (3550 + rowOnPage * ROW_STEP) / 20 - 0.375;
        generatedParas.push(vmlBar(sepTopPt, `_x0000_s3B${String(i).padStart(2, "0")}`));
      }

      // Replace everything from dirBlockStart to ROD_DATA_END paragraph
      const dataEnd = findParaEnd(docXml, dataEndIdx);
      const before = docXml.substring(0, dirBlockStart);
      const after = docXml.substring(dataEnd);

      if (generatedParas.length > 0) {
        docXml = before + generatedParas.join('') + after;
      } else {
        const emptyPara = `<w:p><w:r><w:t>${escXml("(No officers / 尚無記錄)")}</w:t></w:r></w:p>`;
        docXml = before + emptyPara + after;
      }
    }

    // Clean up any remaining placeholders (ROD_DATA_START, ROD_DATA_END, etc.)
    const allPHs = [
      "DIR1_NAME","DIR1_ADDR1","DIR1_ADDR2","DIR1_ADDR3","DIR1_DOB","DIR1_POB",
      "DIR1_NATION","DIR1_ID","DIR1_POSITION","DIR1_DATE_APP","DIR1_REASON","DIR1_DATE_CEA",
      "DIR2_NAME","DIR2_ADDR1","DIR2_ADDR2","DIR2_ADDR3","DIR2_DOB","DIR2_POB",
      "DIR2_NATION","DIR2_ID","DIR2_POSITION","DIR2_DATE_APP",
      "ROD_DATA_START","ROD_DATA_END",
    ];
    for (const ph of allPHs) {
      docXml = docXml.replaceAll(`{{${ph}}}`, "");
    }

    entries["word/document.xml"] = btoa(docXml);

    // Build ZIP
    const files = Object.entries(entries).map(([name, b64]) => ({
      name,
      data: Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0)),
    }));
    const zipBytes = buildZip(files);
    const docxB64 = uint8ToBase64(zipBytes);

    return json({
      success: true,
      docx: docxB64,
      filename: `RegisterOfOfficers_${coBr}_${coName.slice(0, 30)}.docx`,
    });
  } catch (e: any) {
    console.error("generate-rod-docx error:", e);
    return json({ error: e.message || String(e) }, 500);
  }
}
