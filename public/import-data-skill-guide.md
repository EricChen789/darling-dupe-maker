# 資料導入 API 使用指南 (Import Data Skill Guide)

## 概覽

此 API 用於批量導入公司及其關聯人員（董事、秘書、股東）資料到系統資料庫。

- **端點**: `POST https://uqcsgmmsrgtlcqutaomg.supabase.co/functions/v1/import-data`
- **認證**: 使用 anon key，無需用戶登入
- **重複處理**: 以 `company_number`（BR 號碼）判斷，已存在則跳過整間公司

---

## 快速開始

### 安裝依賴

```bash
pip install requests
```

### 最簡範例

```python
import requests

API_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/functions/v1/import-data"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxY3NnbW1zcmd0bGNxdXRhb21nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMTA2NzYsImV4cCI6MjA4NTU4NjY3Nn0.AWo97hF1eOJ43H4_deUplIS8Y7ckSIxWmw-7TlX9GY4"

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {ANON_KEY}",
    "apikey": ANON_KEY,
}

data = {
    "name": "ABC Limited",
    "company_number": "12345678",
    "officers": [
        {"role": "director", "name_english": "CHAN Tai Man"}
    ],
    "shareholders": [
        {"name": "CHAN Tai Man", "shares": 10000}
    ]
}

resp = requests.post(API_URL, headers=HEADERS, json=data)
print(resp.json())
```

---

## 完整範例

### 單筆導入（含所有欄位）

```python
import requests
import json

API_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/functions/v1/import-data"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxY3NnbW1zcmd0bGNxdXRhb21nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMTA2NzYsImV4cCI6MjA4NTU4NjY3Nn0.AWo97hF1eOJ43H4_deUplIS8Y7ckSIxWmw-7TlX9GY4"

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {ANON_KEY}",
    "apikey": ANON_KEY,
}

company = {
    "name": "ABC Limited",
    "company_number": "12345678",
    "chinese_name": "ABC有限公司",
    "trading_name": "",
    "business_nature": "Trading",
    "company_type": "私人公司 Private company",
    "business_code": "1234",
    "register_date": "2020-01-01",
    "company_group": "",
    "quorum": "",
    "reg_flat": "Unit A",
    "reg_building": "Tower 1",
    "reg_street": "Queen's Road Central",
    "reg_district": "Central",
    "reg_region": "香港 Hong Kong",
    "officers": [
        {
            "role": "director",
            "identity": "natural",
            "name_english": "CHAN Tai Man",
            "name_chinese": "陳大文",
            "id_number": "A1234567",
            "address": "Flat A, 1/F, Tower 1, Queen's Road Central",
            "date_appointed": "2020-01-01",
            "date_ceased": "",
            "place_incorporated": "",
            "company_number_ref": ""
        },
        {
            "role": "secretary",
            "identity": "corporate",
            "name_english": "XYZ Secretarial Services Ltd",
            "name_chinese": "",
            "id_number": "",
            "address": "Room 1001, 10/F, Central Plaza",
            "date_appointed": "2020-01-01",
            "place_incorporated": "Hong Kong",
            "company_number_ref": "99999999"
        }
    ],
    "shareholders": [
        {
            "name": "CHAN Tai Man",
            "name_english": "CHAN Tai Man",
            "name_chinese": "陳大文",
            "shares": 10000,
            "identity": "natural",
            "id_number": "A1234567",
            "address": "Flat A, 1/F, Tower 1",
            "email": "chan@example.com",
            "share_type": "Ordinary 普通股"
        }
    ]
}

resp = requests.post(API_URL, headers=HEADERS, json=company)
print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
```

### 批量導入

