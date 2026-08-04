import { useQuery } from '@tanstack/react-query';

export interface FormLinkage {
  id: string;
  primary_form: string;
  linked_form: string;
  linkage_type: string; // 'always_together' | 'conditional' | 'suggest'
  description: string;
}

interface FormLinkagesResponse {
  linkages: FormLinkage[];
}

const FORM_LINKAGE_LABELS: Record<string, string> = {
  IRC3111A: 'IRC 3111A — 通知更改業務地址（税務局）',
  IR1263: 'IR 1263 — 通知税務局撤銷註冊',
  ND4: 'ND4 — 公司秘書及董事辭任通知書',
  IRBR1: 'IRBR1 — 致商業登記署通知書（本地公司）',
  IRBR2: 'IRBR2 — 致商業登記署通知書（非香港公司）',
};

export function getFormLinkageLabel(formCode: string): string {
  return FORM_LINKAGE_LABELS[formCode] || formCode;
}

async function fetchFormLinkages(primaryForm?: string): Promise<FormLinkage[]> {
  const token = localStorage.getItem('secretary_jwt') || '';
  const url = primaryForm
    ? `/api/form-linkages?primary=${encodeURIComponent(primaryForm)}`
    : '/api/form-linkages';
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    // If endpoint doesn't exist yet (e.g. cloud not deployed), return empty
    if (resp.status === 404 || resp.status === 500) return [];
    throw new Error(`Failed to fetch form linkages: ${resp.status}`);
  }
  const data: FormLinkagesResponse = await resp.json();
  return data.linkages || [];
}

/**
 * Hook to fetch form linkage rules.
 * Pass a primary form code (e.g. 'NR1') to get only its linked forms.
 * Use `enabled` to defer fetching until needed.
 */
export function useFormLinkages(primaryForm?: string, enabled = true) {
  return useQuery({
    queryKey: ['formLinkages', primaryForm || 'all'],
    queryFn: () => fetchFormLinkages(primaryForm),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min cache
  });
}
