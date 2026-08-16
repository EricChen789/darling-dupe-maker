// POST /api/generate-nar1-pdf
// NAR1 — Annual Return
//
// 策略：使用 createFormHelpers + 跨文檔 copyPages 動態續頁
//   模板內建 /PMingLiU 字體（Type0, UniCNS-UTF16-H），不需另外嵌入 CJK 字體
//   只嵌入 Helvetica 用於 BR 蓋印，大幅節省 CPU
//   透過 NeedAppearances 讓 PDF 閱讀器用模板內建字體重建外觀流

import { PDFDocument, PDFBool, PDFName, PDFString, PDFHexString, PDFArray, PDFNumber, StandardFonts } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  corsHeaders, jsonResp, uint8ToBase64,
} from './_pdf-utils';
import {
  createFormHelpers, collectFormFields, detachWidget, rebuildAcroFormFields,
  buildCjkDA, buildHelvDA, isAscii, decodePdfText,
  type FormHelpers, type AcroFieldEntry,
} from './_acroform';

interface Env {
  PDF_TEMPLATES: R2Bucket;
  DB: D1Database;
  JWT_SECRET?: string;
}

interface OfficerData {
  nameChinese: string;
  nameEnglish: string;
  email: string;
  identity: 'natural' | 'corporate';
  isAlternate?: boolean;      // 候補董事 checkbox
  alternateTo?: string;       // 代替誰
  brNumber?: string;
  address?: string;
  serviceAddress?: string;
  idNumber?: string;
  dateAppointed?: string;
  placeIncorporated?: string;
  companyNumberRef?: string;
  tcspNumber?: string;
  passportNumber?: string;
  passportCountry?: string;
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
  companyEmail?: string;
  companyPhone?: string;
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
  incorporationDate?: string;
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
  signer?: {
    name?: string;
    role?: 'director' | 'secretary' | null;
  } | null;
  mortgageAmount?: string;
  continuationCounts?: {
    sheetA: number;
    sheetB: number;
    sheetC: number;
    sheetD: number;
    sched1: number;
  };
}

// ═══ 共用工具 ═══
const CJK_RE = /[㐀-鿿豈-﫿]/;

function computeReturnDate(incorporationDate?: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  if (incorporationDate) {
    let d: Date;
    if (incorporationDate.includes('/')) {
      const parts = incorporationDate.split('/');
      d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    } else {
      d = new Date(incorporationDate);
    }
    if (!isNaN(d.getTime())) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      let targetYear = currentYear;
      const candidate = new Date(targetYear, d.getMonth(), d.getDate());
      if (candidate < today) targetYear = currentYear + 1;
      return `${targetYear}-${mm}-${dd}`;
    }
  }
  return today.toISOString().split('T')[0];
}

/** Compute period start = returnDate minus 1 year */
function computePeriodStart(returnDate: string): string {
  const [y, m, d] = returnDate.split('-').map(Number);
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const PURE_NUMBER_RE = /^[\d,.\s]+$/;
const ADDR_FLAT_RE = /^(?:flat|room|rm|unit|shop|suite|ste|workshop|portion|all\s+that\s+portion|floor|fl|\d+\/f|g\/f|gf|lg\/f|ug\/f|m\/f|b\d*\/f)\b/i;
const ADDR_COUNTRY_RE = /(hong\s*kong|hk\b|china|prc|macau|macao|singapore|taiwan|united\s+\w+|british\s+virgin\s+islands|virgin\s+islands|b\.?\s*v\.?\s*i\.?|cayman\s+islands|\busa\b|\buk\b|canada|australia|japan|korea|h\.?k\.?\s*sar|香港|中國|澳門|台灣|新加坡|日本|韓國|英國|美國|加拿大|澳洲)/i;
const ADDR_DISTRICT_HINTS = /(kowloon|hong\s*kong|new\s*territories|n\.t\.|island|wan\s*chai|chai\s*wan|central|sheung\s*wan|tsim|mong\s*kok|sham\s*shui|kwun\s*tong|sha\s*tin|tai\s*po|tuen\s*mun|yuen\s*long|tsuen\s*wan|kwai\s*tsing|kwai\s*chung|sai\s*kung|north\s*district|southern\s*district|eastern\s*district|hung\s*hom|causeway\s*bay|quarry\s*bay|north\s*point|happy\s*valley|aberdeen|jordan|yau\s*ma\s*tei|tai\s*kok\s*tsui|to\s*kwa\s*wan|ho\s*man\s*tin|lai\s*chi\s*kok|mei\s*foo|tsing\s*yi|tseung\s*kwan\s*o|fan\s*ling|sheung\s*shui|tin\s*shui\s*wai|tung\s*chung|lantau|stanley|wong\s*tai\s*sin|lam\s*tin|kowloon\s*city|kowloon\s*bay|kowloon\s*tong|ma\s*on\s*shan|tai\s*wai|fo\s*tan|九龍|香港島|新界)/i;
/** 像街道/門牌號的段（以數字/No. 開頭或含道路類詞）— 不應被吞進「區」行 */
const ADDR_STREET_RE = /(^\s*no\.?\s*\d|^\d|[,-]\s*\d|\bstreet\b|\broad\b|\blane\b|\bavenue\b|\bdrive\b|\bcrescent\b|\bterrace\b|\bboulevard\b|\bpath\b|\bway\b)/i;
/** 大廈類詞 — 用來①區分行名裡的 district 詞（如 Central Tower 不吞進「區」行）②拆分 flat 段內嵌大廈名 */
const BUILDING_WORD_RE = /\b(buildings?|mansion|mansions|houses?|centre|center|tower|plaza|estate|gardens?|court|block|factory|villa|apartments?)\b/i;
/** flat 段拆分：室號部分 + 餘下（大廈名）— 處理 "Room 405 Tung Ning Building" 類 */
const ADDR_FLAT_SPLIT_RE = /^((?:flat|room|rm|unit|shop|suite|ste|workshop)\s*\S+(?:\s+\d+\/?f)?)(.*)$/i;

const fmtAmount = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("en-US");

const parseEnglishName = (fullName: string) => {
  let cleaned = (fullName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { surname: "", otherNames: "" };
  if (!/[A-Za-z]/.test(cleaned)) return { surname: "", otherNames: "" };
  if (CJK_RE.test(cleaned)) {
    cleaned = cleaned.replace(/[㐀-鿿豈-﫿]+/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) return { surname: "", otherNames: "" };
  }
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

const parseAddress = (addr: string) => {
  if (!addr) return { flat: '', building: '', street: '', district: '', country: '' };
  let parts = addr.split(',').map(s => s.trim()).filter(s => s && !PURE_NUMBER_RE.test(s));
  if (parts.length === 0) return { flat: '', building: '', street: '', district: '', country: '' };
  let country = '';
  if (ADDR_COUNTRY_RE.test(parts[parts.length - 1])) country = parts.pop()!;
  let district = '';
  // 末段像純區名才進「區」行；像街道/門牌（"88 Des Voeux Road Central"）或大廈名（"Central Tower"）不吞（用戶「移動一下」需求）
  if (parts.length > 1 && ADDR_DISTRICT_HINTS.test(parts[parts.length - 1])
      && !ADDR_STREET_RE.test(parts[parts.length - 1]) && !BUILDING_WORD_RE.test(parts[parts.length - 1])) {
    district = parts.pop()!;
  }
  const flatParts: string[] = [];
  while (parts.length > 0 && ADDR_FLAT_RE.test(parts[0])) flatParts.push(parts.shift()!);
  // 「Room 405 Tung Ning Building」類：flat 段內嵌大廈名 → 拆開（室行只留室號，大廈名進大廈行）
  let building = '';
  for (let i = flatParts.length - 1; i >= 0; i--) {
    const m = flatParts[i].match(ADDR_FLAT_SPLIT_RE);
    if (m && BUILDING_WORD_RE.test(m[2])) {
      building = m[2].replace(/^[,\s]+/, '').trim();
      flatParts[i] = m[1].trim();
      if (!flatParts[i]) flatParts.splice(i, 1);
      break;
    }
  }
  const flat = flatParts.join(', ');
  let street = '';
  if (parts.length === 0) {
    street = '';
  } else if (parts.length === 1 && !building && !BUILDING_WORD_RE.test(parts[0])
      && (ADDR_DISTRICT_HINTS.test(parts[0]) || ADDR_STREET_RE.test(parts[0]))) {
    // 單段且像區名或街道（如 "Kwai Chung" / "88 Des Voeux Road Central"）→ 街道行，別吞進大廈行
    street = parts[0];
  } else {
    if (!building) {
      // 「Tower 1, Harbour Centre」類：首段是 tower/block 等且次段也是大廈名 → 合併進大廈行
      if (parts.length >= 2 && BUILDING_WORD_RE.test(parts[0]) && BUILDING_WORD_RE.test(parts[1])
          && !ADDR_STREET_RE.test(parts[1]) && !ADDR_DISTRICT_HINTS.test(parts[1])) {
        building = parts.shift() + ', ' + parts.shift();
      } else {
        building = parts.shift() || '';
      }
    }
    street = parts.join(', ');
  }
  return { flat, building, street, district, country };
};

/** 董事通訊地址 5 行：優先董事自己的地址，缺項回退註冊辦事處（HK 慣例） */
const directorAddrRows = (dAddr: { flat: string; building: string; street: string; district: string; country: string }, office: any) => {
  const hasOwn = !!(dAddr.flat || dAddr.building || dAddr.street || dAddr.district || dAddr.country);
  return {
    flat: dAddr.flat || office.flat || '',
    building: dAddr.building || office.building || '',
    street: dAddr.street || office.street || '',
    district: dAddr.district || office.district || '',
    country: dAddr.country || (hasOwn ? 'Hong Kong' : (office.region || office.country || '')),
  };
};

const parseHkidPartial = (idNumber: string): string => {
  if (!idNumber) return "";
  return idNumber.replace(/[()\-\s]/g, "").toUpperCase().slice(0, 4);
};

const parsePassportPartial = (passportNumber: string): string => {
  if (!passportNumber) return "";
  const cleaned = passportNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return cleaned.slice(0, Math.ceil(cleaned.length / 2));
};

// ═══ AP Stream Generator (from NN1 v9) ═══
// Generates explicit Appearance stream using page's internal font names.
// C2_1 = PMingLiU (CJK), Helv = Helvetica (ASCII).
// No Resources dict — font resolution inherits from page Resources.

function setWidgetApV9(
  ctx: any,
  widget: any,
  value: string,
  isCjk: boolean,
  fontSize: number = 10,
): void {
  const fontName = isCjk ? "C2_1" : "Helv";

  let textOp: string;
  if (isCjk) {
    let hex = 'FEFF'; // UTF-16BE BOM
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
        const lo = value.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          const cp = 0x10000 + (code - 0xD800) * 0x400 + (lo - 0xDC00);
          hex += cp.toString(16).padStart(8, '0').toUpperCase();
          i++;
          continue;
        }
      }
      hex += (code >> 8).toString(16).padStart(2, '0').toUpperCase();
      hex += (code & 0xFF).toString(16).padStart(2, '0').toUpperCase();
    }
    textOp = `<${hex}> Tj`;
  } else {
    const escaped = value.replace(/([()\\])/g, '\\$1');
    textOp = `(${escaped}) Tj`;
  }

  const apContent = `/${fontName} ${fontSize} Tf\n0 g\nBT\n2 2 Td\n${textOp}\nET`;

  const bbox = PDFArray.withContext(ctx);
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(1000));
  bbox.push(PDFNumber.of(1000));

  const dict = ctx.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  dict.set(PDFName.of('BBox'), bbox);

  const apStream = ctx.stream(new TextEncoder().encode(apContent), dict);
  const apRef = ctx.register(apStream);

  const apDict = ctx.obj({});
  apDict.set(PDFName.of('N'), apRef);
  widget.set(PDFName.of('AP'), apDict);

  if (isCjk) {
    widget.set(PDFName.of('V'), PDFHexString.fromText(value));
  } else {
    widget.set(PDFName.of('V'), PDFString.of(value));
  }

  widget.set(PDFName.of('DA'), PDFString.of(`/${fontName} ${fontSize} Tf 0 g`));
}

