import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, PDFName, PDFString, PDFHexString, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

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
  schedule1: `${TEMPLATE_BASE}/NAR1_p9.pdf`,           // 附表 1 - 非上市成員
  schedule2: `${TEMPLATE_BASE}/NAR1_p10.pdf`,          // 附表 2 - 上市公司成員
  sheetA: `${TEMPLATE_BASE}/NAR1_p11.pdf`,             // 續頁 A - 額外自然人秘書
  sheetB: `${TEMPLATE_BASE}/NAR1_p12.pdf`,             // 續頁 B - 額外法人秘書
  sheetC: `${TEMPLATE_BASE}/NAR1_p13.pdf`,             // 續頁 C - 額外自然人董事
  sheetD: `${TEMPLATE_BASE}/NAR1_p14.pdf`,             // 續頁 D - 額外法人董事
  sheetE: `${TEMPLATE_BASE}/NAR1_p15.pdf`,             // 續頁 E - 待定
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

// === Helper: 在 PDFDocument 上建立可重複使用的 fill / check 工具 ===
function createFormHelpers(pdfDoc: PDFDocument, helv: any) {
  const form = pdfDoc.getForm();

  // 開啟 NeedAppearances 給 CJK
  try {
    const acroForm = form.acroForm.dict;
    acroForm.set(PDFName.of('NeedAppearances'), pdfDoc.context.obj(true));
  } catch (_) { /* ignore */ }

  const isAsciiOnly = (s: string) => /^[\x00-\x7F]*$/.test(s);

  const safeSetText = (fieldName: string, value: string) => {
    try {
      const field = form.getTextField(fieldName);
      let textToSet = value ?? "";
      const maxLength = field.getMaxLength();
      if (maxLength && textToSet.length > maxLength) textToSet = textToSet.slice(0, maxLength);

      if (isAsciiOnly(textToSet)) {
        field.setText(textToSet);
        try { field.updateAppearances(helv); } catch (_) { /* ignore */ }
      } else {
        const dict = field.acroField.dict;
        dict.set(PDFName.of('V'), PDFHexString.fromText(textToSet));
        dict.delete(PDFName.of('AP'));
        for (const widget of field.acroField.getWidgets()) {
          widget.dict.delete(PDFName.of('AP'));
        }
      }
      return true;
    } catch (e) {
      console.warn(`⚠ Missing field: ${fieldName}`);
      return false;
    }
  };

  const safeCheck = (fieldName: string, shouldCheck: boolean) => {
    if (!shouldCheck) return false;
    try { form.getCheckBox(fieldName).check(); return true; }
    catch (_) { return false; }
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
function fillMainDocument(pdfDoc: PDFDocument, ctx: CommonCtx, helv: any) {
  const { br8, day, month, year, data, office, shareInfos } = ctx;
  const { safeSetText, safeCheck, form } = createFormHelpers(pdfDoc, helv);

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

// ========== 附表 1 (P.9): 兩位股東 ==========
function fillSchedule1(pdfDoc: PDFDocument, ctx: CommonCtx, members: ShareholderData[], pageNo: number, totalPages: number, helv: any) {
  const { br8, day, month, year, shareInfos } = ctx;
  const { safeSetText } = createFormHelpers(pdfDoc, helv);

  safeSetText("fill_1_P.9", day || "");
  safeSetText("fill_2_P.9", month || "");
  safeSetText("fill_3_P.9", year || "");
  safeSetText("fill_4_P.9", br8);
  const firstShareInfo = shareInfos[0];
  if (firstShareInfo) {
    safeSetText("fill_5_P.9", firstShareInfo.className);
    safeSetText("fill_6_P.9", fmtInt(firstShareInfo.shares));
  }

  const fillMember = (sh: ShareholderData, slot: 1 | 2) => {
    const isCorp = sh.identity === "corporate";
    const fullName = sh.nameEnglish || sh.name || "";
    const { surname, otherNames } = parseEnglishName(fullName);
    const addr = parseAddress(sh.address || "");
    if (slot === 1) {
      safeSetText("fill_7_P.9", sh.nameChinese || "");
      if (isCorp) safeSetText("fill_10_P.9", fullName);
      else { safeSetText("fill_8_P.9", surname); safeSetText("fill_9_P.9", otherNames); }
      safeSetText("fill_11_P.9", addr.flat);
      safeSetText("fill_12_P.9", addr.building);
      safeSetText("fill_13_P.9", addr.street);
      safeSetText("fill_14_P.9", addr.district);
      safeSetText("fill_15_P.9", addr.country);
      safeSetText("fill_16_P.9", fmtInt(Number(sh.shares) || 0));
    } else {
      safeSetText("fill_18_P.9", sh.nameChinese || "");
      if (isCorp) safeSetText("fill_21_P.9", fullName);
      else { safeSetText("fill_19_P.9", surname); safeSetText("fill_20_P.9", otherNames); }
      safeSetText("fill_22_P.9", addr.flat);
      safeSetText("fill_23_P.9", addr.building);
      safeSetText("fill_24_P.9", addr.street);
      safeSetText("fill_25_P.9", addr.district);
      safeSetText("fill_26_P.9", addr.country);
      safeSetText("fill_27_P.9", fmtInt(Number(sh.shares) || 0));
    }
  };

  if (members[0]) fillMember(members[0], 1);
  if (members[1]) fillMember(members[1], 2);
  safeSetText("fill_29_P.9", String(pageNo));
  safeSetText("fill_30_P.9", String(totalPages));
}

// ========== 附表 2 (P.10): 上市公司 ==========
function fillSchedule2(pdfDoc: PDFDocument, ctx: CommonCtx, helv: any) {
  const { br8, day, month, year } = ctx;
  const { safeSetText } = createFormHelpers(pdfDoc, helv);
  safeSetText("fill_1_P.10", day || "");
  safeSetText("fill_2_P.10", month || "");
  safeSetText("fill_3_P.10", year || "");
  safeSetText("fill_4_P.10", br8);
}

// ========== 續頁 A (P.11): 額外自然人秘書 ==========
function fillSheetA(pdfDoc: PDFDocument, ctx: CommonCtx, sec: OfficerData, helv: any) {
  const { br8, day, month, year } = ctx;
  const { safeSetText } = createFormHelpers(pdfDoc, helv);
  safeSetText("fill_1_P.11", day || "");
  safeSetText("fill_2_P.11", month || "");
  safeSetText("fill_3_P.11", year || "");
  safeSetText("fill_4_P.11", br8);

  const { surname, otherNames } = parseEnglishName(sec.nameEnglish);
  safeSetText("fill_5_P.11", sec.nameChinese || "");
  safeSetText("fill_6_P.11", surname);
  safeSetText("fill_7_P.11", otherNames);
  const addr = parseAddress(sec.address || '');
  safeSetText("fill_12_P.11", addr.flat);
  safeSetText("fill_13_P.11", addr.building);
  safeSetText("fill_14_P.11", addr.street);
  safeSetText("fill_15_P.11", addr.district);
  safeSetText("fill_16_P.11", sec.email || "");
  const hkid = parseHkidPartial(sec.idNumber || '');
  if (hkid) safeSetText("fill_17_P.11", hkid);
}

// ========== 續頁 B (P.12): 額外法人秘書 ==========
function fillSheetB(pdfDoc: PDFDocument, ctx: CommonCtx, sec: OfficerData, helv: any) {
  const { br8, day, month, year } = ctx;
  const { safeSetText } = createFormHelpers(pdfDoc, helv);
  safeSetText("fill_1_P.12", day || "");
  safeSetText("fill_2_P.12", month || "");
  safeSetText("fill_3_P.12", year || "");
  safeSetText("fill_4_P.12", br8);

  safeSetText("fill_5_P.12", sec.nameChinese || "");
  safeSetText("fill_6_P.12", sec.nameEnglish || "");
  const addr = parseAddress(sec.address || '');
  safeSetText("fill_7_P.12", addr.flat);
  safeSetText("fill_8_P.12", addr.building);
  safeSetText("fill_9_P.12", addr.street);
  safeSetText("fill_10_P.12", addr.district);
  safeSetText("fill_11_P.12", sec.email || "");
  safeSetText("fill_12_P.12", sec.companyNumberRef || sec.brNumber || "");
}

// ========== 續頁 C (P.13): 額外自然人董事 ==========
function fillSheetC(pdfDoc: PDFDocument, ctx: CommonCtx, dir: OfficerData, helv: any) {
  const { br8, day, month, year, office } = ctx;
  const { safeSetText, safeCheck } = createFormHelpers(pdfDoc, helv);
  safeSetText("fill_1_P.13", day || "");
  safeSetText("fill_2_P.13", month || "");
  safeSetText("fill_3_P.13", year || "");
  safeSetText("fill_4_P.13", br8);

  const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
  safeCheck("cb_1_P.13", true);
  safeSetText("fill_6_P.13", dir.nameChinese || "");
  safeSetText("fill_7_P.13", surname);
  safeSetText("fill_8_P.13", otherNames);
  safeSetText("fill_13_P.13", office.flat || "");
  safeSetText("fill_14_P.13", office.building || "");
  safeSetText("fill_15_P.13", office.street || "");
  safeSetText("fill_16_P.13", office.district || "");
  safeSetText("fill_17_P.13", office.region || "");
  safeSetText("fill_18_P.13", dir.email || "");
  const hkid = parseHkidPartial(dir.idNumber || '');
  if (hkid) {
    safeSetText("fill_19_P.13", hkid);
  } else if (dir.passportNumber) {
    safeSetText("fill_20_P.13", dir.nationality || dir.placeIncorporated || "");
    safeSetText("fill_21_P.13", parsePassportPartial(dir.passportNumber));
  }
}

// ========== 續頁 D (P.14): 額外法人董事 ==========
function fillSheetD(pdfDoc: PDFDocument, ctx: CommonCtx, dir: OfficerData, helv: any) {
  const { br8, day, month, year, office } = ctx;
  const { safeSetText, safeCheck } = createFormHelpers(pdfDoc, helv);
  safeSetText("fill_1_P.14", day || "");
  safeSetText("fill_2_P.14", month || "");
  safeSetText("fill_3_P.14", year || "");
  safeSetText("fill_4_P.14", br8);

  safeCheck("cb_1_P.14", true);
  safeSetText("fill_6_P.14", dir.nameChinese || "");
  safeSetText("fill_7_P.14", dir.nameEnglish || "");
  safeSetText("fill_8_P.14", office.flat || "");
  safeSetText("fill_9_P.14", office.building || "");
  safeSetText("fill_10_P.14", office.street || "");
  safeSetText("fill_11_P.14", office.district || "");
  safeSetText("fill_12_P.14", office.region || "");
  safeSetText("fill_13_P.14", dir.email || "");
  safeSetText("fill_14_P.14", dir.companyNumberRef || dir.brNumber || "");
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

  // 1) 載入主文件
  console.log("Loading main template (P.1-P.8)...");
  const mainBytes = await fetchTemplate(TEMPLATES.main);
  const mainDoc = await PDFDocument.load(mainBytes);
  const helv = await mainDoc.embedFont(StandardFonts.Helvetica);
  fillMainDocument(mainDoc, ctx, helv);

  // 2) 計算需要的續頁
  const isListedCo = data.companyType?.includes("上市") || data.companyType?.toLowerCase().includes("listed") || false;
  const validMembers = (data.shareholders || []).filter(sh => (Number(sh.shares) || 0) > 0);
  const naturalSecretaries = (data.secretaries || []).filter(s => s.identity === "natural");
  const corporateSecretaries = (data.secretaries || []).filter(s => s.identity === "corporate");
  const naturalDirectors = (data.directors || []).filter(d => d.identity === "natural");
  const corporateDirectors = (data.directors || []).filter(d => d.identity === "corporate");

  // 附加文件清單，順序：附表 1 → 附表 2 → 續頁 A → B → C → D
  const attachments: Array<{ url: string; fill: (doc: PDFDocument, helv: any) => void; label: string }> = [];

  // 附表 1：非上市公司，每頁 2 位股東
  if (!isListedCo && validMembers.length > 0) {
    const totalSch1 = Math.ceil(validMembers.length / 2);
    for (let i = 0; i < totalSch1; i++) {
      const slice = validMembers.slice(i * 2, i * 2 + 2);
      const pageNo = i + 1;
      attachments.push({
        url: TEMPLATES.schedule1,
        fill: (doc, h) => fillSchedule1(doc, ctx, slice, pageNo, totalSch1, h),
        label: `附表1-${pageNo}/${totalSch1}`,
      });
    }
  }

  // 附表 2：上市公司
  if (isListedCo) {
    attachments.push({
      url: TEMPLATES.schedule2,
      fill: (doc, h) => fillSchedule2(doc, ctx, h),
      label: "附表2",
    });
  }

  // 續頁 A：第二位起的自然人秘書
  for (let i = 1; i < naturalSecretaries.length; i++) {
    const sec = naturalSecretaries[i];
    attachments.push({
      url: TEMPLATES.sheetA,
      fill: (doc, h) => fillSheetA(doc, ctx, sec, h),
      label: `續頁A#${i}`,
    });
  }
  // 續頁 B：第二位起的法人秘書
  for (let i = 1; i < corporateSecretaries.length; i++) {
    const sec = corporateSecretaries[i];
    attachments.push({
      url: TEMPLATES.sheetB,
      fill: (doc, h) => fillSheetB(doc, ctx, sec, h),
      label: `續頁B#${i}`,
    });
  }
  // 續頁 C：第二位起的自然人董事
  for (let i = 1; i < naturalDirectors.length; i++) {
    const dir = naturalDirectors[i];
    attachments.push({
      url: TEMPLATES.sheetC,
      fill: (doc, h) => fillSheetC(doc, ctx, dir, h),
      label: `續頁C#${i}`,
    });
  }
  // 續頁 D：第二位起的法人董事
  for (let i = 1; i < corporateDirectors.length; i++) {
    const dir = corporateDirectors[i];
    attachments.push({
      url: TEMPLATES.sheetD,
      fill: (doc, h) => fillSheetD(doc, ctx, dir, h),
      label: `續頁D#${i}`,
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
    const subHelv = await subDoc.embedFont(StandardFonts.Helvetica);
    att.fill(subDoc, subHelv);
    // Flatten：把 form fields 燒進頁面，避免和主文件 / 其他續頁重名衝突
    try {
      subDoc.getForm().flatten();
    } catch (e) {
      console.warn(`⚠ flatten failed for ${att.label}:`, e);
    }
    // 把該文件所有頁面複製到主文件尾端
    const subPages = await mainDoc.copyPages(subDoc, subDoc.getPageIndices());
    for (const p of subPages) mainDoc.addPage(p);
    console.log(`✓ Appended ${att.label}`);
  }

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
