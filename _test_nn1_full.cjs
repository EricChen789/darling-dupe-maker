const { PDFDocument, PDFName, PDFString, PDFBool, PDFArray } = require('pdf-lib');
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
    if (parentName && widgetName) widget.set(PDFName.of('T'), PDFString.of(parentName + '.' + widgetName));
    else if (parentName) widget.set(PDFName.of('T'), PDFString.of(parentName));
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

  // Fill ALL P.10 text fields (like the deployed endpoint)
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
    console.log(name + ': V=' + val + ' DA=' + buildHelvDA(da));
  }

  // Dropdowns: detach + set values (simulate director signatory capacity)
  console.log('\n=== Filling P.10 dropdowns ===');
  const p10 = pdfDoc.getPages()[9];
  const ctx = pdfDoc.context;
  const annots = p10.node.lookup(PDFName.of('Annots'));
  const allCaps = ['director', 'secretary', 'manager', 'authorizedRep'];
  const signatoryCapacity = 'director';
  if (annots && typeof annots.size === 'function') {
    for (let i = 0; i < annots.size(); i++) {
      try {
        const widget = ctx.lookup(annots.get(i));
        if (!widget || String(widget.get(PDFName.of('Subtype'))) !== '/Widget') continue;
        let ft = widget.get(PDFName.of('FT'));
        let fieldName = '';
        const pRef = widget.get(PDFName.of('Parent'));
        let parentObj = null;
        if (pRef) {
          try {
            parentObj = ctx.lookup(pRef);
            if (!ft) ft = parentObj && parentObj.get(PDFName.of('FT'));
            if (!fieldName) {
              const pT = parentObj && parentObj.get(PDFName.of('T'));
              if (pT instanceof PDFString) fieldName = pT.decodeText();
            }
          } catch (e) {}
        }
        if (!ft || String(ft) !== '/Ch') continue;
        const ddMatch = fieldName.match(/^Dropdown(\d)$/);
        if (!ddMatch) continue;
        const capForDD = allCaps[parseInt(ddMatch[1]) - 1];
        if (!capForDD) continue;
        if (parentObj) detachWidget(widget, parentObj);
        const isSel = capForDD === signatoryCapacity;
        const newOpt = PDFArray.withContext(ctx);
        const o0 = PDFArray.withContext(ctx); o0.push(PDFString.of('blank')); o0.push(PDFString.of(' '));
        const o1 = PDFArray.withContext(ctx); o1.push(PDFString.of('line')); o1.push(PDFString.of('______________________________'));
        newOpt.push(o0); newOpt.push(o1);
        widget.set(PDFName.of('Opt'), newOpt);
        widget.set(PDFName.of('V'), PDFString.of(isSel ? 'blank' : 'line'));
        widget.delete(PDFName.of('AP'));
        console.log(fieldName + ': capForDD=' + capForDD + ' isSel=' + isSel);
      } catch(e) { console.log('dd error:', e.message); }
    }
  }

  rebuildAcroFormFields(pdfDoc);
  const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  fs.writeFileSync('_nn1_p10_fulltest.pdf', pdfBytes);
  console.log('\nSaved _nn1_p10_fulltest.pdf (' + pdfBytes.length + ' bytes)');
}
main().catch(e => console.error(e));
