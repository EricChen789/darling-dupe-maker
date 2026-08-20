# -*- coding: utf-8 -*-
# NN3 本地輸出 pymupdf 逐 widget 值斷言 + 渲染 PNG（供千問 VL 旁證）
# 值斷言是準繩；渲染 PNG 只給千問做旁證（千問視覺計數不可信）。
import sys, io, os, re, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
import fitz

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_nn3_out')
PNG = os.path.join(OUT, 'pngs')
os.makedirs(PNG, exist_ok=True)

exp = json.load(open(os.path.join(OUT, 'expectations.json'), encoding='utf-8'))

pass_n = 0
fail_n = 0
def chk(name, cond, detail=''):
    global pass_n, fail_n
    if cond:
        print(f'  PASS  {name}'); pass_n += 1
    else:
        print(f'  FAIL  {name}  {detail}'); fail_n += 1

def wval(page, prefix):
    vals = [w.field_value for w in page.widgets() if w.field_name.startswith(prefix)]
    return vals[0] if vals else None

def wda(page, prefix):
    """CJK 欄位的 /DA 是否為 PMingLiU"""
    for w in page.widgets():
        if w.field_name.startswith(prefix):
            raw = page.parent.xref_object(w.xref, compressed=True)
            return raw
    return ''

def dropdown_map(doc, page):
    m = {}
    for w in page.widgets():
        if w.field_name.startswith('Dropdown'):
            raw = doc.xref_object(w.xref, compressed=True)
            pm = re.search(r'/Parent (\d+) 0 R', raw)
            if pm:
                praw = doc.xref_object(int(pm.group(1)), compressed=True)
                im = re.search(r'/I\s*\[\s*(\d+)', praw)
                m[w.field_name] = im.group(1) if im else None
    return m

def load(name):
    return fitz.open(os.path.join(OUT, f'{name}.pdf'))

# ═══ 全局檢查 ═══
for name, meta in exp.items():
    doc = load(name)
    pages = doc.page_count
    chk(f'{name}: 頁數 = {meta["pages"]}', pages == meta['pages'], f'got {pages}')
    # 填表須知頁已移除
    notes = []
    for pi in range(pages):
        if '填表須知' in doc[pi].get_text():
            notes.append(pi + 1)
    chk(f'{name}: 無填表須知頁', not notes, f'found at pages {notes}')
    # 無未填充占位符
    bad = []
    for pi in range(pages):
        if '{{' in doc[pi].get_text():
            bad.append(pi + 1)
    chk(f'{name}: 無未填充占位符', not bad, f'found at {bad}')
    doc.close()

