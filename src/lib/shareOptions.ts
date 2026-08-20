// ── 股份類別 / 貨幣選項 ──
// 默認常用選項 + 系統已用過的值（手動輸入後保存即進入歷史，下次可選）

export const DEFAULT_SHARE_TYPES = [
  'Ordinary 普通股',
  'Preference 優先股',
  'Deferred 遞延股',
  'Non-voting 無投票權股',
  'Class A',
  'Class B',
  'Class C',
];

export const DEFAULT_CURRENCIES = [
  'HKD',
  'USD',
  'CNY',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'SGD',
  'TWD',
];

// 合併：默認在前 + 歷史值去重（保留輸入順序）
export function mergeOptions(defaults: string[], historical: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...defaults, ...historical]) {
    const s = String(v ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
