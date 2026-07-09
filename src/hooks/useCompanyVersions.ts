import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// 公司資料版本快照（VE-01/02/03）
export interface CompanyVersion {
  id: string;
  company_id: string;
  version_no: number;
  snapshot: Record<string, string>;
  changed_fields: string[];
  change_summary: string;
  changed_by: string;
  created_at: string;
}

// 版本快照包含的欄位 → 繁體標籤（與後端 VERSION_FIELDS 對應）
export const VERSION_FIELD_LABELS: Record<string, string> = {
  name: '英文名稱',
  chinese_name: '中文名稱',
  company_number: '商業登記號碼',
  ci_number: '公司註冊編號',
  trading_name: '商業名稱',
  business_nature: '業務性質',
  company_type: '公司類型',
  business_code: '業務代碼',
  status: '狀態',
  incorporation_date: '成立日期',
  jurisdiction: '司法管轄區',
  reg_flat: '註冊地址-室/樓/座',
  reg_building: '註冊地址-大廈',
  reg_street: '註冊地址-街道',
  reg_district: '註冊地址-區',
  reg_region: '註冊地址-地區',
  email: '電郵地址',
  phone: '電話',
  signer_role_id: '簽署人',
};

export const versionFieldLabel = (key: string) => VERSION_FIELD_LABELS[key] || key;

async function fetchJson<T>(url: string): Promise<T> {
  const token = localStorage.getItem('secretary_jwt') || '';
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// VE-01：公司版本列表（新→舊）
export function useCompanyVersions(companyId?: string) {
  return useQuery({
    queryKey: ['company-versions', companyId],
    queryFn: () => fetchJson<CompanyVersion[]>(`/api/companies/${companyId}/versions`),
    enabled: !!companyId,
  });
}

// 手動建立版本快照
export function useCreateVersionSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (companyId: string) => {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch(`/api/companies/${companyId}/versions/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json() as Promise<{ success: boolean; version_no: number | null; created: boolean }>;
    },
    onSuccess: (_d, companyId) => {
      qc.invalidateQueries({ queryKey: ['company-versions', companyId] });
    },
  });
}
