import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CompanyLog {
  id: string;
  company_id: string | null;
  company_name_hint: string;
  source_folder: string;
  doc_type: string; // ROD | ROM | OTHER
  original_filename: string;
  storage_path: string;
  html_content: string;
  text_content: string;
  doc_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export const useCompanyLogs = (filters?: {
  search?: string;
  docType?: string;
  companyId?: string;
}) => {
  return useQuery({
    queryKey: ['company_logs', filters],
    queryFn: async () => {
      let query = supabase
        .from('company_logs')
        .select('id, company_id, company_name_hint, source_folder, doc_type, original_filename, storage_path, doc_date, notes, created_at, updated_at')
        .order('company_name_hint', { ascending: true })
        .limit(5000);

      if (filters?.docType && filters.docType !== 'all') {
        query = query.eq('doc_type', filters.docType);
      }
      if (filters?.companyId) {
        query = query.eq('company_id', filters.companyId);
      }
      if (filters?.search) {
        query = query.ilike('company_name_hint', `%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Omit<CompanyLog, 'html_content' | 'text_content'>[];
    },
  });
};

export const useCompanyLogContent = (id: string | null) => {
  return useQuery({
    queryKey: ['company_log_content', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_logs')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as CompanyLog;
    },
  });
};

export const useUpdateCompanyLog = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<CompanyLog> & { id: string }) => {
      const { error } = await supabase.from('company_logs').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['company_logs'] });
      qc.invalidateQueries({ queryKey: ['company_log_content', vars.id] });
    },
  });
};
