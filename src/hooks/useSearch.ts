import { useQuery } from '@tanstack/react-query';

// ── 6.1 全域搜尋結果型別 ──
export interface SearchCompany {
  type: 'company';
  id: string;
  name: string;
  chinese_name: string;
  company_number: string;
  ci_number: string;
  company_type: string;
  status: string;
}
export interface SearchPersonRole {
  role: string;
  date_ceased: string | null;
  company_id: string;
  company_name: string;
}
export interface SearchPerson {
  type: 'person';
  id: string;
  name_english: string;
  name_chinese: string;
  identity: string;
  id_number: string;
  passport_number: string;
  roles: SearchPersonRole[];
}
export type SearchResult = SearchCompany | SearchPerson;

async function fetchJson<T>(url: string): Promise<T> {
  const token = localStorage.getItem('secretary_jwt') || '';
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// 6.1 全域模糊搜尋（公司 + 自然人）
export function useGlobalSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['global-search', q],
    queryFn: () => fetchJson<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 1,
    placeholderData: (prev) => prev,   // 打字時保留上次結果，避免閃爍
  });
}

// ── 6.2–6.6 公司登記冊明細 ──
export interface RegisterMember {
  role: string;
  person_id: string;
  identity: string;
  name_english: string;
  name_chinese: string;
  id_number: string;
  passport_number: string;
  address: string;
  email: string;
  phone: string;
  shares: number;
  share_type: string;
  currency: string;
  paid_up: string;
  unpaid: string;
  date_appointed: string;
  date_ceased: string;
  is_reserve: number;
}
export interface ShareTransaction {
  id: string;
  transaction_date: string;
  transaction_type: string;
  from_name: string;
  to_name: string;
  shares: number;
  share_type: string;
  currency: string;
  price_per_share: string;
  total_consideration: string;
  instrument_number: string;
  notes: string;
}
export interface SCRecord {
  id: string;
  name_english: string;
  name_chinese: string;
  identity: string;
  id_number: string;
  address: string;
  date_became: string;
  date_ceased: string;
  nature_shares: string;
  nature_voting: string;
  nature_appoint: string;
  nature_influence: string;
  nature_trust: string;
  nature_other: string;
  is_designated_rep: number;
  designated_rep_name: string;
  designated_rep_contact: string;
}
export interface CompanyRegisters {
  company: { id: string; name: string; chinese_name: string; company_number: string };
  current_directors: RegisterMember[];
  historical_directors: RegisterMember[];
  current_shareholders: RegisterMember[];
  historical_shareholders: RegisterMember[];
  secretaries: RegisterMember[];
  share_transactions: ShareTransaction[];
  scr: SCRecord[];
}

export function useCompanyRegisters(companyId: string | undefined) {
  return useQuery({
    queryKey: ['company-registers', companyId],
    queryFn: () => fetchJson<CompanyRegisters>(`/api/company-registers?company_id=${companyId}`),
    enabled: !!companyId,
  });
}
