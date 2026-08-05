// POST /api/generate-nnc1-pdf
// NNC1 法團成立表格（股份有限公司）— 專用端點（Phase 2.2）
// 使用 R2 模板 + pdf-lib AcroForm 填充
// CPU优化: enableNeedAppearances + updateFieldAppearances:false（24页模板）
// 支援多自然人 → 自動複製 PI-NNC1 頁面（每頁一人）
//   策略：
//     Person 0 → createFormHelpers (detachWidget + /V + /DA + delete /AP)
//     Person 1+ → copyPages + 手動 detach 每個 widget + 設值
//     利用模板內建 /PMingLiU 字體渲染 CJK，不另外嵌入字體

import { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString, PDFBool, PDFArray } from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64 } from "./_pdf-utils";
import {
  enableNeedAppearances, isAscii, collectFormFields,
  detachWidget, rebuildAcroFormFields,
  buildCjkDA, buildHelvDA, decodePdfText
} from "./_acroform";
import { verifyAuthRequest, type Env } from "./_auth";

const TEMPLATE_NAME = "NNC1-template.pdf";

// PI-NNC1 field → person data key mapping (widget suffix → person key)
const PI_FIELD_MAP: Record<string, { key: string; isCjk: boolean }> = {
  'fill_2':  { key: 'nameChinese',      isCjk: true  },
  'fill_3':  { key: 'surname',          isCjk: false },
  'fill_4':  { key: 'otherNames',       isCjk: false },
  'fill_5':  { key: 'hkidMain',         isCjk: false },
  'fill_6':  { key: 'hkidCheck',        isCjk: false },
  'fill_7':  { key: 'passportCountry',  isCjk: true  },
  'fill_8':  { key: 'passportNumber',   isCjk: false },
  'fill_9':  { key: 'addrFlat',         isCjk: true  },
  'fill_10': { key: 'addrBuilding',     isCjk: true  },
  'fill_11': { key: 'addrStreet',       isCjk: true  },
  'fill_12': { key: 'addrDistrict',     isCjk: true  },
  'fill_13': { key: 'addrRegion',       isCjk: true  },
};

// Checkbox mapping: cb_1 = 秘書, cb_2 = 董事
const PI_CB_MAP: Record<string, string> = {
  'cb_1': 'isSecretary_true',   // cb_1 checked when isSecretary=true
  'cb_2': 'isSecretary_false',  // cb_2 checked when isSecretary=false
};

/** Fill ONE PI-NNC1 widget on a specific page (works on original or copied pages). */
function fillPiWidget(
  pdfDoc: PDFDocument,
  widget: any,
  field: any,
  suffix: string,
  piPerson: Record<string, any>
): boolean {
  const mapping = PI_FIELD_MAP[suffix];
  if (!mapping) return false; // not a data field (e.g. fill_1 = company name)

  const val = String(piPerson[mapping.key] ?? "").trim();
  if (!val) return false;

  try {
    detachWidget(widget, field);

    const da = decodePdfText(widget.get(PDFName.of("DA"))) ||
               decodePdfText(field.get(PDFName.of("DA"))) ||
               "/Helv 12 Tf 0 g";

    if (mapping.isCjk && !isAscii(val)) {
      widget.set(PDFName.of("DA"), PDFString.of(buildCjkDA(da)));
      widget.set(PDFName.of("V"), PDFHexString.fromText(val));
    } else {
      widget.set(PDFName.of("DA"), PDFString.of(buildHelvDA(da)));
      widget.set(PDFName.of("V"), PDFString.of(val));
    }
    widget.delete(PDFName.of("AP"));
    return true;
  } catch { return false; }
}

/** Fill PI-NNC1 checkbox on a specific page. */
function fillPiCheckbox(
  pdfDoc: PDFDocument,
  widget: any,
  field: any,
  suffix: string,
  piPerson: Record<string, any>
): boolean {
  const cond = PI_CB_MAP[suffix];
  if (!cond) return false;

  const [key, expected] = cond.split('_');
  const shouldCheck = String(piPerson[key]) === expected;

  if (!shouldCheck) return false;

  try {
    detachWidget(widget, field);

    // Discover the checkbox's "On" state name
    let onState = "Yes";
    try {
      const ap = widget.get(PDFName.of("AP")) as any;
      const apN = ap?.get?.(PDFName.of("N")) as any;
      const dict = apN?.dict;
      if (dict && typeof dict.keys === "function") {
        for (const k of dict.keys()) {
          if (k !== "Off") { onState = k; break; }
        }
      }
    } catch { /* fallback to "Yes" */ }

    widget.set(PDFName.of("AS"), PDFName.of(onState));
    widget.delete(PDFName.of("AP"));
    return true;
  } catch { return false; }
}

