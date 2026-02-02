# NAR1 表格欄位對照表

本文件說明 NAR1 周年申報表 PDF 模板的表格欄位編號與對應資料的映射關係。

## 欄位命名規則

PDF 模板中的欄位採用以下命名格式：
- `fill_X_P.Y` - 文字輸入欄位，X 為該頁的欄位序號，Y 為頁碼
- `cb_X_P.Y` - 勾選框欄位，X 為該頁的欄位序號，Y 為頁碼

---

## 第 1 頁 (Page 1) - 公司基本資料 / 業務性質 / 結算日期 / 註冊地址

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.1` | 文字 | 頁頭商業登記號碼 (前 8 位) | `brNumber` (前 8 位) |
| `fill_2_P.1` | 文字 | 1. 公司名稱 | `name` |
| `fill_3_P.1` | 文字 | 2. 商業名稱 (如有的話) | `tradingName` |
| `cb_1_P.1` | 勾選 | 3. 公司類別 - 私人公司 | `companyType` 包含「私人」或 "private" |
| `cb_2_P.1` | 勾選 | 3. 公司類別 - 公眾公司 | `companyType` 包含「公眾」或 "public" |
| `cb_3_P.1` | 勾選 | 3. 公司類別 - 擔保有限公司 | `companyType` 包含「擔保」|
| `fill_4_P.1` | 文字 | 9. 經營業務性質 - 編碼 (Code) | `businessCode` |
| `fill_5_P.1` | 文字 | 9. 經營業務性質 - 描述 (Description) | `businessNature` |
| `fill_6_P.1` | 文字 | 4. 結算日期 - 日 (DD) | `returnDate` 中的日 |
| `fill_7_P.1` | 文字 | 4. 結算日期 - 月 (MM) | `returnDate` 中的月 |
| `fill_8_P.1` | 文字 | 4. 結算日期 - 年 (YYYY) | `returnDate` 中的年 |
| `fill_9_P.1` | 文字 | 5. 財務報表期間開始 - 日 | (私人公司無需填寫) |
| `fill_10_P.1` | 文字 | 5. 財務報表期間開始 - 月 | (私人公司無需填寫) |
| `fill_11_P.1` | 文字 | 5. 財務報表期間開始 - 年 | (私人公司無需填寫) |
| `fill_12_P.1` | 文字 | 5. 財務報表期間結束 - 日 | (私人公司無需填寫) |
| `fill_13_P.1` | 文字 | 5. 財務報表期間結束 - 月 | (私人公司無需填寫) |
| `fill_14_P.1` | 文字 | 5. 財務報表期間結束 - 年 | (私人公司無需填寫) |
| `fill_15_P.1` | 文字 | 6. 註冊地址 - 室／樓／座等 | `registeredOffice.flat` |
| `fill_16_P.1` | 文字 | 6. 註冊地址 - 大廈 | `registeredOffice.building` |
| `fill_17_P.1` | 文字 | 6. 註冊地址 - 街道 | `registeredOffice.street` |
| `fill_18_P.1` | 文字 | 6. 註冊地址 - 區 | `registeredOffice.district` |

---

## 第 2 頁 (Page 2) - 按揭及押記 / 成員人數 / 股本

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.2` | 文字 | 頁頭商業登記號碼 | `brNumber` |
| `fill_2_P.2` | 文字 | 9. 按揭及押記負債總額 | `mortgageAmount` |
| `fill_3_P.2` | 文字 | 10. 無股本公司成員人數 | (適用於無股本公司) |
| `fill_4_P.2` ~ `fill_15_P.2` | 文字 | 11. 股本資料表格 | 股份類別、貨幣、數量等 |

---

## 第 3 頁 (Page 3) - 公司秘書 (自然人) - 12A

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.3` | 文字 | 頁頭商業登記號碼 | `brNumber` |
| `fill_2_P.3` | 文字 | 15. 中文姓名 | `secretaries[0].nameChinese` |
| `fill_3_P.3` | 文字 | 15. 英文姓名 - 姓氏 (Surname) | `secretaries[0].nameEnglish` 最後一個詞 |
| `fill_4_P.3` | 文字 | 15. 英文姓名 - 其他名字 (Other Names) | `secretaries[0].nameEnglish` 除姓氏外 |
| `fill_5_P.3` | 文字 | 前用姓名 - 中文 | (如適用) |
| `fill_6_P.3` | 文字 | 前用姓名 - 英文 | (如適用) |
| `fill_7_P.3` | 文字 | 別名 - 中文 | (如適用) |
| `fill_8_P.3` | 文字 | 別名 - 英文 | (如適用) |
| `fill_9_P.3` | 文字 | 16. 香港通訊地址 - 室／樓／座等 | `secretaries[0].address.flat` |
| `fill_10_P.3` | 文字 | 16. 香港通訊地址 - 大廈 | `secretaries[0].address.building` |
| `fill_11_P.3` | 文字 | 16. 香港通訊地址 - 街道 | `secretaries[0].address.street` |
| `fill_12_P.3` | 文字 | 16. 香港通訊地址 - 區 | `secretaries[0].address.district` |
| `fill_13_P.3` | 文字 | 17. 電郵地址 | `secretaries[0].email` |
| `fill_14_P.3` | 文字 | 18a. 身分識別 - 香港身分證部分號碼 | `secretaries[0].hkidPartial` |
| `fill_15_P.3` | 文字 | 18b. 護照 - 簽發國家/地區 | `secretaries[0].passportCountry` |
| `cb_1_P.3` | 勾選 | 20. 無須領有牌照 | (如適用) |

---

## 第 4 頁 (Page 4) - 公司秘書 (法人團體) - 12B

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.4` | 文字 | 頁頭商業登記號碼 | `brNumber` |
| `fill_2_P.4` | 文字 | 21. 中文名稱 | 法人秘書 `nameChinese` |
| `fill_3_P.4` | 文字 | 21. 英文名稱 | 法人秘書 `nameEnglish` |
| `fill_4_P.4` | 文字 | 22. 香港地址 - 室／樓／座等 | 法人秘書地址 |
| `fill_5_P.4` | 文字 | 22. 香港地址 - 大廈 | 法人秘書地址 |
| `fill_6_P.4` | 文字 | 22. 香港地址 - 街道 | 法人秘書地址 |
| `fill_7_P.4` | 文字 | 22. 香港地址 - 區 | 法人秘書地址 |
| `fill_8_P.4` | 文字 | 17. 電郵地址 | 法人秘書 `email` |
| `fill_9_P.4` | 文字 | 19. 商業登記號碼 | 法人秘書 `brNumber` |
| `cb_1_P.4` | 勾選 | 20. 無須領有牌照 | (如適用) |

