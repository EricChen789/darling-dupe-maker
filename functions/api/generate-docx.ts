// POST /api/generate-docx
// 生成 Word (.docx) 文件 — 零依賴手寫 ZIP(store+CRC32) + OOXML 生成器
// 移植自 local-server/server.py:_build_docx（Cloudflare Workers 跑不了 python-docx，故手寫）
// body: { company_id, doc_type, content?, meeting_date?, location? }
// resp: { success: true, docx: '<base64>', filename, doc_type }
// 6 種 doc_type: company_profile / directors_register / members_register / board_resolution / meeting_minutes / scr_register

import { verifyAuthRequest, type Env as AuthEnv } from './_auth';

type Env = AuthEnv & {
  DB: D1Database;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DOCX_TYPES: Record<string, string> = {
  company_profile: "公司資料摘要",
  directors_register: "董事名冊",
  members_register: "成員（股東）名冊",
  board_resolution: "董事會書面決議",
  meeting_minutes: "董事會會議記錄",
  scr_register: "重要控制人登記冊",
  cr_form: "政府表格 (Word)",
};

const CR_FORM_META: Record<string, { code: string; title: string; title_en: string }> = {
  nar1:  { code: "NAR1",  title: "周年申報表",           title_en: "Annual Return" },
  nd2a:  { code: "ND2A",  title: "更改公司秘書及董事通知書（委任／停任）", title_en: "Notice of Change of Company Secretary and Director (Appointment/Cessation)" },
  nd2b:  { code: "ND2B",  title: "更改公司秘書及董事詳情通知書",       title_en: "Notice of Change in Particulars of Company Secretary and Director" },
  nd4:   { code: "ND4",   title: "公司秘書及董事辭任通知書",           title_en: "Notice of Resignation of Company Secretary and Director" },
  ndr1:  { code: "NDR1",  title: "撤銷註冊申請書",                    title_en: "Application for Deregistration" },
  nr1:   { code: "NR1",   title: "註冊辦事處地址變更通知書",           title_en: "Notice of Change of Registered Office Address" },
  nsc1:  { code: "NSC1",  title: "股份配發申報書",                    title_en: "Return of Allotment" },
  nnc1:  { code: "NNC1",  title: "法團成立表格（股份有限公司）",        title_en: "Incorporation Form (Company Limited by Shares)" },
  nnc2:  { code: "NNC2",  title: "更改公司名稱通知書",                 title_en: "Notice of Change of Company Name" },
  nn1:   { code: "NN1",   title: "註冊非香港公司註冊申請書",            title_en: "Application for Registration as Registered Non-Hong Kong Company" },
  nn3:   { code: "NN3",   title: "註冊非香港公司周年申報表",            title_en: "Annual Return of Registered Non-Hong Kong Company" },
  nn6:   { code: "NN6",   title: "非香港公司更改秘書及董事（委任／停任）", title_en: "Change of Company Secretary and Director of Non-Hong Kong Company" },
  nn7:   { code: "NN7",   title: "非香港公司更改秘書及董事詳情",         title_en: "Change in Particulars of Company Secretary and Director of Non-Hong Kong Company" },
  nn9:   { code: "NN9",   title: "非香港公司更改地址申報表",            title_en: "Notice of Change of Address of Non-Hong Kong Company" },
};

const CJK_FONT = "Microsoft JhengHei";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─────────────────────────── ZIP (STORE / no compression) ───────────────────────────

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

// 累積小端字節，用於拼裝 ZIP 記錄
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
    lh.u32(0x04034b50); // local file header signature
    lh.u16(20);         // version needed
    lh.u16(0x0800);     // flags: UTF-8 filename
    lh.u16(0);          // method: store
    lh.u16(0);          // mod time
    lh.u16(0);          // mod date
    lh.u32(crc);
    lh.u32(size);       // compressed size
    lh.u32(size);       // uncompressed size
    lh.u16(nameBytes.length);
    lh.u16(0);          // extra length
    lh.raw(nameBytes);
    const lhBytes = lh.build();
    local.push(lhBytes, f.data);

    const ch = new ByteWriter();
    ch.u32(0x02014b50); // central directory header signature
    ch.u16(20);         // version made by
    ch.u16(20);         // version needed
    ch.u16(0x0800);     // flags
    ch.u16(0);          // method
    ch.u16(0);          // mod time
    ch.u16(0);          // mod date
    ch.u32(crc);
    ch.u32(size);
    ch.u32(size);
    ch.u16(nameBytes.length);
    ch.u16(0);          // extra length
    ch.u16(0);          // comment length
    ch.u16(0);          // disk number start
    ch.u16(0);          // internal attrs
    ch.u32(0);          // external attrs
    ch.u32(offset);     // local header offset
    ch.raw(nameBytes);
    central.push(ch.build());

    offset += lhBytes.length + f.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const eocd = new ByteWriter();
  eocd.u32(0x06054b50); // end of central dir signature
  eocd.u16(0);          // disk number
  eocd.u16(0);          // disk with central dir
  eocd.u16(files.length);
  eocd.u16(files.length);
  eocd.u32(centralSize);
  eocd.u32(centralStart);
  eocd.u16(0);          // comment length

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

// ─────────────────────────── OOXML 片段生成 ───────────────────────────

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 段落（size 為 pt，OOXML 用半點所以 ×2）
function P(text: string, opts: { size?: number; bold?: boolean; center?: boolean; after?: number } = {}): string {
  const { size = 11, bold = false, center = false, after } = opts;
  const spacing = after != null ? `<w:spacing w:after="${after * 20}"/>` : "";
  const jc = center ? '<w:jc w:val="center"/>' : "";
  const pPr = spacing || jc ? `<w:pPr>${spacing}${jc}</w:pPr>` : "";
  const rPr = `<w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/></w:rPr>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

// 標題（預設置中 + 段後間距）
function H(text: string, opts: { size?: number; bold?: boolean; center?: boolean } = {}): string {
  const { size = 16, bold = true, center = true } = opts;
  return P(text, { size, bold, center, after: 6 });
}

const EMPTY_P = "<w:p/>";

const TBL_BORDERS =
  "<w:tblBorders>" +
  ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`)
    .join("") +
  "</w:tblBorders>";

interface Cell { text: string; bold?: boolean; header?: boolean }

function tc(c: Cell, width: number): string {
  const shd = c.header ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>' : "";
  const rPr = `<w:rPr>${c.bold || c.header ? "<w:b/>" : ""}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>`;
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shd}` +
    `<w:vAlign w:val="center"/></w:tcPr>` +
    `<w:p><w:r>${rPr}<w:t xml:space="preserve">${esc(c.text)}</w:t></w:r></w:p></w:tc>`
  );
}

function table(widths: number[], rows: Cell[][]): string {
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const trs = rows
    .map((r) => `<w:tr>${r.map((c, i) => tc(c, widths[i])).join("")}</w:tr>`)
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${TBL_BORDERS}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>`;
}

