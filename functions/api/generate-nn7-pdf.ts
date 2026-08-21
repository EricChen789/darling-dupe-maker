// POST /api/generate-nn7-pdf
// 註冊非香港公司更改公司秘書及董事詳情申報表 —— 重写版（2026-08-21）
// 参照 ND2B（4 类变更 address/name/id/contact + 续页 + PI 页 + 删页逻辑）
// 与 NN6（_acroform 底层 helpers + 下拉 /V 字节级匹配 + comb 清除 + 中/英文双行下拉），
// 按 NN7-template.pdf 实际字段布局填充：
//
//   P.1 = 公司資料 + 第2項自然人現時資料（身分/中英文姓名/HKID/護照部分號碼）+ 提交人
//   P.2 = 第2項續：自然人更改詳情
//         (a)中文姓名 (b)英文姓名 (c)別名 (d)董事通常住址(日期,住址在PI-NN7)
//         (e)通訊地址(5行) (f)電郵 (g)HKID部分號碼 (h)護照
//   P.3 = 第3項法人團體現時資料 + 更改詳情 + 第5項續頁頁數 + 第6項簽署
//         （4 身份下拉：董事/公司秘書/經理/獲授權代表，中/英文兩行同名字实例）
//   P.4 = 續頁A（自然人：現時詳情 + 更改詳情；單人申報亦保留，與 ND2B 同做法）
//   P.5 = 續頁B（法人團體：現時詳情 + 更改詳情）
//   P.6 = PI-NN7 受保護資料（完整 HKID 主號+校驗碼 / 護照完整號碼 / 新通常住址 5 行）
//   P.7~12 = 填表須知（生成時刪除）
//
// 字段映射（2026-08-21 PyMuPDF 模板实测，与 ND2B-template 同名同构）：
//   P.2: fill_2/3/4/5=(a)中文+D/M/Y, fill_6/7+8/9/10=(b)姓/名+日期,
//        fill_11/12+13/14/15=(c)別名中/英+日期, fill_16/17/18=(d)住址日期,
//        fill_19~23+24/25/26=(e)通訊地址+日期, fill_27+28/29/30=(f)電郵+日期,
//        fill_31+32/33/34=(g)HKID+日期, fill_35/36+37/38/39=(h)護照國/號+日期
//   P.4: A部分 fill_2/3/4/5/6；B部分 fill_7+8/9/10, fill_11/12+13/14/15,
//        fill_16/17+18/19/20, fill_21/22/23=(d), fill_24~28+29/30/31=(e),
//        fill_32+33/34/35=(f), fill_36+37/38/39=(g), fill_40/41+42/43/44=(h)
//   P.3(法人): A部分 fill_2/3/4(中文/英文/商登號)；B部分 fill_5/6+7/8/9=(a)名稱,
//        fill_10~14+15/16/17=(b)地址, fill_18+19/20/21=(c)電郵；
//        第5項 fill_22(續頁A)/fill_23(續頁B)/fill_24(PI-NN7)；第6項 fill_25/26 + Dropdown_1~4
//   P.5(續頁B): 同 P.3 B 部分编号
//   P.6(PI-NN7): fill_2/3/4 姓名, fill_5/6 HKID 主號+校驗碼,
//        fill_7/8 護照國/完整號碼, fill_9~13 通常住址 5 行

import { PDFDocument, PDFName, PDFHexString, PDFString, StandardFonts, rgb } from "pdf-lib";
import { verifyAuthRequest, type Env } from './_auth';
import {
  isAscii, decodePdfText,
  collectFormFields, detachWidget, rebuildAcroFormFields,
  enableNeedAppearances, buildCjkDA, buildHelvDA,
  parseHkidPartial, parsePassportPartial
} from './_acroform';
import { corsHeaders, uint8ToBase64, DEFAULT_PRESENTER } from './_pdf-utils';

const TEMPLATE = "NN7-template.pdf";

interface NN7Data {
  brNumber: string;
  companyName: string;
  role: 'secretary' | 'director' | 'alternate';
  identity: 'natural' | 'corporate';
  // 自然人現時資料
  nameChinese?: string;
  nameSurname?: string;
  nameOtherNames?: string;
  nameEnglish?: string;
  idNumber?: string;
  passportNumber?: string;
  passportCountry?: string;
  passportPlaceOfIssue?: string;
  // 法人現時資料
  corpNameChinese?: string;
  corpNameEnglish?: string;
  corpBrNumber?: string;
  // 變更類型（多選）：name / address / id / contact
  changeTypes?: string[];
  // 舊版單一 changeType 兼容
  changeType?: string;
  // 變更詳情
  newNameChinese?: string;
  newNameSurname?: string;
  newNameOtherNames?: string;
  newNameEnglish?: string;
  newAliasChinese?: string;
  newAliasEnglish?: string;
  newIdNumber?: string;
  newFlat?: string;
  newBuilding?: string;
  newStreet?: string;
  newDistrict?: string;
  newRegion?: string;
  newAddress?: string;  // 舊版兼容：完整地址字串
  newEmail?: string;
  effectiveDate?: string;
  // 簽署
  signerName?: string;
  signDate?: string;
  signerCapacity?: 'director' | 'secretary' | 'manager' | 'authorizedRep' | '';
  // 提交人
  presentorName?: string;
  presentorAddress?: string;
  presentorPhone?: string;
  presentorFax?: string;
  presentorEmail?: string;
  presentorReference?: string;
  debug?: boolean;
}

