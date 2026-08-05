// POST /api/generate-scr-pdf
// SCR Register PDF — background template + text overlay (Paul Tang format)
// Template has all static elements pre-drawn; this only overlays dynamic text.
// Much simpler and lighter than the old draw-from-scratch approach.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget,
  drawMixed, drawMixedRight, widthOfText, segmentText, wrapText,
  fetchAndEmbedFont, hasCjk,
} from './_pdf-utils';

type Env = AuthEnv & {
  DB: D1Database;
  R2: R2Bucket;
};

const PW = 842, PH = 595; // Landscape A4
const M = 28;

// Column positions (from template generator, same as local server.py)
const COL_X = [28, 107.3, 219.1, 366.4, 506.9, 631.4, 719.8];
const COL_W = [79.3, 111.9, 147.3, 140.5, 124.5, 88.4, 94.2];
const DATA_ROW_H = 20;
const DATA_SIZE = 8;
const CELL_PAD = 3;

// Header value positions (pdf-lib y = PH - fpdf2_y)
const Y_NAME_EN = PH - 22;   // y where company name EN goes
const Y_NAME_CN = PH - 34;   // y where company name CN goes
const Y_BR_EN = PH - 50;     // y where BR EN goes
const Y_BR_CN = PH - 64;     // y where BR CN goes
const Y_TABLE_TOP = PH - 178; // y of first data row top (after table headers)
const ROW_CAPACITY_P1 = 10;   // rows before overlapping Additional Matters on page 1
const ROW_CAPACITY_CONT = 14; // rows per continuation page

