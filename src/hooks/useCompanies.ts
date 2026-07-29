import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Company, Person, Shareholder } from '@/types';
import { recordChangeEvent, EVENT_FORM_MAP } from '@/lib/changeEvents';

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
  passport_country: string;
  passport_expiry: string;
  address: string;
  service_address: string;
  addr_flat: string;
  addr_building: string;
  addr_street: string;
  addr_district: string;
  addr_region: string;
  svc_addr_flat: string;
  svc_addr_building: string;
  svc_addr_street: string;
  svc_addr_district: string;
  svc_addr_region: string;
  email: string;
  whatsapp: string;
  phone: string;
  place_incorporated: string;
  company_number_ref: string;
  tcsp_number: string;
  passport_file_path: string;
  id_card_file_path: string;
  address_proof_file_path: string;
  date_of_birth?: string;
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
  notes?: string;
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

function buildPersonForRole(p: DbPerson, r: DbRole, role: 'director' | 'secretary' | 'shareholder' | 'authorized_representative'): Person {
  return {
    // Use the role-relationship id so dialogs / mutations can target per-company assignment
    id: r.id,
    nameChinese: p.name_chinese || '',
    nameEnglish: p.name_english || '',
    email: p.email || '',
    identity: (p.identity as 'natural' | 'corporate') || 'natural',
    role,
    address: p.address || [p.addr_flat, p.addr_building, p.addr_street, p.addr_district, p.addr_region].map(s => (s || '').trim()).filter(Boolean).join(', ') || '',
    serviceAddress: r.service_address_override || p.service_address || '',
    // 分拆地址欄位
    addrFlat: p.addr_flat || '',
    addrBuilding: p.addr_building || '',
    addrStreet: p.addr_street || '',
    addrDistrict: p.addr_district || '',
    addrRegion: p.addr_region || '',
    svcAddrFlat: p.svc_addr_flat || '',
    svcAddrBuilding: p.svc_addr_building || '',
    svcAddrStreet: p.svc_addr_street || '',
    svcAddrDistrict: p.svc_addr_district || '',
    svcAddrRegion: p.svc_addr_region || '',
    idNumber: p.id_number || '',
    passportNumber: p.passport_number || '',
    passportCountry: p.passport_country || '',
    passportExpiry: p.passport_expiry || '',
    whatsapp: p.whatsapp || '',
    passportFilePath: p.passport_file_path || '',
    idCardFilePath: p.id_card_file_path || '',
    addressProofFilePath: p.address_proof_file_path || '',
    dateAppointed: r.date_appointed || '',
    dateCeased: r.date_ceased || '',
    placeIncorporated: p.place_incorporated || '',
    companyNumberRef: p.company_number_ref || (p.identity === 'corporate' ? p.id_number : '') || '',
    brNumber: p.company_number_ref || (p.identity === 'corporate' ? p.id_number : '') || '',
    tcspNumber: p.tcsp_number || '',
    authScope: r.notes || '',
    previousNameChinese: p.previous_name_chinese || '',
    previousNameEnglish: p.previous_name_english || '',
    aliasChinese: p.alias_chinese || '',
    aliasEnglish: p.alias_english || '',
    isReserve: !!r.is_reserve,
    dateOfBirth: p.date_of_birth || '',
    companies: [],
    createdAt: '',
    updatedAt: '',
    // Internal: original person id (not in Person type but needed for some ops)
    ...({ _personId: p.id } as any),
  };
}