---

## 第 5 頁 (Page 5) - 董事 (自然人) - 13A

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.5` | 文字 | 頁頭商業登記號碼 | `brNumber` |
| `cb_1_P.5` | 勾選 | 23. 身分 - 董事 | 勾選「董事」|
| `cb_2_P.5` | 勾選 | 23. 身分 - 候補董事 | 如適用 |
| `fill_2_P.5` | 文字 | 24. 中文姓名 | `directors[0].nameChinese` |
| `fill_3_P.5` | 文字 | 24. 英文姓名 - 姓氏 (Surname) | `directors[0].nameEnglish` 最後一個詞 |
| `fill_4_P.5` | 文字 | 24. 英文姓名 - 其他名字 (Other Names) | `directors[0].nameEnglish` 除姓氏外 |
| `fill_5_P.5` | 文字 | 前用姓名 - 中文 | (如適用) |
| `fill_6_P.5` | 文字 | 前用姓名 - 英文 | (如適用) |
| `fill_7_P.5` | 文字 | 別名 - 中文 | (如適用) |
| `fill_8_P.5` | 文字 | 別名 - 英文 | (如適用) |
| `fill_9_P.5` | 文字 | 25. 通訊地址 - 室／樓／座等 | `directors[0].address.flat` |
| `fill_10_P.5` | 文字 | 25. 通訊地址 - 大廈 | `directors[0].address.building` |
| `fill_11_P.5` | 文字 | 25. 通訊地址 - 街道 | `directors[0].address.street` |
| `fill_12_P.5` | 文字 | 25. 通訊地址 - 區/市/省/郵遞區號等 | `directors[0].address.district` |
| `fill_13_P.5` | 文字 | 25. 通訊地址 - 國家/地區 | `directors[0].address.country` |
| `fill_14_P.5` | 文字 | 26. 電郵地址 | `directors[0].email` |
| `fill_15_P.5` | 文字 | 27a. 身分識別 - 香港身分證部分號碼 | `directors[0].hkidPartial` |

---

## 第 6 頁 (Page 6) - 董事 (法人團體) - 13B

| 欄位編號 | 類型 | 表格項目 | 資料來源 |
|---------|------|---------|---------|
| `fill_1_P.6` | 文字 | 頁頭商業登記號碼 | `brNumber` |
| `cb_1_P.6` | 勾選 | 23. 身分 - 董事 | 勾選「董事」|
| `cb_2_P.6` | 勾選 | 23. 身分 - 候補董事 | 如適用 |
| `cb_3_P.6` | 勾選 | 在香港成立 | 如適用 |
| `cb_4_P.6` | 勾選 | 在香港以外地方成立 | 如適用 |
| `fill_2_P.6` | 文字 | 中文名稱 | 法人董事 `nameChinese` |
| `fill_3_P.6` | 文字 | 英文名稱 | 法人董事 `nameEnglish` |
| `fill_4_P.6` | 文字 | 地址 - 室／樓／座等 | 法人董事地址 |
| `fill_5_P.6` | 文字 | 地址 - 大廈 | 法人董事地址 |
| `fill_6_P.6` | 文字 | 地址 - 街道 | 法人董事地址 |
| `fill_7_P.6` | 文字 | 地址 - 區 | 法人董事地址 |
| `fill_8_P.6` | 文字 | 電郵地址 | 法人董事 `email` |
| `fill_9_P.6` | 文字 | 商業登記號碼 | 法人董事 `brNumber` |

---

## 其他頁面摘要

| 頁碼 | 內容 | 主要欄位 |
|-----|------|---------|
| 第 7 頁 | 備任董事 (Reserve Director) | `fill_X_P.7`, `cb_X_P.7` |
| 第 8 頁 | 法律程序文件送達代理人 | `fill_X_P.8`, `Dropdown_X_P.8` |
| 第 9 頁 | 成員詳情 (Particulars of Members) | `fill_X_P.9`, `cb_X_P.9` |
| 第 10-13 頁 | 附表一 - 非上市公司成員 | `fill_X_P.10` ~ `fill_X_P.13` |
| 第 14-15 頁 | 聲明及簽署 | `fill_X_P.14`, `fill_X_P.15`, `cb_X_P.14` |

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
4. 勾選框使用 `check()` 方法標記
5. 需在 `form.flatten()` 前調用 `form.updateFieldAppearances(chineseFont)` 確保中文正確渲染
