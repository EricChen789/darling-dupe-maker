/**
 * 模拟云端 generate-irbr2-pdf.ts 的精确行为
 * 使用 pdf-lib + acroField.setValue() 生成 IRBR2 PDF
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, PDFDict, PDFString } = require('pdf-lib');

async function main() {
  const templatePath = 'public/templates/IRBR2-template.pdf';
  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

  // ── 学 IRBR1：删 XFA → 纯 AcroForm ──
  try {
    const acroDict = pdfDoc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    acroDict.delete(PDFName.of('XFA'));
    console.log('[OK] XFA removed');
  } catch (e) { console.warn("XFA removal error:", e); }

  const brNumber = "07281051";
  const nameCn = "";
  const nameEn = "PAUL TANG AND COMPANY LIMITED";
  const nature = "Accounting and Company Secretarial Services";
  const commencement = "01/01/1981";
  const irbr2Registered = false;  // No
  const irbr2Elect3yr = true;     // Yes

  const form = pdfDoc.getForm();

  // ── Text fields: acroField.setValue() ──
  if (brNumber) form.getTextField('topmostSubform[0].Page1[0].TextField1[0]').acroField.setValue(PDFString.of(brNumber));
  if (nameCn) form.getTextField('topmostSubform[0].Page1[0].TextField2[0]').acroField.setValue(PDFString.of(nameCn));
  if (nameEn) form.getTextField('topmostSubform[0].Page1[0].TextField2[1]').acroField.setValue(PDFString.of(nameEn));
  if (nature) form.getTextField('topmostSubform[0].Page1[0].TextField2[2]').acroField.setValue(PDFString.of(nature));
  if (commencement) form.getTextField('topmostSubform[0].Page1[0].DateTimeField1[0]').acroField.setValue(PDFString.of(commencement));

  // ── RadioButtonList[1] (top): Already registered ──
  try {
    const rg1 = form.getRadioGroup('topmostSubform[0].Page1[0].RadioButtonList[1]');
    const o1 = rg1.getOptions();
    console.log(`RadioButtonList[1] options: ${JSON.stringify(o1)}`);
    if (o1.length >= 2) rg1.acroField.setValue(PDFName.of(irbr2Registered ? o1[0] : o1[1]));
    console.log(`RadioButtonList[1] value set to: ${irbr2Registered ? o1[0] : o1[1]}`);
  } catch (e) { console.warn("IRBR2 RadioButtonList[1] error:", e); }

  // ── RadioButtonList[0] (bottom): Elect 3-year ──
  try {
    const rg0 = form.getRadioGroup('topmostSubform[0].Page1[0].RadioButtonList[0]');
    const o0 = rg0.getOptions();
    console.log(`RadioButtonList[0] options: ${JSON.stringify(o0)}`);
    if (o0.length >= 2) rg0.acroField.setValue(PDFName.of(irbr2Elect3yr ? o0[0] : o0[1]));
    console.log(`RadioButtonList[0] value set to: ${irbr2Elect3yr ? o0[0] : o0[1]}`);
  } catch (e) { console.warn("IRBR2 RadioButtonList[0] error:", e); }

  // ── Debug: check field values after setting ──
  console.log('\n=== Debug: Field values after setting ===');
  const fields = pdfDoc.getForm().getFields();
  for (const field of fields) {
    const name = field.getName();
    const type = field.constructor.name;
    try {
      const acroField = field.acroField;
      const v = acroField.get(PDFName.of('V'));
      const as = acroField.get(PDFName.of('AS'));
      console.log(`  ${name} (${type}): /V=${v}, /AS=${as}`);
    } catch (e) {
      console.log(`  ${name} (${type}): error reading value`);
    }
  }

  // ── Save ──
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  const outPath = '_irbr2_cloud_sim.pdf';
  fs.writeFileSync(outPath, pdfBytes);
  console.log(`\n[OK] Saved → ${outPath} (${pdfBytes.length} bytes)`);
}

main().catch(e => { console.error(e); process.exit(1); });
