import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCompanies } from '@/hooks/useCompanies';
import { usePresenterList, type Presenter } from '@/hooks/usePresenters';
import { Person } from '@/types';
import { User2, Pencil, Search } from 'lucide-react';

// ─── Types ───

export interface PersonPickOption {
  id: string;
  label: string;
  sublabel: string;
  source: 'company' | 'presenter';
  data: {
    nameChinese?: string;
    nameEnglish?: string;
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
  };
}

interface PersonPickerProps {
  /** Section label, e.g. "申請人", "簽署人" */
  label: string;
  /** Currently selected company ID — loads that company's directors/secretaries */
  companyId?: string;
  /** Current form field values (used to detect manual edits) */
  currentData: {
    nameChinese?: string;
    nameEnglish?: string;
    address1?: string;
    address2?: string;
    address3?: string;
    phone?: string;
    fax?: string;
    email?: string;
    reference?: string;
  };
  /** Called when a person is picked — parent should map returned data to form fields */
  onPick: (data: PersonPickOption['data']) => void;
  /** Which fields to show below the dropdown */
  showFields?: ('nameChinese' | 'nameEnglish' | 'address1' | 'address2' | 'address3' | 'phone' | 'fax' | 'email' | 'reference')[];
  /** Custom field labels */
  fieldLabels?: Partial<Record<string, string>>;
  /** Placeholder for the dropdown */
  placeholder?: string;
  /** If true, show only the dropdown (no manual fields) — useful for signer name only */
  dropdownOnly?: boolean;
}

// ─── Defaults ───

const DEFAULT_FIELDS: PersonPickerProps['showFields'] = [
  'nameChinese', 'nameEnglish', 'address1', 'address2', 'address3', 'phone', 'fax', 'email', 'reference',
];

const DEFAULT_LABELS: Record<string, string> = {
  nameChinese: '中文名稱',
  nameEnglish: '英文名稱',
  address1: '地址 1（Flat, Floor, Block）',
  address2: '地址 2（Building, Street）',
  address3: '地址 3（District, Region, Country）',
  phone: '電話',
  fax: '傳真',
  email: '電郵',
  reference: '參考編號',
};

// ─── Component ───

