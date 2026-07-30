// _pdf-utils.ts — Shared PDF utilities for Cloudflare Functions
// Import from individual function files to avoid duplicating these helpers.
// Usage: import { segmentText, drawMixed, ... } from "./_pdf-utils";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

// ═══ Default Presenter (Twinsail Consultants Limited) ═══
// Used as fallback when presentorName is not provided in request
export const DEFAULT_PRESENTER = {
  name: 'Twinsail Consultants Limited',
  address: 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong',
  contact: 'Tel: +852 2521 3888  Fax: +852 2521 3999  Email: info@twinsail.com',
  phone: '+852 2521 3888',
  fax: '+852 2521 3999',
  email: 'info@twinsail.com',
  reference: 'TS-2026-001',
};

// ═══ CORS ═══
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ═══ JSON Response ═══
export function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ═══ Base64 ═══
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ═══ Record helper ═══
export function rget(row: any, key: string, dflt: any = ""): any {
  if (!row) return dflt;
  const v = row[key];
  return v !== null && v !== undefined ? v : dflt;
}

// ═══ CJK / ASCII detection ═══
export function isAsciiChar(ch: string): boolean {
  return ch.charCodeAt(0) <= 0x7F;
}

export function hasCjk(text: string): boolean {
  for (const ch of text || "") {
    const c = ch.charCodeAt(0);
    if (
      (c >= 0x4E00 && c <= 0x9FFF) || // CJK Unified Ideographs
      (c >= 0x3000 && c <= 0x303F) || // CJK Symbols/Punctuation
      (c >= 0xFF00 && c <= 0xFFEF) || // Halfwidth/Fullwidth Forms
      (c >= 0x2E80 && c <= 0x2FDF) || // CJK Radicals
      (c >= 0x3400 && c <= 0x4DBF)    // CJK Extension A
    )
      return true;
  }
  return false;
}

// ═══ Text Segmentation ═══
export function segmentText(text: string): { text: string; useCjk: boolean }[] {
  const segments: { text: string; useCjk: boolean }[] = [];
  if (!text) return segments;
  let cur = "", curAscii: boolean | null = null;
  for (const ch of text) {
    const ascii = isAsciiChar(ch);
    if (curAscii === null) {
      curAscii = ascii;
    } else if (ascii !== curAscii) {
      segments.push({ text: cur, useCjk: !curAscii });
      cur = "";
      curAscii = ascii;
    }
    cur += ch;
  }
  if (cur) segments.push({ text: cur, useCjk: curAscii === null ? false : !curAscii });
  return segments;
}

// ═══ Mixed-Font Width Measurement ═══
export function widthOfText(
  text: string,
  cjkFont: any,
  asciiFont: any,
  size: number
): number {
  let w = 0;
  for (const s of segmentText(text || "")) {
    const font = s.useCjk ? cjkFont : asciiFont;
    w += font.widthOfTextAtSize(s.text, size);
  }
  return w;
}

// ═══ Mixed-Font Draw (left-aligned) ═══
export function drawMixed(
  page: any,
  text: string,
  opts: {
    x: number;
    y: number;
    size: number;
    cjk: any;
    ascii: any;
    color?: any;
    bold?: boolean;
  }
): void {
  const clean = (text || "").replace(/[\n\r\t]/g, " ");
  const segs = segmentText(clean);
  let x = opts.x;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    const drawOpts = { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) };
    try {
      page.drawText(s.text, drawOpts);
      if (opts.bold) {
        page.drawText(s.text, { ...drawOpts, x: x + 0.5 });
      }
      x += font.widthOfTextAtSize(s.text, opts.size);
    } catch (_e) {
      // Fallback: if CJK font can't encode the text, try ASCII font
      try {
        const fallbackOpts = { x, y: opts.y, size: opts.size, font: opts.ascii, ...(opts.color ? { color: opts.color } : {}) };
        page.drawText(s.text, fallbackOpts);
        if (opts.bold) {
          page.drawText(s.text, { ...fallbackOpts, x: x + 0.5 });
        }
        x += opts.ascii.widthOfTextAtSize(s.text, opts.size);
      } catch (_e2) {
        // Skip character entirely if neither font works
      }
    }
  }
}

// ═══ Mixed-Font Draw (right-aligned) ═══
export function drawMixedRight(
  page: any,
  text: string,
  opts: {
    x: number; // right edge
    y: number;
    size: number;
    cjk: any;
    ascii: any;
    color?: any;
    bold?: boolean;
  }
): void {
  const clean = (text || "").replace(/[\n\r\t]/g, " ");
  const segs = segmentText(clean);
  let totalW = 0;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    totalW += font.widthOfTextAtSize(s.text, opts.size);
  }
  let x = opts.x - totalW;
  for (const s of segs) {
    const font = s.useCjk ? opts.cjk : opts.ascii;
    const drawOpts = { x, y: opts.y, size: opts.size, font, ...(opts.color ? { color: opts.color } : {}) };
    try {
      page.drawText(s.text, drawOpts);
      if (opts.bold) {
        page.drawText(s.text, { ...drawOpts, x: x + 0.5 });
      }
      x += font.widthOfTextAtSize(s.text, opts.size);
    } catch (_e) {
      try {
        const fallbackOpts = { x, y: opts.y, size: opts.size, font: opts.ascii, ...(opts.color ? { color: opts.color } : {}) };
        page.drawText(s.text, fallbackOpts);
        if (opts.bold) {
          page.drawText(s.text, { ...fallbackOpts, x: x + 0.5 });
        }
        x += opts.ascii.widthOfTextAtSize(s.text, opts.size);
      } catch (_e2) { /* skip */ }
    }
  }
}

