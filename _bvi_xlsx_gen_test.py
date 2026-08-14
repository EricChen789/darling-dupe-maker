# -*- coding: utf-8 -*-
"""BVI xlsx 端点逻辑 Python 镜像测试：与 generate-directors-register-bvi-xlsx.ts 逐函数 1:1 对应。
生成 3 个变体 → Excel COM 打开（无修复提示）+ openpyxl 校验 + 打印导出 PDF。"""
import sys, io, os, re, zipfile
import win32com.client as win32
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SRC = r"D:\myproject\秘书系统文件\rod rom\Register Of Director.xlsx"
OUT = r"_verify_output\bvi_xlsx\local"
os.makedirs(OUT, exist_ok=True)

# ═══════ 以下与 TS 端点逐函数对应 ═══════

def esc_xml(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
             .replace('"', '&quot;').replace('\r\n', '&#10;').replace('\r', '&#10;').replace('\n', '&#10;'))

def extract_row(xml, r):
    m = re.search(rf'<row r="{r}"[^>]*?/>|<row r="{r}"[^>]*>.*?</row>', xml, re.S)
    if not m:
        raise RuntimeError(f'template row {r} not found')
    return m.group(0)

def renumber_row(row_xml, new_r):
    s = re.sub(r'(<row r=")\d+(")', rf'\g<1>{new_r}\g<2>', row_xml, count=1)
    s = re.sub(r'\br="([A-Z]+)\d+"', lambda m: f'r="{m.group(1)}{new_r}"', s)
    def strip_k(m):
        if '<f' not in m.group(0):
            return m.group(0)
        sm = re.search(r's="(\d+)"', m.group(2))
        return f'<c r="K{m.group(1)}"{f" s=\"{sm.group(1)}\"" if sm else ""}/>'
    s = re.sub(r'<c r="K(\d+)"([^>]*)>.*?</c>', strip_k, s, flags=re.S)
    return s

def fill_empty_cell(row_xml, col, row_num, value):
    if not value:
        return row_xml
    filled = f'<c r="{col}{row_num}"\\1 t="inlineStr"><is><t xml:space="preserve">{esc_xml(value)}</t></is></c>'
    return re.sub(rf'<c r="{col}{row_num}"([^>]*)/>', filled, row_xml)

def fill_formula_cell(row_xml, col, row_num, value):
    def repl(m):
        attrs = m.group(1)
        sm = re.search(r's="(\d+)"', attrs)
        style = f' s="{sm.group(1)}"' if sm else ''
        if not value:
            return f'<c r="{col}{row_num}"{style}/>'
        return f'<c r="{col}{row_num}"{style} t="inlineStr"><is><t xml:space="preserve">{esc_xml(value)}</t></is></c>'
    return re.sub(rf'<c r="{col}{row_num}"([^>]*)>.*?</c>', repl, row_xml, flags=re.S)

def fill_cells(row_xml, row_num, vals, formula_cols):
    out = row_xml
    for col, val in vals.items():
        out = fill_formula_cell(out, col, row_num, val) if col in formula_cols else fill_empty_cell(out, col, row_num, val)
    return out

def build_merges(header, slot_fn, foot_fn, n, footer_start):
    parts = list(header)
    for i in range(n):
        r0 = 6 + 5 * i
        for k in range(4):
            parts.extend(slot_fn(r0 + k))
        if i < n - 1:
            parts.extend(slot_fn(r0 + 4))
    d = footer_start - 20
    parts.extend(foot_fn(d))
    inner = ''.join(f'<mergeCell ref="{r}"/>' for r in parts)
    return f'<mergeCells count="{len(parts)}">{inner}</mergeCells>'

def build_sheet_xml(xml, n, fill_slot, header_merges, slot_merges, foot_merges, dim_col):
    head = xml[:xml.index('<row r="6"')]
    slot_rows = [extract_row(xml, r) for r in (6, 7, 8, 9)]
    sep_row = extract_row(xml, 10)
    foot_rows = [extract_row(xml, r) for r in (20, 21, 22, 23, 24)]
    r24 = extract_row(xml, 24)
    tail = xml[xml.index(r24) + len(r24):]

    footer_start = 6 if n == 0 else 10 + 5 * (n - 1)
    last_row = footer_start + 4

    out = head
    for i in range(n):
        r0 = 6 + 5 * i
        out += renumber_row(fill_slot(slot_rows[0], i), r0)
        out += renumber_row(slot_rows[1], r0 + 1)
        out += renumber_row(slot_rows[2], r0 + 2)
        out += renumber_row(slot_rows[3], r0 + 3)
        if i < n - 1:
            out += renumber_row(sep_row, r0 + 4)
    d = footer_start - 20
    for j in range(5):
        out += renumber_row(foot_rows[j], 20 + d + j)
    out += tail

    out = re.sub(r'<dimension ref="A1:[A-Z]+\d+"/>', f'<dimension ref="A1:{dim_col}{last_row}"/>', out)
    out = re.sub(r'<mergeCells count="\d+">.*?</mergeCells>', build_merges(header_merges, slot_merges, foot_merges, n, footer_start), out, flags=re.S)
    return out

