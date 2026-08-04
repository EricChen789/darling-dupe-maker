#!/usr/bin/env python3
"""用千问看 NR1 模板签署区的 dropdown 选项"""
import fitz, base64, json, requests, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

api_key = os.environ.get("QWEN_API_KEY")
if not api_key:
    print("QWEN_API_KEY not set")
    sys.exit(1)

doc = fitz.open("public/templates/NR1-template.pdf")
page = doc[0]

# Extract dropdown info
print("=== Dropdown fields ===")
for w in page.widgets():
    if w.field_name.startswith("Dropdown"):
        print(f"\n{w.field_name}: rect={w.rect}, value={w.field_value!r}")
        if hasattr(w, 'choice_values') and w.choice_values:
            for i, (val, label) in enumerate(w.choice_values):
                # Try to decode label - it might be CJK with wrong encoding
                try:
                    label_repr = label.encode('raw_unicode_escape')
                except:
                    label_repr = repr(label)
                print(f"  choice[{i}]: value={val!r}, label_bytes={label_repr!r}")

# Render signer area for Qwen
clip = fitz.Rect(130, 640, 400, 700)
pix = page.get_pixmap(dpi=250, clip=clip)
img_b64 = base64.b64encode(pix.tobytes("png")).decode()

prompt = """请仔细看这个 NR1 模板 PDF 的签署人身份区域。
图中显示"董事 Director / 公司秘書 Company Secretary"这一行，
旁边有两个倒三角下拉框（dropdown）。
下拉框的选项是：
- 第一个选项："  " 或 " " (空白)
- 第二个选项：一行横线（删除线）"_________"

请确认：这些 dropdown 的第二个选项是不是一条横线（用来划掉不适用者）？
另外，两个 dropdown 分别对应左边（董事）和右边（公司秘书）吗？"""

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

print("\n=== Qwen response ===")
print(resp.json()["choices"][0]["message"]["content"])
doc.close()
