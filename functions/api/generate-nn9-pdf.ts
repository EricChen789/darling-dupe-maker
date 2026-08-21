// POST /api/generate-nn9-pdf
// NN9 — 註冊非香港公司更改地址申報表（重写版 2026-08-21）
// 参照 NN7（本地 createFormHelpers：widget 多页共享 parent 的 detach 方案 +
// 下拉 /V 字节级匹配 + drawLine 划线），按 NN9-template.pdf 实际字段布局填充：
//
//   P.1 = 公司資料 + 第2項(a)香港主要營業地點新地址(4行) + (b)新電郵 + (c)新香港電話
//         + 提交人 6 框
//   P.2 = 第3項(a)成立地註冊辦事處新地址(5行) + (b)成立地主要營業地點新地址(5行)
//         + (c)新電郵 + 第4項簽署（姓名 + 日期單框 + 4 身份下拉：董事/公司秘書/經理/獲授權代表）
//   P.3/P.4 = 填表須知（生成時刪除）
//
// 字段映射（2026-08-21 PyMuPDF 模板实测 + 旧版 UI y 坐标双重确认）：
//   每組 fill_N_P 有 2 個 widget（T=1 在 P.1、T=2 在 P.2 共享 parent，語義不同，
//   必須 detach 獨立填）：
//   P.1: fill_1=BR, fill_2=公司名, fill_3/4/5/6=(a)室/大廈/街道/區,
//        fill_7/8/9=(a)日期 D/M/Y, fill_10=(b)電郵, fill_11/12/13=(b)日期,
//        fill_14=(c)電話, fill_15/16/17=(c)日期, fill_18~23=提交人
//   P.2: fill_1=BR, fill_2~6=(a)5行地址, fill_7/8/9=(a)日期, fill_10~14=(b)5行地址,
//        fill_15/16/17=(b)日期, fill_18=(c)電郵, fill_19/20/21=(c)日期,
//        fill_22=簽署人姓名, fill_23=簽署日期(DD/MM/YYYY 單框),
//        Dropdown_1~4_P.2=身份（3 級：widget T=null → mid T='2' → grand T='Dropdown_N_P'）

import { PDFDocument, PDFName, PDFHexString, PDFString, StandardFonts, rgb } from "pdf-lib";
import { verifyAuthRequest, type Env } from './_auth';
import {
  isAscii, decodePdfText,
  collectFormFields, detachWidget, rebuildAcroFormFields,
  enableNeedAppearances, buildCjkDA, buildHelvDA,
} from './_acroform';
import { corsHeaders, uint8ToBase64, DEFAULT_PRESENTER } from './_pdf-utils';

const TEMPLATE = "NN9-template.pdf";

interface NN9Data {
  brNumber: string;
  companyName: string;
  // ── P.1 2(a) 香港主要營業地點新地址 ──
  flat?: string;
  building?: string;
  street?: string;
  district?: string;
  region?: string;
  addressDay?: string;
  addressMonth?: string;
  addressYear?: string;
  // 舊版兼容
  newFlat?: string;
  newBuilding?: string;
  newStreet?: string;
  newDistrict?: string;
  newRegion?: string;
  newAddress?: string;
  changeDay?: string;
  changeMonth?: string;
  changeYear?: string;
  changeDate?: string;
  // ── P.1 2(b) 新電郵 ──
  hkEmail?: string;
  newEmail?: string;
  emailDay?: string;
  emailMonth?: string;
  emailYear?: string;
  resolutionDay?: string;
  resolutionMonth?: string;
  resolutionYear?: string;
  // ── P.1 2(c) 新香港電話 ──
  hkPhone?: string;
  newPhone?: string;
  phoneDay?: string;
  phoneMonth?: string;
  phoneYear?: string;
  // ── P.2 3(a) 成立地註冊辦事處新地址（5 行含國家） ──
  regFlat?: string;
  regBuilding?: string;
  regStreet?: string;
  regDistrict?: string;
  regCountry?: string;
  regDay?: string;
  regMonth?: string;
  regYear?: string;
  // ── P.2 3(b) 成立地主要營業地點新地址（5 行含國家） ──
  bizFlat?: string;
  bizBuilding?: string;
  bizStreet?: string;
  bizDistrict?: string;
  bizCountry?: string;
  bizDay?: string;
  bizMonth?: string;
  bizYear?: string;
  // ── P.2 3(c) 新電郵 ──
  ovEmail?: string;
  ovDay?: string;
  ovMonth?: string;
  ovYear?: string;
  // ── 簽署 ──
  signerName?: string;
  signerCapacity?: 'director' | 'secretary' | 'manager' | 'authorizedRep' | '';
  signDateDay?: string;
  signDateMonth?: string;
  signDateYear?: string;
  signDate?: string;
  // ── 提交人 ──
  presentorName?: string;
  presentorAddress?: string;
  presentorPhone?: string;
  presentorFax?: string;
  presentorEmail?: string;
  presentorReference?: string;
  debug?: boolean;
}

