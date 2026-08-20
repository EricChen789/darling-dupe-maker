# -*- coding: utf-8 -*-
"""生产 UI 验证：NN3 註冊非香港公司周年申報表（2026-08-20）。
headless Chrome + CDP → 注入 JWT → /companies → PAUL TANG 公司詳情 → 文件生成 tab → NN3 →
1. 公司選擇自動填：英文名/BR/提交人（initialCompanyId 自动 handleCompanySelect）
2. 自動填入開關默認開；註冊日期（Section 3）手填 → returnDate 自動算 2026-06-01 + 年度快選 5 chips
3. 快照 as-of 2026-06-01 → 自然人董事 2 名（Tang Siu Fan + Chan Ho Yin 18/06 才辞）
4. 點 chip 2025-06-01 → returnDate 切換 + 快照重載；本年度變動面板存在
5. 生成 PDF（捕获响应，503 重試點擊）→ 文本层/widget 断言 + 千问 VL 渲染旁证
生成会写一条 form_history（与真实用户操作一致）。"""
import sys, io, os, json, time, subprocess, base64, re
from pathlib import Path
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
import requests
import websocket

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9230
DEPLOY = 'https://secretary-system-9cl.pages.dev'
JWT = Path('_verify_output/_qf_prod_jwt.txt').read_text().strip()
USER_DATA = r'C:/Users/cc/AppData/Local/Temp/cdp_nn3_ui'
OUT = Path('_verify_output/_nn3_ui_out')
OUT.mkdir(exist_ok=True)
OUT_PDF = OUT / 'nn3_ui_generated.pdf'

P = F = 0
def chk(name, cond, detail=''):
    global P, F
    if cond: print('  PASS  ' + name); P += 1
    else:    print('  FAIL  %s  %s' % (name, detail)); F += 1

pad = lambda s: s + '=' * (-len(s) % 4)
claims = json.loads(base64.urlsafe_b64decode(pad(JWT.split('.')[1])))
print('JWT exp:', time.strftime('%Y-%m-%d %H:%M', time.localtime(claims['exp'])))
USER = json.dumps({'id': claims.get('sub'), 'email': claims.get('email'),
                   'display_name': claims.get('display_name', ''), 'role': claims.get('role', 'admin')})

# ── launch headless chrome（独立端口/独立 profile，不动其他 chrome）──
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
# CR 表单生成器渲染在嵌套 Dialog（DocGenerationTab L208）→ 取 DOM 中最后一个 dialog
# （NN3 打开前只有一个 = 公司详情框；打开后最后一个 = NN3 表单框）
D = "[...document.querySelectorAll('[role=dialog]')].pop()"

cmd('Page.enable'); cmd('Runtime.enable'); cmd('Network.enable')

# ═══ 1. 登录 + 打开公司详情 ═══
cmd('Page.navigate', {'url': DEPLOY})
wait_js("document.readyState === 'complete'", '页面加载')
evaljs(f"localStorage.setItem('secretary_jwt', {json.dumps(JWT)}); localStorage.setItem('secretary_user', {json.dumps(USER)}); 'ok'")
cmd('Page.navigate', {'url': DEPLOY + '/companies'})
wait_js("document.body && document.body.innerText.includes('PAUL TANG AND COMPANY LIMITED')", '公司列表出现 PAUL TANG 行')
print('✅ 公司列表已加载')

opened = evaljs("""(() => {
  const rows = [...document.querySelectorAll('tr')].filter(r => r.textContent.includes('PAUL TANG AND COMPANY LIMITED'));
  if (!rows.length) return 'no row';
  const nameCell = [...rows[0].querySelectorAll('td')].find(td => td.textContent.includes('PAUL TANG'));
  (nameCell || rows[0]).click();
  return 'clicked';
})()""")
chk('打开公司详情对话框', opened == 'clicked', opened)
wait_js(f"{D} && {D}.innerText.includes('文件生成')", '对话框出现文件生成 tab')

