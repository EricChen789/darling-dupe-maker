import { PDFDocument, PDFName, PDFHexString, PDFString, PDFBool, StandardFonts } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  isAscii, decodePdfText,
  collectFormFields, detachWidget, rebuildAcroFormFields,
  enableNeedAppearances, buildCjkDA, buildHelvDA,
  parsePassportPartial
} from './_acroform';
import { corsHeaders, jsonResp, uint8ToBase64, DEFAULT_PRESENTER } from './_pdf-utils';

interface Env {
  PDF_TEMPLATES: R2Bucket;
  JWT_SECRET?: string;
}


interface OfficerChange {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director' | 'alternate';
  identity: 'natural' | 'corporate';
  // Natural person
  nameChinese: string;
  nameSurname?: string;
  nameOtherNames?: string;
  nameEnglish?: string;
  formerNameChinese?: string;
  formerNameEnglish?: string;
  idNumber: string;
  address: string;
  dateAppointed?: string;
  dateCeased?: string;
  // Structured address
  addrFlatBlock?: string;
  addrBuilding?: string;
  addrStreetEstate?: string;
  addrDistrict?: string;
  addrRegion?: string;
  // Passport
  passportCountry?: string;
  passportNumber?: string;
  // Alternate director
  alternateTo?: string;
  alreadyDirector?: string; // 'yes' | 'no'
  // Cessation (B. 停任詳情)
  cessationReason?: string; // 'resignation' (辭職／其他) | 'deceased' (去世)
  stillHoldsOffice?: 'yes' | 'no' | ''; // 停任後是否仍然擔任（公司秘書免填）
  // Corporate
  companyName?: string;
  companyNumber?: string;
  placeIncorporated?: string;
}

interface ND2AData {
  brNumber: string;
  companyName: string;
  officers: OfficerChange[];
  signerName: string;
  signDate: string;
  signerCapacity?: string; // 'director' | 'secretary' | 'authorizedRep'
  presentorName: string;
  presentorAddress: string;
  presentorPhone?: string;
  presentorFax?: string;
  presentorEmail?: string;
  presentorReference?: string;
  // Legacy; presentorContact is a combined string of Tel/Fax/Email
  presentorContact?: string;
  companyEmail?: string;
  companyPhone?: string;
  debug?: boolean;
}

// ============================================================================
// Low-level AcroForm helpers (same pattern as NAR1)
// ============================================================================

const CJK_RE = /[㐀-鿿豈-﫿]/;

// ============================================================================
// Form helpers
// ============================================================================

function createFormHelpers(pdfDoc: PDFDocument) {
  enableNeedAppearances(pdfDoc);
  // let：动态续页插入后 recollect() 重建映射（setText/check 闭包引用同一变量）
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

  // 按字段名枚举全部 widget 实例（模板下拉框中/英文两行 = 同名字双实例）
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
          // 例：gp='Dropdown_3_P' + child T='3' → 'Dropdown_3_P.3'（widget 无自有 T）
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
    // Flask 同款语义：/I 索引 + /V 选项值，写到同名字全部实例（中/英文行）。
    // 模板层级 widget→child(T=页码,FT/Opt)→grandparent(T=Dropdown_x_P)：
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
        let optVals: string[] = [];
        try {
          // Opt 常为间接引用（如 /Opt 330 0 R）→ get 返回 PDFRef，需 context.lookup 解引用
          let opt: any = widget.get(PDFName.of("Opt"));
          if (opt && typeof opt.size !== "function" && !Array.isArray(opt)) {
            try { opt = pdfDoc.context.lookup(opt); } catch { opt = null; }
          }
          if (opt && typeof opt.size === "function") {
            for (let i = 0; i < opt.size(); i++) optVals.push(decodePdfText(opt.get(i)));
          } else if (Array.isArray(opt)) {
            optVals = opt.map((o: any) => decodePdfText(o));
          }
        } catch { /* keep empty */ }
        // 3) 匹配选项索引：'—' → 划线选项（非空最后项），' ' → 空白保留项
        let idx = optVals.findIndex((o: string) =>
          targetValue.includes(o) || o.includes(targetValue) || o.toLowerCase() === targetValue.toLowerCase()
        );
        if (idx < 0) idx = targetValue.trim() ? Math.max(0, optVals.length - 1) : 0;
        // 4) /I + /V（/F=4 模板已有）
        widget.set(PDFName.of("I"), pdfDoc.context.obj([idx]));
        if (idx >= 0 && idx < optVals.length) {
          widget.set(PDFName.of("V"), PDFString.of(optVals[idx]));
        } else {
          widget.set(PDFName.of("V"), PDFString.of(targetValue));
        }
        // 5) 划掉：每个实例画一条贯穿横线（静态页面内容，任何阅读器可见）
        // 注意：pdf-lib PDFArray 不是真 Array（无 .length、无 [i]），PDFNumber 相加是字符串拼接
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

  const getWidgetRect = (fieldName: string): { x0: number; y0: number; x1: number; y1: number } | null => {
    const target = fields.get(fieldName);
    if (!target) return null;
    try {
      const rectObj = target.widget.lookup(PDFName.of("Rect")) as any;
      if (rectObj && typeof rectObj.size === "function" && rectObj.size() >= 4) {
        const x0 = Number(rectObj.get(0)), y0 = Number(rectObj.get(1));
        const x1 = Number(rectObj.get(2)), y1 = Number(rectObj.get(3));
        if ([x0, y0, x1, y1].every((v) => Number.isFinite(v))) {
          return { x0, y0, x1, y1 };
        }
      }
    } catch (_) { /* ignore */ }
    return null;
  };

  return { fields, setText, check, selectDropdown, getWidgetRect, recollect };
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
}