// ══════════════════════════════════════════════════════════════
//  Main handler
// ══════════════════════════════════════════════════════════════
export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const { companyId } = await request.json() as any;
    if (!companyId) {
      return jsonResp({ error: 'companyId required' }, 400);
    }

    // R2 bucket binding (use same pattern as other endpoints)
    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2 || env.R2;
    if (!r2Bucket) throw new Error("R2 bucket not available");

    // Fetch company, SCR data, and template in parallel
    const [company, scrResult, templateObj] = await Promise.all([
      env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first(),
      env.DB.prepare("SELECT * FROM significant_controllers WHERE company_id = ? ORDER BY created_at").bind(companyId).all(),
      r2Bucket.get("scr-template-bg.pdf"),
    ]);

    if (!company) throw new Error("Company not found");
    if (!templateObj) throw new Error("SCR template not found in R2");

    const scrs = (scrResult.results || []) as any[];
    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());

    // Load template PDF and create output PDF
    const [templatePdf, outPdf] = await Promise.all([
      PDFDocument.load(templateBytes),
      PDFDocument.create(),
    ]);

    // Load fonts via shared R2-first fetchAndEmbedFont
    const { cjk: cjkFont, ascii: asciiFont, cjkMissing } = await fetchAndEmbedFont(outPdf, env as any);
    const f = { cjk: cjkFont, ascii: asciiFont };

    const templatePages = templatePdf.getPages();
    const tplPage1 = templatePages[0];  // full header + rows + Additional Matters
    const tplPageCont = templatePages.length > 1 ? templatePages[1] : templatePages[0]; // continuation

    // Embed template pages as FormXObjects
    const [tplRef1, tplRefCont] = await Promise.all([
      outPdf.embedPage(tplPage1),
      outPdf.embedPage(tplPageCont),
    ]);

    // ── Company data ──
    const coName = rget(company, 'name') || '';
    const coNameCh = rget(company, 'chinese_name') || '';
    const br = rget(company, 'company_number') || '';

    // ── Build all data rows ──
    interface DataRow { texts: string[]; rowH: number; }
    const allRows: DataRow[] = [];

    for (const s of scrs) {
      const natures: string[] = [];
      if (rget(s, 'nature_shares')) natures.push('>25% shares');
      if (rget(s, 'nature_voting')) natures.push('>25% voting');
      if (rget(s, 'nature_appoint')) natures.push('Appoint/remove directors');
      if (rget(s, 'nature_influence')) natures.push('Sig. influence');
      if (rget(s, 'nature_trust')) natures.push('Trust control');
      if (rget(s, 'nature_other')) natures.push(rget(s, 'nature_other'));

      const isNat = rget(s, 'identity') !== 'corporate';
      const nameEn = rget(s, 'name_english') || '';
      const nameCh = rget(s, 'name_chinese') || '';
      const nameDisplay = nameCh ? `${nameCh}  ${nameEn}`.trim() : (nameEn || '(unnamed)');

      let idBlock: string;
      if (isNat) {
        const idNo = rget(s, 'id_number') || rget(s, 'passport_number') || '-';
        const passportCountry = rget(s, 'passport_country') || '';
        idBlock = `ID/PPT: ${idNo}`;
        if (passportCountry) idBlock += ` (${passportCountry})`;
        idBlock += " | Natural Person";
      } else {
        const compNo = rget(s, 'company_number_ref') || '-';
        const placeIncorp = rget(s, 'place_of_incorporation') || '';
        const legalForm = rget(s, 'legal_form') || '';
        idBlock = `Co No: ${compNo}`;
        if (placeIncorp) idBlock += ` (${placeIncorp})`;
        if (legalForm) idBlock += ` | ${legalForm}`;
        idBlock += " | Body Corporate";
      }

      const addr = (rget(s, 'address') || '').slice(0, 200);
      const natureText = natures.join(', ') || '-';
      const dateBecame = rget(s, 'date_became') || '-';
      const dateCea = rget(s, 'date_ceased') || '';
      const dateDisplay = dateCea ? `${dateBecame}  /  ${dateCea}` : `${dateBecame}  /`;

      let entryDate = rget(s, 'created_at') || '';
      if (entryDate && entryDate.length > 10) entryDate = entryDate.slice(0, 10);

      const remarksParts: string[] = [];
      if (!dateCea) remarksParts.push("Current / 現任");
      if (rget(s, 'is_designated_rep') && rget(s, 'designated_rep_name')) {
        remarksParts.push(`Rep: ${rget(s, 'designated_rep_name')}`);
      }
      const userRemarks = rget(s, 'remarks') || '';
      if (userRemarks) remarksParts.push(userRemarks);
      const remarks = remarksParts.join('\n');

      const rowTexts = [entryDate, nameDisplay, addr, idBlock, natureText, dateDisplay, remarks];

      // Calculate row height (using shared wrapText)
      let rowH = DATA_ROW_H;
      for (let ci = 0; ci < rowTexts.length; ci++) {
        const txt = rowTexts[ci];
        if (!txt) continue;
        const cwAvail = Math.max((COL_W[ci] || 94.2) - CELL_PAD, 20);
        const lines = wrapText(String(txt), cjkFont, asciiFont, DATA_SIZE, cwAvail);
        rowH = Math.max(rowH, lines.length * (DATA_SIZE + 2) + 4);
      }

      allRows.push({ texts: rowTexts, rowH });
    }

    // ── Layout pages ──
    const pages: { tplRef: any; rows: DataRow[]; isPage1: boolean }[] = [];
    let rowIdx = 0;

    if (allRows.length === 0) {
      pages.push({ tplRef: tplRef1, rows: [], isPage1: true });
    } else {
      // Page 1
      const p1rows = allRows.slice(0, ROW_CAPACITY_P1);
      pages.push({ tplRef: tplRef1, rows: p1rows, isPage1: true });
      rowIdx = p1rows.length;

      // Continuation pages
      while (rowIdx < allRows.length) {
        const contRows = allRows.slice(rowIdx, rowIdx + ROW_CAPACITY_CONT);
        pages.push({ tplRef: tplRefCont, rows: contRows, isPage1: false });
        rowIdx += contRows.length;
      }
    }

    // ── Render pages ──
    const lastPageIdx = pages.length - 1;

    for (let pi = 0; pi < pages.length; pi++) {
      const { tplRef, rows, isPage1 } = pages[pi];
      const page = outPdf.addPage([PW, PH]);

      // Draw template background
      page.drawPage(tplRef);

      // Draw header values (only on page 1) — using drawMixed for CJK/ASCII safety
      if (isPage1) {
        // Company name EN after "NAME OF COMPANY:  " label
        const labelEnW = asciiFont.widthOfTextAtSize("NAME OF COMPANY:  ", 8);
        drawMixed(page, coName || coNameCh, {
          x: M + labelEnW + 2, y: Y_NAME_EN, size: 8, cjk: f.cjk, ascii: f.ascii,
        });

        // Company name CN after "公司名稱:  " label
        const labelCnW = cjkMissing
          ? asciiFont.widthOfTextAtSize("公司名稱:  ", 8)
          : cjkFont.widthOfTextAtSize("公司名稱:  ", 8);
        const cnVal = coNameCh || coName;
        drawMixed(page, cnVal, {
          x: M + labelCnW + 2, y: Y_NAME_CN, size: 8, cjk: f.cjk, ascii: f.ascii,
        });
        // Underline under CN name
        const cnValW = widthOfText(cnVal, cjkFont, asciiFont, 8);
        const ulStart = M + labelCnW;
        const ulEnd = Math.max(ulStart + cnValW + 2, ulStart + 150);
        page.drawLine({ start: { x: ulStart, y: Y_NAME_CN - 11 }, end: { x: ulEnd, y: Y_NAME_CN - 11 }, thickness: 0.3 });

        // BR EN after "COMPANY NUMBER:  " label
        const labelBrEnW = asciiFont.widthOfTextAtSize("COMPANY NUMBER:  ", 8);
        drawMixed(page, br || '', {
          x: M + labelBrEnW + 2, y: Y_BR_EN, size: 8, cjk: f.cjk, ascii: f.ascii,
        });

        // BR CN after "公司編號:  " label
        const labelBrCnW = cjkMissing
          ? asciiFont.widthOfTextAtSize("公司編號:  ", 8)
          : cjkFont.widthOfTextAtSize("公司編號:  ", 8);
        drawMixed(page, br || '', {
          x: M + labelBrCnW + 2, y: Y_BR_CN, size: 8, cjk: f.cjk, ascii: f.ascii,
        });
        // Underline under BR CN
        const brValW = widthOfText(br || '', cjkFont, asciiFont, 8);
        const brUlStart = M + labelBrCnW;
        const brUlEnd = Math.max(brUlStart + brValW + 2, brUlStart + 100);
        page.drawLine({ start: { x: brUlStart, y: Y_BR_CN - 11 }, end: { x: brUlEnd, y: Y_BR_CN - 11 }, thickness: 0.3 });
      }

      // ── Draw data rows using drawMixed/drawMixedRight for proper CJK/ASCII rendering ──
      let rowY = Y_TABLE_TOP;
      for (const row of rows) {
        const { texts, rowH } = row;
        for (let ci = 0; ci < texts.length && ci < COL_X.length; ci++) {
          const txt = texts[ci];
          if (!txt) continue;
          const cwAvail = Math.max(COL_W[ci] - CELL_PAD * 2, 20);
          const lines = wrapText(String(txt), cjkFont, asciiFont, DATA_SIZE, cwAvail);

          // Center text vertically in cell
          const textBlockH = lines.length * (DATA_SIZE + 2);
          const textStartY = rowY - (rowH - textBlockH) / 2 - DATA_SIZE;

          for (let li = 0; li < lines.length; li++) {
            const lineY = textStartY - li * (DATA_SIZE + 2);
            // Remarks column (ci=6) centered, others left-aligned
            if (ci === 6) {
              drawMixedRight(page, lines[li], {
                x: COL_X[ci] + COL_W[ci] - CELL_PAD, y: lineY, size: DATA_SIZE, cjk: f.cjk, ascii: f.ascii,
              });
            } else {
              drawMixed(page, lines[li], {
                x: COL_X[ci] + CELL_PAD, y: lineY, size: DATA_SIZE, cjk: f.cjk, ascii: f.ascii,
              });
            }
          }
        }
        rowY -= rowH;
      }
    }

    const bytes = new Uint8Array(await outPdf.save());
    return jsonResp({ pdf: uint8ToBase64(bytes) });
  } catch (e: any) {
    console.error('SCR PDF error:', e);
    return jsonResp({ error: e.message || String(e) }, 500);
  }
}
