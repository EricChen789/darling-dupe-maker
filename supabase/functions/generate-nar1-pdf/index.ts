import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, PDFName, PDFHexString, PDFString, PDFBool, PDFNumber, PDFArray } from "https://esm.sh/pdf-lib@1.17.1";

// ============================================================================
// NAR1 PDF Generator — 原生 AcroForm 模式
//
// 策略（與用戶提供的「正確」NAR1 PDF 相同）：
//  - 不嵌入任何字體（避免 NotoSansTC 12MB 觸發 Edge Function WORKER_LIMIT）
//  - 模板本身已包含 /PMingLiU (Type0, UniCNS-UTF16-H) 字體資源
//  - 含中文的欄位：把 widget 的 /DA 設為 "/PMingLiU 12 Tf 0 g"
//                  並用 PDFHexString.fromText() 寫入 /V (UTF-16BE+BOM)
//  - 純 ASCII 欄位：保留模板原 /DA (/Helv)，用 PDFString 寫入 /V
//  - 設置 AcroForm /NeedAppearances = true
//      → Adobe Reader / Chrome / Preview 開啟時自動以 PMingLiU 渲染中文
//      → 確保各 PDF 閱讀器顯示一致，不再亂碼
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isAscii(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s);
}

interface OfficerData {
  nameChinese: string;
  nameEnglish: string;
  email: string;
  identity: 'natural' | 'corporate';
  brNumber?: string;
  address?: string;
  serviceAddress?: string;
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
}

const TEMPLATE_BASE = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates";
const TEMPLATES = {
  main: `${TEMPLATE_BASE}/NAR1_part1_pages1-8.pdf`,
  schedule1: `${TEMPLATE_BASE}/NAR1_p9_v2.pdf`,
  schedule2: `${TEMPLATE_BASE}/NAR1_p10_v2.pdf`,
  sheetA: `${TEMPLATE_BASE}/NAR1_p11_v2.pdf`,
  sheetB: `${TEMPLATE_BASE}/NAR1_p12_v2.pdf`,
  sheetC: `${TEMPLATE_BASE}/NAR1_p13_v2.pdf`,
  sheetD: `${TEMPLATE_BASE}/NAR1_p14_v2.pdf`,
  sheetE: `${TEMPLATE_BASE}/NAR1_p15_v2.pdf`,
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

const decodePdfText = (value: any): string => {
  if (!value) return "";
  try {
    if (typeof value.decodeText === "function") return value.decodeText();
  } catch (_) { /* ignore */ }
  return String(value).replace(/^\((.*)\)$/s, "$1");
};

// 收集所有 widget annotation，並建立多種別名（parent name / widget name / 規範化）→ widget 對照
function collectFormFields(pdfDoc: PDFDocument): Map<string, { widget: any; field: any }> {
  const map = new Map<string, { widget: any; field: any }>();
  const addAlias = (name: string, target: { widget: any; field: any }) => {
    if (name && !map.has(name)) map.set(name, target);
  };

  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots")) as any;
    if (!annots || typeof annots.size !== "function") continue;

    for (let i = 0; i < annots.size(); i++) {
      try {
        const widget = pdfDoc.context.lookup(annots.get(i)) as any;
        if (!widget || typeof widget.get !== "function") continue;
        const subtype = widget.get(PDFName.of("Subtype"));
        if (subtype && String(subtype) !== "/Widget") continue;

        const parentRef = widget.get(PDFName.of("Parent"));
        const field = parentRef ? pdfDoc.context.lookup(parentRef) as any : widget;
        const parentName = field ? decodePdfText(field.get(PDFName.of("T"))) : "";
        const widgetName = decodePdfText(widget.get(PDFName.of("T")));
        const target = { widget, field };

        addAlias(parentName, target);
        addAlias(widgetName, target);
        if (parentName && widgetName) addAlias(`${parentName}.${widgetName}`, target);
        // 規範化：fill_4_P.9 ↔ fill_4_P9
        if (widgetName) {
          addAlias(widgetName.replace(/_P\.(\d+)$/g, "_P$1"), target);
          addAlias(widgetName.replace(/_P(\d+)$/g, "_P.$1"), target);
        }
        if (parentName) {
          addAlias(parentName.replace(/_P\.(\d+)$/g, "_P$1"), target);
          addAlias(parentName.replace(/_P(\d+)$/g, "_P.$1"), target);
        }
      } catch (_) { /* skip */ }
    }
  }
  return map;
}

