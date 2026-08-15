// POST /api/generate-nd4-pdf
// ND4 — Notice of Resignation of Company Secretary and Director
// Template fill matching local Flask _fill_nd4_pdf logic:
//   P.1: BR + company name + company type (cb_1=private, cb_2=public, cb_3=guarantee)
//        + identity toggles (toggle_4=natural, toggle_5=corporate)
//        + officer details + signer + presenter
//   P.2: role checkboxes (cb_1=director, cb_2=alternate, cb_3=secretary)
//        + dropdown strikethrough + signer + date + BR stamp on all pages

import { PDFDocument, StandardFonts, PDFName, PDFString } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  DEFAULT_PRESENTER,
} from './_pdf-utils';
import { createFormHelpers, decodePdfText, enableNeedAppearances, rebuildAcroFormFields } from './_acroform';
import { verifyAuthRequest, type Env } from './_auth';

const TEMPLATE = "ND4-template.pdf";

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as Record<string, any>;
    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) return jsonResp({ error: "R2 bucket not available" }, 500);

    const templateObj = await r2Bucket.get(TEMPLATE);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes);
    // ⚠ 不加载 CJK 字体：中文字段走模板内置 /PMingLiU（_acroform setText），
    // BR stamp 是纯 ASCII 用 Helvetica 即可。fetchAndEmbedFont 的 fontkit 解析
    // 是连续请求触发 1102 (Worker exceeded resource limits) 的主因。
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    enableNeedAppearances(pdfDoc);
    const { setText: _cjkSetText, check: _cjkCheck } = createFormHelpers(pdfDoc);

    // ═══ 藍框可編輯恢復：先脫離所有 parent 帶 FT 的 widget ═══
    // ND4 模板裡有 33 個 widget 掛在帶 FT 的 parent 上、自身無 FT：
    //   - P.2 的 32 個 Dropdown：widget(無 T, 有 AP) → parent(T='2', FT=/Ch, Opt, DA, V, I)
    //     → grandparent(T='Dropdown1_P'..'Dropdown8_P')
    //   - P.1 的 fill_7（HKID）：widget → parent(T='1', FT=/Tx) → grandparent(T=fill_7_P)
    // rebuildAcroFormFields 只收錄自帶 FT 的 widget；這些 widget 從未被 setText/check 觸碰、
    // 保持掛靠 parent 的原始形態 → 被 rebuild 丟出 /Fields → 閱讀器裡變成
    // 白色不可修改的靜態框（用戶反饋：藍色可修改框消失）。
    // 修復：凡 parent 帶 FT 的 widget，複製 FT/Opt/DA/DV/Ff/Q 到自身、設全名 T、
    // 刪 Parent 脫離為獨立字段，讓 rebuild 收錄 → 恢復藍色可編輯框（與本地 Flask 一致：
    // dropdown 選項導出值都是 'Yes'，/I 恒為 0 → 顯示空白，劃線選項留給用戶手動選）。
    // 不刪 /AP（Chrome/PDFium 不重新生成外觀，刪了整條線會消失）。
    // ⚠ 必須在 setF 之前執行：fill_7 若被 setText 先 detach（widget 無 T）會變成
    // 無名字段；先 detach 並命名，再刪 parent 的 /T 防止 setText 二次 rename。
    // 兩遍式：先緩存 parent 名字（同組多 widget 共享一個 parent，第一個 detach
    // 刪 T 後同組後續 widget 會讀到空名 → 全變成 .0），再統一 detach。
    try {
      const inheritKeys = ["FT", "DA", "Ff", "Q", "DV", "Opt", "MaxLen"];
      const parentNameCache = new Map<string, { gpName: string; pName: string }>();
      // pass 1: 緩存帶 FT 的 parent 名字
      for (const page of pdfDoc.getPages()) {
        const annots = page.node.lookup(PDFName.of("Annots")) as any;
        if (!annots || typeof annots.size !== "function") continue;
        for (let i = 0; i < annots.size(); i++) {
          try {
            const widget = pdfDoc.context.lookup(annots.get(i)) as any;
            if (!widget || typeof widget.get !== "function") continue;
            if (String(widget.get(PDFName.of("Subtype"))) !== "/Widget") continue;
            const parentRef = widget.get(PDFName.of("Parent"));
            if (!parentRef || parentNameCache.has(String(parentRef))) continue;
            const parent = pdfDoc.context.lookup(parentRef) as any;
            if (!parent || typeof parent.get !== "function") continue;
            if (!parent.get(PDFName.of("FT"))) continue;
            const grandRef = parent.get(PDFName.of("Parent"));
            const grand = grandRef ? (pdfDoc.context.lookup(grandRef) as any) : null;
            parentNameCache.set(String(parentRef), {
              gpName: grand ? decodePdfText(grand.get(PDFName.of("T"))) : "",
              pName: decodePdfText(parent.get(PDFName.of("T"))),
            });
          } catch { /* skip */ }
        }
      }
      // pass 2: detach
      let detached = 0;
      for (const page of pdfDoc.getPages()) {
        const annots = page.node.lookup(PDFName.of("Annots")) as any;
        if (!annots || typeof annots.size !== "function") continue;
        for (let i = 0; i < annots.size(); i++) {
          try {
            const widget = pdfDoc.context.lookup(annots.get(i)) as any;
            if (!widget || typeof widget.get !== "function") continue;
            if (String(widget.get(PDFName.of("Subtype"))) !== "/Widget") continue;
            const parentRef = widget.get(PDFName.of("Parent"));
            if (!parentRef) continue;
            const info = parentNameCache.get(String(parentRef));
            if (!info) continue;
            const parent = pdfDoc.context.lookup(parentRef) as any;
            for (const k of inheritKeys) {
              const key = PDFName.of(k);
              if (!widget.get(key)) {
                const v = parent.get(key);
                if (v !== undefined && v !== null) widget.set(key, v);
              }
            }
            // 3 級（grandparent 有 T）：`${grand}.${parent}` → Dropdown1_P.2 / fill_7_P.1
            // 2 級（無 grandparent）：`${parent}.0`
            widget.set(PDFName.of("T"), PDFString.of(info.gpName ? `${info.gpName}.${info.pName || "0"}` : `${info.pName || "field"}.0`));
            widget.delete(PDFName.of("Parent"));
            // 僅 /Tx parent（fill_7）刪 T：防 setText 的 detachWidget 二次 rename
            // （如 fill_7 → '1.fill_7_P.1'）。dropdown parent（/Ch）setText 不會碰，保留無妨。
            if (String(parent.get(PDFName.of("FT"))) === "/Tx") parent.delete(PDFName.of("T"));
            detached++;
          } catch { /* skip malformed widget */ }
        }
      }
      console.log(`ND4: detached ${detached} parented widgets for editable fields`);
    } catch { /* non-critical */ }

    // CJK-aware set text field using createFormHelpers
    // Falls back to raw widget manipulation for fields not in the helpers map
    const setF = (name: string, value?: string) => {
      if (value == null || value === "") return;
      if (_cjkSetText(name, String(value)) === true) return;
      // Field not found in helpers map — skip silently
      console.warn(`⚠ ND4: field not found: ${name}`);
    };

    const checkF = (name: string, shouldCheck?: boolean) => {
      if (!shouldCheck) return;
      _cjkCheck(name, true);
    };

    const brNumber = String(rget(data, 'brNumber') || rget(data, 'br_number') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
    const officerType = rget(data, 'officerType') || rget(data, 'officer_type') || 'director';
    const identity = rget(data, 'identity') || 'natural';

    // ═══ P.1: Company Info ═══
    setF('fill_1_P.1', brNumber);
    setF('fill_2_P.1', rget(data, 'companyName'));

    // Company type checkboxes (cb_1=private, cb_2=public, cb_3=guarantee)
    const companyType = (rget(data, 'companyType') || '').toLowerCase();
    checkF('cb_1_P.1', companyType.includes('私人') || companyType.includes('private'));
    checkF('cb_2_P.1', companyType.includes('公眾') || companyType.includes('public'));
    checkF('cb_3_P.1', companyType.includes('擔保') || companyType.includes('guarantee'));

    // ═══ P.1: Identity toggle (fill fields based on identity, not checkboxes) ═══
    // Note: toggle_4_P.1/toggle_5_P.1 are YES/NO for "continue to hold office" question,
    // NOT identity toggles. See below.

    // ═══ P.1: Officer Details (per identity) ═══
    // Template labels verified 2026-07-30:
    //   fill_3_P.1 = "代替 Alternate to" (label at x=405)
    //   fill_11/12/13_P.1 = "辭職日期 Date of Resignation" + "日DD 月MM 年YYYY" (label at y=614)
    const rd = rget(data, 'resignationDay');
    const rm = rget(data, 'resignationMonth');
    const ry = rget(data, 'resignationYear');
    const resignDateStr = (rd && rm && ry) ? `${rd}/${rm}/${ry}` : '';

    // Resignation date → fill_11/12/13_P.1 (NOT fill_3_P.1)
    if (rd && rm && ry) {
      setF('fill_11_P.1', rd);
      setF('fill_12_P.1', rm);
      setF('fill_13_P.1', ry);
    }

    // fill_3_P.1 = "代替 Alternate to" — only for alternate directors
    if (officerType === 'alternate' || officerType === 'reserve_director') {
      const altTo = rget(data, 'alternateTo') || rget(data, 'officerNameEnglish');
      setF('fill_3_P.1', altTo);
    }

    if (identity === 'natural') {
      // Natural person fields
      setF('fill_4_P.1', rget(data, 'officerNameChinese') || rget(data, 'nameChinese'));
      setF('fill_5_P.1', rget(data, 'surname'));
      setF('fill_6_P.1', rget(data, 'otherNames'));
      setF('fill_7_P.1', rget(data, 'hkidPartial'));
      setF('fill_8_P.1', rget(data, 'passportCountry'));
      setF('fill_8b_P.1', rget(data, 'passportPartial'));
    } else {
      // Corporate body fields
      setF('fill_9_P.1', rget(data, 'corporateName') || rget(data, 'officerNameEnglish'));
      setF('fill_10_P.1', rget(data, 'corporateNumber') || brNumber);
    }

    // ═══ P.1: "是否仍然擔任" — answer should be NO (person is resigning) ═══
    // toggle_4_P.1 = Yes / 是 (don't check)
    // toggle_5_P.1 = No / 否 (CHECK — will NOT continue to hold office)
    checkF('toggle_5_P.1', true);

    // ═══ P.1: Presenter ═══
    const pn = rget(data, 'presentorName') || rget(data, 'presenterName') || DEFAULT_PRESENTER.name;
    setF('fill_14_P.1', pn);
    const pa = rget(data, 'presentorAddress') || rget(data, 'presenterAddress') || DEFAULT_PRESENTER.address;
    setF('fill_15_P.1', pa);
    setF('fill_16_P.1', rget(data, 'presentorPhone') || rget(data, 'presenterPhone') || DEFAULT_PRESENTER.phone);
    setF('fill_17_P.1', rget(data, 'presentorFax') || rget(data, 'presenterFax') || DEFAULT_PRESENTER.fax);
    setF('fill_18_P.1', rget(data, 'presentorEmail') || rget(data, 'presenterEmail') || DEFAULT_PRESENTER.email);
    setF('fill_19_P.1', rget(data, 'presentorReference') || rget(data, 'presenterReference') || DEFAULT_PRESENTER.reference);

    // ═══ P.2: BR + Role Declaration ═══
    setF('fill_1_P.2', brNumber);

    // Role checkboxes on P.2 (matching Flask):
    //   cb_1_P.2 = Director resignation
    //   cb_2_P.2 = Alternate Director resignation
    //   cb_3_P.2 = Secretary resignation
    checkF('cb_1_P.2', officerType === 'director');
    checkF('cb_2_P.2', officerType === 'alternate' || officerType === 'reserve_director');
    checkF('cb_3_P.2', officerType === 'secretary');

    // ═══ P.2: Signer + Sign Date ═══
    const signerName = rget(data, 'signerName') || rget(data, 'presentorName') || rget(data, 'presenterName') || DEFAULT_PRESENTER.name;
    setF('fill_2_P.2', signerName);
    // Sign date on P.2 (defaults to today since form is generated before signing)
    const today = new Date();
    const sd2 = rget(data, 'signDateDay') || String(today.getDate()).padStart(2, '0');
    const sm2 = rget(data, 'signDateMonth') || String(today.getMonth() + 1).padStart(2, '0');
    const sy2 = rget(data, 'signDateYear') || String(today.getFullYear());
    setF('fill_3_P.2', `${sd2}/${sm2}/${sy2}`);

    // ═══ BR stamp on all pages ═══
    if (brNumber) {
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
      }
    }

    // ═══ Remove blank instruction pages (P.3–P.6) ═══
    // ND4 template only has real form fields on P.1 and P.2.
    // Pages 3-6 are white instruction/reference pages — delete them.
    const totalPages = pdfDoc.getPageCount();
    // Remove from the end to keep indices stable
    for (let i = totalPages - 1; i >= 2; i--) {
      pdfDoc.removePage(i);
    }

    // Rebuild AcroForm /Fields array with detached widget refs
    rebuildAcroFormFields(pdfDoc);

    const pdfBytes = new Uint8Array(await pdfDoc.save({ updateFieldAppearances: false }));
    const filename = `ND4_${brNumber || 'form'}.pdf`;

    return jsonResp({ pdf: uint8ToBase64(pdfBytes), filename });
  } catch (e: any) {
    console.error("ND4 generation error:", e);
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}
