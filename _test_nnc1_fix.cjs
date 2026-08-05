const { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString, PDFArray, PDFNumber } = require('pdf-lib');
const fs = require('fs');

// ═══ Replicate the cloud generate-nnc1-pdf.ts logic ═══

function toUtf16BEHex(value) {
  let hex = 'FEFF';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
      const hi = code;
      const lo = value.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        const cp = 0x10000 + (hi - 0xD800) * 0x400 + (lo - 0xDC00);
        hex += (cp >> 24).toString(16).padStart(2, '0').toUpperCase();
        hex += ((cp >> 16) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        hex += ((cp >> 8) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        hex += (cp & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        i++; continue;
      }
    }
    hex += (code >> 8).toString(16).padStart(2, '0').toUpperCase();
    hex += (code & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  }
  return hex;
}

function escapePdfString(value) {
  return value.replace(/([()\\])/g, '\\$1');
}

function setWidgetAp(pdfDoc, widget, value, isCjk, fontRefs) {
  const fontPsName = isCjk ? 'PMingLiU' : 'Helv';
  const fontSize = 10;
  const context = pdfDoc.context;

  let textOp;
  if (isCjk) {
    const hex = toUtf16BEHex(value);
    textOp = '<' + hex + '> Tj';
  } else {
    const escaped = escapePdfString(value);
    textOp = '(' + escaped + ') Tj';
  }

  const apContent = '/' + fontPsName + ' ' + fontSize + ' Tf\n0 g\nBT\n2 2 Td\n' + textOp + '\nET';
  const apBytes = new TextEncoder().encode(apContent);

  // BBox
  const bbox = PDFArray.withContext(context);
  bbox.push(PDFNumber.of(0)); bbox.push(PDFNumber.of(0));
  bbox.push(PDFNumber.of(1000)); bbox.push(PDFNumber.of(1000));

  // Resources with font refs
  const fontDict = context.obj({});
  if (fontRefs) {
    fontDict.set(PDFName.of(fontPsName), isCjk ? fontRefs.cjk : fontRefs.ascii);
  }
  const resources = context.obj({});
  resources.set(PDFName.of('Font'), fontDict);

  const dict = context.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  dict.set(PDFName.of('BBox'), bbox);
  dict.set(PDFName.of('Resources'), resources);

  const apStream = context.stream(apBytes, dict);
  const apRef = context.register(apStream);

  const apDict = context.obj({});
  apDict.set(PDFName.of('N'), apRef);
  widget.set(PDFName.of('AP'), apDict);

  if (isCjk) {
    widget.set(PDFName.of('V'), PDFHexString.fromText(value));
  } else {
    widget.set(PDFName.of('V'), PDFString.of(value));
  }
  widget.set(PDFName.of('DA'), PDFString.of('/' + fontPsName + ' ' + fontSize + ' Tf 0 g'));
}

async function main() {
    const templateBytes = fs.readFileSync('public/templates/NNC1-template.pdf');
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const context = pdfDoc.context;

    // Get font refs from AcroForm DR
    const catalog = pdfDoc.catalog;
    const acroForm = catalog.lookup(PDFName.of('AcroForm'));
    const dr = acroForm.lookup(PDFName.of('DR'));
    const fonts = dr.lookup(PDFName.of('Font'));
    const fontRefs = {
        cjk: fonts.lookup(PDFName.of('PMingLiU')),
        ascii: fonts.lookup(PDFName.of('Helv')),
    };
    console.log('Font refs obtained:', !!fontRefs.cjk, !!fontRefs.ascii);

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

    // ═══ PI-NNC1: Manual AP for 2 persons ═══
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

    // Copy extra P.14 pages
    if (piPersons.length > 1) {
        for (let i = 1; i < piPersons.length; i++) {
            const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [PI_PAGE_IDX]);
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

        const annots = page.node.lookup(PDFName.of('Annots'));
        if (!annots || typeof annots.size !== 'function') continue;
        console.log('PI person ' + pi + ' (page ' + pageIdx + '): ' + annots.size() + ' annots');

        for (let j = 0; j < annots.size(); j++) {
            try {
                const widget = context.lookup(annots.get(j));
                if (!widget || typeof widget.get !== 'function') continue;
                const subtype = widget.get(PDFName.of('Subtype'));
                if (!subtype || String(subtype) !== '/Widget') continue;

                const parentRef = widget.get(PDFName.of('Parent'));
                const field = parentRef ? context.lookup(parentRef) : widget;
                const ft = field.get(PDFName.of('FT'));
                const fieldType = ft ? String(ft) : '';

                // FIXED: Use parent field T (meaningful name) not widget T (page number)
                const fT = field.get(PDFName.of('T'));
                let name = '';
                try {
                    if (fT instanceof PDFString) name = fT.decodeText();
                } catch(e) {}
                if (!name) continue;

                // FIXED: Strip _P suffix
                const suffix = name.replace(/_P$/, '');

                if (fieldType === '/Tx') {
                    if (suffix === 'fill_1') {
                        setWidgetAp(pdfDoc, widget, 'TEST HK LIMITED', true, fontRefs);
                    } else {
                        const mapping = PI_FIELDS.find(f => f.suffix === suffix);
                        if (!mapping) continue;
                        const val = String(person[mapping.key] || '').trim();
                        if (!val) continue;
                        setWidgetAp(pdfDoc, widget, val, mapping.isCjk, fontRefs);
                        if (pi === 0) console.log('  Set ' + suffix + ' = "' + val + '"');
                    }
                } else if (fieldType === '/Btn') {
                    widget.set(PDFName.of('AS'), PDFName.of('Off'));
                    if (pi === 0) {
                        if ((suffix === 'cb_1' && person.isSecretary) ||
                            (suffix === 'cb_2' && !person.isSecretary)) {
                            let onState = 'Yes';
                            try {
                                const ap = widget.get(PDFName.of('AP'));
                                const apN = ap && ap.get && ap.get(PDFName.of('N'));
                                if (apN) {
                                  const dict2 = apN.dict;
                                  if (dict2 && typeof dict2.keys === 'function') {
                                    for (const k of dict2.keys()) {
                                      if (k !== 'Off') { onState = k; break; }
                                    }
                                  }
                                }
                            } catch(e) {}
                            widget.set(PDFName.of('AS'), PDFName.of(onState));
                            console.log('  Set checkbox ' + suffix + ' = ' + onState);
                        }
                    }
                }
            } catch(e) {}
        }
    }

    // Remove unused pages
    const shift = piPersons.length - 1;
    const pagesToRemove = [10]; // 續頁C unused (only 1 corp secretary)
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
