#!/usr/bin/env python3
"""
NAR1 千问 VL 逐页验证 — 3 个测试场景

用法: python _qwen_nar1_verify.py standard|multi|corpdir
前提: 先运行 npx tsx _test_nar1_direct.ts <scenario> 生成 PDF
"""

import fitz, base64, json, requests, os, sys, io, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

api_key = os.environ.get("QWEN_API_KEY")
if not api_key:
    # Try .dev.vars
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

SCENARIO = sys.argv[1] if len(sys.argv) > 1 else "standard"
PDF_PATH = f"_test_nar1_cloud_{SCENARIO}.pdf"

if not os.path.exists(PDF_PATH):
    print(f"PDF not found: {PDF_PATH}. Run 'npx tsx _test_nar1_direct.ts {SCENARIO}' first.")
    sys.exit(1)

# ── Load and screenshot all pages ──
doc = fitz.open(PDF_PATH)
total_pages = len(doc)
max_pages = min(total_pages, 15)  # 前 15 页或全部
print(f"PDF: {PDF_PATH} — {total_pages} pages (sending first {max_pages})")

images = []
for i in range(max_pages):
    pix = doc[i].get_pixmap(dpi=150)
    b64 = base64.b64encode(pix.tobytes("png")).decode()
    images.append(b64)
doc.close()

# ── Build scenario-specific expectations ──
scenario_info = {
    "standard": {
        "desc": "标准公司：1 自然人董事 + 1 自然人秘书 + 2 自然人股东",
        "expect": """预期结果：
- P.1: 公司名「PAUL TANG AND COMPANY LIMITED / 保羅鄧氏有限公司」, BR 07281051, 私人公司勾选, 提交人 CHAN TAI MAN
- P.2: 股本表有 2 类 ORDINARY SHARES (HKD), 各 5000 股, 合计 10000 股
- P.3: 自然人秘书 TANG SIU FAN (鄧小芬), surname=TANG, other=SIU FAN
- P.4: 法人秘书 留空（无法人秘书）
- P.5: 自然人董事 CHAN TAI MAN (陳大明), 勾选身份, HKID A123
- P.6: 法人董事 留空（无法人董事）
- P.7: 备任董事 留空
- P.8: 续页计数 A=0 B=0 C=0 D=0, 附表一=1, 签署人 CHAN TAI MAN, Director 划线
- P.9: 附表一, 股东 CHAN TAI MAN (5000股) + TANG SIU FAN (5000股)
- P.10: 没有第3-4股东, 此页应被删除
- P.11-P.15: 无续页, 应被删除
""",
    },
    "multi": {
        "desc": "多人公司：3 自然人董事 + 1 法人秘书 + 1 自然人秘书 + 5 自然人股东",
        "expect": """预期结果：
- P.1: 公司名「BIG CORP HOLDINGS LIMITED」, BR 12345678
- P.3: 法人秘书 SECRETARY LTD (秘書有限公司)
- P.4: 自然人秘书 HO SIU LING (何小玲)
- P.5: 董事 #1 WONG SIU MING (黃小明)
- P.8: 续页计数 C=1 (第3董事), 附表一=3 (5股东需3页)
- P.9: 附表一, 股东 #1+#2
- P.10: 附表一續, 股东 #3+#4
- P.11: 續頁A (nat sec #2) — 无第3个nat sec, 应被删除
- P.12: 續頁B (corp sec #2) — 有法人秘书但无第2个, 应被删除
- P.13: 續頁C (nat dir #3) — 应该有 WONG SIU MING(?)
- P.14: 續頁D — 无法人董事, 应被删除
- 动态续页: 1个Sheet C页 (第3董事) + 1个Schedule 1页 (第5股东)
""",
    },
    "corpdir": {
        "desc": "法人董事公司：2 法人董事 + 1 自然人秘书 + 2 法人股东",
        "expect": """预期结果：
- P.1: 公司名「CORPORATE DIRECTORS LIMITED」
- P.3: 自然人秘书 LAM SIU LING (林小玲)
- P.5: 无自然人董事, 留空
- P.6: 法人董事 #1 HOLDING CORP LTD (控股有限公司)
- P.8: 续页计数 D=1 (P.14用于第2法人董事)
- P.14: 續頁D, 法人董事 #2 INVESTMENT CORP LTD (投資有限公司)
""",
    },
}

info = scenario_info.get(SCENARIO, scenario_info["standard"])

# ── Build message content ──
content = [{
    "type": "text",
    "text": f"""请仔细检查这份 NAR1 周年申报表 PDF（{info['desc']}），我已在本地用 TypeScript/pdf-lib 生成。

{info['expect']}

请逐页（P.1 到 P.{max_pages}）检查以下内容：
1. **字段填写**: 每个字段的值是否正确？有无空白/错填/漏填？
2. **复选框/勾选**: 应该勾选的 checkbox 是否已勾选？不应该勾选的是否留空？
3. **人员信息**: 姓名中英文拆分（surname vs other names）、地址五栏拆分（flat/building/street/district/region）是否正确？
4. **股本表**: 股份类别、货币、股数、合计是否正确？
5. **续页计数**: P.8 的续页数目是否与实际续页页数一致？
6. **签署人**: 签名横线是否划了正确的人（Director 或 Secretary）？
7. **日期**: 日/月/年字段是否填写正确？
8. **页数异常**: 是否有多余的空白页？应该被删除的页是否还在？

请逐页输出，格式：
### P.X: [页标题]
- ✅ 正确项
- ❌ 错误项（具体说明）

最后给一个总评：X/Y 页通过，Z 个问题待修。
"""
}]

for i, img in enumerate(images):
    content.append({
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{img}"}
    })

# ── Send to 千问 VL ──
print(f"\nSending {len(content)} items to qwen-vl-max...")
start = time.time()
resp = requests.post(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    json={
        "model": "qwen-vl-max",
        "messages": [{"role": "user", "content": content}],
        "max_tokens": 6000,
    },
    timeout=180
)
elapsed = time.time() - start
print(f"Done in {elapsed:.1f}s, status={resp.status_code}")

if resp.status_code == 200:
    result = resp.json()
    answer = result["choices"][0]["message"]["content"]
    out_path = f"_qwen_nar1_review_{SCENARIO}.txt"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(answer)
    print(f"Saved to {out_path} ({len(answer)} chars)")
    print(f"Tokens: {result.get('usage', {})}")
    print("\n" + "="*60)
    print(answer[:3000])
else:
    print(f"Error: {resp.text[:500]}")
