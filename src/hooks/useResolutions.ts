import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Resolution {
  id: string;
  company_id: string;
  resolution_type: string;
  title: string;
  resolution_date: string;
  content: string;
  signers: string;
  is_ai_generated: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export function useResolutions(companyId?: string) {
  return useQuery({
    queryKey: ['resolutions', companyId || 'all'],
    queryFn: async (): Promise<Resolution[]> => {
      let q = supabase.from('resolutions' as any).select('*').order('resolution_date', { ascending: false }).limit(5000);
      if (companyId) q = q.eq('company_id', companyId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as Resolution[];
    },
  });
}

export function useSaveResolution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: Partial<Resolution>) => {
      const payload: any = {
        company_id: r.company_id,
        resolution_type: r.resolution_type || 'general',
        title: r.title || '',
        resolution_date: r.resolution_date || new Date().toISOString().slice(0, 10),
        content: r.content || '',
        signers: r.signers || '',
        is_ai_generated: !!r.is_ai_generated,
        notes: r.notes || '',
      };
      if (r.id) {
        const { error } = await supabase.from('resolutions' as any).update(payload).eq('id', r.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('resolutions' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resolutions'] }),
  });
}

export function useDeleteResolution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('resolutions' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resolutions'] }),
  });
}
