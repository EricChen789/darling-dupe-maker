import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SignificantController } from '@/types';

interface DbSCR {
  id: string;
  company_id: string;
  identity: string;
  name_english: string;
  name_chinese: string;
  id_number: string;
  address: string;
  service_address: string;
  date_became: string;
  date_ceased: string;
  nature_shares: boolean;
  nature_voting: boolean;
  nature_appoint: boolean;
  nature_influence: boolean;
  nature_trust: boolean;
  nature_other: string;
  is_designated_rep: boolean;
  designated_rep_name: string;
  designated_rep_contact: string;
}

function mapSCR(r: DbSCR): SignificantController {
  return {
    id: r.id,
    companyId: r.company_id,
    identity: (r.identity as 'natural' | 'corporate') || 'natural',
    nameEnglish: r.name_english || '',
    nameChinese: r.name_chinese || '',
    idNumber: r.id_number || '',
    address: r.address || '',
    serviceAddress: r.service_address || '',
    dateBecame: r.date_became || '',
    dateCeased: r.date_ceased || '',
    natureShares: !!r.nature_shares,
    natureVoting: !!r.nature_voting,
    natureAppoint: !!r.nature_appoint,
    natureInfluence: !!r.nature_influence,
    natureTrust: !!r.nature_trust,
    natureOther: r.nature_other || '',
    isDesignatedRep: !!r.is_designated_rep,
    designatedRepName: r.designated_rep_name || '',
    designatedRepContact: r.designated_rep_contact || '',
  };
}

export function useSCRByCompany(companyId?: string) {
  return useQuery({
    queryKey: ['scr', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<SignificantController[]> => {
      const { data, error } = await supabase
        .from('significant_controllers' as any)
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at');
      if (error) throw error;
      return ((data || []) as unknown as DbSCR[]).map(mapSCR);
    },
  });
}

export function useUpsertSCR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: Partial<SignificantController> & { companyId: string }) => {
      const payload: any = {
        company_id: s.companyId,
        identity: s.identity || 'natural',
        name_english: s.nameEnglish || '',
        name_chinese: s.nameChinese || '',
        id_number: s.idNumber || '',
        address: s.address || '',
        service_address: s.serviceAddress || '',
        date_became: s.dateBecame || '',
        date_ceased: s.dateCeased || '',
        nature_shares: !!s.natureShares,
        nature_voting: !!s.natureVoting,
        nature_appoint: !!s.natureAppoint,
        nature_influence: !!s.natureInfluence,
        nature_trust: !!s.natureTrust,
        nature_other: s.natureOther || '',
        is_designated_rep: !!s.isDesignatedRep,
        designated_rep_name: s.designatedRepName || '',
        designated_rep_contact: s.designatedRepContact || '',
      };
      if (s.id) {
        const { error } = await supabase
          .from('significant_controllers' as any)
          .update(payload)
          .eq('id', s.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('significant_controllers' as any)
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['scr', v.companyId] }),
  });
}

export function useDeleteSCR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; companyId: string }) => {
      const { error } = await supabase
        .from('significant_controllers' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['scr', v.companyId] }),
  });
}
