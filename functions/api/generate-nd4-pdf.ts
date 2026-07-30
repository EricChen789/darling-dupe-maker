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
  fetchAndEmbedFont, DEFAULT_PRESENTER,
} from './_pdf-utils';
import { enableNeedAppearances } from './_acroform';
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
    const { cjk } = await fetchAndEmbedFont(pdfDoc, env as any);
    const helv = (await pdfDoc.embedFont(StandardFonts.Helvetica));
    const form = pdfDoc.getForm();

    const brNumber = String(rget(data, 'brNumber') || rget(data, 'br_number') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
    const officerType = rget(data, 'officerType') || rget(data, 'officer_type') || 'director';
    const identity = rget(data, 'identity') || 'natural';

    // Helper: set text field
    const setF = (name: string, value?: string) => {
      if (value == null || value === "") return;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        // Skip updateAppearances — saves CPU, reader rebuilds via NeedAppearances
      } catch { /* skip */ }
    };

    // Helper: check checkbox
    const checkF = (name: string, shouldCheck?: boolean) => {
      if (!shouldCheck) return;
      try { form.getCheckBox(name).check(); } catch { /* skip */ }
    };

    // ═══ P.1: Company Info ═══
    setF('fill_1_P.1', brNumber);
    setF('fill_2_P.1', rget(data, 'companyName'));

    // Company type checkboxes (cb_1=private, cb_2=public, cb_3=guarantee)
    const companyType = (rget(data, 'companyType') || '').toLowerCase();
    checkF('cb_1_P.1', companyType.includes('私人') || companyType.includes('private'));
    checkF('cb_2_P.1', companyType.includes('公眾') || companyType.includes('public'));
    checkF('cb_3_P.1', companyType.includes('擔保') || companyType.includes('guarantee'));

    // Identity toggles (toggle_4=natural, toggle_5=corporate)
    checkF('toggle_4_P.1', identity === 'natural');
    checkF('toggle_5_P.1', identity === 'corporate');

    // ═══ P.1: Officer Details (per identity) ═══
    if (identity === 'natural') {
      // fill_3: resignation date OR alternate name (dual-purpose)
      if (officerType === 'alternate') {
        setF('fill_3_P.1', rget(data, 'alternateTo') || rget(data, 'officerNameEnglish'));
      } else {
        const rd = rget(data, 'resignationDay');
        const rm = rget(data, 'resignationMonth');
        const ry = rget(data, 'resignationYear');
        if (rd && rm && ry) setF('fill_3_P.1', `${rd}/${rm}/${ry}`);
      }
      // Natural person fields (force CJK for Chinese name)
      setF('fill_4_P.1', rget(data, 'officerNameChinese') || rget(data, 'nameChinese'));
      setF('fill_5_P.1', rget(data, 'surname'));
      setF('fill_6_P.1', rget(data, 'otherNames'));
      setF('fill_7_P.1', rget(data, 'hkidPartial'));
      setF('fill_8_P.1', rget(data, 'passportCountry'));

      // "Yes" checkbox: confirm this person is/was a company officer
      // cb_4_P.1 = Yes (common ND4 template layout)
      checkF('cb_4_P.1', true);
    } else {
      // Corporate body fields
      setF('fill_9_P.1', rget(data, 'corporateName') || rget(data, 'officerNameEnglish'));
      setF('fill_10_P.1', rget(data, 'corporateNumber') || brNumber);

      // Resignation date for corporate (uses fill_3 as well)
      const rd = rget(data, 'resignationDay');
      const rm = rget(data, 'resignationMonth');
      const ry = rget(data, 'resignationYear');
      if (rd && rm && ry) setF('fill_3_P.1', `${rd}/${rm}/${ry}`);

      // "Yes" checkbox for corporate
      checkF('cb_4_P.1', true);
    }

    // ═══ P.1: Sign Date ═══
    setF('fill_11_P.1', rget(data, 'signDateDay'));
    setF('fill_12_P.1', rget(data, 'signDateMonth'));
    setF('fill_13_P.1', rget(data, 'signDateYear'));

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

    // ═══ P.2: Signer ═══
    const signerName = rget(data, 'signerName') || rget(data, 'presentorName') || rget(data, 'presenterName') || DEFAULT_PRESENTER.name;
    setF('fill_2_P.2', signerName);
    const sd = rget(data, 'signDateDay');
    const sm = rget(data, 'signDateMonth');
    const sy = rget(data, 'signDateYear');
    if (sd && sm && sy) {
      setF('fill_3_P.2', `${sd}/${sm}/${sy}`);
    }

    // ═══ BR stamp on all pages ═══
    if (brNumber) {
      const stampFont = cjk || helv;
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: stampFont });
      }
    }

    // Skip flatten — saves CPU; NeedAppearances lets PDF reader rebuild appearances
    enableNeedAppearances(pdfDoc);
    const pdfBytes = new Uint8Array(await pdfDoc.save());
    const filename = `ND4_${brNumber || 'form'}.pdf`;

    return jsonResp({ pdf: uint8ToBase64(pdfBytes), filename });
  } catch (e: any) {
    console.error("ND4 generation error:", e);
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}
