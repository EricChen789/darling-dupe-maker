import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Company, Person, Shareholder } from '@/types';

interface DbCompany {
  id: string;
  name: string;
  chinese_name: string;
  company_number: string;
  trading_name: string;
  business_nature: string;
  company_type: string;
  business_code: string;
  company_group: string;
  updated_at: string;
}

interface DbOfficer {
  id: string;
  company_id: string;
  name_english: string;
  name_chinese: string;
  identity: string;
  role: string;
  id_number: string;
}

interface DbShareholder {
  id: string;
  company_id: string;
  name: string;
  shares: number;
}

function mapToCompany(
  c: DbCompany,
  officers: DbOfficer[],
  shareholders: DbShareholder[]
): Company {
  const directors: Person[] = officers
    .filter(o => o.role === 'director')
    .map(o => ({
      id: o.id,
      nameChinese: o.name_chinese || '',
      nameEnglish: o.name_english || '',
      email: '',
      identity: o.identity as 'natural' | 'corporate',
      role: 'director' as const,
      companies: [],
      createdAt: '',
      updatedAt: '',
    }));

  const secretaries: Person[] = officers
    .filter(o => o.role === 'secretary')
    .map(o => ({
      id: o.id,
      nameChinese: o.name_chinese || '',
      nameEnglish: o.name_english || '',
      email: '',
      identity: o.identity as 'natural' | 'corporate',
      role: 'secretary' as const,
      companies: [],
      createdAt: '',
      updatedAt: '',
    }));

  const shs: Shareholder[] = shareholders.map(s => ({
    id: s.id,
    name: s.name,
    shares: s.shares,
  }));

  return {
    id: c.id,
    name: c.name,
    brNumber: c.company_number,
    tradingName: c.trading_name || c.chinese_name || '',
    businessNature: c.business_nature || '',
    directors,
    secretaries,
    shareholders: shs,
    companyType: c.company_type || '',
    businessCode: c.business_code || '',
    updatedAt: new Date(c.updated_at).toLocaleDateString('zh-TW'),
  };
}

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async (): Promise<Company[]> => {
      const { data: companies, error: cErr } = await supabase
        .from('companies')
        .select('*')
        .order('name');

      if (cErr) throw cErr;
      if (!companies || companies.length === 0) return [];

      const companyIds = companies.map(c => c.id);

      // Fetch officers and shareholders in parallel
      const [officersRes, shareholdersRes] = await Promise.all([
        supabase.from('officers').select('*').in('company_id', companyIds),
        supabase.from('shareholders').select('*').in('company_id', companyIds),
      ]);

      if (officersRes.error) throw officersRes.error;
      if (shareholdersRes.error) throw shareholdersRes.error;

      const officersByCompany = new Map<string, DbOfficer[]>();
      for (const o of (officersRes.data || []) as DbOfficer[]) {
        const list = officersByCompany.get(o.company_id) || [];
        list.push(o);
        officersByCompany.set(o.company_id, list);
      }

      const shByCompany = new Map<string, DbShareholder[]>();
      for (const s of (shareholdersRes.data || []) as DbShareholder[]) {
        const list = shByCompany.get(s.company_id) || [];
        list.push(s);
        shByCompany.set(s.company_id, list);
      }

      return (companies as DbCompany[]).map(c =>
        mapToCompany(
          c,
          officersByCompany.get(c.id) || [],
          shByCompany.get(c.id) || []
        )
      );
    },
  });
}

export function useDeleteCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('companies').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
}

export function useAddCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Company>) => {
      const { data: company, error } = await supabase
        .from('companies')
        .insert({
          name: data.name || '',
          company_number: data.brNumber || '',
          trading_name: data.tradingName || '',
          business_nature: data.businessNature || '',
          company_type: data.companyType || '私人公司 Private company',
          business_code: data.businessCode || '',
        })
        .select()
        .single();
      if (error) throw error;
      return company;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Company> }) => {
      const { error } = await supabase
        .from('companies')
        .update({
          name: data.name,
          company_number: data.brNumber,
          trading_name: data.tradingName,
          business_nature: data.businessNature,
          company_type: data.companyType,
          business_code: data.businessCode,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
}
