// NAR1 PDF Field Mapping Data
// Auto-generated from NAR1-template-v2.pdf (27 pages, ~330 fields)

export interface FieldMapping {
  field: string;
  description: string;
  dataSource: string;
}

// ============ Page 1 - 公司基本資料 / 業務性質 / 結算日期 / 註冊地址 ============
export const page1Fields: FieldMapping[] = [
  { field: 'fill_1_P.1', description: '頁頭商業登記號碼 (8位)', dataSource: 'brNumber.slice(0,8)' },
  { field: 'fill_2_P.1', description: '1. 公司名稱', dataSource: 'name' },
  { field: 'fill_3_P.1', description: '2. 商業名稱 (如有)', dataSource: 'tradingName' },
  { field: 'cb_1_P.1', description: '3. 公司類別 - 私人公司', dataSource: 'companyType 包含「私人」' },
  { field: 'cb_2_P.1', description: '3. 公司類別 - 公眾公司', dataSource: 'companyType 包含「公眾」' },
  { field: 'cb_3_P.1', description: '3. 公司類別 - 擔保有限公司', dataSource: 'companyType 包含「擔保」' },
  { field: 'fill_4_P.1', description: '9. 業務性質 - 編碼', dataSource: 'businessCode' },
  { field: 'fill_5_P.1', description: '9. 業務性質 - 描述', dataSource: 'businessNature' },
  { field: 'fill_6_P.1', description: '4. 結算日期 - 日 (DD)', dataSource: 'returnDate.day' },
  { field: 'fill_7_P.1', description: '4. 結算日期 - 月 (MM)', dataSource: 'returnDate.month' },
  { field: 'fill_8_P.1', description: '4. 結算日期 - 年 (YYYY)', dataSource: 'returnDate.year' },
  { field: 'fill_9_P.1', description: '5. 財務報表期間開始 - 日', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_10_P.1', description: '5. 財務報表期間開始 - 月', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_11_P.1', description: '5. 財務報表期間開始 - 年', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_12_P.1', description: '5. 財務報表期間結束 - 日', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_13_P.1', description: '5. 財務報表期間結束 - 月', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_14_P.1', description: '5. 財務報表期間結束 - 年', dataSource: '(私人公司無需填寫)' },
  { field: 'fill_15_P.1', description: '6. 註冊地址 - 室／樓／座', dataSource: 'registeredOffice.flat' },
  { field: 'fill_16_P.1', description: '6. 註冊地址 - 大廈', dataSource: 'registeredOffice.building' },
  { field: 'fill_17_P.1', description: '6. 註冊地址 - 街道', dataSource: 'registeredOffice.street' },
  { field: 'fill_18_P.1', description: '6. 註冊地址 - 區', dataSource: 'registeredOffice.district' },
  { field: 'fill_19_P.1', description: '7. 電郵地址', dataSource: 'email' },
  { field: 'fill_20_P.1', description: '8. 網址', dataSource: 'website' },
  { field: 'fill_21_P.1', description: '額外欄位 21', dataSource: '(待確認)' },
  { field: 'fill_22_P.1', description: '額外欄位 22', dataSource: '(待確認)' },
  { field: 'fill_23_P.1', description: '額外欄位 23', dataSource: '(待確認)' },
  { field: 'fill_24_P.1', description: '額外欄位 24', dataSource: '(待確認)' },
];

// ============ Page 2 - 股本資料 ============
export const page2Fields: FieldMapping[] = [
  { field: 'fill_1_P.2', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.2', description: '9. 按揭及押記負債總額', dataSource: 'mortgageAmount' },
  { field: 'fill_3_P.2', description: '10. 無股本公司成員人數', dataSource: '(適用於無股本公司)' },
  { field: 'fill_4_P.2', description: '11. 股本 - 股份類別 1', dataSource: 'shareCapital[0].class' },
  { field: 'fill_5_P.2', description: '11. 股本 - 貨幣 1', dataSource: 'shareCapital[0].currency' },
  { field: 'fill_6_P.2', description: '11. 股本 - 股份數目 1', dataSource: 'shareCapital[0].shares' },
  { field: 'fill_7_P.2', description: '11. 股本 - 繳足款額 1', dataSource: 'shareCapital[0].paidUp' },
  { field: 'fill_8_P.2', description: '11. 股本 - 股份類別 2', dataSource: 'shareCapital[1].class' },
  { field: 'fill_9_P.2', description: '11. 股本 - 貨幣 2', dataSource: 'shareCapital[1].currency' },
  { field: 'fill_10_P.2', description: '11. 股本 - 股份數目 2', dataSource: 'shareCapital[1].shares' },
  { field: 'fill_11_P.2', description: '11. 股本 - 繳足款額 2', dataSource: 'shareCapital[1].paidUp' },
  { field: 'fill_12_P.2', description: '11. 股本 - 股份類別 3', dataSource: 'shareCapital[2].class' },
  { field: 'fill_13_P.2', description: '11. 股本 - 貨幣 3', dataSource: 'shareCapital[2].currency' },
  { field: 'fill_14_P.2', description: '11. 股本 - 股份數目 3', dataSource: 'shareCapital[2].shares' },
  { field: 'fill_15_P.2', description: '11. 股本 - 繳足款額 3', dataSource: 'shareCapital[2].paidUp' },
  { field: 'fill_16_P.2', description: '11. 股本 - 股份類別 4', dataSource: 'shareCapital[3].class' },
  { field: 'fill_17_P.2', description: '11. 股本 - 貨幣 4', dataSource: 'shareCapital[3].currency' },
  { field: 'fill_18_P.2', description: '11. 股本 - 股份數目 4', dataSource: 'shareCapital[3].shares' },
  { field: 'fill_19_P.2', description: '11. 股本 - 繳足款額 4', dataSource: 'shareCapital[3].paidUp' },
  { field: 'fill_20_P.2', description: '11. 股本 - 股份類別 5', dataSource: 'shareCapital[4].class' },
  { field: 'fill_21_P.2', description: '11. 股本 - 貨幣 5', dataSource: 'shareCapital[4].currency' },
  { field: 'fill_22_P.2', description: '11. 股本 - 股份數目 5', dataSource: 'shareCapital[4].shares' },
  { field: 'fill_23_P.2', description: '11. 股本 - 繳足款額 5', dataSource: 'shareCapital[4].paidUp' },
  { field: 'fill_24_P.2', description: '11. 股本 - 股份類別 6', dataSource: 'shareCapital[5].class' },
  { field: 'fill_25_P.2', description: '11. 股本 - 貨幣 6', dataSource: 'shareCapital[5].currency' },
  { field: 'fill_26_P.2', description: '11. 股本 - 股份數目 6', dataSource: 'shareCapital[5].shares' },
  { field: 'fill_27_P.2', description: '11. 股本 - 繳足款額 6', dataSource: 'shareCapital[5].paidUp' },
  { field: 'fill_28_P.2', description: '額外欄位 28', dataSource: '(待確認)' },
  { field: 'fill_29_P.2', description: '額外欄位 29', dataSource: '(待確認)' },
];

// ============ Page 3 - 公司秘書 (自然人) 12A ============
export const page3Fields: FieldMapping[] = [
  { field: 'fill_1_P.3', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.3', description: '15. 中文姓名', dataSource: 'secretaries[0].nameChinese' },
  { field: 'fill_3_P.3', description: '15. 英文姓氏 (Surname)', dataSource: 'secretaries[0].surname' },
  { field: 'fill_4_P.3', description: '15. 其他英文名字', dataSource: 'secretaries[0].otherNames' },
  { field: 'fill_5_P.3', description: '前用姓名 - 中文', dataSource: '(如適用)' },
  { field: 'fill_6_P.3', description: '前用姓名 - 英文', dataSource: '(如適用)' },
  { field: 'fill_7_P.3', description: '別名 - 中文', dataSource: '(如適用)' },
  { field: 'fill_8_P.3', description: '別名 - 英文', dataSource: '(如適用)' },
  { field: 'fill_9_P.3', description: '16. 通訊地址 - 室／樓／座', dataSource: 'secretaries[0].address.flat' },
  { field: 'fill_10_P.3', description: '16. 通訊地址 - 大廈', dataSource: 'secretaries[0].address.building' },
  { field: 'fill_11_P.3', description: '16. 通訊地址 - 街道', dataSource: 'secretaries[0].address.street' },
  { field: 'fill_12_P.3', description: '16. 通訊地址 - 區', dataSource: 'secretaries[0].address.district' },
  { field: 'fill_13_P.3', description: '17. 電郵地址', dataSource: 'secretaries[0].email' },
  { field: 'fill_14_P.3', description: '18a. 香港身分證部分號碼', dataSource: 'secretaries[0].hkidPartial' },
  { field: 'fill_15_P.3', description: '18b. 護照簽發國家/地區', dataSource: 'secretaries[0].passportCountry' },
  { field: 'fill_16_P.3', description: '18b. 護照號碼', dataSource: 'secretaries[0].passportNumber' },
  { field: 'fill_17_P.3', description: '19. 牌照號碼', dataSource: 'secretaries[0].licenseNumber' },
  { field: 'fill_18_P.3', description: '額外欄位 18', dataSource: '(待確認)' },
  { field: 'cb_1_P.3', description: '20. 無須領有牌照', dataSource: 'secretaries[0].noLicenseRequired' },
];

// ============ Page 4 - 公司秘書 (法人團體) 12B ============
export const page4Fields: FieldMapping[] = [
  { field: 'fill_1_P.4', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.4', description: '21. 法人秘書中文名稱', dataSource: 'corpSecretary.nameChinese' },
  { field: 'fill_3_P.4', description: '21. 法人秘書英文名稱', dataSource: 'corpSecretary.nameEnglish' },
  { field: 'fill_4_P.4', description: '22. 地址 - 室／樓／座', dataSource: 'corpSecretary.address.flat' },
  { field: 'fill_5_P.4', description: '22. 地址 - 大廈', dataSource: 'corpSecretary.address.building' },
  { field: 'fill_6_P.4', description: '22. 地址 - 街道', dataSource: 'corpSecretary.address.street' },
  { field: 'fill_7_P.4', description: '22. 地址 - 區', dataSource: 'corpSecretary.address.district' },
  { field: 'fill_8_P.4', description: '17. 電郵地址', dataSource: 'corpSecretary.email' },
  { field: 'fill_9_P.4', description: '19. 商業登記號碼', dataSource: 'corpSecretary.brNumber' },
  { field: 'cb_1_P.4', description: '20. 無須領有牌照', dataSource: 'corpSecretary.noLicenseRequired' },
];

// ============ Page 5 - 董事 (自然人) 13A ============
export const page5Fields: FieldMapping[] = [
  { field: 'fill_1_P.5', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'cb_1_P.5', description: '23. 身分 - 董事', dataSource: '自動勾選' },
  { field: 'cb_2_P.5', description: '23. 身分 - 候補董事', dataSource: '(如適用)' },
  { field: 'fill_2_P.5', description: '24. 中文姓名', dataSource: 'directors[0].nameChinese' },
  { field: 'fill_3_P.5', description: '24. 英文姓氏', dataSource: 'directors[0].surname' },
  { field: 'fill_4_P.5', description: '24. 其他英文名字', dataSource: 'directors[0].otherNames' },
  { field: 'fill_5_P.5', description: '前用姓名 - 中文', dataSource: '(如適用)' },
  { field: 'fill_6_P.5', description: '前用姓名 - 英文', dataSource: '(如適用)' },
  { field: 'fill_7_P.5', description: '別名 - 中文', dataSource: '(如適用)' },
  { field: 'fill_8_P.5', description: '別名 - 英文', dataSource: '(如適用)' },
  { field: 'fill_9_P.5', description: '25. 通訊地址 - 室／樓／座', dataSource: 'directors[0].address.flat' },
  { field: 'fill_10_P.5', description: '25. 通訊地址 - 大廈', dataSource: 'directors[0].address.building' },
  { field: 'fill_11_P.5', description: '25. 通訊地址 - 街道', dataSource: 'directors[0].address.street' },
  { field: 'fill_12_P.5', description: '25. 通訊地址 - 區/市/省/郵遞區號', dataSource: 'directors[0].address.district' },
  { field: 'fill_13_P.5', description: '25. 通訊地址 - 國家/地區', dataSource: 'directors[0].address.country' },
  { field: 'fill_14_P.5', description: '26. 電郵地址', dataSource: 'directors[0].email' },
  { field: 'fill_15_P.5', description: '27a. 香港身分證部分號碼', dataSource: 'directors[0].hkidPartial' },
  { field: 'fill_16_P.5', description: '27b. 護照簽發國家', dataSource: 'directors[0].passportCountry' },
  { field: 'fill_17_P.5', description: '27b. 護照號碼', dataSource: 'directors[0].passportNumber' },
  { field: 'fill_18_P.5', description: '額外欄位 18', dataSource: '(待確認)' },
];

// ============ Page 6 - 董事 (法人團體) 13B ============
export const page6Fields: FieldMapping[] = [
  { field: 'fill_1_P.6', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'cb_1_P.6', description: '23. 身分 - 董事', dataSource: '自動勾選' },
  { field: 'cb_2_P.6', description: '23. 身分 - 候補董事', dataSource: '(如適用)' },
  { field: 'cb_3_P.6', description: '在香港成立', dataSource: '(如適用)' },
  { field: 'cb_4_P.6', description: '在香港以外地方成立', dataSource: '(如適用)' },
  { field: 'fill_2_P.6', description: '法人董事中文名稱', dataSource: 'corpDirector.nameChinese' },
  { field: 'fill_3_P.6', description: '法人董事英文名稱', dataSource: 'corpDirector.nameEnglish' },
  { field: 'fill_4_P.6', description: '地址 - 室／樓／座', dataSource: 'corpDirector.address.flat' },
  { field: 'fill_5_P.6', description: '地址 - 大廈', dataSource: 'corpDirector.address.building' },
  { field: 'fill_6_P.6', description: '地址 - 街道', dataSource: 'corpDirector.address.street' },
  { field: 'fill_7_P.6', description: '地址 - 區', dataSource: 'corpDirector.address.district' },
  { field: 'fill_8_P.6', description: '電郵地址', dataSource: 'corpDirector.email' },
  { field: 'fill_9_P.6', description: '商業登記號碼', dataSource: 'corpDirector.brNumber' },
  { field: 'fill_10_P.6', description: '額外欄位 10', dataSource: '(待確認)' },
  { field: 'fill_11_P.6', description: '額外欄位 11', dataSource: '(待確認)' },
  { field: 'fill_12_P.6', description: '額外欄位 12', dataSource: '(待確認)' },
  { field: 'fill_13_P.6', description: '額外欄位 13', dataSource: '(待確認)' },
  { field: 'fill_14_P.6', description: '額外欄位 14', dataSource: '(待確認)' },
  { field: 'fill_15_P.6', description: '額外欄位 15', dataSource: '(待確認)' },
  { field: 'fill_16_P.6', description: '額外欄位 16', dataSource: '(待確認)' },
  { field: 'fill_17_P.6', description: '額外欄位 17', dataSource: '(待確認)' },
  { field: 'fill_18_P.6', description: '額外欄位 18', dataSource: '(待確認)' },
  { field: 'fill_19_P.6', description: '額外欄位 19', dataSource: '(待確認)' },
  { field: 'fill_20_P.6', description: '額外欄位 20', dataSource: '(待確認)' },
  { field: 'fill_21_P.6', description: '額外欄位 21', dataSource: '(待確認)' },
];

// ============ Page 7 - 備任董事 ============
export const page7Fields: FieldMapping[] = [
  { field: 'fill_1_P.7', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.7', description: '備任董事中文姓名', dataSource: 'reserveDirector.nameChinese' },
  { field: 'fill_3_P.7', description: '備任董事英文姓氏', dataSource: 'reserveDirector.surname' },
  { field: 'fill_4_P.7', description: '備任董事其他英文名字', dataSource: 'reserveDirector.otherNames' },
  { field: 'fill_5_P.7', description: '額外欄位 5', dataSource: '(待確認)' },
  { field: 'fill_6_P.7', description: '額外欄位 6', dataSource: '(待確認)' },
  { field: 'fill_7_P.7', description: '額外欄位 7', dataSource: '(待確認)' },
  { field: 'fill_8_P.7', description: '額外欄位 8', dataSource: '(待確認)' },
  { field: 'fill_9_P.7', description: '額外欄位 9', dataSource: '(待確認)' },
  { field: 'fill_10_P.7', description: '額外欄位 10', dataSource: '(待確認)' },
  { field: 'fill_11_P.7', description: '額外欄位 11', dataSource: '(待確認)' },
  { field: 'fill_12_P.7', description: '額外欄位 12', dataSource: '(待確認)' },
  { field: 'fill_13_P.7', description: '額外欄位 13', dataSource: '(待確認)' },
  { field: 'fill_14_P.7', description: '額外欄位 14', dataSource: '(待確認)' },
  { field: 'fill_15_P.7', description: '額外欄位 15', dataSource: '(待確認)' },
  { field: 'fill_16_P.7', description: '額外欄位 16', dataSource: '(待確認)' },
  { field: 'fill_17_P.7', description: '額外欄位 17', dataSource: '(待確認)' },
];

// ============ Page 8 - 法律程序文件送達代理人 ============
export const page8Fields: FieldMapping[] = [
  { field: 'fill_1_P.8', description: '頁頭商業登記號碼', dataSource: 'brNumber' },
  { field: 'fill_2_P.8', description: '送達代理人中文姓名', dataSource: 'serviceAgent.nameChinese' },
  { field: 'fill_3_P.8', description: '送達代理人英文姓名', dataSource: 'serviceAgent.nameEnglish' },
  { field: 'fill_4_P.8', description: '額外欄位 4', dataSource: '(待確認)' },
  { field: 'fill_5_P.8', description: '額外欄位 5', dataSource: '(待確認)' },
  { field: 'fill_6_P.8', description: '額外欄位 6', dataSource: '(待確認)' },
  { field: 'fill_7_P.8', description: '額外欄位 7', dataSource: '(待確認)' },
  { field: 'fill_8_P.8', description: '額外欄位 8', dataSource: '(待確認)' },
  { field: 'fill_9_P.8', description: '額外欄位 9', dataSource: '(待確認)' },
  { field: 'fill_10_P.8', description: '額外欄位 10', dataSource: '(待確認)' },
  { field: 'fill_11_P.8', description: '額外欄位 11', dataSource: '(待確認)' },
  { field: 'fill_12_P.8', description: '額外欄位 12', dataSource: '(待確認)' },
  { field: 'Dropdown_1_P.8', description: '送達代理人類別下拉選單 1', dataSource: 'serviceAgent.type' },
  { field: 'Dropdown_2_P.8', description: '送達代理人類別下拉選單 2', dataSource: '(待確認)' },
  { field: 'cb_1_P.8', description: '勾選項 1', dataSource: '(如適用)' },
  { field: 'cb_2_P.8', description: '勾選項 2', dataSource: '(如適用)' },
  { field: 'cb_3_P.8', description: '勾選項 3', dataSource: '(如適用)' },
  { field: 'cb_4_P.8', description: '勾選項 4', dataSource: '(如適用)' },
];

// ============ Page 9 - 成員詳情 (附表一：非上市公司) ============
// 注意：附表頁 (9-15) 的 fill_1 是日期欄位 (DD)，不是 BR 號碼！
// BR 號碼在右側分成 4 個 2 位數欄位
export const page9Fields: FieldMapping[] = [
  { field: 'fill_1_P.9', description: '申報日期 - 日 (DD)', dataSource: 'returnDate.day' },
  { field: 'fill_2_P.9', description: '申報日期 - 月 (MM)', dataSource: 'returnDate.month' },
  { field: 'fill_3_P.9', description: '申報日期 - 年 (YYYY)', dataSource: 'returnDate.year' },
  { field: 'fill_4_P.9', description: 'BR 號碼分段 1 (第1-2位)', dataSource: 'brNumber.slice(0,2)' },
  { field: 'fill_5_P.9', description: 'BR 號碼分段 2 (第3-4位)', dataSource: 'brNumber.slice(2,4)' },
  { field: 'fill_6_P.9', description: 'BR 號碼分段 3 (第5-6位)', dataSource: 'brNumber.slice(4,6)' },
  { field: 'fill_7_P.9', description: 'BR 號碼分段 4 (第7-8位)', dataSource: 'brNumber.slice(6,8)' },
  { field: 'cb_1_P.9', description: '成員勾選項 1', dataSource: '(如適用)' },
  { field: 'cb_2_P.9', description: '成員勾選項 2', dataSource: '(如適用)' },
];

// ============ Pages 10-13 - 附表一：非上市公司成員 (多頁) ============
// 注意：所有附表頁的 fill_1~3 是日期欄位，fill_4~7 是 BR 號碼分段
export const page10Fields: FieldMapping[] = [
  { field: 'fill_1_P.10', description: '申報日期 - 日 (DD)', dataSource: 'returnDate.day' },
  { field: 'fill_2_P.10', description: '申報日期 - 月 (MM)', dataSource: 'returnDate.month' },
  { field: 'fill_3_P.10', description: '申報日期 - 年 (YYYY)', dataSource: 'returnDate.year' },
  { field: 'fill_4_P.10', description: 'BR 號碼分段 1 (第1-2位)', dataSource: 'brNumber.slice(0,2)' },
  { field: 'fill_5_P.10', description: 'BR 號碼分段 2 (第3-4位)', dataSource: 'brNumber.slice(2,4)' },
  { field: 'fill_6_P.10', description: 'BR 號碼分段 3 (第5-6位)', dataSource: 'brNumber.slice(4,6)' },
  { field: 'fill_7_P.10', description: 'BR 號碼分段 4 (第7-8位)', dataSource: 'brNumber.slice(6,8)' },
  { field: 'cb_1_P.10', description: '勾選項 1', dataSource: '(如適用)' },
  { field: 'cb_2_P.10', description: '勾選項 2', dataSource: '(如適用)' },
];

export const page11Fields: FieldMapping[] = [
  { field: 'fill_1_P.11', description: '申報日期 - 日 (DD)', dataSource: 'returnDate.day' },
  { field: 'fill_2_P.11', description: '申報日期 - 月 (MM)', dataSource: 'returnDate.month' },
  { field: 'fill_3_P.11', description: '申報日期 - 年 (YYYY)', dataSource: 'returnDate.year' },
  { field: 'fill_4_P.11', description: 'BR 號碼分段 1 (第1-2位)', dataSource: 'brNumber.slice(0,2)' },
  { field: 'fill_5_P.11', description: 'BR 號碼分段 2 (第3-4位)', dataSource: 'brNumber.slice(2,4)' },
  { field: 'fill_6_P.11', description: 'BR 號碼分段 3 (第5-6位)', dataSource: 'brNumber.slice(4,6)' },
  { field: 'fill_7_P.11', description: 'BR 號碼分段 4 (第7-8位)', dataSource: 'brNumber.slice(6,8)' },
  { field: 'cb_1_P.11', description: '勾選項 1', dataSource: '(如適用)' },
];

export const page12Fields: FieldMapping[] = [
  { field: 'fill_1_P.12', description: '申報日期 - 日 (DD)', dataSource: 'returnDate.day' },
  { field: 'fill_2_P.12', description: '申報日期 - 月 (MM)', dataSource: 'returnDate.month' },
  { field: 'fill_3_P.12', description: '申報日期 - 年 (YYYY)', dataSource: 'returnDate.year' },
  { field: 'fill_4_P.12', description: 'BR 號碼分段 1 (第1-2位)', dataSource: 'brNumber.slice(0,2)' },
  { field: 'fill_5_P.12', description: 'BR 號碼分段 2 (第3-4位)', dataSource: 'brNumber.slice(2,4)' },
  { field: 'fill_6_P.12', description: 'BR 號碼分段 3 (第5-6位)', dataSource: 'brNumber.slice(4,6)' },
  { field: 'fill_7_P.12', description: 'BR 號碼分段 4 (第7-8位)', dataSource: 'brNumber.slice(6,8)' },
  { field: 'cb_1_P.12', description: '勾選項 1', dataSource: '(如適用)' },
];

export const page13Fields: FieldMapping[] = [
  { field: 'fill_1_P.13', description: '申報日期 - 日 (DD)', dataSource: 'returnDate.day' },
  { field: 'fill_2_P.13', description: '申報日期 - 月 (MM)', dataSource: 'returnDate.month' },
  { field: 'fill_3_P.13', description: '申報日期 - 年 (YYYY)', dataSource: 'returnDate.year' },
  { field: 'fill_4_P.13', description: 'BR 號碼分段 1 (第1-2位)', dataSource: 'brNumber.slice(0,2)' },
  { field: 'fill_5_P.13', description: 'BR 號碼分段 2 (第3-4位)', dataSource: 'brNumber.slice(2,4)' },
  { field: 'fill_6_P.13', description: 'BR 號碼分段 3 (第5-6位)', dataSource: 'brNumber.slice(4,6)' },
  { field: 'fill_7_P.13', description: 'BR 號碼分段 4 (第7-8位)', dataSource: 'brNumber.slice(6,8)' },
  { field: 'cb_1_P.13', description: '勾選項 1', dataSource: '(如適用)' },
  { field: 'cb_2_P.13', description: '勾選項 2', dataSource: '(如適用)' },
];

// ============ Pages 14-15 - 聲明及簽署 ============
// 注意：附表頁的 fill_1~3 是日期，fill_4~7 是 BR 分段
export const page14Fields: FieldMapping[] = [
  { field: 'fill_1_P.14', description: '申報日期 - 日 (DD)', dataSource: 'returnDate.day' },
  { field: 'fill_2_P.14', description: '申報日期 - 月 (MM)', dataSource: 'returnDate.month' },
  { field: 'fill_3_P.14', description: '申報日期 - 年 (YYYY)', dataSource: 'returnDate.year' },
  { field: 'fill_4_P.14', description: 'BR 號碼分段 1 (第1-2位)', dataSource: 'brNumber.slice(0,2)' },
  { field: 'fill_5_P.14', description: 'BR 號碼分段 2 (第3-4位)', dataSource: 'brNumber.slice(2,4)' },
  { field: 'fill_6_P.14', description: 'BR 號碼分段 3 (第5-6位)', dataSource: 'brNumber.slice(4,6)' },
  { field: 'fill_7_P.14', description: 'BR 號碼分段 4 (第7-8位)', dataSource: 'brNumber.slice(6,8)' },
  { field: 'cb_1_P.14', description: '聲明確認勾選', dataSource: '(必須勾選)' },
  { field: 'cb_2_P.14', description: '勾選項 2', dataSource: '(如適用)' },
  { field: 'cb_3_P.14', description: '勾選項 3', dataSource: '(如適用)' },
  { field: 'cb_4_P.14', description: '勾選項 4', dataSource: '(如適用)' },
];

export const page15Fields: FieldMapping[] = [
  { field: 'fill_1_P.15', description: '申報日期 - 日 (DD)', dataSource: 'returnDate.day' },
  { field: 'fill_2_P.15', description: '申報日期 - 月 (MM)', dataSource: 'returnDate.month' },
  { field: 'fill_3_P.15', description: '申報日期 - 年 (YYYY)', dataSource: 'returnDate.year' },
  { field: 'fill_4_P.15', description: 'BR 號碼分段 1 (第1-2位)', dataSource: 'brNumber.slice(0,2)' },
  { field: 'fill_5_P.15', description: 'BR 號碼分段 2 (第3-4位)', dataSource: 'brNumber.slice(2,4)' },
  { field: 'fill_6_P.15', description: 'BR 號碼分段 3 (第5-6位)', dataSource: 'brNumber.slice(4,6)' },
  // Note: fill_7_P.15 does not exist in the template
];

// All page field mappings for easy iteration
export const allPageFields = [
  { page: 1, title: '第 1 頁 - 公司基本資料 / 業務性質 / 結算日期 / 註冊地址', fields: page1Fields },
  { page: 2, title: '第 2 頁 - 按揭及押記 / 成員人數 / 股本', fields: page2Fields },
  { page: 3, title: '第 3 頁 - 公司秘書 (自然人) 12A', fields: page3Fields },
  { page: 4, title: '第 4 頁 - 公司秘書 (法人團體) 12B', fields: page4Fields },
  { page: 5, title: '第 5 頁 - 董事 (自然人) 13A', fields: page5Fields },
  { page: 6, title: '第 6 頁 - 董事 (法人團體) 13B', fields: page6Fields },
  { page: 7, title: '第 7 頁 - 備任董事', fields: page7Fields },
  { page: 8, title: '第 8 頁 - 法律程序文件送達代理人', fields: page8Fields },
  { page: 9, title: '第 9 頁 - 成員詳情 (附表一)', fields: page9Fields },
  { page: 10, title: '第 10 頁 - 附表一：非上市公司成員', fields: page10Fields },
  { page: 11, title: '第 11 頁 - 附表一 (續)', fields: page11Fields },
  { page: 12, title: '第 12 頁 - 附表一 (續)', fields: page12Fields },
  { page: 13, title: '第 13 頁 - 附表一 (續)', fields: page13Fields },
  { page: 14, title: '第 14 頁 - 聲明及簽署', fields: page14Fields },
  { page: 15, title: '第 15 頁 - 聯絡資料', fields: page15Fields },
];
