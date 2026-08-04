#!/usr/bin/env python3
"""
ND2B Field Verification Script — 千问 VL 逐页字段检查

生成包含全部 4 种变更类型的 ND2B PDF，用千问 VL 逐页验证：
  - 每个栏位填入的内容是否正确
  - 填写位置是否对得上模板栏位
  - checkbox 勾选是否正确
  - 是否有应填但留空的栏位

Usage:
  python _qwen_nd2b_verify.py                  # 全流程
  python _qwen_nd2b_verify.py --save-images     # 保存页面 PNG
  python _qwen_nd2b_verify.py --skip-vision     # 仅生成 PDF + 提取字段（不调千问）
  python _qwen_nd2b_verify.py --dpi 200         # 更高 DPI
"""

import sys, io, os, json, base64, time, argparse
from pathlib import Path

# Fix Windows console encoding for emoji
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import requests
import fitz  # PyMuPDF

LOCAL_API = "http://127.0.0.1:5000"
OUTPUT_DIR = Path(__file__).parent / "_verify_output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ═══════════════════════════════════════════════════
# 测试数据 — 覆盖全部变更类型
# ═══════════════════════════════════════════════════

TEST_DATA = {
    # ── 公司资料 ──
    "brNumber": "76543210",
    "companyName": "ALPHA OMEGA TRADING LIMITED",

    # ── 人员现有资料（自然人董事）──
    "role": "director",
    "identity": "natural",
    "nameChinese": "陳大文",
    "nameSurname": "CHAN",
    "nameOtherNames": "Tai Man",
    "nameEnglish": "CHAN Tai Man",
    "idNumber": "F3689283",
    "passportPlaceOfIssue": "HKSAR",
    "passportNumber": "EL1234567",

    # ── 现有地址 ──
    "addrFlat": "Flat 12A",
    "addrBuilding": "Golden Building",
    "addrStreet": "100 Nathan Road",
    "addrDistrict": "油尖旺",

    # ── 变更类型（全部）──
    "changeTypes": ["address", "name", "id", "contact"],

    # ── 新地址 ──
    "newFlat": "Room 2501",
    "newBuilding": "Silver Tower",
    "newStreet": "200 Des Voeux Road Central",
    "newDistrict": "中西區",
    "newRegion": "香港",

    # ── 新姓名 ──
    "newNameChinese": "陳大明",
    "newNameSurname": "CHAN",
    "newNameOtherNames": "Tai Ming",
    "newNameEnglish": "CHAN Tai Ming",
    "newAliasEnglish": "CHAN Tai Man (Former)",
    "newAliasChinese": "陳大文（前用名）",

    # ── 新证件 ──
    "newIdNumber": "G8765432",

    # ── 新联络 ──
    "newEmail": "taiming.chan@example.com",

    # ── 生效日期 ──
    "effectiveDate": "2026-08-01",

    # ── 签署 ──
    "signerName": "CHAN Tai Ming",
    "signDate": "2026-08-01",

    # ── 提交人 ──
    "presentorName": "Twinsail Consultants Limited",
    "presentorAddress": "Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong",
    "presentorPhone": "+852 2521 3888",
    "presentorFax": "+852 2521 3999",
    "presentorEmail": "info@twinsail.com",
    "presentorReference": "TS-2026-ND2B-001",
}

# ═══════════════════════════════════════════════════
# 每页预期内容（给千问的参考）
# ═══════════════════════════════════════════════════

PAGE_EXPECTATIONS = {
    1: """P.1 公司資料及申報人現有資料頁：
- fill_1: 商業登記號碼 = "76543210"
- fill_2: 公司名稱 = "ALPHA OMEGA TRADING LIMITED"
- cb_2: 勾選「董事 Director」（非秘書）
- fill_3: 中文姓名 = "陳大文"
- fill_4: 英文姓氏 Surname = "CHAN"
- fill_5: 英文名字 Other Names = "Tai Man"
- fill_7: 香港身分證部分號碼 = "F3689283"
- fill_7b: 護照簽發地區 = "HKSAR"
- fill_7c: 護照號碼(部分) = "EL1234567"
- fill_8: 提交人名稱 = "Twinsail Consultants Limited"
- fill_9: 提交人地址 = "Room 1203, 12/F, Wing On Centre..."
- fill_10~13: 電話/傳真/電郵/檔號
檢查：公司名和BR是否填對、cb_2是否勾選、HKID是否右對齊""",

    2: """P.2 變更詳情頁（自然人）— 應有 4 組變更：
(a) 姓名更改：舊名=CHAN Tai Man, 新中文名=陳大明, 新英文名=CHAN Tai Ming
(b) 別名：CHAN Tai Man (Former) 陳大文（前用名）
(d) 地址更改：Room 2501, Silver Tower, 200 Des Voeux Road Central, 中西區, 香港
(f) 聯絡資料更改：taiming.chan@example.com
(g) 證件號碼更改：G8765432
所有變更生效日期：01/08/2026 (DD/MM/YYYY)
檢查：每個變更類型的內容是否填在正確的 row、D/M/Y日期是否填對欄位、地址五欄是否各就各位""",

    3: """P.3 簽署頁：
- fill_30: 簽署人姓名 = "CHAN Tai Ming"
- fill_31: 簽署日期 = "2026-08-01"
檢查：簽署欄是否有內容、是否有遺漏""",

    6: """P.6 PI-ND2B 受保護資料頁：
- cb_2: 勾選「董事 Director」
- fill_2: 中文姓名 = "陳大文"（現有名，非新名）
- fill_3: 英文姓氏 = "CHAN"
- fill_4: 英文名字 = "Tai Man"
- fill_5: HKID = "G8765432"（新證件號）
- fill_9: 新地址 = "Room 2501, Silver Tower..."
檢查：PI頁是否正確反映新資料、checkbox是否與P.1一致""",
}

