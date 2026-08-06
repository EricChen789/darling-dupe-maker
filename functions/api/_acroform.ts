// _acroform.ts — Shared low-level AcroForm utilities for pdf-lib
//
// Used by generate-nar1-pdf.ts, generate-nd2a-pdf.ts, generate-nr1-pdf.ts
// These HK CR form templates have widgets on multiple pages sharing a single
// parent field object. pdf-lib's standard Form API cannot handle this pattern,
// so we manipulate the PDF objects directly.
//
// Usage:
//   import { createFormHelpers } from "./_acroform";
//   const { setText, check, selectDropdown } = createFormHelpers(pdfDoc);

import { PDFDocument, PDFName, PDFString, PDFHexString, PDFBool, PDFArray } from "pdf-lib";

// ═══ String utilities ═══

export function isAscii(s: string): boolean {
  return /^[\x00-\x7F]*$/.test(s);
}

export function decodePdfText(value: any): string {
  if (!value) return "";
  try {
    if (typeof value.decodeText === "function") return value.decodeText();
  } catch (_) { /* ignore */ }
  return String(value).replace(/^\((.*)\)$/s, "$1");
}

// ═══ Form Field Collection ═══
// Collect all widget annotations across all pages and build a lookup map
// with multiple alias forms (normalized naming).

export function collectFormFields(
  pdfDoc: PDFDocument
): Map<string, { widget: any; field: any }> {
  const map = new Map<string, { widget: any; field: any }>();
  const addAlias = (name: string, target: { widget: any; field: any }) => {
    if (name && !map.has(name)) map.set(name, target);
  };

  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots")) as any;
    if (!annots || typeof annots.size !== "function") continue;

    for (let i = 0; i < annots.size(); i++) {
      try {
        const widget = pdfDoc.context.lookup(annots.get(i)) as any;
        if (!widget || typeof widget.get !== "function") continue;
        const subtype = widget.get(PDFName.of("Subtype"));
        if (subtype && String(subtype) !== "/Widget") continue;

        const parentRef = widget.get(PDFName.of("Parent"));
        const field = parentRef
          ? (pdfDoc.context.lookup(parentRef) as any)
          : widget;
        const parentName = field
          ? decodePdfText(field.get(PDFName.of("T")))
          : "";
        const widgetName = decodePdfText(widget.get(PDFName.of("T")));
        const target = { widget, field };

        // ── Handle 3-level field hierarchy (NN1 P.10) ──
        // NN1 template P.10 has: grandparent/T=fill_15_P → parent/T=10 → widget
        // Without this, all P.10 fields register as "10" and overwrite each other.
        let resolvedName = parentName;
        let resolvedSuffix = widgetName;
        const grandParentRef = field?.get?.(PDFName.of("Parent"));
        if (grandParentRef) {
          try {
            const grandParent = pdfDoc.context.lookup(grandParentRef) as any;
            const gpName = decodePdfText(grandParent.get(PDFName.of("T")));
            if (gpName) {
              resolvedName = gpName;           // e.g. "fill_15_P"
              resolvedSuffix = resolvedSuffix || parentName; // fallback to parent name as suffix e.g. "10"
            }
          } catch { /* skip */ }
        }

        addAlias(resolvedName, target);
        addAlias(widgetName, target);
        if (resolvedName && resolvedSuffix)
          addAlias(`${resolvedName}.${resolvedSuffix}`, target);

        // Normalize: fill_4_P.9 <-> fill_4_P9
        if (resolvedSuffix) {
          addAlias(resolvedSuffix.replace(/_P\.(\d+)$/g, "_P$1"), target);
          addAlias(resolvedSuffix.replace(/_P(\d+)$/g, "_P.$1"), target);
        }
        if (resolvedName) {
          addAlias(resolvedName.replace(/_P\.(\d+)$/g, "_P$1"), target);
          addAlias(resolvedName.replace(/_P(\d+)$/g, "_P.$1"), target);
        }
      } catch (_) {
        /* skip malformed widget */
      }
    }
  }
  return map;
}

// ═══ Widget Detachment ═══
// Detach a widget from its shared parent field by copying inherited keys.
// This prevents /V writes on one page from overwriting another page's value.

export function detachWidget(widget: any, field: any) {
  if (widget === field) return;
  try {
    const parentName = decodePdfText(field.get(PDFName.of("T")));
    const widgetName = decodePdfText(widget.get(PDFName.of("T")));
    const inheritKeys = ["FT", "DA", "Ff", "MaxLen", "Q", "DV"];
    for (const k of inheritKeys) {
      const key = PDFName.of(k);
      if (!widget.get(key)) {
        const v = field.get(key);
        if (v !== undefined && v !== null) widget.set(key, v);
      }
    }
    if (parentName && widgetName)
      widget.set(
        PDFName.of("T"),
        PDFString.of(`${parentName}.${widgetName}`)
      );
    widget.delete(PDFName.of("Parent"));
  } catch (_) {
    /* best-effort */
  }
}

