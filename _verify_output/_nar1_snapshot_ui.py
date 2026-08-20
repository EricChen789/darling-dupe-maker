# -*- coding: utf-8 -*-
"""生产 UI 验证：NAR1 週年申報自動化（2026-08-20）。
headless Chrome + CDP → 注入 JWT → PAUL TANG（成立 1981-05-29）NAR1 生成对话框 →
1. 默认结算日 = 最近週年日 2026-05-29（新 computeReturnDate）
2. 年度快選 chips = 最近 5 个已过週年日
3. as-of 2026-05-29：董事 2、股东 3（17/08 才入的剔除）、面板「本年度無任何變更」
   （姓名/股数都是 input value，innerText 看不到 → 断言 input 值）
4. 日历选择 2027-05-29（chips 只含已过週年日，未来年份走日历）：董事 1、股东 3、
   面板 1 条 17/08 股份轉讓
5. 生成 PDF（捕获响应）→ 文本层断言 as-of 反映在 PDF 里
生成会写一条 form_history（与真实用户操作一致，先例同 _nar1_ui_click_generate.py）。"""
import sys, io, os, json, time, subprocess, base64, re
from pathlib import Path
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
import requests
import websocket

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9229
DEPLOY = 'https://secretary-system-9cl.pages.dev'
BASE_API = DEPLOY
JWT = Path('_verify_output/_qf_prod_jwt.txt').read_text().strip()
COMPANY_ID = '25104de2-583b-427f-a307-805a081981dc'
USER_DATA = r'C:/Users/cc/AppData/Local/Temp/cdp_nar1_snap'
OUT_PNG = '_verify_output/_nar1_snapshot_ui_panel.png'
OUT_PDF = '_verify_output/_nar1_snapshot_ui_gen.pdf'

P = F = 0
def chk(name, cond, detail=''):
    global P, F
    if cond: print('  PASS  ' + name); P += 1
    else:    print('  FAIL  %s  %s' % (name, detail)); F += 1

# JWT payload → user object + exp 检查
pad = lambda s: s + '=' * (-len(s) % 4)
claims = json.loads(base64.urlsafe_b64decode(pad(JWT.split('.')[1])))
print('JWT exp:', time.strftime('%Y-%m-%d %H:%M', time.localtime(claims['exp'])), '(今天:', time.strftime('%Y-%m-%d'), ')')
USER = json.dumps({'id': claims.get('sub'), 'email': claims.get('email'),
                   'display_name': claims.get('display_name', ''), 'role': claims.get('role', 'admin')})

H = {'Authorization': 'Bearer ' + JWT}
persons = {p['id']: p for p in (lambda j: j if isinstance(j, list) else (j.get('data') or []))(
    requests.get(BASE_API + '/api/persons?limit=5000', headers=H, timeout=60).json())}
def surname(pid):
    p = persons.get(pid) or {}
    return (p.get('name_english') or '').split(' ')[0]
N_ACTIVE_DIR = surname('58fafd00-5d38-44c2-b495-bdb83d1d6b91')      # 27/04 委任，仍在任
N_CEASED_DIR = surname('507d74bb-4fe9-4c28-973b-7feb4238227f')      # 18/06/2026 辞任；17/08 又成为 250 股股东
N_1750_SH = surname('bc1ecd5a-b648-4031-ae39-b213a0a76a08')          # 24/06/2026 辞任股东
print('姓名: active_dir=%s ceased_dir/250股东=%s ceased_1750=%s' % (N_ACTIVE_DIR, N_CEASED_DIR, N_1750_SH))