# ═══ s01_basic：基礎全字段 ═══
doc = load('s01_basic')
p1, p2, p3, p4, p5, p7, p8 = [doc[i] for i in range(7)]
chk('s01 P.1 BR', wval(p1, 'fill_1_P.1') == 'F0012345', wval(p1, 'fill_1_P.1'))
chk('s01 P.1 公司名含 EN', 'APEX GLOBAL TRADING LIMITED' in (wval(p1, 'fill_2_P.1') or ''))
chk('s01 P.1 公司名含 CN', '頂峰環球貿易有限公司' in (wval(p1, 'fill_2_P.1') or ''))
chk('s01 P.1 fill_2 DA=PMingLiU', '/PMingLiU' in wda(p1, 'fill_2_P.1'))
chk('s01 P.1 申報日期 D/M/Y', (wval(p1, 'fill_3_P.1'), wval(p1, 'fill_4_P.1'), wval(p1, 'fill_5_P.1')) == ('01', '06', '2026'))
chk('s01 P.1 註冊日期 D/M/Y', (wval(p1, 'fill_6_P.1'), wval(p1, 'fill_7_P.1'), wval(p1, 'fill_8_P.1')) == ('01', '06', '2021'))
chk('s01 P.1 成立地方', wval(p1, 'fill_9_P.1') == 'British Virgin Islands')
chk('s01 P.1 地址 4 行', (wval(p1, 'fill_10_P.1'), wval(p1, 'fill_11_P.1'), wval(p1, 'fill_12_P.1'), wval(p1, 'fill_13_P.1')) == ('Flat 7', 'Wing On Centre', '111 Connaught Road Central', 'Hong Kong'))
chk('s01 P.1 電郵電話', wval(p1, 'fill_14_P.1') == 'info@apex.com' and wval(p1, 'fill_15_P.1') == '2521 3888')
chk('s01 P.1 提交人', wval(p1, 'fill_16_P.1') == 'Twinsail Consultants Limited' and 'Wing On Centre' in (wval(p1, 'fill_17_P.1') or '') and wval(p1, 'fill_21_P.1') == 'TS-2026-001')
chk('s01 P.2 (a)(b)(c)', wval(p2, 'fill_1_P.2') == 'F0012345' and wval(p2, 'fill_2_P.2') == 'Room 1' and wval(p2, 'fill_6_P.2') == 'British Virgin Islands' and wval(p2, 'fill_7_P.2') == '' and wval(p2, 'fill_12_P.2') == 'bvi@apex.com')
chk('s01 P.3 A 自然人', wval(p3, 'fill_2_P.3') == '張國榮' and wval(p3, 'fill_3_P.3') == 'Cheung' and wval(p3, 'fill_4_P.3') == 'Kwok Wing' and wval(p3, 'fill_8_P.3') == 'Wan Chai' and wval(p3, 'fill_9_P.3') == 'rep@x.com' and wval(p3, 'fill_10_P.3') == 'E567')
chk('s01 P.3 B 法人塊留空', wval(p3, 'cb_1_P.3') == '' and wval(p3, 'cb_2_P.3') == '' and wval(p3, 'fill_13_P.3') == '' and wval(p3, 'fill_19_P.3') == '')
chk('s01 P.4 A 自然人秘書', wval(p4, 'fill_2_P.4') == '林美玲' and wval(p4, 'fill_3_P.4') == 'Lam' and wval(p4, 'fill_13_P.4') == 'Hong Kong' and wval(p4, 'fill_15_P.4') == 'D456')
chk('s01 P.4 B 法人塊留空', wval(p4, 'fill_18_P.4') == '' and wval(p4, 'fill_26_P.4') == '')
chk('s01 P.5 董事 #1', wval(p5, 'cb_1_P.5') == 'On' and wval(p5, 'cb_2_P.5') == '' and wval(p5, 'fill_3_P.5') == '陳大文' and wval(p5, 'fill_4_P.5') == 'Chan Tai Man' and wval(p5, 'fill_5_P.5') == 'David' and wval(p5, 'fill_14_P.5') == 'Hong Kong' and wval(p5, 'fill_16_P.5') == 'A123')
chk('s01 P.7 法人董事留白 + BR', wval(p7, 'fill_1_P.7') == 'F0012345' and wval(p7, 'fill_3_P.7') == '' and wval(p7, 'fill_4_P.7') == '' and wval(p7, 'cb_1_P.7') == '')
chk('s01 P.7 股本+按揭', wval(p7, 'fill_12_P.7') == 'HKD' and wval(p7, 'fill_13_P.7') == '100,000' and wval(p7, 'fill_14_P.7') == 'HKD' and wval(p7, 'fill_15_P.7') == '50,000' and wval(p7, 'fill_16_P.7') == '20,000')
chk('s01 P.8 帳目 delivered from/to', (wval(p8, 'fill_2_P.8'), wval(p8, 'fill_3_P.8'), wval(p8, 'fill_4_P.8'), wval(p8, 'fill_5_P.8'), wval(p8, 'fill_6_P.8'), wval(p8, 'fill_7_P.8')) == ('02', '06', '2025', '01', '06', '2026'))
chk('s01 P.8 續頁計數全空', wval(p8, 'fill_8_P.8') == '' and wval(p8, 'fill_9_P.8') == '' and wval(p8, 'fill_10_P.8') == '' and wval(p8, 'fill_11_P.8') == '')
chk('s01 P.8 簽署人', wval(p8, 'fill_12_P.8') == 'Chan Tai Man, David' and wval(p8, 'fill_13_P.8') == '01/06/2026')
dd = dropdown_map(doc, p8)
chk('s01 P.8 身份 tick=董事', dd.get('Dropdown1') == '1' and dd.get('Dropdown2') == '0' and dd.get('Dropdown3') == '0' and dd.get('Dropdown4') == '0', str(dd))
doc.close()