// ═══ Word Wrap for Mixed-Font Text (binary search, O(n log n)) ═══
export function wrapText(
  text: string,
  cjk: any,
  ascii: any,
  fontSize: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const paragraphs = (text || "").split("\n");
  for (const para of paragraphs) {
    if (!para) {
      lines.push("");
      continue;
    }
    // Fast path: whole paragraph fits
    if (widthOfText(para, cjk, ascii, fontSize) <= maxWidth) {
      lines.push(para);
      continue;
    }
    // Binary search for line break positions
    let start = 0;
    while (start < para.length) {
      let lo = start + 1,
        hi = para.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        if (
          widthOfText(para.slice(start, mid), cjk, ascii, fontSize) <= maxWidth
        )
          lo = mid;
        else hi = mid - 1;
      }
      if (lo === start) lo = start + 1; // ensure at least one char
      lines.push(para.slice(start, lo));
      start = lo;
    }
  }
  if (lines.length === 0) lines.push("");
  return lines;
}

// ═══ Unified Font Loading ═══
// Strategy: 1) R2 bucket (fast, reliable) → 2) CDN fallback → 3) Helvetica only
const CHINESE_FONT_URL_CDN =
  "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.woff2";

export interface EmbeddedFonts {
  cjk: any;
  ascii: any;
  cjkMissing: boolean;
}

export async function fetchAndEmbedFont(
  pdfDoc: PDFDocument,
  env: { PDF_TEMPLATES?: any; R2?: any }
): Promise<EmbeddedFonts> {
  pdfDoc.registerFontkit(fontkit);

  let fontBytes: ArrayBuffer | null = null;

  // 1) Try R2 bucket first
  try {
    const r2Bucket = env.PDF_TEMPLATES || env.R2;
    if (r2Bucket) {
      const r2Obj = await r2Bucket.get("NotoSansTC.woff2");
      if (r2Obj) {
        fontBytes = await r2Obj.arrayBuffer();
      }
    }
  } catch {
    // R2 not available, fall through to CDN
  }

  // 2) Try CDN fallback
  if (!fontBytes) {
    try {
      const resp = await fetch(CHINESE_FONT_URL_CDN, {
        headers: { Accept: "*/*" },
      });
      if (resp.ok) {
        fontBytes = await resp.arrayBuffer();
      }
    } catch {
      // CDN not available, fall through to Helvetica-only
    }
  }

  // 3) Embed fonts
  const ascii = await pdfDoc.embedFont(StandardFonts.Helvetica);

  if (fontBytes && fontBytes.byteLength > 0) {
    try {
      const cjk = await pdfDoc.embedFont(fontBytes);
      return { cjk, ascii, cjkMissing: false };
    } catch {
      // Font embedding failed (e.g. corrupt bytes)
    }
  }

  console.warn("[_pdf-utils] CJK font not available — Chinese text will not render.");
  return { cjk: ascii, ascii, cjkMissing: true }; // fallback: use Helvetica for everything
}

// ═══ Date Formatting ═══
export function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  const t = String(s).trim();
  // DDMMYYYY → DD/MM/YYYY
  if (t.length === 8 && /^\d{8}$/.test(t)) {
    return `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4, 8)}`;
  }
  return t;
}

// ═══ Name Parsing ═══
// Consistent strategy: last word is surname (matches local Flask _parse_english_name)
export function parseEnglishName(fullName: string): {
  surname: string;
  otherNames: string;
} {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0) return { surname: "", otherNames: "" };
  if (parts.length === 1) return { surname: parts[0], otherNames: "" };
  // Last word = surname (matches server.py _parse_english_name)
  const surname = parts[parts.length - 1];
  const otherNames = parts.slice(0, -1).join(" ");
  return { surname, otherNames };
}

