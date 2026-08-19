/**
 * 判斷證件號是否像香港身份證：1-2 字母 + 6 位數字 + 可選括號校驗位 [0-9A]。
 * 護照多為 E+8 位數字 / 純 9 位，公司編號純 8 位 —— 6 位核心數字不易誤判。
 * 注意 7 位數字無括號（A1234567）視為非 HKID，防護照假陽性。
 */
export function isHkidLike(idNumber: string): boolean {
  return /^[A-Z]{1,2}\d{6}(\([0-9A]\))?$/i.test((idNumber || '').trim());
}
