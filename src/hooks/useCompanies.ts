import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Company, Person, Shareholder } from '@/types';

interface DbCompany {
  id: string;
  name: string;
  chinese_name: string;
  company_number: string;
  ci_number: string;
  status: string;
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
  preferred_presenter_id?: string | null;
  presenter_reference?: string | null;
  signer_role_id?: string | null;
}

interface DbPerson {
  id: string;
  identity: string;
  name_english: string;
  name_chinese: string;
  previous_name_english: string;
  previous_name_chinese: string;
  alias_english: string;
  alias_chinese: string;
  id_number: string;
  passport_number: string;
  passport_expiry: string;
  address: string;
  service_address: string;
  email: string;
  whatsapp: string;
  phone: string;
  place_incorporated: string;
  company_number_ref: string;
  tcsp_number: string;
  passport_file_path: string;
  id_card_file_path: string;
  address_proof_file_path: string;
}

interface DbRole {
  id: string;
  person_id: string;
  company_id: string;
  role: string;
  date_appointed: string;
  date_ceased: string;
  service_address_override: string;
  shares: number;
  share_type: string;
  currency: string;
  issue_price: string;
  paid_up: string;
  unpaid: string;
  is_reserve?: boolean;
}

async function fetchAllRows<T>(
  table: 'companies' | 'persons' | 'person_company_roles',
  columns = '*',
  orderColumn?: string,
): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    let query = supabase.from(table).select(columns);
    if (orderColumn) query = query.order(orderColumn);
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || []) as T[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function buildPersonForRole(p: DbPerson, r: DbRole, role: 'director' | 'secretary' | 'shareholder'): Person {
  return {
    // Use the role-relationship id so dialogs / mutations can target per-company assignment
    id: r.id,
    nameChinese: p.name_chinese || '',
    nameEnglish: p.name_english || '',
    email: p.email || '',
    identity: (p.identity as 'natural' | 'corporate') || 'natural',
    role,
    address: p.address || '',
    serviceAddress: r.service_address_override || p.service_address || '',
    idNumber: p.id_number || '',
    passportNumber: p.passport_number || '',
    passportExpiry: p.passport_expiry || '',
    whatsapp: p.whatsapp || '',
    passportFilePath: p.passport_file_path || '',
    idCardFilePath: p.id_card_file_path || '',
    addressProofFilePath: p.address_proof_file_path || '',
    dateAppointed: r.date_appointed || '',
    dateCeased: r.date_ceased || '',
    placeIncorporated: p.place_incorporated || '',
    companyNumberRef: p.company_number_ref || '',
    tcspNumber: p.tcsp_number || '',
    previousNameChinese: p.previous_name_chinese || '',
    previousNameEnglish: p.previous_name_english || '',
    aliasChinese: p.alias_chinese || '',
    aliasEnglish: p.alias_english || '',
    isReserve: !!r.is_reserve,
    companies: [],
    createdAt: '',
    updatedAt: '',
    // Internal: original person id (not in Person type but needed for some ops)
    ...({ _personId: p.id } as any),
  };
}

function buildShareholderForRole(p: DbPerson, r: DbRole): Shareholder {
  const displayName = p.name_english || p.name_chinese || '';
  return {
    id: r.id,
    name: displayName,
    nameEnglish: p.name_english || '',
    nameChinese: p.name_chinese || '',
    shares: r.shares || 0,
    identity: (p.identity as 'natural' | 'corporate') || 'natural',
    idNumber: p.id_number || '',
    address: p.address || '',
    serviceAddress: r.service_address_override || p.service_address || '',
    email: p.email || '',
    shareType: r.share_type || '',
    issuePrice: r.issue_price || '',
    currency: r.currency || 'HKD',
    paidUp: r.paid_up || '',
    unpaid: r.unpaid || '',
    ...({ _personId: p.id } as any),
  } as any;
}

function mapToCompany(
  c: DbCompany,
  rolesForCompany: DbRole[],
  personMap: Map<string, DbPerson>,
): Company {
  const directors: Person[] = [];
  const secretaries: Person[] = [];
  const shareholders: Shareholder[] = [];

  for (const r of rolesForCompany) {
    const p = personMap.get(r.person_id);
    if (!p) continue;
    if (r.role === 'director' || r.role === 'reserve_director') {
      directors.push(buildPersonForRole(p, r, 'director'));
    } else if (r.role === 'secretary') {
      secretaries.push(buildPersonForRole(p, r, 'secretary'));
    } else if (r.role === 'shareholder') {
      shareholders.push(buildShareholderForRole(p, r));
    }
  }

  return {
    id: c.id,
    name: c.name,
    chineseName: c.chinese_name || '',
    brNumber: c.company_number,
    ciNumber: ((c as any).ci_number as string) || '',
    tradingName: c.trading_name || '',
    businessNature: c.business_nature || '',
    directors,
    secretaries,
    shareholders,
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
    preferredPresenterId: c.preferred_presenter_id || '',
    presenterReference: c.presenter_reference || '',
    signerRoleId: ((c as any).signer_role_id as string) || '',
    status: (((c as any).status as 'active' | 'inactive' | 'deregistered') || 'active'),
    email: ((c as any).email as string) || '',
    phone: ((c as any).phone as string) || '',
  };
}

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async (): Promise<Company[]> => {
      const [companies, persons, roles] = await Promise.all([
        fetchAllRows<DbCompany>('companies', '*', 'name'),
        fetchAllRows<DbPerson>('persons'),
        fetchAllRows<DbRole>('person_company_roles'),
      ]);

      if (companies.length === 0) return [];

      const personMap = new Map<string, DbPerson>();
      persons.forEach(p => personMap.set(p.id, p));

      const rolesByCompany = new Map<string, DbRole[]>();
      for (const r of roles) {
        const list = rolesByCompany.get(r.company_id) || [];
        list.push(r);
        rolesByCompany.set(r.company_id, list);
      }

      return companies.map(c => mapToCompany(c, rolesByCompany.get(c.id) || [], personMap));
    },
  });
}

