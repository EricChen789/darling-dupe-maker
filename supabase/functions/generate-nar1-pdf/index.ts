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

const TEMPLATE_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/storage/v1/object/public/pdf-templates/NAR1-template-v2.pdf";

async function loadPdfTemplate(): Promise<ArrayBuffer> {
  console.log("Loading NAR1 PDF template...");
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) throw new Error(`Failed to load PDF template: ${response.status}`);
  return await response.arrayBuffer();
}

async function listAllFormFields(): Promise<{ fields: Array<{name: string; type: string}> }> {
  const templateBytes = await loadPdfTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const allFields = form.getFields();
  const fields = allFields.map(f => ({ name: f.getName(), type: f.constructor.name }));
  fields.sort((a, b) => a.name.localeCompare(b.name));
  return { fields };
}

// 英文姓名解析：
// - 支援 "SURNAME, GIVEN NAMES"（逗號分隔）格式
// - 也支援港式 "SURNAME GIVEN NAMES"（純空白分隔，姓氏在最前）
// - 自動去除多餘逗號 / 空白，避免欄位出現前置逗號
const parseEnglishName = (fullName: string) => {
  const cleaned = (fullName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { surname: "", otherNames: "" };
  // 先嘗試以逗號切分（最常見的香港股東格式：CHAN, YING CHUNG）
  if (cleaned.includes(",")) {
    const segs = cleaned.split(",").map(s => s.trim()).filter(Boolean);
    if (segs.length >= 2) {
      return { surname: segs[0], otherNames: segs.slice(1).join(" ") };
    }
    if (segs.length === 1) {
      return { surname: segs[0], otherNames: "" };
    }
  }
  // 退回空白分隔
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { surname: "", otherNames: "" };
  const surname = parts[0].replace(/,+$/g, "");
  const otherNames = parts.slice(1).join(" ").replace(/^,+\s*/, "");
  return { surname, otherNames };
};

// 數字千分位 + 兩位小數
const fmtAmount = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("en-US");

// Parse a full address string into components.
// 智能識別：Flat/Room/Unit/Shop/Floor 等開頭的前綴會聚合為「flat」，
// 即使其中含有逗號（如 "Shop 3, 1/F"）。最後 1-2 段為地區/國家。
const ADDR_FLAT_RE = /^(?:flat|room|rm|unit|shop|suite|ste|workshop|portion|floor|fl|\d+\/f|g\/f|gf|lg\/f|ug\/f|m\/f|b\d*\/f)\b/i;
const ADDR_COUNTRY_RE = /^(hong\s*kong|hk|china|prc|macau|macao|singapore|taiwan|united\s+\w+|usa|uk|canada|australia|japan|korea|h\.?k\.?\s*sar)$/i;
const ADDR_DISTRICT_HINTS = /(kowloon|hong\s*kong|new\s*territories|n\.t\.|island|wan\s*chai|central|tsim|mong\s*kok|sham\s*shui|kwun\s*tong|sha\s*tin|tai\s*po|tuen\s*mun|yuen\s*long|tsuen\s*wan|kwai\s*tsing|sai\s*kung|north\s*district|southern\s*district|eastern\s*district)/i;

const parseAddress = (addr: string) => {
  if (!addr) return { flat: '', building: '', street: '', district: '', country: '' };
  let parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return { flat: '', building: '', street: '', district: '', country: '' };
  if (parts.length === 1) return { flat: '', building: '', street: parts[0], district: '', country: '' };

  // 1) 從尾部抽出 country
  let country = '';
  if (ADDR_COUNTRY_RE.test(parts[parts.length - 1])) {
    country = parts.pop()!;
  }
  // 2) 從尾部抽出 district
  let district = '';
  if (parts.length > 1 && (ADDR_DISTRICT_HINTS.test(parts[parts.length - 1]) || parts.length >= 3)) {
    district = parts.pop()!;
  }
  // 3) 從頭部聚合 flat（連續的 Flat/Floor/Shop 段落）
  const flatParts: string[] = [];
  while (parts.length > 1 && ADDR_FLAT_RE.test(parts[0])) {
    flatParts.push(parts.shift()!);
  }
  const flat = flatParts.join(', ');
  // 4) 剩下的：第一段 = building，其餘 = street
  const building = parts.shift() || '';
  const street = parts.join(', ');

  return { flat, building, street, district, country };
};

// HKID：NAR1 表格需填入完整身分證號碼（例：A123456(7)）。
// 只負責標準化格式，不做任何遮罩。
const parseHkidPartial = (idNumber: string) => {
  if (!idNumber) return '';
  const cleaned = idNumber.replace(/\s+/g, '').toUpperCase();
  const m = cleaned.match(/^([A-Z]{1,2})(\d{6})\(?(\d|A)\)?$/);
  if (m) return `${m[1]}${m[2]}(${m[3]})`;
  return idNumber.trim();
};

async function fillPdfTemplate(data: CompanyData, debugMode = false): Promise<Uint8Array> {
  console.log("Loading and filling PDF template...");
  const templateBytes = await loadPdfTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  if (debugMode) {
    const fields = form.getFields();
    for (const field of fields) {
      const name = field.getName();
      if (name.startsWith("fill_")) {
        try {
          const textField = form.getTextField(name);
          const maxLength = textField.getMaxLength();
          const match = name.match(/fill_(\d+)_P\.(\d+)/);
          let textToSet = match ? `${match[1]}.${match[2]}` : name.slice(0, 8);
          if (maxLength && textToSet.length > maxLength) textToSet = match ? match[1] : textToSet.slice(0, maxLength);
          textField.setText(textToSet);
        } catch (e) { console.warn(`⚠ ${name}`, e); }
      } else if (name.startsWith("cb_")) {
        try { form.getCheckBox(name).check(); } catch (e) { console.warn(`⚠ ${name}`, e); }
      }
    }
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  }

  // 嵌入標準 Helvetica 字型，用於 ASCII 文字欄位的 appearance 重繪。
  // CJK 文字仍維持「不嵌入字型」由 PDF viewer 用系統字型渲染。
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const returnDate = data.returnDate || new Date().toISOString().split("T")[0];
  const [year, month, day] = returnDate.split("-");
  const office = data.registeredOffice || {};

  const isAsciiOnly = (s: string) => /^[\x00-\x7F]*$/.test(s);

  const safeSetText = (fieldName: string, value: string) => {
    try {
      const field = form.getTextField(fieldName);
      let textToSet = value ?? "";
      const maxLength = field.getMaxLength();
      if (maxLength && textToSet.length > maxLength) textToSet = textToSet.slice(0, maxLength);

      if (isAsciiOnly(textToSet)) {
        // 純 ASCII：setText + 用嵌入的 Helvetica 立即更新 appearance
        // （不依賴 viewer 的 NeedAppearances，避免模板自訂 encoding 干擾）
        field.setText(textToSet);
        try { field.updateAppearances(helv); } catch (_) { /* ignore */ }
      } else {
        // 含中文：用 hex string (UTF-16BE) 並刪除 appearance stream，
        // 配合 NeedAppearances=true，由 PDF viewer 用系統字型重繪
        const dict = field.acroField.dict;
        dict.set(PDFName.of('V'), PDFHexString.fromText(textToSet));
        dict.delete(PDFName.of('AP'));
      }
      return true;
    } catch (e) {
      console.warn(`⚠ Missing: ${fieldName}`, e);
      return false;
    }
  };

  // 仍保留 NeedAppearances=true 給 CJK 欄位
  try {
    const acroForm = form.acroForm.dict;
    acroForm.set(PDFName.of('NeedAppearances'), pdfDoc.context.obj(true));
  } catch (e) {
    console.warn('⚠ Could not set NeedAppearances', e);
  }

  const safeCheck = (fieldName: string, shouldCheck: boolean) => {
    if (!shouldCheck) return false;
    try { form.getCheckBox(fieldName).check(); return true; }
    catch (e) { return false; }
  };

  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

  // ============ Page 1 - Company Info ============
  safeSetText("fill_1_P.1", br8);
  // Box 1 公司名稱 - 英文在上、中文在下（用換行）
  const fullCompanyName = [data.name, data.chineseName].filter(Boolean).join("\n");
  safeSetText("fill_2_P.1", fullCompanyName);
  // Box 2 商業名稱 Trading Name (Business Name)
  safeSetText("fill_3_P.1", data.tradingName || "");
  safeCheck("cb_1_P.1", data.companyType?.includes("私人") || data.companyType?.toLowerCase().includes("private") || false);
  safeCheck("cb_2_P.1", data.companyType?.includes("公眾") || data.companyType?.toLowerCase().includes("public") || false);
  safeCheck("cb_3_P.1", data.companyType?.includes("擔保") || false);
  // Box 9 業務性質 -> 4=Code, 5=Description
  safeSetText("fill_4_P.1", data.businessCode || "");
  safeSetText("fill_5_P.1", data.businessNature || "");
  // Box 4 結算日期 dd/mm/yyyy -> 6/7/8
  safeSetText("fill_6_P.1", day || "");
  safeSetText("fill_7_P.1", month || "");
  safeSetText("fill_8_P.1", year || "");
  // Box 6 註冊地址 -> 15/16/17/18
  safeSetText("fill_15_P.1", office.flat || "");
  safeSetText("fill_16_P.1", office.building || "");
  safeSetText("fill_17_P.1", office.street || "");
  safeSetText("fill_18_P.1", office.district || "");

  // Region dropdown on Page 1
  if (office.region) {
    try {
      const dropdown = form.getDropdown("Dropdown1_P.1");
      const options = dropdown.getOptions();
      const match = options.find((o: string) => office.region!.includes(o) || o.includes(office.region!));
      if (match) dropdown.select(match);
    } catch (e) {
      console.warn("⚠ Region dropdown not found on P.1", e);
    }
  }

  // Page 1 - Presenter's Reference block (bottom-left of page 1)
  // 19=Name, 20=Address, 21=Tel, 22=Fax, 23=Email, 24=Reference
  const presenterP1 = data.presenter || {};
  if (presenterP1.name) safeSetText("fill_19_P.1", presenterP1.name);
  if (presenterP1.address) safeSetText("fill_20_P.1", presenterP1.address);
  if (presenterP1.phone) safeSetText("fill_21_P.1", presenterP1.phone);
  if (presenterP1.fax) safeSetText("fill_22_P.1", presenterP1.fax);
  if (presenterP1.email) safeSetText("fill_23_P.1", presenterP1.email);
  if (presenterP1.reference) safeSetText("fill_24_P.1", presenterP1.reference);

  // ============ Page 2 - Share Capital ============
  safeSetText("fill_1_P.2", br8);
  // fill_2_P.2 = Email, fill_3_P.2 = Phone (after +852) — leave blank unless company-level data
  // fill_4_P.2 = Mortgages amount, fill_5_P.2 = Number of members (no share capital co)

  // Aggregate shareholdings by share-class + currency + issue price (任意組合)
  type ShareInfo = {
    className: string;
    currency: string;
    issuePrice: number;
    shares: number;
    paidUp: number;
    unpaid: number;
  };
  const shareTypeMap = new Map<string, ShareInfo>();

  // 將任意輸入正規化為 NAR1 顯示用的類別名（保留用戶自訂名稱）
  const normalizeClassName = (raw: string) => {
    const t = (raw || "").trim();
    if (!t) return "ORDINARY SHARES";
    // 常見簡寫展開
    if (/^ord(inary)?$/i.test(t) || t.includes("普通")) return "ORDINARY SHARES";
    if (/^pref(erence)?$/i.test(t) || t.includes("優先")) return "PREFERENCE SHARES";
    return t.toUpperCase();
  };
  // 顯示貨幣（含 $ 號，符合 NAR1 正本格式）
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

  for (const sh of data.shareholders || []) {
    const className = normalizeClassName(sh.shareType || "");
    const currency = formatCurrency(sh.currency || "");
    const issuePrice = toNum(sh.issuePrice);
    const key = `${className}||${currency}||${issuePrice}`;
    if (!shareTypeMap.has(key)) {
      shareTypeMap.set(key, {
        className,
        currency,
        issuePrice,
        shares: 0,
        paidUp: 0,
        unpaid: 0,
      });
    }
    const info = shareTypeMap.get(key)!;
    info.shares += Number(sh.shares) || 0;
    info.paidUp += toNum(sh.paidUp);
    info.unpaid += toNum(sh.unpaid);
  }

  // Page 2 share capital table: 5 cols × 4 data rows + totals row
  // Row 1: 6,7,8,9,10  Row 2: 11..15  Row 3: 16..20  Row 4: 21..25
  // Totals row: -, 26 (currency), 27 (total shares), 28 (total amount), 29 (total paid-up)
  const shareInfos = Array.from(shareTypeMap.values());
  let totalShares = 0;
  let totalAmountSum = 0;
  let totalPaidUpSum = 0;
  let firstCurrency = "";
  for (let i = 0; i < Math.min(4, shareInfos.length); i++) {
    const info = shareInfos[i];
    const base = 6 + i * 5;
    // 總發行金額：優先用 paid_up + unpaid（實際面值），否則退回 issuePrice * shares
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

  // ============ Page 3 - Secretary (Natural Person) 12A ============
  safeSetText("fill_1_P.3", br8);
  const naturalSecretaries = (data.secretaries || []).filter(s => s.identity === "natural");
  if (naturalSecretaries.length > 0) {
    const sec = naturalSecretaries[0];
    const { surname, otherNames } = parseEnglishName(sec.nameEnglish);
    safeSetText("fill_2_P.3", sec.nameChinese || "");
    safeSetText("fill_3_P.3", surname);
    safeSetText("fill_4_P.3", otherNames);
    // Address
    const addr = parseAddress(sec.address || '');
    safeSetText("fill_9_P.3", addr.flat);
    safeSetText("fill_10_P.3", addr.building);
    safeSetText("fill_11_P.3", addr.street);
    safeSetText("fill_12_P.3", addr.district);
    safeSetText("fill_13_P.3", sec.email || "");
    // HKID partial
    const hkid = parseHkidPartial(sec.idNumber || '');
    if (hkid) safeSetText("fill_14_P.3", hkid);
    console.log(`Filled Secretary (Natural): ${sec.nameEnglish || sec.nameChinese}`);
  }

  // ============ Page 4 - Secretary (Body Corporate) 12B ============
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
    // 信託或公司服務提供者牌照編號（如為 TCSP 持牌人）
    const tcsp = sec.tcspNumber || (sec as any).licenceNumber || "";
    if (tcsp) {
      safeSetText("fill_10_P.4", tcsp);
    }
    console.log(`Filled Secretary (Corporate): ${sec.nameEnglish || sec.nameChinese}`);
  }

  // ============ Page 5 - Director (Natural Person) 13A ============
  // 對照: BR=1, 代替=2, 中文姓名=3, 姓氏=4, 名字=5, 前用中=6, 前用英=7, 別名中=8, 別名英=9,
  //       flat=10, building=11, street=12, district=13, country=14, email=15, hkid=16,
  //       passport_country=17, passport_no=18
  safeSetText("fill_1_P.5", br8);
  const naturalDirectors = (data.directors || []).filter(d => d.identity === "natural");
  if (naturalDirectors.length > 0) {
    const dir = naturalDirectors[0];
    const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
    safeCheck("cb_1_P.5", true);
    safeSetText("fill_3_P.5", dir.nameChinese || "");
    safeSetText("fill_4_P.5", surname);
    safeSetText("fill_5_P.5", otherNames);
    // 董事住址統一使用公司註冊地址
    safeSetText("fill_10_P.5", office.flat || "");
    safeSetText("fill_11_P.5", office.building || "");
    safeSetText("fill_12_P.5", office.street || "");
    safeSetText("fill_13_P.5", office.district || "");
    safeSetText("fill_14_P.5", office.region || "");
    safeSetText("fill_15_P.5", dir.email || "");
    const hkid = parseHkidPartial(dir.idNumber || '');
    if (hkid) safeSetText("fill_16_P.5", hkid);
    console.log(`Filled Director (Natural): ${dir.nameEnglish || dir.nameChinese}`);
  }

  // ============ Page 6 - Director (Body Corporate) 13B ============
  // 對照: BR=1, 代替=2, 中文=3, 英=4, flat=5, building=6, street=7, district=8, country=9, email=10, BR=11
  // 第二董事: 12=代替, 13=中文, 14=英, 15-19=地址, 20=email, 21=BR
  safeSetText("fill_1_P.6", br8);
  const corporateDirectors = (data.directors || []).filter(d => d.identity === "corporate");
  if (corporateDirectors.length > 0) {
    const dir = corporateDirectors[0];
    safeCheck("cb_1_P.6", true);
    safeSetText("fill_3_P.6", dir.nameChinese || "");
    safeSetText("fill_4_P.6", dir.nameEnglish || "");
    // 法人董事住址統一使用公司註冊地址
    safeSetText("fill_5_P.6", office.flat || "");
    safeSetText("fill_6_P.6", office.building || "");
    safeSetText("fill_7_P.6", office.street || "");
    safeSetText("fill_8_P.6", office.district || "");
    safeSetText("fill_9_P.6", office.region || "");
    safeSetText("fill_10_P.6", dir.email || "");
    safeSetText("fill_11_P.6", dir.companyNumberRef || dir.brNumber || "");
    console.log(`Filled Director (Corporate): ${dir.nameEnglish || dir.nameChinese}`);
  }



  // ============ Page 9 - Schedule 1: Members (Non-listed Co), 2 per page ============
  // Header: 1=day, 2=month, 3=year, 4=BR, 5=Class of Shares, 6=Total issued shares of class
  // Member 1: 7=name_chinese, 8=surname, 9=other_names, 10=full_name_alt,
  //           11=flat, 12=building, 13=street, 14=district, 15=country, 16=shares_held, 17=remarks
  // Member 2: 18=name_chinese, 19=surname, 20=other_names, 21=full_name_alt,
  //           22=flat, 23=building, 24=street, 25=district, 26=country, 27=shares_held, 28=remarks
  // Footer: 29=schedule page no, 30=total schedule pages
  safeSetText("fill_1_P.9", day || "");
  safeSetText("fill_2_P.9", month || "");
  safeSetText("fill_3_P.9", year || "");
  safeSetText("fill_4_P.9", br8);

  // Pick the first share-class info for header (most common case: single class)
  const firstShareInfo = shareInfos[0];
  if (firstShareInfo) {
    // 附表一格式：「ORDINARY SHARES (HK$)」
    safeSetText("fill_5_P.9", `${firstShareInfo.className} (${firstShareInfo.currency})`);
    safeSetText("fill_6_P.9", fmtInt(firstShareInfo.shares));
  }

  // Fill up to 2 members on page 9 (template only contains one schedule page)
  const fillMember = (sh: ShareholderData, slot: 1 | 2) => {
    const isCorp = sh.identity === "corporate";
    const fullName = sh.nameEnglish || sh.name || "";
    const { surname, otherNames } = parseEnglishName(fullName);
    const addr = parseAddress(sh.address || "");
    if (slot === 1) {
      safeSetText("fill_7_P.9", sh.nameChinese || "");
      if (isCorp) {
        safeSetText("fill_10_P.9", fullName);
      } else {
        safeSetText("fill_8_P.9", surname);
        safeSetText("fill_9_P.9", otherNames);
      }
      safeSetText("fill_11_P.9", addr.flat);
      safeSetText("fill_12_P.9", addr.building);
      safeSetText("fill_13_P.9", addr.street);
      safeSetText("fill_14_P.9", addr.district);
      safeSetText("fill_15_P.9", addr.country);
      safeSetText("fill_16_P.9", fmtInt(Number(sh.shares) || 0));
    } else {
      safeSetText("fill_18_P.9", sh.nameChinese || "");
      if (isCorp) {
        safeSetText("fill_21_P.9", fullName);
      } else {
        safeSetText("fill_19_P.9", surname);
        safeSetText("fill_20_P.9", otherNames);
      }
      safeSetText("fill_22_P.9", addr.flat);
      safeSetText("fill_23_P.9", addr.building);
      safeSetText("fill_24_P.9", addr.street);
      safeSetText("fill_25_P.9", addr.district);
      safeSetText("fill_26_P.9", addr.country);
      safeSetText("fill_27_P.9", fmtInt(Number(sh.shares) || 0));
    }
  };

  const memberList = (data.shareholders || []).slice(0, 2);
  if (memberList[0]) fillMember(memberList[0], 1);
  if (memberList[1]) fillMember(memberList[1], 2);
  safeSetText("fill_29_P.9", "1");
  safeSetText("fill_30_P.9", "1");

  // ============ Pages 7 - Reserve Director (BR header only) ============
  safeSetText("fill_1_P.7", br8);

  // ============ Page 8 - Members + Records + Statement + Signature (正本第8頁) ============
  // 對照: BR=1, records列1=2, address列1=3, 續頁A=4, B=5, C=6, D=7, E=8,
  //       附表一=9, 附表二=10, 簽署/姓名=11, 日期=12
  safeSetText("fill_1_P.8", br8);
  // 14 ☑ 非上市公司成員詳情列於附表一
  safeCheck("cb_1_P.8", true);
  // 16 ☑ 私人公司陳述
  safeCheck("cb_4_P.8",
    (data.companyType?.includes("私人") || data.companyType?.toLowerCase().includes("private")) || false);

  // 續頁頁數
  const presenter = data.presenter || {};
  const naturalSecCount = (data.secretaries || []).filter(s => s.identity === "natural").length;
  const corpSecCount = (data.secretaries || []).filter(s => s.identity === "corporate").length;
  const naturalDirCount = (data.directors || []).filter(d => d.identity === "natural").length;
  const corpDirCount = (data.directors || []).filter(d => d.identity === "corporate").length;
  const sheetA = Math.max(0, naturalSecCount - 1); // 續頁 A: 額外自然人秘書
  const sheetB = Math.max(0, corpSecCount - 1);    // 續頁 B: 額外法人秘書
  const sheetC = Math.max(0, naturalDirCount - 1); // 續頁 C: 額外自然人董事
  const sheetD = Math.max(0, Math.ceil(Math.max(0, corpDirCount - 1) / 2)); // 續頁 D: 每頁 2 人
  const memberCount = (data.shareholders || []).length;
  const schedulePages = memberCount > 0 ? Math.ceil(memberCount / 2) : 0;
  if (sheetA > 0) safeSetText("fill_4_P.8", String(sheetA));
  if (sheetB > 0) safeSetText("fill_5_P.8", String(sheetB));
  if (sheetC > 0) safeSetText("fill_6_P.8", String(sheetC));
  if (sheetD > 0) safeSetText("fill_7_P.8", String(sheetD));
  if (schedulePages > 0) safeSetText("fill_9_P.8", String(schedulePages));

  // 簽署 / 姓名 / 日期
  if (presenter.name) safeSetText("fill_11_P.8", presenter.name);
  if (day && month && year) safeSetText("fill_12_P.8", `${day}/${month}/${year}`);

  // ============ Pages 11 - Continuation Sheet A (額外自然人秘書) ============
  // 對照: day=1, month=2, year=3, BR=4, 中文=5, 姓氏=6, 名字=7, 前用中=8, 前用英=9,
  //       別名中=10, 別名英=11, flat=12, building=13, street=14, district=15,
  //       email=16, hkid=17, passport_country=18, passport_no=19, licence=20, reason=21
  safeSetText("fill_1_P.11", day || "");
  safeSetText("fill_2_P.11", month || "");
  safeSetText("fill_3_P.11", year || "");
  safeSetText("fill_4_P.11", br8);

  // ============ Page 12 - Continuation Sheet B (額外法人秘書) ============
  safeSetText("fill_1_P.12", day || "");
  safeSetText("fill_2_P.12", month || "");
  safeSetText("fill_3_P.12", year || "");
  safeSetText("fill_4_P.12", br8);

  // ============ Page 13 - Continuation Sheet C (額外自然人董事) ============
  // 對照: day=1, month=2, year=3, BR=4, 代替=5, 中文=6, 姓氏=7, 名字=8,
  //       前用中=9, 前用英=10, 別名中=11, 別名英=12, flat=13, building=14, street=15,
  //       district=16, country=17, email=18, hkid=19, passport_country=20, passport_no=21
  safeSetText("fill_1_P.13", day || "");
  safeSetText("fill_2_P.13", month || "");
  safeSetText("fill_3_P.13", year || "");
  safeSetText("fill_4_P.13", br8);
  // 從第 2 個自然人董事開始填續頁 C（每頁一人）
  const extraDirectors = (data.directors || []).filter(d => d.identity === "natural").slice(1);
  if (extraDirectors[0]) {
    const dir = extraDirectors[0];
    const { surname, otherNames } = parseEnglishName(dir.nameEnglish);
    safeCheck("cb_1_P.13", true);
    safeSetText("fill_6_P.13", dir.nameChinese || "");
    safeSetText("fill_7_P.13", surname);
    safeSetText("fill_8_P.13", otherNames);
    // 續頁 C 額外董事住址統一使用公司註冊地址
    safeSetText("fill_13_P.13", office.flat || "");
    safeSetText("fill_14_P.13", office.building || "");
    safeSetText("fill_15_P.13", office.street || "");
    safeSetText("fill_16_P.13", office.district || "");
    safeSetText("fill_17_P.13", office.region || "");
    safeSetText("fill_18_P.13", dir.email || "");
    const hkid = parseHkidPartial(dir.idNumber || '');
    if (hkid) safeSetText("fill_19_P.13", hkid);
  }

  // ============ Page 14 - Continuation Sheet D (額外法人董事) ============
  safeSetText("fill_1_P.14", day || "");
  safeSetText("fill_2_P.14", month || "");
  safeSetText("fill_3_P.14", year || "");
  safeSetText("fill_4_P.14", br8);

  // ============ Page 15 - Schedule 2 (上市公司成員) - BR header only ============
  safeSetText("fill_1_P.15", day || "");
  safeSetText("fill_2_P.15", month || "");
  safeSetText("fill_3_P.15", year || "");
  safeSetText("fill_4_P.15", br8);

  // Keep form interactive so PDF viewer renders CJK with system fonts
  console.log("PDF filled with all data, serializing...");
  // Prevent auto updateFieldAppearances during save (would fail on CJK)
  const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  console.log(`Final PDF size: ${pdfBytes.byteLength} bytes`);
  return pdfBytes;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    
    if (requestBody.listFields === true) {
      const fields = await listAllFormFields();
      return new Response(JSON.stringify(fields, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const companyData: CompanyData = requestBody;
    const debugMode = requestBody.debugMode === true;
    console.log(`Generating PDF for: ${companyData.name} (BR: ${companyData.brNumber}) debug: ${debugMode}`);
    
    const pdfBytes = await fillPdfTemplate(companyData, debugMode);
    
    if (debugMode) {
      const base64 = uint8ToBase64(pdfBytes);
      return new Response(JSON.stringify({ pdf: base64 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
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