# 表单无公司 BR 输入框（brNumber 由公司选择带入 payload）→ 趁还在「基本資料」tab（切 tab 后内容被卸载）从对话框字段直接读
_br_txt = evaljs("""(() => {
  const d = %s;
  const leaf = [...d.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === '商業登記號碼');
  return leaf ? leaf.parentElement.textContent.trim() : '';
})()""" % D)
_m = re.search(r'\d{8}', _br_txt or '')
EXPECT_BR = _m.group(0) if _m else ''
if not EXPECT_BR:
    resp = requests.get(DEPLOY + '/api/companies', headers={'Authorization': 'Bearer ' + JWT}, timeout=60)
    _jl = resp.json() if resp.status_code == 200 else {}
    _items = _jl.get('companies') if isinstance(_jl, dict) else _jl
    _pt = [c for c in (_items or []) if (c.get('name') or '').upper().startswith('PAUL TANG')]
    EXPECT_BR = _pt[0].get('brNumber', '') if _pt else ''
print('  期望 BR:', EXPECT_BR or '(未读到)')
chk('对话框读到公司 BR', bool(EXPECT_BR), _br_txt or 'not found')

# ═══ 2. 文件生成 tab → NN3 ═══
# 对话框数据异步加载会重渲染 tab 按钮（节点失效）→ 循环点击直到列表出现
try:
    tabok = wait_js("""(() => {
      const d = %s;
      if (!d) return false;
      if (d.innerText.includes('註冊非香港公司周年申報表')) return 'ok';
      const t = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '文件生成');
      if (t) {
        t.scrollIntoView({block: 'center'});
        const r = t.getBoundingClientRect();
        for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          t.dispatchEvent(new (ev.startsWith('pointer') ? PointerEvent : MouseEvent)(ev, {bubbles: true, cancelable: true, view: window, clientX: r.x + 1, clientY: r.y + 1, button: 0}));
        }
      }
      return false;
    })()""" % D, '文件生成 tab 切换+表单列表渲染')
except TimeoutError:
    tabok = None
    try:
        print('DEBUG dialog text:\n' + str(evaljs(f"({D} || document.body).innerText"))[:2000])
    except Exception as _e:
        print('DEBUG dump failed:', _e)
chk('切到文件生成 tab + NN3 选项出现', tabok == 'ok', str(tabok))
if tabok != 'ok':
    print('ABORT: 表单列表未出现'); sys.exit(1)
nn3 = evaljs("""(() => {
  const d = %s;
  const b = [...d.querySelectorAll('button')].find(x => x.textContent.includes('註冊非香港公司周年申報表'));
  if (!b) return 'no nn3 btn';
  b.scrollIntoView({block: 'center'});
  const r = b.getBoundingClientRect();
  for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    b.dispatchEvent(new (ev.startsWith('pointer') ? PointerEvent : MouseEvent)(ev, {bubbles: true, cancelable: true, view: window, clientX: r.x + 1, clientY: r.y + 1, button: 0}));
  }
  return 'clicked';
})()""" % D)
chk('打开 NN3 表单', nn3 == 'clicked', nn3)
wait_js(f"{D}.innerText.includes('本申報表的日期')", 'NN3 表单渲染')

# ═══ 3. 公司自动填充（initialCompanyId → handleCompanySelect）═══
def input_vals():
    return evaljs(f"(() => {{ const d = {D}; return [...d.querySelectorAll('input')].map(i => (i.value || '').trim()); }})()")
vals = wait_js(f"(() => {{ const d = {D}; return d && [...d.querySelectorAll('input')].some(i => (i.value||'').includes('PAUL TANG AND COMPANY LIMITED')); }})()", '公司名自动填入', 60)
chk('公司英文名自动填入 PAUL TANG', bool(vals), str(vals))
all_vals = input_vals()
chk('提交人姓名 = 公司名', 'PAUL TANG AND COMPANY LIMITED' in all_vals, str([v for v in all_vals if 'PAUL' in v]))
# 成立地方是手填字段（公司选择不自动填）→ 模拟用户填 Hong Kong（受控 input 用 native setter + input 事件）
poi = evaljs("""(() => {
  const d = %s;
  const h3 = [...d.querySelectorAll('h3')].find(x => x.textContent.trim().startsWith('4. 成立為法團所在地方'));
  if (!h3) return 'no h3';
  const inp = [...h3.parentElement.querySelectorAll('input')].find(i => (i.placeholder || '').includes('英屬維爾京群島'));
  if (!inp) return 'no input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, 'Hong Kong');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return 'filled';
})()""" % D)
chk('填成立地方 Hong Kong', poi == 'filled', poi)
auto_cb = evaljs("""(() => {
  const d = %s;
  const label = [...d.querySelectorAll('label')].find(l => l.textContent.includes('自動填入公司所有人員'));
  return label && label.querySelector('input[type=checkbox]') ? label.querySelector('input[type=checkbox]').checked : null;
})()""" % D)
chk('自動填入開關默認開', auto_cb is True, str(auto_cb))

