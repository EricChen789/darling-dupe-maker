const { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString, PDFArray, PDFNumber } = require('pdf-lib');
const fs = require('fs');

// ═══ v9: Generate AP streams using page's internal font names, no Resources dict ═══
// Page fonts: C2_1=PMingLiU(Type0), Helv=Helvetica(Type1)
// AP inherits page Resources → font resolution via internal names

function decodePdfText(value) {
  if (!value) return "";
  try {
    if (typeof value.decodeText === "function") return value.decodeText();
  } catch (_) { /* ignore */ }
  return String(value).replace(/^\((.*)\)$/s, "$1");
}

function detachWidget(widget, field) {
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
      widget.set(PDFName.of("T"), PDFString.of(`${parentName}.${widgetName}`));
    widget.delete(PDFName.of("Parent"));
  } catch (_) { /* best-effort */ }
}

function rebuildAcroFormFields(pdfDoc) {
  try {
    const { PDFBool, PDFArray } = require('pdf-lib');
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    if (!acroForm || typeof acroForm.set !== "function") return;
    const fields = PDFArray.withContext(pdfDoc.context);
    for (const page of pdfDoc.getPages()) {
      const annots = page.node.lookup(PDFName.of("Annots"));
      if (!annots || typeof annots.size !== "function") continue;
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        const widget = pdfDoc.context.lookup(ref);
        if (!widget || typeof widget.get !== "function") continue;
        if (String(widget.get(PDFName.of("Subtype"))) !== "/Widget") continue;
        if (!widget.get(PDFName.of("FT"))) continue;
        fields.push(ref);
      }
    }
    acroForm.set(PDFName.of("Fields"), fields);
    acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
  } catch (e) {
    console.warn("Could not rebuild AcroForm fields:", e);
  }
}

/** v9: Generate AP stream using page's internal font name. No Resources dict. */
function setWidgetApV9(pdfDoc, widget, value, isCjk) {
  const ctx = pdfDoc.context;
  // Use page's internal font names
  // C2_1 = PMingLiU (Type0, Identity-H) — CJK
  // Helv = Helvetica (Type1) — ASCII (added by pdf-lib embedFont)
  const fontName = isCjk ? "C2_1" : "Helv";
  const fontSize = 10;

  let textOp;
  if (isCjk) {
    // UTF-16BE hex string with BOM
    let hex = 'FEFF';
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      hex += (code >> 8).toString(16).padStart(2, '0').toUpperCase();
      hex += (code & 0xFF).toString(16).padStart(2, '0').toUpperCase();
    }
    textOp = `<${hex}> Tj`;
  } else {
    const escaped = value.replace(/([()\\])/g, '\\$1');
    textOp = `(${escaped}) Tj`;
  }

  const apContent = `/${fontName} ${fontSize} Tf\n0 g\nBT\n2 2 Td\n${textOp}\nET`;
  const apBytes = Buffer.from(apContent, 'utf-8');

  // Build Form XObject dict (NO Resources — inherit from page)
  const bbox = PDFArray.withContext(ctx);
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(1000));
  bbox.push(PDFNumber.of(1000));

  const dict = ctx.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  dict.set(PDFName.of('BBox'), bbox);

  // Create stream + register
  const apStream = ctx.stream(apBytes, dict);
  const apRef = ctx.register(apStream);

  // Create AP dict
  const apDict = ctx.obj({});
  apDict.set(PDFName.of('N'), apRef);

  // Set on widget (replaces old AP)
  widget.set(PDFName.of('AP'), apDict);

  // Set /V
  if (isCjk) {
    widget.set(PDFName.of('V'), PDFHexString.fromText(value));
  } else {
    widget.set(PDFName.of('V'), PDFString.of(value));
  }

  // Set /DA (fallback)
  widget.set(PDFName.of('DA'), PDFString.of(`/${fontName} ${fontSize} Tf 0 g`));
}

