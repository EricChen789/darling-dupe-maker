import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SecretaryTemplate {
  id: string;
  label: string;
  identity: 'natural' | 'corporate';
  nameEnglish: string;
  nameChinese: string;
  idNumber: string;
  brNumber: string;
  tcspNumber: string;
  placeIncorporated: string;
  address: string;
  serviceAddress: string;
  email: string;
  phone: string;
  isDefault: boolean;
}

interface DbTpl {
  id: string;
  label: string;
  identity: string;
  name_english: string;
  name_chinese: string;
  id_number: string;
  br_number: string;
  tcsp_number: string;
  place_incorporated: string;
  address: string;
  service_address: string;
  email: string;
  phone: string;
  is_default: boolean;
}

const fromDb = (t: DbTpl): SecretaryTemplate => ({
  id: t.id,
  label: t.label || '',
  identity: (t.identity as 'natural' | 'corporate') || 'corporate',
  nameEnglish: t.name_english || '',
  nameChinese: t.name_chinese || '',
  idNumber: t.id_number || '',
  brNumber: t.br_number || '',
  tcspNumber: t.tcsp_number || '',
  placeIncorporated: t.place_incorporated || '',
  address: t.address || '',
  serviceAddress: t.service_address || '',
  email: t.email || '',
  phone: t.phone || '',
  isDefault: !!t.is_default,
});

export function useSecretaryTemplates() {
  return useQuery({
    queryKey: ['secretary_templates'],
    queryFn: async (): Promise<SecretaryTemplate[]> => {
      const { data, error } = await supabase
        .from('secretary_templates' as any)
        .select('*')
        .order('is_default', { ascending: false })
        .order('label');
      if (error) throw error;
      return ((data || []) as unknown as DbTpl[]).map(fromDb);
    },
  });
}

export function useSaveSecretaryTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: Partial<SecretaryTemplate> & { id?: string }) => {
      const payload: any = {
        label: t.label || '',
        identity: t.identity || 'corporate',
        name_english: t.nameEnglish || '',
        name_chinese: t.nameChinese || '',
        id_number: t.idNumber || '',
        br_number: t.brNumber || '',
        tcsp_number: t.tcspNumber || '',
        place_incorporated: t.placeIncorporated || '',
        address: t.address || '',
        service_address: t.serviceAddress || '',
        email: t.email || '',
        phone: t.phone || '',
        is_default: !!t.isDefault,
      };
      if (t.id) {
        const { error } = await supabase.from('secretary_templates' as any).update(payload).eq('id', t.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('secretary_templates' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['secretary_templates'] }),
  });
}

export function useDeleteSecretaryTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('secretary_templates' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['secretary_templates'] }),
  });
}
