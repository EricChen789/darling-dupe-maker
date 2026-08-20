# -*- coding: utf-8 -*-
# NN3 生产 API 验证（2026-08-20）— 只读，不写任何表。
# 部署信号 = 响应含 filename 前缀 NN3_（旧孤儿端点为不同形状）
# 场景断言全部 pymupdf 逐 widget 值断言（DOM 准绳）；渲染关键页供千问 VL 旁证。
# 2026-08-20 加固：CF HKG 边缘约 30–50% 请求 1102（连 companies GET 也抽风，NAR1 同中招）
#   → gen() 重试 12 次递增退避；断言对未生成 PDF 的场景 SKIP 不崩溃；场景间 sleep 15s。
import sys, io, os, json, re, time, base64
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
from pathlib import Path
import requests
import fitz

BASE = 'https://secretary-system-9cl.pages.dev'
JWT = Path('_verify_output/_qf_prod_jwt.txt').read_text().strip()
H = {'Authorization': f'Bearer {JWT}', 'Content-Type': 'application/json'}
OUT = Path('_verify_output/_nn3_prod_out')
OUT.mkdir(exist_ok=True)

P = F = S = 0
def chk(name, cond, detail=''):
    global P, F
    if cond: print('  PASS  ' + name); P += 1
    else:    print('  FAIL  %s  %s' % (name, detail)); F += 1

def skip(name, why=''):
    global S
    print('  SKIP  %s  %s' % (name, why)); S += 1

def wval(page, prefix):
    vals = [w.field_value for w in page.widgets() if w.field_name.startswith(prefix)]
    return vals[0] if vals else None

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

def is_1102(r):
    return r.status_code == 503 and '1102' in r.text[:4000]

def gen(name, body, auth=True, retries=12):
    hh = H if auth else {'Content-Type': 'application/json'}
    r = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.post(BASE + '/api/generate-nn3-pdf', json=body, headers=hh, timeout=120)
        except Exception as e:
            print('  request exc %s, retry %d/%d...' % (e, attempt, retries))
            time.sleep(10); continue
        if not is_1102(r):
            break
        backoff = min(8 + attempt * 3, 24)
        print('  503/1102 (CF edge flake), retry %d/%d in %ds...' % (attempt, retries, backoff))
        time.sleep(backoff)
    j = None
    try: j = r.json()
    except Exception: j = {'raw': r.text[:100]}
    if r.status_code == 200 and j.get('pdf'):
        (OUT / f'{name}.pdf').write_bytes(base64.b64decode(j['pdf']))
    return r.status_code, j

def opendoc(name):
    fp = OUT / f'{name}.pdf'
    if not fp.exists():
        skip(f'{name}: PDF 未生成（503 未恢复）')
        return None
    try:
        return fitz.open(str(fp))
    except Exception as e:
        skip(f'{name}: PDF 打开失败 {e}')
        return None

# ═══ 0. 轮询部署上线（信号：filename 前缀 NN3_）═══
# RERUN_MISSING=1 → 部署已 LIVE，跳过轮询，只补生成缺失场景（已保存的 PDF 直接重新断言）
RERUN = os.environ.get('RERUN_MISSING') == '1'
live = False
if not RERUN:
    print('polling deploy (generate-nn3-pdf)...')
    probe = {'brNumber': 'F0012345', 'companyNameEnglish': 'PROBE LTD', 'returnDate': '2026-06-01',
             'registrationDate': '2021-06-01', 'directors': [], 'secretaries': [], 'authorizedReps': []}
    for attempt in range(1, 25):
        st, j = gen('probe', probe)
        if st == 200 and str(j.get('filename', '')).startswith('NN3_'):
            print('  LIVE at attempt %d' % attempt)
            live = True
            break
        print('  attempt %d: st %d keys %s' % (attempt, st, list(j.keys())[:6]))
        time.sleep(15)
    if not live:
        print('DEPLOY DID NOT GO LIVE'); sys.exit(1)
else:
    live = True
    print('RERUN_MISSING mode: deploy already live, backfill missing scenarios only')