function buildShareholderForRole(p: DbPerson, r: DbRole): Shareholder {
  const displayName = p.name_english || p.name_chinese || '';
  const addr = p.address || [p.addr_flat, p.addr_building, p.addr_street, p.addr_district, p.addr_region].map(s => (s || '').trim()).filter(Boolean).join(', ') || '';
  return {
    id: r.id,
    name: displayName,
    nameEnglish: p.name_english || '',
    nameChinese: p.name_chinese || '',
    shares: r.shares || 0,
    identity: (p.identity as 'natural' | 'corporate') || 'natural',
    idNumber: p.id_number || '',
    address: addr,
    serviceAddress: r.service_address_override || p.service_address || '',
    email: p.email || '',
    shareType: r.share_type || '',
    issuePrice: r.issue_price || '',
    currency: r.currency || 'HKD',
    paidUp: r.paid_up || '',
    unpaid: r.unpaid || '',
    placeIncorporated: p.place_incorporated || '',
    companyNumberRef: p.company_number_ref || '',
    brNumber: p.company_number_ref || '',
    tcspNumber: p.tcsp_number || '',
    dateAppointed: r.date_appointed || '',
    dateCeased: r.date_ceased || '',
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
  const authorizedReps: Person[] = [];

  for (const r of rolesForCompany) {
    const p = personMap.get(r.person_id);
    if (!p) continue;
    if (r.role === 'director' || r.role === 'reserve_director') {
      directors.push(buildPersonForRole(p, r, 'director'));
    } else if (r.role === 'secretary') {
      secretaries.push(buildPersonForRole(p, r, 'secretary'));
    } else if (r.role === 'shareholder') {
      shareholders.push(buildShareholderForRole(p, r));
    } else if (r.role === 'authorized_representative') {
      authorizedReps.push(buildPersonForRole(p, r, 'authorized_representative'));
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
    authorizedReps,
    companyType: c.company_type || '',
    businessCode: c.business_code || '',
    updatedAt: new Date(c.updated_at).toLocaleDateString('zh-TW'),
    regFlat: c.reg_flat || '',
    regBuilding: c.reg_building || '',
    regStreet: c.reg_street || '',
    regDistrict: c.reg_district || '',
    regRegion: c.reg_region || '',
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
      const { data, error } = await supabase.from('companies').delete().eq('id', id);
      if (error) {
        const e = error as any;
        // Build readable message from any error shape
        const parts: string[] = [];
        if (e.status) parts.push(`[${e.status}]`);
        if (e.error) parts.push(e.error);
        if (e.message && e.message !== e.error) parts.push(e.message);
        const msg = parts.join(' ') || JSON.stringify(error);
        console.error('[useDeleteCompany]', { id, raw: error, msg });
        throw new Error(msg || '刪除失敗');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['companies'] });
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
    if (data && data.length > 0) {
      const personId = data[0].id;
      // Update corporate/passport fields on existing person if provided
      const corpPatch: Record<string, any> = {};
      if (input.companyNumberRef) corpPatch.company_number_ref = input.companyNumberRef;
      if (input.placeIncorporated) corpPatch.place_incorporated = input.placeIncorporated;
      if (input.passportNumber) corpPatch.passport_number = input.passportNumber;
      if (input.email) corpPatch.email = input.email;
      if (Object.keys(corpPatch).length > 0) {
        await supabase.from('persons').update(corpPatch as any).eq('id', personId);
      }
      return personId;
    }
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
          reg_region: data.regRegion || '',
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

      const today = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
      for (const d of data.directors || []) {
        if (!d.nameEnglish && !d.nameChinese) continue;
        const personId = await findOrCreatePerson({
          identity: d.identity, nameEnglish: d.nameEnglish, nameChinese: d.nameChinese,
          idNumber: d.idNumber, address: d.address, email: d.email,
          passportNumber: d.passportNumber,
          placeIncorporated: d.placeIncorporated,
          companyNumberRef: d.companyNumberRef,
        });
        roleInserts.push({
          person_id: personId, company_id: companyId, role: 'director',
          date_appointed: d.dateAppointed || today,
          date_ceased: d.dateCeased || '',
          is_reserve: d.isReserve ? 1 : 0,
        });
      }
      for (const s of data.secretaries || []) {
        if (!s.nameEnglish && !s.nameChinese) continue;
        const personId = await findOrCreatePerson({
          identity: s.identity, nameEnglish: s.nameEnglish, nameChinese: s.nameChinese,
          idNumber: s.idNumber, address: s.address, email: s.email,
          passportNumber: s.passportNumber,
          placeIncorporated: s.placeIncorporated,
          companyNumberRef: s.companyNumberRef,
        });
        roleInserts.push({
          person_id: personId, company_id: companyId, role: 'secretary',
          date_appointed: s.dateAppointed || today,
          date_ceased: s.dateCeased || '',
          is_reserve: s.isReserve ? 1 : 0,
        });
      }
      for (const sh of data.shareholders || []) {
        if (!sh.nameEnglish && !sh.nameChinese && !sh.name) continue;
        const personId = await findOrCreatePerson({
          identity: sh.identity,
          nameEnglish: sh.nameEnglish || sh.name || '',
          nameChinese: sh.nameChinese,
          idNumber: sh.idNumber, address: sh.address, email: sh.email,
          passportNumber: sh.passportNumber,
        });
        roleInserts.push({
          person_id: personId, company_id: companyId, role: 'shareholder',
          date_appointed: sh.dateAppointed || today,
          date_ceased: sh.dateCeased || '',
          shares: sh.shares || 0,
          share_type: sh.shareType || '',
          currency: sh.currency || 'HKD',
          issue_price: sh.issuePrice || '',
          paid_up: sh.paidUp || '',
          unpaid: sh.unpaid || '',
        });
      }

      // Manual selected people (existing person IDs)
      const manualPeople = (data as any).manualPeople as { personId: string; role: string; dateAppointed?: string; dateCeased?: string; isReserve?: boolean }[] | undefined;
      if (manualPeople && manualPeople.length) {
        for (const mp of manualPeople) {
          // Check for duplicate before inserting
          const alreadyAdded = roleInserts.some(
            (r) => r.person_id === mp.personId && r.role === mp.role
          );
          if (!alreadyAdded) {
            roleInserts.push({
              person_id: mp.personId,
              company_id: companyId,
              role: mp.role,
              date_appointed: mp.dateAppointed || today,
              date_ceased: mp.dateCeased || '',
              is_reserve: mp.isReserve ? 1 : 0,
              service_address_override: '',
              shares: 0,
              share_type: '',
              currency: 'HKD',
              issue_price: '',
              paid_up: '',
              unpaid: '',
            });
          }
        }
      }

      if (roleInserts.length) {
        const { error: rErr } = await supabase.from('person_company_roles').insert(roleInserts);
        if (rErr) throw new Error(`角色關聯失敗：${rErr.message || JSON.stringify(rErr)}`);
      }

      // ── 寫入公司日誌：人員委任記錄 ──
      const ROLE_LABEL_MAP: Record<string, string> = {
        director: '董事', secretary: '秘書', shareholder: '股東',
        reserve_director: '候補董事', authorized_representative: '授權代表',
      };
      const logEntries: any[] = [];
      const addLogEntry = (role: string, nameEn: string, nameZh: string, dateAppointed: string) => {
        const roleLabel = ROLE_LABEL_MAP[role] || role;
        const personName = nameZh ? `${nameEn}（${nameZh}）` : nameEn;
        const date = dateAppointed || today;
        logEntries.push({
          company_id: companyId,
          company_name_hint: data.name || '',
          source_folder: '新增公司',
          doc_type: 'PERSONNEL_APPOINT',
          doc_date: date,
          notes: `委任${roleLabel}：${personName}`,
          html_content: `<p>委任${roleLabel}</p><p>${personName}</p><p>日期：${date}</p>`,
        });
      };
      // directors
      for (const d of data.directors || []) {
        if (!d.nameEnglish && !d.nameChinese) continue;
        addLogEntry('director', d.nameEnglish || '', d.nameChinese || '', d.dateAppointed || '');
      }
      // secretaries
      for (const s of data.secretaries || []) {
        if (!s.nameEnglish && !s.nameChinese) continue;
        addLogEntry('secretary', s.nameEnglish || '', s.nameChinese || '', s.dateAppointed || '');
      }
      // shareholders
      for (const sh of data.shareholders || []) {
        const name = sh.nameEnglish || sh.name || '';
        const cnName = sh.nameChinese || '';
        if (!name && !cnName) continue;
        addLogEntry('shareholder', name, cnName, sh.dateAppointed || '');
      }
      // manualPeople — look up names from persons table
      if (manualPeople && manualPeople.length) {
        const mpIds = manualPeople.map(mp => mp.personId);
        const { data: mpPersons } = await supabase.from('persons').select('id,name_english,name_chinese').in('id', mpIds);
        const personMap = new Map<string, { nameEn: string; nameZh: string }>();
        if (mpPersons) {
          for (const p of mpPersons as any[]) {
            personMap.set(p.id, { nameEn: p.name_english || '', nameZh: p.name_chinese || '' });
          }
        }
        for (const mp of manualPeople) {
          const p = personMap.get(mp.personId);
          const nameEn = p?.nameEn || mp.personId;
          const nameZh = p?.nameZh || '';
          addLogEntry(mp.role, nameEn, nameZh, mp.dateAppointed || '');
        }
      }
      // Batch create log entries via API
      if (logEntries.length > 0) {
        try {
          const token = localStorage.getItem('secretary_jwt') || '';
          await fetch('/api/company_logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(logEntries),
          });
        } catch (e) {
          console.warn('[useAddCompany] Failed to create company_logs entries:', e);
          // Don't throw — company creation succeeded, just log the warning
        }
      }

      return company;
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['companies'] });
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
    onSuccess: (_data, variables) => {
      queryClient.refetchQueries({ queryKey: ['companies'] });
      // Record change events for NAR1 smart filing
      const { id: companyId, data } = variables;
      if (data.regFlat !== undefined || data.regBuilding !== undefined || data.regStreet !== undefined || data.regDistrict !== undefined || data.regRegion !== undefined) {
        recordChangeEvent({ company_id: companyId, event_type: 'address_change', new_value: { reg_flat: data.regFlat, reg_building: data.regBuilding, reg_street: data.regStreet, reg_district: data.regDistrict, reg_region: data.regRegion }, related_form_type: 'NR1' });
      }
      if (data.name !== undefined || data.chineseName !== undefined) {
        recordChangeEvent({ company_id: companyId, event_type: 'name_change', new_value: { name: data.name, chinese_name: data.chineseName }, related_form_type: 'NNC2' });
      }
      if (data.email !== undefined) {
        recordChangeEvent({ company_id: companyId, event_type: 'company_email_change', new_value: { email: data.email }, related_form_type: 'NR1' });
      }
      if (data.phone !== undefined) {
        recordChangeEvent({ company_id: companyId, event_type: 'company_phone_change', new_value: { phone: data.phone }, related_form_type: 'NR1' });
      }
    },
  });
}

