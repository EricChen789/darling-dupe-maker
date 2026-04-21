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
  reg_flat: string;
  reg_building: string;
  reg_street: string;
  reg_district: string;
  reg_region: string;
  incorporation_date?: string;
  jurisdiction?: string;
  ci_file_path?: string;
  br_file_path?: string;
}

interface DbOfficer {
  id: string;
  company_id: string;
  name_english: string;
  name_chinese: string;
  identity: string;
  role: string;
  id_number: string;
  address: string;
  service_address?: string;
  date_appointed: string;
  date_ceased: string;
  place_incorporated: string;
  company_number_ref: string;
}

interface DbShareholder {
  id: string;
  company_id: string;
  name: string;
  name_english: string;
  name_chinese: string;
  shares: number;
  identity: string;
  id_number: string;
  address: string;
  service_address?: string;
  email: string;
  share_type: string;
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
      address: o.address || '',
      serviceAddress: o.service_address || '',
      idNumber: o.id_number || '',
      dateAppointed: o.date_appointed || '',
      dateCeased: o.date_ceased || '',
      placeIncorporated: o.place_incorporated || '',
      companyNumberRef: o.company_number_ref || '',
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
      address: o.address || '',
      serviceAddress: o.service_address || '',
      idNumber: o.id_number || '',
      dateAppointed: o.date_appointed || '',
      dateCeased: o.date_ceased || '',
      placeIncorporated: o.place_incorporated || '',
      companyNumberRef: o.company_number_ref || '',
      companies: [],
      createdAt: '',
      updatedAt: '',
    }));

  const shs: Shareholder[] = shareholders.map(s => ({
    id: s.id,
    name: s.name,
    nameEnglish: s.name_english || '',
    nameChinese: s.name_chinese || '',
    shares: s.shares,
    identity: (s.identity as 'natural' | 'corporate') || 'natural',
    idNumber: s.id_number || '',
    address: s.address || '',
    serviceAddress: s.service_address || '',
    email: s.email || '',
    shareType: s.share_type || '',
  }));

  return {
    id: c.id,
    name: c.name,
    chineseName: c.chinese_name || '',
    brNumber: c.company_number,
    tradingName: c.trading_name || '',
    businessNature: c.business_nature || '',
    directors,
    secretaries,
    shareholders: shs,
    companyType: c.company_type || '',
    businessCode: c.business_code || '',
    updatedAt: new Date(c.updated_at).toLocaleDateString('zh-TW'),
    regFlat: c.reg_flat || '',
    regBuilding: c.reg_building || '',
    regStreet: c.reg_street || '',
    regDistrict: c.reg_district || '',
    regRegion: c.reg_region || '香港 Hong Kong',
    incorporationDate: c.incorporation_date || '',
    jurisdiction: c.jurisdiction || 'Hong Kong',
    ciFilePath: c.ci_file_path || '',
    brFilePath: c.br_file_path || '',
  };
}

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async (): Promise<Company[]> => {
      const { data: companies, error: cErr } = await supabase
        .from('companies')
        .select('*')
        .order('name')
        .limit(2000);

      if (cErr) throw cErr;
      if (!companies || companies.length === 0) return [];

      // Fetch all officers and shareholders (no filtering needed, just get all)
      const [officersRes, shareholdersRes] = await Promise.all([
        supabase.from('officers').select('*').limit(5000),
        supabase.from('shareholders').select('*').limit(5000),
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
          chinese_name: data.chineseName || '',
          company_number: data.brNumber || '',
          trading_name: data.tradingName || '',
          business_nature: data.businessNature || '',
          company_type: data.companyType || '私人公司 Private company',
          business_code: data.businessCode || '',
          incorporation_date: data.incorporationDate || '',
          jurisdiction: data.jurisdiction || 'Hong Kong',
          reg_flat: data.regFlat || '',
          reg_building: data.regBuilding || '',
          reg_street: data.regStreet || '',
          reg_district: data.regDistrict || '',
          reg_region: data.regRegion || '香港 Hong Kong',
        })
        .select()
        .single();
      if (error) throw error;

      const companyId = company.id;

      // Insert nested directors / secretaries (if provided from AI extraction)
      const officerInserts: any[] = [];
      for (const d of data.directors || []) {
        if (!d.nameEnglish && !d.nameChinese) continue;
        officerInserts.push({
          company_id: companyId,
          name_english: d.nameEnglish || '',
          name_chinese: d.nameChinese || '',
          role: 'director',
          identity: d.identity || 'natural',
          id_number: d.idNumber || '',
          address: d.address || '',
        });
      }
      for (const s of data.secretaries || []) {
        if (!s.nameEnglish && !s.nameChinese) continue;
        officerInserts.push({
          company_id: companyId,
          name_english: s.nameEnglish || '',
          name_chinese: s.nameChinese || '',
          role: 'secretary',
          identity: s.identity || 'natural',
          id_number: s.idNumber || '',
          address: s.address || '',
        });
      }
      if (officerInserts.length) {
        const { error: oErr } = await supabase.from('officers').insert(officerInserts);
        if (oErr) console.error('Officer insert error:', oErr);
      }

      // Insert nested shareholders
      const shInserts: any[] = [];
      for (const sh of data.shareholders || []) {
        if (!sh.nameEnglish && !sh.nameChinese && !sh.name) continue;
        shInserts.push({
          company_id: companyId,
          name: sh.name || sh.nameEnglish || sh.nameChinese || '',
          name_english: sh.nameEnglish || '',
          name_chinese: sh.nameChinese || '',
          shares: sh.shares || 0,
          identity: sh.identity || 'natural',
          id_number: sh.idNumber || '',
          address: sh.address || '',
          email: sh.email || '',
          share_type: sh.shareType || '',
        });
      }
      if (shInserts.length) {
        const { error: sErr } = await supabase.from('shareholders').insert(shInserts);
        if (sErr) console.error('Shareholder insert error:', sErr);
      }

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
          chinese_name: data.chineseName,
          company_number: data.brNumber,
          trading_name: data.tradingName,
          business_nature: data.businessNature,
          company_type: data.companyType,
          business_code: data.businessCode,
          reg_flat: data.regFlat,
          reg_building: data.regBuilding,
          reg_street: data.regStreet,
          reg_district: data.regDistrict,
          reg_region: data.regRegion,
          incorporation_date: data.incorporationDate,
          jurisdiction: data.jurisdiction,
          ci_file_path: data.ciFilePath,
          br_file_path: data.brFilePath,
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

export function useAddOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { company_id: string; name_english: string; name_chinese?: string; role: string; identity?: string; id_number?: string; address?: string; service_address?: string; date_appointed?: string; date_ceased?: string; place_incorporated?: string; company_number_ref?: string }) => {
      const { error } = await supabase.from('officers').insert({
        company_id: data.company_id,
        name_english: data.name_english,
        name_chinese: data.name_chinese || '',
        role: data.role,
        identity: data.identity || 'natural',
        id_number: data.id_number || '',
        address: data.address || '',
        service_address: data.service_address || '',
        date_appointed: data.date_appointed || null,
        date_ceased: data.date_ceased || null,
        place_incorporated: data.place_incorporated || '',
        company_number_ref: data.company_number_ref || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useUpdateOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name_english?: string; name_chinese?: string; identity?: string; id_number?: string; address?: string; service_address?: string; date_appointed?: string; date_ceased?: string; place_incorporated?: string; company_number_ref?: string } }) => {
      const { error } = await supabase.from('officers').update(data as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useDeleteOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('officers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useAddShareholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { company_id: string; name: string; name_english?: string; name_chinese?: string; shares: number; identity?: string; id_number?: string; address?: string; service_address?: string; email?: string; share_type?: string }) => {
      const { error } = await supabase.from('shareholders').insert(data as any);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useUpdateShareholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name?: string; name_english?: string; name_chinese?: string; shares?: number; identity?: string; id_number?: string; address?: string; service_address?: string; email?: string; share_type?: string } }) => {
      const { error } = await supabase.from('shareholders').update(data as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useDeleteShareholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('shareholders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  });
}

// Copy officers and/or shareholders from one company to another
export function useCopyFromCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sourceCompanyId,
      targetCompanyId,
      officerIds,
      shareholderIds,
    }: {
      sourceCompanyId: string;
      targetCompanyId: string;
      officerIds: string[];
      shareholderIds: string[];
    }) => {
      if (officerIds.length > 0) {
        const { data: srcOfficers, error: e1 } = await supabase
          .from('officers').select('*').in('id', officerIds);
        if (e1) throw e1;
        const inserts = (srcOfficers || []).map((o: any) => ({
          company_id: targetCompanyId,
          name_english: o.name_english,
          name_chinese: o.name_chinese,
          identity: o.identity,
          role: o.role,
          id_number: o.id_number,
          address: o.address,
          service_address: o.service_address || '',
          date_appointed: o.date_appointed,
          date_ceased: o.date_ceased,
          place_incorporated: o.place_incorporated,
          company_number_ref: o.company_number_ref,
        }));
        if (inserts.length) {
          const { error } = await supabase.from('officers').insert(inserts as any);
          if (error) throw error;
        }
      }
      if (shareholderIds.length > 0) {
        const { data: srcShs, error: e2 } = await supabase
          .from('shareholders').select('*').in('id', shareholderIds);
        if (e2) throw e2;
        const inserts = (srcShs || []).map((s: any) => ({
          company_id: targetCompanyId,
          name: s.name,
          name_english: s.name_english,
          name_chinese: s.name_chinese,
          shares: s.shares,
          identity: s.identity,
          id_number: s.id_number,
          address: s.address,
          service_address: s.service_address || '',
          email: s.email,
          share_type: s.share_type,
        }));
        if (inserts.length) {
          const { error } = await supabase.from('shareholders').insert(inserts as any);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  });
}