```python
import requests
import json

API_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/functions/v1/import-data"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxY3NnbW1zcmd0bGNxdXRhb21nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMTA2NzYsImV4cCI6MjA4NTU4NjY3Nn0.AWo97hF1eOJ43H4_deUplIS8Y7ckSIxWmw-7TlX9GY4"

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {ANON_KEY}",
    "apikey": ANON_KEY,
}

batch = {
    "companies": [
        {
            "name": "Company A Ltd",
            "company_number": "11111111",
            "chinese_name": "甲公司有限公司",
            "business_nature": "Consulting",
            "officers": [
                {
                    "role": "director",
                    "name_english": "LEE Ka Ming",
                    "name_chinese": "李家明",
                    "id_number": "B7654321"
                },
                {
                    "role": "secretary",
                    "name_english": "Pro Secretary Ltd",
                    "identity": "corporate"
                }
            ],
            "shareholders": [
                {
                    "name": "LEE Ka Ming",
                    "name_english": "LEE Ka Ming",
                    "name_chinese": "李家明",
                    "shares": 1000,
                    "share_type": "Ordinary 普通股"
                }
            ]
        },
        {
            "name": "Company B Ltd",
            "company_number": "22222222",
            "chinese_name": "乙公司有限公司",
            "business_nature": "Import/Export",
            "reg_street": "Nathan Road",
            "reg_district": "Tsim Sha Tsui",
            "reg_region": "九龍 Kowloon",
            "officers": [
                {
                    "role": "director",
                    "name_english": "WONG Siu Ling",
                    "name_chinese": "黃小玲"
                }
            ],
            "shareholders": [
                {"name": "WONG Siu Ling", "shares": 5000},
                {"name": "CHAN Tai Man", "shares": 5000}
            ]
        }
    ]
}

resp = requests.post(API_URL, headers=HEADERS, json=batch)
result = resp.json()
print(json.dumps(result, indent=2, ensure_ascii=False))

# 檢查結果
print(f"\n✅ 已導入: {result['imported']}")
print(f"⏭️ 已跳過: {result['skipped']}")
if result['skipped_br_numbers']:
    print(f"   跳過的 BR: {', '.join(result['skipped_br_numbers'])}")
if result['errors']:
    print(f"❌ 錯誤: {result['errors']}")
```

### 從 JSON 檔案導入

```python
import requests
import json

API_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/functions/v1/import-data"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxY3NnbW1zcmd0bGNxdXRhb21nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMTA2NzYsImV4cCI6MjA4NTU4NjY3Nn0.AWo97hF1eOJ43H4_deUplIS8Y7ckSIxWmw-7TlX9GY4"

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {ANON_KEY}",
    "apikey": ANON_KEY,
}

# 從檔案讀取
with open("companies.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# 如果檔案是陣列格式，包裝成 companies 物件
if isinstance(data, list):
    data = {"companies": data}

resp = requests.post(API_URL, headers=HEADERS, json=data)
print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
```

### 從 Excel/CSV 轉換後導入

```python
import requests
import json
import pandas as pd

API_URL = "https://uqcsgmmsrgtlcqutaomg.supabase.co/functions/v1/import-data"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxY3NnbW1zcmd0bGNxdXRhb21nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMTA2NzYsImV4cCI6MjA4NTU4NjY3Nn0.AWo97hF1eOJ43H4_deUplIS8Y7ckSIxWmw-7TlX9GY4"

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {ANON_KEY}",
    "apikey": ANON_KEY,
}

# 讀取 Excel（假設有 companies, officers, shareholders 三個工作表）
companies_df = pd.read_excel("data.xlsx", sheet_name="companies")
officers_df = pd.read_excel("data.xlsx", sheet_name="officers")
shareholders_df = pd.read_excel("data.xlsx", sheet_name="shareholders")

# 組合成 API 格式
companies = []
for _, row in companies_df.iterrows():
    br = str(row.get("company_number", "")).strip()
    if not br:
        continue

    # 找出該公司的董事和秘書
    co_officers = officers_df[officers_df["company_number"] == br]
    officers = []
    for _, o in co_officers.iterrows():
        officers.append({
            "role": str(o.get("role", "director")).lower(),
            "identity": str(o.get("identity", "natural")).lower(),
            "name_english": str(o.get("name_english", "")),
            "name_chinese": str(o.get("name_chinese", "")),
            "id_number": str(o.get("id_number", "")),
            "address": str(o.get("address", "")),
            "date_appointed": str(o.get("date_appointed", "")),
        })

    # 找出該公司的股東
    co_shareholders = shareholders_df[shareholders_df["company_number"] == br]
    shs = []
    for _, s in co_shareholders.iterrows():
        shs.append({
            "name": str(s.get("name", "")),
            "name_english": str(s.get("name_english", "")),
            "name_chinese": str(s.get("name_chinese", "")),
            "shares": int(s.get("shares", 0)),
            "identity": str(s.get("identity", "natural")).lower(),
            "share_type": str(s.get("share_type", "")),
        })

    companies.append({
        "name": str(row.get("name", "")),
        "company_number": br,
        "chinese_name": str(row.get("chinese_name", "")),
        "trading_name": str(row.get("trading_name", "")),
        "business_nature": str(row.get("business_nature", "")),
        "company_type": str(row.get("company_type", "私人公司 Private company")),
        "officers": officers,
        "shareholders": shs,
    })

# 分批導入（每批 50 間）
BATCH_SIZE = 50
for i in range(0, len(companies), BATCH_SIZE):
    batch = companies[i:i + BATCH_SIZE]
    resp = requests.post(API_URL, headers=HEADERS, json={"companies": batch})
    result = resp.json()
    print(f"批次 {i // BATCH_SIZE + 1}: 導入 {result['imported']}, 跳過 {result['skipped']}")
```