// ============================================================================
// Low-level AcroForm helpers（与 NN7 同方案：widget 多页共享 parent 字段，
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
      // NN9 特殊：fill_7_P.1 是 3 级层级（widget T=null → mid T='1' → grand T='fill_7_P'），
      // detachWidget 的 parentName.widgetName 拼接不成立 → T 保持 null，
      // 阅读器读不到字段名。这里兜底写回传入的解析名。
      if (!decodePdfText(target.widget.get(PDFName.of("T")))) {
        target.widget.set(PDFName.of("T"), PDFString.of(fieldName));
      }

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

  // 按字段名枚举全部 widget 实例（P.2 簽署下拉中/英文两行 = 同名字双实例；
  // NN9 下拉为 3 级层级：widget (T=null) → (T='2') → (T=Dropdown_N_P)）
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

  return { setText, selectDropdown };
}

// ============================================================================
// Date helpers
// ============================================================================

/** 解析 YYYY-MM-DD 或 DD/MM/YYYY → {d,m,y}（不补零，原样返回） */
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

const pad2 = (v?: string) => String(v ?? '').trim().padStart(2, '0');

/** 三元组优先；缺省时 fallback 到日期字符串解析 */
function dmyOr(
  day?: string, month?: string, year?: string, fallbackDate?: string
): { d: string; m: string; y: string } {
  if ((day && String(day).trim()) || (month && String(month).trim()) || (year && String(year).trim())) {
    return { d: pad2(day), m: pad2(month), y: String(year ?? '').trim() };
  }
  const p = parseDateParts(fallbackDate);
  return p ? { d: pad2(p.d), m: pad2(p.m), y: p.y } : { d: '', m: '', y: '' };
}

// ============================================================================
// MAIN fill function
// ============================================================================

