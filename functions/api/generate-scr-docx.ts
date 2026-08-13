// POST /api/generate-scr-docx
// Generate SCR (Significant Controllers Register) DOCX from 重要控制人.doc template.
// Template has 6 tables:
//   Table[0] = Main SCR register (2 data rows: {{SCR_*}}, {{SCR2_*}})
//   Table[1] = Additional Matters (static)
//   Table[2] = Designated Rep (1 data row: {{REP1_*}})
//   Table[3] = SCR page 2 (empty — for overflow cloning)
//   Table[4] = Additional Matters 2 (static)
//   Table[5] = Designated Rep 2 (empty — for overflow cloning)
// Tables[3] and [5] are overflow pages — we clone template rows into them
// when there are more than 2 controllers or more than 1 designated rep.

import { verifyAuthRequest, type Env } from './_auth';
import SCR_TEMPLATE from './_template_scr_register_template';

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

// ── SCR data interfaces ──
interface ScrController {
  entryDate: string;
  name: string;
  addr: string;
  idBlock: string;   // ID/PPT or Company No + jurisdiction
  nature: string;     // Nature of control text
  dates: string;      // Becoming date / cessation date
  remarks: string;
}

interface ScrRep {
  entryDate: string;
  name: string;
  addr: string;
  capacity: string;
  tel: string;
  dates: string;
  remarks: string;
}

// ── SCR row cloning ──
// Extracts the template data row from Table[0] Row 1,
// clones it for each controller, replaces the template rows.

function buildScrControllerRows(docXml: string, controllers: ScrController[]): string {
  const marker = "{{SCR_ENTRY_DATE}}";
  const markerIdx = docXml.indexOf(marker);
  if (markerIdx < 0) return docXml;  // No template marker — shouldn't happen

  // Find Table[0] Row 1 <w:tr> containing {{SCR_ENTRY_DATE}}
  const row1Start = docXml.lastIndexOf("<w:tr ", markerIdx);
  const row1End = docXml.indexOf("</w:tr>", markerIdx);
  if (row1Start < 0 || row1End < 0) return docXml;

  const templateRow = docXml.substring(row1Start, row1End + "</w:tr>".length);

  // Find Row 2 (has {{SCR2_*}}) to know what to replace
  const row2Marker = "{{SCR2_ENTRY_DATE}}";
  const row2Idx = docXml.indexOf(row2Marker);
  let row2End = 0;
  if (row2Idx >= 0) {
    row2End = docXml.indexOf("</w:tr>", row2Idx);
    if (row2End >= 0) row2End += "</w:tr>".length;
  }

  // Determine replacement range: from row1Start to end of row2 (if present)
  const replaceEnd = row2End > 0 ? row2End : (row1End + "</w:tr>".length);

  // Clone row for each controller
  const rows: string[] = [];
  if (controllers.length === 0) {
    let r = templateRow;
    r = r.replaceAll("{{SCR_ENTRY_DATE}}", "");
    r = r.replaceAll("{{SCR_NAME}}", escXml("(No significant controllers / 尚無重要控制人記錄)"));
    const scrPhs = ["SCR_ADDR","SCR_ID","SCR_NATURE","SCR_DATES","SCR_REMARKS"];
    for (const ph of scrPhs) r = r.replaceAll(`{{${ph}}}`, "");
    rows.push(r);
  } else {
    for (const sc of controllers) {
      let r = templateRow;
      r = r.replaceAll("{{SCR_ENTRY_DATE}}", escXml(sc.entryDate));
      r = r.replaceAll("{{SCR_NAME}}", escXml(sc.name));
      r = r.replaceAll("{{SCR_ADDR}}", escXml(sc.addr));
      r = r.replaceAll("{{SCR_ID}}", escXml(sc.idBlock));
      r = r.replaceAll("{{SCR_NATURE}}", escXml(sc.nature));
      r = r.replaceAll("{{SCR_DATES}}", escXml(sc.dates));
      r = r.replaceAll("{{SCR_REMARKS}}", escXml(sc.remarks));
      rows.push(r);
    }
  }

  const before = docXml.substring(0, row1Start);
  const after = docXml.substring(replaceEnd);
  let result = before + rows.join("") + after;

  // Clean any remaining SCR2_* placeholders
  const scr2Phs = ["SCR2_ENTRY_DATE","SCR2_NAME","SCR2_ADDR","SCR2_ID",
    "SCR2_NATURE","SCR2_DATES","SCR2_REMARKS"];
  for (const ph of scr2Phs) result = result.replaceAll(`{{${ph}}}`, "");

  return result;
}