# ═══ s02：法人授權代表（律師行 cb_1）═══
doc = load('s02_rep_corp')
p3 = doc[2]
chk('s02 P.3 B 律師行', wval(p3, 'cb_1_P.3') == 'On' and wval(p3, 'cb_2_P.3') == '' and wval(p3, 'fill_13_P.3') == '法律顧問行' and wval(p3, 'fill_14_P.3') == 'LEGAL ADVISORS LLP' and wval(p3, 'fill_15_P.3') == 'Room 10' and wval(p3, 'fill_19_P.3') == 'law@x.com')
chk('s02 P.3 A 仍在', wval(p3, 'fill_2_P.3') == '張國榮')
doc.close()

# ═══ s03：3 授權代表 → 續頁A ═══
# 續頁 widget 改名格式：resolvedName（parent /T 無頁號）_suffix，如 fill_5_P_nn3A_nat_1
# → 頁級斷言用裸前綴 fill_N_P（頁內無歧義）
doc = load('s03_rep_3')
p8, last = doc[6], doc[7]
chk('s03 P.8 續頁A計數=1', wval(p8, 'fill_8_P.8') == '1', wval(p8, 'fill_8_P.8'))
chk('s03 續頁A 頭部', wval(last, 'fill_1_P') == '01' and wval(last, 'fill_2_P') == '06' and wval(last, 'fill_3_P') == '2026' and wval(last, 'fill_4_P') == 'F0012345')
chk('s03 續頁A 自然人#2', wval(last, 'fill_5_P') == '葉問' and wval(last, 'fill_6_P') == 'Ip' and wval(last, 'fill_7_P') == 'Man' and wval(last, 'fill_11_P') == 'Wan Chai')
chk('s03 續頁A 法人塊已清空', wval(last, 'fill_16_P') == '' and wval(last, 'fill_22_P') == '' and wval(last, 'cb_1_P') == '')
doc.close()

# ═══ s04：3 秘書 → 續頁B ═══
doc = load('s04_sec_3')
p8, last = doc[6], doc[7]
chk('s04 P.8 續頁B計數=1', wval(p8, 'fill_9_P.8') == '1', wval(p8, 'fill_9_P.8'))
chk('s04 續頁B 自然人#2', wval(last, 'fill_1_P') == '01' and wval(last, 'fill_5_P') == '何家慧' and wval(last, 'fill_6_P') == 'Ho' and wval(last, 'fill_16_P') == 'Hong Kong')
chk('s04 續頁B 法人塊已清空', wval(last, 'fill_21_P') == '' and wval(last, 'fill_29_P') == '')
doc.close()

# ═══ s05/s06：0/1 自然人董事 → P.6 刪除 ═══
doc = load('s05_dirs_0')
chk('s05 頁數7（P.6已刪）', doc.page_count == 7)
chk('s05 P.5 留白', wval(doc[4], 'fill_3_P.5') == '' and wval(doc[4], 'cb_1_P.5') == '')
chk('s05 第6頁是P.7', wval(doc[5], 'fill_1_P.7') == 'F0012345')
doc.close()
doc = load('s06_dirs_1')
chk('s06 P.5 有董事', wval(doc[4], 'fill_3_P.5') == '陳大文')
doc.close()

