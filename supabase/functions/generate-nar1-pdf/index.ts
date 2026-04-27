import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, PDFName, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

const CJK_FONT_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/NotoSansTC-Regular.ttf";
let _cjkFontCache: ArrayBuffer | null = null;
async function loadCjkFontBytes(): Promise<ArrayBuffer> {
  if (_cjkFontCache) return _cjkFontCache;
  const r = await fetch(CJK_FONT_URL);
  if (!r.ok) throw new Error(`Failed to load CJK font: ${r.status}`);
  _cjkFontCache = await r.arrayBuffer();
  return _cjkFontCache;
}

interface Fonts { latin: any; cjk: any | null; }

async function embedFontsForDoc(doc: PDFDocument, cjkBytes: ArrayBuffer | null): Promise<Fonts> {
  const latin = await doc.embedFont(StandardFonts.Helvetica);
  let cjk: any = null;
  if (cjkBytes) {
    try {
      doc.registerFontkit(fontkit);
      cjk = await doc.embedFont(cjkBytes, { subset: true });
    } catch (e) {
      console.warn("CJK font embed failed:", e);
    }
  }
  return { latin, cjk };
}

function isCjk(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c > 0x7E; // any non-ASCII -> use CJK font
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OfficerData {
  nameChinese: string;
  nameEnglish: string;
  email: string;
  identity: 'natural' | 'corporate';
  brNumber?: string;
  address?: string;
  idNumber?: string;
  dateAppointed?: string;
  placeIncorporated?: string;
  companyNumberRef?: string;
  tcspNumber?: string;
  passportNumber?: string;
  nationality?: string;
}

interface ShareholderData {
  name: string;
  nameEnglish?: string;
  nameChinese?: string;
  shares: number;
  identity?: string;
  idNumber?: string;
  address?: string;
  shareType?: string;
  currency?: string;
  issuePrice?: string;
  paidUp?: string;
  unpaid?: string;
}

interface CompanyData {
  name: string;
  chineseName?: string;
  brNumber: string;
  tradingName: string;
  businessNature: string;
  businessCode: string;
  companyType: string;
  registeredOffice?: {
    flat?: string;
    building?: string;
    street?: string;
    district?: string;
    region?: string;
  };
  directors: OfficerData[];
  secretaries: OfficerData[];
  shareholders: ShareholderData[];
  returnDate?: string;
  /** 公司紀錄保存地點（如非保存於註冊辦事處），會觸發附表 E (P.15) */
  companyRecords?: Array<{ records: string; address: string }>;
  presenter?: {
    name?: string;
    address?: string;
    contact?: string;
    reference?: string;
    phone?: string;
    fax?: string;
    email?: string;
  };
}

const TEMPLATE_BASE = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates";
const TEMPLATES = {
  main: `${TEMPLATE_BASE}/NAR1_part1_pages1-8.pdf`,    // 主文件 P.1-P.8
  schedule1: `${TEMPLATE_BASE}/NAR1_p9_v2.pdf`,        // 附表 1 - 非上市成員（v2: 唯一欄位名）
  schedule2: `${TEMPLATE_BASE}/NAR1_p10_v2.pdf`,       // 附表 2 - 上市公司成員
  sheetA: `${TEMPLATE_BASE}/NAR1_p11_v2.pdf`,          // 續頁 A - 額外自然人秘書
  sheetB: `${TEMPLATE_BASE}/NAR1_p12_v2.pdf`,          // 續頁 B - 額外法人秘書
  sheetC: `${TEMPLATE_BASE}/NAR1_p13_v2.pdf`,          // 續頁 C - 額外自然人董事
  sheetD: `${TEMPLATE_BASE}/NAR1_p14_v2.pdf`,          // 續頁 D - 額外法人董事
  sheetE: `${TEMPLATE_BASE}/NAR1_p15_v2.pdf`,          // 續頁 E - 公司紀錄
};

async function fetchTemplate(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load template ${url}: ${r.status}`);
  return await r.arrayBuffer();
}

async function listAllFormFields(): Promise<{ fields: Array<{name: string; type: string}> }> {
  const all: Array<{name: string; type: string}> = [];
  for (const [tag, url] of Object.entries(TEMPLATES)) {
    try {
      const bytes = await fetchTemplate(url);
      const doc = await PDFDocument.load(bytes);
      const form = doc.getForm();
      for (const f of form.getFields()) {
        all.push({ name: `[${tag}] ${f.getName()}`, type: f.constructor.name });
      }
    } catch (e) {
      console.warn(`Could not list fields for ${tag}:`, e);
    }
  }
  all.sort((a, b) => a.name.localeCompare(b.name));
  return { fields: all };
}

// === 共用工具 ===
const parseEnglishName = (fullName: string) => {
  const cleaned = (fullName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { surname: "", otherNames: "" };
  if (cleaned.includes(",")) {
    const segs = cleaned.split(",").map(s => s.trim()).filter(Boolean);
    if (segs.length >= 2) return { surname: segs[0], otherNames: segs.slice(1).join(" ") };
    if (segs.length === 1) return { surname: segs[0], otherNames: "" };
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { surname: "", otherNames: "" };
  const surname = parts[0].replace(/,+$/g, "");
  const otherNames = parts.slice(1).join(" ").replace(/^,+\s*/, "");
  return { surname, otherNames };
};

const fmtAmount = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("en-US");

const ADDR_FLAT_RE = /^(?:flat|room|rm|unit|shop|suite|ste|workshop|portion|floor|fl|\d+\/f|g\/f|gf|lg\/f|ug\/f|m\/f|b\d*\/f)\b/i;
const ADDR_COUNTRY_RE = /^(hong\s*kong|hk|china|prc|macau|macao|singapore|taiwan|united\s+\w+|usa|uk|canada|australia|japan|korea|h\.?k\.?\s*sar)$/i;
const ADDR_DISTRICT_HINTS = /(kowloon|hong\s*kong|new\s*territories|n\.t\.|island|wan\s*chai|central|tsim|mong\s*kok|sham\s*shui|kwun\s*tong|sha\s*tin|tai\s*po|tuen\s*mun|yuen\s*long|tsuen\s*wan|kwai\s*tsing|sai\s*kung|north\s*district|southern\s*district|eastern\s*district)/i;

const parseAddress = (addr: string) => {
  if (!addr) return { flat: '', building: '', street: '', district: '', country: '' };
  let parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return { flat: '', building: '', street: '', district: '', country: '' };
  if (parts.length === 1) return { flat: '', building: '', street: parts[0], district: '', country: '' };
  let country = '';
  if (ADDR_COUNTRY_RE.test(parts[parts.length - 1])) country = parts.pop()!;
  let district = '';
  if (parts.length > 1 && (ADDR_DISTRICT_HINTS.test(parts[parts.length - 1]) || parts.length >= 3)) {
    district = parts.pop()!;
  }
  const flatParts: string[] = [];
  while (parts.length > 1 && ADDR_FLAT_RE.test(parts[0])) flatParts.push(parts.shift()!);
  const flat = flatParts.join(', ');
  const building = parts.shift() || '';
  const street = parts.join(', ');
  return { flat, building, street, district, country };
};

const parseHkidPartial = (idNumber: string) => {
  if (!idNumber) return '';
  return idNumber.replace(/[()\-\s]/g, '').toUpperCase().slice(0, 4);
};

const parsePassportPartial = (passportNumber: string) => {
  if (!passportNumber) return '';
  const cleaned = passportNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned.slice(0, Math.ceil(cleaned.length / 2));
};

type WidgetTarget = {
  page: any;
  rect: { x: number; y: number; width: number; height: number };
};

const decodePdfText = (value: any): string => {
  if (!value) return "";
  try {
    if (typeof value.decodeText === "function") return value.decodeText();
  } catch (_) { /* ignore */ }
  return String(value).replace(/^\((.*)\)$/s, "$1");
};

const asNumber = (value: any): number => {
  if (!value) return 0;
  if (typeof value.asNumber === "function") return value.asNumber();
  if (typeof value.numberValue === "number") return value.numberValue;
  return Number(value) || 0;
};

function collectWidgetTargets(pdfDoc: PDFDocument): Map<string, WidgetTarget> {
  const targets = new Map<string, WidgetTarget>();

  const addTarget = (key: string, target: WidgetTarget) => {
    if (key && !targets.has(key)) targets.set(key, target);
  };

  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots")) as any;
    if (!annots || typeof annots.size !== "function") continue;

    for (let i = 0; i < annots.size(); i++) {
      try {
        const annot = pdfDoc.context.lookup(annots.get(i)) as any;
        if (!annot || typeof annot.get !== "function") continue;

        const rectObj = annot.lookup(PDFName.of("Rect")) as any;
        if (!rectObj || typeof rectObj.lookup !== "function") continue;
        const x1 = asNumber(rectObj.lookup(0));
        const y1 = asNumber(rectObj.lookup(1));
        const x2 = asNumber(rectObj.lookup(2));
        const y2 = asNumber(rectObj.lookup(3));
        const target: WidgetTarget = {
          page,
          rect: { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) },
        };

        const childName = decodePdfText(annot.get(PDFName.of("T")));
        const parentRef = annot.get(PDFName.of("Parent"));
        const parent = parentRef ? pdfDoc.context.lookup(parentRef) as any : undefined;
        const parentName = parent ? decodePdfText(parent.get(PDFName.of("T"))) : "";

        addTarget(childName, target);
        if (parentName && childName) addTarget(`${parentName}.${childName}`, target);
      } catch (_) { /* skip malformed widget */ }
    }
  }

  return targets;
}

function stripFormAnnotations(pdfDoc: PDFDocument) {
  for (const page of pdfDoc.getPages()) {
    page.node.delete(PDFName.of("Annots"));
  }
  pdfDoc.catalog.delete(PDFName.of("AcroForm"));
}

function normalizeDrawableText(value: string): string {
  return String(value ?? "")
    .replace(/✓/g, "X")
    // strip control chars except CR/LF; keep printable ASCII + all unicode
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

// 量度文字寬度（混合字體）
function measureMixed(text: string, fontSize: number, fonts: Fonts): number {
  let w = 0;
  for (const ch of text) {
    const f = (isCjk(ch) && fonts.cjk) ? fonts.cjk : fonts.latin;
    try { w += f.widthOfTextAtSize(ch, fontSize); }
    catch { /* glyph missing in latin -> skip */ }
  }
  return w;
}

// 繪製混合字體一行：逐字符繪製，避免單一缺失 glyph 讓整段失敗
function drawMixedLine(page: any, text: string, x: number, y: number, fontSize: number, fonts: Fonts) {
  let cursor = x;
  for (const ch of text) {
    const useCjk = isCjk(ch) && fonts.cjk;
    const primary = useCjk ? fonts.cjk : fonts.latin;
    const fallback = useCjk ? fonts.latin : fonts.cjk;
    const tryDraw = (font: any): boolean => {
      if (!font) return false;
      try {
        page.drawText(ch, { x: cursor, y, size: fontSize, font, color: rgb(0, 0, 0) });
        cursor += font.widthOfTextAtSize(ch, fontSize);
        return true;
      } catch {
        return false;
      }
    };
    if (!tryDraw(primary) && !tryDraw(fallback)) {
      // 兩個字體都失敗：以空白佔位，避免錯位
      try { cursor += (primary ?? fonts.latin).widthOfTextAtSize(" ", fontSize); } catch {}
      console.warn(`Glyph missing for char: ${ch} (U+${ch.charCodeAt(0).toString(16)})`);
    }
  }
}

function drawTextInWidget(target: WidgetTarget, rawValue: string, fonts: Fonts) {
  const text = normalizeDrawableText(rawValue);
  if (!text) return;

  const { page, rect } = target;
  const padding = Math.min(2.5, Math.max(1, rect.width * 0.03));
  const isMultiline = text.includes("\n") || rect.height > 24;
  // 固定字號（早上版本）：不依欄位高度縮放
  const fontSize = 9;
  const lineHeight = fontSize + 2;
  const maxWidth = Math.max(1, rect.width - padding * 2);
  const maxLines = Math.max(1, Math.floor((rect.height - padding * 2) / lineHeight));

  const fit = (line: string) => {
    let fitted = line.trim();
    while (fitted.length > 0 && measureMixed(fitted, fontSize, fonts) > maxWidth) {
      fitted = fitted.slice(0, -1);
    }
    return fitted;
  };

  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (lines.length >= maxLines) break;
    // 含中文時按字符換行；純拉丁按詞換行
    const hasCjk = /[^\x00-\x7F]/.test(rawLine);
    if (hasCjk) {
      let current = "";
      for (const ch of rawLine) {
        const candidate = current + ch;
        if (measureMixed(candidate, fontSize, fonts) <= maxWidth) current = candidate;
        else {
          if (current) lines.push(current);
          current = ch;
          if (lines.length >= maxLines) break;
        }
      }
      if (current && lines.length < maxLines) lines.push(fit(current));
    } else {
      const words = rawLine.split(" ").filter(Boolean);
      if (words.length <= 1) { lines.push(fit(rawLine)); continue; }
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (measureMixed(candidate, fontSize, fonts) <= maxWidth) current = candidate;
        else {
          if (current) lines.push(fit(current));
          current = word;
          if (lines.length >= maxLines) break;
        }
      }
      if (current && lines.length < maxLines) lines.push(fit(current));
    }
  }

  const startY = isMultiline
    ? rect.y + rect.height - padding - fontSize
    : rect.y + Math.max(1, (rect.height - fontSize) / 2 - 1);
  lines.filter(Boolean).forEach((line, index) => {
    drawMixedLine(page, line, rect.x + padding, startY - index * lineHeight, fontSize, fonts);
  });
}

// === Helper（drawText 模式）：用於附表頁 P.9-P.15，因為這些頁面的欄位有命名衝突 ===
function createFormHelpers(pdfDoc: PDFDocument, fonts: Fonts) {
  const form = pdfDoc.getForm();
  const widgets = collectWidgetTargets(pdfDoc);

  const safeSetText = (fieldName: string, value: string) => {
    try {
      const target = widgets.get(fieldName);
      if (!target) throw new Error("widget not found");
      drawTextInWidget(target, value ?? "", fonts);
      return true;
    } catch (e) {
      console.warn(`⚠ Missing field: ${fieldName}`);
      return false;
    }
  };

  const safeCheck = (fieldName: string, shouldCheck: boolean) => {
    if (!shouldCheck) return false;
    const target = widgets.get(fieldName);
    if (!target) return false;
    drawTextInWidget(target, "X", fonts);
    return true;
  };

  return { form, safeSetText, safeCheck };
}

// === Helper（原生 setText 模式）：用於主文件 P.1-P.8，由 PDF reader 渲染中文 fallback 字體
//     效果與 Acrobat 直接填表相同，中英文視覺最自然 ===
function createNativeFormHelpers(pdfDoc: PDFDocument) {
  const form = pdfDoc.getForm();

  const safeSetText = (fieldName: string, value: string) => {
    try {
      const tf = form.getTextField(fieldName);
      tf.setText(value ?? "");
      return true;
    } catch (e) {
      console.warn(`⚠ Missing native field: ${fieldName}`);
      return false;
    }
  };

  const safeCheck = (fieldName: string, shouldCheck: boolean) => {
    if (!shouldCheck) return false;
    try {
      form.getCheckBox(fieldName).check();
      return true;
    } catch {
      return false;
    }
  };

  return { form, safeSetText, safeCheck };
}


// === 各模板的填寫函式（操作各自的單頁 PDF 副本） ===

interface CommonCtx {
  br8: string;
  day: string;
  month: string;
  year: string;
  data: CompanyData;
  office: NonNullable<CompanyData["registeredOffice"]>;
  shareInfos: Array<{ className: string; currency: string; issuePrice: number; shares: number; paidUp: number; unpaid: number; }>;
}

// ========== 主文件 P.1-P.8 ==========
function fillMainDocument(pdfDoc: PDFDocument, ctx: CommonCtx, fonts: Fonts) {
  const { br8, day, month, year, data, office, shareInfos } = ctx;
  const { safeSetText, safeCheck, form } = createNativeFormHelpers(pdfDoc);

  // ===== Page 1 =====
  safeSetText("fill_1_P.1", br8);
  const fullCompanyName = [data.name, data.chineseName].filter(Boolean).join("\n");
  safeSetText("fill_2_P.1", fullCompanyName);
  safeSetText("fill_3_P.1", data.tradingName || "");
  safeCheck("cb_1_P.1", data.companyType?.includes("私人") || data.companyType?.toLowerCase().includes("private") || false);
  safeCheck("cb_2_P.1", data.companyType?.includes("公眾") || data.companyType?.toLowerCase().includes("public") || false);
  safeCheck("cb_3_P.1", data.companyType?.includes("擔保") || false);
  safeSetText("fill_4_P.1", data.businessCode || "");
  safeSetText("fill_5_P.1", data.businessNature || "");
  safeSetText("fill_6_P.1", day || "");
  safeSetText("fill_7_P.1", month || "");
  safeSetText("fill_8_P.1", year || "");
  safeSetText("fill_15_P.1", office.flat || "");
  safeSetText("fill_16_P.1", office.building || "");
  safeSetText("fill_17_P.1", office.street || "");
  safeSetText("fill_18_P.1", office.district || "");
  if (office.region) {
    try {
      const dropdown = form.getDropdown("Dropdown1_P.1");
      const options = dropdown.getOptions();
      const match = options.find((o: string) => office.region!.includes(o) || o.includes(office.region!));
      if (match) dropdown.select(match);
    } catch (_) { /* ignore */ }
  }
  const presenterP1 = data.presenter || {};
  if (presenterP1.name) safeSetText("fill_19_P.1", presenterP1.name);
  if (presenterP1.address) safeSetText("fill_20_P.1", presenterP1.address);
  if (presenterP1.phone) safeSetText("fill_21_P.1", presenterP1.phone);
  if (presenterP1.fax) safeSetText("fill_22_P.1", presenterP1.fax);
  if (presenterP1.email) safeSetText("fill_23_P.1", presenterP1.email);
  if (presenterP1.reference) safeSetText("fill_24_P.1", presenterP1.reference);

  // ===== Page 2 - Share Capital =====
  safeSetText("fill_1_P.2", br8);
  let totalShares = 0, totalAmountSum = 0, totalPaidUpSum = 0, firstCurrency = "";
  for (let i = 0; i < Math.min(4, shareInfos.length); i++) {
    const info = shareInfos[i];
    const base = 6 + i * 5;
    const issuedAmount = (info.paidUp + info.unpaid) || (info.issuePrice ? info.issuePrice * info.shares : 0);
    safeSetText(`fill_${base}_P.2`, info.className);
    safeSetText(`fill_${base + 1}_P.2`, info.currency);
    safeSetText(`fill_${base + 2}_P.2`, fmtInt(info.shares));
    safeSetText(`fill_${base + 3}_P.2`, issuedAmount ? fmtAmount(issuedAmount) : "");
    safeSetText(`fill_${base + 4}_P.2`, info.paidUp ? fmtAmount(info.paidUp) : (issuedAmount ? fmtAmount(issuedAmount) : ""));
    totalShares += info.shares;
    totalAmountSum += issuedAmount;
    totalPaidUpSum += info.paidUp || issuedAmount;
    if (!firstCurrency) firstCurrency = info.currency;
  }
  if (shareInfos.length > 0) {
    safeSetText("fill_26_P.2", firstCurrency);
    safeSetText("fill_27_P.2", fmtInt(totalShares));
    safeSetText("fill_28_P.2", totalAmountSum ? fmtAmount(totalAmountSum) : "");
    safeSetText("fill_29_P.2", totalPaidUpSum ? fmtAmount(totalPaidUpSum) : "");
  }

  // ===== Page 3 - Secretary (Natural) - 第一位 =====
  safeSetText("fill_1_P.3", br8);
  const naturalSecretaries = (data.secretaries || []).filter(s => s.identity === "natural");
  if (naturalSecretaries.length > 0) {
    const sec = naturalSecretaries[0];
    const { surname, otherNames } = parseEnglishName(sec.nameEnglish);
    safeSetText("fill_2_P.3", sec.nameChinese || "");
    safeSetText("fill_3_P.3", surname);
    safeSetText("fill_4_P.3", otherNames);
    const addr = parseAddress(sec.address || '');
    safeSetText("fill_9_P.3", addr.flat);
    safeSetText("fill_10_P.3", addr.building);
    safeSetText("fill_11_P.3", addr.street);
    safeSetText("fill_12_P.3", addr.district);
    safeSetText("fill_13_P.3", sec.email || "");
    const hkid = parseHkidPartial(sec.idNumber || '');
    if (hkid) safeSetText("fill_14_P.3", hkid);
  }

  // ===== Page 4 - Secretary (Corporate) - 第一位 =====
  safeSetText("fill_1_P.4", br8);
  const corporateSecretaries = (data.secretaries || []).filter(s => s.identity === "corporate");
  if (corporateSecretaries.length > 0) {
    const sec = corporateSecretaries[0];
    safeSetText("fill_2_P.4", sec.nameChinese || "");
    safeSetText("fill_3_P.4", sec.nameEnglish || "");
    const addr = parseAddress(sec.address || '');
    safeSetText("fill_4_P.4", addr.flat);
    safeSetText("fill_5_P.4", addr.building);
    safeSetText("fill_6_P.4", addr.street);
    safeSetText("fill_7_P.4", addr.district);
    safeSetText("fill_8_P.4", sec.email || "");
    safeSetText("fill_9_P.4", sec.companyNumberRef || sec.brNumber || "");
    const tcsp = sec.tcspNumber || (sec as any).licenceNumber || "";
    if (tcsp) safeSetText("fill_10_P.4", tcsp);
  }

  // ===== Page 5 - Director (Natural) - 第一位 =====
  safeSetText("fill_1_P.5", br8);
  const naturalDirectors = (data.directors || []).filter(d => d.identity === "natural");
  if (naturalDirectors.length > 0) {
    const dir = naturalDirectors[0];
    const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
    safeCheck("cb_1_P.5", true);
    safeSetText("fill_3_P.5", dir.nameChinese || "");
    safeSetText("fill_4_P.5", surname);
    safeSetText("fill_5_P.5", otherNames);
    safeSetText("fill_10_P.5", office.flat || "");
    safeSetText("fill_11_P.5", office.building || "");
    safeSetText("fill_12_P.5", office.street || "");
    safeSetText("fill_13_P.5", office.district || "");
    safeSetText("fill_14_P.5", office.region || "");
    safeSetText("fill_15_P.5", dir.email || "");
    const hkid = parseHkidPartial(dir.idNumber || '');
    if (hkid) {
      safeSetText("fill_16_P.5", hkid);
    } else if (dir.passportNumber) {
      safeSetText("fill_17_P.5", dir.nationality || dir.placeIncorporated || "");
      safeSetText("fill_18_P.5", parsePassportPartial(dir.passportNumber));
    }
  }

  // ===== Page 6 - Director (Corporate) - 第一位 =====
  safeSetText("fill_1_P.6", br8);
  const corporateDirectors = (data.directors || []).filter(d => d.identity === "corporate");
  if (corporateDirectors.length > 0) {
    const dir = corporateDirectors[0];
    safeCheck("cb_1_P.6", true);
    safeSetText("fill_3_P.6", dir.nameChinese || "");
    safeSetText("fill_4_P.6", dir.nameEnglish || "");
    safeSetText("fill_5_P.6", office.flat || "");
    safeSetText("fill_6_P.6", office.building || "");
    safeSetText("fill_7_P.6", office.street || "");
    safeSetText("fill_8_P.6", office.district || "");
    safeSetText("fill_9_P.6", office.region || "");
    safeSetText("fill_10_P.6", dir.email || "");
    safeSetText("fill_11_P.6", dir.companyNumberRef || dir.brNumber || "");
  }

  // ===== Page 7 - Reserve Director (BR header only) =====
  safeSetText("fill_1_P.7", br8);

  // ===== Page 8 - 簽署/續頁數 =====
  safeSetText("fill_1_P.8", br8);
  const memberCount = (data.shareholders || []).filter(sh => (Number(sh.shares) || 0) > 0).length;
  const isListedCo = data.companyType?.includes("上市") || data.companyType?.toLowerCase().includes("listed") || false;

  // 14 ☑ 非上市公司成員詳情列於附表一 / 上市公司則勾附表二
  if (!isListedCo) safeCheck("cb_1_P.8", true);
  safeCheck("cb_4_P.8",
    (data.companyType?.includes("私人") || data.companyType?.toLowerCase().includes("private")) || false);

  // 續頁頁數
  const sheetA = Math.max(0, naturalSecretaries.length - 1);
  const sheetB = Math.max(0, corporateSecretaries.length - 1);
  const sheetC = Math.max(0, naturalDirectors.length - 1);
  const sheetD = Math.max(0, corporateDirectors.length - 1);
  const schedulePages = !isListedCo && memberCount > 0 ? Math.ceil(memberCount / 2) : 0;
  const schedule2Pages = isListedCo ? 1 : 0;

  if (sheetA > 0) safeSetText("fill_4_P.8", String(sheetA));
  if (sheetB > 0) safeSetText("fill_5_P.8", String(sheetB));
  if (sheetC > 0) safeSetText("fill_6_P.8", String(sheetC));
  if (sheetD > 0) safeSetText("fill_7_P.8", String(sheetD));
  if (schedulePages > 0) safeSetText("fill_9_P.8", String(schedulePages));
  if (schedule2Pages > 0) safeSetText("fill_10_P.8", String(schedule2Pages));

  if (presenterP1.name) safeSetText("fill_11_P.8", presenterP1.name);
  if (day && month && year) safeSetText("fill_12_P.8", `${day}/${month}/${year}`);
}

// ========== 附表 1 (P.9): 兩位股東 (非上市公司) ==========
// 新欄位映射（基於官方模板 widget 閱讀順序）：
//   1=DD 2=MM 3=YYYY 4=BR 5=股份類別 6=已發行總數
//   成員1: 7=中文 8=英文姓 9=英文名 10=股數 11=聯名(cb-不可用) 12=英文公司名 13=室 14=大廈 15=街道 16=區/市 17=國家 18=備註
//   成員2: 19=中文 20=英文姓 21=英文名 22=股數 23=聯名(cb) 24=英文公司名 25=室 26=大廈 27=街道 28=區/市 29=國家 30=備註
//   31=本頁頁次 32=總頁數
function fillSchedule1(pdfDoc: PDFDocument, ctx: CommonCtx, members: ShareholderData[], pageNo: number, totalPages: number, fonts: Fonts) {
  const { br8, day, month, year, shareInfos } = ctx;
  const { safeSetText } = createNativeFormHelpers(pdfDoc);

  safeSetText("fill_1_P9", day || "");
  safeSetText("fill_2_P9", month || "");
  safeSetText("fill_3_P9", year || "");
  safeSetText("fill_4_P9", br8);
  const firstShareInfo = shareInfos[0];
  if (firstShareInfo) {
    safeSetText("fill_5_P9", firstShareInfo.className);
    safeSetText("fill_6_P9", fmtInt(firstShareInfo.shares));
  }

  const fillMember = (sh: ShareholderData, slot: 1 | 2) => {
    const isCorp = sh.identity === "corporate";
    const fullName = sh.nameEnglish || sh.name || "";
    const { surname, otherNames } = parseEnglishName(fullName);
    const addr = parseAddress(sh.address || "");
    const base = slot === 1 ? 0 : 12; // 成員 2 偏移 12
    const f = (n: number) => `fill_${n + base}_P9`;
    safeSetText(f(7), sh.nameChinese || "");
    if (isCorp) {
      safeSetText(f(12), fullName); // 英文公司名
    } else {
      safeSetText(f(8), surname);
      safeSetText(f(9), otherNames);
    }
    safeSetText(f(10), fmtInt(Number(sh.shares) || 0));
    safeSetText(f(13), addr.flat);
    safeSetText(f(14), addr.building);
    safeSetText(f(15), addr.street);
    safeSetText(f(16), addr.district);
    safeSetText(f(17), addr.country);
  };

  if (members[0]) fillMember(members[0], 1);
  if (members[1]) fillMember(members[1], 2);
  safeSetText("fill_31_P9", String(pageNo));
  safeSetText("fill_32_P9", String(totalPages));
}

// ========== 附表 2 (P.10): 上市公司 ==========
// 結構與 P.9 類似，但成員多一個「佔比」欄位
//   1-4 同上, 5=股份類別 6=已發行總數
//   成員1: 7=中文 8=股數 9=英文姓 10=英文名 11=英文公司名 12=佔比 13=聯名 14=室 15=大廈 16=街 17=區 18=國 19=備註
//   成員2: 20=中文 21=股數 22=英文姓 23=英文名 24=英文公司名 25=佔比 26=聯名 27=室 28=大廈 29=街 30=區 31=國 32=備註
//   33=本頁 34=總頁
function fillSchedule2(pdfDoc: PDFDocument, ctx: CommonCtx, fonts: Fonts) {
  const { br8, day, month, year, shareInfos } = ctx;
  const { safeSetText } = createNativeFormHelpers(pdfDoc);
  safeSetText("fill_1_P10", day || "");
  safeSetText("fill_2_P10", month || "");
  safeSetText("fill_3_P10", year || "");
  safeSetText("fill_4_P10", br8);
  if (shareInfos[0]) {
    safeSetText("fill_5_P10", shareInfos[0].className);
    safeSetText("fill_6_P10", fmtInt(shareInfos[0].shares));
  }
}

// ========== 續頁 A (P.11): 額外自然人秘書 ==========
// 1=DD 2=MM 3=YYYY 4=BR
// 5=中文姓名 6=英文姓 7=英文名 8=前用中文 9=前用英文 10=中文別名 11=英文別名
// 12=室 13=大廈 14=街道 15=區
// 16=Email 17=HKID 部分 18=護照簽發國 19=護照部分 20=牌照編號 21=無須持牌 22=原因
function fillSheetA(pdfDoc: PDFDocument, ctx: CommonCtx, sec: OfficerData, fonts: Fonts) {
  const { br8, day, month, year } = ctx;
  const { safeSetText } = createNativeFormHelpers(pdfDoc);
  safeSetText("fill_1_P11", day || "");
  safeSetText("fill_2_P11", month || "");
  safeSetText("fill_3_P11", year || "");
  safeSetText("fill_4_P11", br8);

  const { surname, otherNames } = parseEnglishName(sec.nameEnglish);
  safeSetText("fill_5_P11", sec.nameChinese || "");
  safeSetText("fill_6_P11", surname);
  safeSetText("fill_7_P11", otherNames);
  const addr = parseAddress(sec.address || '');
  safeSetText("fill_12_P11", addr.flat);
  safeSetText("fill_13_P11", addr.building);
  safeSetText("fill_14_P11", addr.street);
  safeSetText("fill_15_P11", addr.district);
  safeSetText("fill_16_P11", sec.email || "");
  const hkid = parseHkidPartial(sec.idNumber || '');
  if (hkid) safeSetText("fill_17_P11", hkid);
  if (sec.tcspNumber) safeSetText("fill_20_P11", sec.tcspNumber);
}

// ========== 續頁 B (P.12): 額外法人秘書 ==========
// 1=DD 2=MM 3=YYYY 4=BR 5=中文名稱 6=英文名稱
// 7=室 8=大廈 9=街 10=區 11=Email 12=BR(此秘書) 13=牌照編號 14=無須持牌 15=原因
function fillSheetB(pdfDoc: PDFDocument, ctx: CommonCtx, sec: OfficerData, fonts: Fonts) {
  const { br8, day, month, year } = ctx;
  const { safeSetText } = createNativeFormHelpers(pdfDoc);
  safeSetText("fill_1_P12", day || "");
  safeSetText("fill_2_P12", month || "");
  safeSetText("fill_3_P12", year || "");
  safeSetText("fill_4_P12", br8);

  safeSetText("fill_5_P12", sec.nameChinese || "");
  safeSetText("fill_6_P12", sec.nameEnglish || "");
  const addr = parseAddress(sec.address || '');
  safeSetText("fill_7_P12", addr.flat);
  safeSetText("fill_8_P12", addr.building);
  safeSetText("fill_9_P12", addr.street);
  safeSetText("fill_10_P12", addr.district);
  safeSetText("fill_11_P12", sec.email || "");
  safeSetText("fill_12_P12", sec.companyNumberRef || sec.brNumber || "");
  if (sec.tcspNumber) safeSetText("fill_13_P12", sec.tcspNumber);
}

// ========== 續頁 C (P.13): 額外自然人董事 ==========
// 1=DD 2=MM 3=YYYY 4=BR
// 5=董事 6=候補董事 7=代替誰
// 8=中文姓名 9=英文姓 10=英文名 11=前用中文 12=前用英文 13=中文別名 14=英文別名
// 15=室 16=大廈 17=街道 18=區/市 19=國家
// 20=Email 21=HKID 部分 22=護照簽發國 23=護照部分
function fillSheetC(pdfDoc: PDFDocument, ctx: CommonCtx, dir: OfficerData, fonts: Fonts) {
  const { br8, day, month, year, office } = ctx;
  const { safeSetText } = createNativeFormHelpers(pdfDoc);
  safeSetText("fill_1_P13", day || "");
  safeSetText("fill_2_P13", month || "");
  safeSetText("fill_3_P13", year || "");
  safeSetText("fill_4_P13", br8);

  const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
  // 註：cb 已被合併成文字欄位，原本的「董事」勾選改用文字 ✓
  safeSetText("fill_5_P13", "✓");
  safeSetText("fill_8_P13", dir.nameChinese || "");
  safeSetText("fill_9_P13", surname);
  safeSetText("fill_10_P13", otherNames);
  safeSetText("fill_15_P13", office.flat || "");
  safeSetText("fill_16_P13", office.building || "");
  safeSetText("fill_17_P13", office.street || "");
  safeSetText("fill_18_P13", office.district || "");
  safeSetText("fill_19_P13", office.region || "");
  safeSetText("fill_20_P13", dir.email || "");
  const hkid = parseHkidPartial(dir.idNumber || '');
  if (hkid) {
    safeSetText("fill_21_P13", hkid);
  } else if (dir.passportNumber) {
    safeSetText("fill_22_P13", dir.nationality || dir.placeIncorporated || "");
    safeSetText("fill_23_P13", parsePassportPartial(dir.passportNumber));
  }
}

// ========== 續頁 D (P.14): 額外法人董事 (一頁可放 2 位) ==========
// 1=DD 2=MM 3=YYYY 4=BR
// 董事1: 5=董事 6=候補 7=代替 8=中文 9=英文 10=室 11=大廈 12=街 13=區 14=國 15=Email 16=BR
// 董事2: 17=董事 18=候補 19=代替 20=中文 21=英文 22=室 23=大廈 24=街 25=區 26=國 27=Email 28=BR
function fillSheetD(pdfDoc: PDFDocument, ctx: CommonCtx, dirs: OfficerData[], fonts: Fonts) {
  const { br8, day, month, year, office } = ctx;
  const { safeSetText } = createNativeFormHelpers(pdfDoc);
  safeSetText("fill_1_P14", day || "");
  safeSetText("fill_2_P14", month || "");
  safeSetText("fill_3_P14", year || "");
  safeSetText("fill_4_P14", br8);

  const fillSlot = (dir: OfficerData, slot: 1 | 2) => {
    const base = slot === 1 ? 0 : 12;
    const f = (n: number) => `fill_${n + base}_P14`;
    safeSetText(f(5), "✓"); // 董事勾選
    safeSetText(f(8), dir.nameChinese || "");
    safeSetText(f(9), dir.nameEnglish || "");
    safeSetText(f(10), office.flat || "");
    safeSetText(f(11), office.building || "");
    safeSetText(f(12), office.street || "");
    safeSetText(f(13), office.district || "");
    safeSetText(f(14), office.region || "");
    safeSetText(f(15), dir.email || "");
    safeSetText(f(16), dir.companyNumberRef || dir.brNumber || "");
  };
  if (dirs[0]) fillSlot(dirs[0], 1);
  if (dirs[1]) fillSlot(dirs[1], 2);
}

// ========== 續頁 E (P.15): 公司紀錄保存地點 ==========
function fillSheetE(
  pdfDoc: PDFDocument,
  ctx: CommonCtx,
  records: Array<{ records: string; address: string }>,
  fonts: Fonts,
) {
  const { safeSetText } = createNativeFormHelpers(pdfDoc);
  const { day, month, year, br8 } = ctx;
  safeSetText("fill_1_P15", day || "");
  safeSetText("fill_2_P15", month || "");
  safeSetText("fill_3_P15", year || "");
  safeSetText("fill_4_P15", br8);

  // 左欄列出紀錄名稱，右欄列出對應地址，以空行分隔多筆
  const recordsText = records.map(r => r.records || "").join("\n\n");
  const addressText = records.map(r => r.address || "").join("\n\n");
  safeSetText("fill_5_P15", recordsText);
  safeSetText("fill_6_P15", addressText);
}

// === 主流程：建構文件 ===
async function buildNAR1Pdf(data: CompanyData): Promise<Uint8Array> {
  const returnDate = data.returnDate || new Date().toISOString().split("T")[0];
  const [year, month, day] = returnDate.split("-");
  const office = data.registeredOffice || {};
  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

  // 整理股本資料（給主文件 P.2 + 附表 1 用）
  const normalizeClassName = (raw: string) => {
    const t = (raw || "").trim();
    if (!t) return "ORDINARY SHARES";
    if (/^ord(inary)?$/i.test(t) || t.includes("普通")) return "ORDINARY SHARES";
    if (/^pref(erence)?$/i.test(t) || t.includes("優先")) return "PREFERENCE SHARES";
    return t.toUpperCase();
  };
  const formatCurrency = (raw: string) => {
    const c = (raw || "HKD").trim().toUpperCase();
    if (c === "HKD" || c === "HK$") return "HK$";
    if (c === "USD" || c === "US$") return "US$";
    return c;
  };
  const toNum = (v: string | number | undefined) => {
    if (typeof v === "number") return v;
    if (!v) return 0;
    return parseFloat(String(v).replace(/,/g, "")) || 0;
  };

  type ShareInfo = { className: string; currency: string; issuePrice: number; shares: number; paidUp: number; unpaid: number; };
  const shareTypeMap = new Map<string, ShareInfo>();
  for (const sh of data.shareholders || []) {
    const className = normalizeClassName(sh.shareType || "");
    const currency = formatCurrency(sh.currency || "");
    const issuePrice = toNum(sh.issuePrice);
    const key = `${className}||${currency}||${issuePrice}`;
    if (!shareTypeMap.has(key)) shareTypeMap.set(key, { className, currency, issuePrice, shares: 0, paidUp: 0, unpaid: 0 });
    const info = shareTypeMap.get(key)!;
    info.shares += Number(sh.shares) || 0;
    info.paidUp += toNum(sh.paidUp);
    info.unpaid += toNum(sh.unpaid);
  }
  const shareInfos = Array.from(shareTypeMap.values());

  const ctx: CommonCtx = { br8, day, month, year, data, office: office as any, shareInfos };

  // 預先載入中文字體（NotoSansTC），啟用 subset 後僅嵌入用到的字符
  let cjkBytes: ArrayBuffer | null = null;
  try {
    cjkBytes = await loadCjkFontBytes();
    console.log(`✓ CJK font loaded (${(cjkBytes.byteLength / 1024 / 1024).toFixed(1)}MB)`);
  } catch (e) {
    console.warn("CJK font unavailable, Chinese characters may not render:", e);
  }

  // 1) 載入主文件
  console.log("Loading main template (P.1-P.8)...");
  const mainBytes = await fetchTemplate(TEMPLATES.main);
  const mainDoc = await PDFDocument.load(mainBytes);
  const mainFonts = await embedFontsForDoc(mainDoc, cjkBytes);
  fillMainDocument(mainDoc, ctx, mainFonts);

  // 2) 計算需要的續頁
  const isListedCo = data.companyType?.includes("上市") || data.companyType?.toLowerCase().includes("listed") || false;
  const validMembers = (data.shareholders || []).filter(sh => (Number(sh.shares) || 0) > 0);
  const naturalSecretaries = (data.secretaries || []).filter(s => s.identity === "natural");
  const corporateSecretaries = (data.secretaries || []).filter(s => s.identity === "corporate");
  const naturalDirectors = (data.directors || []).filter(d => d.identity === "natural");
  const corporateDirectors = (data.directors || []).filter(d => d.identity === "corporate");

  // 附加文件清單，順序：附表 1 → 附表 2 → 續頁 A → B → C → D
  const attachments: Array<{ url: string; fill: (doc: PDFDocument, fonts: Fonts) => void; label: string }> = [];

  // 附表 1：非上市公司，每頁 2 位股東
  if (!isListedCo && validMembers.length > 0) {
    const totalSch1 = Math.ceil(validMembers.length / 2);
    for (let i = 0; i < totalSch1; i++) {
      const slice = validMembers.slice(i * 2, i * 2 + 2);
      const pageNo = i + 1;
      attachments.push({
        url: TEMPLATES.schedule1,
        fill: (doc, f) => fillSchedule1(doc, ctx, slice, pageNo, totalSch1, f),
        label: `附表1-${pageNo}/${totalSch1}`,
      });
    }
  }

  // 附表 2：上市公司
  if (isListedCo) {
    attachments.push({
      url: TEMPLATES.schedule2,
      fill: (doc, f) => fillSchedule2(doc, ctx, f),
      label: "附表2",
    });
  }

  // 續頁 A：第二位起的自然人秘書
  for (let i = 1; i < naturalSecretaries.length; i++) {
    const sec = naturalSecretaries[i];
    attachments.push({
      url: TEMPLATES.sheetA,
      fill: (doc, f) => fillSheetA(doc, ctx, sec, f),
      label: `續頁A#${i}`,
    });
  }
  // 續頁 B：第二位起的法人秘書
  for (let i = 1; i < corporateSecretaries.length; i++) {
    const sec = corporateSecretaries[i];
    attachments.push({
      url: TEMPLATES.sheetB,
      fill: (doc, f) => fillSheetB(doc, ctx, sec, f),
      label: `續頁B#${i}`,
    });
  }
  // 續頁 C：第二位起的自然人董事
  for (let i = 1; i < naturalDirectors.length; i++) {
    const dir = naturalDirectors[i];
    attachments.push({
      url: TEMPLATES.sheetC,
      fill: (doc, f) => fillSheetC(doc, ctx, dir, f),
      label: `續頁C#${i}`,
    });
  }
  // 續頁 D：第二位起的法人董事，每頁可放 2 位
  const extraCorpDirs = corporateDirectors.slice(1);
  for (let i = 0; i < extraCorpDirs.length; i += 2) {
    const slice = extraCorpDirs.slice(i, i + 2);
    const pageNo = Math.floor(i / 2) + 1;
    attachments.push({
      url: TEMPLATES.sheetD,
      fill: (doc, f) => fillSheetD(doc, ctx, slice, f),
      label: `續頁D#${pageNo}(${slice.length}人)`,
    });
  }

  // 續頁 E：公司紀錄保存地點（如有提供任何一筆有效紀錄）
  const validRecords = (data.companyRecords || []).filter(
    r => (r.records && r.records.trim()) || (r.address && r.address.trim())
  );
  if (validRecords.length > 0) {
    attachments.push({
      url: TEMPLATES.sheetE,
      fill: (doc, f) => fillSheetE(doc, ctx, validRecords, f),
      label: `續頁E(${validRecords.length}筆)`,
    });
  }

  console.log(`Need ${attachments.length} attachment page(s): ${attachments.map(a => a.label).join(", ")}`);

  // 3) 載入並合併每張續頁
  // 為避免欄位名稱跨文件衝突，每張附加文件先 flatten() 再合入主文件
  // 同時快取每個模板的 ArrayBuffer，避免重複下載
  const templateCache = new Map<string, ArrayBuffer>();
  for (const att of attachments) {
    let bytes = templateCache.get(att.url);
    if (!bytes) {
      bytes = await fetchTemplate(att.url);
      templateCache.set(att.url, bytes);
    }
    // 為每次附加都 clone 一份新 doc
    const subDoc = await PDFDocument.load(bytes);
    const subFonts = await embedFontsForDoc(subDoc, cjkBytes);
    att.fill(subDoc, subFonts);
    // 填寫已直接畫到頁面內容，移除失效/重名 form annotations，避免覆蓋頁面造成空白。
    stripFormAnnotations(subDoc);
    // 把該文件所有頁面複製到主文件尾端
    const subPages = await mainDoc.copyPages(subDoc, subDoc.getPageIndices());
    for (const p of subPages) mainDoc.addPage(p);
    console.log(`✓ Appended ${att.label}`);
  }

  stripFormAnnotations(mainDoc);

  console.log("Serializing final PDF...");
  const finalBytes = await mainDoc.save({ updateFieldAppearances: false });
  console.log(`Final PDF: ${finalBytes.byteLength} bytes, ${mainDoc.getPageCount()} pages`);
  return finalBytes;
}