/** v9: Set checkbox AP — preserve checkbox appearance from template */
function setCheckboxApV9(pdfDoc, widget, onState, shouldCheck) {
  const ctx = pdfDoc.context;

  widget.set(PDFName.of("V"), PDFName.of("Off"));
  widget.set(PDFName.of("AS"), PDFName.of("Off"));

  if (!shouldCheck) return;

  // Discover onState from existing AP
  try {
    const ap = widget.get(PDFName.of("AP"));
    const apN = ap?.get?.(PDFName.of("N"));
    if (apN && typeof apN.entries === "function") {
      for (const [k] of apN.entries()) {
        const kStr = String(k);
        if (kStr !== "/Off") {
          onState = kStr.startsWith("/") ? kStr.slice(1) : kStr;
          break;
        }
      }
    }
  } catch { /* use provided onState */ }

  widget.set(PDFName.of("V"), PDFName.of(onState));
  widget.set(PDFName.of("AS"), PDFName.of(onState));
  // Checkbox AP is preserved — the existing AP has the checkmark graphic
}

const PI_FIELDS = [
  { suffix: 'fill_2',  key: 'nameChinese',     isCjk: true  },
  { suffix: 'fill_3',  key: 'surname',         isCjk: false },
  { suffix: 'fill_4',  key: 'otherNames',      isCjk: false },
  { suffix: 'fill_5',  key: 'hkidMain',        isCjk: false },
  { suffix: 'fill_6',  key: 'hkidCheck',       isCjk: false },
  { suffix: 'fill_7',  key: 'passportCountry', isCjk: true  },
  { suffix: 'fill_8',  key: 'passportNumber',  isCjk: false },
  { suffix: 'fill_9',  key: 'addrFlat',        isCjk: true  },
  { suffix: 'fill_10', key: 'addrBuilding',    isCjk: true  },
  { suffix: 'fill_11', key: 'addrStreet',      isCjk: true  },
  { suffix: 'fill_12', key: 'addrDistrict',    isCjk: true  },
  { suffix: 'fill_13', key: 'addrRegion',      isCjk: true  },
];