// ═══ AcroForm Rebuild ═══
// PDF readers only render fields listed in /AcroForm/Fields.
// After detaching widgets, rebuild /Fields with the actual page widget refs.

export function rebuildAcroFormFields(pdfDoc: PDFDocument) {
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm")) as any;
    if (!acroForm || typeof acroForm.set !== "function") return;
    const fields = PDFArray.withContext(pdfDoc.context);
    for (const page of pdfDoc.getPages()) {
      const annots = page.node.lookup(PDFName.of("Annots")) as any;
      if (!annots || typeof annots.size !== "function") continue;
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        const widget = pdfDoc.context.lookup(ref) as any;
        if (!widget || typeof widget.get !== "function") continue;
        if (String(widget.get(PDFName.of("Subtype"))) !== "/Widget") continue;
        if (!widget.get(PDFName.of("FT"))) continue;
        fields.push(ref);
      }
    }
    acroForm.set(PDFName.of("Fields"), fields);
    acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
  } catch (e) {
    console.warn("⚠ Could not rebuild AcroForm fields:", e);
  }
}

// ═══ NeedAppearances ═══
// Set /AcroForm /NeedAppearances = true so readers auto-generate widget AP.

export function enableNeedAppearances(pdfDoc: PDFDocument) {
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm")) as any;
    if (acroForm && typeof acroForm.set === "function") {
      acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
    }
  } catch (_) {
    /* ignore */
  }
}

// ═══ Font DA Builders ═══
// Build /DA (Default Appearance) strings for CJK (PMingLiU) and ASCII (Helv).

export function buildCjkDA(originalDA: string | undefined): string {
  const m = originalDA?.match(/(\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? m[1] : "12";
  return `/PMingLiU ${size} Tf 0 g`;
}

export function buildHelvDA(originalDA: string | undefined): string {
  const m = originalDA?.match(/(\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? m[1] : "12";
  return `/Helv ${size} Tf 0 g`;
}

/** Build /DA with a forced font size (useful for shrinking oversized fields). */
export function buildHelvDAWithSize(originalDA: string | undefined, forcedSize: number): string {
  return `/Helv ${forcedSize} Tf 0 g`;
}

// ═══ Adobe-safe text ═══
// Strip non-ASCII characters for fields that may break in Adobe Reader.

export function toAdobeSafeText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && isAscii(line))
    .join("\n");
}

// ═══ Form Helpers Factory ═══
// Creates setText / check / selectDropdown helpers bound to a PDF document.

export interface AcroFieldEntry {
  widget: any;
  field: any;
}

export interface FormHelpers {
  fields: Map<string, AcroFieldEntry>;
  setText: (
    fieldName: string,
    value: string,
    alignOrFontSize?: "left" | "center" | "right" | number,
    align?: "left" | "center" | "right"
  ) => boolean;
  check: (fieldName: string, shouldCheck: boolean) => boolean;
  selectDropdown: (fieldName: string, targetValue: string) => boolean;
}

export function createFormHelpers(pdfDoc: PDFDocument): FormHelpers {
  enableNeedAppearances(pdfDoc);

  const fields = collectFormFields(pdfDoc);

  const setText = (
    fieldName: string,
    value: string,
    alignOrFontSize?: "left" | "center" | "right" | number,
    align?: "left" | "center" | "right"
  ): boolean => {
    // Resolve fontSize override vs align from the 3rd arg
    let fontSizeOverride: number | undefined;
    let resolvedAlign: "left" | "center" | "right" | undefined;
    if (typeof alignOrFontSize === 'number') {
      fontSizeOverride = alignOrFontSize;
      resolvedAlign = align;
    } else {
      resolvedAlign = alignOrFontSize;
    }
    const v = (value ?? "").toString();
    const target = fields.get(fieldName);
    if (!target) {
      console.warn(`⚠ Missing field: ${fieldName}`);
      return false;
    }
    try {
      detachWidget(target.widget, target.field);

      const da =
        decodePdfText(target.widget.get(PDFName.of("DA"))) ||
        decodePdfText(target.field.get(PDFName.of("DA"))) ||
        "/Helv 12 Tf 0 g";

      if (v.length > 0 && !isAscii(v)) {
        // CJK: use template-embedded /PMingLiU (Type0, UniCNS-UTF16-H)
        // /V must be UTF-16BE hex string
        const daStr = fontSizeOverride
          ? `/PMingLiU ${fontSizeOverride} Tf 0 g`
          : buildCjkDA(da);
        target.widget.set(PDFName.of("DA"), PDFString.of(daStr));
        target.widget.set(PDFName.of("V"), PDFHexString.fromText(v));
      } else {
        // ASCII: keep Helv
        const daStr = fontSizeOverride
          ? `/Helv ${fontSizeOverride} Tf 0 g`
          : buildHelvDA(da);
        target.widget.set(PDFName.of("DA"), PDFString.of(daStr));
        target.widget.set(PDFName.of("V"), PDFString.of(v));
      }

      // Alignment via /Q (0=left, 1=center, 2=right)
      if (resolvedAlign === "right") {
        target.widget.set(PDFName.of("Q"), pdfDoc.context.obj(2));
      } else if (resolvedAlign === "center") {
        target.widget.set(PDFName.of("Q"), pdfDoc.context.obj(1));
      }

      // Remove old appearance, force reader to rebuild via NeedAppearances
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`⚠ setText failed for ${fieldName}:`, e);
      return false;
    }
  };

  const check = (fieldName: string, shouldCheck: boolean): boolean => {
    if (!shouldCheck) return false;
    const target = fields.get(fieldName);
    if (!target) return false;
    try {
      detachWidget(target.widget, target.field);

      // Discover the checkbox's "On" state name.
      // 1) Try /AP/N dict (NAR1, ND2A templates use /Yes, /On, /1)
      // 2) Fallback to /Opt (NR1 template)
      let onState = "Yes";
      try {
        const ap = target.widget.get(PDFName.of("AP")) as any;
        const apN = ap?.get?.(PDFName.of("N")) as any;
        const dict = apN?.dict;
        if (dict && typeof dict.keys === "function") {
          for (const k of dict.keys()) {
            if (k !== "Off") { onState = k; break; }
          }
        } else {
          const opt = target.field.get(PDFName.of("Opt"));
          if (opt) onState = String(opt).replace(/^\((.*)\)$/, "$1");
        }
      } catch (_) {
        try {
          const opt = target.field.get(PDFName.of("Opt"));
          if (opt) onState = String(opt).replace(/^\((.*)\)$/, "$1");
        } catch (_2) { /* fallback to "Yes" */ }
      }

      target.widget.set(PDFName.of("AS"), PDFName.of(onState));
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`⚠ check failed for ${fieldName}:`, e);
      return false;
    }
  };

  const selectDropdown = (
    fieldName: string,
    targetValue: string
  ): boolean => {
    const target = fields.get(fieldName);
    if (!target) return false;
    try {
      detachWidget(target.widget, target.field);

      // Try to find matching option from /Opt array
      const opt = target.field.get(PDFName.of("Opt"));
      if (opt) {
        const opts: string[] = Array.isArray(opt)
          ? opt.map((o: any) => decodePdfText(o))
          : [];
        const match = opts.find(
          (o: string) =>
            targetValue.includes(o) ||
            o.includes(targetValue) ||
            o.toLowerCase() === targetValue.toLowerCase()
        );
        if (match) {
          target.widget.set(PDFName.of("V"), PDFString.of(match));
          target.widget.delete(PDFName.of("AP"));
          return true;
        }
      }

      // Fallback: set value directly
      target.widget.set(
        PDFName.of("V"),
        PDFString.of(targetValue)
      );
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`⚠ selectDropdown failed for ${fieldName}:`, e);
      return false;
    }
  };

  return { fields, setText, check, selectDropdown };
}