/** Generate AP streams for ALL filled text widgets across all pages.
 *  Called after all setF()/addDynamicContinuationSheet calls.
 *  This replaces the unreliable delete-AP + NeedAppearances approach. */
function generateAllApStreams(pdfDoc: PDFDocument): void {
  const ctx = (pdfDoc as any).context;
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots')) as any;
    if (!annots || typeof annots.size !== 'function') continue;
    for (let i = 0; i < annots.size(); i++) {
      try {
        const widget = ctx.lookup(annots.get(i)) as any;
        if (!widget || String(widget.get(PDFName.of('Subtype'))) !== '/Widget') continue;
        const ft = widget.get(PDFName.of('FT'));
        if (!ft || String(ft) !== '/Tx') continue;
        const v = widget.get(PDFName.of('V'));
        if (!v) continue;
        const value = typeof v.decodeText === 'function' ? v.decodeText() : String(v).replace(/^\((.*)\)$/s, '$1');
        if (!value) continue;
        const isCjk = !isAscii(value);
        // Use fontSize from existing /DA (preserve original field font size)
        const da = widget.get(PDFName.of('DA'));
        const daStr = da ? (typeof da.decodeText === 'function' ? da.decodeText() : String(da)) : '';
        const m = daStr.match(/(\d+(?:\.\d+)?)\s+Tf/);
        const fontSize = (m && parseFloat(m[1]) > 0) ? parseFloat(m[1]) : 10;
        setWidgetApV9(ctx, widget, value, isCjk, fontSize);
      } catch { /* skip */ }
    }
  }
}

// ═══ Dynamic Continuation Page Helper ═══
// Copies a template page into the main doc, detaches all widgets,
// renames them with a suffix, and sets their values.
// Returns the index of the newly inserted page.

interface ContinuationSlot {
  fieldNames: string[];   // original field names on this page (e.g., ["fill_5_P11","fill_6_P11",...])
  values: Record<string, string>;  // originalName → value
  checkboxes?: string[];  // checkbox names to check
}

