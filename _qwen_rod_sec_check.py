#!/usr/bin/env python3
"""ROD + SEC 排版质量检查 — 千问 VL
1. 读取本地生成的 rod_test.pdf / sec_test.pdf
2. 逐页转 PNG
3. 千问 VL 逐项检查排版质量，对比 RTF 模板
"""
import sys, io, os, json, base64, time
from pathlib import Path

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import requests
import fitz

QWEN_KEY = os.environ.get("QWEN_API_KEY")
if not QWEN_KEY:
    print("❌ QWEN_API_KEY not set")
    sys.exit(1)

OUTPUT_DIR = Path(__file__).parent / "_rom_check_output"

# ── Qwen VL call ──
def ask_qwen(images_b64, prompt, model="qwen-vl-max", max_tokens=2000):
    images_content = []
    for img in images_b64:
        images_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{img}"}
        })

    resp = requests.post(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        headers={"Authorization": f"Bearer {QWEN_KEY}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [{
                "role": "user",
                "content": [*images_content, {"type": "text", "text": prompt}]
            }],
            "max_tokens": max_tokens,
        },
        timeout=120
    )
    result = resp.json()
    if "choices" in result:
        return result["choices"][0]["message"]["content"], result.get("usage", {})
    else:
        return f"❌ Error: {json.dumps(result, indent=2, ensure_ascii=False)[:500]}", {}

# ── Check ROD ──
def check_rod():
    print("=" * 60)
    print("📋 ROD — Register of Officers (Directors Register)")
    print("=" * 60)

    pdf_path = OUTPUT_DIR / "rod_test.pdf"
    if not pdf_path.exists():
        print(f"❌ PDF not found: {pdf_path}")
        return

    # Convert to PNG
    doc = fitz.open(str(pdf_path))
    print(f"📄 {pdf_path.name}: {len(doc)} pages")

    images_b64 = []
    for i in range(len(doc)):
        pix = doc[i].get_pixmap(dpi=150)
        img_b64 = base64.b64encode(pix.tobytes("png")).decode()
        images_b64.append(img_b64)
        print(f"  Page {i+1}: {pix.width}x{pix.height}")
    doc.close()

    prompt = """请仔细检查这份「董事登记册 Register of Officers (ROD)」PDF 的排版质量。

参考格式：Paul Tang & Co 使用的 Landscape A4 ROD 登记册（Testing ROD.rtf），关键特征：
- 页眉 LEFT 对齐：公司名称(12pt bold) + Company Number 行 + REGISTER OF OFFICERS AT [DATE](11pt bold) + Quorum 右对齐同排
- 黑色分隔线在页眉下方
- 6 列表格：Name/Service/Residential Address(196pt) | Date/Place Birth/Place Inc/Occupation(138pt) | ID No/Passport Details(138pt) | Position(90pt) | Date(s) Appointed/Meeting(90pt) | Reason/Date(s) Ceased(148pt)
- 表头灰底 RGB(227,227,227)，黑边框
- 数据行：thin bottom border (0.3pt)，最后一行黑色粗边框闭合表格
- 页脚居中页码 "- 1 -"
- 总体风格：黑白为主，灰色表头，无蓝色文字

请逐项检查并给出评分（通过✅ / 部分问题⚠️ / 失败❌）：

1. **页眉布局**：公司名称左对齐？Company Number 正确？标题格式 "REGISTER OF OFFICERS AT 04 AUGUST 2026"？Quorum 右对齐且与标题有间距？
2. **表头格式**：6 列标签正确？灰底 RGB(227,227,227)？黑边框完整？
3. **列宽比例**：6 列宽度是否合理（196|138|138|90|90|148）？文字是否在列内正确显示不溢出？
4. **数据行内容**：董事/秘书姓名+地址在 Col1？出生地/日期在 Col2？证件号在 Col3？职位正确(Director/Reserve Director/Secretary)？日期在 Col5？Current/Resigned 在 Col6？
5. **表格边框**：数据行之间有细横线(0.3pt)？最后一行底部是黑色粗边框(0.5pt)？表格两侧是否有竖线（不应有）？
6. **整体外观**：是否符合 Paul Tang & Co 格式？字体大小是否可读？中英文混排是否正常？

请以中文逐条回答（1-6），最后给出总体评分（/10）和主要问题清单。"""

    print("\n🤖 发送 ROD 到千问 VL...")
    content, usage = ask_qwen(images_b64, prompt)
    print(f"\n{'='*60}")
    print("千问 VL 分析结果 (ROD)：")
    print("="*60)
    print(content)
    print(f"\n📊 Tokens: {usage}")

    result_path = OUTPUT_DIR / "rod_qwen_result.txt"
    result_path.write_text(content, encoding='utf-8')
    print(f"\n💾 Result saved to: {result_path}")

    return content

