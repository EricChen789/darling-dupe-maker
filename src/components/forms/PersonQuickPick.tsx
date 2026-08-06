import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useCompanies } from '@/hooks/useCompanies';
import { usePresenterList } from '@/hooks/usePresenters';

// ── Types ──

export interface PersonQuickPickData {
  nameChinese?: string;
  nameEnglish?: string;
  surname?: string;       // HK convention: first word = surname
  otherNames?: string;
  address?: string;
  addrFlat?: string;
  addrBuilding?: string;
  addrStreet?: string;
  addrDistrict?: string;
  addrRegion?: string;
  phone?: string;
  fax?: string;
  email?: string;
  reference?: string;
  idNumber?: string;
  passportCountry?: string;
  passportNumber?: string;
  identity?: 'natural' | 'corporate';
  tcspLicense?: string;
  companyNumberRef?: string;
}

interface PersonOption {
  id: string;
  label: string;
  sublabel: string;
  data: PersonQuickPickData;
}

interface PersonQuickPickProps {
  companyId?: string;
  label?: string;
  placeholder?: string;
  onPick: (data: PersonQuickPickData) => void;
  /** If true, also show saved presenters in the picker (default true) */
  includePresenters?: boolean;
  /** If true, show people from ALL companies in the system (ignores companyId for people list) */
  includeAllCompanies?: boolean;
  /** If true, fetch ALL persons from D1 API (bypasses Supabase company→role chain) */
  includeAllPersons?: boolean;
}

// ── Defaults ──

const DEFAULT_LABEL = '👤 從系統選擇人員（選後自動填入）';
const DEFAULT_PLACEHOLDER = '— 選擇人員自動填入 —';
const NO_COMPANY_PLACEHOLDER = '— 選擇公司後可從公司人員載入 —';
const NO_OPTIONS_PLACEHOLDER = '— 該公司暫無董事／秘書，且無已儲存提交人 —';

