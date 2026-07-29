// Hook for NAR1 filing status, changes summary, and due date tracking (Phase 4)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface NAR1Period {
  id: string;
  period_start: string;
  period_end: string;
  filing_date: string;
  status: string;
}

export interface NAR1ChangesSummary {
  total_changes: number;
  director_appointments: number;
  director_cessations: number;
  secretary_appointments: number;
  secretary_cessations: number;
  shareholder_changes: number;
  share_transfers: number;
  share_allotments: number;
  address_changes: number;
  name_changes: number;
  other_changes: number;
}

export interface NAR1Status {
  company_id: string;
  company_name: string;
  incorporation_date: string;
  period_start?: string;
  period_end?: string;
  due_date?: string;
  days_remaining?: number;
  status?: 'ok' | 'grace' | 'due_soon' | 'late';
  today?: string;
  current_period?: NAR1Period;
  changes_summary?: NAR1ChangesSummary;
  changes?: ChangeEvent[];
}

export interface ChangeEvent {
  id: string;
  company_id: string;
  event_type: string;
  person_id: string;
  role: string;
  old_value: string;
  new_value: string;
  change_date: string;
  related_form_type: string;
  nar1_period_id: string;
  created_at: string;
}

/** Get full NAR1 status for a company: dates, grace period, changes summary */
export function useNAR1Status(companyId: string | undefined) {
  return useQuery({
    queryKey: ['nar1-status', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<NAR1Status> => {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch(`/api/companies/${companyId}/nar1-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return resp.json();
    },
  });
}

/** Get changes for a specific NAR1 period */
export function useNAR1Changes(companyId: string | undefined, periodId?: string) {
  return useQuery({
    queryKey: ['nar1-changes', companyId, periodId],
    enabled: !!companyId,
    queryFn: async () => {
      const token = localStorage.getItem('secretary_jwt') || '';
      const params = periodId ? `?period_id=${periodId}` : '';
      const resp = await fetch(`/api/companies/${companyId}/nar1-changes${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return resp.json();
    },
  });
}

/** Mark a NAR1 period as filed */
export function useFileNAR1(companyId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (periodId?: string) => {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch(`/api/companies/${companyId}/nar1-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ period_id: periodId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nar1-status', companyId] });
      queryClient.invalidateQueries({ queryKey: ['change_events'] });
    },
  });
}

/** Calculate NAR1 dates for a company */
export function useCalculateNAR1Dates(companyId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch(`/api/companies/${companyId}/calculate-nar1-dates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nar1-status', companyId] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
}

/** List companies with upcoming or overdue NAR1 filings */
export function useNAR1DueCompanies(status?: string, days?: number) {
  return useQuery({
    queryKey: ['nar1-due-companies', status, days],
    queryFn: async () => {
      const token = localStorage.getItem('secretary_jwt') || '';
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (days !== undefined) params.set('days', String(days));
      const resp = await fetch(`/api/nar1-due-companies?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return resp.json();
    },
  });
}

/** Status badge color mapping */
export function getNAR1StatusBadge(status?: string): {
  label: string;
  color: string;
  bgColor: string;
} {
  switch (status) {
    case 'late':
      return { label: '已過期', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-100 dark:bg-red-900/30' };
    case 'due_soon':
      return { label: '即將到期', color: 'text-orange-700 dark:text-orange-400', bgColor: 'bg-orange-100 dark:bg-orange-900/30' };
    case 'grace':
      return { label: '寬限期內', color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-100 dark:bg-amber-900/30' };
    case 'ok':
      return { label: '正常', color: 'text-green-700 dark:text-green-400', bgColor: 'bg-green-100 dark:bg-green-900/30' };
    default:
      return { label: '未知', color: 'text-gray-500', bgColor: 'bg-gray-100 dark:bg-gray-800' };
  }
}