// ---------- Officer (director/secretary) operations ----------
// Note: ids passed in here are person_company_roles.id (per-company assignment).

export function useAddOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { company_id: string; name_english: string; name_chinese?: string; role: string; identity?: string; id_number?: string; email?: string; tcsp_number?: string; address?: string; service_address?: string; date_appointed?: string; date_ceased?: string; place_incorporated?: string; company_number_ref?: string; is_reserve?: boolean; date_of_birth?: string; auth_scope?: string }) => {
      const today = new Date().toLocaleDateString('en-GB');
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
      const personPatch: Record<string, any> = {};
      if (data.date_of_birth) personPatch.date_of_birth = data.date_of_birth;
      if (data.email) personPatch.email = data.email;
      if (data.tcsp_number) personPatch.tcsp_number = data.tcsp_number;
      if (data.place_incorporated) personPatch.place_incorporated = data.place_incorporated;
      if (data.company_number_ref) personPatch.company_number_ref = data.company_number_ref;
      if ((data as any).passport_number) personPatch.passport_number = (data as any).passport_number;
      if (Object.keys(personPatch).length > 0) {
        await supabase.from('persons').update(personPatch as any).eq('id', personId);
      }
      const { error } = await supabase.from('person_company_roles').insert({
        person_id: personId,
        company_id: data.company_id,
        role: data.role,
        date_appointed: data.date_appointed || today,
        date_ceased: data.date_ceased || '',
        service_address_override: '',
        is_reserve: !!data.is_reserve,
        notes: data.auth_scope || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.refetchQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      // Record change event for NAR1 smart filing
      const role = variables.role;
      let eventType: string | null = null;
      if (role === 'director') eventType = 'director_appoint';
      else if (role === 'secretary') eventType = 'secretary_appoint';
      else if (role === 'reserve_director') eventType = 'reserve_director_appoint';
      if (eventType) {
        recordChangeEvent({
          company_id: variables.company_id,
          event_type: eventType,
          role: variables.role,
          new_value: { name_english: variables.name_english, name_chinese: variables.name_chinese, date_appointed: variables.date_appointed },
          related_form_type: EVENT_FORM_MAP[eventType] || '',
        });
      }
    },
  });
}

