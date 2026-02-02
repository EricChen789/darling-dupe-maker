# NAR1 表格欄位對照表

本文件說明 NAR1 周年申報表 PDF 模板的表格欄位編號與對應資料的映射關係。

## 欄位命名規則

PDF 模板中的欄位採用以下命名格式：
- `fill_X_P.Y` - 文字輸入欄位，X 為該頁的欄位序號，Y 為頁碼
- `cb_X_P.Y` - 勾選框欄位，X 為該頁的欄位序號，Y 為頁碼

---

## 第 1 頁 (Page 1) - 公司基本資料

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.1` | 文字 | 商業登記號碼 (前 8 位) | `brNumber` (前 8 位) |
| `fill_2_P.1` | 文字 | 商業登記號碼 (完整) | `brNumber` |
| `fill_3_P.1` | 文字 | 1. 公司名稱 | `name` |
| `fill_4_P.1` | 文字 | 2. 商業名稱 | `tradingName` |
| `cb_1_P.1` | 勾選 | 3. 公司類別 - 私人公司 | `companyType` 包含「私人」|
| `cb_2_P.1` | 勾選 | 3. 公司類別 - 公眾公司 | `companyType` 包含「公眾」|
| `cb_3_P.1` | 勾選 | 3. 公司類別 - 擔保有限公司 | `companyType` 包含「擔保」|

---

## 第 2 頁 (Page 2) - 結算日期 / 業務性質 / 地址

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.2` | 文字 | 5. 結算日期 - 日 (DD) | `returnDate` 中的日 |
| `fill_2_P.2` | 文字 | 5. 結算日期 - 月 (MM) | `returnDate` 中的月 |
| `fill_3_P.2` | 文字 | 5. 結算日期 - 年 (YYYY) | `returnDate` 中的年 |
| `fill_4_P.2` | 文字 | 4. 經營業務性質 - 編碼 | `businessCode` |
| `fill_5_P.2` | 文字 | 4. 經營業務性質 - 描述 | `businessNature` |

---

## 第 3 頁 (Page 3) - 註冊辦事處地址

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.3` | 文字 | 6. 註冊地址 - 室／樓／座等 | `registeredOffice.flat` |
| `fill_2_P.3` | 文字 | 6. 註冊地址 - 大廈 | `registeredOffice.building` |
| `fill_3_P.3` | 文字 | 6. 註冊地址 - 街道 | `registeredOffice.street` |
| `fill_4_P.3` | 文字 | 6. 註冊地址 - 區 | `registeredOffice.district` |

---

## 第 4 頁 (Page 4) - 公司秘書 (自然人)

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.4` | 文字 | 12A. 秘書中文姓名 | `secretaries[0].nameChinese` |
| `fill_2_P.4` | 文字 | 12A. 秘書英文姓氏 (Surname) | `secretaries[0].nameEnglish` 最後一個詞 |
| `fill_3_P.4` | 文字 | 12A. 秘書其他英文名字 | `secretaries[0].nameEnglish` 除姓氏外 |
| `fill_5_P.4` | 文字 | 12A. 秘書電郵地址 | `secretaries[0].email` |

---

## 第 5 頁 (Page 5) - 公司秘書 (法人團體)

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.5` | 文字 | 12B. 秘書中文名稱 | 法人秘書 `nameChinese` |
| `fill_2_P.5` | 文字 | 12B. 秘書英文名稱 | 法人秘書 `nameEnglish` |
| `fill_3_P.5` | 文字 | 12B. 秘書商業登記號碼 | 法人秘書 `brNumber` |
| `fill_5_P.5` | 文字 | 12B. 秘書電郵地址 | 法人秘書 `email` |

---

## 第 6 頁 (Page 6) - 董事 (自然人)

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `cb_1_P.6` | 勾選 | 13A. 身分 - 董事 | 勾選「董事」|
| `cb_2_P.6` | 勾選 | 13A. 身分 - 候補董事 | 如適用 |
| `fill_1_P.6` | 文字 | 13A. 董事中文姓名 | `directors[0].nameChinese` |
| `fill_2_P.6` | 文字 | 13A. 董事英文姓氏 (Surname) | `directors[0].nameEnglish` 最後一個詞 |
| `fill_3_P.6` | 文字 | 13A. 董事其他英文名字 | `directors[0].nameEnglish` 除姓氏外 |
| `fill_5_P.6` | 文字 | 13A. 董事電郵地址 | `directors[0].email` |

---

## 第 7 頁 (Page 7) - 董事 (法人團體)

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `cb_1_P.7` | 勾選 | 13B. 身分 - 董事 | 勾選「董事」|
| `fill_1_P.7` | 文字 | 13B. 董事中文名稱 | 法人董事 `nameChinese` |
| `fill_2_P.7` | 文字 | 13B. 董事英文名稱 | 法人董事 `nameEnglish` |
| `fill_4_P.7` | 文字 | 13B. 董事商業登記號碼 | 法人董事 `brNumber` |
| `fill_5_P.7` | 文字 | 13B. 董事電郵地址 | 法人董事 `email` |

---

## 其他頁面 (Pages 8-15)

| 頁碼 | 內容 |
|-----|------|
| 第 8 頁 | 備任董事 (Reserve Director) |
| 第 9 頁 | 成員詳情 (Particulars of Members) |
| 第 10-13 頁 | 附表一 - 非上市公司成員 |
| 第 14-15 頁 | 聲明及簽署 |

---

## 欄位填入邏輯

### 英文姓名拆分規則
英文姓名格式預設為 `"FirstName LASTNAME"` 或 `"FirstName MiddleName LASTNAME"`：
- **姓氏 (Surname)**: 最後一個詞（大寫）
- **其他名字 (Other Names)**: 除最後一個詞外的所有詞

例如：`"CHAN Tai Man"` → 姓氏: `Man`, 其他名字: `CHAN Tai`

### 公司類別勾選規則
- 如 `companyType` 包含「私人」或 "private" → 勾選 `cb_1_P.1`
- 如 `companyType` 包含「公眾」或 "public" → 勾選 `cb_2_P.1`
- 如 `companyType` 包含「擔保」→ 勾選 `cb_3_P.1`

### 日期格式
- 輸入格式：`YYYY-MM-DD` (ISO 8601)
- 填入格式：日 (DD)、月 (MM)、年 (YYYY) 分開填入不同欄位

---

## 注意事項

1. 部分欄位有字數限制（如 `fill_1_P.X` 通常限制 8 字元）
2. 中文字體使用 Noto Sans TC 確保正確顯示
3. PDF 模板共 27 頁，包含多種續頁格式
4. 勾選框使用 `setAppearance` 或 `check()` 方法標記
