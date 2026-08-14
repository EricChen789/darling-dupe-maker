import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import { corsHeaders } from './_pdf-utils';
import _tpl from './_template_rod_bvi_xlsx';

type Env = AuthEnv & {
  DB: D1Database;
};

// ══════════════════════════════════════════════════════════════════
// BVI 董事登記冊 (Register of Directors) — Excel (.xlsx) 输出
// 基于 Paul Tang 官方模板 Register Of Director.xlsx（2 sheets:
//   "individual Director" + "Corporate Director"）
// 策略：全部公式直接替换为计算值（sheet2 D1/D2 跨表镜像 + K 列 BVI 判定），
//       删 calcChain；董事槽（4 行/位）按需克隆，页脚整体移位。
// ══════════════════════════════════════════════════════════════════

// ── XML escape for inline strings（换行 → &#10;，wrapText 单元格正常显示多行）──
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/\r\n|\r|\n/g, "&#10;");
}

// ── 提取某行 <row r="N">…（兼容自闭合空行 <row …/> 与带子元素行）──
// 注意：自闭合行必须用懒匹配 + 首个分支 `/>`，否则会吞掉后续行直到下一个 </row>
function extractRow(xml: string, r: number): string {
  const m = xml.match(new RegExp(`<row r="${r}"[^>]*?/>|<row r="${r}"[^>]*>.*?</row>`, "s"));
  if (!m) throw new Error(`template row ${r} not found`);
  return m[0];
}

// ── 行重编号：row 标签 r 属性 + 所有单元格 r="X列N行"（A6→A11 等）──
// 顺带剥掉 sheet2 K 列残留公式（<f…></f> 单元格 → 空样式格）
function renumberRow(rowXml: string, newR: number): string {
  let s = rowXml.replace(/(<row r=")\d+(")/, `$1${newR}$2`);
  s = s.replace(/\br="([A-Z]+)\d+"/g, (_m, col: string) => `r="${col}${newR}"`);
  s = s.replace(/<c r="K(\d+)"([^>]*)>.*?<\/c>/gs, (m0, _num: string, attrs: string) => {
    if (!m0.includes("<f")) return m0; // 非公式格不动
    const sm = attrs.match(/s="(\d+)"/);
    return `<c r="K${_num}"${sm ? ` s="${sm[1]}"` : ""}/>`;
  });
  return s;
}

// ── 填空自闭合格 <c r="X6" s="N"/> → inlineStr 值格（保留样式）──
function fillEmptyCell(rowXml: string, col: string, rowNum: number, value: string): string {
  if (!value) return rowXml;
  const filled = `<c r="${col}${rowNum}"$1 t="inlineStr"><is><t xml:space="preserve">${escXml(value)}</t></is></c>`;
  return rowXml.replace(new RegExp(`<c r="${col}${rowNum}"([^>]*)/>`), filled);
}

// ── 替换公式格（D1/D2、K6 这类 <c …><f>…</f><v/></c>）──
function fillFormulaCell(rowXml: string, col: string, rowNum: number, value: string): string {
  const re = new RegExp(`<c r="${col}${rowNum}"([^>]*)>.*?</c>`, "s");
  return rowXml.replace(re, (_m0, attrs: string) => {
    const sm = attrs.match(/s="(\d+)"/);
    const style = sm ? ` s="${sm[1]}"` : "";
    if (!value) return `<c r="${col}${rowNum}"${style}/>`;
    return `<c r="${col}${rowNum}"${style} t="inlineStr"><is><t xml:space="preserve">${escXml(value)}</t></is></c>`;
  });
}

// ── 槽首行填数据 ──
function fillCells(rowXml: string, rowNum: number, vals: Record<string, string>, formulaCols: string[]): string {
  let out = rowXml;
  for (const [col, val] of Object.entries(vals)) {
    out = formulaCols.includes(col) ? fillFormulaCell(out, col, rowNum, val) : fillEmptyCell(out, col, rowNum, val);
  }
  return out;
}

// ── 重建 mergeCells ──
function buildMerges(
  header: string[], slotFn: (r: number) => string[], footFn: (d: number) => string[],
  n: number, footerStart: number,
): string {
  const parts = [...header];
  for (let i = 0; i < n; i++) {
    const r0 = 6 + 5 * i;
    for (let k = 0; k < 4; k++) parts.push(...slotFn(r0 + k));
    if (i < n - 1) parts.push(...slotFn(r0 + 4)); // 分隔行同槽行合并
  }
  const d = footerStart - 20;
  parts.push(...footFn(d));
  return `<mergeCells count="${parts.length}">${parts.map((r) => `<mergeCell ref="${r}"/>`).join("")}</mergeCells>`;
}

