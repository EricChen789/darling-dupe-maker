# -*- coding: utf-8 -*-
"""NN9 本地 PDF 断言：PyMuPDF 逐 widget 值 + 下拉 /I + 划线重叠检查
用法: python _nn9_assert.py
"""
import sys, io, os, json
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
import fitz

D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, '_nn9_out')
exp = json.load(open(os.path.join(OUT, 'expectations.json'), encoding='utf-8'))

P = F = 0
def chk(name, cond, detail=''):
    global P, F
    if cond:
        print(f'  PASS  {name}'); P += 1
    else:
        print(f'  FAIL  {name}  {detail}'); F += 1

def load(name):
    doc = fitz.open(os.path.join(OUT, f'{name}.pdf'))
    vals = {}
    for p in range(doc.page_count):
        for w in doc[p].widgets():
            vals[w.field_name] = w.field_value
    return doc, vals

def dd_i(doc, pno, field_name):
    """读 widget 的 /I 键原始文本（下拉选中索引）"""
    for w in doc[pno].widgets():
        if w.field_name == field_name:
            t, v = doc.xref_get_key(w.xref, 'I')
            return v
    return None

def lines_in_rect(doc, pno, r, tol=1.5):
    """页面上是否存在与给定矩形垂直中点相交且 x 重叠的线条（手算，Rect.is_empty 陷阱）"""
    midY = (r.y0 + r.y1) / 2
    for d in doc[pno].get_drawings():
        for item in d['items']:
            if item[0] not in ('l', 're'):
                continue
            if item[0] == 'l':
                p1, p2 = item[1], item[2]
                xs = [p1.x, p2.x]; ys = [p1.y, p2.y]
            else:
                rect = item[1]
                xs = [rect.x0, rect.x1]; ys = [rect.y0, rect.y1]
            if min(ys) - tol <= midY <= max(ys) + tol and \
               max(xs) >= r.x0 + 2 and min(xs) <= r.x1 - 2:
                return True
    return False

def dropdown_rects(doc, pno):
    """返回 {field_name: [rect...]}（同名多实例）"""
    out = {}
    for w in doc[pno].widgets():
        if w.field_name.startswith('Dropdown_'):
            out.setdefault(w.field_name, []).append(w.rect)
    return out

# ═══ s01 全量 ═══
doc, vals = load('s01_full')
chk('s01 pages=2', doc.page_count == 2, str(doc.page_count))
chk('s01 P.1 BR', vals.get('fill_1_P.1') == '60535184', repr(vals.get('fill_1_P.1')))
chk('s01 P.1 公司名', vals.get('fill_2_P.1') == 'APEX GLOBAL TRADING LIMITED', repr(vals.get('fill_2_P.1')))
chk('s01 P.1 2(a) 4行', (vals.get('fill_3_P.1'), vals.get('fill_4_P.1'), vals.get('fill_5_P.1'), vals.get('fill_6_P.1')) ==
    ('Flat 8', 'Block D', "Queen's Road", '中西區'),
    repr((vals.get('fill_3_P.1'), vals.get('fill_6_P.1'))))
chk('s01 P.1 2(a) 日期', (vals.get('fill_7_P.1'), vals.get('fill_8_P.1'), vals.get('fill_9_P.1')) == ('01', '08', '2026'),
    repr((vals.get('fill_7_P.1'), vals.get('fill_9_P.1'))))
chk('s01 P.1 2(b) 電郵', vals.get('fill_10_P.1') == 'hk@apex.com', repr(vals.get('fill_10_P.1')))
chk('s01 P.1 2(b) 日期', (vals.get('fill_11_P.1'), vals.get('fill_12_P.1'), vals.get('fill_13_P.1')) == ('02', '08', '2026'),
    repr(vals.get('fill_11_P.1')))
chk('s01 P.1 2(c) 電話', vals.get('fill_14_P.1') == '+852 9123 4567', repr(vals.get('fill_14_P.1')))
chk('s01 P.1 2(c) 日期', (vals.get('fill_15_P.1'), vals.get('fill_16_P.1'), vals.get('fill_17_P.1')) == ('03', '08', '2026'),
    repr(vals.get('fill_15_P.1')))