// key/value 兩欄表（key 加粗）
function kvTable(rows: [string, string][]): string {
  return table(
    [2800, 6200],
    rows.map(([k, v]) => [{ text: k, bold: true }, { text: v || "—" }])
  );
}

// 多欄成員表（首行為表頭）
function membersTable(headers: string[], dataRows: (string | number | null | undefined)[][]): string {
  const total = 9000;
  const w = Math.floor(total / headers.length);
  const widths = headers.map(() => w);
  const rows: Cell[][] = [headers.map((h) => ({ text: h, header: true }))];
  for (const dr of dataRows) {
    rows.push(dr.map((v) => ({ text: v == null || v === "" ? "—" : String(v) })));
  }
  return table(widths, rows);
}

// ─────────────────────────── 業務數據處理 ───────────────────────────

function fmtDate(s: unknown): string {
  if (!s) return "";
  const str = String(s).trim();
  if (str.length === 8 && /^\d+$/.test(str)) return `${str.slice(0, 2)}/${str.slice(2, 4)}/${str.slice(4, 8)}`;
  return str;
}

function personLabel(m: any): string {
  const en = (m.name_english || "").trim();
  const cn = (m.name_chinese || "").trim();
  if (en && cn) return `${en}（${cn}）`;
  return en || cn || "—";
}

function pct(shares: unknown, total: number): string {
  if (!total) return "—";
  const n = parseInt(String(shares || 0), 10) || 0;
  // 對齊本地 Python str(round(x,2))：整數百分比顯示 .0（90 -> 90.0）
  let s = String(Math.round((n * 100) / total * 100) / 100);
  if (!s.includes(".")) s += ".0";
  return `${s}%`;
}

interface Bundle {
  c: any;
  address: string;
  directors: any[];
  secretaries: any[];
  shareholders: any[];
  totalShares: number;
}