// ============================================================================
// Low-level AcroForm helpers（与 NN6 同方案：widget 多页共享 parent 字段，
// 直接操作 PDF 对象；下拉 /V 必须用 Opt 原始 PDFString 字节级匹配）
// ============================================================================

function createFormHelpers(pdfDoc: PDFDocument) {
  enableNeedAppearances(pdfDoc);
  const fields = collectFormFields(pdfDoc);

  const setText = (fieldName: string, value: string, align?: 'left' | 'center' | 'right'): boolean => {
    const v = (value ?? "").toString();
    const target = fields.get(fieldName);
    if (!target) {
      console.warn(`⚠ Missing field: ${fieldName}`);
      return false;
    }
    try {
      detachWidget(target.widget, target.field);

      const da = decodePdfText(target.widget.get(PDFName.of("DA"))) ||
                 decodePdfText(target.field.get(PDFName.of("DA"))) ||
                 "/Helv 12 Tf 0 g";

      if (!isAscii(v)) {
        target.widget.set(PDFName.of("DA"), PDFString.of(buildCjkDA(da)));
        target.widget.set(PDFName.of("V"), PDFHexString.fromText(v));
      } else {
        target.widget.set(PDFName.of("DA"), PDFString.of(buildHelvDA(da)));
        target.widget.set(PDFName.of("V"), PDFString.of(v));
      }
      // Right/Center alignment via /Q (0=left, 1=center, 2=right)
      if (align === 'right') {
        target.widget.set(PDFName.of("Q"), pdfDoc.context.obj(2));
      } else if (align === 'center') {
        target.widget.set(PDFName.of("Q"), pdfDoc.context.obj(1));
      } else if (align === 'left') {
        target.widget.set(PDFName.of("Q"), pdfDoc.context.obj(0));
      }
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`⚠ setText failed for ${fieldName}:`, e);
      return false;
    }
  };

  // 清 Comb 位（Ff bit24）：comb 格按 PDF 规范忽略 /Q，字符左→右逐格分布。
  // NN7 模板 HKID 部分號碼字段是 comb 格（Ff=0x1C00000，MaxLen=5），
  // 4位部分號碼要右对齐必须先清 comb 位（setText 的 Q=2 才会渲染生效）。
  const disableComb = (fieldName: string): boolean => {
    const target = fields.get(fieldName);
    if (!target) {
      console.warn(`⚠ Missing field: ${fieldName}`);
      return false;
    }
    try {
      detachWidget(target.widget, target.field);
      const ff = target.widget.get(PDFName.of("Ff"));
      if (ff && typeof ff.asNumber === "function") {
        target.widget.set(PDFName.of("Ff"), pdfDoc.context.obj(ff.asNumber() & ~(1 << 24)));
      }
      return true;
    } catch (e) {
      console.warn(`⚠ disableComb failed for ${fieldName}:`, e);
      return false;
    }
  };

  const check = (fieldName: string, shouldCheck: boolean): boolean => {
    if (!shouldCheck) return false;
    const target = fields.get(fieldName);
    if (!target) return false;
    try {
      detachWidget(target.widget, target.field);
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

  // 按字段名枚举全部 widget 实例（P.3 簽署下拉中/英文两行 = 同名字双实例；
  // NN7 下拉为 3 级层级：widget → (T=页码) → (T=Dropdown_N_P.3)）
  const allWidgetsFor = (fieldName: string): Array<{ widget: any; field: any; grandField: any; page: any }> => {
    const out: Array<{ widget: any; field: any; grandField: any; page: any }> = [];
    for (const page of pdfDoc.getPages()) {
      const annots = page.node.lookup(PDFName.of("Annots")) as any;
      if (!annots || typeof annots.size !== "function") continue;
      for (let i = 0; i < annots.size(); i++) {
        try {
          const widget = pdfDoc.context.lookup(annots.get(i)) as any;
          if (!widget || typeof widget.get !== "function") continue;
          if (String(widget.get(PDFName.of("Subtype"))) !== "/Widget") continue;
          const parentRef = widget.get(PDFName.of("Parent"));
          const field = parentRef ? (pdfDoc.context.lookup(parentRef) as any) : widget;
          const parentName = field ? decodePdfText(field.get(PDFName.of("T"))) : "";
          const widgetName = decodePdfText(widget.get(PDFName.of("T")));
          let grandField: any = null;
          let resolvedName = parentName;
          const grandParentRef = field?.get?.(PDFName.of("Parent"));
          if (grandParentRef) {
            try {
              grandField = pdfDoc.context.lookup(grandParentRef) as any;
              const gpName = decodePdfText(grandField.get(PDFName.of("T")));
              if (gpName) resolvedName = gpName;
            } catch { /* skip */ }
          }
          // 全名 = resolvedName + '.' + suffix；suffix = widget 自有 T 或（3 级层级时的）child T
          const suffix = widgetName && widgetName !== resolvedName ? widgetName
            : parentName && parentName !== resolvedName ? parentName : "";
          const fullName = suffix ? `${resolvedName}.${suffix}` : resolvedName;
          if (resolvedName === fieldName || widgetName === fieldName || fullName === fieldName) {
            out.push({ widget, field, grandField, page });
          }
        } catch { /* skip */ }
      }
    }
    return out;
  };

  const selectDropdown = (fieldName: string, targetValue: string): boolean => {
    // 语义：/I 索引 + /V 选项值，写到同名字全部实例（中/英文行）。
    // 正确脱离为独立具名字段（复制 FT/Opt/DA/DV + 全名 T + 删 Parent），
    // 这样 rebuildAcroFormFields 会收录它们 → 阅读器里倒三角可点击、选项可见。
    // 不删 /AP：Chrome/PDFium 不重新生成外观，删了整条线会消失；划线交叉由 drawLine 静态完成。
    const targets = allWidgetsFor(fieldName);
    if (!targets.length) return false;
    let ok = false;
    for (const { widget, field, grandField, page } of targets) {
      try {
        // 1) 正确脱离：全名 + 继承键
        const parentName = field && field !== widget ? decodePdfText(field.get(PDFName.of("T"))) : "";
        const widgetName = decodePdfText(widget.get(PDFName.of("T")));
        const gpName = grandField ? decodePdfText(grandField.get(PDFName.of("T"))) : "";
        let fullName = parentName || widgetName;
        if (gpName) fullName = widgetName ? `${gpName}.${widgetName}` : `${gpName}.${parentName}`;
        else if (parentName && widgetName) fullName = `${parentName}.${widgetName}`;
        for (const k of ["FT", "DA", "Ff", "Q", "DV", "Opt", "MaxLen"]) {
          const key = PDFName.of(k);
          if (!widget.get(key)) {
            const v = field && field !== widget ? field.get(key) : undefined;
            if (v !== undefined && v !== null) widget.set(key, v);
          }
        }
        if (fullName) widget.set(PDFName.of("T"), PDFString.of(fullName));
        widget.delete(PDFName.of("Parent"));
        // 2) 读取 Opt（widget 自带或已从 field 复制）
        // 同时保留原始 PDFString 对象：/V 必须与 /Opt 字节一致，解码重编会换字节
        // （模板划线选项原始是 \x84 PDFDocEncoding em-dash，pdf-lib 重编成 \x14 → /V 与 Opt 不匹配）
        let optVals: string[] = [];
        let rawOpts: any[] = [];
        try {
          let opt: any = widget.get(PDFName.of("Opt"));
          if (opt && typeof opt.size !== "function" && !Array.isArray(opt)) {
            try { opt = pdfDoc.context.lookup(opt); } catch { opt = null; }
          }
          if (opt && typeof opt.size === "function") {
            for (let i = 0; i < opt.size(); i++) {
              rawOpts.push(opt.get(i));
              optVals.push(decodePdfText(opt.get(i)));
            }
          } else if (Array.isArray(opt)) {
            opt.forEach((o: any) => { rawOpts.push(o); optVals.push(decodePdfText(o)); });
          }
        } catch { /* keep empty */ }
        // 3) 匹配选项索引：'—' → 划线选项（非空最后项），' ' → 空白保留项
        let idx = optVals.findIndex((o: string) =>
          targetValue.includes(o) || o.includes(targetValue) || o.toLowerCase() === targetValue.toLowerCase()
        );
        if (idx < 0) idx = targetValue.trim() ? Math.max(0, optVals.length - 1) : 0;
        // 4) /I + /V（/V 直接用 Opt 原始字符串对象，保证与 /Opt 字节级一致）
        widget.set(PDFName.of("I"), pdfDoc.context.obj([idx]));
        if (idx >= 0 && idx < optVals.length && rawOpts[idx] instanceof PDFString) {
          widget.set(PDFName.of("V"), rawOpts[idx]);
        } else {
          widget.set(PDFName.of("V"), PDFString.of(targetValue));
        }
        // 5) 划掉：每个实例画一条贯穿横线（静态页面内容，任何阅读器可见）
        if (idx > 0 && page) {
          const rect = widget.lookup(PDFName.of("Rect")) as any;
          if (rect && typeof rect.size === "function" && rect.size() >= 4) {
            const x0 = Number(rect.get(0)), y0 = Number(rect.get(1));
            const x1 = Number(rect.get(2)), y1 = Number(rect.get(3));
            if ([x0, y0, x1, y1].every((v) => Number.isFinite(v))) {
              const midY = (y0 + y1) / 2;
              page.drawLine({
                start: { x: x0 + 2, y: midY },
                end: { x: x1 - 2, y: midY },
                thickness: 1, // 颜色省略 = 默认黑色；传 {r,g,b} 会抛 InvalidColorError
              });
            }
          }
        }
        ok = true;
      } catch (e) {
        console.warn(`selectDropdown failed for ${fieldName}:`, e);
      }
    }
    return ok;
  };

  return { setText, disableComb, check, selectDropdown };
}

// ============================================================================
// Name / date helpers
// ============================================================================

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;

function parseEnglishName(fullName: string): { surname: string; otherNames: string } {
  // 中文习惯：最后单词=姓（与 NN6 相同的分割逻辑）
  const cleaned = (fullName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { surname: "", otherNames: "" };
  if (!/[A-Za-z]/.test(cleaned)) return { surname: "", otherNames: "" };
  if (CJK_RE.test(cleaned)) {
    // Mixed CJK+ASCII — strip CJK
    const asciiOnly = cleaned.replace(/[㐀-䶿一-鿿豈-﫿]+/g, " ").replace(/\s+/g, " ").trim();
    if (!asciiOnly) return { surname: "", otherNames: "" };
    return parseEnglishName(asciiOnly);
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { surname: "", otherNames: "" };
  const surname = parts[parts.length - 1];
  const otherNames = parts.slice(0, -1).join(" ");
  return { surname, otherNames };
}

/** 解析 YYYY-MM-DD 或 DD/MM/YYYY → {d,m,y} */
function parseDateParts(dateStr?: string): { d: string; m: string; y: string } | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    return { d: m[3], m: m[2], y: m[1] };
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    return { d: m[1], m: m[2], y: m[3] };
  }
  return null;
}

/** 依變更類型選 checkbox 名 */
function roleCheck(p: number, role: string): string {
  if (role === 'secretary') return `cb_1_P.${p}`;
  if (role === 'alternate') return `cb_3_P.${p}`;
  return `cb_2_P.${p}`;
}

// ============================================================================
// MAIN fill function
// ============================================================================

function fillNN7(pdfDoc: PDFDocument, data: NN7Data) {
  const { setText, disableComb, check, selectDropdown } = createFormHelpers(pdfDoc);

  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);
  const isNatural = (data.identity || "natural") === "natural";
  const role = data.role || 'director';

  // ── 变更类型（数组 + 旧版单值兼容） ──
  let changeTypes: string[] = Array.isArray(data.changeTypes) ? data.changeTypes : [];
  if (typeof data.changeType === 'string' && data.changeType && !changeTypes.includes(data.changeType)) {
    changeTypes = [...changeTypes, data.changeType];
  }

  // ── 姓名解析（优先显式 surname/otherNames，fallback nameEnglish） ──
  let surname = data.nameSurname || '';
  let other = data.nameOtherNames || '';
  if (!surname && !other && data.nameEnglish) {
    const parsed = parseEnglishName(data.nameEnglish);
    surname = parsed.surname;
    other = parsed.otherNames;
  }

  // ── 新英文名 ──
  let newSurname = data.newNameSurname || '';
  let newOther = data.newNameOtherNames || '';
  if (!newSurname && !newOther && data.newNameEnglish) {
    const parsed = parseEnglishName(data.newNameEnglish);
    newSurname = parsed.surname;
    newOther = parsed.otherNames;
  }

  // ── 生效日期 D/M/Y ──
  const eff = parseDateParts(data.effectiveDate);
  const fillDateTriple = (dKey: string, mKey: string, yKey: string) => {
    if (!eff) return;
    setText(dKey, eff.d);
    setText(mKey, eff.m);
    setText(yKey, eff.y);
  };

  // ── 新通訊地址（去重：前段已含后段则跳过后段） ──
  const newAddrPartsRaw = [
    data.newFlat || '', data.newBuilding || '',
    data.newStreet || '', data.newDistrict || '', data.newRegion || ''
  ].map((p) => String(p || '').trim()).filter(Boolean);
  const newAddrParts: string[] = [];
  for (const p of newAddrPartsRaw) {
    if (newAddrParts.some(a => a.includes(p))) continue;
    newAddrParts.push(p);
  }
  const newAddress = newAddrParts.join(', ') || (data.newAddress || '');

  // ── HKID：非 PI 页一律 4 位右对齐 + 清 comb 位 ──
  const setHkid4 = (name: string, idNumber: string) => {
    setText(name, parseHkidPartial(idNumber), 'right');
    disableComb(name);
  };

  // ══════════════ P.1：公司資料 ══════════════
  setText("fill_1_P.1", br8);
  setText("fill_2_P.1", data.companyName);

  if (isNatural) {
    check(roleCheck(1, role), true);
    setText("fill_3_P.1", data.nameChinese || '');
    setText("fill_4_P.1", surname);
    setText("fill_5_P.1", other);
    setHkid4("fill_6_P.1", data.idNumber || '');
    if (data.passportNumber) {
      setText("fill_7_P.1", parsePassportPartial(data.passportNumber), 'right');
    }

    // ══════════════ P.2：自然人更改詳情 ══════════════
    // (a) 中文姓名
    if (changeTypes.includes('name') && data.newNameChinese) {
      setText("fill_2_P.2", data.newNameChinese);
      fillDateTriple('fill_3_P.2', 'fill_4_P.2', 'fill_5_P.2');
    }
    // (b) 英文姓名（姓氏/名字分框）
    if (changeTypes.includes('name') && (newSurname || newOther)) {
      setText("fill_6_P.2", newSurname);
      setText("fill_7_P.2", newOther);
      fillDateTriple('fill_8_P.2', 'fill_9_P.2', 'fill_10_P.2');
    }
    // (c) 別名
    if (changeTypes.includes('name') && (data.newAliasChinese || data.newAliasEnglish)) {
      setText("fill_11_P.2", data.newAliasChinese || '');
      setText("fill_12_P.2", data.newAliasEnglish || '');
      fillDateTriple('fill_13_P.2', 'fill_14_P.2', 'fill_15_P.2');
    }
    // (d) 董事的通常住址 — 只填日期（新住址在 PI-NN7 頁）；公司秘書/候補董事無此項
    if (changeTypes.includes('address') && role === 'director') {
      fillDateTriple('fill_16_P.2', 'fill_17_P.2', 'fill_18_P.2');
    }
    // (e) 通訊地址
    if (changeTypes.includes('address') && newAddrParts.length > 0) {
      setText("fill_19_P.2", newAddrParts[0] || '');
      setText("fill_20_P.2", newAddrParts[1] || '');
      setText("fill_21_P.2", newAddrParts[2] || '');
      setText("fill_22_P.2", newAddrParts[3] || '');
      setText("fill_23_P.2", newAddrParts[4] || '');
      fillDateTriple('fill_24_P.2', 'fill_25_P.2', 'fill_26_P.2');
    } else if (changeTypes.includes('address') && newAddress) {
      // 舊版兼容：完整地址字串入首行
      setText("fill_19_P.2", newAddress);
      fillDateTriple('fill_24_P.2', 'fill_25_P.2', 'fill_26_P.2');
    }
    // (f) 電郵
    if (changeTypes.includes('contact') && data.newEmail) {
      setText("fill_27_P.2", data.newEmail);
      fillDateTriple('fill_28_P.2', 'fill_29_P.2', 'fill_30_P.2');
    }
    // (g) 香港身分證部分號碼
    if (changeTypes.includes('id') && data.newIdNumber) {
      setHkid4("fill_31_P.2", data.newIdNumber);
      fillDateTriple('fill_32_P.2', 'fill_33_P.2', 'fill_34_P.2');
    }
    // (h) 護照
    if (changeTypes.includes('id') && (data.passportNumber || data.passportCountry || data.passportPlaceOfIssue)) {
      const ppoi = data.passportCountry || data.passportPlaceOfIssue || '';
      if (ppoi) setText("fill_35_P.2", ppoi);
      if (data.passportNumber) setText("fill_36_P.2", parsePassportPartial(data.passportNumber));
      fillDateTriple('fill_37_P.2', 'fill_38_P.2', 'fill_39_P.2');
    }

    // ══════════════ P.4 續頁A：自然人 ══════════════
    // Section A: 現時登記詳情
    check(roleCheck(4, role), true);
    setText("fill_2_P.4", data.nameChinese || '');
    setText("fill_3_P.4", surname);
    setText("fill_4_P.4", other);
    setHkid4("fill_5_P.4", data.idNumber || '');
    if (data.passportNumber) {
      setText("fill_6_P.4", parsePassportPartial(data.passportNumber), 'right');
    }
    // Section B: 更改詳情（从 P.2 延续，同编号映射）
    if (changeTypes.includes('name') && data.newNameChinese) {
      setText("fill_7_P.4", data.newNameChinese);
      fillDateTriple('fill_8_P.4', 'fill_9_P.4', 'fill_10_P.4');
    }
    if (changeTypes.includes('name') && (newSurname || newOther)) {
      setText("fill_11_P.4", newSurname);
      setText("fill_12_P.4", newOther);
      fillDateTriple('fill_13_P.4', 'fill_14_P.4', 'fill_15_P.4');
    }
    if (changeTypes.includes('name') && (data.newAliasChinese || data.newAliasEnglish)) {
      setText("fill_16_P.4", data.newAliasChinese || '');
      setText("fill_17_P.4", data.newAliasEnglish || '');
      fillDateTriple('fill_18_P.4', 'fill_19_P.4', 'fill_20_P.4');
    }
    if (changeTypes.includes('address') && role === 'director') {
      fillDateTriple('fill_21_P.4', 'fill_22_P.4', 'fill_23_P.4');
    }
    if (changeTypes.includes('address') && newAddrParts.length > 0) {
      setText("fill_24_P.4", newAddrParts[0] || '');
      setText("fill_25_P.4", newAddrParts[1] || '');
      setText("fill_26_P.4", newAddrParts[2] || '');
      setText("fill_27_P.4", newAddrParts[3] || '');
      setText("fill_28_P.4", newAddrParts[4] || '');
      fillDateTriple('fill_29_P.4', 'fill_30_P.4', 'fill_31_P.4');
    } else if (changeTypes.includes('address') && newAddress) {
      setText("fill_24_P.4", newAddress);
      fillDateTriple('fill_29_P.4', 'fill_30_P.4', 'fill_31_P.4');
    }
    if (changeTypes.includes('contact') && data.newEmail) {
      setText("fill_32_P.4", data.newEmail);
      fillDateTriple('fill_33_P.4', 'fill_34_P.4', 'fill_35_P.4');
    }
    if (changeTypes.includes('id') && data.newIdNumber) {
      setHkid4("fill_36_P.4", data.newIdNumber);
      fillDateTriple('fill_37_P.4', 'fill_38_P.4', 'fill_39_P.4');
    }
    if (changeTypes.includes('id') && (data.passportNumber || data.passportCountry || data.passportPlaceOfIssue)) {
      const ppoi = data.passportCountry || data.passportPlaceOfIssue || '';
      if (ppoi) setText("fill_40_P.4", ppoi);
      if (data.passportNumber) setText("fill_41_P.4", parsePassportPartial(data.passportNumber));
      fillDateTriple('fill_42_P.4', 'fill_43_P.4', 'fill_44_P.4');
    }

    // ══════════════ P.6 PI-NN7 受保護資料 ══════════════
    // 只填報有更改的項目（官方指引：證件號碼更改 → 新完整號碼；董事住址更改 → 新通常住址）
    check(roleCheck(6, role), true);
    setText("fill_2_P.6", data.nameChinese || '');
    setText("fill_3_P.6", surname);
    setText("fill_4_P.6", other);
    if (changeTypes.includes('id') && data.newIdNumber) {
      const newIdClean = String(data.newIdNumber).replace(/[()\-\s]/g, '').toUpperCase();
      setText("fill_5_P.6", newIdClean.length >= 8 ? newIdClean.slice(0, 7) : newIdClean, 'right');
      disableComb("fill_5_P.6"); // fill_5_P.6 是 comb MaxLen=8，7 位主号右对齐须清 comb
      if (newIdClean.length >= 8) setText("fill_6_P.6", newIdClean.slice(7, 8));
    }
    if (changeTypes.includes('id') && (data.passportNumber || data.passportCountry || data.passportPlaceOfIssue)) {
      const ppoi = data.passportCountry || data.passportPlaceOfIssue || '';
      if (ppoi) setText("fill_7_P.6", ppoi);
      if (data.passportNumber) setText("fill_8_P.6", String(data.passportNumber).slice(0, 12));
    }
    if (changeTypes.includes('address') && role === 'director') {
      if (newAddrParts.length > 0) {
        setText("fill_9_P.6", newAddrParts[0] || '');
        setText("fill_10_P.6", newAddrParts[1] || '');
        setText("fill_11_P.6", newAddrParts[2] || '');
        setText("fill_12_P.6", newAddrParts[3] || '');
        setText("fill_13_P.6", newAddrParts[4] || '');
      } else if (newAddress) {
        setText("fill_9_P.6", newAddress);
      }
    }
  } else {
    // ══════════════ 法人團體 ══════════════
    const corpCn = data.corpNameChinese || data.nameChinese || '';
    const corpEn = data.corpNameEnglish || data.nameEnglish || '';
    const corpBr = data.corpBrNumber || '';

    // P.3 A: 現時登記詳情
    check(roleCheck(3, role), true);
    setText("fill_2_P.3", corpCn);
    setText("fill_3_P.3", corpEn);
    setText("fill_4_P.3", corpBr);

    // P.3 B: 更改詳情
    // (a) 名稱（法人团体名称按原文填，不拆姓/名）
    if (changeTypes.includes('name') && (data.newNameChinese || data.newNameEnglish)) {
      setText("fill_5_P.3", data.newNameChinese || '');
      setText("fill_6_P.3", data.newNameEnglish || '');
      fillDateTriple('fill_7_P.3', 'fill_8_P.3', 'fill_9_P.3');
    }
    // (b) 地址
    if (changeTypes.includes('address') && newAddrParts.length > 0) {
      setText("fill_10_P.3", newAddrParts[0] || '');
      setText("fill_11_P.3", newAddrParts[1] || '');
      setText("fill_12_P.3", newAddrParts[2] || '');
      setText("fill_13_P.3", newAddrParts[3] || '');
      setText("fill_14_P.3", newAddrParts[4] || '');
      fillDateTriple('fill_15_P.3', 'fill_16_P.3', 'fill_17_P.3');
    } else if (changeTypes.includes('address') && newAddress) {
      setText("fill_10_P.3", newAddress);
      fillDateTriple('fill_15_P.3', 'fill_16_P.3', 'fill_17_P.3');
    }
    // (c) 電郵
    if (changeTypes.includes('contact') && data.newEmail) {
      setText("fill_18_P.3", data.newEmail);
      fillDateTriple('fill_19_P.3', 'fill_20_P.3', 'fill_21_P.3');
    }

    // ══════════════ P.5 續頁B：法人團體 ══════════════
    // Section A: 現時登記詳情
    check(roleCheck(5, role), true);
    setText("fill_2_P.5", corpCn);
    setText("fill_3_P.5", corpEn);
    setText("fill_4_P.5", corpBr);
    // Section B: 更改詳情
    if (changeTypes.includes('name') && (data.newNameChinese || data.newNameEnglish)) {
      setText("fill_5_P.5", data.newNameChinese || '');
      setText("fill_6_P.5", data.newNameEnglish || '');
      fillDateTriple('fill_7_P.5', 'fill_8_P.5', 'fill_9_P.5');
    }
    if (changeTypes.includes('address') && newAddrParts.length > 0) {
      setText("fill_10_P.5", newAddrParts[0] || '');
      setText("fill_11_P.5", newAddrParts[1] || '');
      setText("fill_12_P.5", newAddrParts[2] || '');
      setText("fill_13_P.5", newAddrParts[3] || '');
      setText("fill_14_P.5", newAddrParts[4] || '');
      fillDateTriple('fill_15_P.5', 'fill_16_P.5', 'fill_17_P.5');
    } else if (changeTypes.includes('address') && newAddress) {
      setText("fill_10_P.5", newAddress);
      fillDateTriple('fill_15_P.5', 'fill_16_P.5', 'fill_17_P.5');
    }
    if (changeTypes.includes('contact') && data.newEmail) {
      setText("fill_18_P.5", data.newEmail);
      fillDateTriple('fill_19_P.5', 'fill_20_P.5', 'fill_21_P.5');
    }

    // P.3 第5項：續頁頁數
    setText("fill_23_P.3", "1");
  }

  // ══════════════ P.3 第5項：自然人頁數（P.4 續頁A 保留 + P.6 PI 保留） ══════════════
  if (isNatural) {
    setText("fill_22_P.3", "1");
    setText("fill_24_P.3", "1");
  }

  // ══════════════ P.3 第6項：簽署 ══════════════
  const signerName = data.signerName || '';
  if (signerName) setText("fill_25_P.3", signerName);
  if (data.signDate) {
    const sp = parseDateParts(data.signDate);
    if (sp) {
      setText("fill_26_P.3", `${sp.d.padStart(2, '0')}/${sp.m.padStart(2, '0')}/${sp.y}`);
    } else {
      setText("fill_26_P.3", data.signDate);
    }
  }
  if (signerName || data.signDate) {
    // 簽署人身分：保留選中項，其餘三個劃線刪去（中/英文两行同名字实例一起处理）
    // Dropdown_1=董事, Dropdown_2=公司秘書, Dropdown_3=經理, Dropdown_4=獲授權代表
    const capacity = data.signerCapacity || 'director';
    const keepMap: Record<string, string> = { director: 'Dropdown_1', secretary: 'Dropdown_2', manager: 'Dropdown_3', authorizedRep: 'Dropdown_4' };
    const keep = keepMap[capacity] || 'Dropdown_1';
    for (const dn of ['Dropdown_1', 'Dropdown_2', 'Dropdown_3', 'Dropdown_4']) {
      selectDropdown(`${dn}_P.3`, dn !== keep ? '—' : ' ');
    }
  }

  // ══════════════ P.1：提交人資料 ══════════════
  setText("fill_8_P.1", data.presentorName || DEFAULT_PRESENTER.name);
  setText("fill_9_P.1", data.presentorAddress || DEFAULT_PRESENTER.address);
  setText("fill_10_P.1", data.presentorPhone || DEFAULT_PRESENTER.phone);
  setText("fill_11_P.1", data.presentorFax || DEFAULT_PRESENTER.fax);
  setText("fill_12_P.1", data.presentorEmail || DEFAULT_PRESENTER.email);
  setText("fill_13_P.1", data.presentorReference || DEFAULT_PRESENTER.reference);

  // ══════════════ 頁面管理 ══════════════
  // 模板 12 页：P.7~12 填表須知（无 widget）删除；
  // 自然人：保留 P.1/P.2/P.3/P.4/P.6 → 删 P.5；法人：保留 P.1/P.3/P.5 → 删 P.2/P.4/P.6
  const allPages = pdfDoc.getPages();
  const pagesToRemove: number[] = [];
  if (isNatural) {
    if (allPages.length >= 5) pagesToRemove.push(4);              // P.5 (0-indexed)
    for (let i = 6; i < allPages.length; i++) pagesToRemove.push(i); // P.7~P.12
  } else {
    if (allPages.length >= 2) pagesToRemove.push(1);              // P.2
    if (allPages.length >= 4) pagesToRemove.push(3);              // P.4
    if (allPages.length >= 6) pagesToRemove.push(5);              // P.6
    for (let i = 6; i < allPages.length; i++) pagesToRemove.push(i); // P.7~P.12
  }
  for (const pi of pagesToRemove.sort((a, b) => b - a)) {
    if (pi < pdfDoc.getPageCount()) {
      pdfDoc.removePage(pi);
    }
  }

  // ══════════════ BR 号码补全：按模板页码填（删页后 doc 索引 ≠ 模板页码） ══════════════
  for (let pi = 2; pi <= 6; pi++) {
    setText(`fill_1_P.${pi}`, br8);
  }

  rebuildAcroFormFields(pdfDoc);
}

