import { PDFDocument, PDFName, PDFHexString, PDFString, PDFBool, PDFArray } from "pdf-lib";

interface Env {
  PDF_TEMPLATES: R2Bucket;
}

// ── strategy (same as NAR1) ──
// The NR1 template has PMingLiU (Type0, UniCNS-UTF16-H) embedded.
// - CJK fields: set widget /DA to "/PMingLiU 12 Tf 0 g",
//               write /V with PDFHexString.fromText() (UTF-16BE+BOM)
// - ASCII fields: keep template /DA (/Helv), write /V with PDFString
// - Set AcroForm /NeedAppearances = true
//   → Adobe Reader / Chrome / Preview rebuild appearances with PMingLiU on open
// - Do NOT flatten — avoids embedding 10MB+ font while keeping CJK readable

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isAscii(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s);
}

const decodePdfText = (value: any): string => {
  if (!value) return "";
  try {
    if (typeof value.decodeText === "function") return value.decodeText();
  } catch (_) { /* ignore */ }
  return String(value).replace(/^\((.*)\)$/s, "$1");
};

// ── Form field collection ──

function collectFormFields(pdfDoc: PDFDocument): Map<string, { widget: any; field: any }> {
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
        const field = parentRef ? pdfDoc.context.lookup(parentRef) as any : widget;
        const parentName = field ? decodePdfText(field.get(PDFName.of("T"))) : "";
        const widgetName = decodePdfText(widget.get(PDFName.of("T")));
        const target = { widget, field };

        addAlias(parentName, target);
        addAlias(widgetName, target);
        if (parentName && widgetName) addAlias(`${parentName}.${widgetName}`, target);
        // Normalize: fill_4_P.9 ↔ fill_4_P9
        if (widgetName) {
          addAlias(widgetName.replace(/_P\.(\d+)$/g, "_P$1"), target);
          addAlias(widgetName.replace(/_P(\d+)$/g, "_P.$1"), target);
        }
        if (parentName) {
          addAlias(parentName.replace(/_P\.(\d+)$/g, "_P$1"), target);
          addAlias(parentName.replace(/_P(\d+)$/g, "_P.$1"), target);
        }
      } catch (_) { /* best-effort */ }
    }
  }
  return map;
}

// ── Widget detachment ──

function detachWidget(widget: any, field: any) {
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
    if (parentName && widgetName) widget.set(PDFName.of("T"), PDFString.of(`${parentName}.${widgetName}`));
    widget.delete(PDFName.of("Parent"));
  } catch (_) { /* best-effort */ }
}

function rebuildAcroFormFields(pdfDoc: PDFDocument) {
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
        const subtype = widget.get(PDFName.of("Subtype"));
        if (subtype && String(subtype) !== "/Widget") continue;
        fields.push(ref);
      }
    }
    acroForm.set(PDFName.of("Fields"), fields);
  } catch (_) { /* ignore */ }
}

// ── NeedAppearances ──

function enableNeedAppearances(pdfDoc: PDFDocument) {
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm")) as any;
    if (acroForm && typeof acroForm.set === "function") {
      acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
    }
  } catch (_) { /* ignore */ }
}

// ── DA builders ──