async function companyBundle(env: Env, companyId: string): Promise<Bundle | null> {
  const company = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first();
  if (!company) return null;
  const { results } = await env.DB.prepare(
    `SELECT pcr.role, pcr.shares, pcr.share_type, pcr.currency, pcr.paid_up,
            pcr.date_appointed, pcr.date_ceased, pcr.is_reserve,
            p.name_english, p.name_chinese, p.id_number, p.passport_number,
            p.address, p.service_address, p.email, p.phone, p.identity, p.tcsp_number
     FROM person_company_roles pcr JOIN persons p ON p.id = pcr.person_id
     WHERE pcr.company_id = ? AND (pcr.date_ceased IS NULL OR pcr.date_ceased = '')
     ORDER BY pcr.role, p.name_english`
  ).bind(companyId).all();
  const members = (results || []) as any[];
  const directors = members.filter((m) => m.role === "director");
  const secretaries = members.filter((m) => m.role === "secretary");
  const shareholders = members.filter((m) => m.role === "shareholder");
  const totalShares = shareholders.reduce((s, m) => s + (parseInt(String(m.shares || 0), 10) || 0), 0);
  const addr = [
    company.reg_flat, company.reg_building, company.reg_street, company.reg_district, company.reg_region,
  ].filter(Boolean).join(", ");
  return { c: company, address: addr, directors, secretaries, shareholders, totalShares };
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function rget(row: any, key: string, dflt: any = null): any {
  const v = row ? row[key] : undefined;
  return v !== null && v !== undefined ? v : dflt;
}

async function fetchScrData(env: Env, companyId: string): Promise<any[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY created_at"
  ).bind(companyId).all();
  return (results || []) as any[];
}

// ─────────────────────────── SCR 登記冊（Paul Tang 格式）───────────────────────────

