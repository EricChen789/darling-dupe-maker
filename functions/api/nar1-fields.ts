// generate-nar1-fields.ts — GET /api/nar1-fields
// Diagnostic endpoint: extract all AcroForm fields from PDF templates stored in R2.
// Ported from local Flask server.py (PyMuPDF) → Cloudflare pdf-lib equivalent.
// Auth: admin/moderator only.

import { PDFDocument } from "pdf-lib";
import { corsHeaders, jsonResp } from "./_pdf-utils";
import { verifyAuthRequest, requireAdmin, type Env } from "./_auth";

// ═══ Template registry ═══
// Keyed by form type; each entry lists R2 keys for the template parts.
const TEMPLATE_REGISTRY: Record<string, Record<string, string>> = {
  nar1: {
    main:      "NAR1_part1_pages1-8.pdf",
    schedule1: "NAR1_p9_v2.pdf",
    schedule2: "NAR1_p10_v2.pdf",
    sheetA:    "NAR1_p11_v2.pdf",
    sheetB:    "NAR1_p12_v2.pdf",
    sheetC:    "NAR1_p13_v2.pdf",
    sheetD:    "NAR1_p14_v2.pdf",
    sheetE:    "NAR1_p15_v2.pdf",
  },
  // Extend for other forms:
  // nd2a: { main: "ND2A-template.pdf" },
};

// ═══ Field type detection ═══
function detectFieldType(name: string, className: string): string {
  if (name.startsWith("cb_")) return "checkbox";
  if (name.startsWith("Dropdown")) return "dropdown";
  const t = className.toLowerCase();
  if (t.includes("checkbox")) return "checkbox";
  if (t.includes("dropdown") || t.includes("optionlist")) return "dropdown";
  if (t.includes("radio")) return "radio";
  return "text";
}

// ═══ Extract page number from widget annotations ═══
function mapFieldsToPages(doc: PDFDocument): Map<string, number> {
  const pageMap = new Map<string, number>();
  const pages = doc.getPages();
  const PDFName = (doc as any).context.constructor.PDFName || ((s: string) => ({ toString: () => `/${s}` }));

  for (let pi = 0; pi < pages.length; pi++) {
    try {
      const node = (pages[pi] as any).node;
      const annots = node?.lookup?.(PDFName("Annots"));
      if (!annots || typeof annots.size !== "function") continue;

      for (let i = 0; i < annots.size(); i++) {
        try {
          const w = (doc as any).context.lookup(annots.get(i));
          if (!w) continue;
          const subtype = w.get?.(PDFName("Subtype"));
          if (!subtype || String(subtype) !== "/Widget") continue;

          const parentRef = w.get?.(PDFName("Parent"));
          const field = parentRef ? (doc as any).context.lookup(parentRef) : w;
          const fieldName = String(field?.get?.(PDFName("T")) ?? w.get?.(PDFName("T")) ?? "");
          if (fieldName && !pageMap.has(fieldName)) {
            pageMap.set(fieldName, pi + 1);
          }
        } catch (_) { /* skip malformed widget */ }
      }
    } catch (_) { /* skip page without annots */ }
  }
  return pageMap;
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
    const url = new URL(request.url);
    const formType = url.searchParams.get("template") || "nar1";
    const templates = TEMPLATE_REGISTRY[formType];

    if (!templates) {
      return jsonResp({
        error: `Unknown template type: "${formType}"`,
        available: Object.keys(TEMPLATE_REGISTRY),
      }, 400);
    }

    const r2 = env.PDF_TEMPLATES;
    if (!r2) {
      return jsonResp({ error: "PDF_TEMPLATES R2 bucket binding not configured" }, 500);
    }

    const allFields: Array<{ name: string; type: string; part: string; page: number | null }> = [];
    const warnings: string[] = [];
    const partsLoaded: string[] = [];
    const partsFailed: string[] = [];
    let totalPages = 0;

    for (const [partKey, r2Key] of Object.entries(templates)) {
      try {
        const obj = await r2.get(r2Key);
        if (!obj) {
          warnings.push(`Part "${partKey}" (${r2Key}) not found in R2`);
          partsFailed.push(partKey);
          continue;
        }

        const bytes = await obj.arrayBuffer();
        if (bytes.byteLength === 0) {
          warnings.push(`Part "${partKey}" (${r2Key}) is empty`);
          partsFailed.push(partKey);
          continue;
        }

        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pageCount = doc.getPageCount();
        const pageMap = mapFieldsToPages(doc);
        const form = doc.getForm();
        const fields = form.getFields();

        if (fields.length === 0) {
          warnings.push(`Part "${partKey}" (${r2Key}, ${pageCount}p) has no form fields`);
        }

        for (const f of fields) {
          const name = f.getName();
          if (!name) continue;
          const page = pageMap.get(name) || null;

          allFields.push({
            name,
            type: detectFieldType(name, f.constructor.name),
            part: partKey,
            page,
          });
        }

        totalPages += pageCount;
        partsLoaded.push(partKey);
      } catch (e: any) {
        warnings.push(`Failed to load "${partKey}" (${r2Key}): ${e.message}`);
        partsFailed.push(partKey);
      }
    }

    // Sort by part then name
    allFields.sort((a, b) => a.part.localeCompare(b.part) || a.name.localeCompare(b.name));

    return jsonResp({
      formType,
      templateParts: Object.keys(templates),
      partsLoaded,
      partsFailed,
      totalPages,
      totalFields: allFields.length,
      fields: allFields,
      warnings: warnings.length > 0 ? warnings : undefined,
    });

  } catch (e: any) {
    console.error("nar1-fields error:", e);
    return jsonResp({ error: e.message || String(e) }, 500);
  }
}
