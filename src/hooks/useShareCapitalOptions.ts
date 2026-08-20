import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_SHARE_TYPES, DEFAULT_CURRENCIES, mergeOptions,
} from '@/lib/shareOptions';

// ── 股份類別 / 貨幣歷史選項（全系統去重聚合）──
// 保存過的值會進入 share_transactions / person_company_roles，
// 下次編輯時自動出現在下拉建議中。

export interface ShareCapitalOptions {
  share_types: string[];
  currencies: string[];
}

export function useShareCapitalOptions() {
  return useQuery({
    queryKey: ['share-capital-options'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ShareCapitalOptions> => {
      const resp = await fetch('/api/share-capital-options');
      if (!resp.ok) return { share_types: [], currencies: [] }; // 靜默回退：僅默認選項
      const data = await resp.json();
      return {
        share_types: Array.isArray(data?.share_types) ? data.share_types : [],
        currencies: Array.isArray(data?.currencies) ? data.currencies : [],
      };
    },
  });
}

export function useShareTypeOptions(): string[] {
  const { data } = useShareCapitalOptions();
  return mergeOptions(DEFAULT_SHARE_TYPES, data?.share_types || []);
}

export function useCurrencyOptions(): string[] {
  const { data } = useShareCapitalOptions();
  return mergeOptions(DEFAULT_CURRENCIES, data?.currencies || []);
}
