# -*- coding: utf-8 -*-
"""生产验证：買賣票據日期不預填（2026-08-20）。
1. 轮询部署上线：选一条有日期的生产交易生成 BSN，旧版 RTF 含 "Dated 10/06/2026"，新版 Dated 后直接 \par
2. 断言：BSN 无日期、转让文书无占位符、股票證書 SIGN_DATE 仍填
纯只读（transactionId 路径），不建不删任何数据。"""
import sys, io, json, time, base64, re
from pathlib import Path
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
import requests

BASE = 'https://secretary-system-9cl.pages.dev'
JWT = Path('_verify_output/_qf_prod_jwt.txt').read_text().strip()
COMPANY = '25104de2-583b-427f-a307-805a081981dc'
TX = '6427118d-a969-4710-9053-4dda5af198bc'   # Lam→Timothy 1000@1.00，日期 10/06/2026
H = {'Authorization': f'Bearer {JWT}', 'Content-Type': 'application/json'}

P = F = 0
def chk(name, cond, detail=''):
    global P, F
    if cond: print('  PASS  ' + name); P += 1
    else:    print('  FAIL  %s  %s' % (name, detail)); F += 1

def compact(s): return re.sub(r'\s+', '', s)

def gen(doc_type):
    r = requests.post(BASE + '/api/generate-share-transfer-rtf',
                      json={'companyId': COMPANY, 'transactionId': TX, 'documentType': doc_type},
                      headers=H, timeout=180)
    if r.status_code != 200:
        print('  gen %s -> %d %s' % (doc_type, r.status_code, r.text[:200])); return None
    j = r.json()
    if not j.get('rtf'):
        print('  gen %s -> no rtf: %s' % (doc_type, json.dumps(j)[:200])); return None
    return base64.b64decode(j['rtf']).decode('utf-8', errors='replace')

# ── 0. 前置：确认目标交易日期 ──
rows = requests.get(BASE + '/api/share_transactions?company_id=' + COMPANY + '&limit=200',
                    headers=H, timeout=60).json()
rows = rows if isinstance(rows, list) else (rows.get('data') or [])
tgt = next((x for x in rows if x.get('id') == TX), None)
print('目标交易:', json.dumps({k: tgt.get(k) for k in ('transaction_date','from_name','to_name')}, ensure_ascii=False) if tgt else 'NOT FOUND')
TX_DATE = (tgt or {}).get('transaction_date') or ''
chk('目标交易存在且有日期', bool(tgt) and bool(TX_DATE))
if not tgt:
    sys.exit(1)
exp_ddmm = None
m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', TX_DATE)
if m:
    exp_ddmm = '%s/%s/%s' % (m.group(3), m.group(2), m.group(1))
elif re.match(r'^\d{2}/\d{2}/\d{4}$', TX_DATE):
    exp_ddmm = TX_DATE
print('  expected DD/MM/YYYY:', exp_ddmm)

# ── 1. 轮询部署：BSN 的 "Dated" 后不再有日期 ──
print('polling deploy (generate-share-transfer-rtf)...')
live = False
bsn = None
for attempt in range(1, 49):
    try:
        b = gen('bought_sold_note')
        if b is None:
            print('  attempt %d: endpoint error' % attempt)
        else:
            c = compact(b)
            old_marker = ('Dated' + (exp_ddmm or '')).replace('/', '')
            if 'Dated\\par' in c:
                print('  LIVE at attempt %d' % attempt); live = True; bsn = b
                break
            print('  attempt %d: still old (Dated %s present)' % (attempt, exp_ddmm))
    except Exception as e:
        print('  attempt %d: %s' % (attempt, str(e)[:100]))
    time.sleep(10)
if not live:
    print('DEPLOY DID NOT GO LIVE'); sys.exit(1)

# ── 2. BSN 断言 ──
print('\n=== 2. bought_sold_note 断言 ===')
c = compact(bsn)
chk('无 {{TX_DATE}} 占位符残留', '{{TX_DATE}}' not in bsn)
chk('全文无未填充占位符 {{', '{{' not in bsn)
chk('两处 Dated 均留空（Dated 后直接 \\par）', c.count('Dated\\par') == 2, 'count=%d' % c.count('Dated\\par'))
if exp_ddmm:
    chk('无预填日期 %s' % exp_ddmm, exp_ddmm not in bsn)
chk('卖方姓名已填', 'Lam' in bsn)
chk('买方姓名已填', 'Timothy' in bsn)

# ── 3. instrument_of_transfer：模板本无日期占位符 ──
print('\n=== 3. instrument_of_transfer 断言 ===')
iot = gen('instrument_of_transfer')
if iot:
    chk('无未填充占位符', '{{' not in iot)
    chk('代价已填', 'HK$' in compact(iot))

# ── 4. share_certificate：SIGN_DATE 仍填 ──
print('\n=== 4. share_certificate 断言 ===')
cert = gen('share_certificate')
if cert:
    chk('无未填充占位符', '{{' not in cert)
    if exp_ddmm:
        chk('SIGN_DATE 仍填 %s' % exp_ddmm, exp_ddmm in cert)

print('\nTOTAL: %d pass / %d fail' % (P, F))
sys.exit(1 if F else 0)
