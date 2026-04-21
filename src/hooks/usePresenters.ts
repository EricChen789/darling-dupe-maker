import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Presenter {
  id: string;
  name: string;
  address: string;
  contact: string; // legacy / notes
  phone: string;
  fax: string;
  email: string;
  reference: string;
  type: 'individual' | 'company' | 'tcsp';
  created_at?: string;
  updated_at?: string;
}

export function usePresenters() {
  return useQuery({
    queryKey: ['presenters'],
    queryFn: async (): Promise<Presenter[]> => {
      const { data, error } = await supabase
        .from('presenters' as any)
        .select('*')
        .order('name');
      if (error) throw error;
      return (data || []) as unknown as Presenter[];
    },
  });
}

export function useUpsertPresenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Partial<Presenter> & { name: string }) => {
      const payload: any = {
        name: p.name,
        address: p.address || '',
        contact: p.contact || '',
        phone: p.phone || '',
        fax: p.fax || '',
        email: p.email || '',
        reference: p.reference || '',
        type: p.type || 'individual',
      };
      if (p.id) {
        const { error } = await supabase.from('presenters' as any).update(payload).eq('id', p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('presenters' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presenters'] }),
  });
}

export function useDeletePresenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('presenters' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presenters'] }),
  });
}