function buildScrRegister(bundle: Bundle, scrs: any[]): string {
  const c = bundle.c;
  const nameEn = c.name || "";
  const nameCn = c.chinese_name || "";
  const br = c.company_number || "";

  const blocks: string[] = [];

  // ── Page: Landscape A4 (swapped w/h) ──
  // We'll use a separate sectPr at the end

  // ── Header table: Company Name (left) | SCR Title (right) ──
  const titleEn = "SIGNIFICANT CONTROLLERS REGISTER";
  const titleCn = "重要控制人登記冊";

  // Table[0]: 1 row x 2 cols — left=company, right=SCR title
  const coLine1 = nameEn || nameCn || "公司";
  const coLine2 = nameCn && nameEn ? nameCn : "";
  const coCell = coLine2 ? `${coLine1}\n${coLine2}` : coLine1;
  const titleCell = `${titleEn}\n${titleCn}`;

  // DXA widths: total ~9000 for portrait-style table in landscape page
  const headerW1 = 6000;
  const headerW2 = 3000;

  blocks.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="${headerW1}"/><w:gridCol w:w="${headerW2}"/></w:tblGrid>`);

  // Row: company name (left) + SCR title (right)
  blocks.push(`<w:tr>`);
  // Left cell — company name
  blocks.push(`<w:tc><w:tcPr><w:tcW w:w="${headerW1}" w:type="dxa"/></w:tcPr>`);
  blocks.push(`<w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(coLine1)}</w:t></w:r></w:p>`);
  if (coLine2) {
    blocks.push(`<w:p><w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(coLine2)}</w:t></w:r></w:p>`);
  }
  blocks.push(`</w:tc>`);
  // Right cell — SCR title
  blocks.push(`<w:tc><w:tcPr><w:tcW w:w="${headerW2}" w:type="dxa"/></w:tcPr>`);
  blocks.push(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t xml:space="preserve">${esc(titleEn)}</w:t></w:r></w:p>`);
  blocks.push(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${esc(titleCn)}</w:t></w:r></w:p>`);
  blocks.push(`</w:tc>`);
  blocks.push(`</w:tr>`);
  blocks.push(`</w:tbl>`);

  blocks.push(EMPTY_P);

  // ── JURISDICTION line ──
  blocks.push(P(`JURISDICTION:  HONG KONG`, { size: 8, bold: true }));
  blocks.push(P(`司法管轄區:  HONG KONG`, { size: 8 }));

  // ── Company Number line ──
  blocks.push(P(`COMPANY NUMBER:  ${esc(br)}`, { size: 8, bold: true }));
  blocks.push(P(`公司編號:  ${esc(br)}`, { size: 8 }));

  blocks.push(EMPTY_P);

  // ── Separator ──
  blocks.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr></w:p></w:p>`);
  blocks.push(EMPTY_P);

  // ── 7-Column Data Table (matching Paul Tang docx gridCol ratios) ──
  const colRatios = [1526, 2154, 2835, 2551, 2551, 1701, 1814];
  const totalDxa = colRatios.reduce((a, b) => a + b, 0);
  const totalWidth = 14000; // DXA for landscape
  const colW = colRatios.map(r => Math.floor(r * totalWidth / totalDxa));
  colW[3] += 8;
  colW[4] -= 8;

  const hdrLabels = [
    "Entry Date\n登記日期",
    "Name\n姓名／名稱",
    "Correspondence Address (for Registrable Person)\n通訊地址（自然人）\nRegistered Office Address (for Legal Entity)\n註冊／主要營業地址（法律實體）",
    "ID / PPT No. (Issuing Country) (for Registrable Person)\n身份證／護照號碼（簽發國家）（自然人）\nCompany No. (Place of Incorp.) Legal Form (for Legal Entity)\n公司編號（成立地方）法律形式（法律實體）",
    "Nature of Control\n控制性質",
    "Becoming Date (Cessation Date)\n起始日期（終止日期）",
    "Remarks\n備註",
  ];

  // Build table
  blocks.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${TBL_BORDERS}</w:tblPr>`);
  blocks.push(`<w:tblGrid>${colW.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`);

  // Header row
  blocks.push(`<w:tr>`);
  for (let ci = 0; ci < hdrLabels.length; ci++) {
    const label = hdrLabels[ci];
    const lines = label.split('\n');
    blocks.push(`<w:tc><w:tcPr><w:tcW w:w="${colW[ci]}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>`);
    for (const line of lines) {
      blocks.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`);
    }
    blocks.push(`</w:tc>`);
  }
  blocks.push(`</w:tr>`);

  // Data rows
  if (scrs.length === 0) {
    blocks.push(`<w:tr>`);
    const emptyW = colW.reduce((a, b) => a + b, 0);
    blocks.push(`<w:tc><w:tcPr><w:gridSpan w:val="7"/><w:tcW w:w="${emptyW}" w:type="dxa"/></w:tcPr>`);
    blocks.push(`<w:p><w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">(No SCR records / 尚無重要控制人記錄)</w:t></w:r></w:p>`);
    blocks.push(`</w:tc></w:tr>`);
  } else {
    for (const s of scrs) {
      // Build nature of control
      const natures: string[] = [];
      if (rget(s, 'nature_shares')) natures.push('>25% shares');
      if (rget(s, 'nature_voting')) natures.push('>25% voting');
      if (rget(s, 'nature_appoint')) natures.push('Appoint/remove directors');
      if (rget(s, 'nature_influence')) natures.push('Sig. influence');
      if (rget(s, 'nature_trust')) natures.push('Trust control');
      if (rget(s, 'nature_other')) natures.push(rget(s, 'nature_other'));

      const isNat = rget(s, 'identity') !== 'corporate';
      const sNameEn = rget(s, 'name_english') || '';
      const sNameCh = rget(s, 'name_chinese') || '';
      const nameDisplay = sNameCh ? `${sNameCh}  ${sNameEn}`.trim() : (sNameEn || '(unnamed)');

      let idBlock: string;
      if (isNat) {
        const idNo = rget(s, 'id_number') || rget(s, 'passport_number') || '-';
        const passportCountry = rget(s, 'passport_country') || '';
        idBlock = `ID/PPT: ${idNo}`;
        if (passportCountry) idBlock += ` (${passportCountry})`;
        idBlock += " | Natural Person";
      } else {
        const compNo = rget(s, 'company_number_ref') || '-';
        const placeIncorp = rget(s, 'place_of_incorporation') || '';
        const legalForm = rget(s, 'legal_form') || '';
        idBlock = `Co No: ${compNo}`;
        if (placeIncorp) idBlock += ` (${placeIncorp})`;
        if (legalForm) idBlock += ` | ${legalForm}`;
        idBlock += " | Body Corporate";
      }

      const addr = (rget(s, 'address') || '').slice(0, 200);
      const natureText = natures.join(', ') || '-';
      const dateBecame = rget(s, 'date_became') || '-';
      const dateCea = rget(s, 'date_ceased') || '';
      const dateDisplay = dateCea ? `${dateBecame}  /  ${dateCea}` : `${dateBecame}  /`;

      let entryDate = rget(s, 'created_at') || '';
      if (entryDate && entryDate.length > 10) entryDate = entryDate.slice(0, 10);

      const remarksParts: string[] = [];
      if (!dateCea) remarksParts.push("Current / 現任");
      if (rget(s, 'is_designated_rep') && rget(s, 'designated_rep_name')) {
        remarksParts.push(`Rep: ${rget(s, 'designated_rep_name')}`);
      }
      const userRemarks = rget(s, 'remarks') || '';
      if (userRemarks) remarksParts.push(userRemarks);
      const remarks = remarksParts.join('\n');

      const rowData = [entryDate, nameDisplay, addr, idBlock, natureText, dateDisplay, remarks];

      blocks.push(`<w:tr>`);
      for (let ci = 0; ci < rowData.length; ci++) {
        const txt = rowData[ci];
        blocks.push(`<w:tc><w:tcPr><w:tcW w:w="${colW[ci]}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>`);
        const textLines = String(txt || '').split('\n');
        for (const line of textLines) {
          const jc = ci === 6 ? '<w:jc w:val="center"/>' : ''; // Remarks centered
          blocks.push(`<w:p><w:pPr>${jc}</w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`);
        }
        blocks.push(`</w:tc>`);
      }
      blocks.push(`</w:tr>`);
    }
  }

  blocks.push(`</w:tbl>`);
  blocks.push(EMPTY_P);

  // ── Additional Matters 2×2 table ──
  const addW = Math.floor(totalWidth / 2);
  blocks.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${TBL_BORDERS}</w:tblPr><w:tblGrid><w:gridCol w:w="${addW}"/><w:gridCol w:w="${addW}"/></w:tblGrid>`);

  // Header row
  blocks.push(`<w:tr>`);
  blocks.push(`<w:tc><w:tcPr><w:tcW w:w="${addW}" w:type="dxa"/></w:tcPr>`);
  blocks.push(`<w:p><w:r><w:rPr><w:b/><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve">Additional Matters</w:t></w:r></w:p>`);
  blocks.push(`<w:p><w:r><w:rPr><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve">额外事項</w:t></w:r></w:p>`);
  blocks.push(`</w:tc>`);
  blocks.push(`<w:tc><w:tcPr><w:tcW w:w="${addW}" w:type="dxa"/></w:tcPr>`);
  blocks.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve">Remarks</w:t></w:r></w:p>`);
  blocks.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve">備註</w:t></w:r></w:p>`);
  blocks.push(`</w:tc>`);
  blocks.push(`</w:tr>`);

  // Empty content row
  blocks.push(`<w:tr>`);
  blocks.push(`<w:tc><w:tcPr><w:tcW w:w="${addW}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`);
  blocks.push(`<w:tc><w:tcPr><w:tcW w:w="${addW}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`);
  blocks.push(`</w:tr>`);
  blocks.push(`</w:tbl>`);

  // 頁腳
  blocks.push(EMPTY_P);
  blocks.push(P(`本文件由公司秘書管理系統自動生成 · ${nowStamp()}`, { size: 8, center: true }));

  // Landscape A4 sectPr
  const landscapeSectPr =
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<w:body>" + blocks.join("") + landscapeSectPr + "</w:body></w:document>"
  );
}

