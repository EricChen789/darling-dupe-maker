# -*- coding: utf-8 -*-
"""NN9 本地渲染页 → 千问 VL 视觉验证（qwen3-vl-32b-instruct）
问内容存在性/乱码/划线语义，不问划线计数——VL 线检测不可信（[[bsn-transferee-underline-fix]] 教训）
用法: python _nn9_qwen.py [render|ask]   （先 render 出 PNG，再 ask）
"""
import sys, io, os, base64, time
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
import fitz
import requests

D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, '_nn9_out')
PNG = os.path.join(D, '_nn9_png')

key = None
for line in open(os.path.join(os.path.dirname(D), '.dev.vars'), encoding='utf-8'):
    if line.strip().startswith('QWEN_API_KEY='):
        key = line.strip().split('=', 1)[1]; break
assert key, 'QWEN_API_KEY not found'

def render():
    os.makedirs(PNG, exist_ok=True)
    for f in sorted(os.listdir(OUT)):
        if not f.endswith('.pdf'):
            continue
        doc = fitz.open(os.path.join(OUT, f))
        for i in range(doc.page_count):
            pix = doc[i].get_pixmap(matrix=fitz.Matrix(2, 2))
            fp = os.path.join(PNG, f'{f[:-4]}_p{i+1}.png')
            pix.save(fp)
            print('rendered', fp)
        doc.close()

# [png, 问题]
PAGES = [
    ('s01_full_p1.png', 'NN9 表格第1页。检查：1) BR 60535184 与公司名「APEX GLOBAL TRADING LIMITED」？2) 2(a) 香港新地址「Flat 8 / Block D / Queen\'s Road / 中西區」与日期 01/08/2026？3) 2(b) 電郵 hk@apex.com 与日期 02/08/2026？4) 2(c) 電話 +852 9123 4567 与日期 03/08/2026？5) 提交人 Twinsail Consultants Limited 信息？6) 有无乱码（尤其中文「中西區」）？简短回答。'),
    ('s01_full_p2.png', 'NN9 表格第2页。检查：1) BR 60535184？2) 3(a) 註冊辦事處新地址「Room 501 / Shinjuku Building / 1-2-3 Nishi-Shinjuku / Shinjuku-ku / Japan」与日期 05/08/2026？3) 3(b) 主要營業地點「Floor 12 / Marunouchi Tower / 2-4-1 Marunouchi / Chiyoda-ku / Japan」与日期 06/08/2026？4) 3(c) 電郵 overseas@apex.com 与日期 07/08/2026？5) 簽署人 Chan Tai Man, David 与日期 21/08/2026？6) 身份行「董事／公司秘書／經理／獲授權代表」中哪个保留、哪些划掉（应保留董事）？7) 有无乱码？简短回答。'),
    ('s02_hk_only_p2.png', 'NN9 表格第2页（仅填香港地址的场景）。检查：1) 3(a) 3(b) 3(c) 是否留空？2) 簽署人 Chan Tai Man, David 与日期是否显示？3) 有无乱码或异常？简短回答。'),
    ('s03_overseas_only_p1.png', 'NN9 表格第1页（仅填成立地地址的场景）。检查：1) 2(a) 香港地址部分是否留空？2) 公司名与 BR 是否显示？3) 提交人信息是否显示？4) 有无乱码或异常？简短回答。'),
    ('s04_cap_authorizedRep_p2.png', 'NN9 表格第2页（獲授權代表簽署）。检查：身份行「董事／公司秘書／經理／獲授權代表」中哪个保留、哪些划掉（应保留獲授權代表）？简短回答。'),
    ('s05_no_sig_p2.png', 'NN9 表格第2页（无签署人场景）。检查：1) 簽署姓名与日期是否留空？2) 身份行是否全部未被划掉？3) 有无乱码或异常？简短回答。'),
    ('s07_debug_p1.png', 'NN9 debug 模式第1页。检查：1) 是否能看到红色小字标注的字段名（如 fill_3_P.1）？2) 页面是否正常无异常？简短回答。'),
]

def ask():
    P = F = 0
    for png, q in PAGES:
        fp = os.path.join(PNG, png)
        if not os.path.exists(fp):
            print('SKIP %s (missing)' % png); continue
        img = base64.b64encode(open(fp, 'rb').read()).decode()
        for attempt in range(1, 4):
            try:
                r = requests.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                    headers={'Authorization': f'Bearer {key}'}, json={
                    'model': 'qwen3-vl-32b-instruct',
                    'messages': [{'role': 'user', 'content': [
                        {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{img}'}},
                        {'type': 'text', 'text': q}]}],
                    'temperature': 0.1, 'max_tokens': 400}, timeout=120)
                if r.status_code != 200:
                    print('── %s ── HTTP %s: %s' % (png, r.status_code, r.text[:200]))
                    F += 1
                    break
                ans = r.json()['choices'][0]['message']['content']
                print('── %s ──' % png)
                print(ans.strip())
                P += 1
                break
            except Exception as e:
                print('%s attempt %d exc %s' % (png, attempt, e))
                time.sleep(8)
        time.sleep(2)
    print('\nVL TOTAL: %d ok / %d fail' % (P, F))

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'render'
    if mode == 'render':
        render()
    else:
        ask()