# ═══ s07：2 自然人董事 → P.6 保留 ═══
# parseEnglishName 無逗號 → 全串第一詞=姓（NAR1 慣例）
doc = load('s07_dirs_2')
p6 = doc[5]
chk('s07 頁數8（P.6保留）', doc.page_count == 8)
chk('s07 P.6 董事#2', wval(p6, 'fill_1_P.6') == 'F0012345' and wval(p6, 'fill_3_P.6') == '黃小美' and wval(p6, 'fill_4_P.6') == 'Wong' and wval(p6, 'fill_5_P.6') == 'Siu Mei' and wval(p6, 'cb_1_P.6') == 'On' and wval(p6, 'cb_2_P.6') == '')
doc.close()

# ═══ s08：3 自然人董事 → 續頁C ═══
doc = load('s08_dirs_3')
p8, last = doc[7], doc[8]
chk('s08 P.8 續頁C計數=1', wval(p8, 'fill_10_P.8') == '1', wval(p8, 'fill_10_P.8'))
chk('s08 續頁C 董事#3', wval(last, 'fill_1_P') == '01' and wval(last, 'fill_6_P') == '李嘉豪' and wval(last, 'fill_7_P') == 'Lee' and wval(last, 'fill_8_P') == 'Ka Ho' and wval(last, 'cb_1_P') == 'On' and wval(last, 'fill_17_P') == 'Hong Kong')
doc.close()

# ═══ s09：候補董事 ═══
doc = load('s09_alt_dir')
p6 = doc[5]
chk('s09 P.6 候補', wval(p6, 'cb_2_P.6') == 'On' and wval(p6, 'cb_1_P.6') == '' and wval(p6, 'fill_2_P.6') == 'Chan Tai Man, David' and wval(p6, 'fill_3_P.6') == '吳文輝')
doc.close()

# ═══ s10/s11：法人董事 ═══
doc = load('s10_corpdirs_0')
chk('s10 P.7 法人塊留白', wval(doc[5], 'fill_3_P.7') == '' and wval(doc[5], 'fill_4_P.7') == '')
doc.close()
doc = load('s11_corpdir_1')
p7 = doc[6]
chk('s11 P.7 法人董事', wval(p7, 'cb_1_P.7') == 'On' and wval(p7, 'fill_3_P.7') == '環球控股有限公司' and wval(p7, 'fill_4_P.7') == 'GLOBAL HOLDINGS LIMITED' and wval(p7, 'fill_9_P.7') == 'Hong Kong' and wval(p7, 'fill_11_P.7') == 'BR1234567')
doc.close()

# ═══ s12：3 法人董事 → 續頁D 雙槽 ═══
doc = load('s12_corpdir_3')
p8, last = doc[7], doc[8]
chk('s12 P.8 續頁D計數=1', wval(p8, 'fill_11_P.8') == '1', wval(p8, 'fill_11_P.8'))
chk('s12 續頁D 槽1', wval(last, 'fill_1_P') == '01' and wval(last, 'cb_1_P') == 'On' and wval(last, 'cb_2_P') == '' and wval(last, 'fill_6_P') == '華投有限公司' and wval(last, 'fill_7_P') == 'SINO INVEST LIMITED' and wval(last, 'fill_14_P') == 'BR7654321')
chk('s12 續頁D 槽2', wval(last, 'cb_3_P') == 'On' and wval(last, 'cb_4_P') == '' and wval(last, 'fill_16_P') == '巨資有限公司' and wval(last, 'fill_17_P') == 'MEGA CAPITAL LIMITED' and wval(last, 'fill_24_P') == 'BR9999999')
doc.close()