function buildBody(bundle: Bundle, docType: string, extra: { content?: string; meeting_date?: string; location?: string; form_code?: string }): string | null {
  const c = bundle.c;
  const nameEn = c.name || "";
  const nameCn = c.chinese_name || "";
  const br = c.company_number || "";
  const cr = c.ci_number || "";
  const blocks: string[] = [];

  const companyHeader = () => {
    blocks.push(H(nameEn || nameCn || "公司", { size: 18 }));
    if (nameCn && nameEn) blocks.push(H(nameCn, { size: 14, bold: false }));
    const sub: string[] = [];
    if (br) sub.push(`商業登記號碼 (BR)：${br}`);
    if (cr) sub.push(`公司註冊編號 (CR)：${cr}`);
    if (sub.length) blocks.push(P(sub.join("　｜　"), { size: 10, center: true }));
    blocks.push(EMPTY_P);
  };

  if (docType === "company_profile") {
    companyHeader();
    blocks.push(H("公司資料摘要", { size: 15 }));
    blocks.push(
      kvTable([
        ["英文名稱", nameEn],
        ["中文名稱", nameCn],
        ["商業登記號碼 (BR)", br],
        ["公司註冊編號 (CR)", cr],
        ["公司類型", c.company_type],
        ["成立日期", fmtDate(c.incorporation_date)],
        ["狀態", c.status],
        ["註冊辦事處地址", bundle.address],
        ["電郵", c.email],
        ["電話", c.phone],
      ])
    );
    blocks.push(EMPTY_P);
    blocks.push(H(`董事（${bundle.directors.length}）`, { size: 13, center: false }));
    blocks.push(
      membersTable(
        ["姓名", "身份證／護照", "委任日期", "地址"],
        bundle.directors.length
          ? bundle.directors.map((m) => [personLabel(m), m.id_number || m.passport_number, fmtDate(m.date_appointed), m.address])
          : [["（無）", "", "", ""]]
      )
    );
    blocks.push(EMPTY_P);
    blocks.push(H(`公司秘書（${bundle.secretaries.length}）`, { size: 13, center: false }));
    blocks.push(
      membersTable(
        ["姓名", "TCSP 號碼", "委任日期", "地址"],
        bundle.secretaries.length
          ? bundle.secretaries.map((m) => [personLabel(m), m.tcsp_number, fmtDate(m.date_appointed), m.address])
          : [["（無）", "", "", ""]]
      )
    );
    blocks.push(EMPTY_P);
    const ts = bundle.totalShares;
    blocks.push(H(`股東 / 股本結構（總發行股數：${ts}）`, { size: 13, center: false }));
    blocks.push(
      membersTable(
        ["股東", "持股", "股份類別", "佔比"],
        bundle.shareholders.length
          ? bundle.shareholders.map((m) => [personLabel(m), m.shares, m.share_type || "普通股", pct(m.shares, ts)])
          : [["（無）", "", "", ""]]
      )
    );
  } else if (docType === "directors_register") {
    companyHeader();
    blocks.push(H("董事名冊 / Register of Directors", { size: 15 }));
    blocks.push(P("依據《公司條例》(第622章) 第 641 條備存。", { size: 10 }));
    blocks.push(EMPTY_P);
    blocks.push(
      membersTable(
        ["姓名", "身份證／護照", "委任日期", "住址", "電郵"],
        bundle.directors.length
          ? bundle.directors.map((m) => [personLabel(m), m.id_number || m.passport_number, fmtDate(m.date_appointed), m.address, m.email])
          : [["（無董事記錄）", "", "", "", ""]]
      )
    );
  } else if (docType === "members_register") {
    companyHeader();
    blocks.push(H("成員（股東）名冊 / Register of Members", { size: 15 }));
    blocks.push(P("依據《公司條例》(第622章) 第 627 條備存。", { size: 10 }));
    blocks.push(EMPTY_P);
    const ts = bundle.totalShares;
    blocks.push(
      membersTable(
        ["股東", "持股數", "股份類別", "已繳股款", "佔比"],
        bundle.shareholders.length
          ? bundle.shareholders.map((m) => [personLabel(m), m.shares, m.share_type || "普通股", m.paid_up, pct(m.shares, ts)])
          : [["（無股東記錄）", "", "", "", ""]]
      )
    );
    blocks.push(EMPTY_P);
    blocks.push(P(`總發行股數：${ts}`, { bold: true }));
  } else if (docType === "board_resolution" || docType === "meeting_minutes") {
    const isMin = docType === "meeting_minutes";
    companyHeader();
    const mDate = extra.meeting_date || "";
    const location = extra.location || "公司註冊辦事處";
    if (isMin) {
      blocks.push(H("董事會會議記錄", { size: 15 }));
      blocks.push(H("MINUTES OF MEETING OF THE BOARD OF DIRECTORS", { size: 11, bold: false }));
      blocks.push(EMPTY_P);
      blocks.push(
        kvTable([
          ["會議日期 Date", mDate],
          ["會議地點 Venue", location],
          ["出席董事 Present", bundle.directors.map(personLabel).join("；") || "—"],
          ["主席 Chairman", bundle.directors.length ? personLabel(bundle.directors[0]) : "—"],
        ])
      );
    } else {
      blocks.push(H("董事會書面決議", { size: 15 }));
      blocks.push(H("WRITTEN RESOLUTION OF THE DIRECTORS", { size: 11, bold: false }));
      blocks.push(EMPTY_P);
      blocks.push(
        kvTable([
          ["決議日期 Date", mDate],
          ["簽署董事 Directors", bundle.directors.map(personLabel).join("；") || "—"],
        ])
      );
    }
    blocks.push(EMPTY_P);
    blocks.push(P("議決事項 / RESOLVED THAT:", { bold: true, size: 12 }));
    const content = (extra.content || "").trim();
    if (content) {
      for (const line of content.split("\n")) blocks.push(P(line, { size: 11 }));
    } else {
      blocks.push(P("1. ＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿", { size: 11 }));
      blocks.push(P("2. ＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿", { size: 11 }));
    }
    blocks.push(EMPTY_P);
    blocks.push(EMPTY_P);
    blocks.push(P("簽署 / SIGNED:", { bold: true }));
    const signers = bundle.directors.length ? bundle.directors : [{ name_english: "＿＿＿＿＿＿" }];
    for (const m of signers) {
      blocks.push(EMPTY_P);
      blocks.push(P("_______________________________", { size: 11 }));
      blocks.push(P(`${personLabel(m)}　董事 / Director`, { size: 10 }));
    }
  } else if (docType === "cr_form") {
    const formCode = (extra.form_code || "").toLowerCase();
    const meta = CR_FORM_META[formCode];
    if (!meta) return null;

    companyHeader();
    blocks.push(H(`${meta.title} ${meta.code}`, { size: 15 }));
    blocks.push(H(meta.title_en, { size: 11, bold: false }));
    blocks.push(P(`公司註冊處表格 ${meta.code} — 由系統自動填入公司資料生成草稿`, { size: 9 }));
    blocks.push(EMPTY_P);

    // Shared company info
    blocks.push(
      kvTable([
        ["公司英文名稱", nameEn],
        ["公司中文名稱", nameCn],
        ["商業登記號碼 (BR)", br],
        ["公司註冊編號 (CR)", cr],
        ["公司類型", c.company_type],
        ["註冊辦事處地址", bundle.address],
        ["電郵", c.email],
        ["電話", c.phone],
        ["成立日期", fmtDate(c.incorporation_date)],
        ["公司狀態", c.status],
      ])
    );
    blocks.push(EMPTY_P);

    // Directors / Secretaries (for most forms)
    const hasOfficers = ["nar1","nd2a","nd2b","nd4","nnc1","nn1","nn3","nn6","nn7"].includes(formCode);
    if (hasOfficers) {
      blocks.push(H(`董事（${bundle.directors.length}）`, { size: 13, center: false }));
      blocks.push(
        membersTable(
          ["姓名", "身份", "身份證／護照／公司編號", "委任日期", "辭任日期", "地址", "電郵"],
          bundle.directors.length
            ? bundle.directors.map((m) => [
                personLabel(m),
                m.identity === "corporate" ? "法人" : "自然人",
                m.id_number || m.passport_number || m.tcsp_number || "",
                fmtDate(m.date_appointed),
                fmtDate(m.date_ceased),
                m.address || "",
                m.email || "",
              ])
            : [["（無）", "", "", "", "", "", ""]]
        )
      );
      blocks.push(EMPTY_P);
      blocks.push(H(`公司秘書（${bundle.secretaries.length}）`, { size: 13, center: false }));
      blocks.push(
        membersTable(
          ["姓名", "身份", "TCSP／公司編號", "委任日期", "地址", "電郵"],
          bundle.secretaries.length
            ? bundle.secretaries.map((m) => [
                personLabel(m),
                m.identity === "corporate" ? "法人" : "自然人",
                m.tcsp_number || "",
                fmtDate(m.date_appointed),
                m.address || "",
                m.email || "",
              ])
            : [["（無）", "", "", "", "", ""]]
        )
      );
      blocks.push(EMPTY_P);
    }

    // Shareholders (for forms that need it)
    const hasShares = ["nar1","nsc1","nnc1","nn1","nn3"].includes(formCode);
    if (hasShares) {
      const ts = bundle.totalShares;
      blocks.push(H(`股東／股本結構（總發行股數：${ts}）`, { size: 13, center: false }));
      blocks.push(
        membersTable(
          ["股東", "持股數", "股份類別", "已繳股款", "佔比"],
          bundle.shareholders.length
            ? bundle.shareholders.map((m) => [
                personLabel(m),
                m.shares || "0",
                m.share_type || "普通股",
                m.paid_up || "",
                pct(m.shares, ts),
              ])
            : [["（無）", "", "", "", ""]]
        )
      );
      blocks.push(EMPTY_P);
    }

    // NAR1 extras
    if (formCode === "nar1") {
      blocks.push(P("重要控制人登記冊 (SCR) 是否備存於公司註冊辦事處？　是 □　否 □", { size: 11 }));
      blocks.push(P("截至申報日期之董事／秘書／股東資料以上表為準。", { size: 10 }));
      blocks.push(EMPTY_P);
    }

    // Address change forms
    if (["nr1","ndr1","nn9"].includes(formCode)) {
      blocks.push(P("現有註冊地址：", { bold: true, size: 11 }));
      blocks.push(P(bundle.address || "（未填）", { size: 11 }));
      blocks.push(P("變更後註冊地址（請手動填寫）：", { bold: true, size: 11 }));
      blocks.push(P("＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿", { size: 11 }));
      blocks.push(EMPTY_P);
    }

    // NSC1 extras
    if (formCode === "nsc1") {
      blocks.push(P("配發日期：＿＿＿＿＿＿＿＿", { size: 11 }));
      blocks.push(P("配發股份類別：＿＿＿＿＿＿＿＿", { size: 11 }));
      blocks.push(P("每股發行價：＿＿＿＿＿＿＿＿", { size: 11 }));
      blocks.push(P("配發總額：＿＿＿＿＿＿＿＿", { size: 11 }));
      blocks.push(EMPTY_P);
    }

    // Signature block
    blocks.push(EMPTY_P);
    blocks.push(P("簽署 / SIGNED:", { bold: true, size: 11 }));
    blocks.push(EMPTY_P);
    blocks.push(P("_______________________________", { size: 11 }));
    blocks.push(P("董事 / Director　　日期 Date：＿＿＿＿＿＿＿＿", { size: 10 }));
    blocks.push(EMPTY_P);
    blocks.push(P("_______________________________", { size: 11 }));
    blocks.push(P("公司秘書 / Company Secretary　　日期 Date：＿＿＿＿＿＿＿＿", { size: 10 }));

  } else {
    return null;
  }

  // 頁腳說明
  blocks.push(EMPTY_P);
  blocks.push(P(`本文件由公司秘書管理系統自動生成 · ${nowStamp()}`, { size: 8, center: true }));

  const sectPr =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<w:body>" + blocks.join("") + sectPr + "</w:body></w:document>"
  );
}

