import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Person } from '@/types';
import { toast } from '@/hooks/use-toast';

// New schema: persons (central master) + person_company_roles (per-company assignments)
interface PersonRow {
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
  created_at: string;
  updated_at: string;
}

interface RoleRow {
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
}

interface CompanyRow {
  id: string;
  name: string;
  company_number: string | null;
  incorporation_date: string | null;
}

async function fetchAllRows<T>(table: 'persons' | 'person_company_roles' | 'companies', columns = '*'): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || []) as unknown as T[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function mapPersonRowToPerson(
  p: PersonRow,
  primaryRole: 'director' | 'secretary' | 'shareholder',
  companies: { id: string; name: string; brNumber: string; incorporationDate?: string }[]
): Person {
  return {
    id: p.id,
    nameChinese: p.name_chinese || '',
    nameEnglish: p.name_english || '',
    email: p.email || '',
    identity: (p.identity === 'corporate' ? 'corporate' : 'natural'),
    role: primaryRole,
    brNumber: p.company_number_ref || undefined,
    address: p.address || undefined,
    serviceAddress: p.service_address || undefined,
    idNumber: p.id_number || undefined,
    passportNumber: p.passport_number || undefined,
    passportExpiry: p.passport_expiry || undefined,
    whatsapp: p.whatsapp || undefined,
    passportFilePath: p.passport_file_path || undefined,
    idCardFilePath: p.id_card_file_path || undefined,
    addressProofFilePath: p.address_proof_file_path || undefined,
    placeIncorporated: p.place_incorporated || undefined,
    companyNumberRef: p.company_number_ref || undefined,
    tcspNumber: p.tcsp_number || undefined,
    previousNameChinese: p.previous_name_chinese || undefined,
    previousNameEnglish: p.previous_name_english || undefined,
    aliasChinese: p.alias_chinese || undefined,
    aliasEnglish: p.alias_english || undefined,
    companies,
    createdAt: new Date(p.created_at).toLocaleDateString('zh-TW'),
    updatedAt: new Date(p.updated_at).toLocaleDateString('zh-TW'),
  };
}

export function useOfficers() {
  const queryClient = useQueryClient();

  const { data: officers = [], isLoading, refetch } = useQuery({
    queryKey: ['persons-list'],
    queryFn: async (): Promise<Person[]> => {
      const [persons, roles, companies] = await Promise.all([
        fetchAllRows<PersonRow>('persons'),
        fetchAllRows<RoleRow>('person_company_roles'),
        fetchAllRows<CompanyRow>('companies', 'id, name, company_number, incorporation_date'),
      ]);

      const companyMap = new Map<string, CompanyRow>();
      companies.forEach(c => companyMap.set(c.id, c));

      // Group roles by person_id
      const rolesByPerson = new Map<string, RoleRow[]>();
      for (const r of roles) {
        const list = rolesByPerson.get(r.person_id) || [];
        list.push(r);
        rolesByPerson.set(r.person_id, list);
      }

      return persons.map(p => {
        const personRoles = rolesByPerson.get(p.id) || [];

        // Determine primary role: director > secretary > shareholder
        const hasDirector = personRoles.some(r => r.role === 'director');
        const hasSecretary = personRoles.some(r => r.role === 'secretary');
        const primaryRole: 'director' | 'secretary' | 'shareholder' =
          hasDirector ? 'director' : hasSecretary ? 'secretary' : 'shareholder';

        // Aggregate unique companies from all roles
        const seen = new Set<string>();
        const companiesList: { id: string; name: string; brNumber: string; incorporationDate?: string }[] = [];
        for (const r of personRoles) {
          if (seen.has(r.company_id)) continue;
          seen.add(r.company_id);
          const c = companyMap.get(r.company_id);
          companiesList.push({
            id: r.company_id,
            name: c?.name || '未知公司',
            brNumber: c?.company_number || '',
            incorporationDate: c?.incorporation_date || '',
          });
        }

        return mapPersonRowToPerson(p, primaryRole, companiesList);
      }).sort((a, b) => (a.nameEnglish || '').localeCompare(b.nameEnglish || ''));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (personId: string) => {
      // Cascade: Flask table_delete for persons also cleans person_company_roles
      const { error } = await supabase.from('persons').delete().eq('id', personId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });

  const cleanupOrphansMutation = useMutation({
    mutationFn: async () => {
      const resp = await fetch('/api/persons/cleanup-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('secretary_jwt') || ''}` },
      });
      if (!resp.ok) throw new Error('Cleanup failed');
      return resp.json() as Promise<{ success: boolean; deleted: number }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async ({ personData, existingPerson }: { personData: Partial<Person>; existingPerson?: Person | null }) => {
      if (existingPerson) {
        const { error } = await supabase
          .from('persons')
          .update({
            name_chinese: personData.nameChinese || '',
            name_english: personData.nameEnglish || '',
            identity: personData.identity || 'natural',
            address: personData.address || '',
            service_address: personData.serviceAddress || '',
            id_number: personData.idNumber || '',
            passport_number: personData.passportNumber || '',
            passport_expiry: personData.passportExpiry || '',
            whatsapp: personData.whatsapp || '',
            email: personData.email || '',
            company_number_ref: personData.brNumber || '',
            passport_file_path: personData.passportFilePath || '',
            id_card_file_path: personData.idCardFilePath || '',
            address_proof_file_path: personData.addressProofFilePath || '',
            tcsp_number: personData.tcspNumber || '',
            previous_name_chinese: personData.previousNameChinese || '',
            previous_name_english: personData.previousNameEnglish || '',
            alias_chinese: personData.aliasChinese || '',
            alias_english: personData.aliasEnglish || '',
            place_incorporated: personData.placeIncorporated || '',
          } as any)
          .eq('id', existingPerson.id);
        if (error) throw error;
      } else {
        toast({ title: '提示', description: '新增人員請在公司詳情頁面中添加', variant: 'destructive' });
        throw new Error('需要關聯公司才能新增人員');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });

  return {
    officers,
    isLoading,
    refetch,
    deleteOfficer: deleteMutation.mutateAsync,
    upsertOfficer: upsertMutation.mutateAsync,
    cleanupOrphans: cleanupOrphansMutation.mutateAsync,
    isCleaningUp: cleanupOrphansMutation.isPending,
  };
}