def fmt_date(s):
    if not s:
        return ''
    t = str(s).strip()
    if not t:
        return ''
    if re.fullmatch(r'\d{2}/\d{2}/\d{4}', t):
        return t
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', t)
    if m:
        return f'{m.group(3)}/{m.group(2)}/{m.group(1)}'
    m2 = re.fullmatch(r'(\d{2})(\d{2})(\d{4})', t)
    if m2:
        return f'{m2.group(1)}/{m2.group(2)}/{m2.group(3)}'
    return t

S1_HEADER = ['J3:L3', 'D1:F1', 'D2:F2', 'G2:I2', 'B5:D5', 'E5:F5']
S1_SLOT = lambda r: [f'B{r}:D{r}', f'E{r}:F{r}']
S1_FOOT = lambda d: [f'D{22+d}:K{22+d}', f'D{23+d}:K{23+d}']
S2_HEADER = ['K3:M3', 'G2:I2', 'D1:F1', 'D2:F2', 'F5:G5', 'A4:C4', 'B5:D5', 'I5:J5']
S2_SLOT = lambda r: [f'B{r}:D{r}', f'F{r}:G{r}', f'I{r}:J{r}']
S2_FOOT = lambda d: [f'D{22+d}:L{22+d}', f'D{23+d}:L{23+d}', f'L{24+d}:M{24+d}']

def generate(entries, co_name, co_number, natural, corporate, out_path):
    s1 = entries['xl/worksheets/sheet1.xml'].decode('utf-8')
    s1 = fill_empty_cell(s1, 'D', 1, co_name)
    s1 = fill_empty_cell(s1, 'D', 2, co_number)
    def s1_fill(slot6, i):
        p = natural[i]
        dob = fmt_date(p.get('date_of_birth'))
        dob_place = ' '.join(x for x in [dob, p.get('place_of_birth') or ''] if x)
        nat_id = '\n'.join(x for x in [p.get('nationality') or '', p.get('id_number') or p.get('passport_number') or ''] if x)
        return fill_cells(slot6, 6, {
            'A': fmt_date(p.get('date_appointed')),
            'B': p.get('name_english') or p.get('name_chinese') or '',
            'E': p.get('previous_name') or p.get('alias') or '',
            'G': dob_place,
            'H': nat_id,
            'I': p.get('address') or '',
            'J': p.get('occupation') or '',
            'K': fmt_date(p.get('date_ceased')) if p.get('date_ceased') else 'Current',
            'L': '',
        }, [])
    s1 = build_sheet_xml(s1, len(natural), s1_fill, S1_HEADER, S1_SLOT, S1_FOOT, 'P')

    s2 = entries['xl/worksheets/sheet2.xml'].decode('utf-8')
    s2 = fill_formula_cell(s2, 'D', 1, co_name)
    s2 = fill_formula_cell(s2, 'D', 2, co_number)
    # 用户 2026-08-14：法人董事暂不填值 — 保留模板空格子 + 表头（K 列公式由 renumber_row 剥离）
    def s2_fill(slot6, i):
        return slot6
    s2 = build_sheet_xml(s2, len(corporate), s2_fill, S2_HEADER, S2_SLOT, S2_FOOT, 'O')

    assert '<f ' not in s1 and '<f ' not in s2 and '<f>' not in s1 and '<f>' not in s2, '公式残留!'

    wb = entries['xl/workbook.xml'].decode('utf-8')
    last1 = 10 if not natural else 5 * len(natural) + 9
    last2 = 10 if not corporate else 5 * len(corporate) + 9
    wb = wb.replace("'individual Director'!$A$1:$L$24", f"'individual Director'!$A$1:$L${last1}")
    wb = wb.replace("'Corporate Director'!$A$1:$M$24", f"'Corporate Director'!$A$1:$M${last2}")

    ct = entries['[Content_Types].xml'].decode('utf-8')
    ct = re.sub(r'<Override PartName="/xl/calcChain\.xml"[^>]*/>', '', ct)
    rels = entries['xl/_rels/workbook.xml.rels'].decode('utf-8')
    rels = re.sub(r'<Relationship[^>]*calcChain[^>]*/>', '', rels)

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_STORED) as zf:
        for name, data in entries.items():
            if name == 'xl/calcChain.xml':
                continue
            if name == 'xl/worksheets/sheet1.xml':
                data = s1.encode('utf-8')
            elif name == 'xl/worksheets/sheet2.xml':
                data = s2.encode('utf-8')
            elif name == 'xl/workbook.xml':
                data = wb.encode('utf-8')
            elif name == '[Content_Types].xml':
                data = ct.encode('utf-8')
            elif name == 'xl/_rels/workbook.xml.rels':
                data = rels.encode('utf-8')
            zf.writestr(name, data)
    return last1, last2

# ═══════ 样本数据 ═══════
CO_NAME = 'WAN LEADER INTERNATIONAL LIMITED'
CO_NUMBER = '1234567'