export function useDeleteCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Remove company-scoped roles, then the company itself.
      // Persons remain in the central master.
      const { error: rolesErr } = await supabase
        .from('person_company_roles').delete().eq('company_id', id);
      if (rolesErr) throw rolesErr;
      const { error } = await supabase.from('companies').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}

// ---------- Person resolution helper ----------

/**
 * Find or create a person in the central master based on identifying info.
 * Dedup priority: id_number > (normalized name_english + name_chinese).
 * Returns the person_id.
 */
async function findOrCreatePerson(input: {
  identity?: string;
  nameEnglish: string;
  nameChinese?: string;
  idNumber?: string;
  address?: string;
  email?: string;
  serviceAddress?: string;
  passportNumber?: string;
  placeIncorporated?: string;
  companyNumberRef?: string;
}): Promise<string> {
  const identity = input.identity || 'natural';
  const nameEng = (input.nameEnglish || '').trim();
  const nameZh = (input.nameChinese || '').trim();
  const idNum = (input.idNumber || '').trim();

  // 1. Try by id_number
  if (idNum) {
    const { data } = await supabase
      .from('persons').select('id').eq('id_number', idNum).limit(1);
    if (data && data.length > 0) return data[0].id;
  }

  // 2. Try by normalized name_english (corporate uses english only; natural uses english + chinese)
  if (nameEng) {
    const normKey = nameEng.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normKey) {
      const { data } = await supabase
        .from('persons').select('id, name_chinese, identity')
        .eq('normalized_key', normKey);
      if (data && data.length > 0) {
        // For corporates, any normalized match is fine
        if (identity === 'corporate') {
          const corp = data.find(d => d.identity === 'corporate');
          if (corp) return corp.id;
        } else {
          // For natural persons, prefer same chinese name, or empty chinese
          const exact = data.find(d => d.identity === 'natural' && d.name_chinese === nameZh);
          if (exact) return exact.id;
          if (!nameZh) {
            const anyNatural = data.find(d => d.identity === 'natural');
            if (anyNatural) return anyNatural.id;
          }
        }
      }
    }
  }

  // 3. Create new
  const { data: created, error } = await supabase
    .from('persons')
    .insert({
      identity,
      name_english: nameEng,
      name_chinese: nameZh,
      id_number: idNum,
      address: input.address || '',
      service_address: input.serviceAddress || '',
      email: input.email || '',
      passport_number: input.passportNumber || '',
      place_incorporated: input.placeIncorporated || '',
      company_number_ref: input.companyNumberRef || '',
    } as any)
    .select('id').single();
  if (error) throw error;
  return created.id;
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
          preferred_presenter_id: data.preferredPresenterId || null,
          presenter_reference: data.presenterReference || '',
          email: data.email || '',
          phone: data.phone || '',
        } as any)
        .select()
        .single();
      if (error) throw error;

      const companyId = company.id;
      const roleInserts: any[] = [];

      for (const d of data.directors || []) {
        if (!d.nameEnglish && !d.nameChinese) continue;
        const personId = await findOrCreatePerson({
          identity: d.identity, nameEnglish: d.nameEnglish, nameChinese: d.nameChinese,
          idNumber: d.idNumber, address: d.address, email: d.email,
        });
        roleInserts.push({
          person_id: personId, company_id: companyId, role: 'director',
        });
      }
      for (const s of data.secretaries || []) {
        if (!s.nameEnglish && !s.nameChinese) continue;
        const personId = await findOrCreatePerson({
          identity: s.identity, nameEnglish: s.nameEnglish, nameChinese: s.nameChinese,
          idNumber: s.idNumber, address: s.address, email: s.email,
        });
        roleInserts.push({
          person_id: personId, company_id: companyId, role: 'secretary',
        });
      }
      for (const sh of data.shareholders || []) {
        if (!sh.nameEnglish && !sh.nameChinese && !sh.name) continue;
        const personId = await findOrCreatePerson({
          identity: sh.identity,
          nameEnglish: sh.nameEnglish || sh.name || '',
          nameChinese: sh.nameChinese,
          idNumber: sh.idNumber, address: sh.address, email: sh.email,
        });
        roleInserts.push({
          person_id: personId, company_id: companyId, role: 'shareholder',
          shares: sh.shares || 0,
          share_type: sh.shareType || '',
          currency: sh.currency || 'HKD',
          issue_price: sh.issuePrice || '',
          paid_up: sh.paidUp || '',
          unpaid: sh.unpaid || '',
        });
      }

      if (roleInserts.length) {
        const { error: rErr } = await supabase.from('person_company_roles').insert(roleInserts);
        if (rErr) console.error('Role insert error:', rErr);
      }

      return company;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
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
          preferred_presenter_id: data.preferredPresenterId === undefined ? undefined : (data.preferredPresenterId || null),
          presenter_reference: data.presenterReference,
          signer_role_id: data.signerRoleId === undefined ? undefined : (data.signerRoleId || null),
          status: data.status,
          email: data.email,
          phone: data.phone,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
}