export function useUpdateOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name_english?: string; name_chinese?: string; identity?: string; id_number?: string; email?: string; tcsp_number?: string; address?: string; service_address?: string; date_appointed?: string; date_ceased?: string; place_incorporated?: string; company_number_ref?: string; is_reserve?: boolean; date_of_birth?: string; auth_scope?: string } }) => {
      // id is person_company_roles.id — first lookup the person_id, company_id, role
      const { data: roleRow, error: e1 } = await supabase
        .from('person_company_roles').select('person_id, company_id, role').eq('id', id).single();
      if (e1) throw e1;
      const personId = roleRow.person_id;
      const companyId = roleRow.company_id;
      const officerRole = roleRow.role;

      // Update central person
      const personUpdate: Record<string, any> = {};
      if (data.name_english !== undefined) personUpdate.name_english = data.name_english;
      if (data.name_chinese !== undefined) personUpdate.name_chinese = data.name_chinese;
      if (data.identity !== undefined) personUpdate.identity = data.identity;
      if (data.id_number !== undefined) personUpdate.id_number = data.id_number;
      if (data.email !== undefined) personUpdate.email = data.email;
      if (data.tcsp_number !== undefined) personUpdate.tcsp_number = data.tcsp_number;
      if (data.address !== undefined) personUpdate.address = data.address;
      if (data.place_incorporated !== undefined) personUpdate.place_incorporated = data.place_incorporated;
      if (data.company_number_ref !== undefined) personUpdate.company_number_ref = data.company_number_ref;
      if (data.date_of_birth !== undefined) personUpdate.date_of_birth = data.date_of_birth;
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
      if (data.auth_scope !== undefined) roleUpdate.notes = data.auth_scope;
      if (Object.keys(roleUpdate).length > 0) {
        const { error } = await supabase.from('person_company_roles').update(roleUpdate).eq('id', id);
        if (error) throw error;
      }

      return { personId, companyId, officerRole, hasDateCeased: !!data.date_ceased };
    },
    onSuccess: (result) => {
      queryClient.refetchQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      // If date_ceased is being set, record a cessation event
      if (result.hasDateCeased) {
        const role = result.officerRole;
        let eventType: string | null = null;
        if (role === 'director') eventType = 'director_cease';
        else if (role === 'secretary') eventType = 'secretary_cease';
        else if (role === 'reserve_director') eventType = 'reserve_director_cease';
        if (eventType) {
          recordChangeEvent({
            company_id: result.companyId,
            event_type: eventType,
            person_id: result.personId,
            role: result.officerRole,
            related_form_type: EVENT_FORM_MAP[eventType] || '',
          });
        }
      }
    },
  });
}