# ═══ 4. 註冊日期手填 → returnDate 自動算 + chips ═══
reg_open = evaljs("""(() => {
  const d = %s;
  const h3 = [...d.querySelectorAll('h3')].find(x => x.textContent.trim().startsWith('3. 註冊日期'));
  if (!h3) return 'no h3';
  const sec = h3.parentElement;
  const btn = [...sec.querySelectorAll('button')].find(b => b.querySelector('svg'));
  if (!btn) return 'no trigger';
  btn.click();
  return 'clicked';
})()""" % D)
chk('打开註冊日期日历', reg_open == 'clicked', reg_open)
wait_js("[...document.querySelectorAll('select')].length >= 2", '日历出现 年/月 下拉')
def cal_read():
    return evaljs("""(() => {
      const ms = [...document.querySelectorAll('select')].find(s => (s.getAttribute('aria-label') || '').toLowerCase().includes('month'));
      const ys = [...document.querySelectorAll('select')].find(s => (s.getAttribute('aria-label') || '').toLowerCase().includes('year'));
      return { m: ms ? ms.value : '?', y: ys ? ys.value : '?' };
    })()""")
n_drive = 0
drive_ok = False
while n_drive <= 75:
    st = cal_read()
    if st['m'] == '5' and st['y'] == '2021':
        drive_ok = True
        break
    back = (int(st['y']) > 2021) or (st['y'] == '2021' and int(st['m']) > 5)
    label = 'Go to previous month' if back else 'Go to next month'
    r = evaljs("""(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '') === '%s');
      if (!b) return 'no btn';
      b.click();
      return 'ok';
    })()""" % label)
    if r != 'ok':
        print('  导航按钮丢失:', label); break
    n_drive += 1
    time.sleep(0.25)
chk('日历驱动到 June 2021', drive_ok, '%d 次 -> %s' % (n_drive, str(cal_read())))
time.sleep(0.5)
# 限定日历 grid 内点选，防止误点表单里其他文本为 '1' 的按钮；重试防节点失效
picked = None
for _ in range(5):
    picked = evaljs("""(() => {
      const grid = document.querySelector('[role=grid]');
      if (!grid) return 'no grid';
      const dayBtns = [...grid.querySelectorAll('button')].filter(b => b.textContent.trim() === '1' && !b.hidden);
      if (!dayBtns.length) return 'no day 1';
      dayBtns[0].click();
      return 'clicked day 1';
    })()""")
    if picked == 'clicked day 1':
        break
    time.sleep(0.5)
chk('日历点选 1', picked == 'clicked day 1', str(picked))

def picker_text(h3prefix):
    return evaljs("""(() => {
      const d = %s;
      const h3 = [...d.querySelectorAll('h3')].find(x => x.textContent.trim().startsWith('%s'));
      if (!h3) return '';
      const sec = h3.parentElement;
      const btn = [...sec.querySelectorAll('button')].find(b => b.querySelector('svg'));
      return btn ? btn.textContent.trim() : '';
    })()""" % (D, h3prefix))
try:
    wait_js("""(() => {
      const d = %s;
      const h3 = [...d.querySelectorAll('h3')].find(x => x.textContent.trim().startsWith('3. 註冊日期'));
      if (!h3) return false;
      return [...h3.parentElement.querySelectorAll('button')].some(b => b.textContent.includes('2021-06-01'));
    })()""" % D, '註冊日期触发器显示 2021-06-01', 20)
    chk('註冊日期 = 2021-06-01', True)