function fillNN9(pdfDoc: PDFDocument, data: NN9Data) {
  const { setText, selectDropdown } = createFormHelpers(pdfDoc);

  const br8 = (data.brNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 8);
  const setIf = (name: string, v?: string) => {
    if (v && String(v).trim()) setText(name, String(v));
  };
  const fillDate = (dKey: string, mKey: string, yKey: string, dd: { d: string; m: string; y: string }) => {
    if (!dd.d && !dd.m && !dd.y) return;
    setText(dKey, dd.d);
    setText(mKey, dd.m);
    setText(yKey, dd.y);
  };

  // ── P.1 2(a) 香港新地址（4 行；模板已印固定「地區 Region 香港/HONG KONG」） ──
  const hkFlat = data.flat ?? data.newFlat ?? '';
  const hkBld = data.building ?? data.newBuilding ?? '';
  const hkStr = data.street ?? data.newStreet ?? '';
  const hkDst = data.district ?? data.newDistrict ?? '';
  const hkAddr = [hkFlat, hkBld, hkStr, hkDst].map(p => String(p ?? '').trim()).filter(Boolean);
  const addrDate = dmyOr(data.addressDay, data.addressMonth, data.addressYear,
    data.changeDate || `${data.changeDay ?? ''}/${data.changeMonth ?? ''}/${data.changeYear ?? ''}`);

  // ── P.1 2(b) 電郵 / 2(c) 電話 ──
  const hkEmail = data.hkEmail ?? data.newEmail ?? '';
  const hkPhone = data.hkPhone ?? data.newPhone ?? '';
  const emailDate = dmyOr(data.emailDay, data.emailMonth, data.emailYear,
    `${data.resolutionDay ?? ''}/${data.resolutionMonth ?? ''}/${data.resolutionYear ?? ''}`);
  const phoneDate = dmyOr(data.phoneDay, data.phoneMonth, data.phoneYear);

  // ══════════════ P.1：公司資料 + 第2項 + 提交人 ══════════════
  setIf("fill_1_P.1", br8);
  setIf("fill_2_P.1", data.companyName);

  // 2(a) 在香港的主要營業地點的新地址（4 行 + 日期）
  if (hkAddr.length > 0) {
    setText("fill_3_P.1", hkAddr[0] ?? '');
    setText("fill_4_P.1", hkAddr[1] ?? '');
    setText("fill_5_P.1", hkAddr[2] ?? '');
    setText("fill_6_P.1", hkAddr[3] ?? '');
    fillDate('fill_7_P.1', 'fill_8_P.1', 'fill_9_P.1', addrDate);
  }
  // 2(b) 新電郵地址
  if (String(hkEmail).trim()) {
    setText("fill_10_P.1", hkEmail);
    fillDate('fill_11_P.1', 'fill_12_P.1', 'fill_13_P.1', emailDate);
  }
  // 2(c) 新香港聯絡電話號碼
  if (String(hkPhone).trim()) {
    setText("fill_14_P.1", hkPhone);
    fillDate('fill_15_P.1', 'fill_16_P.1', 'fill_17_P.1', phoneDate);
  }

  // 提交人資料（6 框，DEFAULT_PRESENTER 保底）
  setIf("fill_18_P.1", data.presentorName || DEFAULT_PRESENTER.name);
  setIf("fill_19_P.1", data.presentorAddress || DEFAULT_PRESENTER.address);
  setIf("fill_20_P.1", data.presentorPhone || DEFAULT_PRESENTER.phone);
  setIf("fill_21_P.1", data.presentorFax || DEFAULT_PRESENTER.fax);
  setIf("fill_22_P.1", data.presentorEmail || DEFAULT_PRESENTER.email);
  setIf("fill_23_P.1", data.presentorReference || DEFAULT_PRESENTER.reference);

  // ══════════════ P.2：第3項成立地詳情 + 第4項簽署 ══════════════
  setIf("fill_1_P.2", br8);

  // 3(a) 註冊辦事處新地址（成立地，5 行含國家）
  const regAddr = [data.regFlat, data.regBuilding, data.regStreet, data.regDistrict, data.regCountry]
    .map(p => String(p ?? '').trim()).filter(Boolean);
  const regDate = dmyOr(data.regDay, data.regMonth, data.regYear);
  if (regAddr.length > 0) {
    setText("fill_2_P.2", regAddr[0] ?? '');
    setText("fill_3_P.2", regAddr[1] ?? '');
    setText("fill_4_P.2", regAddr[2] ?? '');
    setText("fill_5_P.2", regAddr[3] ?? '');
    setText("fill_6_P.2", regAddr[4] ?? '');
    fillDate('fill_7_P.2', 'fill_8_P.2', 'fill_9_P.2', regDate);
  }
  // 3(b) 主要營業地點新地址（成立地，5 行含國家）
  const bizAddr = [data.bizFlat, data.bizBuilding, data.bizStreet, data.bizDistrict, data.bizCountry]
    .map(p => String(p ?? '').trim()).filter(Boolean);
  const bizDate = dmyOr(data.bizDay, data.bizMonth, data.bizYear);
  if (bizAddr.length > 0) {
    setText("fill_10_P.2", bizAddr[0] ?? '');
    setText("fill_11_P.2", bizAddr[1] ?? '');
    setText("fill_12_P.2", bizAddr[2] ?? '');
    setText("fill_13_P.2", bizAddr[3] ?? '');
    setText("fill_14_P.2", bizAddr[4] ?? '');
    fillDate('fill_15_P.2', 'fill_16_P.2', 'fill_17_P.2', bizDate);
  }
  // 3(c) 新電郵
  if (String(data.ovEmail ?? '').trim()) {
    setText("fill_18_P.2", data.ovEmail);
    fillDate('fill_19_P.2', 'fill_20_P.2', 'fill_21_P.2', dmyOr(data.ovDay, data.ovMonth, data.ovYear));
  }

  // 第4項簽署：姓名 + 日期單框 + 身份 4 下拉（保留選中項，其餘劃線刪去）
  const signerName = String(data.signerName ?? '').trim();
  if (signerName) {
    setText("fill_22_P.2", signerName);
    const sp = parseDateParts(data.signDate) ||
      ((data.signDateDay || data.signDateMonth || data.signDateYear)
        ? dmyOr(data.signDateDay, data.signDateMonth, data.signDateYear) : null);
    if (sp && sp.d && sp.m && sp.y) {
      setText("fill_23_P.2", `${pad2(sp.d)}/${pad2(sp.m)}/${sp.y}`);
    }
    // Dropdown_1=董事, Dropdown_2=公司秘書, Dropdown_3=經理, Dropdown_4=獲授權代表
    const capacity = data.signerCapacity || 'director';
    const keepMap: Record<string, string> = { director: 'Dropdown_1', secretary: 'Dropdown_2', manager: 'Dropdown_3', authorizedRep: 'Dropdown_4' };
    const keep = keepMap[capacity] || 'Dropdown_1';
    for (const dn of ['Dropdown_1', 'Dropdown_2', 'Dropdown_3', 'Dropdown_4']) {
      selectDropdown(`${dn}_P.2`, dn !== keep ? '—' : ' ');
    }
  }

  // ══════════════ 頁面管理：刪 P.3/P.4 填表須知（降序） ══════════════
  const allPages = pdfDoc.getPages();
  for (const pi of [3, 2].sort((a, b) => b - a)) {
    if (pi < pdfDoc.getPageCount()) {
      pdfDoc.removePage(pi);
    }
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
    const data: NN9Data = await request.json();
    console.log("Generating NN9 PDF for:", data.companyName);

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) throw new Error("R2 bucket not available");

    const templateObj = await r2Bucket.get(TEMPLATE);
    if (!templateObj) throw new Error(`Failed to load ${TEMPLATE}`);

    const pdfDoc = await PDFDocument.load(await templateObj.arrayBuffer(), { ignoreEncryption: true });

    if (data.debug) {
      await fillDebug(pdfDoc);
    } else {
      fillNN9(pdfDoc, data);
    }

    // updateFieldAppearances: false — 中文名会触发 WinAnsi encode 500（NN7 同款处理）
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
    const base64 = uint8ToBase64(new Uint8Array(pdfBytes));

    return new Response(JSON.stringify({ pdf: base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("NN9 generation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