export function useDeleteOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Fetch role info before deleting for change event recording
      const { data: roleRow, error: fetchErr } = await supabase
        .from('person_company_roles').select('person_id, company_id, role').eq('id', id).single();
      if (fetchErr) throw fetchErr;

      const { data, error } = await supabase.from('person_company_roles').delete().eq('id', id);
      if (error) throw error;

      return { person_id: roleRow.person_id, company_id: roleRow.company_id, role: roleRow.role };
    },
    onSuccess: (result) => {
      queryClient.refetchQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      // Record cessation event for NAR1 smart filing
      const role = result.role;
      let eventType: string | null = null;
      if (role === 'director') eventType = 'director_cease';
      else if (role === 'secretary') eventType = 'secretary_cease';
      else if (role === 'reserve_director') eventType = 'reserve_director_cease';
      if (eventType) {
        recordChangeEvent({
          company_id: result.company_id,
          event_type: eventType,
          person_id: result.person_id,
          role: result.role,
          related_form_type: EVENT_FORM_MAP[eventType] || '',
        });
      }
    },
    onError: (err: any) => {
      console.error('[useDeleteOfficer] onError:', err);
    },
  });
}

export function useAddShareholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { company_id: string; name: string; name_english?: string; name_chinese?: string; shares: number; identity?: string; id_number?: string; address?: string; service_address?: string; email?: string; share_type?: string; issue_price?: string; currency?: string; paid_up?: string; unpaid?: string; place_incorporated?: string; company_number_ref?: string; tcsp_number?: string }) => {
      const personId = await findOrCreatePerson({
        identity: data.identity,
        nameEnglish: data.name_english || data.name,
        nameChinese: data.name_chinese,
        idNumber: data.id_number,
        address: data.address,
        email: data.email,
        serviceAddress: data.service_address,
        placeIncorporated: data.place_incorporated,
        companyNumberRef: data.company_number_ref,
      });
      // 法人股東專屬欄位（ME-08）：findOrCreatePerson 只在新建時寫入，這裡補一次
      // patch 以覆蓋既有 person，並處理 findOrCreatePerson 不含的 tcsp_number。
      const personPatch: Record<string, any> = {};
      if (data.place_incorporated) personPatch.place_incorporated = data.place_incorporated;
      if (data.company_number_ref) personPatch.company_number_ref = data.company_number_ref;
      if (data.tcsp_number) personPatch.tcsp_number = data.tcsp_number;
      if (Object.keys(personPatch).length > 0) {
        await supabase.from('persons').update(personPatch as any).eq('id', personId);
      }
      const today = new Date().toLocaleDateString('en-GB');
      const { error } = await supabase.from('person_company_roles').insert({
        person_id: personId,
        company_id: data.company_id,
        role: 'shareholder',
        date_appointed: today,
        shares: data.shares || 0,
        share_type: data.share_type || '',
        currency: data.currency || 'HKD',
        issue_price: data.issue_price || '',
        paid_up: data.paid_up || '',
        unpaid: data.unpaid || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.refetchQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      recordChangeEvent({
        company_id: variables.company_id,
        event_type: 'shareholder_add',
        new_value: { name: variables.name_english || variables.name, name_chinese: variables.name_chinese, shares: variables.shares, share_type: variables.share_type },
        related_form_type: 'NSC1',
      });
    },
  });
}

