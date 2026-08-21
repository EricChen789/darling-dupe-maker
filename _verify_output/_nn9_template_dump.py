# -*- coding: utf-8 -*-
"""Dump NN9-template.pdf widget structure: per-page fields + nearby text labels"""
import sys, io
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import fitz

DOC = r'D:/myproject/darling-dupe-maker/public/templates/NN9-template.pdf'
doc = fitz.open(DOC)
print('total pages:', doc.page_count)
print('=' * 100)

for pno in range(doc.page_count):
    page = doc[pno]
    print(f'\n##### PAGE {pno+1} #####')
    widgets = list(page.widgets())
    print(f'widgets: {len(widgets)}')
    for w in widgets:
        fn = w.field_name or ''
        fv = str(w.field_value)[:40] if w.field_value is not None else ''
        r = w.rect
        # 附近文本标签：widget 左侧 200pt 内
        labels = []
        words = page.get_text('words')
        for wd in words:
            wx0, wy0, wx1, wy1, wtxt = wd[0], wd[1], wd[2], wd[3], wd[4]
            # label 在 widget 左侧且垂直重叠
            if wx1 <= r.x0 + 2 and wy0 < r.y1 and wy1 > r.y0 and wx1 > r.x0 - 260:
                labels.append(wtxt)
        label = ' '.join(labels)[:60]
        print(f'  {fn:<28} rect=({r.x0:7.1f},{r.y0:7.1f})-({r.x1:7.1f},{r.y1:7.1f}) fv={fv!r}  ← {label}')
doc.close()