// ── 重组工作表：head(rows1-5) + 克隆槽 + 移位页脚 + tail(mergeCells/pageSetup…) ──
// fillSlot: 用第 i 位董事数据填【模板槽首行 row 6】（先填后重编号，A6→A{6+5i}）
function buildSheetXml(
  xml: string, n: number,
  fillSlot: (slotRow6Xml: string, directorIndex: number) => string,
  headerMerges: string[], slotMerges: (r: number) => string[], footMerges: (d: number) => string[],
  dimCol: string,
): string {
  const head = xml.slice(0, xml.indexOf('<row r="6"'));
  const slotRows = [extractRow(xml, 6), extractRow(xml, 7), extractRow(xml, 8), extractRow(xml, 9)];
  const sepRow = extractRow(xml, 10);
  const footRows = [extractRow(xml, 20), extractRow(xml, 21), extractRow(xml, 22), extractRow(xml, 23), extractRow(xml, 24)];
  const r24 = extractRow(xml, 24);
  const tail = xml.slice(xml.indexOf(r24) + r24.length);

  const footerStart = n === 0 ? 6 : 10 + 5 * (n - 1);
  const lastRow = footerStart + 4;

  let out = head;
  for (let i = 0; i < n; i++) {
    const r0 = 6 + 5 * i;
    out += renumberRow(fillSlot(slotRows[0], i), r0);
    out += renumberRow(slotRows[1], r0 + 1);
    out += renumberRow(slotRows[2], r0 + 2);
    out += renumberRow(slotRows[3], r0 + 3);
    if (i < n - 1) out += renumberRow(sepRow, r0 + 4);
  }
  const d = footerStart - 20;
  for (let j = 0; j < 5; j++) out += renumberRow(footRows[j], 20 + d + j);
  out += tail;

  out = out.replace(/<dimension ref="A1:[A-Z]+\d+"\/>/, `<dimension ref="A1:${dimCol}${lastRow}"/>`);
  out = out.replace(/<mergeCells count="\d+">.*?<\/mergeCells>/s, buildMerges(headerMerges, slotMerges, footMerges, n, footerStart));
  return out;
}

// ── 日期 → DD/MM/YYYY（兼容 YYYY-MM-DD、DD/MM/YYYY、DDMMYYYY；空 → ""）──
function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  const t = String(s).trim();
  if (!t) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const m2 = t.match(/^(\d{2})(\d{2})(\d{4})$/); // 生产数据常见 DDMMYYYY 无分隔符
  if (m2) return `${m2[1]}/${m2[2]}/${m2[3]}`;
  return t;
}