// === Debug 模式：在主文件上把每個 fill_X_P.Y 標上欄位編號 ===
async function buildDebugPdf(): Promise<Uint8Array> {
  const mainBytes = await fetchTemplate(TEMPLATES.main);
  const mainDoc = await PDFDocument.load(mainBytes);
  const form = mainDoc.getForm();
  for (const field of form.getFields()) {
    const name = field.getName();
    if (name.startsWith("fill_")) {
      try {
        const tf = form.getTextField(name);
        const m = name.match(/fill_(\d+)_P\.(\d+)/);
        const txt = m ? `${m[1]}.${m[2]}` : name.slice(0, 8);
        const max = tf.getMaxLength();
        tf.setText(max && txt.length > max ? (m ? m[1] : txt.slice(0, max)) : txt);
      } catch (_) {}
    } else if (name.startsWith("cb_")) {
      try { form.getCheckBox(name).check(); } catch (_) {}
    }
  }
  return await mainDoc.save();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const requestBody = await req.json();

    if (requestBody.listFields === true) {
      const fields = await listAllFormFields();
      return new Response(JSON.stringify(fields, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const debugMode = requestBody.debugMode === true;
    if (debugMode) {
      const bytes = await buildDebugPdf();
      return new Response(JSON.stringify({ pdf: uint8ToBase64(bytes) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyData: CompanyData = requestBody;
    console.log(`Generating NAR1 for: ${companyData.name} (BR: ${companyData.brNumber})`);
    const pdfBytes = await buildNAR1Pdf(companyData);

    return new Response(pdfBytes.buffer as ArrayBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="NAR1_${companyData.brNumber}_${Date.now()}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error generating PDF:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