// ---------- Officer (director/secretary) operations ----------
// Note: ids passed in here are person_company_roles.id (per-company assignment).

export function useAddOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { company_id: string; name_english: string; name_chinese?: string; role: string; identity?: string; id_number?: string; address?: string; service_address?: string; date_appointed?: string; date_ceased?: string; place_incorporated?: string; company_number_ref?: string; is_reserve?: boolean }) => {
      const personId = await findOrCreatePerson({
        identity: data.identity,
        nameEnglish: data.name_english,
        nameChinese: data.name_chinese,
        idNumber: data.id_number,
        address: data.address,
        serviceAddress: data.service_address,
        placeIncorporated: data.place_incorporated,
        companyNumberRef: data.company_number_ref,
      });
      const { error } = await supabase.from('person_company_roles').insert({
        person_id: personId,
        company_id: data.company_id,
        role: data.role,
        date_appointed: data.date_appointed || '',
        date_ceased: data.date_ceased || '',
        service_address_override: '',
        is_reserve: !!data.is_reserve,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}

export function useUpdateOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name_english?: string; name_chinese?: string; identity?: string; id_number?: string; address?: string; service_address?: string; date_appointed?: string; date_ceased?: string; place_incorporated?: string; company_number_ref?: string; is_reserve?: boolean } }) => {
      // id is person_company_roles.id — first lookup the person_id
      const { data: roleRow, error: e1 } = await supabase
        .from('person_company_roles').select('person_id').eq('id', id).single();
      if (e1) throw e1;
      const personId = roleRow.person_id;

      // Update central person
      const personUpdate: Record<string, any> = {};
      if (data.name_english !== undefined) personUpdate.name_english = data.name_english;
      if (data.name_chinese !== undefined) personUpdate.name_chinese = data.name_chinese;
      if (data.identity !== undefined) personUpdate.identity = data.identity;
      if (data.id_number !== undefined) personUpdate.id_number = data.id_number;
      if (data.address !== undefined) personUpdate.address = data.address;
      if (data.place_incorporated !== undefined) personUpdate.place_incorporated = data.place_incorporated;
      if (data.company_number_ref !== undefined) personUpdate.company_number_ref = data.company_number_ref;
      if (Object.keys(personUpdate).length > 0) {
        const { error } = await supabase.from('persons').update(personUpdate).eq('id', personId);
        if (error) throw error;
      }

      // Update role-specific fields
      const roleUpdate: Record<string, any> = {};
      if (data.service_address !== undefined) roleUpdate.service_address_override = data.service_address;
      if (data.date_appointed !== undefined) roleUpdate.date_appointed = data.date_appointed;
      if (data.date_ceased !== undefined) roleUpdate.date_ceased = data.date_ceased;
      if (data.is_reserve !== undefined) roleUpdate.is_reserve = data.is_reserve;
      if (Object.keys(roleUpdate).length > 0) {
        const { error } = await supabase.from('person_company_roles').update(roleUpdate).eq('id', id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}

export function useDeleteOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // id = person_company_roles.id; only remove the assignment, keep the person
      const { error } = await supabase.from('person_company_roles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}

export function useAddShareholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { company_id: string; name: string; name_english?: string; name_chinese?: string; shares: number; identity?: string; id_number?: string; address?: string; service_address?: string; email?: string; share_type?: string; issue_price?: string; currency?: string; paid_up?: string; unpaid?: string }) => {
      const personId = await findOrCreatePerson({
        identity: data.identity,
        nameEnglish: data.name_english || data.name,
        nameChinese: data.name_chinese,
        idNumber: data.id_number,
        address: data.address,
        email: data.email,
        serviceAddress: data.service_address,
      });
      const { error } = await supabase.from('person_company_roles').insert({
        person_id: personId,
        company_id: data.company_id,
        role: 'shareholder',
        shares: data.shares || 0,
        share_type: data.share_type || '',
        currency: data.currency || 'HKD',
        issue_price: data.issue_price || '',
        paid_up: data.paid_up || '',
        unpaid: data.unpaid || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}

export function useUpdateShareholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name?: string; name_english?: string; name_chinese?: string; shares?: number; identity?: string; id_number?: string; address?: string; service_address?: string; email?: string; share_type?: string; issue_price?: string; currency?: string; paid_up?: string; unpaid?: string } }) => {
      const { data: roleRow, error: e1 } = await supabase
        .from('person_company_roles').select('person_id').eq('id', id).single();
      if (e1) throw e1;
      const personId = roleRow.person_id;

      const personUpdate: Record<string, any> = {};
      if (data.name_english !== undefined) personUpdate.name_english = data.name_english;
      if (data.name_chinese !== undefined) personUpdate.name_chinese = data.name_chinese;
      if (data.identity !== undefined) personUpdate.identity = data.identity;
      if (data.id_number !== undefined) personUpdate.id_number = data.id_number;
      if (data.address !== undefined) personUpdate.address = data.address;
      if (data.email !== undefined) personUpdate.email = data.email;
      if (Object.keys(personUpdate).length > 0) {
        const { error } = await supabase.from('persons').update(personUpdate).eq('id', personId);
        if (error) throw error;
      }

      const roleUpdate: Record<string, any> = {};
      if (data.service_address !== undefined) roleUpdate.service_address_override = data.service_address;
      if (data.shares !== undefined) roleUpdate.shares = data.shares;
      if (data.share_type !== undefined) roleUpdate.share_type = data.share_type;
      if (data.currency !== undefined) roleUpdate.currency = data.currency;
      if (data.issue_price !== undefined) roleUpdate.issue_price = data.issue_price;
      if (data.paid_up !== undefined) roleUpdate.paid_up = data.paid_up;
      if (data.unpaid !== undefined) roleUpdate.unpaid = data.unpaid;
      if (Object.keys(roleUpdate).length > 0) {
        const { error } = await supabase.from('person_company_roles').update(roleUpdate).eq('id', id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}

export function useDeleteShareholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('person_company_roles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}

// Copy officers and/or shareholders from one company to another.
// In the new model, "copying" simply means reusing the same persons under a new company.
// ids passed in are person_company_roles.id values.
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
      const allIds = [...officerIds, ...shareholderIds];
      if (allIds.length === 0) return;
      const { data: srcRoles, error: e1 } = await supabase
        .from('person_company_roles').select('*').in('id', allIds);
      if (e1) throw e1;

      const inserts = (srcRoles || []).map((r: any) => ({
        person_id: r.person_id,
        company_id: targetCompanyId,
        role: r.role,
        date_appointed: r.date_appointed || '',
        date_ceased: '',
        service_address_override: r.service_address_override || '',
        shares: r.shares || 0,
        share_type: r.share_type || '',
        currency: r.currency || 'HKD',
        issue_price: r.issue_price || '',
        paid_up: r.paid_up || '',
        unpaid: r.unpaid || '',
      }));

      if (inserts.length) {
        const { error } = await supabase.from('person_company_roles').insert(inserts as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}
