// POST /api/generate-nn6-pdf
// 非香港公司更改公司秘書及董事申報表（委任╱停任）—— 重写版（2026-08-21）
// 与 ND2A 相同的多人动态续页架构，按 NN6-template.pdf 实际字段布局填充：
//
//   P.1 = 第1項公司資料 + 第2項停任（第1名停任人，自然或法人）+ 提交人資料
//   P.2 = 第3項委任自然人（第1名自然人）
//   P.3 = 第4項委任法人（第1個法人）+ 第5項續頁頁數 + 第6項簽署
//   P.4 = 續頁A（第2名及以後停任人）
//   P.5 = 續頁B（第2名及以後委任自然人）
//   P.6 = 續頁C（第2個及以後委任法人）
//   P.7 = PI-NN6 受保護資料（每名自然人一頁：完整證件號碼 + 通常住址，置於最後）
//   P.8~15 = 填表須知（生成時刪除）
//
// 第3名及以後同類人士 → copyPages 动态复制对应续页（与 ND2A 同方案）

import { PDFDocument, PDFName, PDFHexString, PDFString, StandardFonts, rgb } from "pdf-lib";
import { verifyAuthRequest } from './_auth';
import {
  isAscii, decodePdfText,
  collectFormFields, detachWidget, rebuildAcroFormFields,
  enableNeedAppearances, buildCjkDA, buildHelvDA,
  parsePassportPartial
} from './_acroform';
import { corsHeaders, uint8ToBase64, DEFAULT_PRESENTER } from './_pdf-utils';

interface Env {
  PDF_TEMPLATES: R2Bucket;
  JWT_SECRET?: string;
}

interface Officer {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director' | 'alternate';
  identity: 'natural' | 'corporate';
  // 自然人
  nameChinese: string;
  nameSurname?: string;
  nameOtherNames?: string;
  nameEnglish?: string;
  hasFormerName?: boolean;
  formerNameChinese?: string;
  formerNameEnglish?: string;
  hasAlias?: boolean;
  aliasChinese?: string;
  aliasEnglish?: string;
  idNumber: string;
  address: string;
  dateAppointed?: string;
  dateCeased?: string;
  // 结构化地址
  addrFlatBlock?: string;
  addrBuilding?: string;
  addrStreetEstate?: string;
  addrDistrict?: string;
  addrRegion?: string;
  // 護照
  passportCountry?: string;
  passportNumber?: string;
  // 候補董事
  alternateTo?: string;
  alreadyDirector?: string;   // 'yes' | 'no'（委任第20/26項）
  stillHoldsOffice?: 'yes' | 'no' | ''; // 停任第14項（公司秘書免填）
  // 電郵
  email?: string;
  // 法人
  companyName?: string;
  companyNumber?: string;
}

interface NN6Data {
  brNumber: string;
  companyName: string;
  officers: Officer[];
  signerName: string;
  signDate: string;
  // 簽署人身分（P.3 第6項下拉：董事/公司秘書/經理/獲授權代表）
  signerCapacity?: 'director' | 'secretary' | 'manager' | 'authorizedRep' | '';
  presentorName: string;
  presentorAddress: string;
  presentorPhone?: string;
  presentorFax?: string;
  presentorEmail?: string;
  presentorReference?: string;
  debug?: boolean;
}

// ============================================================================
// Low-level AcroForm helpers（与 ND2A 相同方案：widget 多页共享 parent 字段，
// 直接操作 PDF 对象；let fields + recollect 支持动态续页后重建映射）
// ============================================================================

const CJK_RE = /[㐀-鿿豈-﫿]/;

function createFormHelpers(pdfDoc: PDFDocument) {
  enableNeedAppearances(pdfDoc);
  let fields = collectFormFields(pdfDoc);
  const recollect = () => { fields = collectFormFields(pdfDoc); };

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
  // NN6 模板 HKID 部分號碼字段是 comb 格（Ff=0x1C00000），
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

  // 按字段名枚举全部 widget 实例（P.3 簽署下拉中/英文两行 = 同名字双实例）
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

  return { fields, setText, disableComb, check, selectDropdown, recollect };
}

