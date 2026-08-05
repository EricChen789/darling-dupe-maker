// POST /api/generate-nnc1-pdf
// NNC1 法團成立表格（股份有限公司）— 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
// CPU优化: enableNeedAppearances + updateFieldAppearances:false（24页模板）
// 支援多自然人 → 自動複製 PI-NNC1 頁面（每頁一人）
//   策略：
//     Person 0 → form API + updateAppearances(cjkFont) — 真實 AP，像打字填入
//     Person 1+ → copyPages + drawMixed overlay — 繞過 widget field-name 共享
//     嵌入 Noto Sans TC（R2）提供 CJK 渲染

import { PDFDocument, StandardFonts } from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64, drawMixed, fetchAndEmbedFont } from "./_pdf-utils";
import { enableNeedAppearances } from "./_acroform";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC1-template.pdf";

// ═══ PI-NNC1 (P.14) — 受保護資料頁 ═══
// Hybrid strategy:
//   Person 0 → form API + updateAppearances(cjkFont) — real AP stream, true form fill
//   Person 1+ → copyPages + drawMixed overlay — bypasses shared field-name limitation

interface PiField {
  name: string;   // form field name e.g. "fill_2_P.14"
  key: string;    // piPerson property key
  x: number;      // pdf-lib drawText x (origin bottom-left)
  y: number;      // pdf-lib drawText y (field rect bottom)
  w: number;      // field width
  h: number;      // field height
  isCjk: boolean; // true → use cjk font for updateAppearances / drawMixed
}

const PI_FIELDS: PiField[] = [
  { name: 'fill_2_P.14',  key: 'nameChinese',     x: 207, y: 436, w: 355, h: 22, isCjk: true  },
  { name: 'fill_3_P.14',  key: 'surname',         x: 207, y: 406, w: 355, h: 23, isCjk: false },
  { name: 'fill_4_P.14',  key: 'otherNames',      x: 207, y: 378, w: 355, h: 22, isCjk: false },
  { name: 'fill_5_P.14',  key: 'hkidMain',        x: 257, y: 338, w: 256, h: 22, isCjk: false },
  { name: 'fill_6_P.14',  key: 'hkidCheck',       x: 526, y: 338, w:  24, h: 22, isCjk: false },
  { name: 'fill_7_P.14',  key: 'passportCountry', x: 257, y: 310, w: 305, h: 22, isCjk: true  },
  { name: 'fill_8_P.14',  key: 'passportNumber',  x: 257, y: 282, w: 305, h: 22, isCjk: false },
  { name: 'fill_9_P.14',  key: 'addrFlat',        x: 207, y: 230, w: 355, h: 27, isCjk: true  },
  { name: 'fill_10_P.14', key: 'addrBuilding',    x: 207, y: 196, w: 355, h: 27, isCjk: true  },
  { name: 'fill_11_P.14', key: 'addrStreet',      x: 207, y: 162, w: 355, h: 27, isCjk: true  },
  { name: 'fill_12_P.14', key: 'addrDistrict',    x: 207, y: 128, w: 355, h: 27, isCjk: true  },
  { name: 'fill_13_P.14', key: 'addrRegion',      x: 207, y:  94, w: 355, h: 27, isCjk: true  },
];

/** Fill Person 0 on the ORIGINAL P.14 using form API + updateAppearances.
 *  Generates real appearance streams — the text is truly "in" the form fields. */
function fillPiFormAPI(
  form: any,
  piPerson: Record<string, any>,
  fonts: { cjk: any; ascii: any }
): void {
  // Company name (fill_1_P.14) — top of page
  const coName = String(piPerson['companyName'] ?? '').trim();
  if (coName) {
    try {
      const tf = form.getTextField('fill_1_P.14');
      tf.setText(coName);
      tf.updateAppearances(fonts.cjk);
    } catch { /* field may not exist */ }
  }

  // Person data fields (fill_2 ~ fill_13)
  for (const f of PI_FIELDS) {
    const val = String(piPerson[f.key] ?? '').trim();
    if (!val) continue;
    try {
      const tf = form.getTextField(f.name);
      tf.setText(val);
      tf.updateAppearances(f.isCjk ? fonts.cjk : fonts.ascii);
    } catch { /* skip missing field */ }
  }

  // Checkboxes: cb_1 = 公司秘書, cb_2 = 董事
  try {
    if (piPerson['isSecretary']) {
      form.getCheckBox('cb_1_P.14').check();
    } else {
      form.getCheckBox('cb_2_P.14').check();
    }
  } catch { /* skip */ }
}

/** Fill Person 1+ on a COPIED P.14 page using drawMixed overlay.
 *  Cannot use form API because copyPages shares field names across copies. */
