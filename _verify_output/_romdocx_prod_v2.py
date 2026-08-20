# -*- coding: utf-8 -*-
"""ROM DOCX 生产验证 v2（2026-08-20 二修规则）：闭区间编号（首笔 0~股数）+ 转让末端割让 + 转出行末端变迁。
dawda（用户反馈公司）+ PAUL TANG（回归）。部署轮询标记 = dawda 转让行 From2=1000。
LibreOffice 渲染 dawda → 千问 VL（用户点名）。"""
import sys, io, os, json, base64, zipfile, re, time, shutil, subprocess, requests
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PROD = "https://secretary-system-9cl.pages.dev"
JWT = open('_verify_output/_qf_prod_jwt.txt').read().strip()
COMPANIES = [
    ('dawda', '1ed5b9a7-f68c-409b-8920-2e0c1a81e5e8'),
    ('PAULTANG', '25104de2-583b-427f-a307-805a081981dc'),
]

def gen(cid):
    r = requests.post(f'{PROD}/api/generate-rom-docx', json={'companyId': cid},
                      headers={'Authorization': f'Bearer {JWT}', 'Content-Type': 'application/json'}, timeout=120)
    if r.status_code != 200:
        return None, f'HTTP {r.status_code} {r.text[:200]}'
    body = r.json()
    if not body.get('docx'):
        return None, f'keys={list(body.keys())}'
    return base64.b64decode(body['docx']), None

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

# ── 部署轮询：新代码标记 = dawda 转让行 From2=1000（旧代码 0）──
nonEmpty = None
for attempt in range(12):
    zb, err = gen(COMPANIES[0][1])
    if err:
        print(f'  attempt {attempt+1}: {err}')
    else:
        _, nonEmpty = parse(zb)
        out_ = [c for c in nonEmpty if c[13] == 'Transfer Out' and c[10] == '100']
        marker = bool(out_) and out_[0][8] == '1000'
        print(f'  attempt {attempt+1}: 转让行From2=' + (out_[0][8] if out_ else '?') + f' 新代码={marker}')
        if marker:
            break
    time.sleep(25)
if not marker:
    print('部署未生效，退出'); sys.exit(1)

HDR = ['Date','Cert','From','To','Shares','Consid','Deed','Cert2','From2','To2','Shares2','Consid2','Total','Remarks','By']
pass_n = 0; fail_n = 0
def chk(name, cond, detail=''):
    global pass_n, fail_n
    if cond: print(f'  PASS  {name}'); pass_n += 1
    else: print(f'  FAIL  {name}  {detail}'); fail_n += 1

def verify(tag, cid, ck_fn):
    global fail_n
    zb, err = gen(cid)
    if err:
        print(f'[ {tag} ] 生成失败 {err}'); fail_n += 1; return None
    open(f'_verify_output/rom_v2_{tag}.docx', 'wb').write(zb)
    rows, ne = parse(zb)
    print(f'\n[ {tag} ] 非空交易行:')
    for c in ne:
        print('  ', ' | '.join(f'{HDR[i]}={c[i]}' for i in range(len(c)) if c[i]))
    ck_fn(ne, rows)
    return zb

# ── dawda ──
dawda_zb = verify('dawda', COMPANIES[0][1], lambda ne, rows: (
    chk('Shea 认购 From=0 To=1000',
        len([c for c in ne if c[13]=='Subscription' and c[4]=='1000' and c[2]=='0' and c[3]=='1000']) == 1),
    chk('Zhao 认购 From=1001 To=3000',
        len([c for c in ne if c[13]=='Subscription' and c[4]=='2000' and c[2]=='1001' and c[3]=='3000']) == 1),
    chk('PEAK 认购 From=3001 To=4800',
        len([c for c in ne if c[13]=='Subscription' and c[4]=='1800' and c[2]=='3001' and c[3]=='4800']) == 1),
    chk('转让行 From2=1000 To2=900（末端变迁）',
        len([c for c in ne if c[13]=='Transfer Out' and c[8]=='1000' and c[9]=='900']) == 1),
    chk('Chan In From=901 To=1000（割让区间）',
        len([c for c in ne if c[13]=='Transfer In' and c[2]=='901' and c[3]=='1000']) == 1),
))