---

## 欄位參考

### 公司 (Company)

| 欄位 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| `name` | string | ✅ | — | 英文公司名稱 |
| `company_number` | string | ✅ | — | BR 號碼（重複判斷依據） |
| `chinese_name` | string | | `""` | 中文公司名稱 |
| `trading_name` | string | | `""` | 商號名稱 |
| `business_nature` | string | | `""` | 業務性質 |
| `company_type` | string | | `"私人公司 Private company"` | 公司類型 |
| `business_code` | string | | `""` | 業務代碼 |
| `company_group` | string | | `""` | 公司集團 |
| `register_date` | string | | `""` | 成立日期 |
| `quorum` | string | | `""` | 法定人數 |
| `reg_flat` | string | | `""` | 註冊地址 - 室 |
| `reg_building` | string | | `""` | 註冊地址 - 大廈 |
| `reg_street` | string | | `""` | 註冊地址 - 街道 |
| `reg_district` | string | | `""` | 註冊地址 - 地區 |
| `reg_region` | string | | `"香港 Hong Kong"` | 註冊地址 - 區域 |

### 董事/秘書 (Officers)

| 欄位 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| `role` | string | ✅ | — | `"director"` 或 `"secretary"` |
| `name_english` | string | ✅ | `""` | 英文姓名 |
| `name_chinese` | string | | `""` | 中文姓名 |
| `identity` | string | | `"natural"` | `"natural"` 或 `"corporate"` |
| `id_number` | string | | `""` | 身份證/護照號碼 |
| `address` | string | | `""` | 通訊地址 |
| `date_appointed` | string | | `null` | 委任日期 |
| `date_ceased` | string | | `null` | 離任日期 |
| `place_incorporated` | string | | `""` | 法人註冊地（corporate 用） |
| `company_number_ref` | string | | `""` | 法人公司號碼（corporate 用） |

### 股東 (Shareholders)

| 欄位 | 類型 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| `name` | string | ✅ | — | 姓名（可用 name_english 替代） |
| `name_english` | string | | `""` | 英文姓名 |
| `name_chinese` | string | | `""` | 中文姓名 |
| `shares` | number | | `0` | 持股數量 |
| `identity` | string | | `"natural"` | `"natural"` 或 `"corporate"` |
| `id_number` | string | | `""` | 身份證號碼 |
| `address` | string | | `""` | 通訊地址 |
| `email` | string | | `""` | 電郵地址 |
| `share_type` | string | | `""` | 股份類型（如 `"Ordinary 普通股"`） |

---

## 輸入格式

API 接受以下三種 JSON 格式：

### 格式一：單筆物件
```json
{
  "name": "ABC Ltd",
  "company_number": "12345678",
  "officers": [...],
  "shareholders": [...]
}
```

### 格式二：批量陣列（包在 companies 內）
```json
{
  "companies": [
    {"name": "A Ltd", "company_number": "11111111", ...},
    {"name": "B Ltd", "company_number": "22222222", ...}
  ]
}
```

### 格式三：純陣列
```json
[
  {"name": "A Ltd", "company_number": "11111111", ...},
  {"name": "B Ltd", "company_number": "22222222", ...}
]
```

---

## 回應格式

```json
{
  "imported": 5,
  "skipped": 2,
  "skipped_br_numbers": ["11111111", "22222222"],
  "errors": []
}
```

| 欄位 | 說明 |
|------|------|
| `imported` | 成功導入的公司數量 |
| `skipped` | 因重複而跳過的公司數量 |
| `skipped_br_numbers` | 被跳過的 BR 號碼列表 |
| `errors` | 錯誤訊息列表（部分失敗時） |

---

## 注意事項

1. **重複判斷**: 僅以 `company_number` 判斷，已存在則整間公司（含 officers、shareholders）跳過
2. **批量建議**: 大量導入建議分批，每批 50-100 間公司
3. **編碼**: 支援 UTF-8 中文字元
4. **錯誤處理**: 單間公司失敗不影響其他公司的導入，錯誤會記錄在 `errors` 陣列中