export default function PersonPicker({
  label, companyId, currentData, onPick,
  showFields = DEFAULT_FIELDS,
  fieldLabels = DEFAULT_LABELS,
  placeholder = '選擇人員或手動輸入...',
  dropdownOnly = false,
}: PersonPickerProps) {
  const { data: companies = [] } = useCompanies();
  const { data: presenters = [] } = usePresenterList();
  const [selectedSource, setSelectedSource] = useState<'company' | 'presenter' | 'manual'>('manual');
  const [selectedId, setSelectedId] = useState('');

  // ── Company persons ──
  const companyPeople = useMemo(() => {
    if (!companyId) return [];
    const company = companies.find(c => c.id === companyId);
    if (!company) return [];
    const people: PersonPickOption[] = [];
    for (const d of company.directors || []) {
      people.push({
        id: d.id,
        label: `${d.nameEnglish || d.nameChinese || '?'} — 董事`,
        sublabel: 'Director',
        source: 'company',
        data: {
          nameChinese: d.nameChinese || '',
          nameEnglish: d.nameEnglish || '',
          addrFlat: d.addrFlat || '',
          addrBuilding: d.addrBuilding || '',
          addrStreet: d.addrStreet || '',
          addrDistrict: d.addrDistrict || '',
          addrRegion: d.addrRegion || '',
          address: d.address || '',
          phone: (d as any).phone || '',
          fax: (d as any).fax || '',
          email: d.email || '',
        },
      });
    }
    for (const s of company.secretaries || []) {
      people.push({
        id: s.id,
        label: `${s.nameEnglish || s.nameChinese || '?'} — 秘書`,
        sublabel: 'Secretary',
        source: 'company',
        data: {
          nameChinese: s.nameChinese || '',
          nameEnglish: s.nameEnglish || '',
          addrFlat: s.addrFlat || '',
          addrBuilding: s.addrBuilding || '',
          addrStreet: s.addrStreet || '',
          addrDistrict: s.addrDistrict || '',
          addrRegion: s.addrRegion || '',
          address: s.address || '',
          phone: (s as any).phone || '',
          fax: (s as any).fax || '',
          email: s.email || '',
        },
      });
    }
    return people;
  }, [companyId, companies]);

  // ── Presenter persons ──
  const presenterPeople = useMemo((): PersonPickOption[] => {
    return presenters.map(p => ({
      id: p.id,
      label: `${p.name}${p.phone ? ` · ${p.phone}` : ''}`,
      sublabel: '已儲存提交人',
      source: 'presenter',
      data: {
        nameChinese: (p as any).nameChinese || '',
        nameEnglish: p.nameEnglish || p.name || '',
        address: p.address || '',
        phone: p.phone || '',
        fax: p.fax || '',
        email: p.email || '',
        reference: p.reference || '',
      },
    }));
  }, [presenters]);

  // ── Merged options ──
  const allOptions = useMemo(() => {
    const opts: { group: string; items: PersonPickOption[] }[] = [];
    if (companyPeople.length > 0) {
      opts.push({ group: `🏢 ${companies.find(c => c.id === companyId)?.name || '公司'} — 董事/秘書`, items: companyPeople });
    }
    if (presenterPeople.length > 0) {
      opts.push({ group: '👤 已儲存提交人', items: presenterPeople });
    }
    return opts;
  }, [companyPeople, presenterPeople, companyId, companies]);

  // ── Handle selection ──
  const handleSelect = (id: string) => {
    if (id === '__manual__') {
      setSelectedSource('manual');
      setSelectedId('');
      return;
    }
    setSelectedId(id);
    // Search all options
    for (const grp of allOptions) {
      const found = grp.items.find(o => o.id === id);
      if (found) {
        setSelectedSource(found.source);
        onPick(found.data);
        return;
      }
    }
  };

  // ── Field update handler ──
  const update = (field: string, val: string) => {
    onPick({ [field]: val } as any);
  };

  // ── Render ──
  return (
    <div className="bg-muted/30 border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <User2 className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">{label}</h3>
        {selectedSource !== 'manual' && selectedId && (
          <span className="text-xs text-muted-foreground ml-2">
            ({selectedSource === 'company' ? '公司人員' : '已儲存提交人'})
          </span>
        )}
      </div>

      {/* Source tabs + dropdown */}
      <div className="flex items-center gap-2 mb-3">
        <Button
          variant={selectedSource === 'company' ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setSelectedSource('company')}
          disabled={companyPeople.length === 0}
        >
          🏢 公司
        </Button>
        <Button
          variant={selectedSource === 'presenter' ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setSelectedSource('presenter')}
          disabled={presenterPeople.length === 0}
        >
          👤 提交人
        </Button>
        <Button
          variant={selectedSource === 'manual' ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => { setSelectedSource('manual'); setSelectedId(''); }}
        >
          <Pencil className="h-3 w-3 mr-1" />
          手動
        </Button>
      </div>

      {/* Dropdown (when not manual) */}
      {selectedSource !== 'manual' && (
        <Select value={selectedId} onValueChange={handleSelect}>
          <SelectTrigger className="mb-3">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__manual__">
              <span className="flex items-center gap-2"><Pencil className="h-3.5 w-3.5" /> 手動輸入（不選擇人員）</span>
            </SelectItem>
            {allOptions.map(grp => (
              <div key={grp.group}>
                <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium">{grp.group}</div>
                {grp.items.map(opt => (
                  <SelectItem key={opt.id} value={opt.id}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.sublabel}</span>
                    </div>
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Editable fields (unless dropdownOnly) */}
      {!dropdownOnly && (
        <div className="space-y-3">
          {showFields.includes('nameChinese') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{fieldLabels?.nameChinese || DEFAULT_LABELS.nameChinese}</Label>
                <Input
                  value={currentData.nameChinese || ''}
                  onChange={e => update('nameChinese', e.target.value)}
                  className="mt-1 h-8 text-sm"
                  placeholder="例如：彭鄧會計師事務所有限公司"
                />
              </div>
              <div>
                <Label className="text-xs">{fieldLabels?.nameEnglish || DEFAULT_LABELS.nameEnglish}</Label>
                <Input
                  value={currentData.nameEnglish || ''}
                  onChange={e => update('nameEnglish', e.target.value)}
                  className="mt-1 h-8 text-sm"
                  placeholder="例如：PAUL TANG AND COMPANY LIMITED"
                />
              </div>
            </div>
          )}
          {showFields.filter(f => !['nameChinese', 'nameEnglish'].includes(f)).length > 0 && (
            <>
              {showFields.includes('address1') && (
                <div>
                  <Label className="text-xs">{fieldLabels?.address1 || DEFAULT_LABELS.address1}</Label>
                  <Input
                    value={currentData.address1 || ''}
                    onChange={e => update('address1', e.target.value)}
                    className="mt-1 h-8 text-sm"
                    placeholder="Flat, Floor, Block etc."
                  />
                </div>
              )}
              {showFields.includes('address2') && (
                <div>
                  <Label className="text-xs">{fieldLabels?.address2 || DEFAULT_LABELS.address2}</Label>
                  <Input
                    value={currentData.address2 || ''}
                    onChange={e => update('address2', e.target.value)}
                    className="mt-1 h-8 text-sm"
                    placeholder="Building, Street etc."
                  />
                </div>
              )}
              {showFields.includes('address3') && (
                <div>
                  <Label className="text-xs">{fieldLabels?.address3 || DEFAULT_LABELS.address3}</Label>
                  <Input
                    value={currentData.address3 || ''}
                    onChange={e => update('address3', e.target.value)}
                    className="mt-1 h-8 text-sm"
                    placeholder="District, Region, Country etc."
                  />
                </div>
              )}
              {(showFields.includes('phone') || showFields.includes('fax')) && (
                <div className="grid grid-cols-2 gap-3">
                  {showFields.includes('phone') && (
                    <div>
                      <Label className="text-xs">{fieldLabels?.phone || DEFAULT_LABELS.phone}</Label>
                      <Input value={currentData.phone || ''} onChange={e => update('phone', e.target.value)} className="mt-1 h-8 text-sm" />
                    </div>
                  )}
                  {showFields.includes('fax') && (
                    <div>
                      <Label className="text-xs">{fieldLabels?.fax || DEFAULT_LABELS.fax}</Label>
                      <Input value={currentData.fax || ''} onChange={e => update('fax', e.target.value)} className="mt-1 h-8 text-sm" />
                    </div>
                  )}
                </div>
              )}
              {(showFields.includes('email') || showFields.includes('reference')) && (
                <div className="grid grid-cols-2 gap-3">
                  {showFields.includes('email') && (
                    <div>
                      <Label className="text-xs">{fieldLabels?.email || DEFAULT_LABELS.email}</Label>
                      <Input value={currentData.email || ''} onChange={e => update('email', e.target.value)} className="mt-1 h-8 text-sm" />
                    </div>
                  )}
                  {showFields.includes('reference') && (
                    <div>
                      <Label className="text-xs">{fieldLabels?.reference || DEFAULT_LABELS.reference}</Label>
                      <Input value={currentData.reference || ''} onChange={e => update('reference', e.target.value)} className="mt-1 h-8 text-sm" />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Signer name only: single text input */}
      {dropdownOnly && (
        <div className="mt-2">
          <Label className="text-xs">簽署人姓名（可手動修改）</Label>
          <Input
            value={currentData.nameEnglish || currentData.nameChinese || ''}
            onChange={e => update('nameEnglish', e.target.value)}
            className="mt-1 h-8 text-sm"
            placeholder="輸入簽署人姓名..."
          />
        </div>
      )}
    </div>
  );
}