# ── Check SEC ──
def check_sec():
    print("\n\n" + "=" * 60)
    print("📋 SEC — Register of Company Secretaries")
    print("=" * 60)

    pdf_path = OUTPUT_DIR / "sec_test.pdf"
    if not pdf_path.exists():
        print(f"❌ PDF not found: {pdf_path}")
        return

    # Convert to PNG
    doc = fitz.open(str(pdf_path))
    print(f"📄 {pdf_path.name}: {len(doc)} pages")

    images_b64 = []
    for i in range(len(doc)):
        pix = doc[i].get_pixmap(dpi=150)
        img_b64 = base64.b64encode(pix.tobytes("png")).decode()
        images_b64.append(img_b64)
        print(f"  Page {i+1}: {pix.width}x{pix.height}")
    doc.close()

    prompt = """请仔细检查这份「公司秘书登记册 Register of Company Secretaries」PDF 的排版质量。

参考格式：应与 ROD (Register of Officers) 格式一致：
- 页眉 LEFT 对齐（不是居中！）：公司名称(12pt bold) + Company Number + REGISTER OF COMPANY SECRETARIES AT [DATE](11pt bold) + Quorum 右对齐
- 黑色分隔线
- 6 列表格：Name/Service/Residential Address(196pt) | ID No/Passport/Company No/TCSP(138pt) | Place Incorporated/Registered Office(138pt) | Position(90pt) | Date(s) Appointed/Meeting(90pt) | Reason/Date(s) Ceased(148pt)
- 表头灰底 RGB(227,227,227)，黑边框
- 数据行细横线(0.3pt)，最后一行黑色粗边框闭合
- 页脚居中页码

请逐项检查并给出评分（通过✅ / 部分问题⚠️ / 失败❌）：

1. **页眉对齐**：公司名称是否 LEFT 对齐（不是居中）？如果居中显示则是有问题的——应与 ROD 一样的左对齐格式。
2. **标题格式**：是否显示 "REGISTER OF COMPANY SECRETARIES AT 04 AUGUST 2026"？Quorum 是否右对齐且与标题有合理间距（至少24pt）？
3. **表头列标签**：是否与秘书登记册匹配？Col2="ID No/Passport/Company No/TCSP"？Col3="Place Incorporated/Registered Office"？
4. **数据行内容**：秘书名称+地址在 Col1？证件号+TCSP 在 Col2？注册地/办公室 在 Col3？Position="Secretary"？日期+Current？
5. **表格边框**：数据行之间有细横线？最后一行是黑色粗边框闭合？无竖线？
6. **与 ROD 一致性**：页眉风格（左对齐、黑色、无居中标题）、表头灰底、列宽(196|138|138|90|90|148)、边框风格是否与 ROD 完全一致？

请以中文逐条回答（1-6），最后给出总体评分（/10）和主要问题清单。"""

    print("\n🤖 发送 SEC 到千问 VL...")
    content, usage = ask_qwen(images_b64, prompt)
    print(f"\n{'='*60}")
    print("千问 VL 分析结果 (SEC)：")
    print("="*60)
    print(content)
    print(f"\n📊 Tokens: {usage}")

    result_path = OUTPUT_DIR / "sec_qwen_result.txt"
    result_path.write_text(content, encoding='utf-8')
    print(f"\n💾 Result saved to: {result_path}")

    return content

# ── Main ──
def main():
    print("=" * 60)
    print("ROD + SEC 排版质量检查 — 千问 VL")
    print("=" * 60)

    rod_result = check_rod()
    sec_result = check_sec()

    # Summary
    print("\n\n" + "=" * 60)
    print("📊 总结")
    print("=" * 60)
    print(f"\n📁 All outputs in: {OUTPUT_DIR}")
    print(f"   rod_qwen_result.txt")
    print(f"   sec_qwen_result.txt")

if __name__ == "__main__":
    main()
