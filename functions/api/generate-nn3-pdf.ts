// POST /api/generate-nn3-pdf
// NN3 — Annual Return of Registered Non-Hong Kong Company (註冊非香港公司周年申報表)
//
// 策略：與 NAR1 同款 — createFormHelpers + 跨文檔 copyPages 動態續頁
//   模板內建 /PMingLiU 字體（Type0，UniCNS-UTF16-H），不嵌任何字體
//   不 flatten（18 頁 265 widgets 超出 Workers CPU 預算）
//   透過 NeedAppearances 讓 PDF 閱讀器用模板內建字體重建外觀流
//
// 模板頁結構（18 頁，widget 只在 P.1–12）：
//   P.1 公司資料+提交人 / P.2 成立地方辦事處 / P.3 授權代表（A 自然人/B 非自然人）
//   P.4 公司秘書（A 自然人/B 法人）/ P.5–6 自然人董事 #1/#2 / P.7 法人董事+股本+按揭
//   P.8 帳目+續頁計數+簽署 / P.9–12 續頁 A/B/C/D 源頁 / P.13–18 填表須知（無 widget，輸出移除）

import { PDFDocument, PDFName, PDFString, PDFHexString, PDFBool, PDFArray, PDFNumber } from "pdf-lib";
import { verifyAuthRequest, type Env } from './_auth';
import {
  corsHeaders, jsonResp, uint8ToBase64, DEFAULT_PRESENTER,
} from './_pdf-utils';
import {
  createFormHelpers, detachWidget, rebuildAcroFormFields,
  buildCjkDA, buildHelvDA, isAscii, decodePdfText,
  parseHkidPartial, parsePassportPartial,
} from './_acroform';

// ═══ 資料形狀（前端提交）═══

interface NN3OfficerData {
  nameChinese?: string;
  nameEnglish?: string;
  email?: string;
  identity: 'natural' | 'corporate';
  isAlternate?: boolean;      // 候補董事
  alternateTo?: string;       // 代替誰
  isLawFirm?: boolean;        // 授權代表（法人）：律師行
  isCpaFirm?: boolean;        // 授權代表（法人）：會計師事務所
  brNumber?: string;          // 法人 BR 號
  companyNumberRef?: string;  // 法人公司編號（fallback）
  address?: string;           // 逗號分隔整串，後端 parseAddress 拆行
  idNumber?: string;          // HKID 全號（後端取前 4 位）
  passportCountry?: string;
  passportNumber?: string;    // 後端取前半
  prevNameChinese?: string;   // 前用姓名（秘書/董事）
  prevNameEnglish?: string;
  aliasChinese?: string;      // 別名（秘書/董事）
  aliasEnglish?: string;
}

interface NN3Address {
  flat?: string;
  building?: string;
  street?: string;
  districtCityProvince?: string;
  district?: string;
  country?: string;
  region?: string;
}

interface NN3Payload {
  brNumber?: string;
  companyNameEnglish?: string;
  companyNameChinese?: string;
  returnDate?: string;          // YYYY-MM-DD（本申報表日期 = 香港註冊日期周年日）
  registrationDate?: string;    // YYYY-MM-DD（Section 3 香港註冊日期）
  placeOfIncorporation?: string;
  principalPlaceOfBusiness?: NN3Address;
  email?: string;
  phone?: string;
  officeInPlaceOfIncorporation?: NN3Address;          // P.2(a)
  principalPlaceInPlaceOfIncorporation?: NN3Address;  // P.2(b)
  emailInPlaceOfIncorporation?: string;               // P.2(c)
  presenter?: {
    name?: string;
    address?: string;
    phone?: string;
    fax?: string;
    email?: string;
    reference?: string;
  };
  authorizedReps?: NN3OfficerData[];
  secretaries?: NN3OfficerData[];
  directors?: NN3OfficerData[];
  accounts?: {
    mode: 'delivered' | 'notDelivered';
    periodFrom?: string;         // YYYY-MM-DD
    periodTo?: string;           // YYYY-MM-DD
    notDeliveredReason?: 1 | 2;  // cb_1 法域無發表要求 / cb_2 成立<18 個月
  };
  shareCapital?: {
    authorizedCurrency?: string;
    authorizedNominal?: string;
    issuedCurrency?: string;
    issuedNominal?: string;
  };
  mortgageAmount?: string;
  signer?: {
    name?: string;
    capacity?: 'director' | 'secretary' | 'manager' | 'authorizedRep';
    date?: string;               // YYYY-MM-DD，缺省 = returnDate
  };
}

// ═══ 共用工具（複製自 generate-nar1-pdf.ts，NN3 自用）═══

const CJK_RE = /[㐀-鿿豈-﫿]/;

/** 最近一個已過的香港註冊日期周年日（年度申報預設結算日） */
function computeReturnDate(registrationDate?: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  if (registrationDate) {
    let y: number, m: number, d: number;
    const iso = registrationDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      y = +iso[1]; m = +iso[2] - 1; d = +iso[3];
    } else if (registrationDate.includes('/')) {
      const parts = registrationDate.split('/');
      y = +parts[2]; m = +parts[1] - 1; d = +parts[0];
    } else {
      const dt = new Date(registrationDate);
      if (isNaN(dt.getTime())) return today.toISOString().split('T')[0];
      y = dt.getFullYear(); m = dt.getMonth(); d = dt.getDate();
    }
    const mm = String(m + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    let targetYear = currentYear;
    const candidate = new Date(targetYear, m, d);
    if (candidate > today) targetYear = currentYear - 1;
    return `${targetYear}-${mm}-${dd}`;
  }
  return today.toISOString().split('T')[0];
}

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** ISO 'YYYY-MM-DD' → [day, month, year]，無效回 null */
function splitIso(s?: string): [string, string, string] | null {
  if (!s || !isValidIsoDate(s)) return null;
  const [y, m, d] = s.split('-');
  return [d, m, y];
}

