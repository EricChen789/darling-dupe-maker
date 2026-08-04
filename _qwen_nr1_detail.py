#!/usr/bin/env python3
"""详细检查 NR1 签署区的横线位置"""
import fitz, base64, json, requests, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

api_key = os.environ.get("QWEN_API_KEY")
if not api_key:
    print("QWEN_API_KEY not set")
    sys.exit(1)

doc = fitz.open("_test_nr1_strike.pdf")
page = doc[0]
# Render just the signer capacity area at high DPI
clip = fitz.Rect(140, 650, 390, 690)
pix = page.get_pixmap(dpi=250, clip=clip)
img_b64 = base64.b64encode(pix.tobytes("png")).decode()
doc.close()

prompt = """请仔细看这张放大图，显示的是 PDF 签署人身份部分。图中包含：
- "董事 Director"（左侧）
- "／"（斜杠分隔符）
- "公司秘書 Company Secretary *"（右侧）
- 下方小字 "*請刪去不適用者 Delete whichever does not apply"

问题：在"公司秘書 Company Secretary"这段文字上，是否有横线穿过（strikethrough）？请仔细观察文字中间是否有水平线条穿过字符。请描述：
1. 公司秘書四个字中间有没有横线？
2. Company 和 Secretary 英文字中间有没有横线？
3. 如果有横线，它的 x 坐标从左到右大概在什么位置？
4. 如果没有，图中是否能看到任何其他线条？"""

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
        "max_tokens": 500,
    },
    timeout=60
)

print(resp.json()["choices"][0]["message"]["content"])
