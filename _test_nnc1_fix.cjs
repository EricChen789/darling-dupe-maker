const { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString } = require('pdf-lib');
const fs = require('fs');

// ═══ Replicate the cloud generate-nnc1-pdf.ts logic (v8 — detach+NeedAppearances) ═══

// ── Shared utilities from _acroform.ts ──

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

// ── PI-NNC1 field definitions ──
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
    const context = pdfDoc.context;

    // BR stamp
    const helvFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    for (const page of pdfDoc.getPages()) {
        page.drawText('BR12345678', { x: 500, y: 820, size: 8, font: helvFont });
    }

    // Fill P.6 first director using standard API
    form.getTextField('fill_1_P.6').setText('李小華');
    form.getTextField('fill_2_P.6').setText('LEE');
    form.getTextField('fill_3_P.6').setText('Siu Wa');
    form.getCheckBox('cb_1_P.6').check();

    // Fill P.12 second director using standard API
    form.getTextField('fill_1_P.12').setText('張三豐');
    form.getTextField('fill_2_P.12').setText('CHEUNG');
    form.getTextField('fill_3_P.12').setText('Sam Fung');
    form.getCheckBox('cb_1_P.12').check();

    // Fill P.8 counters
    form.getTextField('fill_3_P.8').setText('1');
    form.getTextField('fill_6_P.8').setText('2');

    // ═══ PI-NNC1: detachWidget + deleteAP + NeedAppearances ═══
    const piPersons = [
        { nameChinese: '陳大文', surname: 'CHAN', otherNames: 'Tai Man',
          hkidMain: 'A123', hkidCheck: '3', isHkid: true,
          passportCountry: '', passportNumber: '',
          addrFlat: 'Room 101', addrBuilding: 'ABC Bldg',
          addrStreet: '1 Main St', addrDistrict: 'Central', addrRegion: 'HK',
          isSecretary: true },
        { nameChinese: '李小華', surname: 'LEE', otherNames: 'Siu Wa',
          hkidMain: 'B456', hkidCheck: '7', isHkid: true,
          passportCountry: '', passportNumber: '',
          addrFlat: 'Flat 2A', addrBuilding: 'XYZ Bldg',
          addrStreet: '2 Queen Rd', addrDistrict: 'Central', addrRegion: 'HK',
          isSecretary: false },
    ];

    const PI_PAGE_IDX = 13;
    const FIT_SIZE = 10;
    const companyName = 'TEST HK LIMITED';

    // Copy extra P.14 pages — CROSS-DOCUMENT for independent widget objects
    if (piPersons.length > 1) {
        const freshBytes = new Uint8Array(templateBytes);
        const freshDoc = await PDFDocument.load(freshBytes, { ignoreEncryption: true });
        for (let i = 1; i < piPersons.length; i++) {
            const [copiedPage] = await pdfDoc.copyPages(freshDoc, [PI_PAGE_IDX]);
            pdfDoc.insertPage(PI_PAGE_IDX + i, copiedPage);
        }
    }
    console.log('Pages after PI copy:', pdfDoc.getPageCount());

    // Fill each PI-NNC1 page
    for (let pi = 0; pi < piPersons.length; pi++) {
        const pageIdx = PI_PAGE_IDX + pi;
        const person = piPersons[pi];
        const pages = pdfDoc.getPages();
        const page = pages[pageIdx];
        if (!page) continue;

        const annots = page.node.lookup(PDFName.of("Annots"));
        if (!annots || typeof annots.size !== "function") continue;
        console.log('PI person ' + pi + ' (page ' + pageIdx + '): ' + annots.size() + ' annots');

        for (let j = 0; j < annots.size(); j++) {
            try {
                const widget = context.lookup(annots.get(j));
                if (!widget || typeof widget.get !== "function") continue;
                const subtype = widget.get(PDFName.of("Subtype"));
                if (!subtype || String(subtype) !== "/Widget") continue;

                const ft = widget.get(PDFName.of("FT"));
                const fieldType = ft ? String(ft) : '';

                let parentName = "";
                const parentRef = widget.get(PDFName.of("Parent"));
                let parentObj = null;
                if (parentRef) {
                    try { parentObj = context.lookup(parentRef); } catch(e) {}
                    if (parentObj) {
                        try {
                            const pT = parentObj.get(PDFName.of("T"));
                            if (pT instanceof PDFString) parentName = pT.decodeText();
                        } catch(e) {}
                    }
                }
                if (!parentName) continue;

                const suffix = parentName.replace(/_P$/, "");

                // Detach widget from shared parent
                detachWidget(widget, parentObj);

                if (fieldType === '/Tx') {
                    if (suffix === "fill_1") {
                        widget.set(PDFName.of("DA"), PDFString.of(`/PMingLiU ${FIT_SIZE} Tf 0 g`));
                        widget.set(PDFName.of("V"), PDFHexString.fromText(companyName));
                    } else {
                        const mapping = PI_FIELDS.find(f => f.suffix === suffix);
                        if (!mapping) continue;
                        if ((suffix === 'fill_5' || suffix === 'fill_6') && !person.isHkid) continue;
                        if ((suffix === 'fill_7' || suffix === 'fill_8') && person.isHkid) continue;
                        const val = String(person[mapping.key] || "").trim();
                        if (!val) continue;

                        if (mapping.isCjk) {
                            widget.set(PDFName.of("DA"), PDFString.of(`/PMingLiU ${FIT_SIZE} Tf 0 g`));
                            widget.set(PDFName.of("V"), PDFHexString.fromText(val));
                        } else {
                            widget.set(PDFName.of("DA"), PDFString.of(`/Helv ${FIT_SIZE} Tf 0 g`));
                            widget.set(PDFName.of("V"), PDFString.of(val));
                        }
                        if (pi === 0) console.log('  Set ' + suffix + ' = "' + val + '"');
                    }
                    widget.delete(PDFName.of("AP"));
                } else if (fieldType === '/Btn') {
                    widget.set(PDFName.of("V"), PDFName.of("Off"));
                    widget.set(PDFName.of("AS"), PDFName.of("Off"));

                    if ((suffix === "cb_1" && person.isSecretary) ||
                        (suffix === "cb_2" && !person.isSecretary)) {
                        let onState = "On";
                        try {
                            const ap = widget.get(PDFName.of("AP"));
                            console.log('  [DEBUG] cb AP present:', !!ap);
                            const apN = ap && ap.get && ap.get(PDFName.of("N"));
                            console.log('  [DEBUG] apN present:', !!apN);
                            if (apN) {
                                console.log('  [DEBUG] apN type:', typeof apN, 'keys:', typeof apN.keys === 'function' ? apN.keys().map(k => String(k)) : 'N/A');
                                // Try entries() first, fallback to keys()
                                if (typeof apN.entries === 'function') {
                                    for (const [k] of apN.entries()) {
                                        if (String(k) !== "Off") { onState = String(k).startsWith('/') ? String(k).slice(1) : String(k); break; }
                                    }
                                } else if (typeof apN.keys === 'function') {
                                    for (const k of apN.keys()) {
                                        if (String(k) !== "Off") { onState = String(k).startsWith('/') ? String(k).slice(1) : String(k); break; }
                                    }
                                }
                            }
                        } catch(e) { console.log('  [DEBUG] AP lookup error:', e.message); }
                        console.log('  [DEBUG] onState =', onState);
                        widget.set(PDFName.of("V"), PDFName.of(onState));
                        widget.set(PDFName.of("AS"), PDFName.of(onState));
                        console.log('  Set checkbox ' + suffix + ' = ' + onState);
                    }
                }
            } catch(e) {}
        }
    }

    // Rebuild AcroForm Fields + NeedAppearances
    console.log('Rebuilding AcroForm Fields...');
    rebuildAcroFormFields(pdfDoc);

    // Remove unused pages
    const shift = piPersons.length - 1;
    const pagesToRemove = [10]; // 續頁C unused
    for (let p = 14; p <= 23; p++) pagesToRemove.push(p > PI_PAGE_IDX ? p + shift : p);

    const sorted = [...pagesToRemove].sort((a, b) => b - a);
    for (const idx of sorted) {
        if (idx >= 0 && idx < pdfDoc.getPageCount()) {
            pdfDoc.removePage(idx);
        }
    }
    console.log('Pages after removal:', pdfDoc.getPageCount());

    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    fs.writeFileSync('_nnc1_simulated.pdf', pdfBytes);
    console.log('Saved _nnc1_simulated.pdf:', pdfBytes.length, 'bytes');
}
main().catch(e => { console.error(e); process.exit(1); });
