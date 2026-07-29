// generate-nar1-debug-pdf.ts — POST /api/nar1-debug-pdf
// Diagnostic endpoint: generate a PDF with every widget filled with its own field name.
// Useful for verifying field mapping and identifying missing/extra fields.
// Ported from local Flask server.py (PyMuPDF) → Cloudflare pdf-lib.
// Auth: admin/moderator only.

import { PDFDocument, PDFName, PDFString, PDFHexString } from "pdf-lib";
import { corsHeaders, jsonResp, uint8ToBase64 } from "./_pdf-utils";
import { verifyAuthRequest, requireAdmin, type Env } from "./_auth";
import { isAscii, decodePdfText } from "./_acroform";

// ═══ Template registry (same as nar1-fields) ═══
const TEMPLATE_KEYS: Record<string, string> = {
  main:      "NAR1_part1_pages1-8.pdf",
  schedule1: "NAR1_p9_v2.pdf",
  schedule2: "NAR1_p10_v2.pdf",
  sheetA:    "NAR1_p11_v2.pdf",
  sheetB:    "NAR1_p12_v2.pdf",
  sheetC:    "NAR1_p13_v2.pdf",
  sheetD:    "NAR1_p14_v2.pdf",
  sheetE:    "NAR1_p15_v2.pdf",
};

// ═══ Fill all fields in a single template part ═══
function fillAllFieldsWithNames(pdfDoc: PDFDocument): { filled: number; skipped: number } {
  const form = pdfDoc.getForm();
  const allFields = form.getFields();
  let filled = 0;
  let skipped = 0;

  for (const field of allFields) {
    const name = field.getName();
    if (!name) { skipped++; continue; }

    try {
      const fieldType = field.constructor.name;

      if (fieldType.includes("CheckBox")) {
        // Check all checkboxes
        try {
          // Try multiple common "on" state names
          const checkbox = field as any;
          // Check via the acroform directly: find "On" state, default to "Yes"
          const widgetRefs = checkbox.acroField?.widgets || [];
          for (const wRef of widgetRefs) {
            try {
              const w = (pdfDoc as any).context.lookup(wRef);
              if (!w) continue;
              // Try to check: /AS → "Yes" or first non-Off key from /AP/N
              let onState = "Yes";
              try {
                const ap = w.get(PDFName.of("AP")) as any;
                const apN = ap?.get?.(PDFName.of("N")) as any;
                if (apN?.dict && typeof apN.dict.keys === "function") {
                  for (const k of apN.dict.keys()) {
                    if (k !== "Off") { onState = k; break; }
                  }
                }
              } catch (_) { /* fallback to "Yes" */ }
              w.set(PDFName.of("AS"), PDFName.of(onState));
              w.delete(PDFName.of("AP"));
            } catch (_) { /* skip individual widget */ }
          }
        } catch (_) { /* skip */ }
        filled++;
      } else if (fieldType.includes("Dropdown") || fieldType.includes("OptionList")) {
        // Select first option
        try {
          const dropdown = field as any;
          const options = dropdown.getOptions?.() || [];
          if (options.length > 0) {
            dropdown.select?.(options[0]);
          }
        } catch (_) { /* skip */ }
        filled++;
      } else {
        // Text field: fill with field name
        try {
          const textField = field as any;
          const daRaw = textField.acroField?.getDefaultAppearance?.() || "";
          const da = typeof daRaw === "string" ? daRaw : decodePdfText(daRaw) || "/Helv 12 Tf 0 g";

          if (!isAscii(name)) {
            // CJK field name → use PDFHexString
            textField.acroField?.set(PDFName.of("DA"), PDFString.of(`/PMingLiU 10 Tf 0 g`));
            textField.acroField?.set(PDFName.of("V"), PDFHexString.fromText(name));
          } else {
            textField.acroField?.set(PDFName.of("DA"), PDFString.of(`/Helv 10 Tf 0 g`));
            textField.acroField?.set(PDFName.of("V"), PDFString.of(name));
          }
        } catch (_) { /* skip */ }
        filled++;
      }
    } catch (_) {
      skipped++;
    }
  }

  return { filled, skipped };
}

// ═══ Main handler ═══
export async function onRequest(context: { request: Request; env: Env & { PDF_TEMPLATES: R2Bucket } }) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Admin auth
  const { user, errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;
  const forbidden = requireAdmin(user);
  if (forbidden) return forbidden;

  try {
    const r2 = env.PDF_TEMPLATES;
    if (!r2) {
      return jsonResp({ error: "PDF_TEMPLATES R2 bucket binding not configured" }, 500);
    }

    const partsReport: Array<{ part: string; key: string; pages: number; filled: number; skipped: number; error?: string }> = [];
    const pdfDocs: Array<{ doc: PDFDocument; key: string }> = [];

    for (const [partKey, r2Key] of Object.entries(TEMPLATE_KEYS)) {
      try {
        const obj = await r2.get(r2Key);
        if (!obj) {
          partsReport.push({ part: partKey, key: r2Key, pages: 0, filled: 0, skipped: 0, error: "Not found in R2" });
          continue;
        }

        const bytes = await obj.arrayBuffer();
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const { filled, skipped } = fillAllFieldsWithNames(doc);

        partsReport.push({
          part: partKey,
          key: r2Key,
          pages: doc.getPageCount(),
          filled,
          skipped,
        });

        pdfDocs.push({ doc, key: partKey });
      } catch (e: any) {
        partsReport.push({ part: partKey, key: r2Key, pages: 0, filled: 0, skipped: 0, error: e.message });
      }
    }

    if (pdfDocs.length === 0) {
      return jsonResp({ error: "No template parts could be loaded", parts: partsReport }, 500);
    }

    // Combine all parts into one PDF
    const outDoc = await PDFDocument.create();
    for (const { doc } of pdfDocs) {
      const pages = await outDoc.copyPages(doc, doc.getPageIndices());
      for (const page of pages) outDoc.addPage(page);
    }

    // Save
    const pdfBytes = await outDoc.save({ useObjectStreams: true });
    const b64 = uint8ToBase64(pdfBytes);

    return jsonResp({
      pdf: b64,
      size: pdfBytes.byteLength,
      totalPages: partsReport.reduce((s, p) => s + p.pages, 0),
      totalFilled: partsReport.reduce((s, p) => s + p.filled, 0),
      totalSkipped: partsReport.reduce((s, p) => s + p.skipped, 0),
      parts: partsReport,
    });

  } catch (e: any) {
    console.error("nar1-debug-pdf error:", e);
    return jsonResp({ error: e.message || String(e) }, 500);
  }
}