function fillPiDrawText(
  pdfDoc: any,
  pageIndex: number,
  piPerson: Record<string, any>,
  fonts: { cjk: any; ascii: any }
): void {
  const page = pdfDoc.getPages()[pageIndex];
  if (!page) return;

  // Company name at top of page (above fill_2)
  const coName = String(piPerson['companyName'] ?? '').trim();
  if (coName) {
    drawMixed(page, coName, {
      x: 209, y: 500, size: 9, cjk: fonts.cjk, ascii: fonts.ascii,
    });
  }

  // Person data fields — draw text centered in each blue field box
  for (const f of PI_FIELDS) {
    const val = String(piPerson[f.key] ?? '').trim();
    if (!val) continue;
    // Vertical centering: baseline ≈ bottom + half height + small offset
    const textY = Math.round(f.y + f.h / 2 + 2);
    try {
      if (f.isCjk) {
        drawMixed(page, val, {
          x: f.x + 2, y: textY, size: 8, cjk: fonts.cjk, ascii: fonts.ascii,
        });
      } else {
        page.drawText(val, {
          x: f.x + 2, y: textY, size: 8, font: fonts.ascii,
        });
      }
    } catch {
      // Fallback: try drawMixed for everything
      try {
        drawMixed(page, val, {
          x: f.x + 2, y: textY, size: 8, cjk: fonts.cjk, ascii: fonts.ascii,
        });
      } catch { /* skip unrenderable field */ }
    }
  }

  // Checkbox tick mark
  try {
    const cbX = piPerson['isSecretary'] ? 208 : 315;
    page.drawText('✓', { x: cbX, y: 472, size: 10, font: fonts.cjk });
  } catch { /* skip */ }
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const data = await request.json() as {
      fields?: Record<string, unknown>;
      checkboxes?: string[];
      brNumber?: string;
      removePages?: number[];
      piPersons?: Array<{
        nameChinese: string;
        surname: string;
        otherNames: string;
        hkidMain: string;
        hkidCheck: string;
        isHkid: boolean;
        passportCountry: string;
        passportNumber: string;
        addrFlat: string;
        addrBuilding: string;
        addrStreet: string;
        addrDistrict: string;
        addrRegion: string;
        isSecretary: boolean;
      }>;
    };

    const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
    if (!r2Bucket) {
      return jsonResp({ error: "R2 bucket not available" }, 500);
    }

    // ── Load template ──
    const templateObj = await r2Bucket.get(TEMPLATE_NAME);
    if (!templateObj) return jsonResp({ error: `Template not found: ${TEMPLATE_NAME}` }, 404);

    const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

    const form = pdfDoc.getForm();

    // ── Embed fonts (shared by BR stamp + PI-NNC1) ──
    const fonts = await fetchAndEmbedFont(pdfDoc, env as any);

    // ── Fill text fields (skip P.14 — handled below via fillPiFormAPI / fillPiDrawText) ──
    const fields = data.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      if (name.endsWith('_P.14')) continue;
      try {
        const vstr = value != null ? String(value) : "";
        if (!vstr) continue;
        const tf = form.getTextField(name);
        tf.setText(vstr);
      } catch { /* field missing — skip */ }
    }

    // ── Check checkboxes (skip P.14 — handled below) ──
    for (const name of data.checkboxes || []) {
      if (name.endsWith('_P.14')) continue;
      try {
        form.getCheckBox(name).check();
      } catch { /* skip */ }
    }

    // ── BR stamp on all pages ──
    const brNumber = data.brNumber || "";
    if (brNumber) {
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: fonts.ascii });
      }
    }

    // ── PI-NNC1: Person 0 = form API, Person 1+ = copyPages + drawText ──
    const piPersons = data.piPersons || [];
    const PI_PAGE_IDX = 13; // P.14 (0-indexed)

    if (piPersons.length > 0) {
      // Attach company name to each piPerson
      const companyName = (data.fields as any)?.['fill_1_P.1'] || '';
      for (const p of piPersons) {
        (p as any).companyName = companyName;
      }

      // 1) Person 0: Fill the ORIGINAL P.14 via form API (real AP)
      fillPiFormAPI(form, piPersons[0], fonts);

      // 2) Person 1+: Copy blank P.14 pages, then drawText overlay
      if (piPersons.length > 1) {
        for (let i = 1; i < piPersons.length; i++) {
          const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [PI_PAGE_IDX]);
          pdfDoc.insertPage(PI_PAGE_IDX + i, copiedPage);
        }

        // Adjust removePages indices for inserted PI-NNC1 pages
        if (data.removePages) {
          const shift = piPersons.length - 1;
          data.removePages = data.removePages.map((p: number) => p + shift);
        }

        // Fill each copied page
        for (let i = 1; i < piPersons.length; i++) {
          fillPiDrawText(pdfDoc, PI_PAGE_IDX + i, piPersons[i], fonts);
        }
      }

      // 3) P.8 續頁計數器 — fill_4 = 續頁D (PI-NNC1 continuation count)
      const piContPages = piPersons.length - 1;
      if (piContPages > 0) {
        try {
          form.getTextField('fill_4_P.8').setText(String(piContPages));
        } catch { /* may not exist in all template versions */ }
      }
    }

    // ── Remove pages (0-indexed, descending order) ──
    const removePages = data.removePages || [];
    if (removePages.length > 0) {
      const sorted = [...removePages].sort((a, b) => b - a);
      for (const idx of sorted) {
        if (idx >= 0 && idx < pdfDoc.getPageCount()) {
          pdfDoc.removePage(idx);
        }
      }
    }

    // ── Save ──
    // enableNeedAppearances as safety net for any fields without AP.
    // updateFieldAppearances:false — Person 0 has real AP from updateAppearances(),
    //   non-P.14 fields have AP from setText(), Person 1+ uses drawText (page stream).
    enableNeedAppearances(pdfDoc);
    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc1-pdf error:", err?.message || err);
    return jsonResp({ error: err?.message || String(err) || "Internal server error" }, 500);
  }
}