// 把 widget 從共享父 field 分離（複製繼承屬性），避免多頁共用父 field 時 /V 互相覆蓋
function detachWidget(widget: any, field: any) {
  if (widget === field) return;
  try {
    const parentName = decodePdfText(field.get(PDFName.of("T")));
    const widgetName = decodePdfText(widget.get(PDFName.of("T")));
    const inheritKeys = ["FT", "DA", "Ff", "MaxLen", "Q", "DV"];
    for (const k of inheritKeys) {
      const key = PDFName.of(k);
      if (!widget.get(key)) {
        const v = field.get(key);
        if (v !== undefined && v !== null) widget.set(key, v);
      }
    }
    if (parentName && widgetName) widget.set(PDFName.of("T"), PDFString.of(`${parentName}.${widgetName}`));
    widget.delete(PDFName.of("Parent"));
  } catch (_) { /* best-effort */ }
}

// PDF readers such as Adobe only render fields listed in AcroForm /Fields.
// After detaching widgets, rebuild /Fields with the actual page widget refs.
function rebuildAcroFormFields(pdfDoc: PDFDocument) {
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm")) as any;
    if (!acroForm || typeof acroForm.set !== "function") return;
    const fields = PDFArray.withContext(pdfDoc.context);
    for (const page of pdfDoc.getPages()) {
      const annots = page.node.lookup(PDFName.of("Annots")) as any;
      if (!annots || typeof annots.size !== "function") continue;
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        const widget = pdfDoc.context.lookup(ref) as any;
        if (!widget || typeof widget.get !== "function") continue;
        if (String(widget.get(PDFName.of("Subtype"))) !== "/Widget") continue;
        if (!widget.get(PDFName.of("FT"))) continue;
        fields.push(ref);
      }
    }
    acroForm.set(PDFName.of("Fields"), fields);
    acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
  } catch (e) {
    console.warn("⚠ Could not rebuild AcroForm fields:", e);
  }
}

// 設定 AcroForm /NeedAppearances = true，讓 reader 開啟時自動產生 widget appearance
function enableNeedAppearances(pdfDoc: PDFDocument) {
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm")) as any;
    if (acroForm && typeof acroForm.set === "function") {
      acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
    }
  } catch (_) { /* ignore */ }
}

