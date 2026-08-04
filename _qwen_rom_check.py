#!/usr/bin/env python3
"""ROM 排版质量检查 — 千问 VL
1. 调用生产 API 生成 ROM PDF
2. 逐页转 PNG
3. 千问 VL 检查排版质量
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

# ── Config ──
# Try local first, fallback to production
API_URLS = [
    "http://127.0.0.1:8787/api/generate-shareholders-register-pdf",  # wrangler dev
    "https://master.secretary-system-9cl.pages.dev/api/generate-shareholders-register-pdf",
]
OUTPUT_DIR = Path(__file__).parent / "_rom_check_output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ── Find a test company ──
def find_company():
    """Try to find a company with shareholders from local DB"""
    try:
        import sqlite3
        db_path = Path(__file__).parent / ".." / "local-server" / "secretary.db"
        if not db_path.exists():
            db_path = Path("D:/myproject/local-server/secretary.db")
        if not db_path.exists():
            return None

        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        # Find company with shareholders
        row = conn.execute("""
            SELECT c.id, c.name, c.company_number
            FROM companies c
            JOIN person_company_roles r ON c.id = r.company_id AND r.role = 'shareholder'
            LIMIT 1
        """).fetchone()
        conn.close()
        if row:
            return {"id": row["id"], "name": row["name"], "br": row["company_number"]}
        # Fallback: any company
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT id, name, company_number FROM companies LIMIT 1").fetchone()
        conn.close()
        if row:
            return {"id": row["id"], "name": row["name"], "br": row["company_number"]}
    except Exception as e:
        print(f"  ⚠️ Local DB lookup failed: {e}")
    return None

# ── Try to get a JWT token ──
def get_token():
    """Try various ways to get auth token"""
    # Check env
    for key in ["SECRETARY_JWT", "JWT_TOKEN", "API_TOKEN"]:
        if os.environ.get(key):
            return os.environ[key]
    return None

# ── Generate ROM PDF ──
def generate_rom(api_url, company_id, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    print(f"  Calling: {api_url}")
    print(f"  Company ID: {company_id}")

    try:
        resp = requests.post(api_url, json={"companyId": company_id},
                           headers=headers, timeout=60)
        print(f"  Status: {resp.status_code}")

        if resp.status_code == 200:
            ct = resp.headers.get("Content-Type", "")
            if "application/pdf" in ct:
                return resp.content
            data = resp.json()
            if data.get("pdf"):
                return base64.b64decode(data["pdf"])
            if data.get("error"):
                print(f"  ❌ API error: {data['error']}")
                return None
        else:
            print(f"  Response: {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"  ❌ Request failed: {e}")
        return None

# ── Main ──
def main():
    print("=" * 60)
    print("ROM 排版质量检查 — 千问 VL")
    print("=" * 60)

    # 1. Find company
    company = find_company()
    token = get_token()

    if not company:
        print("❌ No company found in local DB")
        print("   Using hardcoded test company ID...")
        company = {"id": "test", "name": "TEST COMPANY", "br": "12345678"}

    print(f"\n📋 Company: {company['name']} (BR: {company.get('br', 'N/A')})")
    print(f"   ID: {company['id']}")
    if token:
        print(f"   🔑 Token: {token[:20]}...")
    else:
        print(f"   ⚠️ No auth token — will try calling API without auth")

    # 2. Generate PDF
    pdf_bytes = None
    for api_url in API_URLS:
        pdf_bytes = generate_rom(api_url, company["id"], token)
        if pdf_bytes:
            break
        print(f"  Trying next URL...")

    if not pdf_bytes:
        print("\n❌ Could not generate ROM PDF from any API endpoint")
        print("   Trying local generation via Node.js...")

        # Fallback: generate locally using the v5 test code
        import subprocess
        result = subprocess.run(
            ["node", "-e", """
                const fs = require('fs');
                const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
                const fontkit = require('@pdf-lib/fontkit');

                async function main() {
                    const pdf = await PDFDocument.create();
                    pdf.registerFontkit(fontkit);
                    const ascii = await pdf.embedFont(StandardFonts.Helvetica);
                    const times = await pdf.embedFont(StandardFonts.TimesRoman);
                    let cjk = ascii;
                    try { cjk = await pdf.embedFont(fs.readFileSync('D:/myproject/秘书系统文件/NotoSansTC.woff2')); } catch {}

                    const pg = pdf.addPage([842, 595]);
                    // Draw quick test content
                    pg.drawText('TEST ROM — LOCAL GENERATION', { x: 300, y: 300, size: 20, font: times });
                    pg.drawText('Company: TEST COMPANY LTD', { x: 42, y: 550, size: 12, font: ascii });

                    const bytes = await pdf.save();
                    fs.writeFileSync('D:/myproject/_test_rom_qwen.pdf', bytes);
                    console.log('OK');
                }
                main().catch(e => { console.error(e.message); process.exit(1); });
            """],
            capture_output=True, text=True, timeout=30,
            cwd="D:/myproject/darling-dupe-maker"
        )
        if result.returncode == 0:
            pdf_bytes = open("D:/myproject/_test_rom_qwen.pdf", "rb").read()
        else:
            print(f"  ❌ Local generation failed: {result.stderr}")
            sys.exit(1)

    # 3. Save PDF
    pdf_path = OUTPUT_DIR / "rom_test.pdf"
    pdf_path.write_bytes(pdf_bytes)
    print(f"\n✅ PDF saved: {pdf_path} ({len(pdf_bytes)} bytes)")

    # 4. Convert to PNG
    doc = fitz.open(str(pdf_path))
    print(f"\n📄 PDF has {len(doc)} pages")

    png_paths = []
    for i in range(len(doc)):
        pix = doc[i].get_pixmap(dpi=200)
        png_path = OUTPUT_DIR / f"rom_p{i+1}.png"
        pix.save(str(png_path))
        png_paths.append(str(png_path))
        print(f"  Page {i+1}: {pix.width}x{pix.height} → {png_path}")
    doc.close()

    # 5. Send to Qwen VL
    print(f"\n🤖 Sending to Qwen VL (qwen-vl-max)...")

    # Encode all pages as base64
    images_content = []
    for png_path in png_paths:
        with open(png_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()
        images_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{img_b64}"}
        })

    prompt = """请仔细检查这份「股东登记册 Register of Members」PDF 的排版质量，重点检查以下方面：