except TimeoutError:
    print('DEBUG cal:', cal_read())
    print('DEBUG sec3 buttons:', evaljs("""(() => {
      const d = %s;
      const h3 = [...d.querySelectorAll('h3')].find(x => x.textContent.trim().startsWith('3. 註冊日期'));
      return h3 ? [...h3.parentElement.querySelectorAll('button')].map(b => b.textContent.trim()) : 'no h3';
    })()""" % D))
    print('DEBUG grids:', evaljs("[...document.querySelectorAll('[role=grid] button')].map(b => b.textContent.trim() + ':' + (b.hidden ? 'h' : 'v')).slice(0, 45)"))
    chk('註冊日期 = 2021-06-01', False, '超时')
wait_js("""(() => {
  const d = %s;
  const h3 = [...d.querySelectorAll('h3')].find(x => x.textContent.trim().startsWith('2. 本申報表的日期'));
  if (!h3) return false;
  return [...h3.parentElement.querySelectorAll('button')].some(b => b.textContent.includes('2026-06-01'));
})()""" % D, 'returnDate 自动算 = 2026-06-01（最近周年日）', 20)
chk('returnDate 自动 = 2026-06-01', True)
chips = evaljs("""(() => {
  const d = %s;
  const label = [...d.querySelectorAll('span')].find(s => s.textContent.trim() === '年度快選：');
  if (!label) return [];
  return [...label.parentElement.querySelectorAll('button')].map(b => b.textContent.trim());
})()""" % D)
chk('5 个年度 chips（2026~2022）', chips == ['2026-06-01', '2025-06-01', '2024-06-01', '2023-06-01', '2022-06-01'], str(chips))

# ═══ 5. 快照 as-of 2026-06-01 → 自然人董事 2 名 ═══
def dir_card_count():
    return evaljs("""(() => {
      const d = %s;
      return [...d.querySelectorAll('span')].filter(s => /^#\\d+ — (P\\.5|P\\.6|續頁C)/.test(s.textContent.trim())).length;
    })()""" % D)
def click_chip(date):
    return evaljs("""(() => {
      const d = %s;
      const label = [...d.querySelectorAll('span')].find(s => s.textContent.trim() === '年度快選：');
      const b = [...label.parentElement.querySelectorAll('button')].find(x => x.textContent.trim() === '%s');
      if (!b) return 'no chip';
      b.click();
      return 'ok';
    })()""" % (D, date))
snap_ok = False
for attempt in range(3):
    try:
        wait_js("""(() => {
          const d = %s;
          const c = [...d.querySelectorAll('span')].filter(s => /^#\\d+ — (P\\.5|P\\.6|續頁C)/.test(s.textContent.trim())).length;
          return c >= 2 && d.innerText.includes('本年度變動');
        })()""" % D, '快照载入（2 董事 + 变动面板）', 50)
        snap_ok = True
        break
    except TimeoutError:
        if attempt < 2:
            print('  快照超时，点 chip 再切回重试…')
            click_chip('2025-06-01'); time.sleep(3)
            click_chip('2026-06-01'); time.sleep(3)
chk('快照 as-of 2026-06-01 → 自然人董事 2 名', snap_ok and dir_card_count() == 2, f'cards={dir_card_count()} snap_ok={snap_ok}')
vals = input_vals()
chk('含董事 Tang Siu Fan（input）', 'Tang Siu Fan' in vals, str([v for v in vals if 'Tang' in v or 'Chan' in v]))
chk('含 18/06 才辞的 Chan Ho Yin（as-of 在任）', 'Chan Ho Yin' in vals, str([v for v in vals if 'Chan' in v]))
# 首名自然人董事姓名（供 PDF 断言用）：span 在卡片 header div 内，名字输入在 header 的兄弟 grid → parentElement 到卡片容器
_first_dir = evaljs("""(() => {
  const d = %s;
  const span = [...d.querySelectorAll('span')].find(s => s.textContent.trim() === '#1 — P.5');
  if (!span) return {sur: '', other: ''};
  const card = span.closest('div').parentElement;
  const gv = (ph) => {
    const inp = [...card.querySelectorAll('input')].find(i => (i.placeholder || '').trim() === ph);
    return inp ? (inp.value || '').trim() : '';
  };
  return {sur: gv('英文姓氏 Surname'), other: gv('英文名字 Other Names')};
})()""" % D)
if isinstance(_first_dir, str):
    _first_dir = {'sur': _first_dir, 'other': ''}
