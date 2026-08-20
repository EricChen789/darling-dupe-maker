#!/usr/bin/env python3
# NN3 千问 VL 渲染旁证 — 本地 harness 输出的关键页 PNG
# 值断言已由 _nn3_assert.py（pymupdf）全绿；千问只查渲染层问题（CJK 显示/勾选外观/线位）
import fitz, base64, json, requests, os, sys, io, time, glob

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

api_key = os.environ.get("QWEN_API_KEY")
if not api_key:
    try:
        with open('.dev.vars', 'r') as f:
            for line in f:
                if 'QWEN_API_KEY' in line:
                    api_key = line.split('=')[1].strip().strip('"').strip("'")
    except:
        pass
if not api_key:
    print("QWEN_API_KEY not set")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
PNG = os.path.join(HERE, '_nn3_out', 'pngs')

# 选出的关键页（值断言已覆盖全部，这里查渲染外观）
pages = [
    ('s01_basic_p1.png',  'P.1 公司資料：公司名中英兩行/申報日期/註冊日期/成立地方/地址4行/提交人'),
    ('s01_basic_p3.png',  'P.3 授權代表A自然人：張國榮/Cheung/Kwok Wing/HKID E567'),
    ('s01_basic_p4.png',  'P.4 秘書A自然人：林美玲/Lam/Mei Ling/HKID D456'),
    ('s01_basic_p5.png',  'P.5 自然人董事#1：陳大文/Chan Tai Man/David，董事框應勾選'),
    ('s01_basic_p6.png',  'P.7 法人董事留白+股本 HKD 100,000/50,000+按揭 20,000'),
    ('s01_basic_p7.png',  'P.8 帳目期間 02/06/2025–01/06/2026+簽署人 Chan Tai Man, David+簽署日期 01/06/2026+身份框（Director 應有橫線標記，其餘三個空白）'),
    ('s03_rep_3_p7.png',  'P.8 續頁計數：A=1（第2名授權代表）'),
    ('s03_rep_3_p8.png',  '續頁A：頭部日期 01/06/2026+葉問 Ip Man 地址+法人塊應空白'),
    ('s07_dirs_2_p6.png', 'P.6 自然人董事#2：黃小美/Wong Siu Mei，董事框勾選'),
    ('s09_alt_dir_p6.png','P.6 候補董事：吳文輝/Ng Man Fai，候補框勾選、代替欄 Chan Tai Man, David'),
    ('s12_corpdir_3_p8.png','P.8 續頁計數：D=1'),
    ('s12_corpdir_3_p9.png','續頁D 雙槽：槽1 華投有限公司 SINO INVEST LIMITED BR7654321、槽2 巨資有限公司 MEGA CAPITAL LIMITED BR9999999'),
    ('s14_accounts_b_p7.png','P.8 帳目B未交付：第二個勾選框（成立<18個月）應勾選'),
    ('s15_cjk_p1.png',    'P.1 中文公司名「頂峰環球貿易有限公司」應正常顯示不亂碼'),
    ('s15_cjk_p5.png',    'P.5 中文董事名「陳大文」應正常顯示不亂碼'),
    ('s17_signer_director_p7.png','P.8 身份框：Director 有橫線，Secretary/Manager/Authorized Rep 空白'),
]

missing = [f for f, _ in pages if not os.path.exists(os.path.join(PNG, f))]
if missing:
    print('missing:', missing)
    sys.exit(1)

content = [{
    "type": "text",
    "text": """请检查这份 NN3（注册非香港公司周年申报表）的 PDF 页面截图。这是本地生成的输出，值层面已用程序断言验证过，请你只从**渲染外观**角度检查：

1. **中文乱码**: 中文字符是否正常显示（不是方框/乱码/空白）？
2. **勾选外观**: 应勾选的 checkbox 是否显示勾号（不是空白）？不应勾选的应空白
3. **身份框**: P.8 底部 4 个身份框（Director/Secretary/Manager/Authorized Rep）——被选中者应有一条横线标记
4. **字段溢出**: 文字是否明显溢出字段框/重叠/被裁切？
5. **空白异常**: 本应有内容的字段是否空白？

每张图我会注明它应该是什么内容。请逐张检查，格式：
### 图N: [说明]
- ✅ 正常项
- ❌ 异常项（具体描述）

最后总评：X/Y 张通过，Z 个渲染问题。
"""
}]

for f, desc in pages:
    with open(os.path.join(PNG, f), 'rb') as fp:
        b64 = base64.b64encode(fp.read()).decode()
    content.append({
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{b64}"}
    })
    content.insert(len(content), {"type": "text", "text": f"（图{len(content) - 1} 说明：{desc}）"})

print(f'Sending {len(content) - 1} images to qwen3-vl-plus...')
start = time.time()
resp = requests.post(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    json={
        "model": "qwen3-vl-plus",
        "messages": [{"role": "user", "content": content}],
        "max_tokens": 6000,
    },
    timeout=300
)
print(f'Done in {time.time() - start:.1f}s, status={resp.status_code}')
if resp.status_code == 200:
    result = resp.json()
    answer = result["choices"][0]["message"]["content"]
    out_path = os.path.join(HERE, '_nn3_out', '_qwen_nn3_review.txt')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(answer)
    print(f'Saved to {out_path}')
    print("\n" + "=" * 60)
    print(answer)
else:
    print(f'Error: {resp.text[:500]}')
