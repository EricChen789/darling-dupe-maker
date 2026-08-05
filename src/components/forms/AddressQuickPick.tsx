import { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useCompanies } from '@/hooks/useCompanies';
import { usePresenterList } from '@/hooks/usePresenters';

// ── Types ──

export interface AddressQuickPickData {
  flat?: string;
  building?: string;
  street?: string;
  district?: string;
  country?: string;
  region?: string;     // alias for country
  _raw?: string;       // fallback flat address string
}

interface AddressOption {
  id: string;
  label: string;
  sublabel: string;
  data: AddressQuickPickData;
}

interface AddressQuickPickProps {
  companyId?: string;
  label?: string;
  placeholder?: string;
  onPick: (data: AddressQuickPickData) => void;
}

// ── Defaults ──

const DEFAULT_LABEL = '📍 從系統選擇地址（選後自動填入）';
const DEFAULT_PLACEHOLDER = '— 選擇地址自動填入 —';
const NO_COMPANY_PLACEHOLDER = '— 選擇公司後可從公司地址載入 —';
const NO_OPTIONS_PLACEHOLDER = '— 暫無可用地址 —';

/** Split flat address string into structured fields (by comma / newline) */
function splitFlatAddress(addr: string): AddressQuickPickData {
  if (!addr) return {};
  const parts = addr.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return { _raw: addr, flat: addr };
  if (parts.length === 2) return { flat: parts[0], building: parts[1], _raw: addr };
  if (parts.length === 3) return { flat: parts[0], building: parts[1], street: parts[2], _raw: addr };
  if (parts.length === 4) return { flat: parts[0], building: parts[1], street: parts[2], district: parts[3], _raw: addr };
  // 5+ parts: last 2 = district+country, rest split into flat/building/street
  return {
    flat: parts[0],
    building: parts[1],
    street: parts.slice(2, -2).join(', '),
    district: parts[parts.length - 2],
    country: parts[parts.length - 1],
    _raw: addr,
  };
}

/** Build structured address string from fields (for display) */
function buildAddrStr(d: any): string {
  return [d.addrFlat || d.flat, d.addrBuilding || d.building, d.addrStreet || d.street, d.addrDistrict || d.district, d.addrRegion || d.region]
    .filter(Boolean).join(', ');
}

// ── Component ──

export default function AddressQuickPick({
  companyId,
  label = DEFAULT_LABEL,
  placeholder,
  onPick,
}: AddressQuickPickProps) {
  const { data: companies = [] } = useCompanies();
  const { data: presenters = [] } = usePresenterList();

  // ── Build options ──
  const options = useMemo(() => {
    const groups: { group: string; items: AddressOption[] }[] = [];

    if (!companyId) return groups;

    const company = companies.find(c => c.id === companyId);
    if (!company) return groups;

    // 1. Company registered address
    const regAddr = buildAddrStr(company);
    if (regAddr) {
      groups.push({
        group: `🏢 ${company.name}`,
        items: [{
          id: 'company_reg',
          label: '公司註冊地址 Registered Office',
          sublabel: regAddr.slice(0, 60),
          data: {
            flat: company.regFlat || '',
            building: company.regBuilding || '',
            street: company.regStreet || '',
            district: company.regDistrict || '',
            country: company.regRegion || 'Hong Kong',
            region: company.regRegion || 'Hong Kong',
          },
        }],
      });
    }

    // 2. Company personnel addresses (deduplicated)
    const personAddrs: AddressOption[] = [];
    const seen = new Set<string>();
    const allPeople = [
      ...(company.directors || []).map(d => ({ ...d, _role: 'director' as const })),
      ...(company.secretaries || []).map(s => ({ ...s, _role: 'secretary' as const })),
    ];
    for (const p of allPeople) {
      // Prefer structured fields
      const hasStructured = p.addrFlat || p.addrBuilding || p.addrStreet || p.addrDistrict || p.addrRegion;
      let addrStr: string;
      let data: AddressQuickPickData;
      if (hasStructured) {
        addrStr = buildAddrStr(p);
        data = {
          flat: p.addrFlat || '',
          building: p.addrBuilding || '',
          street: p.addrStreet || '',
          district: p.addrDistrict || '',
          country: p.addrRegion || 'Hong Kong',
          region: p.addrRegion || 'Hong Kong',
        };
      } else if (p.address) {
        addrStr = p.address;
        data = { ...splitFlatAddress(p.address), country: data?.country || 'Hong Kong' };
      } else {
        continue; // no address at all
      }
      if (!addrStr || seen.has(addrStr)) continue;
      seen.add(addrStr);
      personAddrs.push({
        id: `addr_${p._role}_${p.id}`,
        label: p.nameEnglish || p.nameChinese || '?',
        sublabel: `${p._role === 'director' ? '董事' : '秘書'} · ${addrStr.slice(0, 40)}`,
        data,
      });
    }
    if (personAddrs.length > 0) {
      groups.push({ group: '👥 公司人員地址', items: personAddrs });
    }

    // 3. Presenter addresses
    if (presenters.length > 0) {
      const presAddrs = presenters.filter(p => p.address).map(p => ({
        id: `addr_pres_${p.id}`,
        label: p.name,
        sublabel: (p.address || '').slice(0, 50),
        data: {
          ...splitFlatAddress(p.address || ''),
          country: 'Hong Kong',
          region: 'Hong Kong',
        },
      }));
      if (presAddrs.length > 0) {
        groups.push({ group: '👤 已儲存提交人地址', items: presAddrs });
      }
    }

    return groups;
  }, [companyId, companies, presenters]);

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
    <div className="bg-green-50/60 border border-green-200 rounded-md p-3">
      <Label className="text-xs font-semibold text-green-700 flex items-center gap-1">
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
