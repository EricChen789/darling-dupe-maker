import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface CompanyLog {
  id: string;
  company_id: string | null;
  company_name_hint: string;
  source_folder: string;
  doc_type: string;
  original_filename: string;
  storage_path: string;
  html_content: string;
  text_content: string;
  doc_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

const token = () => localStorage.getItem('secretary_jwt') || '';

// ── List logs ──
export const useCompanyLogs = (filters?: {
  search?: string;
  docType?: string;
  companyId?: string;
}) => {
  return useQuery({
    queryKey: ['company_logs', filters],
    queryFn: async () => {
      // Fetch all logs from Flask (filtering done client-side)
      const params = new URLSearchParams({ limit: '5000' });
      if (filters?.docType && filters.docType !== 'all') {
        params.set('doc_type', filters.docType);
      }
      if (filters?.companyId) {
        params.set('company_id', filters.companyId);
      }
      const resp = await fetch(`/api/company_logs?${params}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      let logs: CompanyLog[] = await resp.json();

      // Client-side search on company_name_hint
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        logs = logs.filter(l => (l.company_name_hint || '').toLowerCase().includes(q));
      }

      // Sort by company_name_hint
      logs.sort((a, b) => (a.company_name_hint || '').localeCompare(b.company_name_hint || ''));

      return logs;
    },
  });
};

// ── Single log content ──
export const useCompanyLogContent = (id: string | null) => {
  return useQuery({
    queryKey: ['company_log_content', id],
    enabled: !!id,
    queryFn: async () => {
      const resp = await fetch(`/api/company_logs/${id}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json() as Promise<CompanyLog>;
    },
  });
};

// ── Update log ──
export const useUpdateCompanyLog = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<CompanyLog> & { id: string }) => {
      const resp = await fetch(`/api/company_logs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['company_logs'] });
      qc.invalidateQueries({ queryKey: ['company_log_content', vars.id] });
    },
  });
};
