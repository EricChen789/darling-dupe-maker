#!/usr/bin/env python3
"""NR1 Signer Capacity + Email/Phone 验证 — 千问 VL"""
import fitz, base64, json, requests, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

api_key = os.environ.get("QWEN_API_KEY")
if not api_key:
    print("QWEN_API_KEY not set")
    sys.exit(1)

PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else "_test_nr1_strike.pdf"
EXPECT_CAPACITY = sys.argv[2] if len(sys.argv) > 2 else "director"

doc = fitz.open(PDF_PATH)
pix = doc[0].get_pixmap(dpi=200)
img_b64 = base64.b64encode(pix.tobytes("png")).decode()
doc.close()

if EXPECT_CAPACITY == "director":
    strike_expect = "横线应该划掉「公司秘书 Company Secretary」，保留「董事 Director」"
else:
    strike_expect = "横线应该划掉「董事 Director」，保留「公司秘书 Company Secretary」"

prompt = f"""请仔细检查这份 NR1 表格（更改注册办事处地址通知书）的 PDF 页面，验证以下内容：

1. 电邮地址（2b）和电话号码（2c）部分：电邮和电话是否为空？如果为空，生效日期（生效日/月/年）是否也应该是空的/未填写的？
2. 签署人身份部分（靠近页面底部，签署人姓名下方）：模板上有「董事 Director」和「公司秘书 Company Secretary」两个选项，旁边有说明「请删去不适用者」。{strike_expect}。
3. 签署人姓名是否是 "CHAN TAI MAN"？
4. 提交人姓名是否是 "TEST COMPANY LTD"？

请用中文逐条回答（1. 2. 3. 4.），每条明确说明通过还是失败。"""

print(f"Verifying: {PDF_PATH} (expect capacity={EXPECT_CAPACITY})")
print("---")

resp = requests.post(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    json={
        "model": "qwen-vl-max",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
                {"type": "text", "text": prompt}
            ]
        }],
        "max_tokens": 1000,
    },
    timeout=60
)

result = resp.json()
content = result["choices"][0]["message"]["content"]
print(content)
print(f"\nTokens: {result.get('usage', {})}")