# ═══ 1. 场景数据（沿用本地 harness 已验证的 payload）═══
BASE_P = {
  'brNumber': 'F0012345',
  'companyNameEnglish': 'APEX GLOBAL TRADING LIMITED',
  'companyNameChinese': '頂峰環球貿易有限公司',
  'returnDate': '2026-06-01',
  'registrationDate': '2021-06-01',
  'placeOfIncorporation': 'British Virgin Islands',
  'principalPlaceOfBusiness': {'flat': 'Flat 7', 'building': 'Wing On Centre', 'street': '111 Connaught Road Central', 'district': 'Hong Kong', 'region': 'Hong Kong'},
  'email': 'info@apex.com',
  'phone': '2521 3888',
  'officeInPlaceOfIncorporation': {'flat': 'Room 1', 'building': 'BVI House', 'street': 'Main Street', 'districtCityProvince': 'Road Town', 'country': 'British Virgin Islands'},
  'emailInPlaceOfIncorporation': 'bvi@apex.com',
  'presenter': {'name': 'Twinsail Consultants Limited', 'address': 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong', 'phone': '+852 2521 3888', 'fax': '+852 2521 3999', 'email': 'info@twinsail.com', 'reference': 'TS-2026-001'},
}
NAT_DIR1 = {'identity': 'natural', 'nameEnglish': 'Chan Tai Man, David', 'nameChinese': '陳大文', 'email': 'david@x.com', 'address': 'Flat 1, Block A, Main Street, Central, Hong Kong', 'idNumber': 'A123456(7)'}
NAT_DIR2 = {'identity': 'natural', 'nameEnglish': 'Wong Siu Mei', 'nameChinese': '黃小美', 'address': 'Flat 2, Block B, Queens Road, Wan Chai, Hong Kong', 'idNumber': 'B234567(8)'}
NAT_DIR3 = {'identity': 'natural', 'nameEnglish': 'Lee Ka Ho', 'nameChinese': '李嘉豪', 'address': 'Flat 3, Block C, Nathan Road, Mong Kok, Hong Kong', 'idNumber': 'C345678(9)'}
ALT_DIR  = {'identity': 'natural', 'nameEnglish': 'Ng Man Fai', 'nameChinese': '吳文輝', 'isAlternate': True, 'alternateTo': 'Chan Tai Man, David', 'address': 'Flat 9, Block D, Tai Po Road, Tai Po, Hong Kong'}
CORP_DIR1 = {'identity': 'corporate', 'nameEnglish': 'GLOBAL HOLDINGS LIMITED', 'nameChinese': '環球控股有限公司', 'brNumber': 'BR1234567', 'address': 'Room 1, Tower A, Harbour Road, Wan Chai, Hong Kong', 'email': 'corp@x.com'}
CORP_DIR2 = {'identity': 'corporate', 'nameEnglish': 'SINO INVEST LIMITED', 'nameChinese': '華投有限公司', 'brNumber': 'BR7654321', 'address': 'Room 2, Tower B, Harbour Road, Wan Chai, Hong Kong'}
NAT_SEC1 = {'identity': 'natural', 'nameEnglish': 'Lam Mei Ling', 'nameChinese': '林美玲', 'email': 'lam@x.com', 'address': 'Flat 5, Block E, Electric Road, North Point, Hong Kong', 'idNumber': 'D456789(0)'}
CORP_SEC1 = {'identity': 'corporate', 'nameEnglish': 'TWINSAIL CONSULTANTS LIMITED', 'nameChinese': '雙帆顧問有限公司', 'brNumber': 'BR5566778', 'address': 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong', 'email': 'sec@twinsail.com'}
NAT_REP1 = {'identity': 'natural', 'nameEnglish': 'Cheung Kwok Wing', 'nameChinese': '張國榮', 'address': 'Flat 8, Block G, Lockhart Road, Wan Chai, Hong Kong', 'idNumber': 'E567890(1)', 'email': 'rep@x.com'}
NAT_REP2 = {'identity': 'natural', 'nameEnglish': 'Ip Man', 'nameChinese': '葉問', 'address': 'Flat 9, Block H, Hennessy Road, Wan Chai, Hong Kong'}
CORP_REP1 = {'identity': 'corporate', 'nameEnglish': 'LEGAL ADVISORS LLP', 'nameChinese': '法律顧問行', 'isLawFirm': True, 'address': 'Room 10, Tower D, Queensway, Central, Hong Kong', 'email': 'law@x.com'}
SIGNER = {'name': 'Chan Tai Man, David', 'capacity': 'director'}
SC = {'shareCapital': {'authorizedCurrency': 'HKD', 'authorizedNominal': '100,000', 'issuedCurrency': 'HKD', 'issuedNominal': '50,000'}, 'mortgageAmount': '20,000'}
ACC_A = {'accounts': {'mode': 'delivered', 'periodFrom': '2025-06-02', 'periodTo': '2026-06-01'}}

scenarios = [
    ('s01_basic',       {**BASE_P, 'authorizedReps': [NAT_REP1], 'secretaries': [NAT_SEC1], 'directors': [NAT_DIR1], **ACC_A, **SC, 'signer': SIGNER}, 7),
    ('s02_dir2_p6',     {**BASE_P, 'authorizedReps': [NAT_REP1], 'secretaries': [NAT_SEC1], 'directors': [NAT_DIR1, NAT_DIR2], **ACC_A, **SC, 'signer': SIGNER}, 8),
    ('s03_rep3_sheetA', {**BASE_P, 'authorizedReps': [NAT_REP1, NAT_REP2, CORP_REP1], 'secretaries': [NAT_SEC1], 'directors': [NAT_DIR1], **ACC_A, **SC, 'signer': SIGNER}, 8),
    ('s04_sec_corp_sheetB', {**BASE_P, 'authorizedReps': [NAT_REP1], 'secretaries': [NAT_SEC1, CORP_SEC1, {'identity': 'natural', 'nameEnglish': 'Ho Ka Wai', 'nameChinese': '何家慧', 'address': 'Flat 6, Block F, Java Road, North Point, Hong Kong'}], 'directors': [NAT_DIR1], **ACC_A, **SC, 'signer': SIGNER}, 8),
    ('s05_corpdir2_sheetD', {**BASE_P, 'authorizedReps': [NAT_REP1], 'secretaries': [NAT_SEC1], 'directors': [NAT_DIR1, NAT_DIR2, CORP_DIR1, CORP_DIR2], **ACC_A, **SC, 'signer': SIGNER}, 9),
    ('s06_alt_dir',     {**BASE_P, 'authorizedReps': [NAT_REP1], 'secretaries': [NAT_SEC1], 'directors': [NAT_DIR1, ALT_DIR], **ACC_A, **SC, 'signer': SIGNER}, 8),
    ('s07_accounts_b',  {**BASE_P, 'authorizedReps': [NAT_REP1], 'secretaries': [NAT_SEC1], 'directors': [NAT_DIR1], 'accounts': {'mode': 'notDelivered', 'notDeliveredReason': 2}, **SC, 'signer': SIGNER}, 7),
    ('s08_signer_sec',  {**BASE_P, 'authorizedReps': [NAT_REP1], 'secretaries': [NAT_SEC1], 'directors': [NAT_DIR1], **ACC_A, **SC, 'signer': {'name': 'Lam Mei Ling', 'capacity': 'secretary'}}, 7),
    ('s09_cjk',         {**BASE_P, 'authorizedReps': [NAT_REP1], 'secretaries': [NAT_SEC1], 'directors': [NAT_DIR1], **ACC_A, **SC, 'signer': {'name': '陳大文', 'capacity': 'director'}}, 7),
    ('s10_compute_returndate', {**BASE_P, 'returnDate': None, 'registrationDate': '2021-12-31', 'authorizedReps': [NAT_REP1], 'secretaries': [NAT_SEC1], 'directors': [NAT_DIR1], **ACC_A, **SC, 'signer': SIGNER}, 7),
]

print('\n=== 1. 10 场景生成 ===')
for name, payload, pages in scenarios:
    if RERUN and (OUT / f'{name}.pdf').exists():
        print(f'  SKIP {name}: 已有 PDF，跳过 API')
        continue
    st, j = gen(name, payload)
    chk(f'{name}: status 200', st == 200, f'got {st} {json.dumps(j)[:120]}')
    chk(f'{name}: filename NN3_F0012345.pdf', st == 200 and j.get('filename') == 'NN3_F0012345.pdf', str(j.get('filename')))
    if st == 200:
        doc = opendoc(name)
        if doc:
            chk(f'{name}: 頁數 = {pages}', doc.page_count == pages, f'got {doc.page_count}')
            notes = [pi + 1 for pi in range(doc.page_count) if '填表須知' in doc[pi].get_text()]
            chk(f'{name}: 無填表須知頁', not notes, f'found at {notes}')
            bad = [pi + 1 for pi in range(doc.page_count) if '{{' in doc[pi].get_text()]
            chk(f'{name}: 無未填充占位符', not bad, f'found at {bad}')
            doc.close()
    elif st == 503:
        skip(f'{name}: 重试后仍 503')
    time.sleep(15)  # CF edge 抽风期限速

# ═══ 2. s01 全字段断言 ═══
print('\n=== 2. s01_basic 全字段 ===')
doc = opendoc('s01_basic')
if doc:
    p1, p2, p3, p4, p5, p7, p8 = [doc[i] for i in range(7)]
    chk('P.1 BR', wval(p1, 'fill_1_P.1') == 'F0012345', wval(p1, 'fill_1_P.1'))
    chk('P.1 公司名中英', 'APEX GLOBAL TRADING LIMITED' in (wval(p1, 'fill_2_P.1') or '') and '頂峰環球貿易有限公司' in (wval(p1, 'fill_2_P.1') or ''))
    chk('P.1 申報日期 01/06/2026', (wval(p1, 'fill_3_P.1'), wval(p1, 'fill_4_P.1'), wval(p1, 'fill_5_P.1')) == ('01', '06', '2026'))
    chk('P.1 註冊日期 01/06/2021', (wval(p1, 'fill_6_P.1'), wval(p1, 'fill_7_P.1'), wval(p1, 'fill_8_P.1')) == ('01', '06', '2021'))
    chk('P.1 成立地方', wval(p1, 'fill_9_P.1') == 'British Virgin Islands')
    chk('P.1 地址 4 行', (wval(p1, 'fill_10_P.1'), wval(p1, 'fill_11_P.1'), wval(p1, 'fill_12_P.1'), wval(p1, 'fill_13_P.1')) == ('Flat 7', 'Wing On Centre', '111 Connaught Road Central', 'Hong Kong'))
    chk('P.1 提交人 6 欄', wval(p1, 'fill_16_P.1') == 'Twinsail Consultants Limited' and 'Wing On Centre' in (wval(p1, 'fill_17_P.1') or '') and wval(p1, 'fill_21_P.1') == 'TS-2026-001')
    chk('P.2 (a)(b)(c)', wval(p2, 'fill_1_P.2') == 'F0012345' and wval(p2, 'fill_2_P.2') == 'Room 1' and wval(p2, 'fill_6_P.2') == 'British Virgin Islands' and wval(p2, 'fill_12_P.2') == 'bvi@apex.com')
    chk('P.3 A 自然人代表', wval(p3, 'fill_2_P.3') == '張國榮' and wval(p3, 'fill_3_P.3') == 'Cheung' and wval(p3, 'fill_4_P.3') == 'Kwok Wing' and wval(p3, 'fill_10_P.3') == 'E567')
    chk('P.3 B 法人塊留空', wval(p3, 'cb_1_P.3') == '' and wval(p3, 'fill_13_P.3') == '')
    chk('P.4 A 自然人秘書', wval(p4, 'fill_2_P.4') == '林美玲' and wval(p4, 'fill_3_P.4') == 'Lam' and wval(p4, 'fill_15_P.4') == 'D456')
    chk('P.4 B 法人塊留空', wval(p4, 'fill_18_P.4') == '')
    chk('P.5 董事#1 勾選+姓名', wval(p5, 'cb_1_P.5') == 'On' and wval(p5, 'cb_2_P.5') == '' and wval(p5, 'fill_4_P.5') == 'Chan Tai Man' and wval(p5, 'fill_5_P.5') == 'David' and wval(p5, 'fill_16_P.5') == 'A123')
    chk('P.7 股本+按揭', wval(p7, 'fill_12_P.7') == 'HKD' and wval(p7, 'fill_13_P.7') == '100,000' and wval(p7, 'fill_15_P.7') == '50,000' and wval(p7, 'fill_16_P.7') == '20,000')
    chk('P.8 帳目 from/to', (wval(p8, 'fill_2_P.8'), wval(p8, 'fill_3_P.8'), wval(p8, 'fill_4_P.8'), wval(p8, 'fill_5_P.8'), wval(p8, 'fill_6_P.8'), wval(p8, 'fill_7_P.8')) == ('02', '06', '2025', '01', '06', '2026'))
    chk('P.8 續頁計數全空', wval(p8, 'fill_8_P.8') == '' and wval(p8, 'fill_11_P.8') == '')
    chk('P.8 簽署人+日期', wval(p8, 'fill_12_P.8') == 'Chan Tai Man, David' and wval(p8, 'fill_13_P.8') == '01/06/2026')
    dd = dropdown_map(doc, p8)
    chk('P.8 身份 tick=董事', dd.get('Dropdown1') == '1' and dd.get('Dropdown2') == '0' and dd.get('Dropdown3') == '0' and dd.get('Dropdown4') == '0', str(dd))
    doc.close()

# ═══ 3. 动态续页断言 ═══
print('\n=== 3. 动态续页 ===')
doc = opendoc('s02_dir2_p6')
if doc:
    p8, p6 = doc[7], doc[5]
    chk('s02 P.6 董事#2', wval(p6, 'fill_3_P.6') == '黃小美' and wval(p6, 'fill_4_P.6') == 'Wong' and wval(p6, 'fill_5_P.6') == 'Siu Mei', wval(p6, 'fill_4_P.6'))
    doc.close()

doc = opendoc('s03_rep3_sheetA')
if doc:
    p8, last = doc[6], doc[7]
    chk('s03 P.8 續頁A計數=1', wval(p8, 'fill_8_P.8') == '1', wval(p8, 'fill_8_P.8'))
    chk('s03 P.3 B 法人代表在 P.3', wval(doc[2], 'fill_14_P.3') == 'LEGAL ADVISORS LLP' and wval(doc[2], 'cb_1_P.3') == 'On', wval(doc[2], 'fill_14_P.3'))
    chk('s03 續頁A 頭部+BR', wval(last, 'fill_1_P') == '01' and wval(last, 'fill_2_P') == '06' and wval(last, 'fill_3_P') == '2026' and wval(last, 'fill_4_P') == 'F0012345')
    chk('s03 續頁A 自然人#2', wval(last, 'fill_5_P') == '葉問' and wval(last, 'fill_6_P') == 'Ip' and wval(last, 'fill_7_P') == 'Man')
    chk('s03 續頁A 法人塊清空', wval(last, 'fill_16_P') == '' and wval(last, 'cb_1_P') == '')
    doc.close()

doc = opendoc('s04_sec_corp_sheetB')
if doc:
    p8, last = doc[6], doc[7]
    chk('s04 P.8 續頁B計數=1', wval(p8, 'fill_9_P.8') == '1', wval(p8, 'fill_9_P.8'))
    chk('s04 P.4 B 法人秘書在 P.4', wval(doc[3], 'fill_19_P.4') == 'TWINSAIL CONSULTANTS LIMITED' and wval(doc[3], 'fill_26_P.4') == 'BR5566778', wval(doc[3], 'fill_19_P.4'))
    chk('s04 續頁B 自然人#2', wval(last, 'fill_5_P') == '何家慧' and wval(last, 'fill_6_P') == 'Ho')
    chk('s04 續頁B 法人塊清空', wval(last, 'fill_21_P') == '')
    doc.close()

doc = opendoc('s05_corpdir2_sheetD')
if doc:
    p8, last = doc[7], doc[8]   # 9 页 = P.1-8 + 1 张续页D（2 法人董事 = P.7 留 1 + ceil(1/2)=1 页）
    chk('s05 P.8 續頁D計數=1', wval(p8, 'fill_11_P.8') == '1', wval(p8, 'fill_11_P.8'))
    chk('s05 P.7 法人董事#1', wval(doc[6], 'fill_3_P.7') == '環球控股有限公司' and wval(doc[6], 'cb_1_P.7') == 'On', wval(doc[6], 'fill_3_P.7'))
    chk('s05 續頁D 槽1', wval(last, 'fill_6_P') == '華投有限公司' and wval(last, 'fill_7_P') == 'SINO INVEST LIMITED' and wval(last, 'fill_14_P') == 'BR7654321')
    doc.close()

doc = opendoc('s06_alt_dir')
if doc:
    p6 = doc[5]
    chk('s06 P.6 候補董事 cb_2+代替', wval(p6, 'cb_2_P.6') == 'On' and wval(p6, 'cb_1_P.6') == '' and wval(p6, 'fill_2_P.6') == 'Chan Tai Man, David' and wval(p6, 'fill_4_P.6') == 'Ng', (wval(p6, 'cb_2_P.6'), wval(p6, 'fill_2_P.6'), wval(p6, 'fill_4_P.6')))
    doc.close()

doc = opendoc('s07_accounts_b')
if doc:
    p8 = doc[6]
    chk('s07 P.8 B 未交付 cb_2 勾選', wval(p8, 'cb_2_P.8') == 'On' and wval(p8, 'cb_1_P.8') == '', (wval(p8, 'cb_1_P.8'), wval(p8, 'cb_2_P.8')))
    chk('s07 P.8 A 期間留空', wval(p8, 'fill_2_P.8') == '' and wval(p8, 'fill_7_P.8') == '')
    doc.close()

doc = opendoc('s08_signer_sec')
if doc:
    dd = dropdown_map(doc, doc[6])
    chk('s08 P.8 身份 tick=秘書', dd.get('Dropdown1') == '0' and dd.get('Dropdown2') == '1' and dd.get('Dropdown3') == '0' and dd.get('Dropdown4') == '0', str(dd))
    doc.close()

doc = opendoc('s10_compute_returndate')
if doc:
    p1 = doc[0]
    chk('s10 回算申報日期 31/12/2025（2026 周年日未到）', (wval(p1, 'fill_3_P.1'), wval(p1, 'fill_4_P.1'), wval(p1, 'fill_5_P.1')) == ('31', '12', '2025'), (wval(p1, 'fill_3_P.1'), wval(p1, 'fill_4_P.1'), wval(p1, 'fill_5_P.1')))
    doc.close()

# ═══ 4. 错误路径 ═══
print('\n=== 4. 错误路径 ===')
if RERUN:
    print('  RERUN_MISSING: 跳过错误路径（本轮已验证）')
else:
    for ename, ebody, eauth, eexp in [
        ('e1', {**BASE_P, 'returnDate': None, 'registrationDate': None}, True, 400),
        ('e2', {**BASE_P, 'returnDate': '01-06-2026'}, True, 400),
        ('e3', {**BASE_P, 'registrationDate': '2021/06/01'}, True, 400),
        ('e4', {**BASE_P, 'directors': 'Chan'}, True, 400),
        ('e5', {**BASE_P, 'accounts': {'mode': 'notDelivered', 'notDeliveredReason': 9}}, True, 400),
        ('e6', {**BASE_P}, False, 401),
    ]:
        st, j = gen(ename, ebody, auth=eauth)
        if st == 503:
            skip(f'{ename}: 重试后仍 503（CF flake，无法判定）')
        else:
            chk(f'{ename} → {eexp}', st == eexp, f'got {st}')
        time.sleep(8)

# ═══ 5. 渲染关键页供千问 ═══
print('\n=== 5. 渲染 ===')
render = [
    ('s01_basic', 0, 'p1'), ('s01_basic', 6, 'p8'),
    ('s02_dir2_p6', 5, 'p6'), ('s03_rep3_sheetA', 7, 'sheetA'),
    ('s05_corpdir2_sheetD', 8, 'sheetD'), ('s06_alt_dir', 5, 'alt_p6'),
    ('s07_accounts_b', 6, 'acc_b_p8'), ('s09_cjk', 0, 'cjk_p1'), ('s09_cjk', 6, 'cjk_p8'),
]
n = 0
for name, pno, outname in render:
    doc = opendoc(name)
    if doc:
        pix = doc[pno].get_pixmap(dpi=150)
        pix.save(str(OUT / f'{outname}.png'))
        doc.close()
        n += 1
print('rendered %d/%d PNGs' % (n, len(render)))

print('\nTOTAL: %d pass / %d fail / %d skip' % (P, F, S))
sys.exit(1 if F else 0)
