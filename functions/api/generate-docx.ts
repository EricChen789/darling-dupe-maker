// POST /api/generate-docx
// 生成 Word (.docx) 文件 — 零依賴手寫 ZIP(store+CRC32) + OOXML 生成器
// 移植自 local-server/server.py:_build_docx（Cloudflare Workers 跑不了 python-docx，故手寫）
// body: { company_id, doc_type, content?, meeting_date?, location? }
// resp: { success: true, docx: '<base64>', filename, doc_type }
// 5 種 doc_type: company_profile / directors_register / members_register / board_resolution / meeting_minutes

interface Env {
  DB: D1Database;
}

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
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
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

// ─────────────────────────── 文件正文組裝 ───────────────────────────

function buildBody(bundle: Bundle, docType: string, extra: { content?: string; meeting_date?: string; location?: string }): string | null {
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

  try {
    const data = (await request.json().catch(() => ({}))) as {
      company_id?: string;
      doc_type?: string;
      content?: string;
      meeting_date?: string;
      location?: string;
    };
    const companyId = data.company_id;
    const docType = data.doc_type || "";
    if (!companyId) return json({ error: "缺少 company_id" }, 400);
    if (!(docType in DOCX_TYPES)) {
      return json({ error: `不支援的文件類型：${docType}`, supported: Object.keys(DOCX_TYPES) }, 400);
    }

    const bundle = await companyBundle(env, companyId);
    if (!bundle) return json({ error: "找不到該公司" }, 404);

    const documentXml = buildBody(bundle, docType, {
      content: data.content,
      meeting_date: data.meeting_date,
      location: data.location,
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