async function addDynamicContinuationSheet(
  pdfDoc: PDFDocument,
  templateBytes: Uint8Array,
  sourcePageIndex: number,
  insertAfterIndex: number,
  slot: ContinuationSlot,
  suffix: string,
): Promise<number> {
  // 1) Load fresh template and copy the page
  const freshDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const [copiedPage] = await pdfDoc.copyPages(freshDoc, [sourcePageIndex]);
  const newIndex = insertAfterIndex + 1;
  pdfDoc.insertPage(newIndex, copiedPage);

  // 2) Process widgets on the copied page
  const ctx = (pdfDoc as any).context;
  const annots = copiedPage.node.lookup(PDFName.of('Annots')) as any;
  if (!annots || typeof annots.size !== 'function') return newIndex;

  let widgetCount = 0;
  let matchCount = 0;
  let failCount = 0;

  // Build alias maps: collectFormFields normalizes _P.13 ↔ _P13, but this
  // function does raw name matching. Without aliases, widgets on dynamic
  // pages won't match and remain blank (Bug 3: 續頁C blank pages).
  const aliasValues: Record<string, string> = { ...slot.values };
  const aliasCheckboxes: string[] = [...(slot.checkboxes || [])];
  for (const [key, val] of Object.entries(slot.values)) {
    const noDot = key.replace(/_P\.(\d+)$/g, '_P$1');
    const withDot = key.replace(/_P(\d+)$/g, '_P.$1');
    if (noDot !== key) aliasValues[noDot] = val;
    if (withDot !== key) aliasValues[withDot] = val;
  }
  for (const cb of (slot.checkboxes || [])) {
    const noDot = cb.replace(/_P\.(\d+)$/g, '_P$1');
    const withDot = cb.replace(/_P(\d+)$/g, '_P.$1');
    if (noDot !== cb) aliasCheckboxes.push(noDot);
    if (withDot !== cb) aliasCheckboxes.push(withDot);
  }
  const allFieldNames = Object.keys(aliasValues);

  for (let i = 0; i < annots.size(); i++) {
    try {
      const widget = ctx.lookup(annots.get(i)) as any;
      if (!widget || typeof widget.get !== 'function') continue;
      const subtype = widget.get(PDFName.of('Subtype'));
      if (!subtype || String(subtype) !== '/Widget') continue;
      widgetCount++;

      // ⚠️  After pdf-lib copyPages, widget Parent refs may be broken
      // (point to objects that weren't copied into the destination doc).
      // ctx.lookup() on a broken ref THROWS → silently caught by outer
      // try-catch → widget skipped → template sample data persists.
      // Fix: guard every lookup so a broken parent doesn't take down the widget.
      const widgetName = decodePdfText(widget.get(PDFName.of('T')));
      const parentRef = widget.get(PDFName.of('Parent'));
      let parent = widget;
      let parentName = '';
      if (parentRef) {
        try { parent = ctx.lookup(parentRef) as any; } catch { parent = widget; }
        try { parentName = decodePdfText(parent.get(PDFName.of('T'))); } catch { parentName = ''; }
      }
      // Handle 3-level field hierarchy (matching collectFormFields)
      let resolvedName = parentName || widgetName;
      if (parent && parent !== widget) {
        const grandParentRef = parent.get?.(PDFName.of('Parent'));
        if (grandParentRef) {
          try {
            const grandParent = ctx.lookup(grandParentRef) as any;
            const gpName = decodePdfText(grandParent.get(PDFName.of('T')));
            if (gpName) resolvedName = gpName;
          } catch { /* skip */ }
        }
      }
      // Fallback: if resolvedName is still empty/meaningless, try widgetName directly
      if (!resolvedName || /^\d+$/.test(resolvedName)) {
        resolvedName = widgetName || resolvedName;
      }

      // Find the matching key in our fieldNames (resolvedName is the parent-level
      // name like "fill_8_P", but aliasValues keys are full names like "fill_8_P.13"
      // or dot/no-dot aliases like "fill_8_P13").
      const matchedTextKey = allFieldNames.find(fn =>
        resolvedName === fn || resolvedName.startsWith(fn) || fn.startsWith(resolvedName)
      );
      const isCheckbox = aliasCheckboxes.some(cb =>
        resolvedName === cb || resolvedName.startsWith(cb) || cb.startsWith(resolvedName)
      );

      if (!matchedTextKey && !isCheckbox) continue;

      matchCount++;

      // Detach + rename
      detachWidget(widget, parent);
      const newName = `${resolvedName}_${suffix}`;
      widget.set(PDFName.of('T'), PDFString.of(newName));

      // Check if this is a checkbox or text field
      const ft = widget.get(PDFName.of('FT'));
      const ftStr = ft ? String(ft) : '';

      if (ftStr === '/Btn' && isCheckbox) {
        // Checkbox: set both /V and /AS — match _acroform.ts ND2A pattern
        let onState = 'Yes';
        try {
          const ap = widget.get(PDFName.of('AP')) as any;
          const apN = ap?.get?.(PDFName.of('N')) as any;
          const dict = apN?.dict;
          if (dict && typeof dict.keys === 'function') {
            for (const k of dict.keys()) {
              const kStr: string = (typeof k === 'string') ? k :
                (typeof k.decodeText === 'function') ? k.decodeText() :
                String(k).replace(/^\//, '');
              if (kStr !== 'Off') { onState = kStr; break; }
            }
          }
        } catch { /* fallback to "Yes" */ }
        widget.set(PDFName.of('V'), PDFName.of(onState));
        widget.set(PDFName.of('AS'), PDFName.of(onState));
      } else if (ftStr === '/Tx') {
        // Text field: look up value using the matched key (Bug fix: resolvedName
        // is the parent-level name like "fill_8_P" which doesn't exist as a key
        // in aliasValues — only the full names like "fill_8_P.13" do).
        const value = (matchedTextKey ? aliasValues[matchedTextKey] : '') || '';
        // Always process matched fields — even if value is empty, we must
        // clear template sample data that would otherwise persist (Bug: 續頁C
        // dynamic pages showing wrong names).
        if (value.length === 0) {
          // Clear: set empty V, delete AP so generateAllApStreams won't render stale content
          widget.set(PDFName.of('V'), PDFString.of(''));
          widget.delete(PDFName.of('AP'));
          continue;
        }

        const da = decodePdfText(widget.get(PDFName.of('DA'))) || '/Helv 12 Tf 0 g';
        if (!isAscii(value)) {
          widget.set(PDFName.of('DA'), PDFString.of(buildCjkDA(da)));
          widget.set(PDFName.of('V'), PDFHexString.fromText(value));
        } else {
          widget.set(PDFName.of('DA'), PDFString.of(buildHelvDA(da)));
          widget.set(PDFName.of('V'), PDFString.of(value));
        }
        widget.delete(PDFName.of('AP'));
      }
    } catch { failCount++; /* skip malformed widget */ }
  }

  console.log(`[addDynamicContinuationSheet] page=${sourcePageIndex} suffix=${suffix} widgets=${widgetCount} matched=${matchCount} failed=${failCount} fieldNames=${slot.fieldNames.length}`);
  return newIndex;
}

// ═══ Main build function ═══
export async function buildNAR1Pdf(data: CompanyData, env: Env): Promise<Uint8Array> {
  // 1) Load template
  const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
  const templateObj = await r2Bucket.get("NAR1-template.pdf");
  if (!templateObj) throw new Error("Template not found: NAR1-template.pdf");

  const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
  const pdfDoc = await PDFDocument.load(templateBytes);
  // Capture original template pages BEFORE any dynamic insertion — page-removal
  // indices would drift once dynamic pages are inserted mid-document.
  const originalTemplatePages = pdfDoc.getPages();

  // 2) Embed Helvetica for BR stamp
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helpers = createFormHelpers(pdfDoc);
  const setF = (name: string, value?: string) => {
    if (value == null || value === "") return;
    helpers.setText(name, String(value));
  };
  const checkF = (name: string, shouldCheck?: boolean) => {
    if (!shouldCheck) return;
    helpers.check(name, true);
  };
  const selectDD = (name: string, value: string) => {
    if (!value) return;
    helpers.selectDropdown(name, value);
  };

  // 3) Prepare data
  const returnDate = data.returnDate || computeReturnDate(data.incorporationDate);
  const periodStart = computePeriodStart(returnDate);
  const [year, month, day] = returnDate.split("-");
  const [psYear, psMonth, psDay] = periodStart.split("-");
  const office = data.registeredOffice || {};
  if (!office.region && !(office as any).country) {
    const hasAddr = !!(office.flat || office.building || office.street || office.district);
    if (hasAddr) (office as any).region = 'Hong Kong';
  }
  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);
  const companyType = data.companyType || '';
  const ctLower = companyType.toLowerCase();
  const isListedCo = companyType.includes("上市") || ctLower.includes("listed");

  // ═══ P.1 ═══
  setF("fill_1_P.1", br8);
  const fullCompanyName = [data.name, data.chineseName].filter(Boolean).join("\n");
  setF("fill_2_P.1", fullCompanyName);
  setF("fill_3_P.1", data.tradingName || "");
  checkF("cb_1_P.1", companyType.includes("私人") || ctLower.includes("private"));
  checkF("cb_2_P.1", companyType.includes("公眾") || ctLower.includes("public"));
  checkF("cb_3_P.1", companyType.includes("擔保"));
  setF("fill_4_P.1", data.businessCode || "");
  setF("fill_5_P.1", data.businessNature || "");
  setF("fill_6_P.1", day);
  setF("fill_7_P.1", month);
  setF("fill_8_P.1", year);
  // Return period dates (fill_9-14_P.1 = start/end DD/MM/YYYY)
  setF("fill_9_P.1", psDay);
  setF("fill_10_P.1", psMonth);
  setF("fill_11_P.1", psYear);
  setF("fill_12_P.1", day);
  setF("fill_13_P.1", month);
  setF("fill_14_P.1", year);
  setF("fill_15_P.1", office.flat || "");
  setF("fill_16_P.1", office.building || "");
  setF("fill_17_P.1", office.street || "");
  setF("fill_18_P.1", office.district || "");
  const p1Region = office.region || (office as any).country || '';
  if (p1Region) { try { selectDD("Dropdown1_P.1", p1Region); } catch { try { selectDD("Dropdown_1_P.1", p1Region); } catch { /* */ } } }

  const presenterP1 = data.presenter || {};
  if (presenterP1.name) setF("fill_19_P.1", presenterP1.name);
  if (presenterP1.address) setF("fill_20_P.1", presenterP1.address);
  if (presenterP1.phone) setF("fill_21_P.1", presenterP1.phone);
  if (presenterP1.fax) setF("fill_22_P.1", presenterP1.fax);
  if (presenterP1.email) setF("fill_23_P.1", presenterP1.email);
  if (presenterP1.reference) setF("fill_24_P.1", presenterP1.reference);

  // P.1 presenter font size override
  const presenterFontFields = new Set(['fill_21_P.1', 'fill_22_P.1', 'fill_23_P.1', 'fill_24_P.1']);
  const ctx = (pdfDoc as any).context;
  const page1 = pdfDoc.getPages()[0];
  const annots1 = page1.node.lookup(PDFName.of('Annots')) as any;
  if (annots1 && typeof annots1.size === 'function') {
    for (let i = 0; i < annots1.size(); i++) {
      try {
        const widget = ctx.lookup(annots1.get(i)) as any;
        if (!widget || String(widget.get(PDFName.of('Subtype'))) !== '/Widget') continue;
        const ft = widget.get(PDFName.of('FT'));
        if (!ft || String(ft) !== '/Tx') continue;
        let fieldName = '';
        const parentRef = widget.get(PDFName.of('Parent'));
        if (parentRef) {
          try { const pT = (ctx.lookup(parentRef) as any)?.get?.(PDFName.of('T')); if (pT instanceof PDFString) fieldName = pT.decodeText(); } catch { /* */ }
        }
        if (!presenterFontFields.has(fieldName)) continue;
        widget.set(PDFName.of('DA'), PDFString.of('/PMingLiU 9 Tf 0 g'));
      } catch { /* */ }
    }
  }

  // ═══ Share capital summary ═══
  const normalizeClassName = (raw: string) => {
    const t = (raw || "").trim();
    if (!t || /^ord(inary)?$/i.test(t) || t.includes("普通")) return "ORDINARY SHARES";
    if (/^pref(erence)?$/i.test(t) || t.includes("優先")) return "PREFERENCE SHARES";
    return t.toUpperCase();
  };
  const formatCurrency = (raw: string) => {
    const c = (raw || "HKD").trim().toUpperCase();
    if (c === "HKD" || c === "HK$") return "HKD";
    if (c === "USD" || c === "US$") return "USD";
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
    info.shares += toNum(sh.shares);
    info.paidUp += toNum(sh.paidUp);
    info.unpaid += toNum(sh.unpaid);
  }
  const shareInfos = Array.from(shareTypeMap.values());

  // Total across ALL share classes (used by Schedule 1 header)
  const totalAllShares = shareInfos.reduce((s, info) => s + info.shares, 0);
  const allClassNames = shareInfos.map(info => info.className).join(' / ');

  // ═══ P.2 ═══
  setF("fill_1_P.2", br8);
  if (data.companyEmail) setF("fill_2_P.2", data.companyEmail);
  if (data.companyPhone) setF("fill_3_P.2", data.companyPhone);

  // Mortgage amount
  if (data.mortgageAmount) setF("fill_4_P.2", data.mortgageAmount);

  let totalShares = 0, totalAmountSum = 0, totalPaidUpSum = 0, totalUnpaidSum = 0, firstCurrency = "";
  for (let i = 0; i < Math.min(4, shareInfos.length); i++) {
    const info = shareInfos[i];
    const base = 6 + i * 5;
    // 總款額 = 股數 × 每股價格
    const totalAmount = info.issuePrice != null ? info.issuePrice * info.shares : 0;
    setF(`fill_${base}_P.2`, info.className);
    setF(`fill_${base + 1}_P.2`, info.currency);
    setF(`fill_${base + 2}_P.2`, fmtInt(info.shares));
    if (info.shares > 0) {
      setF(`fill_${base + 3}_P.2`, fmtAmount(totalAmount));
      // Paid-up field: show paid-up, append unpaid if any
      const paidUpStr = fmtAmount(info.paidUp);
      const unpaidStr = info.unpaid > 0 ? fmtAmount(info.unpaid) : '';
      setF(`fill_${base + 4}_P.2`, unpaidStr ? `${paidUpStr}(未缴${unpaidStr})` : paidUpStr);
    }
    totalShares += info.shares;
    totalAmountSum += totalAmount;
    totalPaidUpSum += info.paidUp || 0;
    totalUnpaidSum += info.unpaid || 0;
    if (!firstCurrency) firstCurrency = info.currency;
  }
  if (shareInfos.length > 0) {
    setF("fill_26_P.2", firstCurrency);
    setF("fill_27_P.2", fmtInt(totalShares));
    setF("fill_28_P.2", fmtAmount(totalAmountSum));
    setF("fill_29_P.2", totalUnpaidSum > 0
      ? `${fmtAmount(totalPaidUpSum)}(未缴${fmtAmount(totalUnpaidSum)})`
      : fmtAmount(totalPaidUpSum));
  }

  const secretaries = data.secretaries || [];
  const directors = data.directors || [];
  const shareholders = data.shareholders || [];
  const natSecs = secretaries.filter(s => s.identity === "natural");
  const corpSecs = secretaries.filter(s => s.identity === "corporate");
  const natDirs = directors.filter(d => d.identity === "natural");
  const corpDirs = directors.filter(d => d.identity === "corporate");
  const validMembers = shareholders.filter(sh => toNum(sh.shares) > 0);

  // ═══ P.3 自然人秘書 ═══
  setF("fill_1_P.3", br8);
  if (natSecs.length > 0) {
    const s = natSecs[0];
    const { surname, otherNames } = parseEnglishName(s.nameEnglish);
    setF("fill_2_P.3", s.nameChinese || "");
    setF("fill_3_P.3", surname);
    setF("fill_4_P.3", otherNames);
    const addr = parseAddress(s.address || '');
    setF("fill_9_P.3", addr.flat);
    setF("fill_10_P.3", addr.building);
    setF("fill_11_P.3", addr.street);
    setF("fill_12_P.3", addr.district);
    setF("fill_13_P.3", s.email || "");
    const hkid = parseHkidPartial(s.idNumber || '');
    if (hkid) setF("fill_14_P.3", hkid);
    if ((s as any).passportCountry) setF("fill_15_P.3", (s as any).passportCountry);
    if (s.passportNumber) setF("fill_16_P.3", parsePassportPartial(s.passportNumber));
  }

  // ═══ P.4 法人秘書 ═══
  setF("fill_1_P.4", br8);
  if (corpSecs.length > 0) {
    const s = corpSecs[0];
    setF("fill_2_P.4", s.nameChinese || "");
    setF("fill_3_P.4", s.nameEnglish || "");
    const addr = parseAddress(s.serviceAddress || s.address || '');
    setF("fill_4_P.4", addr.flat);
    setF("fill_5_P.4", addr.building);
    setF("fill_6_P.4", addr.street);
    setF("fill_7_P.4", addr.district);
    setF("fill_8_P.4", s.email || "");
    setF("fill_9_P.4", s.companyNumberRef || s.brNumber || s.idNumber || "");
    const tcsp = s.tcspNumber || (s as any).licenceNumber || "";
    if (tcsp) setF("fill_10_P.4", tcsp);
  }

  // ═══ P.5 自然人董事 ═══
  setF("fill_1_P.5", br8);
  if (natDirs.length > 0) {
    const d = natDirs[0];
    checkF("cb_1_P.5", !d.isAlternate);
    checkF("cb_2_P.5", !!d.isAlternate);
    const { surname, otherNames } = parseEnglishName(d.nameEnglish);
    setF("fill_3_P.5", d.nameChinese || "");
    setF("fill_4_P.5", surname);
    setF("fill_5_P.5", otherNames);
    const dr = directorAddrRows(parseAddress(d.address || ''), office);
    setF("fill_10_P.5", dr.flat);
    setF("fill_11_P.5", dr.building);
    setF("fill_12_P.5", dr.street);
    setF("fill_13_P.5", dr.district);
    setF("fill_14_P.5", dr.country);
    setF("fill_15_P.5", d.email || "");
    const hkid = parseHkidPartial(d.idNumber || '');
    if (hkid) setF("fill_16_P.5", hkid);
    if ((d as any).passportCountry || d.nationality) setF("fill_17_P.5", (d as any).passportCountry || d.nationality || '');
    if (d.passportNumber) setF("fill_18_P.5", parsePassportPartial(d.passportNumber));
  }

  // ═══ P.6 法人董事 ═══
  setF("fill_1_P.6", br8);
  if (corpDirs.length > 0) {
    const d = corpDirs[0];
    checkF("cb_1_P.6", true);
    setF("fill_3_P.6", d.nameChinese || "");
    setF("fill_4_P.6", d.nameEnglish || "");
    setF("fill_5_P.6", office.flat || "");
    setF("fill_6_P.6", office.building || "");
    setF("fill_7_P.6", office.street || "");
    setF("fill_8_P.6", office.district || "");
    setF("fill_9_P.6", office.region || (office as any).country || "");
    setF("fill_10_P.6", d.email || "");
    setF("fill_11_P.6", d.companyNumberRef || d.brNumber || d.idNumber || "");
  }
  // TODO: 千问 VL 确认 P.6 是否有第 2 个法人董事 slot
  // 如有 (如 fill_13_P.6 ~ fill_21_P.6), 在此填入 corpDirs[1]

  // ═══ P.7 ═══
  setF("fill_1_P.7", br8);

  // ═══ P.8 總結 + 簽署 ═══
  setF("fill_1_P.8", br8);
  checkF("cb_1_P.8", true);
  // 14. 成員詳情第3個方框（CD-ROM/DVD-ROM）按用戶要求一併勾選
  checkF("cb_3_P.8", true);
  if (!isListedCo) checkF("cb_4_P.8", true);

  // Calculate continuation counts
  // These counts include BOTH pre-built continuation pages AND dynamic ones.
  // sheetA/B/C: each person beyond P.3/P.4/P.5 needs 1 page (pre-built P.11/12/13 = 1st extra)
  // sheetD: P.6 holds 1 corp dir, P.14 holds 2 corp dirs → beyond 1st = ceil((n-1)/2)
  // sched1: P.9 holds 2 members, P.10 holds 2 members → ceil(n/2) total pages
  // Always calculate continuation counts from actual data arrays.
  // Do NOT use data.continuationCounts from frontend — the definitions
  // differ (frontend sched1 = extra pages, backend sched1 = total pages).
  const sheetA = Math.max(0, natSecs.length - 1);
  const sheetB = Math.max(0, corpSecs.length - 1);
  const sheetC = Math.max(0, natDirs.length - 1);
  const sheetD = corpDirs.length > 1 ? Math.ceil((corpDirs.length - 1) / 2) : 0;
  const sched1Pages = isListedCo ? 0 : (validMembers.length > 0 ? Math.ceil(validMembers.length / 2) : 0);
  const sched2Pages = isListedCo ? 1 : 0;

  if (sheetA > 0) setF("fill_4_P.8", String(sheetA));
  if (sheetB > 0) setF("fill_5_P.8", String(sheetB));
  if (sheetC > 0) setF("fill_6_P.8", String(sheetC));
  if (sheetD > 0) setF("fill_7_P.8", String(sheetD));
  if (sched1Pages > 0) setF("fill_9_P.8", String(sched1Pages));
  if (sched2Pages > 0) setF("fill_10_P.8", String(sched2Pages));

  const signer = data.signer;
  const signerName = signer?.name || presenterP1.name || "";
  const signerRole = signer?.role || null;
  if (signerName) setF("fill_11_P.8", signerName);
  if (day && month && year) setF("fill_12_P.8", `${day}/${month}/${year}`);

  // P.8 簽署人劃線
  if (signerRole === 'secretary' || signerRole === 'director') {
    try {
      const page8 = pdfDoc.getPage(7);
      const yLine = 91;
      if (signerRole === 'secretary') {
        page8.drawLine({ start: { x: 143, y: yLine }, end: { x: 205, y: yLine }, thickness: 1.2 });
      } else {
        page8.drawLine({ start: { x: 209, y: yLine }, end: { x: 343, y: yLine }, thickness: 1.2 });
      }
    } catch { /* skip */ }
  }

  let hasDynamicPages = false;

  // ═══ Pre-built pages: P.9 Schedule 1 (shareholders #1+#2) ═══
  if (validMembers.length > 0 && !isListedCo) {
    setF("fill_1_P.9", day);
    setF("fill_2_P.9", month);
    setF("fill_3_P.9", year);
    setF("fill_4_P.9", br8);
    if (shareInfos.length > 0) {
      setF("fill_5_P.9", allClassNames);
      setF("fill_6_P.9", fmtInt(totalAllShares));
    }

    const slotsP9 = [
      { name: 7, surname: 8, other: 9, shares: 16, flat: 11, building: 12, street: 13, district: 14, country: 15 },
      { name: 18, surname: 19, other: 20, shares: 27, flat: 22, building: 23, street: 24, district: 25, country: 26 },
    ];
    for (let idx = 0; idx < Math.min(2, validMembers.length); idx++) {
      const sh = validMembers[idx];
      const F = slotsP9[idx];
      const isCorp = sh.identity === "corporate";
      const fullName = sh.nameEnglish || sh.name || "";
      const { surname, otherNames } = parseEnglishName(fullName);
      const addr = parseAddress(sh.address || "");
      const safe = (v: string) => (v && PURE_NUMBER_RE.test(v) ? "" : v);
      const country = safe(addr.country) || "Hong Kong";

      setF(`fill_${F.name}_P.9`, sh.nameChinese || "");
      if (isCorp) {
        setF(`fill_${F.surname}_P.9`, fullName);
      } else {
        setF(`fill_${F.surname}_P.9`, surname);
        setF(`fill_${F.other}_P.9`, otherNames);
      }
      const sharesNum = Number(sh.shares) || 0;
      setF(`fill_${F.shares}_P.9`, sharesNum > 0 ? fmtInt(sharesNum) : "0");
      setF(`fill_${F.flat}_P.9`, safe(addr.flat));
      setF(`fill_${F.building}_P.9`, safe(addr.building));
      setF(`fill_${F.street}_P.9`, safe(addr.street));
      setF(`fill_${F.district}_P.9`, safe(addr.district));
      setF(`fill_${F.country}_P.9`, country);
    }
    setF("fill_29_P.9", "1");
    setF("fill_30_P.9", String(sched1Pages));
  }

  // ═══ 附表一第2+頁：成員3+（非上市）═══
  // 官方表格規定「如超過兩名成員，可另加附表一」—— 必須用附表一(idx 8)副本，
  // 不能用附表二(idx 9)：其標題「上市公司適用」+ 百分比欄 + 室/大廈窄框均不適用非上市公司。
  // 插入位置：緊跟附表一第1頁（模板 idx 8）之後。
  if (validMembers.length > 2 && !isListedCo) {
    let schedInsertAfter = 8;  // 附表一第1頁（模板 idx 8）的索引
    for (let si = 2; si < validMembers.length; si += 2) {
      const suffix = `dynS1_${si}`;
      const sh1 = validMembers[si];
      const sh2 = validMembers[si + 1];

      const values: Record<string, string> = {};
      const setV = (k: string, v: string) => { values[k] = v || ''; };
      setV("fill_1_P.9", day);
      setV("fill_2_P.9", month);
      setV("fill_3_P.9", year);
      setV("fill_4_P.9", br8);
      if (shareInfos.length > 0) {
        setV("fill_5_P.9", allClassNames);
        setV("fill_6_P.9", fmtInt(totalAllShares));
      }

      const slots = [
        { name: 7, surname: 8, other: 9, shares: 16, flat: 11, building: 12, street: 13, district: 14, country: 15 },
        { name: 18, surname: 19, other: 20, shares: 27, flat: 22, building: 23, street: 24, district: 25, country: 26 },
      ];

      [sh1, sh2].forEach((sh, idx) => {
        if (!sh) return;
        const F = slots[idx];
        const isCorp = sh.identity === "corporate";
        const fullName = sh.nameEnglish || sh.name || "";
        const { surname, otherNames } = parseEnglishName(fullName);
        const addr = parseAddress(sh.address || "");
        const safe = (v: string) => (v && PURE_NUMBER_RE.test(v) ? "" : v);
        const country = safe(addr.country) || "Hong Kong";

        setV(`fill_${F.name}_P.9`, sh.nameChinese || "");
        if (isCorp) {
          setV(`fill_${F.surname}_P.9`, fullName);
        } else {
          setV(`fill_${F.surname}_P.9`, surname);
          setV(`fill_${F.other}_P.9`, otherNames);
        }
        const sharesNum = Number(sh.shares) || 0;
        setV(`fill_${F.shares}_P.9`, sharesNum > 0 ? fmtInt(sharesNum) : "0");
        setV(`fill_${F.flat}_P.9`, safe(addr.flat));
        setV(`fill_${F.building}_P.9`, safe(addr.building));
        setV(`fill_${F.street}_P.9`, safe(addr.street));
        setV(`fill_${F.district}_P.9`, safe(addr.district));
        setV(`fill_${F.country}_P.9`, country);
      });

      setV("fill_29_P.9", String(Math.floor(si / 2) + 1));
      setV("fill_30_P.9", String(sched1Pages));

      const slot: ContinuationSlot = { fieldNames: Object.keys(values), values };
      schedInsertAfter = await addDynamicContinuationSheet(pdfDoc, templateBytes, 8, schedInsertAfter, slot, suffix);
      hasDynamicPages = true;
    }
  } else if (isListedCo) {
    // ═══ Pre-built: P.10 附表二 (上市公司: 類別/總數 header) ═══
    setF("fill_1_P.10", day);
    setF("fill_2_P.10", month);
    setF("fill_3_P.10", year);
    setF("fill_4_P.10", br8);
    if (shareInfos.length > 0) {
      setF("fill_5_P.10", allClassNames);
      setF("fill_6_P.10", fmtInt(totalAllShares));
    }
    setF("fill_31_P.10", "1");
    setF("fill_32_P.10", "1");
  }

  // ═══ Pre-built: P.11 續頁A (nat sec #2) ═══
  if (natSecs.length > 1) {
    const s = natSecs[1];
    setF("fill_1_P11", day);
    setF("fill_2_P11", month);
    setF("fill_3_P11", year);
    setF("fill_4_P11", br8);
    const { surname, otherNames } = parseEnglishName(s.nameEnglish);
    setF("fill_5_P11", s.nameChinese || "");
    setF("fill_6_P11", surname);
    setF("fill_7_P11", otherNames);
    const addr = parseAddress(s.address || '');
    setF("fill_12_P11", addr.flat);
    setF("fill_13_P11", addr.building);
    setF("fill_14_P11", addr.street);
    setF("fill_15_P11", addr.district);
    setF("fill_16_P11", s.email || "");
    const hkid = parseHkidPartial(s.idNumber || '');
    if (hkid) setF("fill_17_P11", hkid);
    if ((s as any).passportCountry) setF("fill_18_P11", (s as any).passportCountry);
    if (s.passportNumber) setF("fill_19_P11", parsePassportPartial(s.passportNumber));
    if (s.tcspNumber) setF("fill_20_P11", s.tcspNumber);
  }

  // ═══ Pre-built: P.12 續頁B (corp sec #2) ═══
  if (corpSecs.length > 1) {
    const s = corpSecs[1];
    setF("fill_1_P12", day);
    setF("fill_2_P12", month);
    setF("fill_3_P12", year);
    setF("fill_4_P12", br8);
    setF("fill_5_P12", s.nameChinese || "");
    setF("fill_6_P12", s.nameEnglish || "");
    const addr = parseAddress(s.address || '');
    setF("fill_7_P12", addr.flat);
    setF("fill_8_P12", addr.building);
    setF("fill_9_P12", addr.street);
    setF("fill_10_P12", addr.district);
    setF("fill_11_P12", s.email || "");
    setF("fill_12_P12", s.companyNumberRef || s.brNumber || s.idNumber || "");
    if (s.tcspNumber) setF("fill_13_P12", s.tcspNumber);
  }

  // ═══ Pre-built: P.13 續頁C (nat dir #2) ═══
  if (natDirs.length > 1) {
    const d = natDirs[1];
    setF("fill_1_P.13", day);
    setF("fill_2_P.13", month);
    setF("fill_3_P.13", year);
    setF("fill_4_P.13", br8);
    checkF("cb_1_P.13", !d.isAlternate);
    checkF("cb_2_P.13", !!d.isAlternate);
    const { surname, otherNames } = parseEnglishName(d.nameEnglish);
    setF("fill_6_P.13", d.nameChinese || "");
    setF("fill_7_P.13", surname);
    setF("fill_8_P.13", otherNames);
    const dr = directorAddrRows(parseAddress(d.address || ''), office);
    setF("fill_13_P.13", dr.flat);
    setF("fill_14_P.13", dr.building);
    setF("fill_15_P.13", dr.street);
    setF("fill_16_P.13", dr.district);
    setF("fill_17_P.13", dr.country);
    setF("fill_18_P.13", d.email || "");
    const hkid = parseHkidPartial(d.idNumber || '');
    if (hkid) setF("fill_19_P.13", hkid);
    if ((d as any).passportCountry || d.nationality) setF("fill_20_P.13", (d as any).passportCountry || d.nationality || '');
    if (d.passportNumber) setF("fill_21_P.13", parsePassportPartial(d.passportNumber));
  }

  // ═══ Pre-built: P.14 續頁D (corp dirs #2+#3) ═══
  if (corpDirs.length > 1) {
    const extraCorpDirs = corpDirs.slice(1);
    setF("fill_1_P14", day);
    setF("fill_2_P14", month);
    setF("fill_3_P14", year);
    setF("fill_4_P14", br8);
    const fillSlotP14 = (dir: OfficerData, slot: 1 | 2) => {
      const base = slot === 1 ? 0 : 12;
      const f = (n: number) => `fill_${n + base}_P14`;
      setF(f(5), "X");
      setF(f(8), dir.nameChinese || "");
      setF(f(9), dir.nameEnglish || "");
      setF(f(10), office.flat || "");
      setF(f(11), office.building || "");
      setF(f(12), office.street || "");
      setF(f(13), office.district || "");
      setF(f(14), office.region || (office as any).country || "");
      setF(f(15), dir.email || "");
      setF(f(16), dir.companyNumberRef || dir.brNumber || dir.idNumber || "");
    };
    if (extraCorpDirs[0]) fillSlotP14(extraCorpDirs[0], 1);
    if (extraCorpDirs[1]) fillSlotP14(extraCorpDirs[1], 2);
  }

  // ═══ Pre-built: P.15 續頁E (company records) ═══
  const validRecords = (data.companyRecords || []).filter(
    r => (r.records && r.records.trim()) || (r.address && r.address.trim())
  );
  if (validRecords.length > 0) {
    setF("fill_1_P15", day);
    setF("fill_2_P15", month);
    setF("fill_3_P15", year);
    setF("fill_4_P15", br8);
    const recordsText = validRecords.map(r => r.records || "").join("\n\n");
    const addressText = validRecords.map(r => r.address || "").join("\n\n");
    setF("fill_5_P15", recordsText);
    setF("fill_6_P15", addressText);
  }

  // ═══════════════════════════════════════
  // DYNAMIC CONTINUATION PAGES (Phase 2)
  // ═══════════════════════════════════════

  // Template page indices (0-based):
  // 10=P.11(Sheet A), 11=P.12(Sheet B), 12=P.13(Sheet C), 13=P.14(Sheet D), 8=P.9(Sched1)

  // ── Sheet A: Extra nat secs (3rd+) ──
  // Pre-built: 2 (P.3 + P.11). Extra beyond 2 need dynamic copies of P.11 (index 10).
  // Insert at end of document — all dynamic continuation sheets go after pre-built pages.
  if (natSecs.length > 2) {
    let insertAfter = pdfDoc.getPageCount() - 1;
    for (let si = 2; si < natSecs.length; si++) {
      const s = natSecs[si];
      const suffix = `dynA_${si}`;
      const { surname, otherNames } = parseEnglishName(s.nameEnglish);
      const addr = parseAddress(s.address || '');

      const values: Record<string, string> = {};
      const setV = (k: string, v: string) => { values[k] = v || ''; };
      setV("fill_1_P11", day);
      setV("fill_2_P11", month);
      setV("fill_3_P11", year);
      setV("fill_4_P11", br8);
      setV("fill_5_P11", s.nameChinese || "");
      setV("fill_6_P11", surname);
      setV("fill_7_P11", otherNames);
      setV("fill_12_P11", addr.flat);
      setV("fill_13_P11", addr.building);
      setV("fill_14_P11", addr.street);
      setV("fill_15_P11", addr.district);
      setV("fill_16_P11", s.email || "");
      setV("fill_17_P11", parseHkidPartial(s.idNumber || ''));
      setV("fill_18_P11", (s as any).passportCountry || '');
      setV("fill_19_P11", s.passportNumber ? parsePassportPartial(s.passportNumber) : '');
      setV("fill_20_P11", s.tcspNumber || '');

      const slot: ContinuationSlot = {
        fieldNames: Object.keys(values),
        values,
      };
      insertAfter = await addDynamicContinuationSheet(pdfDoc, templateBytes, 10, insertAfter, slot, suffix);
      hasDynamicPages = true;
    }
  }

  // ── Sheet B: Extra corp secs (3rd+) ──
  // Insert at end of document.
  if (corpSecs.length > 2) {
    let insertAfter = pdfDoc.getPageCount() - 1;
    for (let si = 2; si < corpSecs.length; si++) {
      const s = corpSecs[si];
      const suffix = `dynB_${si}`;
      const addr = parseAddress(s.address || '');

      const values: Record<string, string> = {};
      const setV = (k: string, v: string) => { values[k] = v || ''; };
      setV("fill_1_P12", day);
      setV("fill_2_P12", month);
      setV("fill_3_P12", year);
      setV("fill_4_P12", br8);
      setV("fill_5_P12", s.nameChinese || "");
      setV("fill_6_P12", s.nameEnglish || "");
      setV("fill_7_P12", addr.flat);
      setV("fill_8_P12", addr.building);
      setV("fill_9_P12", addr.street);
      setV("fill_10_P12", addr.district);
      setV("fill_11_P12", s.email || "");
      setV("fill_12_P12", s.companyNumberRef || s.brNumber || s.idNumber || "");
      setV("fill_13_P12", s.tcspNumber || "");

      const slot: ContinuationSlot = {
        fieldNames: Object.keys(values),
        values,
      };
      // Insert after the last dynamic page (or end of doc)
      insertAfter = await addDynamicContinuationSheet(pdfDoc, templateBytes, 11, insertAfter, slot, suffix);
      hasDynamicPages = true;
    }
  }

  // ── Sheet C: Extra nat dirs (3rd+) ──
  // Insert at end of document.
  if (natDirs.length > 2) {
    let insertAfter = pdfDoc.getPageCount() - 1;
    for (let di = 2; di < natDirs.length; di++) {
      const d = natDirs[di];
      const suffix = `dynC_${di}`;
      const { surname, otherNames } = parseEnglishName(d.nameEnglish);

      const values: Record<string, string> = {};
      const setV = (k: string, v: string) => { values[k] = v || ''; };
      setV("fill_1_P.13", day);
      setV("fill_2_P.13", month);
      setV("fill_3_P.13", year);
      setV("fill_4_P.13", br8);
      setV("fill_6_P.13", d.nameChinese || "");
      setV("fill_7_P.13", surname);
      setV("fill_8_P.13", otherNames);
      const dr = directorAddrRows(parseAddress(d.address || ''), office);
      setV("fill_13_P.13", dr.flat);
      setV("fill_14_P.13", dr.building);
      setV("fill_15_P.13", dr.street);
      setV("fill_16_P.13", dr.district);
      setV("fill_17_P.13", dr.country);
      setV("fill_18_P.13", d.email || "");
      setV("fill_19_P.13", parseHkidPartial(d.idNumber || ''));
      setV("fill_20_P.13", (d as any).passportCountry || d.nationality || '');
      setV("fill_21_P.13", d.passportNumber ? parsePassportPartial(d.passportNumber) : '');

      const checkboxes = d.isAlternate ? ['cb_2_P.13'] : ['cb_1_P.13'];
      const slot: ContinuationSlot = {
        fieldNames: Object.keys(values),
        values,
        checkboxes,
      };
      insertAfter = await addDynamicContinuationSheet(pdfDoc, templateBytes, 12, insertAfter, slot, suffix);
      hasDynamicPages = true;
    }
  }

  // ── Sheet D: Extra corp dirs (4th+) ──
  // Pre-built: 3 (1 on P.6 + 2 on P.14). Extra beyond 3 need dynamic copies of P.14 (index 13).
  // Insert at end of document.
  if (corpDirs.length > 3) {
    let insertAfter = pdfDoc.getPageCount() - 1;
    for (let di = 3; di < corpDirs.length; di += 2) {
      const suffix = `dynD_${di}`;
      const dir1 = corpDirs[di];
      const dir2 = corpDirs[di + 1];

      const values: Record<string, string> = {};
      const setV = (k: string, v: string) => { values[k] = v || ''; };
      setV("fill_1_P14", day);
      setV("fill_2_P14", month);
      setV("fill_3_P14", year);
      setV("fill_4_P14", br8);

      // Slot 1 (base=0..11)
      if (dir1) {
        setV("fill_5_P14", "X");
        setV("fill_8_P14", dir1.nameChinese || "");
        setV("fill_9_P14", dir1.nameEnglish || "");
        setV("fill_10_P14", office.flat || "");
        setV("fill_11_P14", office.building || "");
        setV("fill_12_P14", office.street || "");
        setV("fill_13_P14", office.district || "");
        setV("fill_14_P14", office.region || (office as any).country || "");
        setV("fill_15_P14", dir1.email || "");
        setV("fill_16_P14", dir1.companyNumberRef || dir1.brNumber || dir1.idNumber || "");
      }
      // Slot 2 (base=12..23)
      if (dir2) {
        setV("fill_17_P14", "X");
        setV("fill_20_P14", dir2.nameChinese || "");
        setV("fill_21_P14", dir2.nameEnglish || "");
        setV("fill_22_P14", office.flat || "");
        setV("fill_23_P14", office.building || "");
        setV("fill_24_P14", office.street || "");
        setV("fill_25_P14", office.district || "");
        setV("fill_26_P14", office.region || (office as any).country || "");
        setV("fill_27_P14", dir2.email || "");
        setV("fill_28_P14", dir2.companyNumberRef || dir2.brNumber || dir2.idNumber || "");
      }

      const slot: ContinuationSlot = {
        fieldNames: Object.keys(values),
        values,
      };
      insertAfter = await addDynamicContinuationSheet(pdfDoc, templateBytes, 13, insertAfter, slot, suffix);
      hasDynamicPages = true;
    }
  }

  // （附表一第2+頁已在上方 P.9/P.10 段內處理：非上市成員3+ 用附表一副本緊跟第1頁插入）

  // ═══ BR 蓋印在所有頁面 ═══
  if (br8) {
    for (const page of pdfDoc.getPages()) {
      try { page.drawText(br8, { x: 500, y: 820, size: 8, font: helv }); } catch { /* skip */ }
    }
  }

  // ═══ 刪除不需要的頁面 ═══
  // Template structure (27 pages total):
  //   Pages 0-14: 15 content pages with AcroForm widgets (P.1-P.15)
  //   Pages 15-26: 12 blank spare pages (copy sources for dynamic continuation)
  // Dynamic continuation pages are inserted mid-document (附表一第2+頁緊跟 P.9) or at end.
  //
  // Strategy: keep only needed content pages + dynamic pages, remove the rest.
  // Removal resolves indices by PAGE IDENTITY (originalTemplatePages), because
  // dynamic insertions shift the original template indices.

  // Pre-built content pages to KEEP (indices 0-14):
  const keepPrebuiltPages = new Set<number>();
  for (let i = 0; i <= 7; i++) keepPrebuiltPages.add(i);  // P.1-P.8 always
  if (validMembers.length > 0 && !isListedCo) keepPrebuiltPages.add(8);  // P.9 附表一第1頁
  if (isListedCo) keepPrebuiltPages.add(9);  // P.10 附表二（僅上市公司；非上市第2+頁用附表一副本）
  if (natSecs.length > 1) keepPrebuiltPages.add(10);  // P.11
  if (corpSecs.length > 1) keepPrebuiltPages.add(11);  // P.12
  if (natDirs.length > 1) keepPrebuiltPages.add(12);  // P.13
  if (corpDirs.length > 1) keepPrebuiltPages.add(13);  // P.14
  if (validRecords.length > 0) keepPrebuiltPages.add(14);  // P.15

  // Collect pages to remove — resolve by page identity (indices drift after insertions)
  const pagesToRemove: number[] = [];
  for (let i = 0; i < originalTemplatePages.length; i++) {
    if (keepPrebuiltPages.has(i)) continue;
    const cur = pdfDoc.getPageIndex(originalTemplatePages[i]);
    if (cur >= 0) pagesToRemove.push(cur);
  }

  // Sort descending so higher indices are removed first (no index drift)
  pagesToRemove.sort((a, b) => b - a);

  // Execute removal
  for (const idx of pagesToRemove) {
    try { pdfDoc.removePage(idx); } catch { /* */ }
  }

  // ═══ Always rebuild AcroForm Fields (after page removal) ═══
  rebuildAcroFormFields(pdfDoc);

  // ═══ Set NeedAppearances for standard flow ═══
  // Let PDF reader rebuild widget appearance streams from /V values.
  // This is cheaper than generateAllApStreams() which would exceed CPU limits
  // on NAR1's 27-page template.
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm")) as any;
    if (acroForm) {
      acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
    }
  } catch { /* */ }

  // ═══ Force indirect /Annots (NN1 pattern) ═══
  // pdf-lib's page ops can inline /Annots, breaking field rendering.
  // Re-register all page /Annots as indirect objects before save.
  try {
    const actx = (pdfDoc as any).context;
    for (const page of pdfDoc.getPages()) {
      try {
        const node = (page as any).node;
        const annots = node.lookup(PDFName.of("Annots")) as any;
        if (!annots || typeof annots.size !== "function") continue;
        const newAnnots = PDFArray.withContext(actx);
        for (let i = 0; i < annots.size(); i++) {
          newAnnots.push(annots.get(i));
        }
        const ref = actx.register(newAnnots);
        node.delete(PDFName.of("Annots"));
        node.set(PDFName.of("Annots"), ref);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // ═══ Save ═══
  const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  return pdfBytes;
}

// ═══ Phase 4: auto-assign change events ═══
function parseDMY(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const d = new Date(+parts[2], +parts[1] - 1, +parts[0]);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

async function autoAssignNAR1ChangesForCloud(env: Env, companyId: string) {
  if (!env.DB) return;
  const unassigned = await env.DB.prepare(
    "SELECT * FROM change_events WHERE company_id = ? AND (nar1_period_id = '' OR nar1_period_id IS NULL)"
  ).bind(companyId).all();
  const periods = await env.DB.prepare(
    "SELECT * FROM nar1_filings WHERE company_id = ? ORDER BY period_start"
  ).bind(companyId).all();
  if (!unassigned.results?.length || !periods.results?.length) return;

  for (const evt of unassigned.results as any[]) {
    const d = parseDMY(evt.change_date);
    if (!d) continue;
    for (const period of periods.results as any[]) {
      const ps = parseDMY(period.period_start);
      const pe = parseDMY(period.period_end);
      if (ps && pe && ps <= d && d < pe) {
        await env.DB.prepare("UPDATE change_events SET nar1_period_id = ? WHERE id = ?")
          .bind(period.id, evt.id).run();
        break;
      }
    }
  }
}

// ═══ Cloudflare Worker Handler ═══
export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const companyData: CompanyData = await request.json();
    console.log(`Generating NAR1 for: ${companyData.name} (BR: ${companyData.brNumber})`);
    const pdfBytes = await buildNAR1Pdf(companyData, env);

    const result: Record<string, any> = { pdf: uint8ToBase64(pdfBytes) };

    const companyId = (companyData as any).company_id || (companyData as any).selectedCompanyId;
    if (companyId && env.DB) {
      try {
        await autoAssignNAR1ChangesForCloud(env, companyId);
        const periods = await env.DB.prepare(
          "SELECT * FROM nar1_filings WHERE company_id = ? ORDER BY period_start DESC LIMIT 1"
        ).bind(companyId).all();
        if (periods.results?.length > 0) {
          result.nar1_current_period = {
            id: (periods.results[0] as any).id,
            period_start: (periods.results[0] as any).period_start,
            period_end: (periods.results[0] as any).period_end,
          };
        }
      } catch (e: any) {
        console.log(`[NAR1] Warning: Failed to assign changes: ${e.message}`);
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error generating NAR1 PDF:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