first_dir_surname = _first_dir.get('sur', '')
first_dir_other = _first_dir.get('other', '')
first_dir_name = (first_dir_surname + ' ' + first_dir_other).strip()
print('  首名董事姓名（自动签署人）:', first_dir_name or '(未取得)')

# ═══ 6. chip 切年度 2025-06-01 → 快照重载 ═══
r = click_chip('2025-06-01')
chk('点 chip 2025-06-01', r == 'ok', r)
wait_js("""(() => {
  const d = %s;
  const h3 = [...d.querySelectorAll('h3')].find(x => x.textContent.trim().startsWith('2. 本申報表的日期'));
  if (!h3) return false;
  return [...h3.parentElement.querySelectorAll('button')].some(b => b.textContent.includes('2025-06-01'));
})()""" % D, 'returnDate 切换 2025-06-01', 20)
chk('returnDate 已切 2025-06-01', True)
snap25_ok = False
for attempt in range(3):
    try:
        wait_js("""(() => {
          const d = %s;
          const c = [...d.querySelectorAll('span')].filter(s => /^#\\d+ — (P\\.5|P\\.6|續頁C)/.test(s.textContent.trim())).length;
          return c === 0 && d.innerText.includes('本年度變動') && !d.innerText.includes('載入中');
        })()""" % D, '快照 as-of 2025-06-01 重载', 50)
        snap25_ok = True
        break
    except TimeoutError:
        if attempt < 2:
            print('  2025 快照超时，chip 切 2026 再切回重试…')
            click_chip('2026-06-01'); time.sleep(3)
            click_chip('2025-06-01'); time.sleep(3)
chk('as-of 2025-06-01 董事清空（Chan/Tang 均 2026-04 才上任）', snap25_ok and dir_card_count() == 0, f'cards={dir_card_count()} snap25_ok={snap25_ok}')
chips_after = evaljs("""(() => {
  const d = %s;
  const label = [...d.querySelectorAll('span')].find(s => s.textContent.trim() === '年度快選：');
  return [...label.parentElement.querySelectorAll('button')].map(b => b.textContent.trim());
})()""" % D)
sel = evaljs("""(() => {
  const d = %s;
  const label = [...d.querySelectorAll('span')].find(s => s.textContent.trim() === '年度快選：');
  const b = [...label.parentElement.querySelectorAll('button')].find(x => x.textContent.trim() === '2025-06-01');
  return b ? b.className : '';
})()""" % D)
chk('chip 2025-06-01 高亮', 'bg-blue-600' in (sel or ''), sel or 'no chip')

# ═══ 6b. 切回 2026-06-01 → 快照恢复 2 董事（生成完整 PDF 验证）═══
r = click_chip('2026-06-01')
chk('点 chip 切回 2026-06-01', r == 'ok', r)
wait_js("""(() => {
  const d = %s;
  const h3 = [...d.querySelectorAll('h3')].find(x => x.textContent.trim().startsWith('2. 本申報表的日期'));
  if (!h3) return false;
  return [...h3.parentElement.querySelectorAll('button')].some(b => b.textContent.includes('2026-06-01'));
})()""" % D, 'returnDate 切回 2026-06-01', 20)
chk('returnDate 已切回 2026-06-01', True)
snap26_ok = False
for attempt in range(3):
    try:
        wait_js("""(() => {
          const d = %s;
          const c = [...d.querySelectorAll('span')].filter(s => /^#\\d+ — (P\\.5|P\\.6|續頁C)/.test(s.textContent.trim())).length;
          return c >= 2 && d.innerText.includes('本年度變動') && !d.innerText.includes('載入中');
        })()""" % D, '快照切回 2026-06-01 重载', 50)
        snap26_ok = True
        break
    except TimeoutError:
        if attempt < 2:
            print('  2026 恢复超时，chip 切 2025 再切回重试…')
            click_chip('2025-06-01'); time.sleep(3)
            click_chip('2026-06-01'); time.sleep(3)