export function useUpdateShareholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name?: string; name_english?: string; name_chinese?: string; shares?: number; identity?: string; id_number?: string; address?: string; service_address?: string; email?: string; share_type?: string; issue_price?: string; currency?: string; paid_up?: string; unpaid?: string; place_incorporated?: string; company_number_ref?: string; tcsp_number?: string } }) => {
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
      if (data.place_incorporated !== undefined) personUpdate.place_incorporated = data.place_incorporated;
      if (data.company_number_ref !== undefined) personUpdate.company_number_ref = data.company_number_ref;
      if (data.tcsp_number !== undefined) personUpdate.tcsp_number = data.tcsp_number;
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
      queryClient.refetchQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}

export function useDeleteShareholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Fetch person_id and company_id before deleting for change event recording
      const { data: roleRow, error: fetchErr } = await supabase
        .from('person_company_roles').select('person_id, company_id').eq('id', id).single();
      if (fetchErr) throw fetchErr;

      const { error } = await supabase.from('person_company_roles').delete().eq('id', id);
      if (error) throw error;

      return { person_id: roleRow.person_id, company_id: roleRow.company_id };
    },
    onSuccess: (result) => {
      queryClient.refetchQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      recordChangeEvent({
        company_id: result.company_id,
        event_type: 'shareholder_remove',
        person_id: result.person_id,
        role: 'shareholder',
        related_form_type: 'Share Transfer',
      });
    },
  });
}

