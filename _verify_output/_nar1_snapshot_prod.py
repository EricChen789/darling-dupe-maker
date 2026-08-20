# -*- coding: utf-8 -*-
"""生产验证：NAR1 快照端点（2026-08-20）。
1. 轮询部署上线：修复信号 = as-of 2027-05-29 不再含 24/06 已辞的 bc1ecd5a（1750 股东）
2. API 层断言：PAUL TANG（1981-05-29 成立，有 2 董事/4 股东角色/2 交易/1 事件）
   - returnDate=2026-05-29：as-of 董事 2（含 18/06 才辞的）、股东 3（17/08 才入的剔除；
     Timothy 3000−1000=2000、Lam 1750+1000=2750 反向回放）
   - returnDate=2027-05-29：董事 1（18/06 已辞剔除）、股东 3（17/08 入的纳入、24/06 已辞的剔除）、changes 窗口含 17/08 事件
3. 错误路径 401/400/404
纯只读：快照端点不写任何表；唯一 GET 是读数据。"""
import sys, io, json, time
from pathlib import Path
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
import requests

BASE = 'https://secretary-system-9cl.pages.dev'
JWT = Path('_verify_output/_qf_prod_jwt.txt').read_text().strip()
COMPANY = '25104de2-583b-427f-a307-805a081981dc'   # PAUL TANG AND COMPANY LIMITED, 成立 1981-05-29
H = {'Authorization': f'Bearer {JWT}', 'Content-Type': 'application/json'}

P = F = 0
def chk(name, cond, detail=''):
    global P, F
    if cond: print('  PASS  ' + name); P += 1
    else:    print('  FAIL  %s  %s' % (name, detail)); F += 1

def get(path, **params):
    r = requests.get(BASE + path, params=params, headers=H, timeout=60)
    j = r.json()
    return j if isinstance(j, list) else (j.get('data') or j or [])

def snap(companyId, returnDate, auth=True):
    hh = H if auth else {'Content-Type': 'application/json'}
    r = requests.post(BASE + '/api/nar1-snapshot',
                      json={'companyId': companyId, 'returnDate': returnDate}, headers=hh, timeout=120)
    try:
        j = r.json()
    except Exception:
        j = {'raw': r.text[:100]}
    return r.status_code, j

# ── 0. 前置数据（用现有端点读 D1 真行，作为断言依据）──
persons = {p['id']: p for p in get('/api/persons', limit=5000)}
roles = get('/api/person_company_roles', company_id=COMPANY, limit=500)
txs = get('/api/share_transactions', company_id=COMPANY, limit=500)
events = get('/api/change_events', company_id=COMPANY, limit=500)
name_of = lambda pid: (persons.get(pid) or {}).get('name_english') or pid[:8]
print('前置数据: roles=%d txs=%d events=%d persons=%d' % (len(roles), len(txs), len(events), len(persons)))

# ── 1. 轮询部署上线（修复信号：as-of 2027 不再含 24/06 已辞的 bc1ecd5a）──
print('polling deploy (nar1-snapshot fix)...')
live = None
for attempt in range(1, 49):
    st, j = snap(COMPANY, '2027-05-29')
    ids = [s.get('id') for s in (j.get('shareholders') or [])] if j.get('success') else None
    if ids is not None and 'bc1ecd5a-b648-4031-ae39-b213a0a76a08' not in ids:
        print('  LIVE at attempt %d (status %d)' % (attempt, st))
        live = (st, j)
        break
    print('  attempt %d: not yet (st %d, ids %s)' % (attempt, st, ids))
    time.sleep(10)
if not live:
    print('DEPLOY DID NOT GO LIVE'); sys.exit(1)

# ── 2. returnDate = 2026-05-29（最近週年日）──
print('\n=== 2. as-of 2026-05-29 ===')
st, j = snap(COMPANY, '2026-05-29')
chk('200 成功', st == 200 and j.get('success') is True, str(st))
chk('period = 2025-05-29 → 2026-05-29', j.get('period') == {'start': '2025-05-29', 'end': '2026-05-29'}, json.dumps(j.get('period')))
chk('公司資訊為最新（name）', j.get('company', {}).get('name') == 'PAUL TANG AND COMPANY LIMITED')

