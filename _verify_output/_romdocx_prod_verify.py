# -*- coding: utf-8 -*-
"""ROM DOCX 生产验证（2026-08-20 distinctive 编号）：PAUL TANG → 生产端点 → 解包 document.xml
断言每格 From/To/Consideration（To=From+股数、Sub 默认 HKD1 全额、转让价=转出方单价）。
含部署轮询（functions-only 改动前端 bundle hash 不变 → 以「Sub 行 From=0」为新代码标记）。
最后 LibreOffice 转 PDF 渲染 PNG → 千问 VL 旁证（用户点名）。"""
import sys, io, os, json, base64, zipfile, re, time, shutil, subprocess, requests
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PROD = "https://secretary-system-9cl.pages.dev"
JWT = open('_verify_output/_qf_prod_jwt.txt').read().strip()
CID = '25104de2-583b-427f-a307-805a081981dc'
OUT_DOCX = '_verify_output/rom_prod_new.docx'

def gen():
    r = requests.post(f'{PROD}/api/generate-rom-docx', json={'companyId': CID},
                      headers={'Authorization': f'Bearer {JWT}', 'Content-Type': 'application/json'}, timeout=120)
    if r.status_code != 200:
        return None, f'HTTP {r.status_code} {r.text[:200]}'
    body = r.json()
    if not body.get('docx'):
        return None, f'keys={list(body.keys())}'
    zip_bytes = base64.b64decode(body['docx'])
    open(OUT_DOCX, 'wb').write(zip_bytes)
    return zip_bytes, None

def parse(zip_bytes):
    xml = zipfile.ZipFile(io.BytesIO(zip_bytes)).read('word/document.xml').decode('utf-8')
    def unesc(t):
        return (t.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
                 .replace('&quot;', '"').replace('&apos;', "'"))
    rows = []
    for tr in re.findall(r'<w:tr\b[\s\S]*?</w:tr>', xml):
        cells = []
        for tc in re.findall(r'<w:tc\b[\s\S]*?</w:tc>', tr):
            text = ''.join(re.findall(r'<w:t\b[^>]*>([\s\S]*?)</w:t>', tc))
            cells.append(unesc(text).strip())
        rows.append(cells)
    txRows = [c for c in rows if len(c) == 15]
    nonEmpty = [c for c in txRows if any(x for x in c)]
    return rows, nonEmpty

# ── 部署轮询：新代码标记 = 任一 Sub 行 From=0（旧代码 From=证书号 1/2/3…）──
nonEmpty = None
for attempt in range(12):
    zb, err = gen()
    if err:
        print(f'  attempt {attempt+1}: {err}')
    else:
        rows, nonEmpty = parse(zb)
        marker = any(c[13] == 'Subscription' and c[2] == '0' for c in nonEmpty)
        print(f'  attempt {attempt+1}: rows={len(rows)} nonEmpty={len(nonEmpty)} 新代码标记={marker}')
        if marker:
            break
    time.sleep(25)
if nonEmpty is None or not any(c[13] == 'Subscription' and c[2] == '0' for c in nonEmpty):
    print('部署未生效，退出'); sys.exit(1)

HDR = ['Date','Cert','From','To','Shares','Consid','Deed','Cert2','From2','To2','Shares2','Consid2','Total','Remarks','By']
print('\n=== 非空交易行 ===')
for c in nonEmpty:
    print(' ', ' | '.join(f'{HDR[i]}={c[i]}' for i in range(len(c)) if c[i]))
print('\n=== 姓名行 ===')
for c in rows:
    if any(re.search(r'[A-Za-z]{4,}', x) for x in c) and len(c) < 15 and c != ['']:
        print(' ', ' | '.join(x for x in c if x))

# ── 断言 ──
pass_n = 0; fail_n = 0
def chk(name, cond, detail=''):
    global pass_n, fail_n
    if cond: print(f'  PASS  {name}'); pass_n += 1
    else: print(f'  FAIL  {name}  {detail}'); fail_n += 1

sub2000 = [c for c in nonEmpty if c[13] == 'Subscription' and c[4] == '2000']
sub5000 = [c for c in nonEmpty if c[13] == 'Subscription' and c[4] == '5000']
sub3000 = [c for c in nonEmpty if c[13] == 'Subscription' and c[4] == '3000']
out1000 = [c for c in nonEmpty if c[13] == 'Transfer Out' and c[10] == '1000']
out250  = [c for c in nonEmpty if c[13] == 'Transfer Out' and c[10] == '250']
in1000  = [c for c in nonEmpty if c[13] == 'Transfer In' and c[4] == '1000']
in250   = [c for c in nonEmpty if c[13] == 'Transfer In' and c[4] == '250']

chk('Timothy 认购 2000 存在', len(sub2000) == 1, f'got={len(sub2000)}')
if sub2000:
    chk('Timothy From=0 To=2000', sub2000[0][2] == '0' and sub2000[0][3] == '2000',
        f"got={sub2000[0][2]}~{sub2000[0][3]}")
    chk('Timothy 无价默认 HKD1 全额 = HKD 2000.00', sub2000[0][5] == 'HKD 2000.00',
        f"got={sub2000[0][5]}")