// ============================================================================
// Name / address helpers
// ============================================================================

function parseEnglishName(fullName: string): { surname: string; otherNames: string } {
  const cleaned = (fullName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { surname: "", otherNames: "" };
  if (!/[A-Za-z]/.test(cleaned)) return { surname: "", otherNames: "" };
  if (CJK_RE.test(cleaned)) {
    // Mixed CJK+ASCII — strip CJK
    const asciiOnly = cleaned.replace(/[㐀-鿿豈-﫿]+/g, " ").replace(/\s+/g, " ").trim();
    if (!asciiOnly) return { surname: "", otherNames: "" };
    return parseEnglishName(asciiOnly);
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { surname: "", otherNames: "" };
  const surname = parts[parts.length - 1];
  const otherNames = parts.slice(0, -1).join(" ");
  return { surname, otherNames };
}

// ============================================================================
// MAIN fill function
// ============================================================================

// ── Sheet spec：同一套字段映射同时驱动静态页与动态续页（复制页） ──
// 所有 text 字段无条件写入（空串 = 清空模板样例数据，对动态复制页尤其重要）。
interface SheetSpec {
  texts: Array<{ name: string; value: string; align?: 'left' | 'center' | 'right' }>;
  checks: string[];
  dropdowns: Array<{ name: string; target: string }>;
  /** HKID 等 comb 格（Ff bit24）——comb 忽略 /Q，右对齐需先清 comb 位 */
  combClear?: string[];
}

type ApplyFn = {
  setText: (name: string, value: string, align?: 'left' | 'center' | 'right') => boolean;
  check: (name: string, shouldCheck: boolean) => boolean;
  selectDropdown: (name: string, target: string) => boolean;
  disableComb: (name: string) => boolean;
};

function applySpec(spec: SheetSpec, h: ApplyFn) {
  for (const t of spec.texts) h.setText(t.name, t.value, t.align);
  for (const n of spec.combClear || []) h.disableComb(n);
  for (const c of spec.checks) h.check(c, true);
  for (const d of spec.dropdowns) h.selectDropdown(d.name, d.target);
}

// 非 PI 页 HKID 一律 4 位（PI-NN6 页保留完整号码）
function hkidPartial4(idNumber: string): string {
  return (idNumber || '').replace(/[()\-\s]/g, '').toUpperCase().slice(0, 4);
}

function datePartsOf(dateStr?: string): { d: string; m: string; y: string } | null {
  if (!dateStr) return null;
  const parts = dateStr.split(/[\/\-]/);
  if (parts.length < 3) return null;
  return { d: parts[2], m: parts[1], y: parts[0] };
}

function parseOfficerName(officer: Officer): { surname: string; other: string } {
  const eng = officer.nameEnglish || '';
  let surname = officer.nameSurname || '';
  let other = officer.nameOtherNames || '';
  if (!surname && eng) {
    const parsed = parseEnglishName(eng);
    surname = parsed.surname;
    other = parsed.otherNames;
  }
  return { surname, other };
}

function roleChecks(officer: Officer, p: number): string[] {
  if (officer.role === 'secretary') return [`cb_1_P.${p}`];
  if (officer.role === 'alternate') return [`cb_3_P.${p}`];
  return [`cb_2_P.${p}`];
}

// ── 停任页 spec：p=1 第2項 / p=4 續頁A（动态续页沿用 P.4 布局） ──
function cessSpec(officer: Officer, p: 1 | 4, br8: string): SheetSpec {
  const spec: SheetSpec = { texts: [], checks: [], dropdowns: [], combClear: [] };
  if (br8) spec.texts.push({ name: `fill_1_P.${p}`, value: br8 });
  const { surname, other } = parseOfficerName(officer);
  const chinese = officer.nameChinese || '';
  const isNatural = officer.identity === 'natural';
  const altTo = officer.role === 'alternate' && officer.alternateTo ? officer.alternateTo : '';

  if (isNatural) {
    spec.texts.push({ name: `fill_${p === 1 ? 3 : 2}_P.${p}`, value: altTo });
    spec.texts.push({ name: `fill_${p === 1 ? 4 : 3}_P.${p}`, value: chinese });
    spec.texts.push({ name: `fill_${p === 1 ? 5 : 4}_P.${p}`, value: surname });
    spec.texts.push({ name: `fill_${p === 1 ? 6 : 5}_P.${p}`, value: other });
    spec.texts.push({ name: `fill_${p === 1 ? 7 : 6}_P.${p}`, value: hkidPartial4(officer.idNumber || ''), align: 'right' });
    spec.combClear.push(`fill_${p === 1 ? 7 : 6}_P.${p}`); // comb 格忽略 /Q，清位后右对齐才生效
    spec.texts.push({ name: `fill_${p === 1 ? 8 : 7}_P.${p}`, value: officer.passportNumber ? parsePassportPartial(officer.passportNumber) : '' });
  } else {
    spec.texts.push({ name: `fill_${p === 1 ? 3 : 2}_P.${p}`, value: altTo });
    spec.texts.push({ name: `fill_${p === 1 ? 9 : 8}_P.${p}`, value: officer.nameChinese || '' });
    spec.texts.push({ name: `fill_${p === 1 ? 10 : 9}_P.${p}`, value: officer.companyName || officer.nameEnglish || '' });
  }
  spec.checks.push(...roleChecks(officer, p));
  const dp = datePartsOf(officer.dateCeased || officer.dateAppointed);
  if (dp) {
    spec.texts.push({ name: `fill_${p === 1 ? 11 : 10}_P.${p}`, value: dp.d });
    spec.texts.push({ name: `fill_${p === 1 ? 12 : 11}_P.${p}`, value: dp.m });
    spec.texts.push({ name: `fill_${p === 1 ? 13 : 12}_P.${p}`, value: dp.y });
  }
  // 第14項：停任後是否仍然擔任（公司秘書免填）
  if (officer.role !== 'secretary') {
    spec.checks.push(officer.stillHoldsOffice === 'yes' ? `cb_4_P.${p}` : `cb_5_P.${p}`);
  }
  return spec;
}

// ── 委任自然人页 spec：p=2 第3項 / p=5 續頁B（动态续页沿用 P.5 布局） ──
function natApptSpec(officer: Officer, p: 2 | 5, br8: string): SheetSpec {
  const spec: SheetSpec = { texts: [], checks: [], dropdowns: [], combClear: [] };
  if (br8) spec.texts.push({ name: `fill_1_P.${p}`, value: br8 });
  const { surname, other } = parseOfficerName(officer);
  const chinese = officer.nameChinese || '';
  spec.texts.push({ name: `fill_2_P.${p}`, value: officer.role === 'alternate' && officer.alternateTo ? officer.alternateTo : '' });
  spec.texts.push({ name: `fill_3_P.${p}`, value: chinese });
  spec.texts.push({ name: `fill_4_P.${p}`, value: surname });
  spec.texts.push({ name: `fill_5_P.${p}`, value: other });
  // 前用姓名 / 別名
  spec.texts.push({ name: `fill_6_P.${p}`, value: officer.hasFormerName ? officer.formerNameChinese || '' : '' });
  spec.texts.push({ name: `fill_7_P.${p}`, value: officer.hasFormerName ? officer.formerNameEnglish || '' : '' });
  spec.texts.push({ name: `fill_8_P.${p}`, value: officer.hasAlias ? officer.aliasChinese || '' : '' });
  spec.texts.push({ name: `fill_9_P.${p}`, value: officer.hasAlias ? officer.aliasEnglish || '' : '' });
  const afb = officer.addrFlatBlock || '';
  const ab = officer.addrBuilding || '';
  const ase = officer.addrStreetEstate || '';
  const ad = officer.addrDistrict || '';
  const ar = officer.addrRegion || '';
  spec.texts.push({ name: `fill_10_P.${p}`, value: afb });
  spec.texts.push({ name: `fill_11_P.${p}`, value: ab });
  spec.texts.push({ name: `fill_12_P.${p}`, value: ase });
  spec.texts.push({ name: `fill_13_P.${p}`, value: ad });
  spec.texts.push({ name: `fill_14_P.${p}`, value: ar });
  if (!afb && !ab && !ase && !ad && !ar && officer.address) {
    spec.texts.push({ name: `fill_10_P.${p}`, value: officer.address });
  }
  spec.texts.push({ name: `fill_15_P.${p}`, value: officer.email || '' });
  spec.texts.push({ name: `fill_16_P.${p}`, value: hkidPartial4(officer.idNumber || ''), align: 'right' });
  spec.combClear.push(`fill_16_P.${p}`); // comb 格忽略 /Q，清位后右对齐才生效
  spec.texts.push({ name: `fill_17_P.${p}`, value: officer.passportCountry || '' });
  spec.texts.push({ name: `fill_18_P.${p}`, value: officer.passportNumber ? parsePassportPartial(officer.passportNumber) : '' });
  const dp = datePartsOf(officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased);
  if (dp) {
    spec.texts.push({ name: `fill_19_P.${p}`, value: dp.d });
    spec.texts.push({ name: `fill_20_P.${p}`, value: dp.m });
    spec.texts.push({ name: `fill_21_P.${p}`, value: dp.y });
  }
  spec.checks.push(...roleChecks(officer, p));
  // 第20項：委任時是否已是現任候補董事或董事
  if (officer.alreadyDirector === 'yes') spec.checks.push(`cb_4_P.${p}`);
  else if (officer.alreadyDirector === 'no') spec.checks.push(`cb_5_P.${p}`);
  return spec;
}

// ── 委任法人页 spec：p=3 第4項 / p=6 續頁C（动态续页沿用 P.6 布局，无签署区） ──
function corpApptSpec(officer: Officer, p: 3 | 6, br8: string): SheetSpec {
  const spec: SheetSpec = { texts: [], checks: [], dropdowns: [] };
  if (br8) spec.texts.push({ name: `fill_1_P.${p}`, value: br8 });
  spec.texts.push({ name: `fill_2_P.${p}`, value: officer.role === 'alternate' && officer.alternateTo ? officer.alternateTo : '' });
  spec.texts.push({ name: `fill_3_P.${p}`, value: officer.nameChinese || '' });
  spec.texts.push({ name: `fill_4_P.${p}`, value: officer.companyName || officer.nameEnglish || '' });
  const addrFlat = officer.addrFlatBlock || '';
  const addrBld = officer.addrBuilding || '';
  const addrSe = officer.addrStreetEstate || '';
  const addrDist = officer.addrDistrict || '';
  const addrReg = officer.addrRegion || '';
  spec.texts.push({ name: `fill_5_P.${p}`, value: addrFlat });
  spec.texts.push({ name: `fill_6_P.${p}`, value: addrBld });
  spec.texts.push({ name: `fill_7_P.${p}`, value: addrSe });
  spec.texts.push({ name: `fill_8_P.${p}`, value: addrDist });
  spec.texts.push({ name: `fill_9_P.${p}`, value: addrReg });
  if (!addrFlat && !addrBld && !addrSe && !addrDist && !addrReg && officer.address) {
    spec.texts.push({ name: `fill_5_P.${p}`, value: officer.address });
  }
  spec.texts.push({ name: `fill_10_P.${p}`, value: officer.email || '' });
  if (officer.companyNumber) spec.texts.push({ name: `fill_11_P.${p}`, value: officer.companyNumber });
  const dp = datePartsOf(officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased);
  if (dp) {
    spec.texts.push({ name: `fill_12_P.${p}`, value: dp.d });
    spec.texts.push({ name: `fill_13_P.${p}`, value: dp.m });
    spec.texts.push({ name: `fill_14_P.${p}`, value: dp.y });
  }
  spec.checks.push(...roleChecks(officer, p));
  // 第26項：委任時是否已是現任候補董事或董事
  if (officer.alreadyDirector === 'yes') spec.checks.push(`cb_4_P.${p}`);
  else if (officer.alreadyDirector === 'no') spec.checks.push(`cb_5_P.${p}`);
  return spec;
}

// ── PI-NN6 受保護資料页 spec：pageKey='P.7'（静态）或 'P.7_P2' 等（复制页） ──
// PI 页是唯一保留完整 HKID 的位置（main + 校验位分两格）；每名委任自然人一页
function piSpec(subject: Officer, pageKey: string, br8: string): SheetSpec {
  const spec: SheetSpec = { texts: [], checks: [], dropdowns: [] };
  if (br8) spec.texts.push({ name: `fill_1_${pageKey}`, value: br8 });
  const { surname, other } = parseOfficerName(subject);
  spec.texts.push({ name: `fill_2_${pageKey}`, value: subject.nameChinese || '' });
  spec.texts.push({ name: `fill_3_${pageKey}`, value: surname });
  spec.texts.push({ name: `fill_4_${pageKey}`, value: other });
  // Full HKID — strip brackets: main number + check digit, no parens
  const idFull = subject.idNumber || '';
  if (idFull) {
    const cleaned = idFull.replace(/[()\-\s]/g, '');
    if (cleaned.length > 1) {
      spec.texts.push({ name: `fill_5_${pageKey}`, value: cleaned.slice(0, -1), align: 'right' });
      spec.texts.push({ name: `fill_6_${pageKey}`, value: cleaned.slice(-1) });
    } else {
      spec.texts.push({ name: `fill_5_${pageKey}`, value: idFull, align: 'right' });
    }
  }
  if (subject.passportCountry) spec.texts.push({ name: `fill_7_${pageKey}`, value: subject.passportCountry });
  if (subject.passportNumber) spec.texts.push({ name: `fill_8_${pageKey}`, value: subject.passportNumber });
  const afb7 = subject.addrFlatBlock || '';
  const ab7 = subject.addrBuilding || '';
  const ase7 = subject.addrStreetEstate || '';
  const ad7 = subject.addrDistrict || '';
  const ar7 = subject.addrRegion || '';
  if (afb7 || ab7 || ase7 || ad7 || ar7) {
    spec.texts.push({ name: `fill_9_${pageKey}`, value: afb7 });
    spec.texts.push({ name: `fill_10_${pageKey}`, value: ab7 });
    spec.texts.push({ name: `fill_11_${pageKey}`, value: ase7 });
    spec.texts.push({ name: `fill_12_${pageKey}`, value: ad7 });
    spec.texts.push({ name: `fill_13_${pageKey}`, value: ar7 });
  } else if (subject.address) {
    spec.texts.push({ name: `fill_9_${pageKey}`, value: subject.address });
  }
  const role7 = subject.role || 'director';
  if (role7 === 'secretary') spec.checks.push(`cb_1_${pageKey}`);
  else if (role7 === 'alternate') spec.checks.push(`cb_3_${pageKey}`);
  else spec.checks.push(`cb_2_${pageKey}`);
  return spec;
}

// ── 动态续页：复制模板页 → 全名加 suffix 改名 → 脱离 parent ──
// （与 ND2A 同方案；NN6 直接复制模板自带的续页A/B/C/PI 页，
//   改名后 setText/check/selectDropdown 走与静态页完全相同的映射）
function renameDynamicWidgets(pdfDoc: PDFDocument, page: any, suffix: string) {
  const ctx = (pdfDoc as any).context;
  const annots = page.node.lookup(PDFName.of("Annots")) as any;
  if (!annots || typeof annots.size !== "function") return;
  for (let i = 0; i < annots.size(); i++) {
    try {
      const widget = ctx.lookup(annots.get(i)) as any;
      if (!widget || typeof widget.get !== "function") continue;
      if (String(widget.get(PDFName.of("Subtype"))) !== "/Widget") continue;
      const parentRef = widget.get(PDFName.of("Parent"));
      let field: any = widget;
      if (parentRef) {
        try { field = ctx.lookup(parentRef) as any; } catch { field = widget; }
      }
      const parentName = decodePdfText(field.get(PDFName.of("T")));
      const widgetName = decodePdfText(widget.get(PDFName.of("T")));
      let fullName = parentName || widgetName;
      const gpRef = field && field !== widget ? field.get?.(PDFName.of("Parent")) : undefined;
      if (gpRef) {
        try {
          const gp = ctx.lookup(gpRef) as any;
          const gpName = decodePdfText(gp.get(PDFName.of("T")));
          if (gpName) fullName = widgetName ? `${gpName}.${widgetName}` : `${gpName}.${parentName}`;
        } catch { /* keep */ }
      } else if (parentName && widgetName && widgetName !== parentName) {
        fullName = `${parentName}.${widgetName}`;
      }
      if (!fullName || /^\d+$/.test(fullName)) continue; // 无法解析全名的跳过
      // 继承键（FT/DA/Ff/Q/DV/Opt/MaxLen）后脱离
      for (const k of ["FT", "DA", "Ff", "Q", "DV", "Opt", "MaxLen"]) {
        const key = PDFName.of(k);
        if (!widget.get(key)) {
          const v = field && field !== widget ? field.get(key) : undefined;
          if (v !== undefined && v !== null) widget.set(key, v);
        }
      }
      widget.set(PDFName.of("T"), PDFString.of(`${fullName}_${suffix}`));
      widget.delete(PDFName.of("Parent"));
    } catch { /* skip */ }
  }
}

interface DynSheet {
  srcIdx: number;     // 模板源页（0-based：3=P.4 续页A, 4=P.5 续页B, 5=P.6 续页C, 6=P.7 PI）
  insertAt: number;   // 目标插入位置（已含之前插入的位移）
  suffix: string;     // 字段名后缀（如 A1/N1/B1/P2）
}

function fillNN6(pdfDoc: PDFDocument, data: NN6Data) {
  const { setText, disableComb, check, selectDropdown, recollect } = createFormHelpers(pdfDoc);
  const base: ApplyFn = { setText, disableComb, check, selectDropdown };
  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

  // ===== Officer routing =====
  // Page allocation (template structure verified 2026-08-21, PyMuPDF 文本层):
  //   P.1 = 第2項 停任 (1st cessation — natural OR corporate, incl. 停任詳情)
  //   P.2 = 第3項 委任自然人 (1st natural appointment)
  //   P.3 = 第4項 委任法人 (1st corporate appointment) + 第5項續頁頁數 + 第6項簽署
  //   P.4 = 續頁A 停任 (2nd cessation)
  //   P.5 = 續頁B 委任自然人 (2nd natural appointment)
  //   P.6 = 續頁C 委任法人 (2nd corporate appointment)
  //   P.7 = PI-NN6 受保護資料 (one per natural APPOINTEE; filled below)
  //   第3名及以後 → 动态复制对应续页（与 ND2A 同方案）
  const officers = data.officers || [];
  const cessations = officers.filter(o => o.type === 'cessation');
  const natAppts = officers.filter(o => o.type !== 'cessation' && o.identity === 'natural');
  const corpAppts = officers.filter(o => o.type !== 'cessation' && o.identity === 'corporate');
  // PI-NN6 只填報「新委任」自然人的受保護資料（官方指引：須申報新委任公司秘書／董事的完整號碼）
  const naturals = natAppts;

  // BR number on every static page
  for (let p = 1; p <= 7; p++) {
    try { setText(`fill_1_P.${p}`, br8); } catch {}
  }

  // P.1: Company name
  setText("fill_2_P.1", data.companyName);

  // Static fills: first 2 of each kind
  if (cessations[0]) applySpec(cessSpec(cessations[0], 1, br8), base);
  if (cessations[1]) applySpec(cessSpec(cessations[1], 4, br8), base);
  if (natAppts[0]) applySpec(natApptSpec(natAppts[0], 2, br8), base);
  if (natAppts[1]) applySpec(natApptSpec(natAppts[1], 5, br8), base);
  if (corpAppts[0]) applySpec(corpApptSpec(corpAppts[0], 3, br8), base);
  if (corpAppts[1]) applySpec(corpApptSpec(corpAppts[1], 6, br8), base);

  // ===== P.3 第5項：續頁／PI-NN6 頁數 =====
  // 数值 = 该类续页总页数（含动态页）；无续页则留空
  if (cessations.length >= 2) setText('fill_15_P.3', String(cessations.length - 1));
  if (natAppts.length >= 2) setText('fill_16_P.3', String(natAppts.length - 1));
  if (corpAppts.length >= 2) setText('fill_17_P.3', String(corpAppts.length - 1));
  if (naturals.length > 0) setText('fill_18_P.3', String(naturals.length));

  // ===== P.3 第6項：簽署 =====
  const signerName = data.signerName || '';
  if (signerName || data.signDate) {
    if (signerName) setText('fill_19_P.3', signerName);
    if (data.signDate) {
      const sp = data.signDate.replace(/\//g, '-').split('-');
      if (sp.length >= 3) setText('fill_20_P.3', `${sp[2]}/${sp[1]}/${sp[0]}`);
    }
    // 簽署人身分：保留選中項，其餘三個劃線刪去（中/英文两行同名字实例一起处理）
    // Dropdown_1=董事, Dropdown_2=公司秘書, Dropdown_3=經理, Dropdown_4=獲授權代表
    const capacity = data.signerCapacity || 'director';
    const keepMap: Record<string, string> = { director: 'Dropdown_1', secretary: 'Dropdown_2', manager: 'Dropdown_3', authorizedRep: 'Dropdown_4' };
    const keep = keepMap[capacity] || 'Dropdown_1';
    for (const dn of ['Dropdown_1', 'Dropdown_2', 'Dropdown_3', 'Dropdown_4']) {
      selectDropdown(`${dn}_P.3`, dn !== keep ? '—' : ' ');
    }
  }

  // ===== P.1: Presenter info =====
  const pName = data.presentorName || DEFAULT_PRESENTER.name;
  const pAddr = data.presentorAddress || DEFAULT_PRESENTER.address;
  const pPhone = data.presentorPhone || DEFAULT_PRESENTER.phone;
  const pFax = data.presentorFax || DEFAULT_PRESENTER.fax;
  const pEmail = data.presentorEmail || DEFAULT_PRESENTER.email;
  const pRef = data.presentorReference || DEFAULT_PRESENTER.reference;

  setText("fill_14_P.1", pName);
  setText("fill_15_P.1", pAddr);
  setText("fill_16_P.1", pPhone);
  setText("fill_17_P.1", pFax);
  setText("fill_18_P.1", pEmail);
  setText("fill_19_P.1", pRef);

  // ===== Page management =====
  // 1) Delete instruction pages after P.7 (P.8~P.15 填表須知)
  const allPages = pdfDoc.getPages();
  if (allPages.length > 7) {
    for (let i = allPages.length - 1; i >= 7; i--) {
      pdfDoc.removePage(i);
    }
  }
  // 2) 续页无内容则删除（降序）：P.6 续页C, P.5 续页B, P.4 续页A；
  //    PI 页（P.7）无委任自然人时删除
  if (naturals.length < 1) pdfDoc.removePage(6);
  if (corpAppts.length < 2) pdfDoc.removePage(5);
  if (natAppts.length < 2) pdfDoc.removePage(4);
  if (cessations.length < 2) pdfDoc.removePage(3);

  // 3) 动态续页（第3名及以后）— 按类型分组：停任续页紧跟 P.4、自然人紧跟 P.5、法人紧跟 P.6
  const cessOver = cessations.slice(2);
  const natOver = natAppts.slice(2);
  const corpOver = corpAppts.slice(2);
  const insertAfterP4 = 3;                                               // P.4 恒为 index 3（若保留）
  const insertAfterP5 = cessations.length >= 2 ? 4 : 3;                  // P.5 的 index
  const insertAfterP6 = insertAfterP5 + (natAppts.length >= 2 ? 1 : 0);  // P.6 的 index
  const piIdx = pdfDoc.getPageCount() - 1;                               // P.7 恒为最后一页（若保留）

  const sheets: DynSheet[] = [];
  cessOver.forEach((_, i) => sheets.push({ srcIdx: 3, insertAt: insertAfterP4 + 1 + i, suffix: `A${i + 1}` }));
  natOver.forEach((_, i) => sheets.push({ srcIdx: 4, insertAt: insertAfterP5 + 1 + cessOver.length + i, suffix: `N${i + 1}` }));
  corpOver.forEach((_, i) => sheets.push({ srcIdx: 5, insertAt: insertAfterP6 + 1 + cessOver.length + natOver.length + i, suffix: `B${i + 1}` }));

  // 4) PI 页：每名委任自然人一页（P.7 + 复制页插到末尾，官方指引：所有 PI 页置于最后）
  const piCopies = naturals.slice(1);
  piCopies.forEach((_, i) => sheets.push({
    srcIdx: 6,
    insertAt: piIdx + 1 + cessOver.length + natOver.length + corpOver.length + i,
    suffix: `P${i + 2}`,
  }));

  const insertSheets = async (templateBytes: Uint8Array) => {
    if (sheets.length === 0) return;
    const freshDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    // ⚠ 必须每页单独 copyPages：pdf-lib 单次调用对同一源页的多份复制会经 copier
    // 缓存共享同一组 widget 对象（改名会互相覆盖），分次调用才各自独立深拷贝
    for (let i = 0; i < sheets.length; i++) {
      const [pg] = await pdfDoc.copyPages(freshDoc, [sheets[i].srcIdx]);
      pdfDoc.insertPage(sheets[i].insertAt, pg);
      renameDynamicWidgets(pdfDoc, pg, sheets[i].suffix);
    }
    // 重建字段映射，动态页字段以全名+suffix 收录
    recollect();
  };

  // 5) 填充动态页（改名后走与静态页相同的 spec 映射）
  const fillDynamic = () => {
    if (sheets.length === 0) return;
    const wrap = (suffix: string): ApplyFn => ({
      setText: (n, v, a) => setText(`${n}_${suffix}`, v, a),
      disableComb: (n) => disableComb(`${n}_${suffix}`),
      check: (n, s) => check(`${n}_${suffix}`, s),
      selectDropdown: (n, t) => selectDropdown(`${n}_${suffix}`, t),
    });
    cessOver.forEach((o, i) => applySpec(cessSpec(o, 4, br8), wrap(`A${i + 1}`)));
    natOver.forEach((o, i) => applySpec(natApptSpec(o, 5, br8), wrap(`N${i + 1}`)));
    corpOver.forEach((o, i) => applySpec(corpApptSpec(o, 6, br8), wrap(`B${i + 1}`)));
    piCopies.forEach((o, i) => applySpec(piSpec(o, `P.7_P${i + 2}`, br8), base));
    // 改名脱离的 widget 需重编 /Fields 才会被阅读器收录（蓝框）
    rebuildAcroFormFields(pdfDoc);
  };

  // 6) PI-NN6 受保護資料页（P.7）：第一名委任自然人填静态页
  if (naturals[0]) applySpec(piSpec(naturals[0], 'P.7', br8), base);

  rebuildAcroFormFields(pdfDoc);

  // 返回后续步骤（onRequest 按序执行：插入动态页 → 填充 → save）
  return { insertSheets, fillDynamic };
}

// ============================================================================
// Debug mode：红色标注每个 widget 的字段名（视觉验证用），最后 flatten
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
    const data: NN6Data = await request.json();
    console.log("Generating NN6 PDF for:", data.companyName);

    const templateObj = await env.PDF_TEMPLATES.get("NN6-template.pdf");
    if (!templateObj) throw new Error("Failed to load NN6 template");

    const templateBytes = await templateObj.arrayBuffer();
    const pdfDoc = await PDFDocument.load(templateBytes);

    if (data.debug) {
      await fillDebug(pdfDoc);
    } else {
      const { insertSheets, fillDynamic } = fillNN6(pdfDoc, data);
      await insertSheets(new Uint8Array(templateBytes));
      fillDynamic();
    }

    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    const base64 = uint8ToBase64(new Uint8Array(pdfBytes));

    return new Response(JSON.stringify({ pdf: base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("NN6 generation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