dirs = j.get('officers', {}).get('directors', [])
res = j.get('officers', {}).get('reserveDirectors', [])
secs = j.get('officers', {}).get('secretaries', [])
dir_names = sorted(name_of(d['id']).upper() for d in dirs) if dirs else []
# 董事：58fafd00（27/04/2026 委任活躍）+ 507d74bb（15/04 委任 18/06 辭 > 截止日 → 含）
chk('董事 2 名', len(dirs) == 2, json.dumps(dir_names))
chk('含 27/04 委任董事', any(d['id'] == '58fafd00-5d38-44c2-b495-bdb83d1d6b91' for d in dirs))
chk('含 18/06 才辭任的董事（辭任 > 截止日）', any(d['id'] == '507d74bb-4fe9-4c28-973b-7feb4238227f' for d in dirs))
chk('備任董事 0（is_reserve=0 不入）', len(res) == 0, str(len(res)))
chk('秘書 0（無秘書角色行）', len(secs) == 0, str(len(secs)))

sh = j.get('shareholders', [])
by_id = {s.get('id'): s for s in sh}
chk('股東 3 名（17/08 才入的剔除）', len(sh) == 3, json.dumps([(s.get('nameEnglish'), s.get('shares')) for s in sh], ensure_ascii=False))
chk('5000 Ordinary 股東在（Tang Siu Fan）', (by_id.get('f6efc475-2650-4a71-89c3-a365633237d2') or {}).get('shares') == 5000, json.dumps(list(by_id.keys())))
chk('Timothy 3000 還原為 2000（截止日後買入 1000）', (by_id.get('24cc93f6-c4da-4f7f-a819-bf9e3b87d40d') or {}).get('shares') == 2000, json.dumps([(s.get('nameEnglish'), s.get('shares')) for s in sh], ensure_ascii=False))
chk('Lam 1750 還原為 2750（截止日後賣出 1000）', (by_id.get('bc1ecd5a-b648-4031-ae39-b213a0a76a08') or {}).get('shares') == 2750, json.dumps([(s.get('nameEnglish'), s.get('shares')) for s in sh], ensure_ascii=False))
chk('17/08 入的 250 股東剔除（appointed > 截止日）', '507d74bb-4fe9-4c28-973b-7feb4238227f' not in by_id, json.dumps(list(by_id.keys())))
# 2026-05-29 窗口 [2025-05-29, 2026-05-29]：唯一的 17/08/2026 事件在窗口外
chk('changes 空（17/08/2026 在窗口外）', j.get('changes') == [], json.dumps(j.get('changes'))[:120])

# ── 3. returnDate = 2027-05-29（下一個週年日，測試另一組 as-of + 變動窗口）──
print('\n=== 3. as-of 2027-05-29 ===')
st, j = snap(COMPANY, '2027-05-29')
chk('200 成功', st == 200 and j.get('success') is True, str(st))
dirs = j.get('officers', {}).get('directors', [])
chk('董事 1 名（18/06/2026 已辭剔除）', len(dirs) == 1 and dirs[0]['id'] == '58fafd00-5d38-44c2-b495-bdb83d1d6b91',
    json.dumps([d.get('id') for d in dirs]))
sh = j.get('shareholders', [])
by_id = {s.get('id'): s for s in sh}
chk('股東 3 名（17/08 入的納入，24/06 已辭剔除）', len(sh) == 3, json.dumps([(s.get('nameEnglish'), s.get('shares')) for s in sh], ensure_ascii=False))
chk('含 250 股東（17/08 入）', (by_id.get('507d74bb-4fe9-4c28-973b-7feb4238227f') or {}).get('shares') == 250)
chk('不含 1750 股東（24/06 已辭）', 'bc1ecd5a-b648-4031-ae39-b213a0a76a08' not in by_id, json.dumps(list(by_id.keys())))
changes = j.get('changes', [])
chk('changes 含 17/08/2026 share_transfer（窗口內）', len(changes) == 1 and changes[0].get('event_type') == 'share_transfer',
    json.dumps(changes)[:200])

# ── 4. 錯誤路徑 ──
print('\n=== 4. 錯誤路徑 ===')
st, _ = snap(COMPANY, '2026-05-29', auth=False)
chk('無 token → 401', st == 401, str(st))
st, _ = snap('', '2026-05-29')
chk('缺 companyId → 400', st == 400, str(st))
st, _ = snap(COMPANY, '29/05/2026')
chk('returnDate 非 ISO → 400', st == 400, str(st))
st, _ = snap('00000000-0000-0000-0000-000000000000', '2026-05-29')
chk('未知公司 → 404', st == 404, str(st))

print('\nTOTAL: %d pass / %d fail' % (P, F))
sys.exit(1 if F else 0)