// 從原 /DA 保留字號，將字體名換為 /PMingLiU；若失敗則用預設 12pt
function buildCjkDA(originalDA: string | undefined): string {
  // /Helv 12 Tf 0 g  -> /PMingLiU 12 Tf 0 g
  const m = originalDA?.match(/(\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? m[1] : "12";
  return `/PMingLiU ${size} Tf 0 g`;
}

function buildHelvDA(originalDA: string | undefined): string {
  const m = originalDA?.match(/(\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? m[1] : "12";
  return `/Helv ${size} Tf 0 g`;
}

function toAdobeSafeText(value: string): string {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && isAscii(line))
    .join("\n");
}

interface FormHelpers {
  form: any;
  setText: (fieldName: string, value: string) => boolean;
  check: (fieldName: string, shouldCheck: boolean) => boolean;
  selectDropdown: (fieldName: string, value: string) => boolean;
}

function createFormHelpers(pdfDoc: PDFDocument): FormHelpers {
  enableNeedAppearances(pdfDoc);
  let form: any = null;
  try { form = pdfDoc.getForm(); } catch (_) { /* low-level fallback */ }

  const fields = collectFormFields(pdfDoc);

  const setText = (fieldName: string, value: string): boolean => {
    const v = (value ?? "").toString();
    const target = fields.get(fieldName);
    if (!target) {
      // 不存在的欄位：只警告，不中斷
      console.warn(`⚠ Missing field: ${fieldName}`);
      return false;
    }
    try {
      detachWidget(target.widget, target.field);

      const da = decodePdfText(target.widget.get(PDFName.of("DA"))) ||
                 decodePdfText(target.field.get(PDFName.of("DA"))) ||
                 "/Helv 12 Tf 0 g";

      if (v.length > 0 && !isAscii(v)) {
        // 含中文：用模板內建 /PMingLiU (Type0/UniCNS-UTF16-H)，/V 用 UTF-16BE hex string
        target.widget.set(PDFName.of("DA"), PDFString.of(buildCjkDA(da)));
        target.widget.set(PDFName.of("V"), PDFHexString.fromText(v));
      } else {
        // 純 ASCII：保留 Helv
        target.widget.set(PDFName.of("DA"), PDFString.of(buildHelvDA(da)));
        target.widget.set(PDFName.of("V"), PDFString.of(v));
      }
      // 移除舊的 appearance，強制 reader 用 NeedAppearances 重建
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`⚠ setText failed for ${fieldName}:`, e);
      return false;
    }
  };

  const check = (fieldName: string, shouldCheck: boolean): boolean => {
    if (!shouldCheck) return false;
    const target = fields.get(fieldName);
    if (!target) return false;
    try {
      detachWidget(target.widget, target.field);
      // Discover the checkbox's "On" state name from its /AP/N dictionary.
      // Different templates use /Yes, /On, /1, etc. We must match exactly,
      // otherwise Adobe Reader won't render the checkmark.
      let onState = "Yes";
      try {
        const ap = target.widget.get(PDFName.of("AP")) as any;
        const apN = ap?.get?.(PDFName.of("N")) as any;
        const dict = apN?.dict;
        if (dict && typeof dict.keys === "function") {
          for (const k of dict.keys()) {
            const name = String(k).replace(/^\//, "");
            if (name && name !== "Off") { onState = name; break; }
          }
        }
      } catch (_) { /* fallback to Yes */ }
      target.widget.set(PDFName.of("V"), PDFName.of(onState));
      target.widget.set(PDFName.of("AS"), PDFName.of(onState));
      return true;
    } catch {
      return false;
    }
  };

  const selectDropdown = (fieldName: string, value: string): boolean => {
    if (!form) return false;
    try {
      const dropdown = form.getDropdown(fieldName);
      const options = dropdown.getOptions();
      const match = options.find((o: string) => value.includes(o) || o.includes(value));
      if (match) { dropdown.select(match); return true; }
    } catch (_) { /* ignore */ }
    return false;
  };

  return { form, setText, check, selectDropdown };
}

// 把附頁的所有欄位重命名（加 suffix），避免合併時跨文件名稱衝突
function renameAnnotationFields(pdfDoc: PDFDocument, suffix: string) {
  const renamed = new Set<any>();
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots")) as any;
    if (!annots || typeof annots.size !== "function") continue;

    for (let i = 0; i < annots.size(); i++) {
      try {
        const widget = pdfDoc.context.lookup(annots.get(i)) as any;
        if (!widget || typeof widget.get !== "function") continue;
        const parentRef = widget.get(PDFName.of("Parent"));
        const field = parentRef ? pdfDoc.context.lookup(parentRef) as any : widget;

        for (const obj of [field, widget]) {
          if (!obj || renamed.has(obj) || typeof obj.get !== "function") continue;
          const oldName = decodePdfText(obj.get(PDFName.of("T")));
          if (!oldName || oldName.endsWith(suffix)) continue;
          obj.set(PDFName.of("T"), PDFHexString.fromText(`${oldName}${suffix}`));
          renamed.add(obj);
        }
      } catch (_) { /* skip */ }
    }
  }
}

// ========== 主文件 P.1-P.8 ==========
interface CommonCtx {
  br8: string;
  day: string;
  month: string;
  year: string;
  data: CompanyData;
  office: NonNullable<CompanyData["registeredOffice"]>;
  shareInfos: Array<{ className: string; currency: string; issuePrice: number; shares: number; paidUp: number; unpaid: number; }>;
}

function fillMainDocument(pdfDoc: PDFDocument, ctx: CommonCtx) {
  const { br8, day, month, year, data, office, shareInfos } = ctx;
  const { setText, check, selectDropdown } = createFormHelpers(pdfDoc);

  // ===== Page 1 =====
  setText("fill_1_P.1", br8);
  const fullCompanyName = [data.name, data.chineseName].filter(Boolean).join("\n");
  setText("fill_2_P.1", fullCompanyName);
  setText("fill_3_P.1", data.tradingName || "");
  check("cb_1_P.1", data.companyType?.includes("私人") || data.companyType?.toLowerCase().includes("private") || false);
  check("cb_2_P.1", data.companyType?.includes("公眾") || data.companyType?.toLowerCase().includes("public") || false);
  check("cb_3_P.1", data.companyType?.includes("擔保") || false);
  setText("fill_4_P.1", data.businessCode || "");
  setText("fill_5_P.1", data.businessNature || "");
  setText("fill_6_P.1", day || "");
  setText("fill_7_P.1", month || "");
  setText("fill_8_P.1", year || "");
  setText("fill_15_P.1", office.flat || "");
  setText("fill_16_P.1", office.building || "");
  setText("fill_17_P.1", office.street || "");
  setText("fill_18_P.1", office.district || "");
  if (office.region) selectDropdown("Dropdown1_P.1", office.region);

  const presenterP1 = data.presenter || {};
  if (presenterP1.name) setText("fill_19_P.1", presenterP1.name);
  if (presenterP1.address) setText("fill_20_P.1", presenterP1.address);
  if (presenterP1.phone) setText("fill_21_P.1", presenterP1.phone);
  if (presenterP1.fax) setText("fill_22_P.1", presenterP1.fax);
  if (presenterP1.email) setText("fill_23_P.1", presenterP1.email);
  if (presenterP1.reference) setText("fill_24_P.1", presenterP1.reference);

  // ===== Page 2 - Share Capital =====
  setText("fill_1_P.2", br8);
  let totalShares = 0, totalAmountSum = 0, totalPaidUpSum = 0, firstCurrency = "";
  for (let i = 0; i < Math.min(4, shareInfos.length); i++) {
    const info = shareInfos[i];
    const base = 6 + i * 5;
    const issuedAmount = (info.paidUp + info.unpaid) || (info.issuePrice ? info.issuePrice * info.shares : 0);
    setText(`fill_${base}_P.2`, info.className);
    setText(`fill_${base + 1}_P.2`, info.currency);
    setText(`fill_${base + 2}_P.2`, fmtInt(info.shares));
    setText(`fill_${base + 3}_P.2`, issuedAmount ? fmtAmount(issuedAmount) : "");
    setText(`fill_${base + 4}_P.2`, info.paidUp ? fmtAmount(info.paidUp) : (issuedAmount ? fmtAmount(issuedAmount) : ""));
    totalShares += info.shares;
    totalAmountSum += issuedAmount;
    totalPaidUpSum += info.paidUp || issuedAmount;
    if (!firstCurrency) firstCurrency = info.currency;
  }
  if (shareInfos.length > 0) {
    setText("fill_26_P.2", firstCurrency);
    setText("fill_27_P.2", fmtInt(totalShares));
    setText("fill_28_P.2", totalAmountSum ? fmtAmount(totalAmountSum) : "");
    setText("fill_29_P.2", totalPaidUpSum ? fmtAmount(totalPaidUpSum) : "");
  }

  // ===== Page 3 - Secretary (Natural) - 第一位 =====
  setText("fill_1_P.3", br8);
  const naturalSecretaries = (data.secretaries || []).filter(s => s.identity === "natural");
  if (naturalSecretaries.length > 0) {
    const sec = naturalSecretaries[0];
    const { surname, otherNames } = parseEnglishName(sec.nameEnglish);
    setText("fill_2_P.3", sec.nameChinese || "");
    setText("fill_3_P.3", surname);
    setText("fill_4_P.3", otherNames);
    const addr = parseAddress(sec.address || '');
    setText("fill_9_P.3", addr.flat);
    setText("fill_10_P.3", addr.building);
    setText("fill_11_P.3", addr.street);
    setText("fill_12_P.3", addr.district);
    setText("fill_13_P.3", sec.email || "");
    const hkid = parseHkidPartial(sec.idNumber || '');
    if (hkid) setText("fill_14_P.3", hkid);
  }

  // ===== Page 4 - Secretary (Corporate) - 第一位 =====
  setText("fill_1_P.4", br8);
  const corporateSecretaries = (data.secretaries || []).filter(s => s.identity === "corporate");
  if (corporateSecretaries.length > 0) {
    const sec = corporateSecretaries[0];
    setText("fill_2_P.4", sec.nameChinese || "");
    setText("fill_3_P.4", sec.nameEnglish || "");
    // 法人秘書要用「服務地址」(service address)，而非註冊辦事處地址
    const addr = parseAddress(sec.serviceAddress || sec.address || '');
    setText("fill_4_P.4", addr.flat);
    setText("fill_5_P.4", addr.building);
    setText("fill_6_P.4", addr.street);
    setText("fill_7_P.4", addr.district);
    setText("fill_8_P.4", sec.email || "");
    setText("fill_9_P.4", sec.companyNumberRef || sec.brNumber || "");
    const tcsp = sec.tcspNumber || (sec as any).licenceNumber || "";
    if (tcsp) setText("fill_10_P.4", tcsp);
  }

  // ===== Page 5 - Director (Natural) - 第一位 =====
  setText("fill_1_P.5", br8);
  const naturalDirectors = (data.directors || []).filter(d => d.identity === "natural");
  if (naturalDirectors.length > 0) {
    const dir = naturalDirectors[0];
    const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
    // 23. 身分：剔「董事」(cb_1_P.5)
    check("cb_1_P.5", true);
    setText("fill_3_P.5", dir.nameChinese || "");
    setText("fill_4_P.5", surname);
    setText("fill_5_P.5", otherNames);
    setText("fill_10_P.5", office.flat || "");
    setText("fill_11_P.5", office.building || "");
    setText("fill_12_P.5", office.street || "");
    setText("fill_13_P.5", office.district || "");
    setText("fill_14_P.5", office.region || "");
    setText("fill_15_P.5", dir.email || "");
    const hkid = parseHkidPartial(dir.idNumber || '');
    if (hkid) {
      setText("fill_16_P.5", hkid);
    } else if (dir.passportNumber) {
      setText("fill_17_P.5", dir.nationality || dir.placeIncorporated || "");
      setText("fill_18_P.5", parsePassportPartial(dir.passportNumber));
    }
  }

  // ===== Page 6 - Director (Corporate) - 第一位 =====
  setText("fill_1_P.6", br8);
  const corporateDirectors = (data.directors || []).filter(d => d.identity === "corporate");
  if (corporateDirectors.length > 0) {
    const dir = corporateDirectors[0];
    check("cb_1_P.6", true);
    setText("fill_3_P.6", dir.nameChinese || "");
    setText("fill_4_P.6", dir.nameEnglish || "");
    setText("fill_5_P.6", office.flat || "");
    setText("fill_6_P.6", office.building || "");
    setText("fill_7_P.6", office.street || "");
    setText("fill_8_P.6", office.district || "");
    setText("fill_9_P.6", office.region || "");
    setText("fill_10_P.6", dir.email || "");
    setText("fill_11_P.6", dir.companyNumberRef || dir.brNumber || "");
  }

  // ===== Page 7 =====
  setText("fill_1_P.7", br8);

  // ===== Page 8 =====
  setText("fill_1_P.8", br8);
  const memberCount = (data.shareholders || []).filter(sh => (Number(sh.shares) || 0) > 0).length;
  const isListedCo = data.companyType?.includes("上市") || data.companyType?.toLowerCase().includes("listed") || false;

  // P.8 勾選：只剔一格 — cb_4_P.8 = 非上市公司聲明
  // (cb_1/2/3 為其他選擇性陳述，預設不剔)
  if (!isListedCo) check("cb_4_P.8", true);

  const sheetA = Math.max(0, naturalSecretaries.length - 1);
  const sheetB = Math.max(0, corporateSecretaries.length - 1);
  const sheetC = Math.max(0, naturalDirectors.length - 1);
  const sheetD = Math.max(0, corporateDirectors.length - 1);
  const schedulePages = !isListedCo && memberCount > 0 ? Math.ceil(memberCount / 2) : 0;
  const schedule2Pages = isListedCo ? 1 : 0;

  if (sheetA > 0) setText("fill_4_P.8", String(sheetA));
  if (sheetB > 0) setText("fill_5_P.8", String(sheetB));
  if (sheetC > 0) setText("fill_6_P.8", String(sheetC));
  if (sheetD > 0) setText("fill_7_P.8", String(sheetD));
  if (schedulePages > 0) setText("fill_9_P.8", String(schedulePages));
  if (schedule2Pages > 0) setText("fill_10_P.8", String(schedule2Pages));

  // 簽署人：優先使用前端傳入的 signer，否則 fallback 至 presenter
  const signer = data.signer;
  const signerName = signer?.name || presenterP1.name || "";
  const signerRole = signer?.role || null;
  if (signerName) setText("fill_11_P.8", signerName);
  if (day && month && year) setText("fill_12_P.8", `${day}/${month}/${year}`);

  // 在「董事 Director／公司秘書 Company Secretary」上劃線刪除不適用者
  // 文字位於 P.8 (page index 7)，y(top)≈745.8 (page height 841.68 → y_pdf ≈ 92)
  //   「董事 Director」整段           x ≈ 144 – 252
  //   「／公司秘書 Company Secretary」 x ≈ 252 – 339
  if (signerRole === 'secretary' || signerRole === 'director') {
    try {
      const page8 = pdfDoc.getPage(7);
      const ph = page8.getHeight();
      const yLine = ph - 749; // 蓋過文字中段
      if (signerRole === 'secretary') {
        // 簽署人是秘書 → 劃掉「董事 Director」（中英文同時）
        page8.drawLine({
          start: { x: 142, y: yLine },
          end:   { x: 253, y: yLine },
          thickness: 1.2,
        });
      } else {
        // 簽署人是董事 → 劃掉「／公司秘書 Company Secretary」（中英文同時）
        page8.drawLine({
          start: { x: 252, y: yLine },
          end:   { x: 339, y: yLine },
          thickness: 1.2,
        });
      }
    } catch (e) {
      console.warn('Failed to draw strikethrough on P.8:', e);
    }
  }
}

// ========== 附表 1 (P.9): 兩位股東 (非上市公司) ==========
// 實際 P.9 欄位佈局（依據模板坐標分析）：
//   日期: fill_1(DD), fill_2(MM), fill_3(YYYY)
//   BR 號碼: fill_4 (整段一格)
//   股份類別 (整頁共用): fill_5
//   該類別之股份總數: fill_6
//   slot1 (上半頁):
//     中文名 fill_7, 姓 fill_8, 名 fill_9
//     共同持有人姓名 fill_10
//     地址: 室/樓 fill_11, 大廈 fill_12, 街道 fill_13, 區 fill_14, 國家 fill_15
//     持有股份數目 fill_16
//     備註 fill_17
//     共同持有勾選 cb_1
//   slot2 (下半頁):
//     中文名 fill_18, 姓 fill_19, 名 fill_20
//     共同持有人姓名 fill_21
//     地址: fill_22, fill_23, fill_24, fill_25, fill_26
//     持有股份數目 fill_27
//     備註 fill_28
//     共同持有勾選 cb_2
//   頁碼: fill_29 (current), fill_30 (total)
function fillSchedule1(pdfDoc: PDFDocument, ctx: CommonCtx, members: ShareholderData[], pageNo: number, totalPages: number) {
  const { br8, day, month, year, shareInfos } = ctx;
  const { setText } = createFormHelpers(pdfDoc);

  setText("fill_1_P.9", day || "");
  setText("fill_2_P.9", month || "");
  setText("fill_3_P.9", year || "");
  setText("fill_4_P.9", br8);
  const firstShareInfo = shareInfos[0];
  if (firstShareInfo) {
    setText("fill_5_P.9", firstShareInfo.className);
    setText("fill_6_P.9", fmtInt(firstShareInfo.shares));
  }

  // slot1: name=7, surname=8, other=9, shares=16, flat=11, building=12, street=13, district=14, country=15
  // slot2: name=18, surname=19, other=20, shares=27, flat=22, building=23, street=24, district=25, country=26
  const SLOT_FIELDS = [
    { name: 7,  surname: 8,  other: 9,  shares: 16, flat: 11, building: 12, street: 13, district: 14, country: 15 },
    { name: 18, surname: 19, other: 20, shares: 27, flat: 22, building: 23, street: 24, district: 25, country: 26 },
  ];

  const fillMember = (sh: ShareholderData, slotIdx: 0 | 1) => {
    const F = SLOT_FIELDS[slotIdx];
    const isCorp = sh.identity === "corporate";
    const fullName = sh.nameEnglish || sh.name || "";
    const { surname, otherNames } = parseEnglishName(fullName);
    const addr = parseAddress(sh.address || "");
    const country = addr.country || "香港 Hong Kong";

    setText(`fill_${F.name}_P.9`, sh.nameChinese || "");
    if (isCorp) {
      setText(`fill_${F.surname}_P.9`, fullName);
    } else {
      setText(`fill_${F.surname}_P.9`, surname);
      setText(`fill_${F.other}_P.9`, otherNames);
    }
    setText(`fill_${F.shares}_P.9`, fmtInt(Number(sh.shares) || 0));
    setText(`fill_${F.flat}_P.9`, addr.flat);
    setText(`fill_${F.building}_P.9`, addr.building);
    setText(`fill_${F.street}_P.9`, addr.street);
    setText(`fill_${F.district}_P.9`, addr.district);
    setText(`fill_${F.country}_P.9`, country);
  };

  if (members[0]) fillMember(members[0], 0);
  if (members[1]) fillMember(members[1], 1);
  setText("fill_29_P.9", String(pageNo));
  setText("fill_30_P.9", String(totalPages));
}

// ========== 附表 2 (P.10): 上市公司 ==========
function fillSchedule2(pdfDoc: PDFDocument, ctx: CommonCtx) {
  const { br8, day, month, year, shareInfos } = ctx;
  const { setText } = createFormHelpers(pdfDoc);
  setText("fill_1_P10", day || "");
  setText("fill_2_P10", month || "");
  setText("fill_3_P10", year || "");
  setText("fill_4_P10", br8);
  if (shareInfos[0]) {
    setText("fill_5_P10", shareInfos[0].className);
    setText("fill_6_P10", fmtInt(shareInfos[0].shares));
  }
}

// ========== 續頁 A (P.11) ==========
function fillSheetA(pdfDoc: PDFDocument, ctx: CommonCtx, sec: OfficerData) {
  const { br8, day, month, year } = ctx;
  const { setText } = createFormHelpers(pdfDoc);
  setText("fill_1_P11", day || "");
  setText("fill_2_P11", month || "");
  setText("fill_3_P11", year || "");
  setText("fill_4_P11", br8);

  const { surname, otherNames } = parseEnglishName(sec.nameEnglish);
  setText("fill_5_P11", sec.nameChinese || "");
  setText("fill_6_P11", surname);
  setText("fill_7_P11", otherNames);
  const addr = parseAddress(sec.address || '');
  setText("fill_12_P11", addr.flat);
  setText("fill_13_P11", addr.building);
  setText("fill_14_P11", addr.street);
  setText("fill_15_P11", addr.district);
  setText("fill_16_P11", sec.email || "");
  const hkid = parseHkidPartial(sec.idNumber || '');
  if (hkid) setText("fill_17_P11", hkid);
  if (sec.tcspNumber) setText("fill_20_P11", sec.tcspNumber);
}

// ========== 續頁 B (P.12) ==========
function fillSheetB(pdfDoc: PDFDocument, ctx: CommonCtx, sec: OfficerData) {
  const { br8, day, month, year } = ctx;
  const { setText } = createFormHelpers(pdfDoc);
  setText("fill_1_P12", day || "");
  setText("fill_2_P12", month || "");
  setText("fill_3_P12", year || "");
  setText("fill_4_P12", br8);

  setText("fill_5_P12", sec.nameChinese || "");
  setText("fill_6_P12", sec.nameEnglish || "");
  const addr = parseAddress(sec.address || '');
  setText("fill_7_P12", addr.flat);
  setText("fill_8_P12", addr.building);
  setText("fill_9_P12", addr.street);
  setText("fill_10_P12", addr.district);
  setText("fill_11_P12", sec.email || "");
  setText("fill_12_P12", sec.companyNumberRef || sec.brNumber || "");
  if (sec.tcspNumber) setText("fill_13_P12", sec.tcspNumber);
}

// ========== 續頁 C (P.13) - 自然人董事 ==========
// 注意：模板中 widget name 與 parent name 數字錯位，必須統一用 parent name (fill_X_P.13)。
// Parent 對照（依 Y 座標）：
//   8=中文名, 9=姓氏, 10=Other Names, 15-19=地址(flat/building/street/district/country),
//   20=email, 21=HKID, 22=passport country, 23=passport no
// Checkbox: cb_1 (董事), cb_2 (候補董事)
function fillSheetC(pdfDoc: PDFDocument, ctx: CommonCtx, dir: OfficerData) {
  const { br8, day, month, year, office } = ctx;
  const { setText, check } = createFormHelpers(pdfDoc);
  setText("fill_1_P.13", day || "");
  setText("fill_2_P.13", month || "");
  setText("fill_3_P.13", year || "");
  setText("fill_4_P.13", br8);

  const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
  // 23. 身分：剔「董事」
  check("cb_1_P.13", true);
  setText("fill_8_P.13", dir.nameChinese || "");
  setText("fill_9_P.13", surname);
  setText("fill_10_P.13", otherNames);
  setText("fill_15_P.13", office.flat || "");
  setText("fill_16_P.13", office.building || "");
  setText("fill_17_P.13", office.street || "");
  setText("fill_18_P.13", office.district || "");
  setText("fill_19_P.13", office.region || "");
  setText("fill_20_P.13", dir.email || "");
  const hkid = parseHkidPartial(dir.idNumber || '');
  if (hkid) {
    setText("fill_21_P.13", hkid);
  } else if (dir.passportNumber) {
    setText("fill_22_P.13", dir.nationality || dir.placeIncorporated || "");
    setText("fill_23_P.13", parsePassportPartial(dir.passportNumber));
  }
}

// ========== 續頁 D (P.14) ==========
function fillSheetD(pdfDoc: PDFDocument, ctx: CommonCtx, dirs: OfficerData[]) {
  const { br8, day, month, year, office } = ctx;
  const { setText } = createFormHelpers(pdfDoc);
  setText("fill_1_P14", day || "");
  setText("fill_2_P14", month || "");
  setText("fill_3_P14", year || "");
  setText("fill_4_P14", br8);

  const fillSlot = (dir: OfficerData, slot: 1 | 2) => {
    const base = slot === 1 ? 0 : 12;
    const f = (n: number) => `fill_${n + base}_P14`;
    setText(f(5), "X");
    setText(f(8), dir.nameChinese || "");
    setText(f(9), dir.nameEnglish || "");
    setText(f(10), office.flat || "");
    setText(f(11), office.building || "");
    setText(f(12), office.street || "");
    setText(f(13), office.district || "");
    setText(f(14), office.region || "");
    setText(f(15), dir.email || "");
    setText(f(16), dir.companyNumberRef || dir.brNumber || "");
  };
  if (dirs[0]) fillSlot(dirs[0], 1);
  if (dirs[1]) fillSlot(dirs[1], 2);
}

// ========== 續頁 E (P.15) ==========
function fillSheetE(pdfDoc: PDFDocument, ctx: CommonCtx, records: Array<{ records: string; address: string }>) {
  const { setText } = createFormHelpers(pdfDoc);
  const { day, month, year, br8 } = ctx;
  setText("fill_1_P15", day || "");
  setText("fill_2_P15", month || "");
  setText("fill_3_P15", year || "");
  setText("fill_4_P15", br8);

  const recordsText = records.map(r => r.records || "").join("\n\n");
  const addressText = records.map(r => r.address || "").join("\n\n");
  setText("fill_5_P15", recordsText);
  setText("fill_6_P15", addressText);
}

// === 主流程 ===
async function buildNAR1Pdf(data: CompanyData): Promise<Uint8Array> {
  const returnDate = data.returnDate || new Date().toISOString().split("T")[0];
  const [year, month, day] = returnDate.split("-");
  const office = data.registeredOffice || {};
  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

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

  // 1) 載入主文件
  console.log("Loading main template (P.1-P.8)...");
  const mainBytes = await fetchTemplate(TEMPLATES.main);
  const mainDoc = await PDFDocument.load(mainBytes);
  fillMainDocument(mainDoc, ctx);

  // 2) 計算需要的續頁
  const isListedCo = data.companyType?.includes("上市") || data.companyType?.toLowerCase().includes("listed") || false;
  const validMembers = (data.shareholders || []).filter(sh => (Number(sh.shares) || 0) > 0);
  const naturalSecretaries = (data.secretaries || []).filter(s => s.identity === "natural");
  const corporateSecretaries = (data.secretaries || []).filter(s => s.identity === "corporate");
  const naturalDirectors = (data.directors || []).filter(d => d.identity === "natural");
  const corporateDirectors = (data.directors || []).filter(d => d.identity === "corporate");

  const attachments: Array<{ url: string; fill: (doc: PDFDocument) => void; label: string }> = [];

  // === 順序：先續頁 A/B/C/D/E，最後才放附表一 / 附表二 ===

  for (let i = 1; i < naturalSecretaries.length; i++) {
    const sec = naturalSecretaries[i];
    attachments.push({
      url: TEMPLATES.sheetA,
      fill: (doc) => fillSheetA(doc, ctx, sec),
      label: `續頁A#${i}`,
    });
  }
  for (let i = 1; i < corporateSecretaries.length; i++) {
    const sec = corporateSecretaries[i];
    attachments.push({
      url: TEMPLATES.sheetB,
      fill: (doc) => fillSheetB(doc, ctx, sec),
      label: `續頁B#${i}`,
    });
  }
  for (let i = 1; i < naturalDirectors.length; i++) {
    const dir = naturalDirectors[i];
    attachments.push({
      url: TEMPLATES.sheetC,
      fill: (doc) => fillSheetC(doc, ctx, dir),
      label: `續頁C#${i}`,
    });
  }
  const extraCorpDirs = corporateDirectors.slice(1);
  for (let i = 0; i < extraCorpDirs.length; i += 2) {
    const slice = extraCorpDirs.slice(i, i + 2);
    const pageNo = Math.floor(i / 2) + 1;
    attachments.push({
      url: TEMPLATES.sheetD,
      fill: (doc) => fillSheetD(doc, ctx, slice),
      label: `續頁D#${pageNo}(${slice.length}人)`,
    });
  }

  const validRecords = (data.companyRecords || []).filter(
    r => (r.records && r.records.trim()) || (r.address && r.address.trim())
  );
  if (validRecords.length > 0) {
    attachments.push({
      url: TEMPLATES.sheetE,
      fill: (doc) => fillSheetE(doc, ctx, validRecords),
      label: `續頁E(${validRecords.length}筆)`,
    });
  }

  // 附表一 / 附表二 — 放在所有續頁之後（最後）
  if (!isListedCo && validMembers.length > 0) {
    const totalSch1 = Math.ceil(validMembers.length / 2);
    for (let i = 0; i < totalSch1; i++) {
      const slice = validMembers.slice(i * 2, i * 2 + 2);
      const pageNo = i + 1;
      attachments.push({
        url: TEMPLATES.schedule1,
        fill: (doc) => fillSchedule1(doc, ctx, slice, pageNo, totalSch1),
        label: `附表1-${pageNo}/${totalSch1}`,
      });
    }
  }

  if (isListedCo) {
    attachments.push({
      url: TEMPLATES.schedule2,
      fill: (doc) => fillSchedule2(doc, ctx),
      label: "附表2",
    });
  }

  console.log(`Need ${attachments.length} attachment page(s): ${attachments.map(a => a.label).join(", ")}`);

  // 3) 合併附頁（每張先重命名欄位以避免衝突）
  const templateCache = new Map<string, ArrayBuffer>();
  let attIdx = 0;
  for (const att of attachments) {
    let bytes = templateCache.get(att.url);
    if (!bytes) {
      bytes = await fetchTemplate(att.url);
      templateCache.set(att.url, bytes);
    }
    const subDoc = await PDFDocument.load(bytes);
    att.fill(subDoc);
    renameAnnotationFields(subDoc, `_a${attIdx}`);

    const subPages = await mainDoc.copyPages(subDoc, subDoc.getPageIndices());
    for (const p of subPages) mainDoc.addPage(p);
    console.log(`✓ Appended ${att.label}`);
    attIdx++;
  }

  // 確保最終文件 NeedAppearances=true，讓 Reader 開啟時用 PMingLiU 渲染中文
  enableNeedAppearances(mainDoc);
  rebuildAcroFormFields(mainDoc);

  console.log("Serializing final PDF...");
  const finalBytes = await mainDoc.save({ updateFieldAppearances: false });
  console.log(`Final PDF: ${finalBytes.byteLength} bytes, ${mainDoc.getPageCount()} pages`);
  return finalBytes;
}

// === Debug 模式 ===
async function buildDebugPdf(): Promise<Uint8Array> {
  // 診斷模式：只輸出附表一 (P.9)，每個欄位填入完整欄位名稱以便視覺化對位
  const scheduleBytes = await fetchTemplate(TEMPLATES.schedule1);
  const doc = await PDFDocument.load(scheduleBytes);
  const form = doc.getForm();
  for (const field of form.getFields()) {
    const name = field.getName();
    if (name.startsWith("fill_")) {
      try {
        const tf = form.getTextField(name);
        const max = tf.getMaxLength();
        const txt = max && name.length > max ? name.slice(0, max) : name;
        tf.setText(txt);
      } catch (_) {}
    } else if (name.startsWith("cb_")) {
      try { form.getCheckBox(name).check(); } catch (_) {}
    }
  }
  return await doc.save();
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

    if (requestBody.debugMode === true) {
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