// ── ZIP builder（同 generate-rod-docx.ts）──
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
  // Buffer latin1 转换是原生 C++ 路径，比 JS 循环快 20-30ms CPU（大文件 503 关键）
  if (typeof Buffer !== "undefined") return btoa(Buffer.from(bytes).toString("latin1"));
  let binary = "";
  const chunk = 0x1000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const body = await request.json() as any;
    const { companyId } = body; // format 参数保留兼容（文件本身含两个 sheet）
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [company, rolesResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM person_company_roles WHERE company_id = ? AND role = 'director'").bind(companyId).all(),
    ]);

    if (!company) throw new Error("Company not found");

    const roles = (rolesResult.results || []) as any[];
    const personIds = roles.map((r: any) => r.person_id).filter(Boolean);
    let personsResult: any[] = [];
    if (personIds.length > 0) {
      const placeholders = personIds.map(() => '?').join(',');
      const result = await env.DB.prepare(`SELECT * FROM persons WHERE id IN (${placeholders})`)
        .bind(...personIds).all();
      personsResult = (result.results || []) as any[];
    }
    const personMap = new Map<string, any>();
    personsResult.forEach((p: any) => personMap.set(p.id, p));

    // 按 identity 分流：自然人 → sheet1，法人 → sheet2
    const natural = roles.filter((r: any) => {
      const p = personMap.get(r.person_id);
      return !p || (p.identity || "natural") === "natural";
    });
    const corporate = roles.filter((r: any) => {
      const p = personMap.get(r.person_id);
      return !!p && p.identity === "corporate";
    });

    const coName = (company as any).name || "";
    const coNumber = (company as any).company_number || "";

    // ── sheet1: individual Director ──
    let s1 = atob(_tpl["xl/worksheets/sheet1.xml"]);
    s1 = fillEmptyCell(s1, "D", 1, coName);
    s1 = fillEmptyCell(s1, "D", 2, coNumber);
    s1 = buildSheetXml(
      s1, natural.length,
      (slot6: string, i: number) => {
        const r = natural[i];
        const p = personMap.get(r.person_id) || {};
        const dob = fmtDate(p.date_of_birth);
        const dobPlace = [dob, p.place_of_birth || ""].filter(Boolean).join(" ");
        const natId = [p.nationality || "", p.id_number || p.passport_number || ""].filter(Boolean).join("\n");
        return fillCells(slot6, 6, {
          A: fmtDate(r.date_appointed),
          B: p.name_english || p.name_chinese || "",
          E: p.previous_name || p.alias || "",
          G: dobPlace,
          H: natId,
          I: p.address || "",
          J: p.occupation || "",
          K: r.date_ceased ? fmtDate(r.date_ceased) : "Current",
          L: "",
        }, []);
      },
      ["J3:L3", "D1:F1", "D2:F2", "G2:I2", "B5:D5", "E5:F5"],
      (r) => [`B${r}:D${r}`, `E${r}:F${r}`],
      (d) => [`D${22 + d}:K${22 + d}`, `D${23 + d}:K${23 + d}`],
      "P",
    );

    // ── sheet2: Corporate Director ──
    let s2 = atob(_tpl["xl/worksheets/sheet2.xml"]);
    s2 = fillFormulaCell(s2, "D", 1, coName);
    s2 = fillFormulaCell(s2, "D", 2, coNumber);
    s2 = buildSheetXml(
      s2, corporate.length,
      (slot6: string, i: number) => {
        const r = corporate[i];
        const p = personMap.get(r.person_id) || {};
        const corpNo = p.company_number_ref || "";
        const regOffice = p.registered_office || p.address || "";
        const place = p.place_incorporated || "";
        const placeLower = place.toLowerCase();
        const isBVI = placeLower.includes("bvi") || placeLower.includes("british virgin");
        // K 列 BVI 公式换成计算值：IF(ISBLANK(E6),"",IF(OR(H6=BVI…),E6,I6))
        const bviVal = !corpNo ? "" : isBVI ? corpNo : regOffice;
        return fillCells(slot6, 6, {
          A: fmtDate(r.date_appointed),
          B: p.name_english || p.name_chinese || "",
          E: corpNo,
          F: fmtDate(p.date_of_incorporation),
          H: place,
          I: regOffice,
          K: bviVal,
          L: r.date_ceased ? fmtDate(r.date_ceased) : "Current",
          M: "",
        }, ["K"]);
      },
      ["K3:M3", "G2:I2", "D1:F1", "D2:F2", "F5:G5", "A4:C4", "B5:D5", "I5:J5"],
      (r) => [`B${r}:D${r}`, `F${r}:G${r}`, `I${r}:J${r}`],
      (d) => [`D${22 + d}:L${22 + d}`, `D${23 + d}:L${23 + d}`, `L${24 + d}:M${24 + d}`],
      "O",
    );

    // 自检：不能残留任何公式（否则删 calcChain 会导致 Excel 重算/修复提示）
    if (/<f[ >]/.test(s1) || /<f[ >]/.test(s2)) throw new Error("公式残留自检失败");

    // ── workbook.xml：Print_Area 末行更新 ──
    let wb = atob(_tpl["xl/workbook.xml"]);
    const last1 = natural.length === 0 ? 10 : 5 * natural.length + 9;
    const last2 = corporate.length === 0 ? 10 : 5 * corporate.length + 9;
    wb = wb.replace(/'individual Director'!\$A\$1:\$L\$24/, `'individual Director'!$A$1:$L$${last1}`);
    wb = wb.replace(/'Corporate Director'!\$A\$1:\$M\$24/, `'Corporate Director'!$A$1:$M$${last2}`);

    // ── Content_Types / rels：删 calcChain ──
    let ct = atob(_tpl["[Content_Types].xml"]).replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");
    let rels = atob(_tpl["xl/_rels/workbook.xml.rels"]).replace(/<Relationship[^>]*calcChain[^>]*\/>/, "");

    const enc = new TextEncoder();
    const files: { name: string; data: Uint8Array }[] = [];
    for (const [name, b64] of Object.entries(_tpl)) {
      if (name === "xl/calcChain.xml") continue; // 公式全换值 → 丢弃
      let data: Uint8Array;
      if (name === "xl/worksheets/sheet1.xml") data = enc.encode(s1);
      else if (name === "xl/worksheets/sheet2.xml") data = enc.encode(s2);
      else if (name === "xl/workbook.xml") data = enc.encode(wb);
      else if (name === "[Content_Types].xml") data = enc.encode(ct);
      else if (name === "xl/_rels/workbook.xml.rels") data = enc.encode(rels);
      else data = b64ToBytes(b64);
      files.push({ name, data });
    }

    const xlsx = uint8ToBase64(buildZip(files));
    const filename = `DirectorsRegisterBVI_${coNumber || ""}_${coName}.xlsx`;

    return new Response(JSON.stringify({ success: true, xlsx, filename }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-directors-register-bvi-xlsx error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