# ── PAUL TANG 回归 ──
verify('PAULTANG', COMPANIES[1][1], lambda ne, rows: (
    chk('Timothy 认购 From=0 To=2000',
        len([c for c in ne if c[13]=='Subscription' and c[4]=='2000' and c[2]=='0' and c[3]=='2000']) == 1),
    chk('Tang 认购 From=2001 To=7000',
        len([c for c in ne if c[13]=='Subscription' and c[4]=='5000' and c[2]=='2001' and c[3]=='7000']) == 1),
    chk('Lam 认购 From=7001 To=10000',
        len([c for c in ne if c[13]=='Subscription' and c[4]=='3000' and c[2]=='7001' and c[3]=='10000']) == 1),
    chk('转1000 From2=10000 To2=9000',
        len([c for c in ne if c[13]=='Transfer Out' and c[10]=='1000' and c[8]=='10000' and c[9]=='9000']) == 1),
    chk('Timothy In From=9001 To=10000',
        len([c for c in ne if c[13]=='Transfer In' and c[4]=='1000' and c[2]=='9001' and c[3]=='10000']) == 1),
    chk('转250 From2=9000 To2=8750',
        len([c for c in ne if c[13]=='Transfer Out' and c[10]=='250' and c[8]=='9000' and c[9]=='8750']) == 1),
    chk('Chan In From=8751 To=9000',
        len([c for c in ne if c[13]=='Transfer In' and c[4]=='250' and c[2]=='8751' and c[3]=='9000']) == 1),
    chk('Lam 转250 Consid2=HKD 250.00',
        len([c for c in ne if c[13]=='Transfer Out' and c[10]=='250' and c[11]=='HKD 250.00']) == 1),
    chk('Timothy 无价默认全额 HKD 2000.00',
        len([c for c in ne if c[13]=='Subscription' and c[4]=='2000' and c[5]=='HKD 2000.00']) == 1),
))

print(f'\nTOTAL: {pass_n} pass / {fail_n} fail')

# ── LibreOffice 渲染 dawda → 千问 VL（用户点名）──
soffice = shutil.which('soffice') or r'C:\Program Files\LibreOffice\program\soffice.exe'
pdf_out = subprocess.run([soffice, '--headless', '--convert-to', 'pdf', '--outdir',
                          '_verify_output', '_verify_output/rom_v2_dawda.docx'],
                         capture_output=True, timeout=180)
pdf_path = '_verify_output/rom_v2_dawda.pdf'
if not os.path.exists(pdf_path):
    print('PDF 转换失败', pdf_out.stderr.decode('utf-8', 'replace')[:400]); sys.exit(1)
import pypdfium2 as pdfium
doc = pdfium.PdfDocument(pdf_path)
print(f'\ndawda PDF 页数: {len(doc)}')
S = 1.8
pngs = []
for i in range(len(doc)):
    p = f'_verify_output/rom_v2_dawda_p{i+1}.png'
    doc[i].render(scale=S).to_pil().save(p)
    pngs.append(p)
doc.close()

key = os.environ.get('QWEN_API_KEY')
if not key:
    for line in open('.dev.vars', encoding='utf-8'):
        m = re.match(r'QWEN_API_KEY\s*=\s*"?([^"\n]+)"?', line.strip())
        if m: key = m.group(1); break
print('\n─ 千问 VL 旁证:')
for p in pngs:
    b64 = base64.b64encode(open(p, 'rb').read()).decode()
    r = requests.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                      headers={'Authorization': f'Bearer {key}'},
                      json={'model': os.environ.get('QWEN_VL_MODEL', 'qwen3-vl-plus'),
                            'messages': [{'role': 'user', 'content': [
                                {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{b64}'}},
                                {'type': 'text', 'text': '这是「股东登记册 REGISTER OF MEMBERS」横向表格。请逐行读出交易区各列（Date/Cert/From/To/Shares/Consideration/Deed/Cert2/From2/To2/Shares2/Consid2/Total/Remarks），'
                                    '特别注意 Distinctive Nos From/To 是否为连续编号区间（认购如 0-1000、1001-3000、3001-4800；转让行如 From2=1000 To2=900）；并检查有无文字重叠、截断、表格线断裂或乱码。'}]}],
                            'temperature': 0.1, 'max_tokens': 1500}, timeout=180)
    if r.status_code != 200:
        print(f'  {p} 千问 ERR {r.status_code} {r.text[:200]}')
    else:
        print(f'  [{os.path.basename(p)}] {r.json()["choices"][0]["message"]["content"]}')
sys.exit(1 if fail_n else 0)
