import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Person } from '@/types';
import { toast } from '@/hooks/use-toast';

interface OfficerRow {
  id: string;
  company_id: string;
  name_english: string;
  name_chinese: string | null;
  identity: string;
  role: string;
  id_number: string | null;
  address: string | null;
  date_appointed: string | null;
  date_ceased: string | null;
  place_incorporated: string | null;
  company_number_ref: string | null;
  service_address: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
  whatsapp: string | null;
  email: string | null;
  passport_file_path: string | null;
  id_card_file_path: string | null;
  address_proof_file_path: string | null;
  created_at: string;
}

interface CompanyRow {
  id: string;
  name: string;
  company_number: string | null;
}

function mapOfficerToPerson(
  officer: OfficerRow,
  companies: { id: string; name: string; brNumber: string }[]
): Person {
  return {
    id: officer.id,
    nameChinese: officer.name_chinese || '',
    nameEnglish: officer.name_english || '',
    email: officer.email || '',
    identity: (officer.identity === 'corporate' ? 'corporate' : 'natural') as 'natural' | 'corporate',
    role: (['director', 'secretary', 'shareholder'].includes(officer.role) ? officer.role : 'director') as 'director' | 'secretary' | 'shareholder',
    brNumber: officer.company_number_ref || undefined,
    address: officer.address || undefined,
    serviceAddress: officer.service_address || undefined,
    idNumber: officer.id_number || undefined,
    passportNumber: officer.passport_number || undefined,
    passportExpiry: officer.passport_expiry || undefined,
    whatsapp: officer.whatsapp || undefined,
    passportFilePath: officer.passport_file_path || undefined,
    idCardFilePath: officer.id_card_file_path || undefined,
    addressProofFilePath: officer.address_proof_file_path || undefined,
    dateAppointed: officer.date_appointed || undefined,
    dateCeased: officer.date_ceased || undefined,
    placeIncorporated: officer.place_incorporated || undefined,
    companyNumberRef: officer.company_number_ref || undefined,
    companies,
    createdAt: new Date(officer.created_at).toLocaleDateString('zh-TW'),
    updatedAt: new Date(officer.created_at).toLocaleDateString('zh-TW'),
  };
}

export function useOfficers() {
  const queryClient = useQueryClient();

  const { data: officers = [], isLoading, refetch } = useQuery({
    queryKey: ['officers-people'],
    queryFn: async () => {
      // Fetch all officers
      const { data: officerRows, error } = await supabase
        .from('officers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000);

      if (error) throw error;

      // Fetch all companies for mapping
      const { data: companyRows, error: companyError } = await supabase
        .from('companies')
        .select('id, name, company_number')
        .limit(5000);

      if (companyError) throw companyError;

      const companyMap = new Map<string, CompanyRow>();
      (companyRows || []).forEach(c => companyMap.set(c.id, c));

      // Group by officer identity (name_english + identity + role) to aggregate companies
      // But actually each row is one officer-company link, so we group by unique person
      const personMap = new Map<string, { officer: OfficerRow; companies: { id: string; name: string; brNumber: string }[] }>();

      for (const row of officerRows || []) {
        // Use officer id as unique key since each row is unique
        const company = companyMap.get(row.company_id);
        const companyInfo = company
          ? { id: company.id, name: company.name, brNumber: company.company_number || '' }
          : { id: row.company_id, name: '未知公司', brNumber: '' };

        // Group officers by name+identity+role to merge companies
        const key = `${row.name_english}|${row.name_chinese || ''}|${row.identity}|${row.role}`;
        const existing = personMap.get(key);
        if (existing) {
          existing.companies.push(companyInfo);
        } else {
          personMap.set(key, { officer: row, companies: [companyInfo] });
        }
      }

      return Array.from(personMap.values()).map(({ officer, companies }) =>
        mapOfficerToPerson(officer, companies)
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (personId: string) => {
      const { error } = await supabase.from('officers').delete().eq('id', personId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['officers-people'] });
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async ({ personData, existingPerson }: { personData: Partial<Person>; existingPerson?: Person | null }) => {
      if (existingPerson) {
        // Update existing
        const { error } = await supabase
          .from('officers')
          .update({
            name_chinese: personData.nameChinese || '',
            name_english: personData.nameEnglish || '',
            identity: personData.identity || 'natural',
            role: personData.role || 'director',
            address: personData.address || '',
            service_address: personData.serviceAddress || '',
            id_number: personData.idNumber || '',
            passport_number: personData.passportNumber || '',
            passport_expiry: personData.passportExpiry || '',
            whatsapp: personData.whatsapp || '',
            email: personData.email || '',
            company_number_ref: personData.brNumber || '',
          })
          .eq('id', existingPerson.id);
        if (error) throw error;
      } else {
        // For new officers, we need a company_id. Use the first company if available, otherwise error
        toast({ title: '提示', description: '新增人員請在公司詳情頁面中添加', variant: 'destructive' });
        throw new Error('需要關聯公司才能新增人員');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['officers-people'] });
    },
  });

  return {
    officers,
    isLoading,
    refetch,
    deleteOfficer: deleteMutation.mutateAsync,
    upsertOfficer: upsertMutation.mutateAsync,
  };
}