chk('切回 2026-06-01 → 董事恢复 2 名', snap26_ok and dir_card_count() == 2, f'cards={dir_card_count()} snap26_ok={snap26_ok}')

# ═══ 7. 生成 PDF → 捕获响应（503 重試點擊）═══
def click_generate():
    return evaljs("""(() => {
      const d = %s;
      const btn = [...d.querySelectorAll('button')].find(b => b.textContent.includes('生成 NN3 PDF'));
      if (!btn) return 'no btn';
      if (btn.disabled) return 'disabled';
      btn.click();
      return 'clicked';
    })()""" % D)
pdf_b64 = None
for attempt in range(1, 9):
    netevents.clear()
    r = click_generate()
    if r != 'clicked':
        print('  生成按钮:', r)
        break
    ws.settimeout(3)
    status = None
    t0 = time.time()
    while time.time() - t0 < 90:
        for e in netevents:
            if e.get('method') == 'Network.responseReceived' and 'generate-nn3-pdf' in e['params']['response']['url']:
                status = e['params']['response']['status']
                if status == 200:
                    try:
                        body_r = cmd('Network.getResponseBody', {'requestId': e['params']['requestId']}, timeout=30)
                        body = body_r.get('body', '')
                        if not body_r.get('base64Encoded'):
                            pdf_b64 = json.loads(body).get('pdf')
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
    if pdf_b64:
        print(f'  ✅ 第 {attempt} 次点击捕获成功')
        break
    print(f'  第 {attempt} 次点击: status={status}（503 则重试）')
    time.sleep(10)
chk('捕获 generate-nn3-pdf 200 响应', bool(pdf_b64), 'last status ' + str(status) if not pdf_b64 else '')
if pdf_b64:
    OUT_PDF.write_bytes(base64.b64decode(pdf_b64))
    print('  PDF:', OUT_PDF, OUT_PDF.stat().st_size, 'bytes')

# 表单截图存档
shot = cmd('Page.captureScreenshot', {'format': 'png'})
open(str(OUT / 'nn3_form.png'), 'wb').write(base64.b64decode(shot['data']))
print('  截图: nn3_form.png')

