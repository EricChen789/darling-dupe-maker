const { PDFDocument, PDFName, PDFString, PDFBool, PDFArray } = require('pdf-lib');
const fs = require('fs');

// Replicate the _acroform.ts logic
function decodePdfText(value) {
  if (!value) return '';
  try {
    if (typeof value.decodeText === 'function') return value.decodeText();
  } catch (_) {}
  return String(value).replace(/^\((.*)\)$/s, '$1');
}

function collectFormFields(pdfDoc) {
  const map = new Map();
  const addAlias = (name, target) => {
    if (name && !map.has(name)) map.set(name, target);
  };
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!annots || typeof annots.size !== 'function') continue;
    for (let i = 0; i < annots.size(); i++) {
      try {
        const widget = pdfDoc.context.lookup(annots.get(i));
        if (!widget || typeof widget.get !== 'function') continue;
        const subtype = widget.get(PDFName.of('Subtype'));
        if (subtype && String(subtype) !== '/Widget') continue;
        const parentRef = widget.get(PDFName.of('Parent'));
        const field = parentRef ? pdfDoc.context.lookup(parentRef) : widget;
        const parentName = field ? decodePdfText(field.get(PDFName.of('T'))) : '';
        const widgetName = decodePdfText(widget.get(PDFName.of('T')));
        const target = { widget, field };
        let resolvedName = parentName;
        let resolvedSuffix = widgetName;
        const grandParentRef = field && field.get ? field.get(PDFName.of('Parent')) : undefined;
        if (grandParentRef) {
          try {
            const grandParent = pdfDoc.context.lookup(grandParentRef);
            const gpName = decodePdfText(grandParent.get(PDFName.of('T')));
            if (gpName) {
              resolvedName = gpName;
              resolvedSuffix = resolvedSuffix || parentName;
            }
          } catch { /* skip */ }
        }
        addAlias(resolvedName, target);
        addAlias(widgetName, target);
        if (resolvedName && resolvedSuffix)
          addAlias(resolvedName + '.' + resolvedSuffix, target);
        if (resolvedSuffix) {
          addAlias(resolvedSuffix.replace(/_P\.(\d+)$/g, '_P$1'), target);
          addAlias(resolvedSuffix.replace(/_P(\d+)$/g, '_P.$1'), target);
        }
        if (resolvedName) {
          addAlias(resolvedName.replace(/_P\.(\d+)$/g, '_P$1'), target);
          addAlias(resolvedName.replace(/_P(\d+)$/g, '_P.$1'), target);
        }
      } catch (_) {}
    }
  }
  return map;
}

function detachWidget(widget, field) {
  if (widget === field) return;
  try {
    const parentName = decodePdfText(field.get(PDFName.of('T')));
    const widgetName = decodePdfText(widget.get(PDFName.of('T')));
    const inheritKeys = ['FT', 'DA', 'Ff', 'MaxLen', 'Q', 'DV'];
    for (const k of inheritKeys) {
      const key = PDFName.of(k);
      if (!widget.get(key)) {
        const v = field.get(key);
        if (v !== undefined && v !== null) widget.set(key, v);
      }
    }
    if (parentName && widgetName)
      widget.set(PDFName.of('T'), PDFString.of(parentName + '.' + widgetName));
    widget.delete(PDFName.of('Parent'));
  } catch (_) {}
}

function rebuildAcroFormFields(pdfDoc) {
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
    if (!acroForm || typeof acroForm.set !== 'function') return;
    const fields = PDFArray.withContext(pdfDoc.context);
    for (const page of pdfDoc.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (!annots || typeof annots.size !== 'function') continue;
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        const widget = pdfDoc.context.lookup(ref);
        if (!widget || typeof widget.get !== 'function') continue;
        if (String(widget.get(PDFName.of('Subtype'))) !== '/Widget') continue;
        if (!widget.get(PDFName.of('FT'))) continue;
        fields.push(ref);
      }
    }
    acroForm.set(PDFName.of('Fields'), fields);
    acroForm.set(PDFName.of('NeedAppearances'), PDFBool.True);
  } catch (e) { console.warn('rebuild failed:', e.message); }
}

function buildHelvDA(originalDA) {
  const m = originalDA && originalDA.match(/(\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? m[1] : '12';
  // Fix: if size is 0, default to 12
  const actualSize = parseFloat(size) > 0 ? size : '12';
  return '/Helv ' + actualSize + ' Tf 0 g';
}

function isAscii(s) { return /^[\x00-\x7F]*$/.test(s); }

async function main() {
  const templateBytes = fs.readFileSync('public/templates/NN1-template.pdf');
  const pdfDoc = await PDFDocument.load(templateBytes);

  const fieldMap = collectFormFields(pdfDoc);

  // Check what P.10 fields we can find
  const testNames = ['fill_1_P.10', 'fill_9_P.10', 'fill_15_P.10', 'fill_16_P.10', 'fill_17_P.10'];
  console.log('=== Field Lookup Test ===');
  for (const name of testNames) {
    const target = fieldMap.get(name);
    if (target) {
      const da = decodePdfText(target.field.get(PDFName.of('DA'))) || 'N/A';
      const ft = target.field.get(PDFName.of('FT'));
      console.log(name + ': FOUND, DA=' + da + ', FT=' + String(ft || 'N/A'));
    } else {
      console.log(name + ': NOT FOUND');
    }
  }

  // Simulate setText for ALL P.10 fill_* fields
  console.log('\n=== Filling all P.10 text fields ===');
  const p10TextFields = [];
  for (let i = 1; i <= 17; i++) {
    const name = 'fill_' + i + '_P.10';
    const target = fieldMap.get(name);
    if (target) {
      p10TextFields.push({ name, target });
      detachWidget(target.widget, target.field);
      const da = decodePdfText(target.widget.get(PDFName.of('DA'))) || '/Helv 12 Tf 0 g';
      const newDA = buildHelvDA(da);
      target.widget.set(PDFName.of('DA'), PDFString.of(newDA));

      let val = 'TEST_' + i;
      if (i >= 3 && i <= 8) val = '01'; // date fields
      if (i >= 9 && i <= 15) val = String(i - 8); // counters
      if (i === 16) val = 'CHAN TAI MAN'; // signatory name
      if (i === 17) val = '07/08/2026'; // sign date

      target.widget.set(PDFName.of('V'), PDFString.of(val));
      target.widget.delete(PDFName.of('AP'));

      const vAfter = decodePdfText(target.widget.get(PDFName.of('V')));
      console.log(name + ': V=' + vAfter + ', DA=' + newDA);
    }
  }

  // Rebuild AcroForm
  rebuildAcroFormFields(pdfDoc);

  // Check AcroForm /Fields count
  const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
  const fieldsArr = acroForm.get(PDFName.of('Fields'));
  console.log('\nAcroForm /Fields count: ' + (fieldsArr ? fieldsArr.size() : 'N/A'));

  // Save
  const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  fs.writeFileSync('_nn1_p10_test.pdf', pdfBytes);
  console.log('Saved _nn1_p10_test.pdf (' + pdfBytes.length + ' bytes)');
}

main().catch(e => console.error(e));