# ── launch headless chrome（独立端口/独立 profile，不动 9222）──
subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
                  f'--user-data-dir={USER_DATA}', '--window-size=1600,1400',
                  '--remote-allow-origins=*',
                  '--no-first-run', '--disable-gpu', '--mute-audio', 'about:blank'],
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(5)
targets = requests.get(f'http://127.0.0.1:{PORT}/json', timeout=10).json()
page = [t for t in targets if t['type'] == 'page'][0]
ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=180)
_id = [0]
netevents = []
def cmd(method, params=None, timeout=180):
    _id[0] += 1
    ws.send(json.dumps({'id': _id[0], 'method': method, 'params': params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get('id') == _id[0]:
            if 'error' in m:
                raise RuntimeError(f"{method}: {m['error'].get('message','')[:150]}")
            return m.get('result', {})
        elif 'method' in m:
            netevents.append(m)
def evaljs(expr):
    r = cmd('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
    v = r.get('result', {}).get('value')
    if r.get('result', {}).get('subtype') == 'error':
        raise RuntimeError(f"JS error: {r['result'].get('description','')[:150]}")
    return v

def wait_js(expr, desc, timeout_s=90):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            v = evaljs(expr)
            if v:
                return v
        except Exception:
            pass
        time.sleep(1)
    raise TimeoutError('等待超时: ' + desc)

cmd('Page.enable'); cmd('Runtime.enable'); cmd('Network.enable')

# 1. navigate → inject token → companies
cmd('Page.navigate', {'url': DEPLOY})
wait_js("document.readyState === 'complete'", '页面加载')
evaljs(f"localStorage.setItem('secretary_jwt', {json.dumps(JWT)}); localStorage.setItem('secretary_user', {json.dumps(USER)}); 'ok'")
cmd('Page.navigate', {'url': DEPLOY + '/companies'})
wait_js("document.body && document.body.innerText.includes('PAUL TANG AND COMPANY LIMITED') && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'NAR1')", '公司列表出现 PAUL TANG 行')
print('✅ 公司列表已加载')

# 2. open NAR1 dialog
clicked = evaljs("""(() => {
  const nar1 = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'NAR1')
    .find(b => { const r = b.closest('tr'); return r && r.textContent.includes('PAUL TANG'); });
  if (!nar1) return 'no row';
  nar1.click();
  return 'clicked';
})()""")
chk('打开 NAR1 对话框', clicked == 'clicked', clicked)
wait_js("!!document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').innerText.includes('附表一 頁數')", '对话框渲染')

# 3. 等快照 fetch 完成（面板出现期间标签）
wait_js("""(() => {
  const d = document.querySelector('[role=dialog]');
  return d && d.innerText.includes('本年度變動') && !d.innerText.includes('本年度變動（載入中') && d.innerText.includes('29/05/2025');
})()""", '快照加载完成（期间 29/05/2025 – 29/05/2026）')

# 4. 默认结算日 = 最近週年日 2026-05-29
picker = evaljs("""(() => {
  const d = document.querySelector('[role=dialog]');
  const btns = [...d.querySelectorAll('button')];
  const b = btns.find(x => x.textContent.includes('2026-05-29') && x.querySelector('svg'));
  return b ? b.textContent.trim() : '';
})()""")
chk('默认结算日 = 2026-05-29（最近週年日）', '2026-05-29' in picker, picker)

# 5. chips = 最近 5 个已过週年日
chips = evaljs("""(() => {
  const d = document.querySelector('[role=dialog]');
  const label = [...d.querySelectorAll('span')].find(s => s.textContent.trim() === '年度快選：');
  if (!label) return [];
  const container = label.parentElement;
  return [...container.querySelectorAll('button')].map(b => b.textContent.trim());
})()""")
chk('5 个年度 chips（2022~2026 週年日）', chips == ['2026-05-29', '2025-05-29', '2024-05-29', '2023-05-29', '2022-05-29'], str(chips))
sel = evaljs("""(() => {
  const d = document.querySelector('[role=dialog]');
  const label = [...d.querySelectorAll('span')].find(s => s.textContent.trim() === '年度快選：');
  const b = [...label.parentElement.querySelectorAll('button')].find(x => x.textContent.trim() === '2026-05-29');
  return b ? b.className : '';
})()""")
chk('选中 chip 2026-05-29 高亮', 'bg-blue-600' in sel, sel)

# 6. as-of 2026-05-29 人员（卡片头 + input value 断言）
def count_cards(pat):
    return evaljs(f"""(() => {{
      const d = document.querySelector('[role=dialog]');
      return [...d.querySelectorAll('span')].filter(s => /^{pat}/.test(s.textContent.trim())).length;
    }})()""")
def input_vals():
    return evaljs("""(() => {
      const d = document.querySelector('[role=dialog]');
      return [...d.querySelectorAll('input')].map(i => (i.value || '').trim()).filter(Boolean);
    })()""")
chk('董事（自然人）2 名', count_cards(r'#\d+ — (P\.5|續頁C)') == 2, str(count_cards(r'#\d+ — (P\.5|續頁C)')))
chk('股东 3 名', count_cards(r'股東 #\d+ —') == 3, str(count_cards(r'股東 #\d+ —')))
chk('秘书（自然人）0 名', count_cards(r'#\d+ — P\.3') == 0, str(count_cards(r'#\d+ — P\.3')))
vals = input_vals()
chk('含 27/04 委任董事（input: Tang Siu Fan）', 'Tang Siu Fan' in vals, str(vals))
chk('含 18/06 才辞的董事（input: Chan Ho Yin）', 'Chan Ho Yin' in vals, str(vals))
chk('含股东 Lam Wai Keung（as-of 在任，还原本 2750）', 'Lam Wai Keung' in vals and '2750' in vals, str(vals))
chk('含股东 Timothy Tang（还原为 2000）', 'Timothy Tang' in vals and '2000' in vals, str(vals))
chk('含股东 Tang Siu Fan 5000', 'Tang Siu Fan' in vals and '5000' in vals, str(vals))
chk('不含 250 股数（17/08 才入，as-of 2026 剔除）', '250' not in vals, str(vals))

# 7. 本年度變動面板（2026-05-29 窗口为空）
panel_open = evaljs("""(() => {
  const d = document.querySelector('[role=dialog]');
  const btn = [...d.querySelectorAll('button')].find(b => b.textContent.includes('本年度變動'));
  if (!btn) return 'no panel';
  btn.click();
  return 'clicked';
})()""")
chk('本年度變動面板存在', panel_open == 'clicked', panel_open)
wait_js("document.querySelector('[role=dialog]').innerText.includes('本年度無任何變更')", '面板显示 本年度無任何變更')
# 截图记录
r = cmd('Page.captureScreenshot', {'format': 'png'})
open(OUT_PNG, 'wb').write(base64.b64decode(r['data']))
print('  截图:', OUT_PNG)

# 8. 日历选择 2027-05-29（chips 只含已过週年日；未来年份走日历）
# 注：RDP 的下拉 select 用 setter+dispatch change 不生效（React 不重渲染）→ 用 prev/next 按钮驱动，
# 以 selects 读值为真值；点日要用「可见」的 29（网格里相邻月的隐藏 outside day 也有 textContent '29'，
# 点到会选错月份——曾得 2027-04-29）。
trigger_open = evaljs("""(() => {
  const d = document.querySelector('[role=dialog]');
  const b = [...d.querySelectorAll('button')].find(x => x.textContent.includes('2026-05-29') && x.querySelector('svg'));
  if (!b) return 'no trigger';
  b.click();
  return 'clicked';
})()""")
chk('打开结算日日历', trigger_open == 'clicked', trigger_open)
wait_js("[...document.querySelectorAll('select')].length >= 2", '日历出现 年/月 下拉')
# 驱动到 May 2027（m='4', y='2027'）。必须在 Python 侧逐次点击：
# React 18 在同一 JS task 内批处理状态更新，单次 evaluate 里连点 60 下不重渲染
# → 每次点击单独 evaluate + 重读 selects 真值。
def cal_read():
    return evaljs("""(() => {
      const ms = [...document.querySelectorAll('select')].find(s => (s.getAttribute('aria-label') || '').toLowerCase().includes('month'));
      const ys = [...document.querySelectorAll('select')].find(s => (s.getAttribute('aria-label') || '').toLowerCase().includes('year'));
      return { m: ms ? ms.value : '?', y: ys ? ys.value : '?' };
    })()""")
n_drive = 0
drive_ok = False
while n_drive <= 60:
    st = cal_read()
    if st['m'] == '4' and st['y'] == '2027':
        drive_ok = True
        break
    fwd = (int(st['y']) < 2027) or (st['y'] == '2027' and int(st['m']) < 4)
    label = 'Go to next month' if fwd else 'Go to previous month'
    r = evaljs("""(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '') === '%s');
      if (!b) return 'no btn';
      b.click();
      return 'ok';
    })()""" % label)
    if r != 'ok':
        print('  导航按钮丢失:', label); break
    n_drive += 1
    time.sleep(0.3)
chk('日历驱动到 May 2027', drive_ok, '%d 次 -> %s' % (n_drive, str(cal_read())))
time.sleep(0.5)
picked = evaljs("""(() => {
  const dayBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '29' && !b.hidden);
  if (!dayBtns.length) return 'no day 29';
  dayBtns[dayBtns.length - 1].click();
  return 'clicked day 29';
})()""")
chk('日历点选 29（可见）', picked == 'clicked day 29', picked)
# 触发器按钮文本应变为 2027-05-29（setReturnDate 已生效）
wait_js("""(() => {
  const d = document.querySelector('[role=dialog]');
  return d && [...d.querySelectorAll('button')].some(x => x.textContent.includes('2027-05-29') && x.querySelector('svg'));
})()""", '结算日触发器显示 2027-05-29', 30)
wait_js("""(() => {
  const d = document.querySelector('[role=dialog]');
  return d && d.innerText.includes('29/05/2026') && d.innerText.includes('29/05/2027')
    && !d.innerText.includes('載入中…');
})()""", '快照重载（期间 29/05/2026 – 29/05/2027）', 60)
chk('董事（自然人）1 名（18/06 已辞剔除）', count_cards(r'#\d+ — (P\.5|續頁C)') == 1, str(count_cards(r'#\d+ — (P\.5|續頁C)')))
chk('股东 3 名（17/08 入的纳入、24/06 已辞的剔除）', count_cards(r'股東 #\d+ —') == 3, str(count_cards(r'股東 #\d+ —')))
vals = input_vals()
chk('含 250 股东 Chan Ho Yin（17/08 入）', 'Chan Ho Yin' in vals and '250' in vals, str(vals))
chk('不含 Lam Wai Keung（24/06 已辞）', 'Lam Wai Keung' not in vals and 'Lam' not in vals, str(vals))
chk('股东 Timothy Tang 恢复 3000（无 2027 后交易）', 'Timothy Tang' in vals and '3000' in vals, str(vals))

# 9. 面板展开断言（展开态保留，2027 窗口含 17/08 事件）
panel_state = evaljs("document.querySelector('[role=dialog]').innerText")
chk('面板 1 条：17/08/2026 股份轉讓', '股份轉讓' in panel_state and '17/08/2026' in panel_state, panel_state[panel_state.find('本年度變動'):panel_state.find('本年度變動')+120].replace('\n', ' | '))

# 10. 生成 PDF → 捕获响应
netevents.clear()
gen_clicked = evaljs("""(() => {
  const d = document.querySelector('[role=dialog]');
  const btn = [...d.querySelectorAll('button')].find(b => b.textContent.includes('生成並下載'));
  if (!btn) return 'no btn';
  if (btn.disabled) return 'disabled';
  btn.click();
  return 'clicked';
})()""")
chk('点击生成並下載', gen_clicked == 'clicked', gen_clicked)
ws.settimeout(3)
pdf_b64 = None
payload_has_company_id = False
t0 = time.time()
while time.time() - t0 < 150:
    for e in netevents:
        if e.get('method') == 'Network.requestWillBeSent' and 'generate-nar1-pdf' in e['params']['request']['url']:
            pd = e['params']['request'].get('postData') or ''
            if '"company_id"' in pd:
                payload_has_company_id = True
        if e.get('method') == 'Network.responseReceived' and 'generate-nar1-pdf' in e['params']['response']['url']:
            try:
                body_r = cmd('Network.getResponseBody', {'requestId': e['params']['requestId']}, timeout=30)
                body = body_r.get('body', '')
                if not body_r.get('base64Encoded'):
                    j = json.loads(body)
                    pdf_b64 = j.get('pdf')
            except Exception as ex:
                print('  getResponseBody err:', str(ex)[:100])
    if pdf_b64:
        break
    try:
        m = json.loads(ws.recv())
    except websocket.WebSocketTimeoutException:
        continue
    if m.get('id') is None and 'method' in m:
        netevents.append(m)
chk('payload 带 company_id（触发 autoAssign）', payload_has_company_id)
chk('捕获 generate-nar1-pdf 响应', bool(pdf_b64))
if pdf_b64:
    open(OUT_PDF, 'wb').write(base64.b64decode(pdf_b64))
    print('  PDF:', OUT_PDF, len(base64.b64decode(pdf_b64)), 'bytes')

# 11. PDF 文本层断言
if pdf_b64:
    import fitz
    doc = fitz.open(OUT_PDF)
    print('  页数:', doc.page_count)
    full = '\n'.join(doc[p].get_text() for p in range(doc.page_count))
    compact = re.sub(r'\s+', '', full)
    chk('PDF 含 250 股东（17/08 入，Ho Yin）', 'Ho Yin' in full, 'Ho Yin')
    chk('PDF 含 27/04 委任董事（Siu Fan）', 'Siu Fan' in full, 'Siu Fan')
    chk('PDF 不含 1750 股东（24/06 已辞）', N_1750_SH and N_1750_SH not in full, N_1750_SH)
    chk('PDF 含结算日 2027（29/05/2027 或 2027-05-29）', ('29/05/2027' in compact) or ('2027-05-29' in compact), compact[:200])
    chk('PDF 含公司名', 'PAUL TANG AND COMPANY LIMITED' in full.replace('\n', ' ') or 'PAULTANGANDCOMPANYLIMITED' in compact)
    doc.close()

ws.close()
print('\nTOTAL: %d pass / %d fail' % (P, F))

# kill chrome by port only（不动其他 chrome）
try:
    out = subprocess.run(['netstat', '-ano', '-p', 'tcp'], capture_output=True, text=True, shell=True).stdout
    pids = set()
    for line in out.splitlines():
        if f':{PORT}' in line and 'LISTENING' in line:
            pids.add(line.split()[-1])
    for pid in pids:
        subprocess.run(['taskkill', '/PID', pid, '/F'], capture_output=True)
        print('已按端口清理 chrome PID', pid)
except Exception as e:
    print('清理 chrome 失败（无害）:', e)

sys.exit(1 if F else 0)