NAT5 = [
    {'date_appointed': '2023-01-05', 'name_english': 'LV KEYI', 'name_chinese': '吕可一',
     'date_of_birth': '1988-03-21', 'place_of_birth': 'Shanghai, China', 'nationality': 'Chinese',
     'id_number': 'P123456(7)', 'address': "Room 1201, 12/F, ABC Tower\n123 Queen's Road Central\nHong Kong",
     'occupation': 'Director'},
    {'date_appointed': '2023-01-05', 'name_english': 'ZHANG PANGFEI', 'previous_name': 'Zhang Fei',
     'date_of_birth': '1979-11-02', 'place_of_birth': 'Beijing, China', 'nationality': 'Chinese',
     'id_number': 'K223344(5)', 'address': 'Flat 8B, Block 2, Garden Estate, Kowloon, Hong Kong',
     'occupation': 'Manager', 'date_ceased': '2024-06-30'},
    {'date_appointed': '2023-02-11', 'name_english': 'WU YUSHAN', 'date_of_birth': '1990-07-15',
     'place_of_birth': 'Guangzhou, China', 'nationality': 'Chinese', 'passport_number': 'E12345678',
     'address': 'Unit 5, 20/F, Silver Court, Causeway Bay, Hong Kong', 'occupation': 'Consultant'},
    {'date_appointed': '2024-03-01', 'name_english': 'YAN XIMAO', 'date_of_birth': '',
     'place_of_birth': '', 'nationality': 'Chinese', 'address': '23 Sai Yeung Choi Street, Mongkok, Hong Kong',
     'occupation': ''},
    {'date_appointed': '2025-01-01', 'name_english': 'QU TIANYUN', 'alias': 'Tian Yun Qu',
     'date_of_birth': '1995-09-09', 'place_of_birth': 'Shenzhen, China', 'nationality': 'Chinese',
     'id_number': 'R556677(8)', 'address': 'P.O. Box 4321, Central Post Office, Hong Kong',
     'occupation': 'Accountant'},
]
CORP2 = [
    {'date_appointed': '2023-06-01', 'name_english': 'PAUL TANG & CO. LIMITED', 'company_number_ref': '2084309',
     'date_of_incorporation': '2021-11-30', 'place_incorporated': 'Hong Kong',
     'registered_office': 'Room 1234, 12/F, Tower A, 1 Harbour Road, Wan Chai, Hong Kong'},
    {'date_appointed': '2024-02-15', 'name_english': 'ABC HOLDINGS LIMITED', 'company_number_ref': '7654321',
     'date_of_incorporation': '2019-05-20', 'place_incorporated': 'British Virgin Islands',
     'registered_office': 'P.O. Box 123, Road Town, Tortola, British Virgin Islands'},
]

entries = {}
with zipfile.ZipFile(SRC, 'r') as zf:
    for name in zf.namelist():
        entries[name] = zf.read(name)

variants = [
    ('v_5n_2c', NAT5, CORP2),
    ('v_1n_0c', NAT5[:1], []),
    ('v_0n_0c', [], []),
]
results = {}
for tag, nat, corp in variants:
    p = os.path.join(OUT, f'{tag}.xlsx')
    results[tag] = generate(entries, CO_NAME, CO_NUMBER, nat, corp, p)
    print(f'{tag}: generated {p} (last1={results[tag][0]}, last2={results[tag][1]})')

# ═══════ 校验：Excel COM 打开 + openpyxl ═══════
import openpyxl
for tag, _, _ in variants:
    p = os.path.join(OUT, f'{tag}.xlsx')
    wb = openpyxl.load_workbook(p)
    ws1 = wb['individual Director']; ws2 = wb['Corporate Director']
    print(f'\n=== {tag} openpyxl ===')
    print(f'  sheet1 D1={ws1["D1"].value!r} D2={ws1["D2"].value!r} dim={ws1.calculate_dimension()}')
    print(f'  sheet2 D1={ws2["D1"].value!r} D2={ws2["D2"].value!r} dim={ws2.calculate_dimension()}')
    # spot check first slot
    print(f'  sheet1 A6={ws1["A6"].value!r} B6={ws1["B6"].value!r} K6={ws1["K6"].value!r}')
    print(f'  sheet2 A6={ws2["A6"].value!r} B6={ws2["B6"].value!r} K6={ws2["K6"].value!r}')
    wb.close()

print('\n=== Excel COM 打开（修复提示会弹窗/异常）===')
excel = win32.DispatchEx('Excel.Application')
try:
    excel.DisplayAlerts = False
    for tag, nat, corp in variants:
        p = os.path.abspath(os.path.join(OUT, f'{tag}.xlsx'))
        wb = excel.Workbooks.Open(p, ReadOnly=True)
        print(f'  {tag}: OPEN OK — sheets={[wb.Sheets(i).Name for i in range(1, wb.Sheets.Count + 1)]}')
        # 打印导出 PDF 检查版式
        pdf = p.replace('.xlsx', '.pdf')
        wb.ExportAsFixedFormat(0, pdf)
        print(f'    → print-exported {os.path.basename(pdf)}')
        wb.Close(False)
finally:
    excel.Quit()
print('\nDONE')
