import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Presenter {
  id: string;
  name: string;
  address: string;
  contact: string;
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
      if (p.id) {
        const { error } = await supabase
          .from('presenters' as any)
          .update({ name: p.name, address: p.address || '', contact: p.contact || '', type: p.type || 'individual' })
          .eq('id', p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('presenters' as any)
          .insert({ name: p.name, address: p.address || '', contact: p.contact || '', type: p.type || 'individual' });
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