chk('Tang 认购 5000 存在', len(sub5000) == 1, f'got={len(sub5000)}')
if sub5000:
    chk('Tang From=2001 To=7001', sub5000[0][2] == '2001' and sub5000[0][3] == '7001',
        f"got={sub5000[0][2]}~{sub5000[0][3]}")
    chk('Tang 无价默认 HKD1 全额 = HKD 5000.00', sub5000[0][5] == 'HKD 5000.00',
        f"got={sub5000[0][5]}")
chk('Lam 认购 3000 存在', len(sub3000) == 1, f'got={len(sub3000)}')
if sub3000:
    chk('Lam From=7002 To=10002', sub3000[0][2] == '7002' and sub3000[0][3] == '10002',
        f"got={sub3000[0][2]}~{sub3000[0][3]}")
    chk('Lam Consid=HKD 3000.00（单价 1.00）', sub3000[0][5] == 'HKD 3000.00',
        f"got={sub3000[0][5]}")
chk('Lam 转出 1000 行存在', len(out1000) == 1, f'got={len(out1000)}')
if out1000:
    chk('转出1000 From2=7002 To2=8002（FIFO 划出）',
        out1000[0][8] == '7002' and out1000[0][9] == '8002',
        f"got={out1000[0][8]}~{out1000[0][9]}")
    chk('转出1000 Consid2=HKD 1000.00', out1000[0][11] == 'HKD 1000.00',
        f"got={out1000[0][11]}")
chk('Timothy In 1000 行存在', len(in1000) == 1, f'got={len(in1000)}')
if in1000:
    chk('In1000 From=7002 To=8002（与转出同段）', in1000[0][2] == '7002' and in1000[0][3] == '8002',
        f"got={in1000[0][2]}~{in1000[0][3]}")
    chk('In1000 Consid=HKD 1000.00', in1000[0][5] == 'HKD 1000.00', f"got={in1000[0][5]}")
chk('Lam 转出 250 行存在', len(out250) == 1, f'got={len(out250)}')
if out250:
    chk('转出250 From2=8003 To2=8253', out250[0][8] == '8003' and out250[0][9] == '8253',
        f"got={out250[0][8]}~{out250[0][9]}")
    chk('转出250 Consid2=HKD 250.00（Lam 单价1；旧值 1125）', out250[0][11] == 'HKD 250.00',
        f"got={out250[0][11]}")
chk('Chan In 250 行存在', len(in250) == 1, f'got={len(in250)}')
if in250:
    chk('In250 From=8003 To=8253（与转出同段）', in250[0][2] == '8003' and in250[0][3] == '8253',
        f"got={in250[0][2]}~{in250[0][3]}")
    chk('In250 Consid=HKD 250.00', in250[0][5] == 'HKD 250.00', f"got={in250[0][5]}")
print(f'\nTOTAL: {pass_n} pass / {fail_n} fail')

# ── LibreOffice 转 PDF → 渲染 PNG → 千问 VL ──
soffice = shutil.which('soffice') or r'C:\Program Files\LibreOffice\program\soffice.exe'
pdf_out = subprocess.run([soffice, '--headless', '--convert-to', 'pdf', '--outdir',
                          '_verify_output', OUT_DOCX],
                         capture_output=True, timeout=180)
print('\nLibreOffice:', pdf_out.stdout.decode('utf-8', 'replace').strip() or pdf_out.returncode)
pdf_path = OUT_DOCX.replace('.docx', '.pdf')
if not os.path.exists(pdf_path):
    print('PDF 转换失败', pdf_out.stderr.decode('utf-8', 'replace')[:400]); sys.exit(1)

import pypdfium2 as pdfium
from PIL import Image
doc = pdfium.PdfDocument(pdf_path)
print(f'PDF 页数: {len(doc)}')
S = 1.8
png_paths = []
for i in range(len(doc)):
    p = f'_verify_output/rom_new_p{i+1}.png'
    doc[i].render(scale=S).to_pil().save(p)
    png_paths.append(p)
doc.close()

# 千问 VL（读 QWEN_API_KEY 环境变量或 .dev.vars）
key = os.environ.get('QWEN_API_KEY')
if not key:
    for line in open('.dev.vars', encoding='utf-8'):
        m = re.match(r'QWEN_API_KEY\s*=\s*"?([^"\n]+)"?', line.strip())
        if m: key = m.group(1); break
print('\n─ 千问 VL 旁证:')
for p in png_paths:
    b64 = base64.b64encode(open(p, 'rb').read()).decode()
    r = requests.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                      headers={'Authorization': f'Bearer {key}'},
                      json={'model': os.environ.get('QWEN_VL_MODEL', 'qwen3-vl-plus'),
                            'messages': [{'role': 'user', 'content': [
                                {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{b64}'}},
                                {'type': 'text', 'text': '这是「股东登记册 REGISTER OF MEMBERS」横向表格。请逐行读出交易区各列（Date/Cert/From/To/Shares/Consideration/Deed/Cert2/From2/To2/Shares2/Consid2/Total/Remarks），'
                                    '特别注意 From/To 是否为连续编号区间（如 0-2000、7002-10002）而非相同单号；并检查有无文字重叠、截断、表格线断裂或乱码。'}]}],
                            'temperature': 0.1, 'max_tokens': 1500}, timeout=180)
    if r.status_code != 200:
        print(f'  {p} 千问 ERR {r.status_code} {r.text[:200]}')
    else:
        print(f'  [{os.path.basename(p)}] {r.json()["choices"][0]["message"]["content"]}')
sys.exit(1 if fail_n else 0)
