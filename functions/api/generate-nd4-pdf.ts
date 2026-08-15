// POST /api/generate-nd4-pdf
// ND4 — Notice of Resignation of Company Secretary and Director
// Template fill matching local Flask _fill_nd4_pdf logic:
//   P.1: BR + company name + company type (cb_1=private, cb_2=public, cb_3=guarantee)
//        + identity toggles (toggle_4=natural, toggle_5=corporate)
//        + officer details + signer + presenter
//   P.2: role checkboxes (cb_1=director, cb_2=alternate, cb_3=secretary)
//        + dropdown strikethrough + signer + date + BR stamp on all pages

import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  DEFAULT_PRESENTER,
} from './_pdf-utils';
import { createFormHelpers, enableNeedAppearances, rebuildAcroFormFields } from './_acroform';
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
    const form = pdfDoc.getForm();  // kept for dropdown operations

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

    // ═══ P.2: Dropdown strikethrough (matching Flask _handle_nd4_dropdowns) ═══
    // ND4 P.2 有 8 個 Dropdown widget（中英文雙行）：
    //   Dropdown1/2 → "Director"/"Secretary" 互斥劃線
    //   Dropdown3/4 → 候補董事 互斥劃線
    //   Dropdown5/6 → 秘書辭任 互斥劃線
    //   Dropdown7/8 → 簽署人身份 (董事/秘書)
    // 策略：從 form 獲取 widget 實際位置，在被劃掉的角色上畫橫線
    //       如果無法獲取 widget 則回退到 NAR1 風格的 drawLine 硬座標
    try {
      const page2 = pdfDoc.getPage(1); // 0-indexed, P.2 = page 1

      // Helper: get widget rect for a dropdown field on a specific page
      const getDropdownRect = (fieldName: string): { x: number; y: number; w: number; h: number } | null => {
        try {
          const dropdown = form.getDropdown(fieldName);
          // pdf-lib 的 getDropdown 返回 PDFDropdown，acroField 包含 widget annotations
          const acroField = (dropdown as any).acroField;
          const fieldRef = acroField?.ref;
          if (!fieldRef) return null;
          // 透過 doc 上下文查找 widget
          const field = pdfDoc.context.lookup(fieldRef) as any;
          const kids = field?.lookup?.(PDFName.of('Kids'));
          if (!kids) return null;
          // 遍歷 kids 找在此頁面的 widget
          const P = page2.ref;
          for (let i = 0; i < kids.size(); i++) {
            const kidRef = kids.get(i);
            const kid = pdfDoc.context.lookup(kidRef) as any;
            const kidP = kid?.lookup?.(PDFName.of('P'));
            if (kidP && kidP === P) {
              const rect = kid.lookup(PDFName.of('Rect'));
              if (rect && rect.size() >= 4) {
                return { x: rect.get(0), y: rect.get(1), w: rect.get(2) - rect.get(0), h: rect.get(3) - rect.get(1) };
              }
            }
          }
        } catch { /* fall through */ }
        return null;
      };

      // Determine which dropdowns to strike through
      // If director resigning → strike through Secretary + non-applicable labels
      // If secretary resigning → strike through Director + non-applicable labels

      // Dropdown1/2: "Director" vs "Company Secretary" role declaration (互斥劃線)
      // Dropdown3/4: Alternate Director role declaration
      // Dropdown7/8: 簽署人身份 — Signer capacity (董事/秘書)
      const crossPairs: string[] = [];
      if (officerType === 'director') {
        // Dropdown2 = Secretary(劃掉), Dropdown8 = Secretary signer(劃掉)
        crossPairs.push('Dropdown_2_P.2', 'Dropdown_8_P.2');
      } else if (officerType === 'secretary') {
        // Dropdown1 = Director(劃掉), Dropdown7 = Director signer(劃掉)
        crossPairs.push('Dropdown_1_P.2', 'Dropdown_7_P.2');
      } else if (officerType === 'alternate' || officerType === 'reserve_director') {
        // Dropdown3 = Director(劃掉, alternate is NOT director), Dropdown7/8 based on signer
        crossPairs.push('Dropdown_3_P.2');
        // For signer capacity: alternate is a type of director → cross Secretary (Dropdown8)
        crossPairs.push('Dropdown_8_P.2');
      }

      // Try to draw lines using actual widget positions
      for (const ddName of crossPairs) {
        const rect = getDropdownRect(ddName);
        if (rect) {
          const yMid = rect.y + rect.h / 2;
          page2.drawLine({
            start: { x: rect.x + 2, y: yMid },
            end: { x: rect.x + rect.w - 2, y: yMid },
            thickness: 1.2,
          });
        }
      }
    } catch { /* non-critical */ }

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