// ── Designated Rep row cloning ──
// REP1_* in Table[2] (page 1) = first designated rep
// REP2_* in Table[5] (page 2) = 2nd+ designated reps
// Clones REP2 template row for 3rd+ reps.

function buildScrRepRows(docXml: string, reps: ScrRep[]): string {
  const rep1Marker = "{{REP1_ENTRY_DATE}}";
  const rep1Idx = docXml.indexOf(rep1Marker);
  const rep2Marker = "{{REP2_ENTRY_DATE}}";
  const rep2Idx = docXml.indexOf(rep2Marker);

  // ── Helper: fill one template row ──
  function fillRepRow(templateRow: string, rep: ScrRep, prefix: string): string {
    let r = templateRow;
    r = r.replaceAll(`{{${prefix}ENTRY_DATE}}`, escXml(rep.entryDate));
    r = r.replaceAll(`{{${prefix}NAME}}`, escXml(rep.name));
    r = r.replaceAll(`{{${prefix}ADDR}}`, escXml(rep.addr));
    r = r.replaceAll(`{{${prefix}CAPACITY}}`, escXml(rep.capacity));
    r = r.replaceAll(`{{${prefix}TEL}}`, escXml(rep.tel));
    r = r.replaceAll(`{{${prefix}DATES}}`, escXml(rep.dates));
    r = r.replaceAll(`{{${prefix}REMARKS}}`, escXml(rep.remarks));
    return r;
  }

  // ── Helper: clear a row's placeholders ──
  function clearRepRow(rowXml: string, prefix: string): string {
    const phs = ["ENTRY_DATE","NAME","ADDR","CAPACITY","TEL","DATES","REMARKS"];
    for (const ph of phs) rowXml = rowXml.replaceAll(`{{${prefix}${ph}}}`, "");
    return rowXml;
  }

  // ── 1. Process Table[5] REP2 row FIRST (it's after REP1, so its indices stay valid) ──
  if (rep2Idx >= 0) {
    const row2Start = docXml.lastIndexOf("<w:tr ", rep2Idx);
    const row2End = docXml.indexOf("</w:tr>", rep2Idx);
    if (row2Start >= 0 && row2End >= 0) {
      const templateRow = docXml.substring(row2Start, row2End + "</w:tr>".length);

      const overflowReps = reps.slice(1); // 2nd rep onwards
      let overflowRows: string;
      if (overflowReps.length === 0) {
        overflowRows = clearRepRow(templateRow, "REP2_");
      } else {
        overflowRows = overflowReps.map(rep =>
          fillRepRow(templateRow, rep, "REP2_")
        ).join("");
      }

      docXml = docXml.substring(0, row2Start) + overflowRows + docXml.substring(row2End + "</w:tr>".length);
    }
  }

  // ── 2. Process Table[2] REP1 row (before REP2 in document; REP2 already processed) ──
  if (rep1Idx >= 0) {
    const row1Start = docXml.lastIndexOf("<w:tr ", rep1Idx);
    const row1End = docXml.indexOf("</w:tr>", rep1Idx);
    if (row1Start >= 0 && row1End >= 0) {
      const row1Xml = docXml.substring(row1Start, row1End + "</w:tr>".length);
      let rep1Row: string;
      if (reps.length > 0) {
        rep1Row = fillRepRow(row1Xml, reps[0], "REP1_");
      } else {
        rep1Row = clearRepRow(row1Xml, "REP1_");
        rep1Row = rep1Row.replaceAll("{{REP1_NAME}}", escXml("(No designated representatives / 尚無指定代表)"));
      }
      docXml = docXml.substring(0, row1Start) + rep1Row + docXml.substring(row1End + "</w:tr>".length);
    }
  }

  // ── 3. Clean any remaining REP2_* placeholders ──
  const repPhs = ["ENTRY_DATE","NAME","ADDR","CAPACITY","TEL","DATES","REMARKS"];
  for (const ph of repPhs) {
    docXml = docXml.replaceAll(`{{REP2_${ph}}}`, "");
  }

  return docXml;
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
    if (!companyId) return json({ error: "companyId required" }, 400);

    // ── Fetch data ──
    const [company, scrResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare(
        "SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY created_at"
      ).bind(companyId).all(),
    ]);

    if (!company) throw new Error("Company not found");
    const scrs = (scrResult.results || []) as any[];

    const coNameEn = rget(company, 'name') || '';
    const coNameCh = rget(company, 'chinese_name') || '';
    const coBr = rget(company, 'company_number') || '';

    // ── Build controllers and designated reps ──
    const controllers: ScrController[] = [];
    const reps: ScrRep[] = [];

    for (const s of scrs) {
      // Determine natures of control
      const natures: string[] = [];
      if (rget(s, 'nature_shares') === '1') natures.push('Hold >25% shares / 持有>25%股份');
      if (rget(s, 'nature_voting') === '1') natures.push('Hold >25% voting rights / 持有>25%表決權');
      if (rget(s, 'nature_appoint') === '1') natures.push('Appoint/remove directors / 委任/罷免董事');
      if (rget(s, 'nature_influence') === '1') natures.push('Significant influence / 重大影響力');
      if (rget(s, 'nature_trust') === '1') natures.push('Trust control / 信託控制');
      if (rget(s, 'nature_other')) natures.push(rget(s, 'nature_other'));

      const isNat = rget(s, 'identity') !== 'corporate';
      const nameEn = rget(s, 'name_english') || '';
      const nameCh = rget(s, 'name_chinese') || '';
      const nameDisplay = nameCh ? `${nameCh}  ${nameEn}`.trim() : (nameEn || '(unnamed)');

      // ID block
      let idBlock: string;
      if (isNat) {
        const idType = rget(s, 'id_number') ? 'HKID' : '';
        const pptNo = rget(s, 'passport_number') || '';
        const pptCountry = rget(s, 'passport_country') || '';
        if (idType && rget(s, 'id_number')) {
          idBlock = `HKID: ${rget(s, 'id_number')}`;
        } else if (pptNo) {
          idBlock = `PPT: ${pptNo}`;
          if (pptCountry) idBlock += ` (${pptCountry})`;
        } else {
          idBlock = '-';
        }
      } else {
        const compNo = rget(s, 'company_number_ref') || '-';
        const placeIncorp = rget(s, 'place_of_incorporation') || '';
        idBlock = `Co No: ${compNo}`;
        if (placeIncorp) idBlock += ` (${placeIncorp})`;
      }

      const addr = (rget(s, 'address') || '').slice(0, 200);
      const natureText = natures.join('; ') || '-';
      const dateBecame = rget(s, 'date_became') || '-';
      const dateCea = rget(s, 'date_ceased') || '';
      const dateDisplay = dateCea ? `${dateBecame} / ${dateCea}` : `${dateBecame} /`;

      let entryDate = rget(s, 'created_at') || '';
      if (entryDate && entryDate.length > 10) entryDate = entryDate.slice(0, 10);

      const remarksParts: string[] = [];
      if (!dateCea) remarksParts.push("Current / 現任");
      const userRemarks = rget(s, 'remarks') || '';
      if (userRemarks) remarksParts.push(userRemarks);
      const remarks = remarksParts.join('; ');

      // Check if this record is a designated rep
      if (rget(s, 'is_designated_rep') === '1') {
        // This person IS a designated representative
        reps.push({
          entryDate,
          name: nameDisplay,
          addr,
          capacity: rget(s, 'designated_rep_contact') || 'Director',
          tel: '',
          dates: dateDisplay,
          remarks,
        });
      } else {
        // This person is a registrable person (significant controller)
        controllers.push({
          entryDate,
          name: nameDisplay,
          addr,
          idBlock,
          nature: natureText,
          dates: dateDisplay,
          remarks,
        });

        // If controller has a named designated rep, add a rep entry
        if (rget(s, 'designated_rep_name')) {
          reps.push({
            entryDate,
            name: rget(s, 'designated_rep_name'),
            addr: rget(s, 'service_address') || addr,
            capacity: rget(s, 'designated_rep_contact') || 'Director',
            tel: '',
            dates: dateDisplay,
            remarks: `Rep for: ${nameDisplay}`,
          });
        }
      }
    }

    // ── Get template ──
    const template = SCR_TEMPLATE;
    if (!template) throw new Error("SCR template not found in data");

    // ── Fill header placeholders (CO_NAME, CO_BR, CO_JURISDICTION) ──
    // header1.xml now has {{CO_NAME}}, {{CO_BR}}, {{CO_JURISDICTION}}
    let entries = fillTemplate(template, {
      CO_NAME: coNameEn,
      CO_BR: coBr,
      CO_JURISDICTION: 'Hong Kong',
    });

    // ── Build controller and rep rows ──
    let docXml = atob(entries["word/document.xml"]);

    // Replace SCR controller rows (Table[0] Rows 1-2)
    docXml = buildScrControllerRows(docXml, controllers);

    // Replace designated rep rows (Table[2] Row 1 = 1st rep; Table[5] = 2nd+)
    docXml = buildScrRepRows(docXml, reps);

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
      filename: `SCR_${coBr}_${coNameEn.slice(0, 30)}.docx`,
    });
  } catch (e: any) {
    console.error("generate-scr-docx error:", e);
    return json({ error: e.message || String(e) }, 500);
  }
}
