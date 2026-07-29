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
  fetchAndEmbedFont,
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

    function hasCjk(s: string): boolean {
      for (const ch of s) {
        const c = ch.charCodeAt(0);
        if (c > 127) return true;
      }
      return false;
    }

    // Helper: set text field (with CJK updateAppearances when needed)
    const setF = (name: string, value?: string, forceCjk?: boolean) => {
      if (value == null || value === "") return;
      try {
        const tf = form.getTextField(name);
        tf.setText(String(value));
        if (cjk && (forceCjk || hasCjk(String(value)))) tf.updateAppearances(cjk);
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
      setF('fill_4_P.1', rget(data, 'officerNameChinese') || rget(data, 'nameChinese'), true);
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
    const pn = rget(data, 'presentorName') || rget(data, 'presenterName');
    setF('fill_14_P.1', pn, true); // may contain Chinese
    const pa = rget(data, 'presentorAddress') || rget(data, 'presenterAddress');
    setF('fill_15_P.1', pa, true); // may contain Chinese
    setF('fill_16_P.1', rget(data, 'presentorPhone') || rget(data, 'presenterPhone'));
    setF('fill_17_P.1', rget(data, 'presentorFax') || rget(data, 'presenterFax'));
    setF('fill_18_P.1', rget(data, 'presentorEmail') || rget(data, 'presenterEmail'));
    setF('fill_19_P.1', rget(data, 'presentorReference') || rget(data, 'presenterReference'));

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
    // Draw lines over the inapplicable role labels on P.2
    // Dropdown_1/Dropdown_2 cover "Director / Company Secretary" mutual exclusion
    // Dropdown_3/Dropdown_4 cover "Alternate Director" mutual exclusion
    try {
      const page2 = pdfDoc.getPage(1); // 0-indexed, P.2 = page 1
      // Draw strikethrough lines based on officer type
      // If officer is secretary → strike through "Director" options
      // If officer is director → strike through "Secretary" options
      // If officer is alternate → strike through non-alternate options
      if (officerType === 'secretary') {
        // Strike through Director labels (approximate positions)
        page2.drawLine({ start: { x: 100, y: 350 }, end: { x: 200, y: 350 }, thickness: 1.2 });
      } else if (officerType === 'director') {
        // Strike through Secretary labels
        page2.drawLine({ start: { x: 250, y: 350 }, end: { x: 380, y: 350 }, thickness: 1.2 });
      } else if (officerType === 'alternate' || officerType === 'reserve_director') {
        // Strike through non-alternate director labels
        page2.drawLine({ start: { x: 100, y: 350 }, end: { x: 200, y: 350 }, thickness: 1.2 });
        page2.drawLine({ start: { x: 250, y: 350 }, end: { x: 380, y: 350 }, thickness: 1.2 });
      }
    } catch { /* non-critical */ }

    // ═══ P.2: Signer ═══
    const signerName = rget(data, 'signerName') || rget(data, 'presentorName') || rget(data, 'presenterName');
    setF('fill_2_P.2', signerName, true); // may contain Chinese
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