type ApplyFn = {
  setText: (name: string, value: string, align?: 'left' | 'center' | 'right') => boolean;
  check: (name: string, shouldCheck: boolean) => boolean;
  selectDropdown: (name: string, target: string) => boolean;
};

function applySpec(spec: SheetSpec, h: ApplyFn) {
  for (const t of spec.texts) h.setText(t.name, t.value, t.align);
  for (const c of spec.checks) h.check(c, true);
  for (const d of spec.dropdowns) h.selectDropdown(d.name, d.target);
}

// 非 PI 页 HKID 一律 4 位（2026-08-16；PI 页保留完整号码）
function hkidPartial4(idNumber: string): string {
  return (idNumber || '').replace(/[()\-\s]/g, '').toUpperCase().slice(0, 4);
}

function datePartsOf(dateStr?: string): { d: string; m: string; y: string } | null {
  if (!dateStr) return null;
  const parts = dateStr.split(/[\/\-]/);
  if (parts.length < 3) return null;
  return { d: parts[2], m: parts[1], y: parts[0] };
}

function parseOfficerName(officer: OfficerChange): { surname: string; other: string } {
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

function roleChecks(officer: OfficerChange, p: number): string[] {
  if (officer.role === 'secretary') return [`cb_1_P.${p}`];
  if (officer.role === 'alternate') return [`cb_3_P.${p}`];
  return [`cb_2_P.${p}`];
}

// ── 停任页 spec：p=1 第2項 / p=4 續頁A（动态续页沿用 P.4 布局） ──
function cessSpec(officer: OfficerChange, p: 1 | 4, br8: string): SheetSpec {
  const spec: SheetSpec = { texts: [], checks: [], dropdowns: [] };
  if (br8) spec.texts.push({ name: `fill_1_P.${p}`, value: br8 });
  const { surname, other } = parseOfficerName(officer);
  const chinese = officer.nameChinese || '';
  const isNatural = officer.identity === 'natural';

  if (p === 1) {
    if (isNatural) {
      spec.texts.push({ name: 'fill_3_P.1', value: officer.role === 'alternate' && officer.alternateTo ? officer.alternateTo : '' });
      spec.texts.push({ name: 'fill_4_P.1', value: chinese });
      spec.texts.push({ name: 'fill_5_P.1', value: surname });
      spec.texts.push({ name: 'fill_6_P.1', value: other });
      spec.texts.push({ name: 'fill_7_P.1', value: hkidPartial4(officer.idNumber || ''), align: 'right' });
      spec.texts.push({ name: 'fill_8_P.1', value: officer.passportNumber ? parsePassportPartial(officer.passportNumber) : '' });
    } else {
      spec.texts.push({ name: 'fill_9_P.1', value: officer.nameChinese || '' });
      spec.texts.push({ name: 'fill_10_P.1', value: officer.companyName || officer.nameEnglish || '' });
    }
    spec.checks.push(...roleChecks(officer, 1));
    const reason1 = officer.cessationReason || 'resignation';
    spec.checks.push(reason1 === 'deceased' ? 'cb_5_P.1' : 'cb_4_P.1');
    const dp1 = datePartsOf(officer.dateCeased || officer.dateAppointed);
    if (dp1) {
      spec.texts.push({ name: 'fill_11_P.1', value: dp1.d });
      spec.texts.push({ name: 'fill_12_P.1', value: dp1.m });
      spec.texts.push({ name: 'fill_13_P.1', value: dp1.y });
    }
    if (officer.role !== 'secretary') {
      spec.checks.push(officer.stillHoldsOffice === 'yes' ? 'cb_6_P.1' : 'cb_7_P.1');
    }
  } else {
    // ── P.4 續頁A 停任（第2名及以後，动态续页同布局） ──
    if (isNatural) {
      spec.texts.push({ name: 'fill_2_P.4', value: officer.role === 'alternate' && officer.alternateTo ? officer.alternateTo : '' });
      spec.texts.push({ name: 'fill_3_P.4', value: chinese });
      spec.texts.push({ name: 'fill_4_P.4', value: surname });
      spec.texts.push({ name: 'fill_5_P.4', value: other });
      spec.texts.push({ name: 'fill_6_P.4', value: hkidPartial4(officer.idNumber || ''), align: 'right' });
      spec.texts.push({ name: 'fill_7_P.4', value: officer.passportNumber ? parsePassportPartial(officer.passportNumber) : '' });
    } else {
      spec.texts.push({ name: 'fill_8_P.4', value: officer.nameChinese || '' });
      spec.texts.push({ name: 'fill_9_P.4', value: officer.companyName || officer.nameEnglish || '' });
    }
    spec.checks.push(...roleChecks(officer, 4));
    const reason4 = officer.cessationReason || 'resignation';
    spec.checks.push(reason4 === 'deceased' ? 'cb_5_P.4' : 'cb_4_P.4');
    const dp4 = datePartsOf(officer.dateCeased || officer.dateAppointed);
    if (dp4) {
      spec.texts.push({ name: 'fill_10_P.4', value: dp4.d });
      spec.texts.push({ name: 'fill_11_P.4', value: dp4.m });
      spec.texts.push({ name: 'fill_12_P.4', value: dp4.y });
    }
    if (officer.role !== 'secretary') {
      spec.checks.push(officer.stillHoldsOffice === 'yes' ? 'cb_6_P.4' : 'cb_7_P.4');
    }
  }
  return spec;
}

// ── 委任自然人页 spec：p=2 第3項 / p=5 續頁B（动态续页沿用 P.5 布局） ──
function natApptSpec(officer: OfficerChange, p: 2 | 5, br8: string): SheetSpec {
  const spec: SheetSpec = { texts: [], checks: [], dropdowns: [] };
  if (br8) spec.texts.push({ name: `fill_1_P.${p}`, value: br8 });
  const { surname, other } = parseOfficerName(officer);
  const chinese = officer.nameChinese || '';
  spec.texts.push({ name: `fill_2_P.${p}`, value: officer.role === 'alternate' && officer.alternateTo ? officer.alternateTo : '' });
  spec.texts.push({ name: `fill_3_P.${p}`, value: chinese });
  spec.texts.push({ name: `fill_4_P.${p}`, value: surname });
  spec.texts.push({ name: `fill_5_P.${p}`, value: other });
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
  spec.texts.push({ name: `fill_16_P.${p}`, value: hkidPartial4(officer.idNumber || ''), align: 'right' });
  spec.texts.push({ name: `fill_17_P.${p}`, value: officer.passportCountry || '' });
  spec.texts.push({ name: `fill_18_P.${p}`, value: officer.passportNumber ? parsePassportPartial(officer.passportNumber) : '' });
  const dp = datePartsOf(officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased);
  if (dp) {
    spec.texts.push({ name: `fill_21_P.${p}`, value: dp.d });
    spec.texts.push({ name: `fill_22_P.${p}`, value: dp.m });
    spec.texts.push({ name: `fill_23_P.${p}`, value: dp.y });
  }
  spec.checks.push(...roleChecks(officer, p));
  if (officer.alreadyDirector === 'yes') spec.checks.push(`cb_5_P.${p}`);
  else if (officer.alreadyDirector === 'no') spec.checks.push(`cb_6_P.${p}`);
  if (officer.role === 'director' || officer.role === 'alternate') {
    const crossField = officer.role === 'director' ? `Dropdown_2_P.${p}` : `Dropdown_1_P.${p}`;
    for (const dn of [`Dropdown_1_P.${p}`, `Dropdown_2_P.${p}`]) {
      spec.dropdowns.push({ name: dn, target: dn === crossField ? '—' : ' ' });
    }
  }
  return spec;
}

// ── 委任法人页 spec：p=3 第4項 / p=6 續頁C（动态续页沿用 P.6 布局，无第二签署） ──
function corpApptSpec(officer: OfficerChange, p: 3 | 6, data: ND2AData, br8: string): SheetSpec {
  const spec: SheetSpec = { texts: [], checks: [], dropdowns: [] };
  if (br8) spec.texts.push({ name: `fill_1_P.${p}`, value: br8 });
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
  spec.texts.push({ name: `fill_10_P.${p}`, value: (officer as any).email || '' });
  if (officer.companyNumber) spec.texts.push({ name: `fill_11_P.${p}`, value: officer.companyNumber });
  if ((officer as any).tcspLicence) spec.texts.push({ name: `fill_12_P.${p}`, value: (officer as any).tcspLicence });
  const dp = datePartsOf(officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased);
  if (dp) {
    spec.texts.push({ name: `fill_14_P.${p}`, value: dp.d });
    spec.texts.push({ name: `fill_15_P.${p}`, value: dp.m });
    spec.texts.push({ name: `fill_16_P.${p}`, value: dp.y });
  }
  spec.checks.push(...roleChecks(officer, p));
  if (officer.alreadyDirector === 'yes') spec.checks.push(`cb_5_P.${p}`);
  else if (officer.alreadyDirector === 'no') spec.checks.push(`cb_6_P.${p}`);
  if (officer.role === 'director' || officer.role === 'alternate') {
    const crossFieldC = officer.role === 'director' ? `Dropdown_2_P.${p}` : `Dropdown_1_P.${p}`;
    for (const dn of [`Dropdown_1_P.${p}`, `Dropdown_2_P.${p}`]) {
      spec.dropdowns.push({ name: dn, target: dn === crossFieldC ? '—' : ' ' });
    }
  }
  // ── 法人團體簽署 ──
  const capacity = data.signerCapacity || 'director';
  const signerName = data.signerName || '';
  const keepMap1: Record<string, string> = { director: 'Dropdown_3', secretary: 'Dropdown_4', authorizedRep: 'Dropdown_5' };
  const keep1 = keepMap1[capacity] || 'Dropdown_3';
  if (signerName) spec.texts.push({ name: `fill_17_P.${p}`, value: signerName });
  for (const dn of ['Dropdown_3', 'Dropdown_4', 'Dropdown_5']) {
    spec.dropdowns.push({ name: `${dn}_P.${p}`, target: dn !== keep1 ? '—' : ' ' });
  }
  if (p === 3) {
    // 第二簽署（僅 P.3）
    const keepMap2: Record<string, string> = { director: 'Dropdown_6', secretary: 'Dropdown_7', authorizedRep: 'Dropdown_6' };
    const keep2 = keepMap2[capacity] || 'Dropdown_6';
    if (signerName) spec.texts.push({ name: 'fill_22_P.3', value: signerName });
    if (data.signDate) {
      const sp = data.signDate.replace(/\//g, '-').split('-');
      if (sp.length >= 3) spec.texts.push({ name: 'fill_23_P.3', value: `${sp[2]}/${sp[1]}/${sp[0]}` });
    }
    for (const dn of ['Dropdown_6', 'Dropdown_7']) {
      spec.dropdowns.push({ name: `${dn}_P.3`, target: dn !== keep2 ? '—' : ' ' });
    }
  }
  return spec;
}

// ── PI-ND2A 受保護資料页 spec：pageKey='P.7'（静态）或 'P.7_P2' 等（复制页） ──
// PI 页是唯一保留完整 HKID 的位置（main + 校验位分两格）
function piSpec(subject: OfficerChange, pageKey: string, br8: string): SheetSpec {
  const spec: SheetSpec = { texts: [], checks: [], dropdowns: [] };
  if (br8) spec.texts.push({ name: `fill_1_${pageKey}`, value: br8 });
  const { surname, other } = parseOfficerName(subject);
  spec.texts.push({ name: `fill_2_${pageKey}`, value: subject.nameChinese || '' });
  spec.texts.push({ name: `fill_3_${pageKey}`, value: surname });
  spec.texts.push({ name: `fill_4_${pageKey}`, value: other });
  // Full HKID — strip brackets (NN1-style): main number + check digit, no parens
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
// （借用 NAR1 addDynamicContinuationSheet 思路；ND2A 直接复制模板自带的续页A/B/C/PI 页，
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
  suffix: string;     // 字段名后缀（如 C1/N1/B1/P2）
}

function fillND2A(pdfDoc: PDFDocument, data: ND2AData) {
  const { setText, check, selectDropdown, recollect } = createFormHelpers(pdfDoc);
  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);

  // ===== Officer routing =====
  // Page allocation (template structure verified 2026-08-13, 千问 VL):
  //   P.1 = 第2項 停任 (1st cessation — natural OR corporate, incl. B.停任詳情)
  //   P.2 = 第3項 委任自然人 (1st natural appointment)
  //   P.3 = 第4項 委任法人 (1st corporate appointment)
  //   P.4 = 續頁A 停任 (2nd cessation)
  //   P.5 = 續頁B 委任自然人 (2nd natural appointment)
  //   P.6 = 續頁C 委任法人 (2nd corporate appointment)
  //   P.7 = PI-ND2A 受保護資料 (one per natural person; filled below)
  //   第3名及以後 → 动态复制对应续页（2026-08-16，借鉴 NAR1 动态续页方案）
  const officers = data.officers || [];
  const cessations = officers.filter(o => o.type === 'cessation');
  const natAppts = officers.filter(o => o.type !== 'cessation' && o.identity === 'natural');
  const corpAppts = officers.filter(o => o.type !== 'cessation' && o.identity === 'corporate');
  const naturals = officers.filter(o => o.identity === 'natural');

  // BR number on every static page
  for (let p = 1; p <= 7; p++) {
    try { setText(`fill_1_P.${p}`, br8); } catch {}
  }

  // P.1: Company name
  setText("fill_2_P.1", data.companyName);

  // Static fills: first 2 of each kind
  if (cessations[0]) applySpec(cessSpec(cessations[0], 1, br8), { setText, check, selectDropdown });
  if (cessations[1]) applySpec(cessSpec(cessations[1], 4, br8), { setText, check, selectDropdown });
  if (natAppts[0]) applySpec(natApptSpec(natAppts[0], 2, br8), { setText, check, selectDropdown });
  if (natAppts[1]) applySpec(natApptSpec(natAppts[1], 5, br8), { setText, check, selectDropdown });
  if (corpAppts[0]) applySpec(corpApptSpec(corpAppts[0], 3, data, br8), { setText, check, selectDropdown });
  if (corpAppts[1]) applySpec(corpApptSpec(corpAppts[1], 6, data, br8), { setText, check, selectDropdown });

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
  // 1) Delete instruction pages after P.7 (P.8~P.17 填表須知)
  const allPages = pdfDoc.getPages();
  if (allPages.length > 7) {
    for (let i = allPages.length - 1; i >= 7; i--) {
      pdfDoc.removePage(i);
    }
  }
  // 2) 续页无内容则删除（降序）：P.6 续页C, P.5 续页B, P.4 续页A；PI 页（P.7）永不删除
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
  const piIdx = pdfDoc.getPageCount() - 1;                               // P.7 恒为最后一页

  const sheets: DynSheet[] = [];
  cessOver.forEach((_, i) => sheets.push({ srcIdx: 3, insertAt: insertAfterP4 + 1 + i, suffix: `C${i + 1}` }));
  natOver.forEach((_, i) => sheets.push({ srcIdx: 4, insertAt: insertAfterP5 + 1 + cessOver.length + i, suffix: `N${i + 1}` }));
  corpOver.forEach((_, i) => sheets.push({ srcIdx: 5, insertAt: insertAfterP6 + 1 + cessOver.length + natOver.length + i, suffix: `B${i + 1}` }));

  // 4) PI 页：每名自然人一页（P.7 + 复制页插到末尾）
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
      check: (n, s) => check(`${n}_${suffix}`, s),
      selectDropdown: (n, t) => selectDropdown(`${n}_${suffix}`, t),
    });
    const base: ApplyFn = { setText, check, selectDropdown };
    cessOver.forEach((o, i) => applySpec(cessSpec(o, 4, br8), wrap(`C${i + 1}`)));
    natOver.forEach((o, i) => applySpec(natApptSpec(o, 5, br8), wrap(`N${i + 1}`)));
    corpOver.forEach((o, i) => applySpec(corpApptSpec(o, 6, data, br8), wrap(`B${i + 1}`)));
    piCopies.forEach((o, i) => applySpec(piSpec(o, `P.7_P${i + 2}`, br8), base));
    // 改名脱离的 widget 需重编 /Fields 才会被阅读器收录（蓝框）
    rebuildAcroFormFields(pdfDoc);
  };

  // 6) PI-ND2A 受保護資料页（P.7）：第一名自然人填静态页
  if (naturals[0]) applySpec(piSpec(naturals[0], 'P.7', br8), { setText, check, selectDropdown });

  // 7) P.3 底部续页计数器（fill_18=续页A停任, fill_19=续页B自然人, fill_20=续页C法人, fill_21=PI页数）
  // 数值 = 该类续页总页数（含动态页）；无续页则留空
  if (cessations.length >= 2) setText('fill_18_P.3', String(cessations.length - 1));
  if (natAppts.length >= 2) setText('fill_19_P.3', String(natAppts.length - 1));
  if (corpAppts.length >= 2) setText('fill_20_P.3', String(corpAppts.length - 1));
  setText('fill_21_P.3', String(Math.max(1, naturals.length)));

  rebuildAcroFormFields(pdfDoc);

  // 返回后续步骤（onRequest 按序执行：插入动态页 → 填充 → save）
  return { insertSheets, fillDynamic };
}