async function main() {
    const templateBytes = fs.readFileSync('public/templates/NNC1-template.pdf');
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const ctx = pdfDoc.context;

    // Embed Helvetica (adds /Helv to page Resources)
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const brNumber = "12345678";
    for (const page of pdfDoc.getPages()) {
        page.drawText(brNumber, { x: 500, y: 820, size: 8, font: helv });
    }

    // Fill P.6 director
    form.getTextField('fill_1_P.6').setText('李小華');
    form.getTextField('fill_2_P.6').setText('LEE');
    form.getTextField('fill_3_P.6').setText('Siu Wa');
    form.getCheckBox('cb_1_P.6').check();

    // Fill P.12 director
    form.getTextField('fill_1_P.12').setText('張三豐');
    form.getTextField('fill_2_P.12').setText('CHEUNG');
    form.getTextField('fill_3_P.12').setText('Sam Fung');
    form.getCheckBox('cb_1_P.12').check();

    // Fill P.8 counters
    form.getTextField('fill_3_P.8').setText('1');
    form.getTextField('fill_6_P.8').setText('2');

    // ═══ PI-NNC1: v9 — manual AP generation with internal font names ═══
    const piPersons = [
        { nameChinese: '陳大文', surname: 'CHAN', otherNames: 'Tai Man',
          hkidMain: 'A1234567', hkidCheck: '8', isHkid: true,
          passportCountry: '', passportNumber: '',
          addrFlat: 'Room 101', addrBuilding: 'ABC Bldg',
          addrStreet: '1 Main St', addrDistrict: 'Central', addrRegion: 'HK',
          isSecretary: true },
        { nameChinese: '李小華', surname: 'LEE', otherNames: 'Siu Wa',
          hkidMain: 'B9876543', hkidCheck: '2', isHkid: true,
          passportCountry: '', passportNumber: '',
          addrFlat: 'Flat 2A', addrBuilding: 'XYZ Bldg',
          addrStreet: '2 Queen Rd', addrDistrict: 'Central', addrRegion: 'HK',
          isSecretary: false },
    ];

    const PI_PAGE_IDX = 13;
    const FIT_SIZE = 10;
    const companyName = 'TEST HK LIMITED';

    // Cross-document copyPages for independent widget objects
    if (piPersons.length > 1) {
        const freshBytes = new Uint8Array(templateBytes);
        const freshDoc = await PDFDocument.load(freshBytes, { ignoreEncryption: true });
        for (let i = 1; i < piPersons.length; i++) {
            const [copiedPage] = await pdfDoc.copyPages(freshDoc, [PI_PAGE_IDX]);
            pdfDoc.insertPage(PI_PAGE_IDX + i, copiedPage);
        }
    }
    console.log('Pages after PI copy:', pdfDoc.getPageCount());

    // Fill each PI-NNC1 page with v9 AP generation
    for (let pi = 0; pi < piPersons.length; pi++) {
        const pageIdx = PI_PAGE_IDX + pi;
        const person = piPersons[pi];
        const pages = pdfDoc.getPages();
        const page = pages[pageIdx];
        if (!page) continue;

        const annots = page.node.lookup(PDFName.of("Annots"));
        if (!annots || typeof annots.size !== "function") continue;
        console.log(`PI person ${pi} (page ${pageIdx}): ${annots.size()} annots`);

        for (let j = 0; j < annots.size(); j++) {
            try {
                const widget = ctx.lookup(annots.get(j));
                if (!widget || typeof widget.get !== "function") continue;
                const subtype = widget.get(PDFName.of("Subtype"));
                if (!subtype || String(subtype) !== "/Widget") continue;

                const ft = widget.get(PDFName.of("FT"));
                const fieldType = ft ? String(ft) : '';

                let parentName = "";
                const parentRef = widget.get(PDFName.of("Parent"));
                let parentObj = null;
                if (parentRef) {
                    try { parentObj = ctx.lookup(parentRef); } catch(e) {}
                    if (parentObj) {
                        try {
                            const pT = parentObj.get(PDFName.of("T"));
                            if (pT instanceof PDFString) parentName = pT.decodeText();
                        } catch(e) {}
                    }
                }
                if (!parentName) continue;

                const suffix = parentName.replace(/_P$/, "");

                // Detach widget
                detachWidget(widget, parentObj);

                if (fieldType === '/Tx') {
                    if (suffix === "fill_1") {
                        setWidgetApV9(pdfDoc, widget, companyName, true);
                        if (pi === 0) console.log('  Set fill_1 = "' + companyName + '"');
                    } else {
                        const mapping = PI_FIELDS.find(f => f.suffix === suffix);
                        if (!mapping) continue;
                        if ((suffix === 'fill_5' || suffix === 'fill_6') && !person.isHkid) continue;
                        if ((suffix === 'fill_7' || suffix === 'fill_8') && person.isHkid) continue;
                        const val = String(person[mapping.key] || "").trim();
                        if (!val) continue;

                        setWidgetApV9(pdfDoc, widget, val, mapping.isCjk);
                        if (pi === 0) console.log('  Set ' + suffix + ' = "' + val + '"');
                    }
                } else if (fieldType === '/Btn') {
                    if (suffix === "cb_1") {
                        setCheckboxApV9(pdfDoc, widget, "On", person.isSecretary);
                        if (pi === 0) console.log('  cb_1 (sec) = ' + person.isSecretary);
                    } else if (suffix === "cb_2") {
                        setCheckboxApV9(pdfDoc, widget, "On", !person.isSecretary);
                        if (pi === 0) console.log('  cb_2 (dir) = ' + !person.isSecretary);
                    }
                }
            } catch(e) { console.log('  widget error:', e.message); }
        }
    }

    // Rebuild AcroForm
    console.log('Rebuilding AcroForm Fields...');
    rebuildAcroFormFields(pdfDoc);

    // Remove unused pages
    const shift = piPersons.length - 1;
    const pagesToRemove = [];
    for (let p = 14; p <= 23; p++) pagesToRemove.push(p > PI_PAGE_IDX ? p + shift : p);
    pagesToRemove.push(10); // 續頁C unused

    const sorted = [...pagesToRemove].sort((a, b) => b - a);
    for (const idx of sorted) {
        if (idx >= 0 && idx < pdfDoc.getPageCount()) {
            pdfDoc.removePage(idx);
        }
    }
    console.log('Pages after removal:', pdfDoc.getPageCount());

    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    fs.writeFileSync('_nnc1_v9_test.pdf', pdfBytes);
    console.log('Saved _nnc1_v9_test.pdf:', pdfBytes.length, 'bytes');
}
main().catch(e => { console.error(e); process.exit(1); });