# P.4 和 P.5 是法人團體專用頁，自然人留空 — 千问应回报为空页


def get_auth_token():
    """Login to get JWT token"""
    try:
        resp = requests.post(f"{LOCAL_API}/api/auth/login", json={
            "email": "admin@localhost", "password": "admin123"
        }, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("token") or data.get("jwt", "")
    except Exception as e:
        print(f"⚠️ Auth error: {e}")
    return ""


def generate_pdf(data, token):
    """Generate ND2B PDF via Flask API"""
    resp = requests.post(
        f"{LOCAL_API}/api/generate-nd2b-pdf",
        json=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=120
    )
    if resp.status_code != 200:
        print(f"❌ PDF generation failed: HTTP {resp.status_code}")
        try:
            print(f"   Body: {resp.text[:300]}")
        except:
            pass
        return None
    result = resp.json()
    if not result.get("pdf"):
        print(f"❌ No PDF in response: {list(result.keys())}")
        return None
    return base64.b64decode(result["pdf"])


def extract_fields(pdf_bytes):
    """Extract all widget field values from generated PDF"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    field_status = {}
    for pi in range(doc.page_count):
        page_fields = []
        for w in doc[pi].widgets():
            if w.field_name:
                val = w.field_value
                page_fields.append({
                    "name": w.field_name,
                    "value": str(val)[:100] if val is not None else "(empty)",
                    "type": "checkbox" if w.field_name.startswith("cb_") else
                            "dropdown" if w.field_name.startswith("Dropdown") else "text"
                })
        field_status[f"P.{pi+1}"] = page_fields

        filled = sum(1 for f in page_fields if f["value"] != "(empty)" and f["type"] == "text")
        empty = sum(1 for f in page_fields if f["value"] == "(empty)" and f["type"] == "text")
        cb_checked = sum(1 for f in page_fields if f["type"] == "checkbox" and f["value"] != "(empty)")
        print(f"  P.{pi+1}: {len(page_fields)} widgets, {filled} filled, {empty} empty, {cb_checked} checkboxes ticked")

    doc.close()
    return field_status


def verify_page_with_qwen(img_b64, page_num, api_key):
    """Send page image to Qwen VL for field-by-field inspection"""
    expected = PAGE_EXPECTATIONS.get(page_num, f"第{page_num}頁 — 請根據ND2B表格標準格式檢查")

    prompt = f"""你是香港公司註冊處表格審核員。請仔細檢查這張 ND2B 表格第 {page_num} 頁的 PDF 圖片。

ND2B = 更改公司秘書及董事詳情通知書 (Notice of Change in Particulars of Company Secretary and Director)

預期內容參考：
{expected}

請逐欄檢查：
1. 每個填寫欄位的內容是否正確（例如：中文姓名欄應填中文、HKID欄應填證件號）
2. 填寫內容是否有錯位（例如：地址填到了姓名欄、日期填到了證件欄）
3. checkbox 勾選狀態是否正確
4. 是否有應填但留空的欄位
5. 提交人資料是否正確填入
6. 字體大小是否合理、有無溢出欄位邊界

請以 JSON 格式回覆（只回 JSON，不要 markdown）：
{{"page": {page_num}, "match": true/false, "confidence": 0.0-1.0, "issues": ["問題描述1", "問題描述2"], "fields_ok": 0, "fields_with_issues": ["欄位名: 問題描述"]}}
如果此頁為空白（如法人團體頁對自然人），match=true，issues=["空白頁（法人團體專用，自然人正確留空）"]"""

    try:
        resp = requests.post(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "qwen-vl-max",
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
                    ]
                }],
                "temperature": 0.1,
                "max_tokens": 2000,
            },
            timeout=90
        )

        if resp.status_code != 200:
            return {"page": page_num, "error": f"API {resp.status_code}", "match": None}

        content = resp.json()["choices"][0]["message"]["content"]
        # Extract JSON from response
        json_start = content.find("{")
        json_end = content.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            return json.loads(content[json_start:json_end])
        return {"page": page_num, "error": "no_json", "raw": content[:300], "match": None}

    except Exception as e:
        return {"page": page_num, "error": str(e), "match": None}


def main():
    parser = argparse.ArgumentParser(description="ND2B Qwen VL Field Verification")
    parser.add_argument("--save-images", action="store_true", help="Save page PNGs to disk")
    parser.add_argument("--skip-vision", action="store_true", help="Skip Qwen VL, only generate PDF + extract fields")
    parser.add_argument("--dpi", type=int, default=150, help="Page image DPI (default: 150)")
    args = parser.parse_args()

    print("=" * 60)
    print("ND2B Field Verification — 千问 VL 逐页检查")
    print("=" * 60)

    # ── Step 1: Generate ND2B PDF ──
    print("\n[1/4] 生成 ND2B PDF（全部 4 种变更类型）...")
    token = get_auth_token()
    if not token:
        print("❌ 无法获取认证 token，请确保 Flask 正在运行")
        sys.exit(1)

    pdf_bytes = generate_pdf(TEST_DATA, token)
    if not pdf_bytes:
        print("❌ PDF 生成失败")
        sys.exit(1)

    pdf_path = OUTPUT_DIR / "ND2B_verify_all_changes.pdf"
    pdf_path.write_bytes(pdf_bytes)
    print(f"  ✅ 已保存: {pdf_path} ({len(pdf_bytes):,} bytes)")

    # ── Step 2: Extract field info ──
    print("\n[2/4] 提取 PDF 字段信息...")
    field_status = extract_fields(pdf_bytes)

    # ── Step 3: Render pages as images ──
    print(f"\n[3/4] 渲染页面为 PNG（{args.dpi} DPI）...")
    page_images = {}
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    for pi in range(doc.page_count):
        pix = doc[pi].get_pixmap(dpi=args.dpi)
        img_bytes = pix.tobytes("png")
        img_b64 = base64.b64encode(img_bytes).decode()
        page_images[pi + 1] = (img_bytes, img_b64)

        if args.save_images:
            img_path = OUTPUT_DIR / f"ND2B_verify_p{pi+1}.png"
            img_path.write_bytes(img_bytes)

        # Print filled fields for this page
        page_key = f"P.{pi+1}"
        filled = [f for f in field_status.get(page_key, []) if f["value"] != "(empty)"]
        print(f"  P.{pi+1}: {len(page_images[pi+1][0]):,} bytes PNG, {len(filled)} non-empty fields")
        for f in filled:
            print(f"    [{f['type']}] {f['name']}: {f['value']}")
    doc.close()

    # ── Step 4: Qwen VL verification ──
    if args.skip_vision:
        print("\n[4/4] ⏭️ 跳过千问 VL（--skip-vision）")
        print("\n✅ 字段提取完成，请手动检查上述字段值")
        return

    print("\n[4/4] 千问 VL 逐页验证...")
    api_key = os.environ.get("QWEN_API_KEY")
    if not api_key:
        print("⚠️ QWEN_API_KEY 未设置，跳过视觉验证")
        print("   export QWEN_API_KEY=your_key 后重新运行")
        return

    all_ok = True
    page_results = {}
    for page_num in sorted(page_images.keys()):
        _, img_b64 = page_images[page_num]
        print(f"  正在验证 P.{page_num}...", end=" ", flush=True)

        result = verify_page_with_qwen(img_b64, page_num, api_key)
        page_results[page_num] = result

        if result.get("error"):
            print(f"❌ {result['error']}")
            all_ok = False
        else:
            match = result.get("match", False)
            conf = result.get("confidence", 0)
            issues = result.get("issues", [])
            status = "✅" if match else "❌"
            print(f"{status} match={match}, confidence={conf:.2f}")
            if issues:
                for iss in issues[:5]:
                    print(f"      - {iss}")
            if not match:
                all_ok = False

        time.sleep(1)  # Rate limiting

    # ── Summary ──
    print("\n" + "=" * 60)
    print("验证总结")
    print("=" * 60)
    total = len(page_results)
    passed = sum(1 for r in page_results.values() if r.get("match") is True)
    failed = sum(1 for r in page_results.values() if r.get("match") is False)
    errors = sum(1 for r in page_results.values() if r.get("match") is None)
    confs = [r.get("confidence", 0) for r in page_results.values() if r.get("confidence")]
    avg_conf = sum(confs) / len(confs) if confs else 0

    print(f"  页数: {total} | ✅ 通过: {passed} | ❌ 失败: {failed} | ⚠️ 错误: {errors}")
    print(f"  平均置信度: {avg_conf:.2f}")

    # Save results
    results_path = OUTPUT_DIR / "nd2b_verify_results.json"
    output = {
        "form": "ND2B",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "test_data_summary": {
            "change_types": TEST_DATA["changeTypes"],
            "role": TEST_DATA["role"],
            "identity": TEST_DATA["identity"],
        },
        "field_status": field_status,
        "page_results": page_results,
        "summary": {
            "total_pages": total,
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "avg_confidence": round(avg_conf, 2),
            "all_ok": all_ok,
        }
    }
    results_path.write_text(json.dumps(output, indent=2, ensure_ascii=False, default=str), encoding='utf-8')
    print(f"\n结果已保存: {results_path}")

    if not all_ok:
        print("\n⚠️ 有页面未通过验证，请查看上述问题详情")
        sys.exit(1)
    else:
        print("\n🎉 所有页面通过千问 VL 验证！")


if __name__ == "__main__":
    main()
