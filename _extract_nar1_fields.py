"""Extract all field data from generated NAR1 PDF"""
import fitz  # PyMuPDF
import json

pdf_path = "_nar1_debug.pdf"
doc = fitz.open(pdf_path)

print(f"Pages: {doc.page_count}")

for page_idx in range(doc.page_count):
    page = doc[page_idx]
    widgets = []
    for w in page.widgets():
        widgets.append({
            'name': w.field_name,
            'value': w.field_value,
            'type': w.field_type_string,
            'rect': list(w.rect),
        })
    if widgets:
        print(f"\n=== Page {page_idx + 1} (index {page_idx}) ===")
        for w in widgets:
            val_display = repr(w['value']) if w['value'] else 'EMPTY'
            print(f"  {w['name']}: {val_display}  [{w['type']}]")

# Specific checks
print("\n\n=== CRITICAL CHECKS ===")

# Check P.2 (page index 1)
try:
    page2 = doc[1]
    p2_fields = {}
    for w in page2.widgets():
        if w.field_value:
            p2_fields[w.field_name] = w.field_value
    print(f"\nP.2 filled fields: {len(p2_fields)}")
    for k in sorted(p2_fields.keys()):
        print(f"  {k} = {p2_fields[k]}")
except Exception as e:
    print(f"P.2 error: {e}")

# Check P.8 (page index 7)
try:
    page8 = doc[7]
    p8_fields = {}
    for w in page8.widgets():
        if w.field_value:
            p8_fields[w.field_name] = w.field_value
    print(f"\nP.8 filled fields: {len(p8_fields)}")
    for k in sorted(p8_fields.keys()):
        print(f"  {k} = {p8_fields[k]}")
except Exception as e:
    print(f"P.8 error: {e}")

# Check P.13 (page index 12)
try:
    if doc.page_count > 12:
        page13 = doc[12]
        p13_fields = {}
        for w in page13.widgets():
            if w.field_value:
                p13_fields[w.field_name] = w.field_value
        print(f"\nP.13 (pre-built Sheet C) filled fields: {len(p13_fields)}")
        for k in sorted(p13_fields.keys()):
            print(f"  {k} = {p13_fields[k]}")
    else:
        print("\nP.13: page does not exist in this PDF")
except Exception as e:
    print(f"P.13 error: {e}")

# Check dynamic pages (after page 14)
for pi in range(14, doc.page_count):
    try:
        p = doc[pi]
        dyn_fields = {}
        for w in p.widgets():
            if w.field_value:
                dyn_fields[w.field_name] = w.field_value
        if dyn_fields:
            print(f"\nDynamic page {pi+1} (index {pi}) filled fields: {len(dyn_fields)}")
            for k in sorted(dyn_fields.keys()):
                print(f"  {k} = {dyn_fields[k]}")
        else:
            print(f"\nDynamic page {pi+1} (index {pi}): NO filled fields")
    except Exception as e:
        print(f"Page {pi+1} error: {e}")

doc.close()