/** Fetch all persons via D1 API */
function useAllPersons(enabled: boolean) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('secretary_jwt') || '' : '';
  return useQuery({
    queryKey: ['all-persons-d1'],
    queryFn: async () => {
      const resp = await fetch('/api/persons?limit=5000', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        console.error('[PersonQuickPick] D1 persons fetch failed:', resp.status, await resp.text().catch(() => ''));
        return [];
      }
      const data = await resp.json();
      if (!Array.isArray(data)) {
        console.error('[PersonQuickPick] Unexpected response shape:', typeof data, data);
        return [];
      }
      return data;
    },
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
}

// ── Component ──

export default function PersonQuickPick({
  companyId,
  label = DEFAULT_LABEL,
  placeholder,
  onPick,
  includePresenters = true,
  includeAllCompanies = false,
  includeAllPersons = false,
}: PersonQuickPickProps) {
  const { data: companies = [] } = useCompanies();
  const { data: presenters = [] } = usePresenterList();
  const { data: allPersons = [] } = useAllPersons(includeAllPersons);

  // ── Build options ──
  const options = useMemo(() => {
    const groups: { group: string; items: PersonOption[] }[] = [];

    // 1. Company directors & secretaries
    if (companyId) {
      const company = companies.find(c => c.id === companyId);
      if (company) {
        const people: PersonOption[] = [];
        for (const d of company.directors || []) {
          people.push({
            id: `dir_${d.id}`,
            label: d.nameEnglish || d.nameChinese || '?',
            sublabel: `董事 Director${d.nameChinese ? ` · ${d.nameChinese}` : ''}`,
            data: {
              nameChinese: d.nameChinese || '',
              nameEnglish: d.nameEnglish || '',
              surname: (d.nameEnglish || '').split(' ')[0] || '',
              otherNames: (d.nameEnglish || '').split(' ').slice(1).join(' ') || '',
              address: d.address || '',
              addrFlat: d.addrFlat || '',
              addrBuilding: d.addrBuilding || '',
              addrStreet: d.addrStreet || '',
              addrDistrict: d.addrDistrict || '',
              addrRegion: d.addrRegion || '',
              phone: (d as any).phone || '',
              fax: (d as any).fax || '',
              email: d.email || '',
              idNumber: (d as any).hkidPartial || (d as any).idNumber || '',
              identity: (d as any).identity || 'natural',
              companyNumberRef: (d as any).companyNumberRef || (d as any).company_number_ref || '',
            },
          });
        }
        for (const s of company.secretaries || []) {
          people.push({
            id: `sec_${s.id}`,
            label: s.nameEnglish || s.nameChinese || '?',
            sublabel: `公司秘書 Secretary${s.nameChinese ? ` · ${s.nameChinese}` : ''}`,
            data: {
              nameChinese: s.nameChinese || '',
              nameEnglish: s.nameEnglish || '',
              surname: (s.nameEnglish || '').split(' ')[0] || '',
              otherNames: (s.nameEnglish || '').split(' ').slice(1).join(' ') || '',
              address: s.address || '',
              addrFlat: s.addrFlat || '',
              addrBuilding: s.addrBuilding || '',
              addrStreet: s.addrStreet || '',
              addrDistrict: s.addrDistrict || '',
              addrRegion: s.addrRegion || '',
              phone: (s as any).phone || '',
              fax: (s as any).fax || '',
              email: s.email || '',
              idNumber: (s as any).hkidPartial || (s as any).idNumber || '',
              identity: (s as any).identity || 'natural',
              tcspLicense: (s as any).tcspNumber || (s as any).tcsp_number || '',
              companyNumberRef: (s as any).companyNumberRef || (s as any).company_number_ref || '',
            },
          });
        }
        if (people.length > 0) {
          groups.push({ group: `🏢 ${company.name} — 董事／秘書`, items: people });
        }
      }
    }

    // 2. ALL companies' people (when includeAllCompanies is true)
    if (includeAllCompanies && companies.length > 0) {
      for (const company of companies) {
        // Skip the primary companyId company if already shown in section 1
        if (companyId && company.id === companyId) continue;
        const people: PersonOption[] = [];
        for (const d of company.directors || []) {
          people.push({
            id: `all_dir_${d.id}`,
            label: d.nameEnglish || d.nameChinese || '?',
            sublabel: `${company.name} · 董事 Director${d.nameChinese ? ` · ${d.nameChinese}` : ''}`,
            data: {
              nameChinese: d.nameChinese || '',
              nameEnglish: d.nameEnglish || '',
              surname: (d.nameEnglish || '').split(' ')[0] || '',
              otherNames: (d.nameEnglish || '').split(' ').slice(1).join(' ') || '',
              address: d.address || '',
              addrFlat: d.addrFlat || '',
              addrBuilding: d.addrBuilding || '',
              addrStreet: d.addrStreet || '',
              addrDistrict: d.addrDistrict || '',
              addrRegion: d.addrRegion || '',
              phone: (d as any).phone || '',
              fax: (d as any).fax || '',
              email: d.email || '',
              idNumber: (d as any).hkidPartial || (d as any).idNumber || '',
              identity: (d as any).identity || 'natural',
              companyNumberRef: (d as any).companyNumberRef || (d as any).company_number_ref || '',
            },
          });
        }
        for (const s of company.secretaries || []) {
          people.push({
            id: `all_sec_${s.id}`,
            label: s.nameEnglish || s.nameChinese || '?',
            sublabel: `${company.name} · 公司秘書 Secretary${s.nameChinese ? ` · ${s.nameChinese}` : ''}`,
            data: {
              nameChinese: s.nameChinese || '',
              nameEnglish: s.nameEnglish || '',
              surname: (s.nameEnglish || '').split(' ')[0] || '',
              otherNames: (s.nameEnglish || '').split(' ').slice(1).join(' ') || '',
              address: s.address || '',
              addrFlat: s.addrFlat || '',
              addrBuilding: s.addrBuilding || '',
              addrStreet: s.addrStreet || '',
              addrDistrict: s.addrDistrict || '',
              addrRegion: s.addrRegion || '',
              phone: (s as any).phone || '',
              fax: (s as any).fax || '',
              email: s.email || '',
              idNumber: (s as any).hkidPartial || (s as any).idNumber || '',
              identity: (s as any).identity || 'natural',
              tcspLicense: (s as any).tcspNumber || (s as any).tcsp_number || '',
              companyNumberRef: (s as any).companyNumberRef || (s as any).company_number_ref || '',
            },
          });
        }
        if (people.length > 0) {
          groups.push({ group: `🏢 ${company.name} — 董事／秘書`, items: people });
        }
      }
    }

    // 3. ALL persons from D1 (when includeAllPersons is true)
    if (includeAllPersons && allPersons.length > 0) {
      const seen = new Set<string>();
      // Collect already-shown person names to avoid duplicates
      for (const grp of groups) {
        for (const item of grp.items) {
          const key = (item.data.nameEnglish || '') + '|' + (item.data.nameChinese || '');
          if (key !== '|') seen.add(key);
        }
      }
      const personItems: PersonOption[] = [];
      for (const p of allPersons as any[]) {
        const nameEn = p.name_english || '';
        const nameCn = p.name_chinese || '';
        const key = nameEn + '|' + nameCn;
        if (key === '|' || seen.has(key)) continue;
        seen.add(key);
        const identity = p.identity || 'natural';
        personItems.push({
          id: `d1p_${p.id}`,
          label: nameEn || nameCn || '?',
          sublabel: `${identity === 'corporate' ? '🏢 法人' : '👤 自然人'}${nameCn ? ` · ${nameCn}` : ''}${p.id_number ? ` · ${p.id_number}` : ''}`,
          data: {
            nameChinese: nameCn,
            nameEnglish: nameEn,
            surname: nameEn.split(' ')[0] || '',
            otherNames: nameEn.split(' ').slice(1).join(' ') || '',
            addrFlat: p.addr_flat || '',
            addrBuilding: p.addr_building || '',
            addrStreet: p.addr_street || '',
            addrDistrict: p.addr_district || '',
            addrRegion: p.addr_region || '',
            phone: p.phone || '',
            fax: p.fax || '',
            email: p.email || '',
            idNumber: p.id_number || '',
            passportCountry: p.passport_country || '',
            passportNumber: p.passport_number || '',
            identity: identity as 'natural' | 'corporate',
            tcspLicense: p.tcsp_number || '',
            companyNumberRef: p.company_number_ref || '',
          },
        });
      }
      if (personItems.length > 0) {
        groups.push({ group: '🗂️ 系統所有人員（全部公司）', items: personItems });
      }
    }

    // 4. Saved presenters
    if (includePresenters && presenters.length > 0) {
      groups.push({
        group: '👤 已儲存提交人',
        items: presenters.map(p => ({
          id: `pres_${p.id}`,
          label: p.name,
          sublabel: [p.phone, p.email].filter(Boolean).join(' · ') || (p.address || '').slice(0, 40) || '',
          data: {
            nameChinese: (p as any).nameChinese || '',
            nameEnglish: p.nameEnglish || p.name || '',
            surname: (p.nameEnglish || p.name || '').split(' ')[0] || '',
            otherNames: (p.nameEnglish || p.name || '').split(' ').slice(1).join(' ') || '',
            address: p.address || '',
            phone: p.phone || '',
            fax: p.fax || '',
            email: p.email || '',
            reference: p.reference || '',
          },
        })),
      });
    }

    return groups;
  }, [companyId, companies, presenters, includePresenters, includeAllCompanies, includeAllPersons, allPersons]);

  const disabled = options.length === 0;

  const resolvedPlaceholder = placeholder || (
    disabled
      ? (companyId ? NO_OPTIONS_PLACEHOLDER : NO_COMPANY_PLACEHOLDER)
      : DEFAULT_PLACEHOLDER
  );

  const handleSelect = (id: string) => {
    if (!id) return;
    for (const grp of options) {
      const found = grp.items.find(o => o.id === id);
      if (found) {
        onPick(found.data);
        return;
      }
    }
  };

  return (
    <div className="bg-blue-50/60 border border-blue-200 rounded-md p-3">
      <Label className="text-xs font-semibold text-blue-700 flex items-center gap-1">
        {label}
      </Label>
      <Select value="" onValueChange={handleSelect} disabled={disabled}>
        <SelectTrigger className="mt-1 h-8 text-sm bg-white">
          <SelectValue placeholder={resolvedPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map(grp => (
            <div key={grp.group}>
              <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium">{grp.group}</div>
              {grp.items.map(opt => (
                <SelectItem key={opt.id} value={opt.id}>
                  <div className="flex flex-col">
                    <span className="text-sm">{opt.label}</span>
                    {opt.sublabel ? <span className="text-xs text-muted-foreground">{opt.sublabel}</span> : null}
                  </div>
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