// ============================================================================
// Debug mode：红色标注每个 widget 的字段名（视觉验证用），最后手动 flatten
// ============================================================================

async function fillDebug(pdfDoc: PDFDocument) {
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const nameCounter = new Map<string, number>();

  for (const page of pdfDoc.getPages()) {
    const annotsArr = page.node.lookup(PDFName.of("Annots")) as any;
    if (!annotsArr || typeof annotsArr.size !== "function") continue;

    for (let i = 0; i < annotsArr.size(); i++) {
      try {
        const widget = pdfDoc.context.lookup(annotsArr.get(i)) as any;
        if (!widget) continue;
        const subtype = widget.lookup?.(PDFName.of("Subtype"));
        if (!subtype || subtype.toString() !== "/Widget") continue;

        let fieldName: string | null = null;
        const parts: string[] = [];
        let cur: any = widget;
        while (cur) {
          const t = cur.lookup?.(PDFName.of("T"));
          if (t) {
            try { parts.unshift(t.decodeText()); }
            catch { parts.unshift(t.toString().replace(/^\(|\)$/g, "")); }
          }
          cur = cur.lookup?.(PDFName.of("Parent"));
        }
        fieldName = parts.length ? parts.join(".") : "(unnamed)";

        const cnt = (nameCounter.get(fieldName) || 0) + 1;
        nameCounter.set(fieldName, cnt);

        const rectObj = widget.lookup?.(PDFName.of("Rect")) as any;
        if (!rectObj || typeof rectObj.get !== "function") continue;
        // Rect 是直接 PDFArray：必须用 .get(i)（括号访问 undefined），
        // 且元素是 PDFNumber 对象要 Number() 转 JS number
        const x1 = Number(rectObj.get(0));
        const y1 = Number(rectObj.get(1));
        const x2 = Number(rectObj.get(2));
        const y2 = Number(rectObj.get(3));
        try {
          page.drawText(`${fieldName}#${cnt}`, {
            x: x1 + 1,
            y: y2 - 6,
            size: 5,
            font: helv,
            color: rgb(1, 0, 0), // 必须 rgb()：本版 pdf-lib 要 .type 颜色对象，{r,g,b} 抛 Invalid color
          });
        } catch (_) { /* skip */ }
      } catch (_) { /* skip */ }
    }
  }
  // 手动 flatten：只移除页面 Annots 里的 widget 引用 + Catalog 的 AcroForm，不删对象。
  // 不能用 pdf-lib 的 getForm().flatten()：本模板 /Fields 是扁平 widget 列表，
  // flatten 会删掉 widget 对象却漏删页面 Annots 引用 → 悬空 ref（MuPDF 报
  // "cannot find object in xref"）。未引用的对象留在文件里是合法 PDF。
  try {
    for (const page of pdfDoc.getPages()) {
      const annots = page.node.lookup(PDFName.of("Annots")) as any;
      if (!annots || typeof annots.size !== "function") continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        try {
          const annot = pdfDoc.context.lookup(annots.get(i)) as any;
          const subtype = annot?.get?.(PDFName.of("Subtype"))?.toString?.();
          if (subtype === "/Widget") annots.remove(i);
        } catch (_) { /* skip */ }
      }
    }
    pdfDoc.catalog.delete(PDFName.of("AcroForm"));
  } catch (_) { /* ignore */ }
}

// ============================================================================
// Request handler
// ============================================================================

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data: NN7Data = await request.json();
    console.log("Generating NN7 PDF for:", data.companyName);

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) throw new Error("R2 bucket not available");

    const templateObj = await r2Bucket.get(TEMPLATE);
    if (!templateObj) throw new Error(`Failed to load ${TEMPLATE}`);

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer(), { ignoreEncryption: true });

    if (data.debug) {
      await fillDebug(pdfDoc);
    } else {
      fillNN7(pdfDoc, data);
    }

    // updateFieldAppearances: false — 中文名会触发 WinAnsi encode 500（NN6 同款处理）
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
    const base64 = uint8ToBase64(new Uint8Array(pdfBytes));

    return new Response(JSON.stringify({ pdf: base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("NN7 generation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