const PURE_NUMBER_RE = /^[\d,.\s]+$/;
const ADDR_FLAT_RE = /^(?:flat|room|rm|unit|shop|suite|ste|workshop|portion|all\s+that\s+portion|floor|fl|\d+\/f|g\/f|gf|lg\/f|ug\/f|m\/f|b\d*\/f)\b/i;
const ADDR_COUNTRY_RE = /(hong\s*kong|hk\b|china|prc|macau|macao|singapore|taiwan|united\s+\w+|british\s+virgin\s+islands|virgin\s+islands|b\.?\s*v\.?\s*i\.?|cayman\s+islands|\busa\b|\buk\b|canada|australia|japan|korea|h\.?k\.?\s*sar|香港|中國|澳門|台灣|新加坡|日本|韓國|英國|美國|加拿大|澳洲)/i;
const ADDR_DISTRICT_HINTS = /(kowloon|hong\s*kong|new\s*territories|n\.t\.|island|wan\s*chai|chai\s*wan|central|sheung\s*wan|tsim|mong\s*kok|sham\s*shui|kwun\s*tong|sha\s*tin|tai\s*po|tuen\s*mun|yuen\s*long|tsuen\s*wan|kwai\s*tsing|kwai\s*chung|sai\s*kung|north\s*district|southern\s*district|eastern\s*district|hung\s*hom|causeway\s*bay|quarry\s*bay|north\s*point|happy\s*valley|aberdeen|jordan|yau\s*ma\s*tei|tai\s*kok\s*tsui|to\s*kwa\s*wan|ho\s*man\s*tin|lai\s*chi\s*kok|mei\s*foo|tsing\s*yi|tseung\s*kwan\s*o|fan\s*ling|sheung\s*shui|tin\s*shui\s*wai|tung\s*chung|lantau|stanley|wong\s*tai\s*sin|lam\s*tin|kowloon\s*city|kowloon\s*bay|kowloon\s*tong|ma\s*on\s*shan|tai\s*wai|fo\s*tan|九龍|香港島|新界)/i;
/** 像街道/門牌號的段（以數字/No. 開頭或含道路類詞）— 不應被吞進「區」行 */
const ADDR_STREET_RE = /(^\s*no\.?\s*\d|^\d|[,-]\s*\d|\bstreet\b|\broad\b|\blane\b|\bavenue\b|\bdrive\b|\bcrescent\b|\bterrace\b|\bboulevard\b|\bpath\b|\bway\b)/i;
/** 大廈類詞 */
const BUILDING_WORD_RE = /\b(buildings?|mansion|mansions|houses?|centre|center|tower|plaza|estate|gardens?|court|block|factory|villa|apartments?)\b/i;
/** flat 段拆分：室號部分 + 餘下（大廈名） */
const ADDR_FLAT_SPLIT_RE = /^((?:flat|room|rm|unit|shop|suite|ste|workshop)\s*\S+(?:\s+\d+\/?f)?)(.*)$/i;

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
  if (parts.length > 1 && ADDR_DISTRICT_HINTS.test(parts[parts.length - 1])
      && !ADDR_STREET_RE.test(parts[parts.length - 1]) && !BUILDING_WORD_RE.test(parts[parts.length - 1])) {
    district = parts.pop()!;
  }
  const flatParts: string[] = [];
  while (parts.length > 0 && ADDR_FLAT_RE.test(parts[0])) flatParts.push(parts.shift()!);
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
    street = parts[0];
  } else {
    if (!building) {
      if (parts.length >= 2 && BUILDING_WORD_RE.test(parts[0]) && BUILDING_WORD_RE.test(parts[1])
          && !ADDR_STREET_RE.test(parts[1]) && !ADDR_DISTRICT_HINTS.test(parts[1])
          && !ADDR_FLAT_RE.test(parts[1])) {
        building = parts.shift() + ', ' + parts.shift();
      } else {
        building = parts.shift() || '';
      }
    }
    street = parts.join(', ');
  }
  return { flat, building, street, district, country };
};

/** 董事通訊地址 5 行：優先董事自己的地址，缺項回退公司香港主要營業地點（HK 慣例） */
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

const addr5 = (a: { flat: string; building: string; street: string; district: string; country: string }) =>
  [a.flat, a.building, a.street, a.district, a.country];
const addr4 = (a: { flat: string; building: string; street: string; district: string; country: string }) =>
  [a.flat, a.building, a.street, a.district];

// ═══ Dynamic Continuation Page Helper（複製自 generate-nar1-pdf.ts）═══
// 把模板源頁 copyPages 進主文檔，detach 全部 widget、加後綴改名、填值；
// 未匹配 widget 也改名+清空，保證副本頁不殘留模板樣本數據。

interface ContinuationSlot {
  fieldNames: string[];   // original field names on this page
  values: Record<string, string>;  // originalName → value
  checkboxes?: string[];  // checkbox names to check
}