// Batch assign: link multiple persons to multiple companies with a given role.
// personIds = persons.id (the actual person record ids)
export function useBatchAssign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      mode,
      personIds,
      companyIds,
      role,
      companyRoles,
    }: {
      mode: 'many-to-one' | 'one-to-many';
      personIds: string[];
      companyIds: string[];
      role: string;
      companyRoles?: Record<string, string>; // per-company role override (one-to-many)
    }) => {
      let count = 0;
      const inserts: any[] = [];

      for (const personId of personIds) {
        for (const companyId of companyIds) {
          const effectiveRole = companyRoles?.[companyId] || role;
          // Check if the person already has this role in this company
          const { data: existing } = await supabase
            .from('person_company_roles')
            .select('id')
            .eq('person_id', personId)
            .eq('company_id', companyId)
            .eq('role', effectiveRole)
            .limit(1);

          if (existing && existing.length > 0) continue; // Skip duplicates

          inserts.push({
            person_id: personId,
            company_id: companyId,
            role: effectiveRole,
            date_appointed: new Date().toLocaleDateString('en-GB'),
            date_ceased: '',
            service_address_override: '',
            shares: 0,
            share_type: '',
            currency: 'HKD',
            issue_price: '',
            paid_up: '',
            unpaid: '',
          });
          count++;
        }
      }

      if (inserts.length > 0) {
        // Batch insert in chunks of 50 to avoid payload limits
        for (let i = 0; i < inserts.length; i += 50) {
          const chunk = inserts.slice(i, i + 50);
          const { error } = await supabase.from('person_company_roles').insert(chunk as any);
          if (error) throw error;
        }

        // ── 寫入公司日誌：人員委任記錄 ──
        const today = new Date().toLocaleDateString('en-GB');
        const ROLE_LABEL_MAP: Record<string, string> = {
          director: '董事', secretary: '秘書', shareholder: '股東',
          reserve_director: '候補董事', authorized_representative: '授權代表',
        };
        const uniquePersonIds = [...new Set(personIds)];
        const { data: persons } = await supabase.from('persons')
          .select('id,name_english,name_chinese').in('id', uniquePersonIds);
        const personMap = new Map<string, { nameEn: string; nameZh: string }>();
        if (persons) {
          for (const p of persons as any[]) {
            personMap.set(p.id, { nameEn: p.name_english || '', nameZh: p.name_chinese || '' });
          }
        }
        const logEntries: any[] = [];
        for (const ins of inserts) {
          const p = personMap.get(ins.person_id);
          const nameEn = p?.nameEn || ins.person_id;
          const nameZh = p?.nameZh || '';
          const personName = nameZh ? `${nameEn}（${nameZh}）` : nameEn;
          const effectiveRole = ins.role;
          const roleLabel = ROLE_LABEL_MAP[effectiveRole] || effectiveRole;
          logEntries.push({
            company_id: ins.company_id,
            doc_type: 'PERSONNEL_APPOINT',
            doc_date: today,
            notes: `委任${roleLabel}：${personName}`,
            html_content: `<p>委任${roleLabel}</p><p>${personName}</p><p>日期：${today}</p>`,
          });
        }
        try {
          const token = localStorage.getItem('secretary_jwt') || '';
          await fetch('/api/company_logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(logEntries),
          });
        } catch (logErr) {
          console.warn('寫入公司日誌失敗', logErr);
        }
      }

      return { count, inserted: inserts.length };
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['companies'] });
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
      roleOverride,
    }: {
      sourceCompanyId: string;
      targetCompanyId: string;
      officerIds: string[];
      shareholderIds: string[];
      roleOverride?: { role: string; isReserve?: boolean };
    }) => {
      const allIds = [...officerIds, ...shareholderIds];
      if (allIds.length === 0) return;
      const { data: srcRoles, error: e1 } = await supabase
        .from('person_company_roles').select('*').in('id', allIds);
      if (e1) throw e1;

      const inserts = (srcRoles || []).map((r: any) => ({
        person_id: r.person_id,
        company_id: targetCompanyId,
        role: roleOverride?.role || r.role,
        is_reserve: roleOverride ? (roleOverride.isReserve || false) : (r.is_reserve || false),
        notes: r.notes || '',
        date_appointed: r.date_appointed || new Date().toLocaleDateString('en-GB'),
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
      queryClient.refetchQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    },
  });
}