// docx 包內固定部件
const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  "</Types>";

const RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

const DOC_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  "</Relationships>";

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  "<w:docDefaults><w:rPrDefault><w:rPr>" +
  `<w:rFonts w:ascii="${CJK_FONT}" w:hAnsi="${CJK_FONT}" w:eastAsia="${CJK_FONT}" w:cs="${CJK_FONT}"/>` +
  '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr>' +
  `<w:rFonts w:ascii="${CJK_FONT}" w:hAnsi="${CJK_FONT}" w:eastAsia="${CJK_FONT}" w:cs="${CJK_FONT}"/>` +
  "</w:rPr></w:style></w:styles>";

function safeName(name: string): string {
  return (name || "company").replace(/[^\w一-鿿]/g, "_").slice(0, 40);
}

// ─────────────────────────── Handler ───────────────────────────

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = (await request.json().catch(() => ({}))) as {
      company_id?: string;
      doc_type?: string;
      content?: string;
      meeting_date?: string;
      location?: string;
      form_code?: string;
    };
    const companyId = data.company_id;
    const docType = data.doc_type || "";
    if (!companyId) return json({ error: "缺少 company_id" }, 400);
    if (!(docType in DOCX_TYPES)) {
      return json({ error: `不支援的文件類型：${docType}`, supported: Object.keys(DOCX_TYPES) }, 400);
    }

    // cr_form requires form_code
    if (docType === "cr_form") {
      const formCode = (data.form_code || "").toLowerCase();
      if (!formCode || !(formCode in CR_FORM_META)) {
        return json({ error: `不支援的表格編號：${formCode}`, supported: Object.keys(CR_FORM_META) }, 400);
      }
    }

    // SCR register needs separate data fetch
    if (docType === "scr_register") {
      const bundle = await companyBundle(env, companyId);
      if (!bundle) return json({ error: "找不到該公司" }, 404);
      const scrs = await fetchScrData(env, companyId);
      const documentXml = buildScrRegister(bundle, scrs);

      const enc = new TextEncoder();
      const zipBytes = buildZip([
        { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES_XML) },
        { name: "_rels/.rels", data: enc.encode(RELS_XML) },
        { name: "word/_rels/document.xml.rels", data: enc.encode(DOC_RELS_XML) },
        { name: "word/styles.xml", data: enc.encode(STYLES_XML) },
        { name: "word/document.xml", data: enc.encode(documentXml) },
      ]);

      const label = DOCX_TYPES[docType];
      const nm = safeName(bundle.c.name || bundle.c.chinese_name || "company");
      const filename = `${nm}_${label}.docx`;

      return json({
        success: true,
        docx: uint8ToBase64(zipBytes),
        filename,
        doc_type: docType,
      });
    }

    const bundle = await companyBundle(env, companyId);
    if (!bundle) return json({ error: "找不到該公司" }, 404);

    const documentXml = buildBody(bundle, docType, {
      content: data.content,
      meeting_date: data.meeting_date,
      location: data.location,
      form_code: data.form_code,
    });
    if (documentXml == null) return json({ error: "找不到該公司" }, 404);

    const enc = new TextEncoder();
    const zipBytes = buildZip([
      { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES_XML) },
      { name: "_rels/.rels", data: enc.encode(RELS_XML) },
      { name: "word/_rels/document.xml.rels", data: enc.encode(DOC_RELS_XML) },
      { name: "word/styles.xml", data: enc.encode(STYLES_XML) },
      { name: "word/document.xml", data: enc.encode(documentXml) },
    ]);

    const label = DOCX_TYPES[docType];
    const nm = safeName(bundle.c.name || bundle.c.chinese_name || "company");
    const filename = `${nm}_${label}.docx`;

    return json({
      success: true,
      docx: uint8ToBase64(zipBytes),
      filename,
      doc_type: docType,
    });
  } catch (e: any) {
    console.error("generate-docx error:", e);
    return json({ error: e.message || "Internal server error" }, 500);
  }
}