function buildCjkDA(originalDA: string | undefined): string {
  const m = originalDA?.match(/(\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? m[1] : "12";
  return `/PMingLiU ${size} Tf 0 g`;
}

function buildHelvDA(originalDA: string | undefined): string {
  const m = originalDA?.match(/(\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? m[1] : "12";
  return `/Helv ${size} Tf 0 g`;
}

// ── Form helpers ──

interface FormHelpers {
  form: any;
  setText: (fieldName: string, value: string) => boolean;
  check: (fieldName: string, shouldCheck: boolean) => boolean;
  selectDropdown: (fieldName: string, value: string) => boolean;
}

function createFormHelpers(pdfDoc: PDFDocument): FormHelpers {
  enableNeedAppearances(pdfDoc);
  let form: any = null;
  try { form = pdfDoc.getForm(); } catch (_) { /* low-level fallback */ }

  const fields = collectFormFields(pdfDoc);

  const setText = (fieldName: string, value: string): boolean => {
    const v = (value ?? "").toString();
    const target = fields.get(fieldName);
    if (!target) {
      console.warn(`⚠ Missing field: ${fieldName}`);
      return false;
    }
    try {
      detachWidget(target.widget, target.field);

      const da = decodePdfText(target.widget.get(PDFName.of("DA"))) ||
                 decodePdfText(target.field.get(PDFName.of("DA"))) ||
                 "/Helv 12 Tf 0 g";

      if (v.length > 0 && !isAscii(v)) {
        // CJK: use template's PMingLiU, /V as UTF-16BE hex string
        target.widget.set(PDFName.of("DA"), PDFString.of(buildCjkDA(da)));
        target.widget.set(PDFName.of("V"), PDFHexString.fromText(v));
      } else {
        // ASCII: keep Helv
        target.widget.set(PDFName.of("DA"), PDFString.of(buildHelvDA(da)));
        target.widget.set(PDFName.of("V"), PDFString.of(v));
      }
      // Remove old appearance — force reader to rebuild with NeedAppearances
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`⚠ setText failed for ${fieldName}:`, e);
      return false;
    }
  };

  const check = (fieldName: string, shouldCheck: boolean): boolean => {
    const target = fields.get(fieldName);
    if (!target) {
      console.warn(`⚠ Missing checkbox: ${fieldName}`);
      return false;
    }
    try {
      detachWidget(target.widget, target.field);
      const onState = target.field.get(PDFName.of("Opt")) || PDFName.of("Yes");
      target.widget.set(PDFName.of("V"), shouldCheck ? onState : PDFName.of("Off"));
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`⚠ check failed for ${fieldName}:`, e);
      return false;
    }
  };

  const selectDropdown = (fieldName: string, value: string): boolean => {
    const target = fields.get(fieldName);
    if (!target) {
      console.warn(`⚠ Missing dropdown: ${fieldName}`);
      return false;
    }
    try {
      detachWidget(target.widget, target.field);
      // Try to find matching option
      const opt = target.field.get(PDFName.of("Opt"));
      if (opt) {
        const opts: string[] = Array.isArray(opt) ? opt : [];
        const match = opts.find((o: string) => value.includes(o) || o.includes(value));
        if (match) {
          target.widget.set(PDFName.of("V"), PDFString.of(match));
          target.widget.delete(PDFName.of("AP"));
          return true;
        }
      }
      // Fallback: set value directly
      target.widget.set(PDFName.of("V"), PDFString.of(value));
      target.widget.delete(PDFName.of("AP"));
      return true;
    } catch (e) {
      console.warn(`⚠ selectDropdown failed for ${fieldName}:`, e);
      return false;
    }
  };

  return { form, setText, check, selectDropdown };
}

// ── NR1 Data ──

interface NR1Data {
  brNumber: string;
  companyName: string;
  // New address
  flat: string;
  building: string;
  street: string;
  district: string;
  region: string;
  addressEffectiveDay: string;
  addressEffectiveMonth: string;
  addressEffectiveYear: string;
  // Email
  email: string;
  emailEffectiveDay: string;
  emailEffectiveMonth: string;
  emailEffectiveYear: string;
  // Phone
  phone: string;
  phoneEffectiveDay: string;
  phoneEffectiveMonth: string;
  phoneEffectiveYear: string;
  // Signature
  signerName: string;
  signDateDay: string;
  signDateMonth: string;
  signDateYear: string;
  // Presentor
  presentorName: string;
  presentorAddress: string;
  presentorContact: string;
  // Debug mode
  debug?: boolean;
}

// ── Main handler ──

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const data: NR1Data = await request.json();
    console.log("Generating NR1 PDF for:", data.companyName);

    // Load template from R2
    const templateObj = await env.PDF_TEMPLATES.get("NR1-template.pdf");
    if (!templateObj) throw new Error("Failed to load NR1 template from R2");
    const templateBytes = await templateObj.arrayBuffer();

    const pdfDoc = await PDFDocument.load(templateBytes);
    const { setText, check, selectDropdown } = createFormHelpers(pdfDoc);

    if (data.debug) {
      // Debug: fill every field with its own name
      const fields = collectFormFields(pdfDoc);
      for (const [name, target] of fields) {
        // Skip aliases (normalised names, parent names) — only fill canonical names
        if (name.startsWith("fill_") || name.startsWith("cb_") || name.startsWith("Dropdown")) {
          try {
            if (name.startsWith("fill_")) {
              setText(name, name);
            } else if (name.startsWith("cb_")) {
              check(name, true);
            }
          } catch (_) { /* ignore */ }
        }
      }
    } else {
      // ── Fill NR1 fields ──

      // Company info
      setText("fill_1_P.1", data.brNumber);
      setText("fill_2_P.1", data.companyName);

      // 2(a) New address
      setText("fill_3_P.1", data.flat);
      setText("fill_4_P.1", data.building);
      setText("fill_5_P.1", data.street);
      setText("fill_6_P.1", data.district);
      // Address effective date
      setText("fill_7_P.1", data.addressEffectiveDay);
      setText("fill_8_P.1", data.addressEffectiveMonth);
      setText("fill_9_P.1", data.addressEffectiveYear);

      // 2(b) Email
      setText("fill_10_P.1", data.email);
      setText("fill_11_P.1", data.emailEffectiveDay);
      setText("fill_12_P.1", data.emailEffectiveMonth);
      setText("fill_13_P.1", data.emailEffectiveYear);

      // 2(c) Phone
      setText("fill_14_P.1", data.phone);
      setText("fill_15_P.1", data.phoneEffectiveDay);
      setText("fill_16_P.1", data.phoneEffectiveMonth);
      setText("fill_17_P.1", data.phoneEffectiveYear);

      // Signature
      setText("fill_18_P.1", data.signerName);
      setText("fill_19_P.1", `${data.signDateDay || ""}/${data.signDateMonth || ""}/${data.signDateYear || ""}`);

      // Presentor
      setText("fill_20_P.1", data.presentorName);
      setText("fill_21_P.1", data.presentorAddress);
      setText("fill_22_P.1", data.presentorContact);

      // Region dropdown
      if (data.region) {
        selectDropdown("Dropdown1_P.1", data.region);
      }
    }

    // Rebuild /Fields array and set NeedAppearances
    rebuildAcroFormFields(pdfDoc);
    enableNeedAppearances(pdfDoc);

    const pdfBytes = await pdfDoc.save();
    const base64 = uint8ToBase64(new Uint8Array(pdfBytes));

    return new Response(JSON.stringify({ pdf: base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("NR1 generation error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
