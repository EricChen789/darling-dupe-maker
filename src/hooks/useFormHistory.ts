import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ─── Types ───
export interface FormHistorySummary {
  id: number | string;
  label: string;
  form_type: string;
  submission_index: number;
  created_at: string;
}

export interface FormHistoryDetail {
  id: number | string;
  label: string;
  form_type: string;
  form_data: any;
  created_at: string;
}

// ─── Token helper ───
function token() {
  return localStorage.getItem('secretary_jwt') || '';
}

// ─── List: summaries only (no form_data payload) ───
export function useFormHistoryList(formType?: string) {
  return useQuery({
    queryKey: ['formHistory', 'list', formType],
    queryFn: async (): Promise<FormHistorySummary[]> => {
      if (!formType) return [];
      const resp = await fetch(`/api/form-history/list?formType=${formType}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.entries || [];
    },
    enabled: !!formType,
  });
}

// ─── Save current form state ───
export function useSaveFormHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { formType: string; formData: any }) => {
      const resp = await fetch('/api/form-history/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Save failed');
      }
      return resp.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['formHistory', 'list', variables.formType] });
    },
  });
}

// ─── Delete a submission ───
export function useDeleteFormHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, formType }: { id: number | string; formType: string }) => {
      const resp = await fetch(`/api/form-history/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!resp.ok) throw new Error('Delete failed');
      return resp.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['formHistory', 'list', variables.formType] });
    },
  });
}