// ═══ Address Parsing ═══
export function parseAddress(addr: string): {
  flat: string;
  building: string;
  street: string;
  district: string;
  country: string;
} {
  const result = { flat: "", building: "", street: "", district: "", country: "" };
  if (!addr || !addr.trim()) return result;

  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);

  // Hong Kong district names (Chinese + English)
  const districtNames = [
    "Central", "Wan Chai", "Causeway Bay", "North Point", "Quarry Bay",
    "Shau Kei Wan", "Chai Wan", "Aberdeen", "Ap Lei Chau", "Pok Fu Lam",
    "Kennedy Town", "Sai Ying Pun", "Sheung Wan", "Admiralty", "Happy Valley",
    "Tsim Sha Tsui", "Mong Kok", "Yau Ma Tei", "Jordan", "Hung Hom",
    "Kowloon Bay", "Kwun Tong", "Ngau Tau Kok", "San Po Kong", "Wong Tai Sin",
    "Sham Shui Po", "Cheung Sha Wan", "Lai Chi Kok", "Kwai Chung", "Tsuen Wan",
    "Tuen Mun", "Yuen Long", "Sheung Shui", "Fanling", "Tai Po", "Sha Tin",
    "Ma On Shan", "Sai Kung", "Tseung Kwan O", "Chek Lap Kok", "Tung Chung",
    "中環", "灣仔", "銅鑼灣", "北角", "鰂魚涌", "筲箕灣", "柴灣",
    "尖沙咀", "旺角", "油麻地", "佐敦", "紅磡", "觀塘", "牛頭角",
    "新蒲崗", "黃大仙", "深水埗", "長沙灣", "荔枝角", "葵涌", "荃灣",
    "屯門", "元朗", "上水", "粉嶺", "大埔", "沙田", "馬鞍山", "西貢",
    "將軍澳", "東涌", "香港仔", "薄扶林", "堅尼地城", "西營盤", "上環",
  ];

  // Detect district (usually the second-to-last or last segment)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (districtNames.some((d) => p.includes(d))) {
      result.district = p;
      break;
    }
    // Fallback: "Hong Kong" / "Kowloon" / "New Territories"
    if (
      /^(Hong\s*Kong|Kowloon|New\s*Territories|九龍|新界|香港|N\.?T\.?)$/i.test(
        p
      )
    ) {
      result.country = p;
      continue;
    }
  }

  // Detect street (segments containing Road/Street/Avenue/Drive/Lane/路/街/道)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (
      /\b(Road|Street|Avenue|Drive|Lane|Path|Boulevard|Road|路|街|道|里|徑|徑)\b/i.test(
        p
      ) ||
      /^\d+[A-Z]?\s+/.test(p) // Starts with number (e.g. "123 Hennessy Road")
    ) {
      result.street = p;
      break;
    }
  }

  // Detect building (segments with Tower/Block/Level/Building/大廈/中心/廣場)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (
      p === result.street ||
      p === result.district ||
      p === result.country
    )
      continue;
    if (
      /\b(Tower|Block|Building|Centre|Center|Plaza|House|Mansion|Factory|Industrial|Commercial|大廈|中心|廣場|大樓|工業|商業|工廠|樓|閣|苑|園|邨|村)\b/i.test(
        p
      )
    ) {
      result.building = p;
      break;
    }
  }

  // Detect flat (remaining short segment, or segments with Flat/Room/Unit/室)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (
      p === result.street ||
      p === result.district ||
      p === result.country ||
      p === result.building
    )
      continue;
    if (
      /\b(Flat|Room|Unit|Suite|Floor|Level|Lvl|Flr|R\.?M\.?|Apt|室|樓|層)\b/i.test(
        p
      )
    ) {
      result.flat = p;
      break;
    }
  }

  // If no flat found and there's a remaining small segment, use it as flat
  if (!result.flat) {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (
        p === result.street ||
        p === result.district ||
        p === result.country ||
        p === result.building
      )
        continue;
      // Short numeric/alpha segment → likely flat
      result.flat = p;
      break;
    }
  }

  return result;
}

// ═══ HKID / Passport Formatting ═══
export function fmtHkid(idNumber: string | null | undefined): string {
  if (!idNumber) return "";
  const t = String(idNumber).trim();
  return t.length >= 4 ? t.slice(0, 4) : t;
}

export function fmtPassport(passport: string | null | undefined): string {
  if (!passport) return "";
  const t = String(passport).trim();
  const half = Math.ceil(t.length / 2);
  return t.slice(0, half);
}

// ═══ Currency Formatting ═══
export function fmtAmount(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return String(n);
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPrice(
  val: number | string | null | undefined,
  currency: string | null | undefined
): string {
  const num = fmtAmount(val);
  if (!num) return "";
  const curr = (currency || "HKD").toUpperCase();
  // Compact currency: HKD→HK$, USD→US$, CNY→CN¥
  const compact: Record<string, string> = {
    HKD: "HK$", USD: "US$", CNY: "CN¥", GBP: "£", EUR: "€", JPY: "¥",
  };
  return `${compact[curr] || curr + " "}${num}`;
}

// ═══ Build full address from structured fields ═══
export function buildAddress(company: any): string {
  if (!company) return "";
  return [
    company.reg_flat,
    company.reg_building,
    company.reg_street,
    company.reg_district,
    company.reg_region,
  ]
    .filter(Boolean)
    .join(", ");
}

export function buildPersonAddress(person: any): string {
  if (!person) return "";
  const parts = [
    person.addr_flat,
    person.addr_building,
    person.addr_street,
    person.addr_district,
    person.addr_region,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(", ");
  // Fallback: use flat address field
  return person.address || "";
}

// ═══ Person label (name_english (name_chinese)) ═══
export function personLabel(person: any): string {
  if (!person) return "—";
  const en = (person.name_english || "").trim();
  const cn = (person.name_chinese || "").trim();
  if (en && cn) return `${en}（${cn}）`;
  return en || cn || "—";
}