/** Fill all PI-NNC1 widgets on a given page with person data. */
function fillPiPage(
  pdfDoc: PDFDocument,
  pageIndex: number,
  piPerson: Record<string, any>
): void {
  const pages = pdfDoc.getPages();
  const page = pages[pageIndex];
  const annots = page.node.lookup(PDFName.of("Annots")) as any;
  if (!annots || typeof annots.size !== "function") return;

  const fill_1_val = String(piPerson['companyName'] ?? "").trim();

  for (let i = 0; i < annots.size(); i++) {
    try {
      const widget = pdfDoc.context.lookup(annots.get(i)) as any;
      if (!widget || typeof widget.get !== "function") continue;
      const subtype = widget.get(PDFName.of("Subtype"));
      if (!subtype || String(subtype) !== "/Widget") continue;

      const parentRef = widget.get(PDFName.of("Parent"));
      const field = parentRef
        ? (pdfDoc.context.lookup(parentRef) as any)
        : widget;
      const fieldName = decodePdfText(field.get(PDFName.of("T")));
      const widgetName = decodePdfText(widget.get(PDFName.of("T")));
      const name = widgetName || fieldName || "";
      if (!name) continue;

      // Extract suffix: "fill_2_P.14" → "fill_2"
      const suffix = name.replace(/_P\.\d+$/, "").replace(/_P\d+$/, "");

      const ft = field.get(PDFName.of("FT"));
      const fieldType = ft ? String(ft) : "";

      if (fieldType === "/Btn") {
        // Checkbox
        fillPiCheckbox(pdfDoc, widget, field, suffix, piPerson);
      } else if (fieldType === "/Tx") {
        // Text field: fill_1 = company name, fill_2+ = person data
        if (suffix === 'fill_1') {
          // Company name — fill via form API for P.14, but for copied pages do it here
          if (fill_1_val) {
            try {
              detachWidget(widget, field);
              widget.set(PDFName.of("DA"), PDFString.of(buildHelvDA(
                decodePdfText(widget.get(PDFName.of("DA"))) || ""
              )));
              widget.set(PDFName.of("V"), PDFHexString.fromText(fill_1_val));
              widget.delete(PDFName.of("AP"));
            } catch { /* skip */ }
          }
        } else {
          fillPiWidget(pdfDoc, widget, field, suffix, piPerson);
        }
      }
    } catch { /* skip malformed widget */ }
  }
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

    // ── Fill text fields (skip P.14 — handled below via fillPiPage) ──
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
      const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
      for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
      }
    }

    // ── PI-NNC1: Fill Person 0 on P.14, then copy & fill for Person 1+ ──
    const piPersons = data.piPersons || [];
    const PI_PAGE_IDX = 13; // P.14 (0-indexed)

    if (piPersons.length > 0) {
      // Attach company name to each piPerson for fill_1
      const companyName = (data.fields as any)?.['fill_1_P.1'] || '';
      for (const p of piPersons) {
        (p as any).companyName = companyName;
      }

      // 1) Copy extra pages FIRST
      for (let i = 1; i < piPersons.length; i++) {
        const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [PI_PAGE_IDX]);
        pdfDoc.insertPage(PI_PAGE_IDX + i, copiedPage);
      }

      // 2) Adjust removePages for extra PI-NNC1 pages
      if (data.removePages && piPersons.length > 1) {
        const shift = piPersons.length - 1;
        data.removePages = data.removePages.map((p: number) => p + shift);
      }

      // 3) Fill ALL PI-NNC1 pages (Person 0 on original, Person 1+ on copies)
      for (let p = 0; p < piPersons.length; p++) {
        fillPiPage(pdfDoc, PI_PAGE_IDX + p, piPersons[p] as any);
      }

      // 4) Rebuild AcroForm /Fields from actual page widget refs
      //    This is essential after detaching widgets so the reader sees all fields.
      rebuildAcroFormFields(pdfDoc);

      // 5) P.8 續頁計數器 — PI-NNC1 continuation count in fill_4 (續頁D)
      const piContPages = piPersons.length - 1; // number of extra PI-NNC1 pages
      if (piContPages > 0) {
        try {
          const tf = form.getTextField('fill_4_P.8');
          tf.setText(String(piContPages));
        } catch { /* P.8 counter field may not exist in all template versions */ }
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
    // NeedAppearances is already set by rebuildAcroFormFields above.
    // updateFieldAppearances:false because widgets were individually set with /V + /DA.
    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return jsonResp({ pdf: uint8ToBase64(new Uint8Array(pdfBytes)) });
  } catch (err: any) {
    console.error("generate-nnc1-pdf error:", err?.message || err);
    return jsonResp({ error: err?.message || String(err) || "Internal server error" }, 500);
  }
}