1. **整体布局比例**：页眉（公司名称/编号/日期）、两个股东区域、页脚是否比例合理，各占页面约多少？两个股东区域是否大小一致？
2. **文字对齐**：标签（Full Name, Address, Occupation 等）是否与填写内容垂直对齐？日期标签和日期值是否对齐？
3. **表格线条**：Shares Acquired / Shares Transferred 交易表格的横线和竖线是否完整、对齐？15列宽度比例是否合理？
4. **文字清晰度**：字体大小是否合适、可读？标签（灰色小字）是否清晰？
5. **整体外观**：是否像一份正式的香港公司秘书文件（Paul Tang & Co 格式）？与标准印刷表格的差距在哪里？

请以中文逐条回答（1-5），每条给出「通过 / 部分问题 / 失败」的评价并说明具体问题。"""

    resp = requests.post(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        headers={"Authorization": f"Bearer {QWEN_KEY}", "Content-Type": "application/json"},
        json={
            "model": "qwen-vl-max",
            "messages": [{
                "role": "user",
                "content": [*images_content, {"type": "text", "text": prompt}]
            }],
            "max_tokens": 2000,
        },
        timeout=120
    )

    result = resp.json()
    print(f"\n{'='*60}")
    print("千问 VL 分析结果：")
    print("="*60)

    if "choices" in result:
        content = result["choices"][0]["message"]["content"]
        print(content)
        print(f"\n📊 Tokens: {result.get('usage', {})}")

        # Save result
        result_path = OUTPUT_DIR / "qwen_result.txt"
        result_path.write_text(content, encoding='utf-8')
        print(f"\n💾 Result saved to: {result_path}")
    else:
        print(f"❌ Unexpected response: {json.dumps(result, indent=2, ensure_ascii=False)[:500]}")

    print(f"\n📁 All outputs in: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