// ═══ HK-specific helpers ═══

/** Parse HKID to first 4 chars (as used in CR form fields) */
export function parseHkidPartial(idNumber: string): string {
  if (!idNumber) return "";
  return idNumber.replace(/[()\-\s]/g, "").toUpperCase().slice(0, 4);
}

/** Parse passport number to first half */
export function parsePassportPartial(passportNumber: string): string {
  if (!passportNumber) return "";
  const cleaned = passportNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return cleaned.slice(0, Math.ceil(cleaned.length / 2));
}

/** Split address like Flask: comma OR space before known HK address prefix */
export const ADDR_SPLIT_RE =
  /,\s*|\s+(?=(?:rm|room|flat|unit|suite|shop|floor|flr|fl|block|blk|blc|tower|twr)\b)/i;

export function splitAddress(raw: string): string[] {
  return raw.split(ADDR_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
}

/** Address flat detection regex */
export const ADDR_FLAT_RE =
  /^(rm|room|flat|unit|suite|shop|floor|flr|fl|block|blk|blc|tower|twr|level|lvl)\b/i;

export interface ParsedAddress {
  flat: string;
  building: string;
  street: string;
  district: string;
  country: string;
}

export function parseAddressFields(raw: string): ParsedAddress {
  if (!raw) return { flat: "", building: "", street: "", district: "", country: "" };
  const parts = raw.split(/\s?,\s?/).filter(Boolean);
  const flatParts: string[] = [];
  while (parts.length > 1 && ADDR_FLAT_RE.test(parts[0]))
    flatParts.push(parts.shift()!);
  const flat = flatParts.join(", ");
  const building = parts.shift() || "";
  const street = parts.join(", ");
  return { flat, building, street, district: "", country: "" };
}
