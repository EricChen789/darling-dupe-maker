const { PDFDocument, PDFName, PDFString, PDFBool, PDFArray, PDFNumber } = require('pdf-lib');
const fs = require('fs');

function decodePdfText(value) {
  if (!value) return '';
  try { if (typeof value.decodeText === 'function') return value.decodeText(); } catch (_) {}
  return String(value).replace(/^\((.*)\)$/s, '$1');
}

function collectFormFields(pdfDoc) {
  const map = new Map();
  const addAlias = (name, target) => { if (name && !map.has(name)) map.set(name, target); };
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!annots || typeof annots.size !== 'function') continue;
    for (let i = 0; i < annots.size(); i++) {
      try {
        const widget = pdfDoc.context.lookup(annots.get(i));
        if (!widget || typeof widget.get !== 'function') continue;
        if (String(widget.get(PDFName.of('Subtype'))) !== '/Widget') continue;
        const parentRef = widget.get(PDFName.of('Parent'));
        const field = parentRef ? pdfDoc.context.lookup(parentRef) : widget;
        const parentName = field ? decodePdfText(field.get(PDFName.of('T'))) : '';
        const widgetName = decodePdfText(widget.get(PDFName.of('T')));
        const target = { widget, field };
        let resolvedName = parentName, resolvedSuffix = widgetName;
        const grandParentRef = field && field.get ? field.get(PDFName.of('Parent')) : undefined;
        if (grandParentRef) {
          try {
            const gp = pdfDoc.context.lookup(grandParentRef);
            const gpName = decodePdfText(gp.get(PDFName.of('T')));
            if (gpName) { resolvedName = gpName; resolvedSuffix = resolvedSuffix || parentName; }
          } catch (e) {}
        }
        addAlias(resolvedName, target);
        addAlias(widgetName, target);
        if (resolvedName && resolvedSuffix) addAlias(resolvedName + '.' + resolvedSuffix, target);
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
    for (const k of ['FT','DA','Ff','MaxLen','Q','DV']) {
      const key = PDFName.of(k);
      if (!widget.get(key)) { const v = field.get(key); if (v !== undefined && v !== null) widget.set(key, v); }
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
  } catch (e) {}
}

function buildHelvDA(orig) {
  const m = orig && orig.match(/(\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? m[1] : '12';
  return '/Helv ' + (parseFloat(size) > 0 ? size : '12') + ' Tf 0 g';
}

async function main() {
  const tpl = fs.readFileSync('public/templates/NN1-template.pdf');
  const pdfDoc = await PDFDocument.load(tpl);
  const fields = collectFormFields(pdfDoc);

  // Fill ALL P.10 text fields
  console.log('=== Filling P.10 text fields ===');
  for (let i = 1; i <= 17; i++) {
    const name = 'fill_' + i + '_P.10';
    const target = fields.get(name);
    if (!target) { console.log('NOT FOUND: ' + name); continue; }
    detachWidget(target.widget, target.field);
    const da = decodePdfText(target.widget.get(PDFName.of('DA'))) || '/Helv 12 Tf 0 g';
    target.widget.set(PDFName.of('DA'), PDFString.of(buildHelvDA(da)));

    let val = 'TEST_' + i;
    if (i >= 3 && i <= 8) val = (i < 10 ? '0' : '') + i;
    if (i === 9) val = '2'; if (i === 10) val = '1';
    if (i >= 11 && i <= 15) val = '0';
    if (i === 16) val = 'CHAN TAI MAN';
    if (i === 17) val = '07/08/2026';

    target.widget.set(PDFName.of('V'), PDFString.of(val));
    target.widget.delete(PDFName.of('AP'));
    console.log(name + ': V=' + val);
  }

  // ═══ P.10 Signatory Capacity — drawLine (NAR1-style) ═══
  const signatoryCapacity = 'director';
  console.log('\n=== Signatory Capacity: ' + signatoryCapacity + ' (NAR1-style drawLine) ===');
  const p10 = pdfDoc.getPages()[9];
  const capLines = [
    { x0: 148, x1: 194, y: 89, cap: 'director' },
    { x0: 192, x1: 292, y: 89, cap: 'secretary' },
    { x0: 290, x1: 342, y: 89, cap: 'manager' },
    { x0: 182, x1: 312, y: 76.5, cap: 'authorizedRep' },
  ];
  for (const { x0, x1, y, cap } of capLines) {
    if (cap !== signatoryCapacity) {
      p10.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 1.2 });
      console.log('  drawLine through: ' + cap + ' (' + x0 + ',' + y + ')-(' + x1 + ',' + y + ')');
    } else {
      console.log('  SKIP (selected): ' + cap);
    }
  }

  rebuildAcroFormFields(pdfDoc);
  const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  fs.writeFileSync('_nn1_p10_drawline_test.pdf', pdfBytes);
  console.log('\nSaved _nn1_p10_drawline_test.pdf (' + pdfBytes.length + ' bytes)');
}
main().catch(e => console.error(e));
