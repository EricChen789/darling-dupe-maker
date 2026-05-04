import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ShareTransaction {
  id: string;
  company_id: string;
  transaction_date: string;
  transaction_type: string;
  from_person_id: string | null;
  from_name: string;
  to_person_id: string | null;
  to_name: string;
  shares: number;
  share_type: string;
  currency: string;
  price_per_share: string;
  total_consideration: string;
  instrument_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export function useShareTransactions(companyId: string | undefined) {
  return useQuery({
    queryKey: ['share_transactions', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ShareTransaction[]> => {
      const { data, error } = await supabase
        .from('share_transactions' as any)
        .select('*')
        .eq('company_id', companyId)
        .order('transaction_date', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ShareTransaction[];
    },
  });
}

export function useUpsertShareTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tx: Partial<ShareTransaction>) => {
      const payload: any = {
        company_id: tx.company_id,
        transaction_date: tx.transaction_date || '',
        transaction_type: tx.transaction_type || 'transfer',
        from_person_id: tx.from_person_id || null,
        from_name: tx.from_name || '',
        to_person_id: tx.to_person_id || null,
        to_name: tx.to_name || '',
        shares: tx.shares || 0,
        share_type: tx.share_type || '',
        currency: tx.currency || 'HKD',
        price_per_share: tx.price_per_share || '',
        total_consideration: tx.total_consideration || '',
        instrument_number: tx.instrument_number || '',
        notes: tx.notes || '',
      };
      if (tx.id) {
        const { error } = await supabase.from('share_transactions' as any).update(payload).eq('id', tx.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('share_transactions' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['share_transactions', vars.company_id] });
    },
  });
}

export function useDeleteShareTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; companyId: string }) => {
      const { error } = await supabase.from('share_transactions' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['share_transactions', vars.companyId] });
    },
  });
}