# ═══ s13/s14：帳目 ═══
doc = load('s13_accounts_a')
p8 = doc[6]
chk('s13 A 已交付 from/to', (wval(p8, 'fill_2_P.8'), wval(p8, 'fill_3_P.8'), wval(p8, 'fill_4_P.8'), wval(p8, 'fill_5_P.8'), wval(p8, 'fill_6_P.8'), wval(p8, 'fill_7_P.8')) == ('02', '06', '2025', '01', '06', '2026') and wval(p8, 'cb_1_P.8') == '' and wval(p8, 'cb_2_P.8') == '')
doc.close()
doc = load('s14_accounts_b')
p8 = doc[6]
chk('s14 B 未交付 reason2', wval(p8, 'cb_2_P.8') == 'On' and wval(p8, 'cb_1_P.8') == '' and wval(p8, 'fill_2_P.8') == '' and wval(p8, 'fill_7_P.8') == '')
doc.close()

# ═══ s15：全 CJK ═══
doc = load('s15_cjk')
chk('s15 中文公司名', '頂峰環球貿易有限公司' in (wval(doc[0], 'fill_2_P.1') or ''))
chk('s15 中文董事名', wval(doc[4], 'fill_3_P.5') == '陳大文')
chk('s15 中文簽署人名', wval(doc[6], 'fill_12_P.8') == '陳大文')
chk('s15 fill_12_P.8 DA=PMingLiU', '/PMingLiU' in wda(doc[6], 'fill_12_P.8'))
doc.close()

# ═══ s16：股本+按揭 ═══
doc = load('s16_capital')
p7 = doc[5]
chk('s16 P.7 股本', wval(p7, 'fill_12_P.7') == 'HKD' and wval(p7, 'fill_13_P.7') == '100,000' and wval(p7, 'fill_14_P.7') == 'HKD' and wval(p7, 'fill_15_P.7') == '50,000' and wval(p7, 'fill_16_P.7') == '20,000')
doc.close()

# ═══ s17：簽署人 4 身份 ═══
for name, expect in [('s17_signer_director', 'Dropdown1'), ('s17_signer_secretary', 'Dropdown2'), ('s17_signer_manager', 'Dropdown3'), ('s17_signer_rep', 'Dropdown4')]:
    doc = load(name)
    dd = dropdown_map(doc, doc[6])
    ok = all(dd.get(d) == ('1' if d == expect else '0') for d in ['Dropdown1', 'Dropdown2', 'Dropdown3', 'Dropdown4'])
    chk(f'{name} /I={expect}=1 其餘0', ok, str(dd))
    doc.close()

# ═══ s18：computeReturnDate ═══
doc = load('s18_compute_returndate')
chk('s18 默認結算日=最近周年日', (wval(doc[0], 'fill_3_P.1'), wval(doc[0], 'fill_4_P.1'), wval(doc[0], 'fill_5_P.1')) == ('01', '06', '2026'))
chk('s18 簽署日期跟隨', wval(doc[6], 'fill_13_P.8') == '01/06/2026')
doc.close()
doc = load('s18_future_anniversary')
chk('s18 未來周年日回退一年', (wval(doc[0], 'fill_3_P.1'), wval(doc[0], 'fill_4_P.1'), wval(doc[0], 'fill_5_P.1')) == ('31', '12', '2025'), str((wval(doc[0], 'fill_3_P.1'), wval(doc[0], 'fill_4_P.1'), wval(doc[0], 'fill_5_P.1'))))
doc.close()

# ═══ 渲染 PNG（供千問旁證）═══
render_list = ['s01_basic', 's03_rep_3', 's07_dirs_2', 's09_alt_dir', 's12_corpdir_3', 's14_accounts_b', 's15_cjk', 's17_signer_director']
for name in render_list:
    doc = load(name)
    for pi in range(doc.page_count):
        pix = doc[pi].get_pixmap(dpi=150)
        pix.save(os.path.join(PNG, f'{name}_p{pi+1}.png'))
    doc.close()
print(f'\n渲染 PNG → {PNG} ({len(render_list)} scenarios)')

print(f'\nTOTAL: {pass_n} pass / {fail_n} fail')
sys.exit(1 if fail_n else 0)