# ═══ 8. PDF 断言 ═══
if pdf_b64:
    import fitz
    doc = fitz.open(str(OUT_PDF))
    print('  页数:', doc.page_count)
    chk('页数 = 8（2 自然人董事无续页）', doc.page_count == 8, str(doc.page_count))
    notes = [pi + 1 for pi in range(doc.page_count) if '填表須知' in doc[pi].get_text()]
    chk('无填表須知页', not notes, str(notes))
    def wval(page, prefix):
        v = [w.field_value for w in page.widgets() if w.field_name.startswith(prefix)]
        return v[0] if v else None
    p1, p5, p6, p8 = doc[0], doc[4], doc[5], doc[doc.page_count - 1]
    chk('P.1 BR = 公司 brNumber（07281051）', wval(p1, 'fill_1_P.1') == EXPECT_BR, f"{wval(p1, 'fill_1_P.1')} vs {EXPECT_BR}")
    chk('P.1 公司名', 'PAUL TANG AND COMPANY LIMITED' in (wval(p1, 'fill_2_P.1') or ''), wval(p1, 'fill_2_P.1'))
    chk('P.1 申報日期 = 01/06/2026', (wval(p1, 'fill_3_P.1'), wval(p1, 'fill_4_P.1'), wval(p1, 'fill_5_P.1')) == ('01', '06', '2026'), str((wval(p1, 'fill_3_P.1'), wval(p1, 'fill_4_P.1'), wval(p1, 'fill_5_P.1'))))
    chk('P.1 註冊日期 = 01/06/2021', (wval(p1, 'fill_6_P.1'), wval(p1, 'fill_7_P.1'), wval(p1, 'fill_8_P.1')) == ('01', '06', '2021'))
    chk('P.1 成立地方 = Hong Kong', wval(p1, 'fill_9_P.1') == 'Hong Kong', wval(p1, 'fill_9_P.1'))
    # 后端 parseEnglishName 把 nameEnglish 按 HK 惯例拆姓（首词）/名（余下）→ 脚本本地同法拆分
    _parts = first_dir_name.split(' ') if first_dir_name else []
    _exp_sur = _parts[0] if _parts else ''
    _exp_other = ' '.join(_parts[1:]) if len(_parts) > 1 else ''
    chk(f'P.5 董事#1（姓 {_exp_sur or "?"}）', wval(p5, 'fill_4_P.5') == _exp_sur, f"{wval(p5, 'fill_4_P.5')} vs {_exp_sur}")
    chk('P.5 董事#1（名）', wval(p5, 'fill_5_P.5') == _exp_other, f"{wval(p5, 'fill_5_P.5')} vs {_exp_other}")
    chk('P.5 董事勾選', wval(p5, 'cb_1_P.5') == 'On' and wval(p5, 'cb_2_P.5') == '')
    chk('P.6 董事#2 存在', bool((wval(p6, 'fill_3_P.6') or '') or (wval(p6, 'fill_4_P.6') or '')), f"{wval(p6, 'fill_3_P.6')}/{wval(p6, 'fill_4_P.6')}")
    chk('P.8 簽署人 = 首名董事', wval(p8, 'fill_12_P.8') == (first_dir_name or ''), f"{wval(p8, 'fill_12_P.8')} vs {first_dir_name}")
    chk('P.8 簽署日期 = 01/06/2026（跟随申报日期）', wval(p8, 'fill_13_P.8') == '01/06/2026', wval(p8, 'fill_13_P.8'))
    dd = {}
    for w in doc[doc.page_count - 1].widgets():
        if w.field_name.startswith('Dropdown'):
            raw = doc.xref_object(w.xref, compressed=True)
            pm = re.search(r'/Parent (\d+) 0 R', raw)
            if pm:
                praw = doc.xref_object(int(pm.group(1)), compressed=True)
                im = re.search(r'/I\s*\[\s*(\d+)', praw)
                dd[w.field_name] = im.group(1) if im else None
    chk('P.8 身份 tick=董事', dd.get('Dropdown1') == '1' and dd.get('Dropdown2') == '0', str(dd))
    for pno, name in [(0, 'p1'), (4, 'p5'), (5, 'p6'), (doc.page_count - 1, 'p8')]:
        pix = doc[pno].get_pixmap(dpi=150)
        pix.save(str(OUT / f'{name}.png'))
    doc.close()
    print('  渲染 p1/p5/p6/p8 供千问')

# ═══ 9. 千问 VL 渲染旁证 ═══
def qwen_review():
    api_key = os.environ.get('QWEN_API_KEY')
    if not api_key:
        try:
            for line in Path('.dev.vars').read_text().splitlines():
                if line.strip().startswith('QWEN_API_KEY'):
                    api_key = line.split('=', 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    if not api_key:
        print('  QWEN_API_KEY 未设，跳过千问'); return
    content = [{'type': 'text', 'text': (
        '这是 NN3（注册非香港公司周年申报表）由生产 UI 实际生成后渲染的页面截图（P.1/P.5/P.6/P.8）。'
        '值层面已用程序断言验证，请只从渲染外观检查：1) 中文字符是否正常显示（不是方框/乱码）？'
        '2) checkbox 勾选外观（P.5 董事框应勾选）；3) P.8 底部 4 个身份框（Director/Secretary/Manager/Authorized Rep）'
        '——Director 应有一条横线标记，其余空白；4) 文字是否溢出字段框/重叠；5) 明显空白异常。'
        '逐图回答，最后总评 X/Y 张通过。')}]
    for f in ['p1.png', 'p5.png', 'p6.png', 'p8.png']:
        b64 = base64.b64encode((OUT / f).read_bytes()).decode()
        content.append({'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{b64}'}})
    r = requests.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                      headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                      json={'model': 'qwen3-vl-plus',
                            'messages': [{'role': 'user', 'content': content}],
                            'temperature': 0.1, 'max_tokens': 2000}, timeout=180)
    if r.status_code == 200:
        ans = r.json()['choices'][0]['message']['content']
        (OUT / '_qwen_review.txt').write_text(ans, encoding='utf-8')
        print('\n─ 千问 VL 旁证:')
        print(ans)
    else:
        print('  千问 ERR', r.status_code, r.text[:200])
qwen_review()

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