chk('s01 P.1 提交人姓名', vals.get('fill_18_P.1') == 'Twinsail Consultants Limited', repr(vals.get('fill_18_P.1')))
chk('s01 P.1 提交人地址', vals.get('fill_19_P.1') == 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong', repr(vals.get('fill_19_P.1'))[:80])
chk('s01 P.1 提交人電話', vals.get('fill_20_P.1') == '+852 2521 3888', repr(vals.get('fill_20_P.1')))
chk('s01 P.1 提交人傳真', vals.get('fill_21_P.1') == '+852 2521 3999', repr(vals.get('fill_21_P.1')))
chk('s01 P.1 提交人電郵', vals.get('fill_22_P.1') == 'info@twinsail.com', repr(vals.get('fill_22_P.1')))
chk('s01 P.1 提交人檔號', vals.get('fill_23_P.1') == 'TS-2026-001', repr(vals.get('fill_23_P.1')))
chk('s01 P.2 BR', vals.get('fill_1_P.2') == '60535184', repr(vals.get('fill_1_P.2')))
chk('s01 P.2 3(a) 5行', (vals.get('fill_2_P.2'), vals.get('fill_3_P.2'), vals.get('fill_4_P.2'), vals.get('fill_5_P.2'), vals.get('fill_6_P.2')) ==
    ('Room 501', 'Shinjuku Building', '1-2-3 Nishi-Shinjuku', 'Shinjuku-ku', 'Japan'),
    repr((vals.get('fill_2_P.2'), vals.get('fill_6_P.2'))))
chk('s01 P.2 3(a) 日期', (vals.get('fill_7_P.2'), vals.get('fill_8_P.2'), vals.get('fill_9_P.2')) == ('05', '08', '2026'),
    repr(vals.get('fill_7_P.2')))
chk('s01 P.2 3(b) 5行', (vals.get('fill_10_P.2'), vals.get('fill_14_P.2')) == ('Floor 12', 'Japan'),
    repr((vals.get('fill_10_P.2'), vals.get('fill_14_P.2'))))
chk('s01 P.2 3(b) 日期', (vals.get('fill_15_P.2'), vals.get('fill_16_P.2'), vals.get('fill_17_P.2')) == ('06', '08', '2026'),
    repr(vals.get('fill_15_P.2')))
chk('s01 P.2 3(c) 電郵', vals.get('fill_18_P.2') == 'overseas@apex.com', repr(vals.get('fill_18_P.2')))
chk('s01 P.2 3(c) 日期', (vals.get('fill_19_P.2'), vals.get('fill_20_P.2'), vals.get('fill_21_P.2')) == ('07', '08', '2026'),
    repr(vals.get('fill_19_P.2')))
chk('s01 P.2 簽署人', vals.get('fill_22_P.2') == 'Chan Tai Man, David', repr(vals.get('fill_22_P.2')))
chk('s01 P.2 簽署日期', vals.get('fill_23_P.2') == '21/08/2026', repr(vals.get('fill_23_P.2')))
# 下拉：director 保留（/I=[0]），secretary/manager/authorizedRep 划线（/I=[1]）
chk('s01 DD1 director /I=0', dd_i(doc, 1, 'Dropdown_1_P.2') == '[0]', str(dd_i(doc, 1, 'Dropdown_1_P.2')))
chk('s01 DD2 secretary /I=1', dd_i(doc, 1, 'Dropdown_2_P.2') == '[1]', str(dd_i(doc, 1, 'Dropdown_2_P.2')))
chk('s01 DD3 manager /I=1', dd_i(doc, 1, 'Dropdown_3_P.2') == '[1]', str(dd_i(doc, 1, 'Dropdown_3_P.2')))
chk('s01 DD4 authorizedRep /I=1', dd_i(doc, 1, 'Dropdown_4_P.2') == '[1]', str(dd_i(doc, 1, 'Dropdown_4_P.2')))
drects = dropdown_rects(doc, 1)
crossed = ['Dropdown_2_P.2', 'Dropdown_3_P.2', 'Dropdown_4_P.2']
miss = [fn for fn in crossed for r in drects.get(fn, []) if not lines_in_rect(doc, 1, r)]
chk('s01 划线 3×2 实例全画', len(miss) == 0, f'missing {miss}')
kept = [fn for fn in ['Dropdown_1_P.2'] for r in drects.get(fn, []) if lines_in_rect(doc, 1, r)]
chk('s01 DD1 保留不划线', len(kept) == 0, f'wrongly crossed {kept}')
doc.close()

# ═══ s02 仅香港 2(a) ═══
doc, vals = load('s02_hk_only')
chk('s02 pages=2', doc.page_count == 2, str(doc.page_count))
chk('s02 P.1 地址有', vals.get('fill_3_P.1') == 'Suite 2001', repr(vals.get('fill_3_P.1')))
chk('s02 P.1 電郵空', vals.get('fill_10_P.1') == '', repr(vals.get('fill_10_P.1')))
chk('s02 P.1 電話空', vals.get('fill_14_P.1') == '', repr(vals.get('fill_14_P.1')))
chk('s02 P.1 電郵日期空', vals.get('fill_11_P.1') == '' and vals.get('fill_13_P.1') == '', repr(vals.get('fill_11_P.1')))
chk('s02 P.2 3(a) 空', vals.get('fill_2_P.2') == '' and vals.get('fill_6_P.2') == '', repr(vals.get('fill_2_P.2')))
chk('s02 P.2 3(c) 空', vals.get('fill_18_P.2') == '', repr(vals.get('fill_18_P.2')))
chk('s02 P.2 簽署仍在', vals.get('fill_22_P.2') == 'Chan Tai Man, David', repr(vals.get('fill_22_P.2')))
doc.close()

# ═══ s03 仅成立地 ═══
doc, vals = load('s03_overseas_only')
chk('s03 pages=2', doc.page_count == 2, str(doc.page_count))
chk('s03 P.1 地址空', vals.get('fill_3_P.1') == '', repr(vals.get('fill_3_P.1')))
chk('s03 P.2 3(a) 有', vals.get('fill_2_P.2') == 'Level 8' and vals.get('fill_6_P.2') == 'Japan',
    repr((vals.get('fill_2_P.2'), vals.get('fill_6_P.2'))))
chk('s03 P.2 3(a) 日期', (vals.get('fill_7_P.2'), vals.get('fill_8_P.2'), vals.get('fill_9_P.2')) == ('11', '08', '2026'),
    repr(vals.get('fill_7_P.2')))
chk('s03 P.2 3(b) 有', vals.get('fill_10_P.2') == 'Unit 3' and vals.get('fill_14_P.2') == 'Japan',
    repr(vals.get('fill_10_P.2')))
chk('s03 P.2 3(b) 日期', (vals.get('fill_15_P.2'), vals.get('fill_16_P.2'), vals.get('fill_17_P.2')) == ('12', '08', '2026'),
    repr(vals.get('fill_15_P.2')))
doc.close()

# ═══ s04 身份 authorizedRep ═══
doc, vals = load('s04_cap_authorizedRep')
chk('s04 DD4 kept /I=0', dd_i(doc, 1, 'Dropdown_4_P.2') == '[0]', str(dd_i(doc, 1, 'Dropdown_4_P.2')))
chk('s04 DD1 crossed /I=1', dd_i(doc, 1, 'Dropdown_1_P.2') == '[1]', str(dd_i(doc, 1, 'Dropdown_1_P.2')))
chk('s04 DD2 crossed /I=1', dd_i(doc, 1, 'Dropdown_2_P.2') == '[1]', str(dd_i(doc, 1, 'Dropdown_2_P.2')))
chk('s04 DD3 crossed /I=1', dd_i(doc, 1, 'Dropdown_3_P.2') == '[1]', str(dd_i(doc, 1, 'Dropdown_3_P.2')))
drects = dropdown_rects(doc, 1)
crossed = ['Dropdown_1_P.2', 'Dropdown_2_P.2', 'Dropdown_3_P.2']
miss = [fn for fn in crossed for r in drects.get(fn, []) if not lines_in_rect(doc, 1, r)]
chk('s04 划线 3×2 实例全画', len(miss) == 0, f'missing {miss}')
doc.close()

# ═══ s05 无签署人 ═══
doc, vals = load('s05_no_sig')
chk('s05 pages=2', doc.page_count == 2, str(doc.page_count))
chk('s05 簽署人空', vals.get('fill_22_P.2') == '', repr(vals.get('fill_22_P.2')))
chk('s05 簽署日期空', vals.get('fill_23_P.2') == '', repr(vals.get('fill_23_P.2')))
drects = dropdown_rects(doc, 1)
any_line = [fn for fn, rs in drects.items() for r in rs if lines_in_rect(doc, 1, r)]
chk('s05 下拉无划线', len(any_line) == 0, f'crossed {any_line}')
chk('s05 DD1 仍空白', dd_i(doc, 1, 'Dropdown_1_P.2') in (None, 'null', '[0]'), str(dd_i(doc, 1, 'Dropdown_1_P.2')))
doc.close()

# ═══ s06 旧版字段 ═══
doc, vals = load('s06_legacy')
chk('s06 pages=2', doc.page_count == 2, str(doc.page_count))
chk('s06 旧 flat→2(a)', vals.get('fill_3_P.1') == 'Flat 8', repr(vals.get('fill_3_P.1')))
chk('s06 旧 changeDay→日期', (vals.get('fill_7_P.1'), vals.get('fill_8_P.1'), vals.get('fill_9_P.1')) == ('01', '08', '2026'),
    repr(vals.get('fill_7_P.1')))
chk('s06 旧 newEmail', vals.get('fill_10_P.1') == 'hk@apex.com', repr(vals.get('fill_10_P.1')))
chk('s06 旧 resolutionDay→電郵日期', (vals.get('fill_11_P.1'), vals.get('fill_13_P.1')) == ('02', '2026'),
    repr((vals.get('fill_11_P.1'), vals.get('fill_13_P.1'))))
chk('s06 旧 newPhone', vals.get('fill_14_P.1') == '+852 9123 4567', repr(vals.get('fill_14_P.1')))
chk('s06 电话日期空', vals.get('fill_15_P.1') == '', repr(vals.get('fill_15_P.1')))
chk('s06 signDate 字串→单框', vals.get('fill_23_P.2') == '21/08/2026', repr(vals.get('fill_23_P.2')))
doc.close()

# ═══ s07 debug ═══
doc = load('s07_debug')[0]
chk('s07 pages=4', doc.page_count == 4, str(doc.page_count))
nw = sum(len(list(doc[p].widgets())) for p in range(doc.page_count))
chk('s07 widgets 已 flatten', nw == 0, f'{nw} widgets left')
doc.close()

# ═══ expectations 页数核对 ═══
for name, e in exp.items():
    doc = load(name)[0]
    chk(f'{name} pages={e["pages"]}', doc.page_count == e['pages'], str(doc.page_count))
    doc.close()

print(f'\nNN9 ASSERT TOTAL: {P} pass / {F} fail')
sys.exit(1 if F else 0)