// ============================================================================
// Debug mode
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
        let cur: any = widget;
        while (cur && !fieldName) {
          const t = cur.lookup?.(PDFName.of("T"));
          if (t) {
            try { fieldName = t.decodeText(); }
            catch { fieldName = t.toString().replace(/^\(|\)$/g, ""); }
          }
          cur = cur.lookup?.(PDFName.of("Parent"));
        }
        if (!fieldName) fieldName = "(unnamed)";

        const cnt = (nameCounter.get(fieldName) || 0) + 1;
        nameCounter.set(fieldName, cnt);

        const rectObj = widget.lookup?.(PDFName.of("Rect")) as any;
        if (!rectObj) continue;
        const x1 = rectObj[0];
        const y1 = rectObj[1];
        const x2 = rectObj[2];
        const y2 = rectObj[3];

        page.drawText(`${fieldName}#${cnt}`, {
          x: x1 + 1,
          y: y2 - 6,
          size: 5,
          font: helv,
          color: { r: 1, g: 0, b: 0 },
        });
      } catch (_) { /* skip */ }
    }
  }
  try { pdfDoc.getForm().flatten(); } catch (_) { /* ignore */ }
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
    const data: ND2AData = await request.json();
    console.log("Generating ND2A PDF for:", data.companyName);

    const templateObj = await env.PDF_TEMPLATES.get("ND2A-template.pdf");
    if (!templateObj) throw new Error("Failed to load ND2A template");

    const templateBytes = await templateObj.arrayBuffer();
    const pdfDoc = await PDFDocument.load(templateBytes);

    if (data.debug) {
      await fillDebug(pdfDoc);
    } else {
      const { insertSheets, fillDynamic } = fillND2A(pdfDoc, data);
      await insertSheets(new Uint8Array(templateBytes));
      fillDynamic();
    }

    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    const base64 = uint8ToBase64(new Uint8Array(pdfBytes));

    return new Response(JSON.stringify({ pdf: base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("ND2A generation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