async function addDynamicContinuationSheet(
  pdfDoc: PDFDocument,
  srcDoc: PDFDocument,
  sourcePageIndex: number,
  insertAfterIndex: number,
  slot: ContinuationSlot,
  suffix: string,
): Promise<number> {
  const [copiedPage] = await pdfDoc.copyPages(srcDoc, [sourcePageIndex]);
  const newIndex = insertAfterIndex + 1;
  pdfDoc.insertPage(newIndex, copiedPage);

  const ctx = (pdfDoc as any).context;
  const annots = copiedPage.node.lookup(PDFName.of('Annots')) as any;
  if (!annots || typeof annots.size !== 'function') return newIndex;

  let widgetCount = 0;
  let matchCount = 0;
  let failCount = 0;

  // Alias maps: _P.9 ↔ _P9（與 collectFormFields 同規則）
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

      // copyPages 後 widget Parent ref 可能斷裂（指向未複製進目標文檔的對象）
      const widgetName = decodePdfText(widget.get(PDFName.of('T')));
      const parentRef = widget.get(PDFName.of('Parent'));
      let parent = widget;
      let parentName = '';
      if (parentRef) {
        try { parent = ctx.lookup(parentRef) as any; } catch { parent = widget; }
        try { parentName = decodePdfText(parent.get(PDFName.of('T'))); } catch { parentName = ''; }
      }
      // 3 層字段層級（同 collectFormFields）
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
      if (!resolvedName || /^\d+$/.test(resolvedName)) {
        resolvedName = widgetName || resolvedName;
      }

      const matchedTextKey = allFieldNames.find(fn =>
        resolvedName === fn || resolvedName.startsWith(fn) || fn.startsWith(resolvedName)
      );
      const isCheckbox = aliasCheckboxes.some(cb =>
        resolvedName === cb || resolvedName.startsWith(cb) || cb.startsWith(resolvedName)
      );

      if (!matchedTextKey && !isCheckbox) {
        // 未填充 widget 也必須改名（加 suffix），否則副本頁與源頁同名字段
        // 會被閱讀器按字段名合併 → 源頁已填值串到副本頁
        detachWidget(widget, parent);
        widget.set(PDFName.of('T'), PDFString.of(`${resolvedName}_${suffix}`));
        const ft2 = widget.get(PDFName.of('FT'));
        if (ft2 && String(ft2) === '/Tx') {
          widget.set(PDFName.of('V'), PDFString.of(''));
          widget.delete(PDFName.of('AP'));
        }
        continue;
      }

      matchCount++;

      detachWidget(widget, parent);
      const newName = `${resolvedName}_${suffix}`;
      widget.set(PDFName.of('T'), PDFString.of(newName));

      const ft = widget.get(PDFName.of('FT'));
      const ftStr = ft ? String(ft) : '';

      if (ftStr === '/Btn' && isCheckbox) {
        // Checkbox：/V 與 /AS 同設（/AP 字典發現 On 態名）
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
        const value = (matchedTextKey ? aliasValues[matchedTextKey] : '') || '';
        // 空值也處理：清模板樣本數據
        if (value.length === 0) {
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

  console.log(`[NN3 addDynamicContinuationSheet] page=${sourcePageIndex} suffix=${suffix} widgets=${widgetCount} matched=${matchCount} failed=${failCount} fieldNames=${slot.fieldNames.length}`);
  return newIndex;
}

// ═══ P.8 簽署人身份勾選（4 個共享 parent 的 ComboBox）═══
// parent /FT=/Ch、/V 默認 (Yes)、/Opt 兩項：idx0 顯示空白、idx1 顯示橫線（FEFF 2500×22）。
// 語義（同 NN6「保留選中項，其餘劃線刪去」）：選中身份 /I=[0] 保留不劃線，
// 其餘三個身份 /I=[1] 顯示橫線劃去。打勾必須寫 parent 字段 /I（僅設 /V 視覺無效）；
// 同時刪各 kid widget 的靜態 /AP，讓 NeedAppearances 重建外觀。selectDropdown() 對嵌套 /Opt 無效。

const CAPACITY_DROPDOWN: Record<string, string> = {
  director: 'Dropdown1',
  secretary: 'Dropdown2',
  manager: 'Dropdown3',
  authorizedRep: 'Dropdown4',
};

function tickSignerCapacity(pdfDoc: PDFDocument, helpers: ReturnType<typeof createFormHelpers>, capacity?: string): any[] {
  const dropdownParentRefs: any[] = [];
  if (!capacity || !CAPACITY_DROPDOWN[capacity]) return dropdownParentRefs;
  const ctx = (pdfDoc as any).context;
  for (const key of ['Dropdown1', 'Dropdown2', 'Dropdown3', 'Dropdown4']) {
    const entry = helpers.fields.get(key);
    if (!entry) continue;
    const field = entry.field;
    const keep = CAPACITY_DROPDOWN[capacity] === key;  // 選中 → 保留（/I=[0] 空白）
    const arr = PDFArray.withContext(ctx);
    arr.push(PDFNumber.of(keep ? 0 : 1));              // 其餘 → /I=[1] 顯示橫線
    field.set(PDFName.of('I'), arr);
    // 記住 parent ref：kid widget 沒有 /FT，rebuildAcroFormFields 會把它們
    // 連同 parent 一起踢出 /Fields → 重建後要手動加回，否則 /I tick 失效
    try {
      const parentRef = entry.widget.get(PDFName.of('Parent'));
      if (parentRef) dropdownParentRefs.push(parentRef);
    } catch { /* */ }
    // 刪兩個 kid widget 的靜態 AP（否則一直顯示空白）
    try {
      const kids = field.get(PDFName.of('Kids')) as any;
      if (kids && typeof kids.size === 'function') {
        for (let i = 0; i < kids.size(); i++) {
          try {
            const kw = ctx.lookup(kids.get(i)) as any;
            if (kw && typeof kw.get === 'function') kw.delete(PDFName.of('AP'));
          } catch { /* */ }
        }
      }
    } catch { /* */ }
  }
  return dropdownParentRefs;
}

// ═══ 人員塊 spec 構建（P.3/P.4/P.5/P.6/P.7 與續頁共用映射）═══
// 每頁的 spec: { values: {fieldName: value}, checkboxes: [...] }

interface FillSpec {
  values: Record<string, string>;
  checkboxes: string[];
}

const officeFallback = (a?: NN3Address) => parseAddress(
  [a?.flat, a?.building, a?.street, a?.districtCityProvince || a?.district, a?.region || a?.country]
    .filter(Boolean).join(', ')
);

// P.3 授權代表 A 自然人（fill_2–12）
const authRepNatSpec = (page: string, p: NN3OfficerData): FillSpec => {
  const { surname, otherNames } = parseEnglishName(p.nameEnglish || '');
  const addr = addr4(parseAddress(p.address || ''));
  return {
    values: {
      [`fill_2_P.${page}`]: p.nameChinese || '',
      [`fill_3_P.${page}`]: surname,
      [`fill_4_P.${page}`]: otherNames,
      [`fill_5_P.${page}`]: addr[0],
      [`fill_6_P.${page}`]: addr[1],
      [`fill_7_P.${page}`]: addr[2],
      [`fill_8_P.${page}`]: addr[3],
      [`fill_9_P.${page}`]: p.email || '',
      [`fill_10_P.${page}`]: parseHkidPartial(p.idNumber || ''),
      [`fill_11_P.${page}`]: p.passportCountry || '',
      [`fill_12_P.${page}`]: parsePassportPartial(p.passportNumber || ''),
    },
    checkboxes: [],
  };
};

// P.3 授權代表 B 非自然人（cb_1/2 + fill_13–19）
const authRepCorpSpec = (page: string, p: NN3OfficerData): FillSpec => {
  const addr = addr4(parseAddress(p.address || ''));
  return {
    values: {
      [`fill_13_P.${page}`]: p.nameChinese || '',
      [`fill_14_P.${page}`]: p.nameEnglish || '',
      [`fill_15_P.${page}`]: addr[0],
      [`fill_16_P.${page}`]: addr[1],
      [`fill_17_P.${page}`]: addr[2],
      [`fill_18_P.${page}`]: addr[3],
      [`fill_19_P.${page}`]: p.email || '',
    },
    checkboxes: [
      ...(p.isLawFirm ? [`cb_1_P.${page}`] : []),
      ...(p.isCpaFirm ? [`cb_2_P.${page}`] : []),
    ],
  };
};

// P.4 秘書 A 自然人（fill_2–17）
const natSecSpec = (page: string, p: NN3OfficerData): FillSpec => {
  const { surname, otherNames } = parseEnglishName(p.nameEnglish || '');
  const addr = addr5(parseAddress(p.address || ''));
  return {
    values: {
      [`fill_2_P.${page}`]: p.nameChinese || '',
      [`fill_3_P.${page}`]: surname,
      [`fill_4_P.${page}`]: otherNames,
      [`fill_5_P.${page}`]: p.prevNameChinese || '',
      [`fill_6_P.${page}`]: p.prevNameEnglish || '',
      [`fill_7_P.${page}`]: p.aliasChinese || '',
      [`fill_8_P.${page}`]: p.aliasEnglish || '',
      [`fill_9_P.${page}`]: addr[0],
      [`fill_10_P.${page}`]: addr[1],
      [`fill_11_P.${page}`]: addr[2],
      [`fill_12_P.${page}`]: addr[3],
      [`fill_13_P.${page}`]: addr[4],
      [`fill_14_P.${page}`]: p.email || '',
      [`fill_15_P.${page}`]: parseHkidPartial(p.idNumber || ''),
      [`fill_16_P.${page}`]: p.passportCountry || '',
      [`fill_17_P.${page}`]: parsePassportPartial(p.passportNumber || ''),
    },
    checkboxes: [],
  };
};

// P.4 秘書 B 法人（fill_18–26）
const corpSecSpec = (page: string, p: NN3OfficerData): FillSpec => {
  const addr = addr5(parseAddress(p.address || ''));
  return {
    values: {
      [`fill_18_P.${page}`]: p.nameChinese || '',
      [`fill_19_P.${page}`]: p.nameEnglish || '',
      [`fill_20_P.${page}`]: addr[0],
      [`fill_21_P.${page}`]: addr[1],
      [`fill_22_P.${page}`]: addr[2],
      [`fill_23_P.${page}`]: addr[3],
      [`fill_24_P.${page}`]: addr[4],
      [`fill_25_P.${page}`]: p.email || '',
      [`fill_26_P.${page}`]: p.brNumber || p.companyNumberRef || '',
    },
    checkboxes: [],
  };
};

// P.5/P.6 自然人董事（cb_1/2 + fill_2–18）
const natDirSpec = (page: string, p: NN3OfficerData, office: any): FillSpec => {
  const { surname, otherNames } = parseEnglishName(p.nameEnglish || '');
  const addr = addr5(directorAddrRows(parseAddress(p.address || ''), office));
  return {
    values: {
      [`fill_2_P.${page}`]: p.alternateTo || '',
      [`fill_3_P.${page}`]: p.nameChinese || '',
      [`fill_4_P.${page}`]: surname,
      [`fill_5_P.${page}`]: otherNames,
      [`fill_6_P.${page}`]: p.prevNameChinese || '',
      [`fill_7_P.${page}`]: p.prevNameEnglish || '',
      [`fill_8_P.${page}`]: p.aliasChinese || '',
      [`fill_9_P.${page}`]: p.aliasEnglish || '',
      [`fill_10_P.${page}`]: addr[0],
      [`fill_11_P.${page}`]: addr[1],
      [`fill_12_P.${page}`]: addr[2],
      [`fill_13_P.${page}`]: addr[3],
      [`fill_14_P.${page}`]: addr[4],
      [`fill_15_P.${page}`]: p.email || '',
      [`fill_16_P.${page}`]: parseHkidPartial(p.idNumber || ''),
      [`fill_17_P.${page}`]: p.passportCountry || '',
      [`fill_18_P.${page}`]: parsePassportPartial(p.passportNumber || ''),
    },
    checkboxes: [
      ...(!p.isAlternate ? [`cb_1_P.${page}`] : []),
      ...(p.isAlternate ? [`cb_2_P.${page}`] : []),
    ],
  };
};

// P.7 法人董事（cb_1/2 + fill_2–11）
const corpDirSpec = (page: string, p: NN3OfficerData): FillSpec => {
  const addr = addr5(parseAddress(p.address || ''));
  return {
    values: {
      [`fill_2_P.${page}`]: p.alternateTo || '',
      [`fill_3_P.${page}`]: p.nameChinese || '',
      [`fill_4_P.${page}`]: p.nameEnglish || '',
      [`fill_5_P.${page}`]: addr[0],
      [`fill_6_P.${page}`]: addr[1],
      [`fill_7_P.${page}`]: addr[2],
      [`fill_8_P.${page}`]: addr[3],
      [`fill_9_P.${page}`]: addr[4],
      [`fill_10_P.${page}`]: p.email || '',
      [`fill_11_P.${page}`]: p.brNumber || p.companyNumberRef || '',
    },
    checkboxes: [
      ...(!p.isAlternate ? [`cb_1_P.${page}`] : []),
      ...(p.isAlternate ? [`cb_2_P.${page}`] : []),
    ],
  };
};

// 續頁A（P.9）自然人（fill_5–15）／法人（cb_1/2 + fill_16–22）
const sheetANatSpec = (p: NN3OfficerData): FillSpec => {
  const { surname, otherNames } = parseEnglishName(p.nameEnglish || '');
  const addr = addr4(parseAddress(p.address || ''));
  return {
    values: {
      'fill_5_P.9': p.nameChinese || '',
      'fill_6_P.9': surname,
      'fill_7_P.9': otherNames,
      'fill_8_P.9': addr[0],
      'fill_9_P.9': addr[1],
      'fill_10_P.9': addr[2],
      'fill_11_P.9': addr[3],
      'fill_12_P.9': p.email || '',
      'fill_13_P.9': parseHkidPartial(p.idNumber || ''),
      'fill_14_P.9': p.passportCountry || '',
      'fill_15_P.9': parsePassportPartial(p.passportNumber || ''),
    },
    checkboxes: [],
  };
};
const sheetACorpSpec = (p: NN3OfficerData): FillSpec => {
  const addr = addr4(parseAddress(p.address || ''));
  return {
    values: {
      'fill_16_P.9': p.nameChinese || '',
      'fill_17_P.9': p.nameEnglish || '',
      'fill_18_P.9': addr[0],
      'fill_19_P.9': addr[1],
      'fill_20_P.9': addr[2],
      'fill_21_P.9': addr[3],
      'fill_22_P.9': p.email || '',
    },
    checkboxes: [
      ...(p.isLawFirm ? ['cb_1_P.9'] : []),
      ...(p.isCpaFirm ? ['cb_2_P.9'] : []),
    ],
  };
};

// 續頁B（P.10）自然人（fill_5–20）／法人（fill_21–29）
const sheetBNatSpec = (p: NN3OfficerData): FillSpec => {
  const { surname, otherNames } = parseEnglishName(p.nameEnglish || '');
  const addr = addr5(parseAddress(p.address || ''));
  return {
    values: {
      'fill_5_P.10': p.nameChinese || '',
      'fill_6_P.10': surname,
      'fill_7_P.10': otherNames,
      'fill_8_P.10': p.prevNameChinese || '',
      'fill_9_P.10': p.prevNameEnglish || '',
      'fill_10_P.10': p.aliasChinese || '',
      'fill_11_P.10': p.aliasEnglish || '',
      'fill_12_P.10': addr[0],
      'fill_13_P.10': addr[1],
      'fill_14_P.10': addr[2],
      'fill_15_P.10': addr[3],
      'fill_16_P.10': addr[4],
      'fill_17_P.10': p.email || '',
      'fill_18_P.10': parseHkidPartial(p.idNumber || ''),
      'fill_19_P.10': p.passportCountry || '',
      'fill_20_P.10': parsePassportPartial(p.passportNumber || ''),
    },
    checkboxes: [],
  };
};
const sheetBCorpSpec = (p: NN3OfficerData): FillSpec => {
  const addr = addr5(parseAddress(p.address || ''));
  return {
    values: {
      'fill_21_P.10': p.nameChinese || '',
      'fill_22_P.10': p.nameEnglish || '',
      'fill_23_P.10': addr[0],
      'fill_24_P.10': addr[1],
      'fill_25_P.10': addr[2],
      'fill_26_P.10': addr[3],
      'fill_27_P.10': addr[4],
      'fill_28_P.10': p.email || '',
      'fill_29_P.10': p.brNumber || p.companyNumberRef || '',
    },
    checkboxes: [],
  };
};

// 續頁C（P.11）自然人董事（cb_1/2 + fill_5–21）
const sheetCSpec = (p: NN3OfficerData, office: any): FillSpec => {
  const { surname, otherNames } = parseEnglishName(p.nameEnglish || '');
  const addr = addr5(directorAddrRows(parseAddress(p.address || ''), office));
  return {
    values: {
      'fill_5_P.11': p.alternateTo || '',
      'fill_6_P.11': p.nameChinese || '',
      'fill_7_P.11': surname,
      'fill_8_P.11': otherNames,
      'fill_9_P.11': p.prevNameChinese || '',
      'fill_10_P.11': p.prevNameEnglish || '',
      'fill_11_P.11': p.aliasChinese || '',
      'fill_12_P.11': p.aliasEnglish || '',
      'fill_13_P.11': addr[0],
      'fill_14_P.11': addr[1],
      'fill_15_P.11': addr[2],
      'fill_16_P.11': addr[3],
      'fill_17_P.11': addr[4],
      'fill_18_P.11': p.email || '',
      'fill_19_P.11': parseHkidPartial(p.idNumber || ''),
      'fill_20_P.11': p.passportCountry || '',
      'fill_21_P.11': parsePassportPartial(p.passportNumber || ''),
    },
    checkboxes: [
      ...(!p.isAlternate ? ['cb_1_P.11'] : []),
      ...(p.isAlternate ? ['cb_2_P.11'] : []),
    ],
  };
};

// 續頁D（P.12）法人董事 ×2 槽
const sheetDSlotSpec = (slot: 1 | 2, p?: NN3OfficerData): FillSpec => {
  const spec: FillSpec = { values: {}, checkboxes: [] };
  if (!p) return spec;
  const addr = addr5(parseAddress(p.address || ''));
  const b = slot === 1 ? 5 : 15;
  const cb1 = slot === 1 ? 'cb_1_P.12' : 'cb_3_P.12';
  const cb2 = slot === 1 ? 'cb_2_P.12' : 'cb_4_P.12';
  spec.values[`fill_${b}_P.12`] = p.alternateTo || '';
  spec.values[`fill_${b + 1}_P.12`] = p.nameChinese || '';
  spec.values[`fill_${b + 2}_P.12`] = p.nameEnglish || '';
  for (let i = 0; i < 5; i++) spec.values[`fill_${b + 3 + i}_P.12`] = addr[i];
  spec.values[`fill_${b + 8}_P.12`] = p.email || '';
  spec.values[`fill_${b + 9}_P.12`] = p.brNumber || p.companyNumberRef || '';
  spec.checkboxes.push(...(!p.isAlternate ? [cb1] : []));
  spec.checkboxes.push(...(p.isAlternate ? [cb2] : []));
  return spec;
};

// ═══ Main build function ═══

export async function buildNN3Pdf(data: NN3Payload, env: Env): Promise<Uint8Array> {
  // 1) Load template
  const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
  const templateObj = await r2Bucket.get("NN3-template.pdf");
  if (!templateObj) throw new Error("Template not found: NN3-template.pdf");

  const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  // 身份快照：動態插入會漂移索引，刪頁按對象 identity 解析
  const originalTemplatePages = pdfDoc.getPages();

  // 動態續頁源文檔（惰性單次加載）：所有副本共用，避免每頁重複解析模板（PDF 膨脹/1102）
  let dynSourceDoc: PDFDocument | null = null;
  const getDynSourceDoc = async (): Promise<PDFDocument> => {
    if (!dynSourceDoc) dynSourceDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    return dynSourceDoc;
  };

  const helpers = createFormHelpers(pdfDoc);
  const setF = (name: string, value?: string) => {
    if (value == null || value === "") return;
    helpers.setText(name, String(value));
  };
  const checkF = (name: string, shouldCheck?: boolean) => {
    if (!shouldCheck) return;
    helpers.check(name, true);
  };

  // ═══ 特殊 widget 預拆離 ═══
  // P.7 按揭欄（fill_16_P.7）是 3 層字段：grandparent/T=fill_16_P.7 → parent/T=7
  // → widget 無 /T 無 /FT。detachWidget 因 widgetName 為空不會改名/繼承 key
  // → 會留下無名字段。這裡手動補齊繼承並命名。
  const mortgageEntry = helpers.fields.get('fill_16_P.7');
  if (mortgageEntry) {
    try {
      const w = mortgageEntry.widget, f = mortgageEntry.field;
      for (const k of ['FT', 'DA', 'Ff', 'MaxLen', 'Q', 'DV']) {
        const key = PDFName.of(k);
        if (!w.get(key)) {
          const v = f.get(key);
          if (v !== undefined && v !== null) w.set(key, v);
        }
      }
      w.set(PDFName.of('T'), PDFString.of('fill_16_P.7'));
      w.delete(PDFName.of('Parent'));
    } catch { /* */ }
  }

  // 2) 日期與 BR
  let returnDate = data.returnDate || '';
  if (!returnDate && data.registrationDate) {
    returnDate = computeReturnDate(data.registrationDate);
  }
  const returnSplit = splitIso(returnDate);
  if (!returnSplit) throw new Error("returnDate or registrationDate required (YYYY-MM-DD)");
  const [day, month, year] = returnSplit;
  const regSplit = splitIso(data.registrationDate || '');
  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

  const office = officeFallback(data.principalPlaceOfBusiness);

  // ═══ P.1 公司資料 ═══
  setF("fill_1_P.1", br8);
  const fullCompanyName = [data.companyNameEnglish, data.companyNameChinese].filter(Boolean).join("\n");
  setF("fill_2_P.1", fullCompanyName);
  setF("fill_3_P.1", day);
  setF("fill_4_P.1", month);
  setF("fill_5_P.1", year);
  if (regSplit) {
    setF("fill_6_P.1", regSplit[0]);
    setF("fill_7_P.1", regSplit[1]);
    setF("fill_8_P.1", regSplit[2]);
  }
  setF("fill_9_P.1", data.placeOfIncorporation || "");
  const ppb = data.principalPlaceOfBusiness || {};
  setF("fill_10_P.1", ppb.flat || "");
  setF("fill_11_P.1", ppb.building || "");
  setF("fill_12_P.1", ppb.street || "");
  setF("fill_13_P.1", ppb.districtCityProvince || ppb.district || "");
  setF("fill_14_P.1", data.email || "");
  setF("fill_15_P.1", data.phone || "");

  const presenter = data.presenter || {};
  setF("fill_16_P.1", presenter.name || DEFAULT_PRESENTER.name);
  setF("fill_17_P.1", presenter.address || DEFAULT_PRESENTER.address);
  setF("fill_18_P.1", presenter.phone || "");
  setF("fill_19_P.1", presenter.fax || "");
  setF("fill_20_P.1", presenter.email || "");
  setF("fill_21_P.1", presenter.reference || "");

  // ═══ P.2 在成立地方的辦事處 ═══
  setF("fill_1_P.2", br8);
  const oa = data.officeInPlaceOfIncorporation || {};
  setF("fill_2_P.2", oa.flat || "");
  setF("fill_3_P.2", oa.building || "");
  setF("fill_4_P.2", oa.street || "");
  setF("fill_5_P.2", oa.districtCityProvince || oa.district || "");
  setF("fill_6_P.2", oa.country || "");
  const ob = data.principalPlaceInPlaceOfIncorporation || {};
  setF("fill_7_P.2", ob.flat || "");
  setF("fill_8_P.2", ob.building || "");
  setF("fill_9_P.2", ob.street || "");
  setF("fill_10_P.2", ob.districtCityProvince || ob.district || "");
  setF("fill_11_P.2", ob.country || "");
  setF("fill_12_P.2", data.emailInPlaceOfIncorporation || "");

  // ═══ 人員數組分組 ═══
  const authorizedReps = data.authorizedReps || [];
  const secretaries = data.secretaries || [];
  const directors = data.directors || [];
  const natReps = authorizedReps.filter(r => r.identity === "natural");
  const corpReps = authorizedReps.filter(r => r.identity === "corporate");
  const natSecs = secretaries.filter(s => s.identity === "natural");
  const corpSecs = secretaries.filter(s => s.identity === "corporate");
  const natDirs = directors.filter(d => d.identity === "natural");
  const corpDirs = directors.filter(d => d.identity === "corporate");

  // ═══ P.3 授權代表（A 自然人 / B 非自然人各首名）═══
  setF("fill_1_P.3", br8);
  if (natReps.length > 0) {
    const spec = authRepNatSpec("3", natReps[0]);
    for (const [k, v] of Object.entries(spec.values)) setF(k, v);
    for (const cb of spec.checkboxes) checkF(cb, true);
  }
  if (corpReps.length > 0) {
    const spec = authRepCorpSpec("3", corpReps[0]);
    for (const [k, v] of Object.entries(spec.values)) setF(k, v);
    for (const cb of spec.checkboxes) checkF(cb, true);
  }

  // ═══ P.4 公司秘書（A 自然人 / B 法人各首名）═══
  setF("fill_1_P.4", br8);
  if (natSecs.length > 0) {
    const spec = natSecSpec("4", natSecs[0]);
    for (const [k, v] of Object.entries(spec.values)) setF(k, v);
    for (const cb of spec.checkboxes) checkF(cb, true);
  }
  if (corpSecs.length > 0) {
    const spec = corpSecSpec("4", corpSecs[0]);
    for (const [k, v] of Object.entries(spec.values)) setF(k, v);
    for (const cb of spec.checkboxes) checkF(cb, true);
  }

  // ═══ P.5 / P.6 自然人董事 #1/#2 ═══
  setF("fill_1_P.5", br8);
  if (natDirs.length > 0) {
    const spec = natDirSpec("5", natDirs[0], office);
    for (const [k, v] of Object.entries(spec.values)) setF(k, v);
    for (const cb of spec.checkboxes) checkF(cb, true);
  }
  if (natDirs.length > 1) {
    setF("fill_1_P.6", br8);
    const spec = natDirSpec("6", natDirs[1], office);
    for (const [k, v] of Object.entries(spec.values)) setF(k, v);
    for (const cb of spec.checkboxes) checkF(cb, true);
  }

  // ═══ P.7 法人董事 #1 + 股本 + 按揭 ═══
  setF("fill_1_P.7", br8);
  if (corpDirs.length > 0) {
    const spec = corpDirSpec("7", corpDirs[0]);
    for (const [k, v] of Object.entries(spec.values)) setF(k, v);
    for (const cb of spec.checkboxes) checkF(cb, true);
  }
  const sc = data.shareCapital || {};
  setF("fill_12_P.7", sc.authorizedCurrency || "");
  setF("fill_13_P.7", sc.authorizedNominal || "");
  setF("fill_14_P.7", sc.issuedCurrency || "");
  setF("fill_15_P.7", sc.issuedNominal || "");
  setF("fill_16_P.7", data.mortgageAmount || "");

  // ═══ P.8 帳目 + 續頁計數 + 簽署 ═══
  setF("fill_1_P.8", br8);
  const accounts = data.accounts;
  if (accounts?.mode === 'delivered') {
    const from = splitIso(accounts.periodFrom);
    const to = splitIso(accounts.periodTo);
    if (from) { setF("fill_2_P.8", from[0]); setF("fill_3_P.8", from[1]); setF("fill_4_P.8", from[2]); }
    if (to) { setF("fill_5_P.8", to[0]); setF("fill_6_P.8", to[1]); setF("fill_7_P.8", to[2]); }
  } else if (accounts?.mode === 'notDelivered') {
    checkF("cb_1_P.8", accounts.notDeliveredReason === 1);
    checkF("cb_2_P.8", accounts.notDeliveredReason === 2);
  }

  // 續頁計數（由數組重算，忽略前端值）
  const sheetA = Math.max(0, natReps.length - 1) + Math.max(0, corpReps.length - 1);
  const sheetB = Math.max(0, natSecs.length - 1) + Math.max(0, corpSecs.length - 1);
  const sheetC = Math.max(0, natDirs.length - 2);
  const sheetD = corpDirs.length > 1 ? Math.ceil((corpDirs.length - 1) / 2) : 0;
  if (sheetA > 0) setF("fill_8_P.8", String(sheetA));
  if (sheetB > 0) setF("fill_9_P.8", String(sheetB));
  if (sheetC > 0) setF("fill_10_P.8", String(sheetC));
  if (sheetD > 0) setF("fill_11_P.8", String(sheetD));

  const signer = data.signer || {};
  setF("fill_12_P.8", signer.name || "");
  const signDate = splitIso(signer.date || returnDate);
  if (signDate) setF("fill_13_P.8", `${signDate[0]}/${signDate[1]}/${signDate[2]}`);
  const dropdownParentRefs = tickSignerCapacity(pdfDoc, helpers, signer.capacity);

  // ═══ 動態續頁（追加文檔末尾，順序 A → B → C → D）═══
  const srcDoc = await getDynSourceDoc();
  let insertAfter = pdfDoc.getPageCount() - 1;

  const sheetHeader = (page: string): Record<string, string> => ({
    [`fill_1_P.${page}`]: day,
    [`fill_2_P.${page}`]: month,
    [`fill_3_P.${page}`]: year,
    [`fill_4_P.${page}`]: br8,
  });

  // 續頁A（P.9，idx 8）：授權代表第 2 名起（自然人/法人各從第 2 名開始）
  for (let i = 1; i < natReps.length; i++) {
    const spec = sheetANatSpec(natReps[i]);
    const values = { ...sheetHeader('9'), ...spec.values };
    insertAfter = await addDynamicContinuationSheet(pdfDoc, srcDoc, 8, insertAfter,
      { fieldNames: Object.keys(values), values, checkboxes: spec.checkboxes }, `nn3A_nat_${i}`);
  }
  for (let i = 1; i < corpReps.length; i++) {
    const spec = sheetACorpSpec(corpReps[i]);
    const values = { ...sheetHeader('9'), ...spec.values };
    insertAfter = await addDynamicContinuationSheet(pdfDoc, srcDoc, 8, insertAfter,
      { fieldNames: Object.keys(values), values, checkboxes: spec.checkboxes }, `nn3A_corp_${i}`);
  }

  // 續頁B（P.10，idx 9）：秘書第 2 名起
  for (let i = 1; i < natSecs.length; i++) {
    const spec = sheetBNatSpec(natSecs[i]);
    const values = { ...sheetHeader('10'), ...spec.values };
    insertAfter = await addDynamicContinuationSheet(pdfDoc, srcDoc, 9, insertAfter,
      { fieldNames: Object.keys(values), values, checkboxes: spec.checkboxes }, `nn3B_nat_${i}`);
  }
  for (let i = 1; i < corpSecs.length; i++) {
    const spec = sheetBCorpSpec(corpSecs[i]);
    const values = { ...sheetHeader('10'), ...spec.values };
    insertAfter = await addDynamicContinuationSheet(pdfDoc, srcDoc, 9, insertAfter,
      { fieldNames: Object.keys(values), values, checkboxes: spec.checkboxes }, `nn3B_corp_${i}`);
  }

  // 續頁C（P.11，idx 10）：自然人董事第 3 名起
  for (let i = 2; i < natDirs.length; i++) {
    const spec = sheetCSpec(natDirs[i], office);
    const values = { ...sheetHeader('11'), ...spec.values };
    insertAfter = await addDynamicContinuationSheet(pdfDoc, srcDoc, 10, insertAfter,
      { fieldNames: Object.keys(values), values, checkboxes: spec.checkboxes }, `nn3C_${i}`);
  }

  // 續頁D（P.12，idx 11）：法人董事第 2 名起，每頁 2 槽
  for (let i = 1; i < corpDirs.length; i += 2) {
    const s1 = sheetDSlotSpec(1, corpDirs[i]);
    const s2 = sheetDSlotSpec(2, corpDirs[i + 1]);
    const values = {
      ...sheetHeader('12'),
      ...s1.values,
      ...s2.values,
    };
    insertAfter = await addDynamicContinuationSheet(pdfDoc, srcDoc, 11, insertAfter,
      { fieldNames: Object.keys(values), values, checkboxes: [...s1.checkboxes, ...s2.checkboxes] }, `nn3D_${i}`);
  }

  // ═══ 刪除不需要的頁面（identity 法，降序）═══
  // keep：P.1–P.5（idx 0–4）、P.7（idx 6，法人董事類別首頁 + 股本 + 按揭恒保留）、P.8（idx 7）
  // P.6（idx 5）僅 natDirs≥2 保留；P.9–12 源頁（idx 8–11）只有動態副本 → 必刪
  // P.13–18 填表須知（idx 12–17）→ 必刪
  const keepPrebuiltPages = new Set<number>([0, 1, 2, 3, 4, 6, 7]);
  if (natDirs.length >= 2) keepPrebuiltPages.add(5);

  const pagesToRemove: number[] = [];
  const curPages = pdfDoc.getPages();
  for (let i = 0; i < originalTemplatePages.length; i++) {
    if (keepPrebuiltPages.has(i)) continue;
    const cur = curPages.indexOf(originalTemplatePages[i]);
    if (cur >= 0) pagesToRemove.push(cur);
  }
  pagesToRemove.sort((a, b) => b - a);
  for (const idx of pagesToRemove) {
    try { pdfDoc.removePage(idx); } catch { /* */ }
  }

  // ═══ 重建 /Fields + NeedAppearances ═══
  rebuildAcroFormFields(pdfDoc);
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm")) as any;
    if (acroForm) {
      acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
      // Dropdown kid widget 無 /FT → rebuild 沒收進 /Fields；
      // parent 字段（/I tick 所在）必須手動加回，否則閱讀器看不到勾選
      if (dropdownParentRefs.length > 0) {
        const fieldsArr = acroForm.get(PDFName.of("Fields")) as any;
        if (fieldsArr && typeof fieldsArr.push === 'function') {
          for (const ref of dropdownParentRefs) {
            let present = false;
            for (let i = 0; i < fieldsArr.size(); i++) {
              const cur = fieldsArr.get(i);
              if (cur && cur.objectNumber === ref.objectNumber && cur.generationNumber === ref.generationNumber) { present = true; break; }
            }
            if (!present) fieldsArr.push(ref);
          }
        }
      }
    }
  } catch { /* */ }

  // ═══ 強制間接 /Annots（NN1 模式，防字段渲染失效）═══
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

// ═══ Cloudflare Worker Handler ═══

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as NN3Payload;
    console.log(`Generating NN3 for: ${data.companyNameEnglish} (BR: ${data.brNumber})`);

    // 校驗
    if (data.directors !== undefined && !Array.isArray(data.directors))
      return jsonResp({ error: "directors must be an array" }, 400);
    if (data.secretaries !== undefined && !Array.isArray(data.secretaries))
      return jsonResp({ error: "secretaries must be an array" }, 400);
    if (data.authorizedReps !== undefined && !Array.isArray(data.authorizedReps))
      return jsonResp({ error: "authorizedReps must be an array" }, 400);
    if (data.returnDate && !isValidIsoDate(data.returnDate))
      return jsonResp({ error: "returnDate must be YYYY-MM-DD" }, 400);
    if (data.registrationDate && !isValidIsoDate(data.registrationDate))
      return jsonResp({ error: "registrationDate must be YYYY-MM-DD" }, 400);
    if (!data.returnDate && !data.registrationDate)
      return jsonResp({ error: "returnDate or registrationDate required" }, 400);
    if (data.accounts && data.accounts.mode !== 'delivered' && data.accounts.mode !== 'notDelivered')
      return jsonResp({ error: "accounts.mode must be 'delivered' or 'notDelivered'" }, 400);
    if (data.accounts?.mode === 'notDelivered' && data.accounts.notDeliveredReason !== 1 && data.accounts.notDeliveredReason !== 2)
      return jsonResp({ error: "accounts.notDeliveredReason must be 1 or 2" }, 400);

    const pdfBytes = await buildNN3Pdf(data, env);
    const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);
    return jsonResp({ pdf: uint8ToBase64(pdfBytes), filename: `NN3_${br8 || 'form'}.pdf` });
  } catch (error) {
    console.error("Error generating NN3 PDF:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return jsonResp({ error: errorMessage }, 500);
  }
}
