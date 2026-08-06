import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ArrowLeft, Download, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import RelatedFormsPrompt from './RelatedFormsPrompt';
import type { Presenter } from '@/hooks/usePresenters';
import AddressQuickPick from './AddressQuickPick';
import PersonQuickPick from './PersonQuickPick';

// ── Country list ──
const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Anguilla', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Aruba', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bermuda', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'British Virgin Islands', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
  'Cambodia', 'Cameroon', 'Canada', 'Cape Verde', 'Cayman Islands', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Cook Islands', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic',
  'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
  'East Timor', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Ethiopia',
  'Falkland Islands', 'Fiji', 'Finland', 'France', 'French Guiana', 'French Polynesia',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Gibraltar', 'Greece', 'Greenland', 'Grenada', 'Guadeloupe', 'Guam', 'Guatemala', 'Guernsey', 'Guinea', 'Guinea-Bissau', 'Guyana',
  'Haiti', 'Honduras', 'Hong Kong', 'Hungary',
  'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Isle of Man', 'Israel', 'Italy', 'Ivory Coast',
  'Jamaica', 'Japan', 'Jersey', 'Jordan',
  'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Macau', 'Macedonia', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Martinique', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Montserrat', 'Morocco', 'Mozambique', 'Myanmar',
  'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Caledonia', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'Niue', 'Norfolk Island', 'North Korea', 'Northern Mariana Islands', 'Norway',
  'Oman',
  'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Puerto Rico',
  'Qatar',
  'Romania', 'Russia', 'Rwanda',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Swaziland', 'Sweden', 'Switzerland', 'Syria',
  'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Turks and Caicos Islands', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
  'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
  'Yemen',
  'Zambia', 'Zimbabwe',
];

// ── Helpers ──

/** Split HKID string like "A123456(7)" → { main: "A123456", check: "7" } */
function splitHkid(raw: string): { main: string; check: string } {
  if (!raw) return { main: '', check: '' };
  const cleaned = raw.replace(/[()\-\s]/g, '');
  if (cleaned.length <= 1) return { main: cleaned, check: '' };
  // Last char = check digit, rest = main
  return { main: cleaned.slice(0, -1), check: cleaned.slice(-1) };
}

// ── Types ──

interface DateParts { day: string; month: string; year: string; }

interface AuthRepNatEntry {
  id: string;
  nameChinese: string; surname: string; otherNames: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string;
  email: string; hkidMain: string; hkidCheck: string; passportCountry: string; passportNumber: string;
  day: string; month: string; year: string;
}
const emptyAuthRepNat = (id: string): AuthRepNatEntry => ({
  id, nameChinese: '', surname: '', otherNames: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '',
  email: '', hkidMain: '', hkidCheck: '', passportCountry: '', passportNumber: '',
  day: '', month: '', year: '',
});

interface AuthRepCorpEntry {
  id: string;
  nameChinese: string; nameEnglish: string;
  isLawFirm: boolean; isCpaFirm: boolean;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string;
  email: string; day: string; month: string; year: string;
}
const emptyAuthRepCorp = (id: string): AuthRepCorpEntry => ({
  id, nameChinese: '', nameEnglish: '', isLawFirm: false, isCpaFirm: false,
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '',
  email: '', day: '', month: '', year: '',
});

interface SecNatData {
  nameChinese: string; surname: string; otherNames: string;
  prevNameChinese: string; prevNameEnglish: string;
  aliasChinese: string; aliasEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string; hkidMain: string; hkidCheck: string; passportCountry: string; passportNumber: string;
  day: string; month: string; year: string;
}
const emptySecNat = (): SecNatData => ({
  nameChinese: '', surname: '', otherNames: '',
  prevNameChinese: '', prevNameEnglish: '', aliasChinese: '', aliasEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', hkidMain: '', hkidCheck: '', passportCountry: '', passportNumber: '',
  day: '', month: '', year: '',
});

interface SecCorpEntry {
  id: string;
  nameChinese: string; nameEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  brNumber: string;
  email: string; day: string; month: string; year: string;
}
const emptySecCorp = (id: string): SecCorpEntry => ({
  id, nameChinese: '', nameEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  brNumber: '',
  email: '', day: '', month: '', year: '',
});

interface DirNatEntry {
  id: string;
  isAlternate: boolean; alternateTo: string;
  nameChinese: string; surname: string; otherNames: string;
  prevNameChinese: string; prevNameEnglish: string;
  aliasChinese: string; aliasEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string; hkidMain: string; hkidCheck: string; passportCountry: string; passportNumber: string;
  day: string; month: string; year: string;
}
const emptyDirNat = (id: string): DirNatEntry => ({
  id, isAlternate: false, alternateTo: '',
  nameChinese: '', surname: '', otherNames: '',
  prevNameChinese: '', prevNameEnglish: '', aliasChinese: '', aliasEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', hkidMain: '', hkidCheck: '', passportCountry: '', passportNumber: '',
  day: '', month: '', year: '',
});

interface DirCorpEntry {
  id: string;
  isAlternate: boolean; alternateTo: string;
  nameChinese: string; nameEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string; day: string; month: string; year: string;
}
const emptyDirCorp = (id: string): DirCorpEntry => ({
  id, isAlternate: false, alternateTo: '',
  nameChinese: '', nameEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', day: '', month: '', year: '',
});

let _idCounter = 0;
const uid = () => `n${++_idCounter}`;

// ── Helpers ──

/** Build a Date from D/M/Y strings; null if invalid. */
function toDate(d: string, m: string, y: string): Date | null {
  if (!d || !m || !y) return null;
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  return isNaN(date.getTime()) ? null : date;
}

// ── CountryInput ──
function CountryInput({ value, onChange, placeholder = 'Search country...' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    if (!filter) return COUNTRIES.slice(0, 20);
    const q = filter.toLowerCase();
    return COUNTRIES.filter(c => c.toLowerCase().includes(q)).slice(0, 50);
  }, [filter]);

  useEffect(() => {
    if (!open) setFilter('');
  }, [open]);

  return (
    <div className="relative">
      <Input className="h-8 text-xs" placeholder={placeholder} value={open ? filter : value}
        onChange={e => { setFilter(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => { setFilter(value); setOpen(true); }}
        onBlur={() => { setTimeout(() => setOpen(false), 200); }}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-40 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.map(c => (
            <div key={c} className="px-2 py-1 text-xs cursor-pointer hover:bg-accent"
              onMouseDown={() => { onChange(c); setOpen(false); }}>
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── DatePickerInput ──
function DatePickerInput({ label, day, month, year, onChange }: {
  label?: string;
  day: string; month: string; year: string;
  onChange: (dp: DateParts) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = toDate(day, month, year);

  const handleSelect = (d: Date | undefined) => {
    if (d) {
      onChange({
        day: String(d.getDate()).padStart(2, '0'),
        month: String(d.getMonth() + 1).padStart(2, '0'),
        year: String(d.getFullYear()),
      });
    }
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-1">
      {label && <Label className="text-xs text-muted-foreground">{label}</Label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn('h-8 justify-start text-left font-normal text-xs', !date && 'text-muted-foreground')}>
            <CalendarIcon className="mr-1 h-3.5 w-3.5" />
            {date ? format(date, 'yyyy-MM-dd') : <span>選擇日期...</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={date || undefined} onSelect={handleSelect} initialFocus
            captionLayout="dropdown-buttons" fromYear={1950} toYear={new Date().getFullYear() + 10} />
          {date && (
            <div className="px-3 pb-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                onClick={() => { onChange({ day: '', month: '', year: '' }); setOpen(false); }}>
                清除日期
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ── Main component ──
export default function NN1GeneratorForm({ onBack, initialCompanyId }: { onBack: () => void; initialCompanyId?: string }) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId || '');
  const [generating, setGenerating] = useState(false);
  const [showRelatedPrompt, setShowRelatedPrompt] = useState(false);
  const [relatedLinkages, setRelatedLinkages] = useState<any[]>([]);
  const selectedCompany = useMemo(() => companies.find(c => c.id === selectedCompanyId), [companies, selectedCompanyId]);

  // ═══ P.1: Company Info ═══
  const [proposedNameEn, setProposedNameEn] = useState('');
  const [proposedNameCn, setProposedNameCn] = useState('');
  const [placeOfIncorporation, setPlaceOfIncorporation] = useState('');
  const [estDay, setEstDay] = useState(''); const [estMonth, setEstMonth] = useState(''); const [estYear, setEstYear] = useState('');
  const [addrFlat, setAddrFlat] = useState(''); const [addrBuilding, setAddrBuilding] = useState('');
  const [addrStreet, setAddrStreet] = useState(''); const [addrDistrict, setAddrDistrict] = useState('');

  // ═══ P.2: Contact + Overseas Offices ═══
  const [companyEmail, setCompanyEmail] = useState(''); const [companyPhone, setCompanyPhone] = useState('');
  const [regOffFlat, setRegOffFlat] = useState(''); const [regOffBuilding, setRegOffBuilding] = useState('');
  const [regOffStreet, setRegOffStreet] = useState(''); const [regOffDistrict, setRegOffDistrict] = useState('');
  const [regOffCountry, setRegOffCountry] = useState('');
  const [ppbFlat, setPpbFlat] = useState(''); const [ppbBuilding, setPpbBuilding] = useState('');
  const [ppbStreet, setPpbStreet] = useState(''); const [ppbDistrict, setPpbDistrict] = useState('');
  const [ppbCountry, setPpbCountry] = useState('');
  const [overseasEmail, setOverseasEmail] = useState('');

  // ═══ P.1: Presenter ═══
  const [presenterNameCn, setPresenterNameCn] = useState('');
  const [presenterNameEn, setPresenterNameEn] = useState('');
  const [presenterAddress, setPresenterAddress] = useState('');
  const [presenterPhone, setPresenterPhone] = useState(''); const [presenterFax, setPresenterFax] = useState('');
  const [presenterEmail, setPresenterEmail] = useState(''); const [presenterRef, setPresenterRef] = useState('');

  // ═══ P.3: Auth Reps (自然人) — array ═══
  const [authRepNats, setAuthRepNats] = useState<AuthRepNatEntry[]>([]);
  const addAuthRepNat = () => setAuthRepNats(prev => [...prev, emptyAuthRepNat(uid())]);
  const removeAuthRepNat = (id: string) => setAuthRepNats(prev => prev.filter(a => a.id !== id));
  const updateAuthRepNat = (id: string, patch: Partial<AuthRepNatEntry>) => setAuthRepNats(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ═══ P.4: Auth Reps (法人) — array ═══
  const [authRepCorps, setAuthRepCorps] = useState<AuthRepCorpEntry[]>([]);
  const addAuthRepCorp = () => setAuthRepCorps(prev => [...prev, emptyAuthRepCorp(uid())]);
  const removeAuthRepCorp = (id: string) => setAuthRepCorps(prev => prev.filter(a => a.id !== id));
  const updateAuthRepCorp = (id: string, patch: Partial<AuthRepCorpEntry>) => setAuthRepCorps(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ═══ P.5: Company Secretary (自然人) ═══
  const [secNat, setSecNat] = useState<SecNatData>(emptySecNat());
  const [hasSecNat, setHasSecNat] = useState(false);

  // ═══ P.6: Company Secretary (法人) — array ═══
  const [secCorps, setSecCorps] = useState<SecCorpEntry[]>([]);
  const addSecCorp = () => setSecCorps(prev => [...prev, emptySecCorp(uid())]);
  const removeSecCorp = (id: string) => setSecCorps(prev => prev.filter(s => s.id !== id));
  const updateSecCorp = (id: string, patch: Partial<SecCorpEntry>) => setSecCorps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  // ═══ P.7-8: Directors (自然人) ═══
  const [dirNats, setDirNats] = useState<DirNatEntry[]>([emptyDirNat(uid())]);
  const addDirNat = () => setDirNats(prev => [...prev, emptyDirNat(uid())]);
  const removeDirNat = (id: string) => setDirNats(prev => prev.length > 1 ? prev.filter(d => d.id !== id) : prev);
  const updateDirNat = (id: string, patch: Partial<DirNatEntry>) => setDirNats(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));

  // ═══ P.9: Directors (法人) ═══
  const [dirCorps, setDirCorps] = useState<DirCorpEntry[]>([]);
  const addDirCorp = () => setDirCorps(prev => [...prev, emptyDirCorp(uid())]);
  const removeDirCorp = (id: string) => setDirCorps(prev => prev.filter(d => d.id !== id));
  const updateDirCorp = (id: string, patch: Partial<DirCorpEntry>) => setDirCorps(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));

  // ═══ P.10: Signature / Declaration ═══
  const [charterDocs, setCharterDocs] = useState('');
  const [incorpCert, setIncorpCert] = useState('');
  const [acctFromDay, setAcctFromDay] = useState(''); const [acctFromMonth, setAcctFromMonth] = useState(''); const [acctFromYear, setAcctFromYear] = useState('');
  const [acctToDay, setAcctToDay] = useState(''); const [acctToMonth, setAcctToMonth] = useState(''); const [acctToYear, setAcctToYear] = useState('');
  const [noAcctsRequired, setNoAcctsRequired] = useState(false);
  const [incorpLess18m, setIncorpLess18m] = useState(false);
  const [signatoryName, setSignatoryName] = useState('');
  const [signDateDay, setSignDateDay] = useState(''); const [signDateMonth, setSignDateMonth] = useState(''); const [signDateYear, setSignDateYear] = useState('');
  const [signatoryCapacity, setSignatoryCapacity] = useState<'director' | 'secretary' | 'manager' | 'authorizedRep' | ''>('');

  // ═══ P.17: PI-NN1 — 自動從表單自然人提取（借鑒 NNC1 piPersons 模式）═���═
  interface PiPersonData {
    nameChinese: string; surname: string; otherNames: string;
    hkidMain: string; hkidCheck: string; isHkid: boolean;
    passportCountry: string; passportNumber: string;
    addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrCountry: string;
    isAR: boolean; isSec: boolean; isDir: boolean; isAltDir: boolean;
    label: string;
  }
  const piPersons = useMemo<PiPersonData[]>(() => {
    const result: PiPersonData[] = [];
    // 授權代表（自然人）
    for (const a of authRepNats) {
      result.push({
        nameChinese: a.nameChinese, surname: a.surname, otherNames: a.otherNames,
        hkidMain: a.hkidMain || '', hkidCheck: a.hkidCheck || '', isHkid: !!(a.hkidMain || a.hkidCheck),
        passportCountry: a.passportCountry, passportNumber: a.passportNumber,
        addrFlat: a.addrFlat, addrBuilding: a.addrBuilding, addrStreet: a.addrStreet, addrDistrict: a.addrDistrict,
        addrCountry: 'Hong Kong',
        isAR: true, isSec: false, isDir: false, isAltDir: false,
        label: `授權代表 #${result.length + 1}`,
      });
    }
    // 公司秘書（自然人）
    if (hasSecNat && (secNat.surname || secNat.nameChinese)) {
      result.push({
        nameChinese: secNat.nameChinese, surname: secNat.surname, otherNames: secNat.otherNames,
        hkidMain: secNat.hkidMain || '', hkidCheck: secNat.hkidCheck || '', isHkid: !!(secNat.hkidMain || secNat.hkidCheck),
        passportCountry: secNat.passportCountry, passportNumber: secNat.passportNumber,
        addrFlat: secNat.addrFlat, addrBuilding: secNat.addrBuilding, addrStreet: secNat.addrStreet, addrDistrict: secNat.addrDistrict,
        addrCountry: secNat.addrRegion,
        isAR: false, isSec: true, isDir: false, isAltDir: false,
        label: '公司秘書（自然人）',
      });
    }
    // 董事（自然人）
    for (const d of dirNats) {
      if (!d.surname && !d.nameChinese) continue;
      result.push({
        nameChinese: d.nameChinese, surname: d.surname, otherNames: d.otherNames,
        hkidMain: d.hkidMain || '', hkidCheck: d.hkidCheck || '', isHkid: !!(d.hkidMain || d.hkidCheck),
        passportCountry: d.passportCountry, passportNumber: d.passportNumber,
        addrFlat: d.addrFlat, addrBuilding: d.addrBuilding, addrStreet: d.addrStreet, addrDistrict: d.addrDistrict,
        addrCountry: d.addrRegion,
        isAR: false, isSec: false, isDir: !d.isAlternate, isAltDir: d.isAlternate,
        label: d.isAlternate ? `候補董事 #${result.length + 1}` : `董事 #${result.length + 1}`,
      });
    }
    return result;
  }, [authRepNats, hasSecNat, secNat, dirNats]);

  // Auto-calculated continuation sheet counts (computed from arrays, after piPersons)
  const continuationCounts = useMemo(() => ({
    sheetA: Math.max(0, authRepNats.length - 1),   // first on P.3, rest on P.11
    sheetB: Math.max(0, authRepCorps.length - 1),  // first on P.4, rest on P.12
    sheetC: 0,                                      // only one sec nat on P.5, no continuation
    sheetD: Math.max(0, secCorps.length - 1),       // first on P.6, rest on P.14
    sheetE: Math.max(0, dirNats.length - 2),        // first two on P.7/P.8, rest on P.15
    sheetF: Math.max(0, dirCorps.length - 1),       // first on P.9, rest on P.16
    sheetPINN1: piPersons.length,
  }), [authRepNats.length, authRepCorps.length, secCorps.length, dirNats.length, dirCorps.length, piPersons.length]);

  const { mutate: saveFormHistory } = useSaveFormHistory();

  useEffect(() => {
    if (initialCompanyId && companies.length > 0) {
      setSelectedCompanyId(initialCompanyId);
      const c = companies.find(co => co.id === initialCompanyId);
      if (c && !proposedNameEn && !placeOfIncorporation) {
        setProposedNameEn(c.name || ''); setPlaceOfIncorporation('Hong Kong');
        setAddrFlat(c.regFlat || ''); setAddrBuilding(c.regBuilding || '');
        setAddrStreet(c.regStreet || ''); setAddrDistrict(c.regDistrict || '');
        setCompanyEmail(c.email || ''); setCompanyPhone(c.phone || '');
      }
    }
  }, [initialCompanyId, companies]);

  const handleLoadHistory = (data: any) => {
    // formData stores simple fields; arrays/objects are at data.* level
    const fd = data.formData || data;
    if (fd.proposedNameEn !== undefined) setProposedNameEn(fd.proposedNameEn);
    if (fd.proposedNameCn !== undefined) setProposedNameCn(fd.proposedNameCn);
    if (fd.placeOfIncorporation !== undefined) setPlaceOfIncorporation(fd.placeOfIncorporation);
    if (fd.estDay !== undefined) setEstDay(fd.estDay);
    if (fd.estMonth !== undefined) setEstMonth(fd.estMonth);
    if (fd.estYear !== undefined) setEstYear(fd.estYear);
    if (fd.addrFlat !== undefined) setAddrFlat(fd.addrFlat);
    if (fd.addrBuilding !== undefined) setAddrBuilding(fd.addrBuilding);
    if (fd.addrStreet !== undefined) setAddrStreet(fd.addrStreet);
    if (fd.addrDistrict !== undefined) setAddrDistrict(fd.addrDistrict);
    if (fd.companyEmail !== undefined) setCompanyEmail(fd.companyEmail);
    if (fd.companyPhone !== undefined) setCompanyPhone(fd.companyPhone);
    // P.2
    if (fd.regOffFlat !== undefined) setRegOffFlat(fd.regOffFlat);
    if (fd.regOffBuilding !== undefined) setRegOffBuilding(fd.regOffBuilding);
    if (fd.regOffStreet !== undefined) setRegOffStreet(fd.regOffStreet);
    if (fd.regOffDistrict !== undefined) setRegOffDistrict(fd.regOffDistrict);
    if (fd.regOffCountry !== undefined) setRegOffCountry(fd.regOffCountry);
    if (fd.ppbFlat !== undefined) setPpbFlat(fd.ppbFlat);
    if (fd.ppbBuilding !== undefined) setPpbBuilding(fd.ppbBuilding);
    if (fd.ppbStreet !== undefined) setPpbStreet(fd.ppbStreet);
    if (fd.ppbDistrict !== undefined) setPpbDistrict(fd.ppbDistrict);
    if (fd.ppbCountry !== undefined) setPpbCountry(fd.ppbCountry);
    if (fd.overseasEmail !== undefined) setOverseasEmail(fd.overseasEmail);
    if (fd.presenterNameCn !== undefined) setPresenterNameCn(fd.presenterNameCn);
    if (fd.presenterNameEn !== undefined) setPresenterNameEn(fd.presenterNameEn);
    if (fd.presenterAddress !== undefined) setPresenterAddress(fd.presenterAddress);
    if (fd.presenterPhone !== undefined) setPresenterPhone(fd.presenterPhone);
    if (fd.presenterFax !== undefined) setPresenterFax(fd.presenterFax);
    if (fd.presenterEmail !== undefined) setPresenterEmail(fd.presenterEmail);
    if (fd.presenterRef !== undefined) setPresenterRef(fd.presenterRef);
    // P.10
    if (fd.charterDocs !== undefined) setCharterDocs(fd.charterDocs);
    if (fd.incorpCert !== undefined) setIncorpCert(fd.incorpCert);
    if (fd.acctFromDay !== undefined) setAcctFromDay(fd.acctFromDay);
    if (fd.acctFromMonth !== undefined) setAcctFromMonth(fd.acctFromMonth);
    if (fd.acctFromYear !== undefined) setAcctFromYear(fd.acctFromYear);
    if (fd.acctToDay !== undefined) setAcctToDay(fd.acctToDay);
    if (fd.acctToMonth !== undefined) setAcctToMonth(fd.acctToMonth);
    if (fd.acctToYear !== undefined) setAcctToYear(fd.acctToYear);
    if (fd.noAcctsRequired !== undefined) setNoAcctsRequired(fd.noAcctsRequired);
    if (fd.incorpLess18m !== undefined) setIncorpLess18m(fd.incorpLess18m);
    if (fd.signatoryName !== undefined) setSignatoryName(fd.signatoryName);
    if (fd.signDateDay !== undefined) setSignDateDay(fd.signDateDay);
    if (fd.signDateMonth !== undefined) setSignDateMonth(fd.signDateMonth);
    if (fd.signDateYear !== undefined) setSignDateYear(fd.signDateYear);
    if (fd.signatoryCapacity !== undefined) setSignatoryCapacity(fd.signatoryCapacity);
    if (fd.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId || fd.selectedCompanyId);
    if (fd.hasSecNat !== undefined) setHasSecNat(fd.hasSecNat);
    // Arrays / objects stored at data.* level
    if (data.secNat) setSecNat(data.secNat);
    if (data.authRepNats && Array.isArray(data.authRepNats)) setAuthRepNats(data.authRepNats);
    if (data.authRepCorps && Array.isArray(data.authRepCorps)) setAuthRepCorps(data.authRepCorps);
    if (data.secCorps && Array.isArray(data.secCorps)) setSecCorps(data.secCorps);
    if (data.dirNats && Array.isArray(data.dirNats)) setDirNats(data.dirNats);
    if (data.dirCorps && Array.isArray(data.dirCorps)) setDirCorps(data.dirCorps);
  };

  // ═══════════ GENERATE ═══════════
  const handleGenerate = async () => {
    if (!proposedNameEn.trim()) { toast({ title: '錯誤', description: '請填寫擬用公司英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const fields: Record<string, string> = {};
      const checkboxes: string[] = [];

      // ── P.1 ──
      fields['fill_1_P.1'] = proposedNameEn + (proposedNameCn ? '\n' + proposedNameCn : '');
      fields['fill_2_P.1'] = placeOfIncorporation;
      fields['fill_3_P.1'] = estDay; fields['fill_4_P.1'] = estMonth; fields['fill_5_P.1'] = estYear;
      fields['fill_6_P.1'] = addrFlat; fields['fill_7_P.1'] = addrBuilding;
      fields['fill_8_P.1'] = addrStreet; fields['fill_9_P.1'] = addrDistrict;
      fields['fill_10_P.1'] = ''; // Chinese name empty
      fields['fill_11_P.1'] = presenterNameEn; fields['fill_12_P.1'] = presenterAddress;
      fields['fill_13_P.1'] = presenterPhone; fields['fill_14_P.1'] = presenterFax;
      fields['fill_15_P.1'] = presenterEmail; fields['fill_16_P.1'] = presenterRef;

      // ── P.2 ──
      fields['fill_1_P.2'] = companyEmail;
      fields['fill_2_P.2'] = companyPhone ? `+852 ${companyPhone}` : '';
      fields['fill_3_P.2'] = regOffFlat; fields['fill_4_P.2'] = regOffBuilding;
      fields['fill_5_P.2'] = regOffStreet; fields['fill_6_P.2'] = regOffDistrict; fields['fill_7_P.2'] = regOffCountry;
      fields['fill_8_P.2'] = ppbFlat; fields['fill_9_P.2'] = ppbBuilding;
      fields['fill_10_P.2'] = ppbStreet; fields['fill_11_P.2'] = ppbDistrict; fields['fill_12_P.2'] = ppbCountry;
      fields['fill_13_P.2'] = overseasEmail;

      // ── P.3: Auth Reps 自然人 (1st→P.3, rest→P.11 continuation) ──
      if (authRepNats.length > 0) {
        const a = authRepNats[0];
        fields['fill_1_P.3'] = a.nameChinese; fields['fill_2_P.3'] = a.surname; fields['fill_3_P.3'] = a.otherNames;
        fields['fill_4_P.3'] = a.addrFlat; fields['fill_5_P.3'] = a.addrBuilding;
        fields['fill_6_P.3'] = a.addrStreet; fields['fill_7_P.3'] = a.addrDistrict;
        fields['fill_8_P.3'] = a.email;
        fields['fill_9_P.3'] = a.hkidMain.slice(0, 4); fields['fill_10_P.3'] = a.passportCountry; fields['fill_11_P.3'] = a.passportNumber;
        fields['fill_12_P.3'] = a.day; fields['fill_13_P.3'] = a.month; fields['fill_14_P.3'] = a.year;
        // Continuation sheet A (P.11) for 2nd+
        for (let ai = 1; ai < Math.min(authRepNats.length - 1 + 1, 1); ai++) {
          const ca = authRepNats[ai];
          fields['fill_1_P.11'] = ca.nameChinese; fields['fill_2_P.11'] = ca.surname; fields['fill_3_P.11'] = ca.otherNames;
          fields['fill_4_P.11'] = ca.addrFlat; fields['fill_5_P.11'] = ca.addrBuilding;
          fields['fill_6_P.11'] = ca.addrStreet; fields['fill_7_P.11'] = ca.addrDistrict;
          fields['fill_8_P.11'] = ca.email;
          fields['fill_9_P.11'] = ca.hkidMain.slice(0, 4); fields['fill_10_P.11'] = ca.passportCountry; fields['fill_11_P.11'] = ca.passportNumber;
          fields['fill_12_P.11'] = ca.day; fields['fill_13_P.11'] = ca.month; fields['fill_14_P.11'] = ca.year;
        }
      }

      // ── P.4: Auth Reps 法人 ──
      if (authRepCorps.length > 0) {
        const c = authRepCorps[0];
        if (c.isLawFirm) checkboxes.push('toggle_1_P.4');
        if (c.isCpaFirm) checkboxes.push('toggle_2_P.4');
        fields['fill_1_P.4'] = c.nameChinese; fields['fill_2_P.4'] = c.nameEnglish;
        fields['fill_3_P.4'] = c.addrFlat; fields['fill_4_P.4'] = c.addrBuilding;
        fields['fill_5_P.4'] = c.addrStreet; fields['fill_6_P.4'] = c.addrDistrict;
        fields['fill_7_P.4'] = c.email;
        fields['fill_8_P.4'] = c.day; fields['fill_9_P.4'] = c.month; fields['fill_10_P.4'] = c.year;
      }

      // ── P.5: Company Secretary 自然人 ──
      if (hasSecNat) {
        const s = secNat;
        fields['fill_1_P.5'] = s.nameChinese; fields['fill_2_P.5'] = s.surname; fields['fill_3_P.5'] = s.otherNames;
        fields['fill_4_P.5'] = s.prevNameChinese; fields['fill_5_P.5'] = s.prevNameEnglish;
        fields['fill_6_P.5'] = s.aliasChinese; fields['fill_7_P.5'] = s.aliasEnglish;
        fields['fill_8_P.5'] = s.addrFlat; fields['fill_9_P.5'] = s.addrBuilding;
        fields['fill_10_P.5'] = s.addrStreet; fields['fill_11_P.5'] = s.addrDistrict; fields['fill_12_P.5'] = s.addrRegion;
        fields['fill_13_P.5'] = s.email;
        fields['fill_14_P.5'] = s.hkidMain.slice(0, 4); fields['fill_15_P.5'] = s.passportCountry; fields['fill_16_P.5'] = s.passportNumber;
        fields['fill_17_P.5'] = s.day; fields['fill_18_P.5'] = s.month; fields['fill_19_P.5'] = s.year;
      }

      // ── P.6: Company Secretary 法人 ──
      if (secCorps.length > 0) {
        const s = secCorps[0];
        fields['fill_1_P.6'] = s.nameChinese; fields['fill_2_P.6'] = s.nameEnglish;
        fields['fill_3_P.6'] = s.addrFlat; fields['fill_4_P.6'] = s.addrBuilding;
        fields['fill_5_P.6'] = s.addrStreet; fields['fill_6_P.6'] = s.addrDistrict; fields['fill_7_P.6'] = s.addrRegion;
        fields['fill_8_P.6'] = s.email;
        fields['fill_9_P.6'] = s.brNumber;
        fields['fill_10_P.6'] = s.day; fields['fill_11_P.6'] = s.month; fields['fill_12_P.6'] = s.year;
      }

      // ── P.7-8: Directors 自然人 ──
      for (let di = 0; di < Math.min(dirNats.length, 2); di++) {
        const d = dirNats[di]; const pn = 7 + di;
        checkboxes.push(d.isAlternate ? `toggle_2_P.${pn}` : `toggle_1_P.${pn}`);
        if (d.isAlternate) fields[`fill_1_P.${pn}`] = d.alternateTo;
        fields[`fill_2_P.${pn}`] = d.nameChinese; fields[`fill_3_P.${pn}`] = d.surname; fields[`fill_4_P.${pn}`] = d.otherNames;
        fields[`fill_5_P.${pn}`] = d.prevNameChinese; fields[`fill_6_P.${pn}`] = d.prevNameEnglish;
        fields[`fill_7_P.${pn}`] = d.aliasChinese; fields[`fill_8_P.${pn}`] = d.aliasEnglish;
        fields[`fill_9_P.${pn}`] = d.addrFlat; fields[`fill_10_P.${pn}`] = d.addrBuilding;
        fields[`fill_11_P.${pn}`] = d.addrStreet; fields[`fill_12_P.${pn}`] = d.addrDistrict; fields[`fill_13_P.${pn}`] = d.addrRegion;
        fields[`fill_14_P.${pn}`] = d.email;
        fields[`fill_15_P.${pn}`] = d.hkidMain.slice(0, 4); fields[`fill_16_P.${pn}`] = d.passportCountry; fields[`fill_17_P.${pn}`] = d.passportNumber;
        fields[`fill_18_P.${pn}`] = d.day; fields[`fill_19_P.${pn}`] = d.month; fields[`fill_20_P.${pn}`] = d.year;
      }

      // ── P.9: Director 法人 ──
      if (dirCorps.length > 0) {
        const d = dirCorps[0];
        checkboxes.push(d.isAlternate ? 'toggle_2_P.9' : 'toggle_1_P.9');
        if (d.isAlternate) fields['fill_1_P.9'] = d.alternateTo;
        fields['fill_2_P.9'] = d.nameChinese; fields['fill_3_P.9'] = d.nameEnglish;
        fields['fill_4_P.9'] = d.addrFlat; fields['fill_5_P.9'] = d.addrBuilding;
        fields['fill_6_P.9'] = d.addrStreet; fields['fill_7_P.9'] = d.addrDistrict; fields['fill_8_P.9'] = d.addrRegion;
        fields['fill_9_P.9'] = d.email;
        fields['fill_10_P.9'] = '';
        fields['fill_11_P.9'] = d.day; fields['fill_12_P.9'] = d.month; fields['fill_13_P.9'] = d.year;
      }

      // ── P.10 ──
      fields['fill_1_P.10'] = charterDocs; fields['fill_2_P.10'] = incorpCert;
      fields['fill_3_P.10'] = acctFromDay; fields['fill_4_P.10'] = acctFromMonth; fields['fill_5_P.10'] = acctFromYear;
      fields['fill_6_P.10'] = acctToDay; fields['fill_7_P.10'] = acctToMonth; fields['fill_8_P.10'] = acctToYear;
      if (noAcctsRequired) checkboxes.push('toggle_1_P.10');
      if (incorpLess18m) checkboxes.push('toggle_2_P.10');
      fields['fill_9_P.10'] = String(continuationCounts.sheetA);
      fields['fill_10_P.10'] = String(continuationCounts.sheetB);
      fields['fill_11_P.10'] = String(continuationCounts.sheetC);
      fields['fill_12_P.10'] = String(continuationCounts.sheetD);
      fields['fill_13_P.10'] = String(continuationCounts.sheetE);
      fields['fill_14_P.10'] = String(continuationCounts.sheetF);
      fields['fill_15_P.10'] = String(continuationCounts.sheetPINN1);
      fields['fill_16_P.10'] = signatoryName;
      fields['fill_17_P.10'] = signDateDay && signDateMonth && signDateYear
        ? `${signDateDay}/${signDateMonth}/${signDateYear}` : '';

      // ── P.17: PI-NN1 — 自動從 piPersons 填充（後端 widget-level 處理多頁複製）──

      // ── API ──
      const resp = await fetch(`/api/generate-nn1-pdf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fields, checkboxes: checkboxes.length > 0 ? checkboxes : undefined,
          piPersons: piPersons.length > 0 ? piPersons : undefined,
          removePages: [17, 18, 19, 20, 21, 22, 23, 24],  // P.18-P.25 填表須知
          fieldFontSizes: { 'fill_12_P.1': 7 },
          signatoryCapacity: signatoryCapacity || undefined,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NN1-form.pdf');
      toast({ title: '生成成功', description: 'NN1 表格已下載' });

      saveFormHistory({
        formType: 'NN1',
        formData: { proposedNameEn, proposedNameCn, placeOfIncorporation, estDay, estMonth, estYear, addrFlat, addrBuilding, addrStreet, addrDistrict, companyEmail, companyPhone, regOffFlat, regOffBuilding, regOffStreet, regOffDistrict, regOffCountry, ppbFlat, ppbBuilding, ppbStreet, ppbDistrict, ppbCountry, overseasEmail, presenterNameCn, presenterNameEn, presenterAddress, presenterPhone, presenterFax, presenterEmail, presenterRef, charterDocs, incorpCert, acctFromDay, acctFromMonth, acctFromYear, acctToDay, acctToMonth, acctToYear, noAcctsRequired, incorpLess18m, signatoryName, signDateDay, signDateMonth, signDateYear, signatoryCapacity, hasSecNat, selectedCompanyId, authRepNats, authRepCorps, secNat: hasSecNat ? secNat : null, secCorps, dirNats, dirCorps },
      });

      try {
        const linkResp = await fetch(`/api/form-linkages?primary=NN1`, { headers: { Authorization: `Bearer ${token}` } });
        const linkData = await linkResp.json();
        if (linkData.linkages && linkData.linkages.length > 0) { setRelatedLinkages(linkData.linkages); setShowRelatedPrompt(true); }
      } catch (_) { /* ok */ }
    } catch (err: any) {
      toast({ title: '生成失敗', description: err.message, variant: 'destructive' });
    } finally { setGenerating(false); }
  };

  // ═══════════ RENDER ═══════════
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <h2 className="text-lg font-bold">NN1 — 註冊非香港公司的註冊申請書</h2>
      </div>

      <div className="mb-4">
        <Label>選擇公司（從系統載入資料）</Label>
        <Select value={selectedCompanyId || '__none__'} onValueChange={v => setSelectedCompanyId(v === '__none__' ? '' : v)}>
          <SelectTrigger className="mt-1 max-w-md"><SelectValue placeholder="— 選擇公司 —" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— 不使用 —</SelectItem>
            {companies.map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      <FormHistorySelector formType="NN1" onSelect={handleLoadHistory} />

      <div className="space-y-6">

        {/* ═══ P.1: Company Particulars ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="font-semibold mb-3">📋 公司基本資料 Company Particulars（P.1）</h3>
          <div className="grid grid-cols-1 gap-3 mb-4">
            <div><Label>擬用英文公司名稱 Proposed Company Name in English *</Label>
              <Input value={proposedNameEn} onChange={e => setProposedNameEn(e.target.value)} className="mt-1" placeholder="e.g. ABC LIMITED" /></div>
            <div><Label>擬用中文公司名稱 Proposed Company Name in Chinese</Label>
              <Input value={proposedNameCn} onChange={e => setProposedNameCn(e.target.value)} className="mt-1" placeholder="e.g. 甲乙丙有限公司" /></div>
            <div className="max-w-xs">
              <Label>成立為法團所在地方 Place of Incorporation</Label>
              <CountryInput value={placeOfIncorporation} onChange={setPlaceOfIncorporation} placeholder="Search country / type..." />
            </div>
          </div>

          <div className="mb-4 max-w-xs">
            <DatePickerInput label="在香港設立營業地點的日期 Date of Establishment"
              day={estDay} month={estMonth} year={estYear}
              onChange={({ day, month, year }) => { setEstDay(day); setEstMonth(month); setEstYear(year); }} />
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2">在香港主要營業地點的地址 Address of Principal Place of Business in HK</h4>
            <AddressQuickPick companyId={selectedCompanyId} includeAllCompanies
              onPick={(d) => { if (d.flat) setAddrFlat(d.flat); if (d.building) setAddrBuilding(d.building); if (d.street) setAddrStreet(d.street); if (d.district) setAddrDistrict(d.district); }} />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div><Label>室／樓／座 Flat／Floor／Block</Label><Input value={addrFlat} onChange={e => setAddrFlat(e.target.value)} className="mt-1" /></div>
              <div><Label>大廈 Building</Label><Input value={addrBuilding} onChange={e => setAddrBuilding(e.target.value)} className="mt-1" /></div>
              <div><Label>街道／屋苑 Street／Estate</Label><Input value={addrStreet} onChange={e => setAddrStreet(e.target.value)} className="mt-1" /></div>
              <div><Label>區 District</Label>
                <Select value={addrDistrict} onValueChange={setAddrDistrict}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="— 選擇地區 —" /></SelectTrigger>
                  <SelectContent>
                    {['Central and Western','Wan Chai','Eastern','Southern','Yau Tsim Mong','Sham Shui Po','Kowloon City','Wong Tai Sin','Kwun Tong','Kwai Tsing','Tsuen Wan','Tuen Mun','Yuen Long','North','Tai Po','Sha Tin','Sai Kung','Islands'].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ P.2: Contact + Overseas Offices ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="font-semibold mb-3">📞 聯絡資料及海外辦事處 Contact & Overseas Offices（P.2）</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><Label>Section 3(c) — 電郵地址 Email Address</Label><Input value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} className="mt-1" /></div>
            <div><Label>Section 3(d) — 香港聯絡電話號碼 Contact Tel. No. in HK</Label><Input value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} className="mt-1" placeholder="+852 1234 5678" /></div>
          </div>
          <Separator className="my-4" />
          <h4 className="text-sm font-medium mb-2">Section 4(a) — 在成立所在地的註冊辦事處地址 Registered Office in Place of Incorporation</h4>
          <AddressQuickPick includeAllCompanies
            onPick={d => { if (d.flat) setRegOffFlat(d.flat); if (d.building) setRegOffBuilding(d.building); if (d.street) setRegOffStreet(d.street); if (d.district) setRegOffDistrict(d.district); if (d.country || d.region) setRegOffCountry(d.country || d.region || ''); }} />
          <div className="grid grid-cols-2 gap-2 mt-3 mb-3">
            <Input className="h-8 text-xs" placeholder="室／樓／座 Flat／Floor／Block" value={regOffFlat} onChange={e => setRegOffFlat(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="大廈 Building" value={regOffBuilding} onChange={e => setRegOffBuilding(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="街道／屋苑 Street／Estate" value={regOffStreet} onChange={e => setRegOffStreet(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="區／市／省／郵遞區號 District/City/Province/Postal Code" value={regOffDistrict} onChange={e => setRegOffDistrict(e.target.value)} />
            <div className="col-span-2 max-w-xs"><Label className="text-xs">國家／地區 Country/Region</Label><CountryInput value={regOffCountry} onChange={setRegOffCountry} placeholder="Search country..." /></div>
          </div>
          <h4 className="text-sm font-medium mb-2 mt-4">Section 4(b) — 主要營業地點地址 Principal Place of Business</h4>
          <AddressQuickPick includeAllCompanies
            onPick={d => { if (d.flat) setPpbFlat(d.flat); if (d.building) setPpbBuilding(d.building); if (d.street) setPpbStreet(d.street); if (d.district) setPpbDistrict(d.district); if (d.country || d.region) setPpbCountry(d.country || d.region || ''); }} />
          <div className="grid grid-cols-2 gap-2 mt-3 mb-3">
            <Input className="h-8 text-xs" placeholder="室／樓／座 Flat／Floor／Block" value={ppbFlat} onChange={e => setPpbFlat(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="大廈 Building" value={ppbBuilding} onChange={e => setPpbBuilding(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="街道／屋苑 Street／Estate" value={ppbStreet} onChange={e => setPpbStreet(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="District/City/Province/Postal Code" value={ppbDistrict} onChange={e => setPpbDistrict(e.target.value)} />
            <div className="col-span-2 max-w-xs"><Label className="text-xs">國家／地區 Country/Region</Label><CountryInput value={ppbCountry} onChange={setPpbCountry} placeholder="Search country..." /></div>
          </div>
          <h4 className="text-sm font-medium mb-2 mt-4">Section 4(c) — 電郵地址 Email Address</h4>
          <div className="max-w-xs"><Input className="h-8" value={overseasEmail} onChange={e => setOverseasEmail(e.target.value)} /></div>
        </div>

        {/* ═══ P.1: Presenter ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="font-semibold mb-3">👤 提交人資料 Presentor's Reference（P.1 底部）</h3>
          <PresenterSelector companyId={selectedCompanyId}
            currentData={{ nameChinese: presenterNameCn, nameEnglish: presenterNameEn, address: presenterAddress, phone: presenterPhone, fax: presenterFax, email: presenterEmail, reference: presenterRef }}
            onSelect={(p: Presenter) => {
              setPresenterNameCn(p.nameChinese || ''); setPresenterNameEn(p.nameEnglish || p.name || '');
              setPresenterAddress(p.address || ''); setPresenterPhone(p.phone || '');
              setPresenterFax(p.fax || ''); setPresenterEmail(p.email || ''); setPresenterRef(p.reference || '');
            }} />
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div><Label>中文名稱 Name in Chinese</Label><Input value={presenterNameCn} onChange={e => setPresenterNameCn(e.target.value)} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">⚠️ 留空：如無中文姓名，勿填英文名</p></div>
            <div><Label>英文名稱 Name in English</Label><Input value={presenterNameEn} onChange={e => setPresenterNameEn(e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>地址 Address</Label><Input value={presenterAddress} onChange={e => setPresenterAddress(e.target.value)} className="mt-1" /></div>
            <div><Label>電話 Tel</Label><Input value={presenterPhone} onChange={e => setPresenterPhone(e.target.value)} className="mt-1" /></div>
            <div><Label>傳真 Fax</Label><Input value={presenterFax} onChange={e => setPresenterFax(e.target.value)} className="mt-1" /></div>
            <div><Label>電郵 Email</Label><Input value={presenterEmail} onChange={e => setPresenterEmail(e.target.value)} className="mt-1" /></div>
            <div><Label>檔號 Reference</Label><Input value={presenterRef} onChange={e => setPresenterRef(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ═══ P.3: Auth Reps (自然人) ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">🏛️ 授權代表（自然人）Auth Rep — Natural Person（P.3, Section 5A）</h3>
            <Button variant="outline" size="sm" onClick={addAuthRepNat}><Plus className="h-4 w-4 mr-1" />新增授權代表</Button>
          </div>
          {authRepNats.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊「新增授權代表」按鈕添加。</p>}
          {authRepNats.map((a, i) => (
            <div key={a.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">授權代表（自然人）#{i + 1} {i === 0 ? '— P.3' : '— 續頁 P.11'}</span>
                <Button variant="ghost" size="sm" onClick={() => removeAuthRepNat(a.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <PersonQuickPick companyId={selectedCompanyId} includeAllPersons
                onPick={p => { const hkid = splitHkid(p.idNumber || ''); updateAuthRepNat(a.id, { nameChinese: p.nameChinese || '', surname: p.surname || '', otherNames: p.otherNames || '', addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '', addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', hkidMain: hkid.main, hkidCheck: hkid.check, passportCountry: p.passportCountry || '', passportNumber: p.passportNumber || '' }); }} />
              <div className="grid grid-cols-3 gap-2 mt-3">
                <Input className="h-8 text-xs" placeholder="中文姓名" value={a.nameChinese} onChange={e => updateAuthRepNat(a.id, { nameChinese: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={a.surname} onChange={e => updateAuthRepNat(a.id, { surname: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={a.otherNames} onChange={e => updateAuthRepNat(a.id, { otherNames: e.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">香港地址 Hong Kong Address</p>
              <AddressQuickPick companyId={selectedCompanyId} includeAllCompanies
                onPick={d => updateAuthRepNat(a.id, { addrFlat: d.flat || '', addrBuilding: d.building || '', addrStreet: d.street || '', addrDistrict: d.district || '' })} />
              <div className="grid grid-cols-4 gap-1 mt-2">
                <Input className="h-8 text-xs" placeholder="室/樓/座" value={a.addrFlat} onChange={e => updateAuthRepNat(a.id, { addrFlat: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={a.addrBuilding} onChange={e => updateAuthRepNat(a.id, { addrBuilding: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="街道" value={a.addrStreet} onChange={e => updateAuthRepNat(a.id, { addrStreet: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="區" value={a.addrDistrict} onChange={e => updateAuthRepNat(a.id, { addrDistrict: e.target.value })} />
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="電郵 Email" value={a.email} onChange={e => updateAuthRepNat(a.id, { email: e.target.value })} />
                <div className="flex items-center gap-0.5">
                  <Input className="h-8 text-xs flex-1 font-mono" placeholder="HKID" value={a.hkidMain} onChange={e => updateAuthRepNat(a.id, { hkidMain: e.target.value })} maxLength={8} />
                  <span className="text-xs text-muted-foreground font-mono">(</span>
                  <Input className="h-8 w-8 text-xs text-center font-mono" placeholder="" value={a.hkidCheck} onChange={e => updateAuthRepNat(a.id, { hkidCheck: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} maxLength={1} />
                  <span className="text-xs text-muted-foreground font-mono">)</span>
                </div>
                <Label className="text-xs">護照簽發國</Label>
                <CountryInput value={a.passportCountry} onChange={v => updateAuthRepNat(a.id, { passportCountry: v })} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2"><Input className="h-8 text-xs" placeholder="護照號碼" value={a.passportNumber} onChange={e => updateAuthRepNat(a.id, { passportNumber: e.target.value })} /></div>
              <div className="max-w-xs mt-2">
                <DatePickerInput label="獲授權日期 Date of Authorization"
                  day={a.day} month={a.month} year={a.year}
                  onChange={({ day, month, year }) => updateAuthRepNat(a.id, { day, month, year })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.4: Auth Reps (法人) ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">🏢 授權代表（法人）Auth Rep — Body Corporate（P.4, Section 5B）</h3>
            <Button variant="outline" size="sm" onClick={addAuthRepCorp}><Plus className="h-4 w-4 mr-1" />新增授權代表</Button>
          </div>
          {authRepCorps.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊按鈕添加。</p>}
          {authRepCorps.map((c, i) => (
            <div key={c.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">授權代表（法人）#{i + 1} {i === 0 ? '— P.4' : '— 續頁 P.12'}</span>
                <Button variant="ghost" size="sm" onClick={() => removeAuthRepCorp(c.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="flex gap-4 mb-3">
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={c.isLawFirm} onCheckedChange={v => updateAuthRepCorp(c.id, { isLawFirm: !!v })} />律師行／律師法團</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={c.isCpaFirm} onCheckedChange={v => updateAuthRepCorp(c.id, { isCpaFirm: !!v })} />會計師事務所／執業法團</label>
              </div>
              <PersonQuickPick companyId={selectedCompanyId} includeAllPersons
                onPick={p => updateAuthRepCorp(c.id, { nameChinese: p.nameChinese || '', nameEnglish: p.nameEnglish || '', addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '', addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '' })} />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="中文名稱" value={c.nameChinese} onChange={e => updateAuthRepCorp(c.id, { nameChinese: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名稱" value={c.nameEnglish} onChange={e => updateAuthRepCorp(c.id, { nameEnglish: e.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">香港地址 Hong Kong Address</p>
              <AddressQuickPick companyId={selectedCompanyId} includeAllCompanies
                onPick={d => updateAuthRepCorp(c.id, { addrFlat: d.flat || '', addrBuilding: d.building || '', addrStreet: d.street || '', addrDistrict: d.district || '' })} />
              <div className="grid grid-cols-4 gap-1 mt-2">
                <Input className="h-8 text-xs" placeholder="室/樓/座" value={c.addrFlat} onChange={e => updateAuthRepCorp(c.id, { addrFlat: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={c.addrBuilding} onChange={e => updateAuthRepCorp(c.id, { addrBuilding: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="街道" value={c.addrStreet} onChange={e => updateAuthRepCorp(c.id, { addrStreet: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="區" value={c.addrDistrict} onChange={e => updateAuthRepCorp(c.id, { addrDistrict: e.target.value })} />
              </div>
              <div className="max-w-xs mt-2"><Input className="h-8 text-xs" placeholder="電郵 Email" value={c.email} onChange={e => updateAuthRepCorp(c.id, { email: e.target.value })} /></div>
              <div className="max-w-xs mt-2">
                <DatePickerInput label="獲授權日期 Date of Authorization"
                  day={c.day} month={c.month} year={c.year}
                  onChange={({ day, month, year }) => updateAuthRepCorp(c.id, { day, month, year })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.5: Company Secretary (自然人) ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">📝 公司秘書（自然人）Company Secretary — Natural Person（P.5, Section 6A）</h3>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={hasSecNat} onCheckedChange={v => setHasSecNat(!!v)} />啟用此項</label>
          </div>
          {hasSecNat && (<>
            <PersonQuickPick companyId={selectedCompanyId} includeAllPersons
              onPick={p => { const hkid = splitHkid(p.idNumber || ''); setSecNat(prev => ({ ...prev, nameChinese: p.nameChinese || '', surname: p.surname || '', otherNames: p.otherNames || '', prevNameChinese: p.previousNameChinese || '', prevNameEnglish: p.previousNameEnglish || '', aliasChinese: p.aliasChinese || '', aliasEnglish: p.aliasEnglish || '', addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '', addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '', hkidMain: hkid.main, hkidCheck: hkid.check, passportCountry: p.passportCountry || '', passportNumber: p.passportNumber || '' })); }} />
            <div className="grid grid-cols-3 gap-2 mt-3">
              <Input className="h-8 text-xs" placeholder="中文姓名" value={secNat.nameChinese} onChange={e => setSecNat({ ...secNat, nameChinese: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={secNat.surname} onChange={e => setSecNat({ ...secNat, surname: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={secNat.otherNames} onChange={e => setSecNat({ ...secNat, otherNames: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Input className="h-8 text-xs" placeholder="前用姓名(中) Previous Name (CN)" value={secNat.prevNameChinese} onChange={e => setSecNat({ ...secNat, prevNameChinese: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="前用姓名(英) Previous Name (EN)" value={secNat.prevNameEnglish} onChange={e => setSecNat({ ...secNat, prevNameEnglish: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="別名(中) Alias (CN)" value={secNat.aliasChinese} onChange={e => setSecNat({ ...secNat, aliasChinese: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="別名(英) Alias (EN)" value={secNat.aliasEnglish} onChange={e => setSecNat({ ...secNat, aliasEnglish: e.target.value })} />
            </div>
            <p className="text-xs font-medium mt-2">通訊地址 Correspondence Address</p>
            <AddressQuickPick companyId={selectedCompanyId} includeAllCompanies
              onPick={d => setSecNat(prev => ({ ...prev, addrFlat: d.flat || '', addrBuilding: d.building || '', addrStreet: d.street || '', addrDistrict: d.district || '', addrRegion: d.country || d.region || '' }))} />
            <div className="grid grid-cols-5 gap-1 mt-2">
              <Input className="h-8 text-xs" placeholder="室/樓/座" value={secNat.addrFlat} onChange={e => setSecNat({ ...secNat, addrFlat: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="大廈" value={secNat.addrBuilding} onChange={e => setSecNat({ ...secNat, addrBuilding: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="街道" value={secNat.addrStreet} onChange={e => setSecNat({ ...secNat, addrStreet: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="區/市/省" value={secNat.addrDistrict} onChange={e => setSecNat({ ...secNat, addrDistrict: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="國家/地區" value={secNat.addrRegion} onChange={e => setSecNat({ ...secNat, addrRegion: e.target.value })} />
            </div>
            <div className="grid grid-cols-4 gap-2 mt-2">
              <Input className="h-8 text-xs" placeholder="電郵 Email" value={secNat.email} onChange={e => setSecNat({ ...secNat, email: e.target.value })} />
              <div className="flex items-center gap-0.5">
                <Input className="h-8 text-xs flex-1 font-mono" placeholder="HKID" value={secNat.hkidMain} onChange={e => setSecNat({ ...secNat, hkidMain: e.target.value })} maxLength={8} />
                <span className="text-xs text-muted-foreground font-mono">(</span>
                <Input className="h-8 w-8 text-xs text-center font-mono" placeholder="" value={secNat.hkidCheck} onChange={e => setSecNat({ ...secNat, hkidCheck: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} maxLength={1} />
                <span className="text-xs text-muted-foreground font-mono">)</span>
              </div>
              <Label className="text-xs">護照簽發國</Label>
              <CountryInput value={secNat.passportCountry} onChange={v => setSecNat({ ...secNat, passportCountry: v })} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2"><Input className="h-8 text-xs" placeholder="護照號碼" value={secNat.passportNumber} onChange={e => setSecNat({ ...secNat, passportNumber: e.target.value })} /></div>
            <div className="max-w-xs mt-2">
              <DatePickerInput label="獲委任日期 Date of Appointment"
                day={secNat.day} month={secNat.month} year={secNat.year}
                onChange={({ day, month, year }) => setSecNat({ ...secNat, day, month, year })} />
            </div>
          </>)}
        </div>

        {/* ═══ P.6: Company Secretary (法人) ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">🏢 公司秘書（法人）Company Secretary — Body Corporate（P.6, Section 6B）</h3>
            <Button variant="outline" size="sm" onClick={addSecCorp}><Plus className="h-4 w-4 mr-1" />新增秘書</Button>
          </div>
          {secCorps.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊按鈕添加。（如不需要可留空）</p>}
          {secCorps.map((s, i) => (
            <div key={s.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">公司秘書（法人）#{i + 1} {i === 0 ? '— P.6' : '— 續頁 P.14'}</span>
                <Button variant="ghost" size="sm" onClick={() => removeSecCorp(s.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <PersonQuickPick companyId={selectedCompanyId} includeAllPersons
                onPick={p => updateSecCorp(s.id, { nameChinese: p.nameChinese || '', nameEnglish: p.nameEnglish || '', addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '', addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '', brNumber: p.companyNumberRef || '' })} />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="中文名稱" value={s.nameChinese} onChange={e => updateSecCorp(s.id, { nameChinese: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名稱" value={s.nameEnglish} onChange={e => updateSecCorp(s.id, { nameEnglish: e.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">地址 Address</p>
              <AddressQuickPick companyId={selectedCompanyId} includeAllCompanies
                onPick={d => updateSecCorp(s.id, { addrFlat: d.flat || '', addrBuilding: d.building || '', addrStreet: d.street || '', addrDistrict: d.district || '', addrRegion: d.country || d.region || '' })} />
              <div className="grid grid-cols-5 gap-1 mt-2">
                <Input className="h-8 text-xs" placeholder="室/樓/座" value={s.addrFlat} onChange={e => updateSecCorp(s.id, { addrFlat: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={s.addrBuilding} onChange={e => updateSecCorp(s.id, { addrBuilding: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="街道" value={s.addrStreet} onChange={e => updateSecCorp(s.id, { addrStreet: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="區/市/省" value={s.addrDistrict} onChange={e => updateSecCorp(s.id, { addrDistrict: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="國家/地區" value={s.addrRegion} onChange={e => updateSecCorp(s.id, { addrRegion: e.target.value })} />
              </div>
              <div className="max-w-xs mt-2"><Input className="h-8 text-xs" placeholder="電郵 Email" value={s.email} onChange={e => updateSecCorp(s.id, { email: e.target.value })} /></div>
              <div className="max-w-xs mt-2"><Input className="h-8 text-xs" placeholder="商業登記號碼 BR Number" value={s.brNumber} onChange={e => updateSecCorp(s.id, { brNumber: e.target.value })} /></div>
              <div className="max-w-xs mt-2">
                <DatePickerInput label="獲委任日期 Date of Appointment"
                  day={s.day} month={s.month} year={s.year}
                  onChange={({ day, month, year }) => updateSecCorp(s.id, { day, month, year })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.7-8: Directors (自然人) ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">👔 董事（自然人）Directors — Natural Person（P.7-8, Section 7A）</h3>
            <Button variant="outline" size="sm" onClick={addDirNat}><Plus className="h-4 w-4 mr-1" />新增董事</Button>
          </div>
          {dirNats.map((d, i) => (
            <div key={d.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">董事（自然人）#{i + 1} {i < 2 ? `— P.${7 + i}` : '— 續頁 P.15'}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-xs"><Checkbox checked={d.isAlternate} onCheckedChange={v => updateDirNat(d.id, { isAlternate: !!v })} />候補董事</label>
                  {d.isAlternate && <Input className="h-7 w-32 text-xs" placeholder="代替 Alternate to" value={d.alternateTo} onChange={e => updateDirNat(d.id, { alternateTo: e.target.value })} />}
                  <Button variant="ghost" size="sm" onClick={() => removeDirNat(d.id)} className="text-red-500" disabled={dirNats.length <= 1}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <PersonQuickPick companyId={selectedCompanyId} includeAllPersons
                onPick={p => { const hkid = splitHkid(p.idNumber || ''); updateDirNat(d.id, { nameChinese: p.nameChinese || '', surname: p.surname || '', otherNames: p.otherNames || '', prevNameChinese: p.previousNameChinese || '', prevNameEnglish: p.previousNameEnglish || '', aliasChinese: p.aliasChinese || '', aliasEnglish: p.aliasEnglish || '', addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '', addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '', hkidMain: hkid.main, hkidCheck: hkid.check, passportCountry: p.passportCountry || '', passportNumber: p.passportNumber || '' }); }} />
              <div className="grid grid-cols-3 gap-2 mt-3">
                <Input className="h-8 text-xs" placeholder="中文姓名" value={d.nameChinese} onChange={e => updateDirNat(d.id, { nameChinese: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={d.surname} onChange={e => updateDirNat(d.id, { surname: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={d.otherNames} onChange={e => updateDirNat(d.id, { otherNames: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="前用姓名(中)" value={d.prevNameChinese} onChange={e => updateDirNat(d.id, { prevNameChinese: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="前用姓名(英)" value={d.prevNameEnglish} onChange={e => updateDirNat(d.id, { prevNameEnglish: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="別名(中)" value={d.aliasChinese} onChange={e => updateDirNat(d.id, { aliasChinese: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="別名(英)" value={d.aliasEnglish} onChange={e => updateDirNat(d.id, { aliasEnglish: e.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">通訊地址 Correspondence Address</p>
              <AddressQuickPick companyId={selectedCompanyId} includeAllCompanies
                onPick={ad => updateDirNat(d.id, { addrFlat: ad.flat || '', addrBuilding: ad.building || '', addrStreet: ad.street || '', addrDistrict: ad.district || '', addrRegion: ad.country || ad.region || '' })} />
              <div className="grid grid-cols-5 gap-1 mt-2">
                <Input className="h-8 text-xs" placeholder="室/樓/座" value={d.addrFlat} onChange={e => updateDirNat(d.id, { addrFlat: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={d.addrBuilding} onChange={e => updateDirNat(d.id, { addrBuilding: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="街道" value={d.addrStreet} onChange={e => updateDirNat(d.id, { addrStreet: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="區/市/省" value={d.addrDistrict} onChange={e => updateDirNat(d.id, { addrDistrict: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="國家/地區" value={d.addrRegion} onChange={e => updateDirNat(d.id, { addrRegion: e.target.value })} />
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="電郵 Email" value={d.email} onChange={e => updateDirNat(d.id, { email: e.target.value })} />
                <div className="flex items-center gap-0.5">
                  <Input className="h-8 text-xs flex-1 font-mono" placeholder="HKID" value={d.hkidMain} onChange={e => updateDirNat(d.id, { hkidMain: e.target.value })} maxLength={8} />
                  <span className="text-xs text-muted-foreground font-mono">(</span>
                  <Input className="h-8 w-8 text-xs text-center font-mono" placeholder="" value={d.hkidCheck} onChange={e => updateDirNat(d.id, { hkidCheck: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} maxLength={1} />
                  <span className="text-xs text-muted-foreground font-mono">)</span>
                </div>
                <Label className="text-xs">護照簽發國</Label>
                <CountryInput value={d.passportCountry} onChange={v => updateDirNat(d.id, { passportCountry: v })} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2"><Input className="h-8 text-xs" placeholder="護照號碼" value={d.passportNumber} onChange={e => updateDirNat(d.id, { passportNumber: e.target.value })} /></div>
              <div className="max-w-xs mt-2">
                <DatePickerInput label="獲委任日期 Date of Appointment"
                  day={d.day} month={d.month} year={d.year}
                  onChange={({ day, month, year }) => updateDirNat(d.id, { day, month, year })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.9: Directors (法人) ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">🏢 董事（法人）Directors — Body Corporate（P.9, Section 7B）</h3>
            <Button variant="outline" size="sm" onClick={addDirCorp}><Plus className="h-4 w-4 mr-1" />新增法人董事</Button>
          </div>
          {dirCorps.map((d, i) => (
            <div key={d.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">董事（法人）#{i + 1} {i === 0 ? '— P.9' : '— 續頁 P.16'}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-xs"><Checkbox checked={d.isAlternate} onCheckedChange={v => updateDirCorp(d.id, { isAlternate: !!v })} />候補董事</label>
                  {d.isAlternate && <Input className="h-7 w-32 text-xs" placeholder="代替 Alternate to" value={d.alternateTo} onChange={e => updateDirCorp(d.id, { alternateTo: e.target.value })} />}
                  <Button variant="ghost" size="sm" onClick={() => removeDirCorp(d.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <PersonQuickPick companyId={selectedCompanyId} includeAllPersons
                onPick={p => updateDirCorp(d.id, { nameChinese: p.nameChinese || '', nameEnglish: p.nameEnglish || '', addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '', addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '' })} />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="中文名稱" value={d.nameChinese} onChange={e => updateDirCorp(d.id, { nameChinese: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名稱" value={d.nameEnglish} onChange={e => updateDirCorp(d.id, { nameEnglish: e.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">地址 Address</p>
              <AddressQuickPick companyId={selectedCompanyId} includeAllCompanies
                onPick={ad => updateDirCorp(d.id, { addrFlat: ad.flat || '', addrBuilding: ad.building || '', addrStreet: ad.street || '', addrDistrict: ad.district || '', addrRegion: ad.country || ad.region || '' })} />
              <div className="grid grid-cols-5 gap-1 mt-2">
                <Input className="h-8 text-xs" placeholder="室/樓/座" value={d.addrFlat} onChange={e => updateDirCorp(d.id, { addrFlat: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={d.addrBuilding} onChange={e => updateDirCorp(d.id, { addrBuilding: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="街道" value={d.addrStreet} onChange={e => updateDirCorp(d.id, { addrStreet: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="區/市/省" value={d.addrDistrict} onChange={e => updateDirCorp(d.id, { addrDistrict: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="國家/地區" value={d.addrRegion} onChange={e => updateDirCorp(d.id, { addrRegion: e.target.value })} />
              </div>
              <div className="max-w-xs mt-2"><Input className="h-8 text-xs" placeholder="電郵 Email" value={d.email} onChange={e => updateDirCorp(d.id, { email: e.target.value })} /></div>
              <div className="max-w-xs mt-2">
                <DatePickerInput label="獲委任日期 Date of Appointment"
                  day={d.day} month={d.month} year={d.year}
                  onChange={({ day, month, year }) => updateDirCorp(d.id, { day, month, year })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.10: Signature & Declaration ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="font-semibold mb-3">✍️ 簽署及聲明 Signature & Declaration（P.10）</h3>
          <div className="grid grid-cols-1 gap-3 mb-4 max-w-md">
            <div><Label>Section 8 — 章程文件名稱 Name of Charter/Statutes/M&A Documents</Label><Input value={charterDocs} onChange={e => setCharterDocs(e.target.value)} className="mt-1" /></div>
            <div><Label>Section 9 — 公司註冊證書名稱 Name of Certificate of Incorporation</Label><Input value={incorpCert} onChange={e => setIncorpCert(e.target.value)} className="mt-1" /></div>
          </div>
          <Separator className="my-4" />
          <h4 className="text-sm font-medium mb-2">Section 10A — 會計年度 Accounts Period</h4>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <DatePickerInput label="由 From"
              day={acctFromDay} month={acctFromMonth} year={acctFromYear}
              onChange={({ day, month, year }) => { setAcctFromDay(day); setAcctFromMonth(month); setAcctFromYear(year); }} />
            <DatePickerInput label="至 To"
              day={acctToDay} month={acctToMonth} year={acctToYear}
              onChange={({ day, month, year }) => { setAcctToDay(day); setAcctToMonth(month); setAcctToYear(year); }} />
          </div>
          <h4 className="text-sm font-medium mb-2">Section 10B — 陳述</h4>
          <div className="space-y-2 mb-4">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={noAcctsRequired} onCheckedChange={v => setNoAcctsRequired(!!v)} />成立所在地法律無需擬備帳目</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={incorpLess18m} onCheckedChange={v => setIncorpLess18m(!!v)} />成立少於18個月，帳目尚未擬備</label>
          </div>
          <Separator className="my-4" />
          <h4 className="text-sm font-medium mb-2">續頁頁數 Continuation Sheet Page Counts（自動計算）</h4>
          <div className="grid grid-cols-4 gap-2 mb-4 text-sm">
            <div className="bg-muted/50 rounded p-2 text-center"><div className="text-xs text-muted-foreground">A (AR 自然人)</div><div className="font-mono font-bold text-lg">{continuationCounts.sheetA}</div></div>
            <div className="bg-muted/50 rounded p-2 text-center"><div className="text-xs text-muted-foreground">B (AR 法人)</div><div className="font-mono font-bold text-lg">{continuationCounts.sheetB}</div></div>
            <div className="bg-muted/50 rounded p-2 text-center"><div className="text-xs text-muted-foreground">C (Sec 自然人)</div><div className="font-mono font-bold text-lg">{continuationCounts.sheetC}</div></div>
            <div className="bg-muted/50 rounded p-2 text-center"><div className="text-xs text-muted-foreground">D (Sec 法人)</div><div className="font-mono font-bold text-lg">{continuationCounts.sheetD}</div></div>
            <div className="bg-muted/50 rounded p-2 text-center"><div className="text-xs text-muted-foreground">E (Dir 自然人)</div><div className="font-mono font-bold text-lg">{continuationCounts.sheetE}</div></div>
            <div className="bg-muted/50 rounded p-2 text-center"><div className="text-xs text-muted-foreground">F (Dir 法人)</div><div className="font-mono font-bold text-lg">{continuationCounts.sheetF}</div></div>
            <div className="bg-muted/50 rounded p-2 text-center"><div className="text-xs text-muted-foreground">PI-NN1</div><div className="font-mono font-bold text-lg">{continuationCounts.sheetPINN1}</div></div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2 mb-2">以上頁數根據您填寫的人員數量自動計算，無需手動輸入。</p>
          <Separator className="my-4" />
          <h4 className="text-sm font-medium mb-2">簽署 Signature</h4>
          <div className="grid grid-cols-2 gap-3 max-w-md items-end">
            <div><Label>簽署人姓名 Name of Signatory</Label><Input value={signatoryName} onChange={e => setSignatoryName(e.target.value)} className="mt-1" /></div>
            <DatePickerInput label="簽署日期 Date"
              day={signDateDay} month={signDateMonth} year={signDateYear}
              onChange={({ day, month, year }) => { setSignDateDay(day); setSignDateMonth(month); setSignDateYear(year); }} />
          </div>
          <div className="mt-3">
            <Label className="text-xs font-medium mb-1 block">簽署人身份 Capacity of Signatory <span className="text-muted-foreground">（點擊選擇一個身份，其他畫橫線刪去）</span></Label>
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'director', label: '董事 Director' },
                { key: 'secretary', label: '公司秘書 Company Secretary' },
                { key: 'manager', label: '經理 Manager' },
                { key: 'authorizedRep', label: '獲授權代表 Authorized Representative' },
              ] as const).map(cap => {
                const isSelected = signatoryCapacity === cap.key;
                const isStrikethrough = signatoryCapacity && signatoryCapacity !== cap.key;
                return (
                  <button key={cap.key} type="button"
                    className={`px-3 py-1.5 rounded-md text-xs border transition-all ${
                      isSelected ? 'bg-blue-600 text-white border-blue-600 font-semibold' :
                      isStrikethrough ? 'bg-muted text-muted-foreground border-border line-through' :
                      'bg-background border-border hover:bg-accent'
                    }`}
                    onClick={() => setSignatoryCapacity(isSelected ? '' : cap.key)}
                  >
                    {cap.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ═══ P.17: PI-NN1 — 自動從表單自然人生成 ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="font-semibold mb-3">🔒 受保護資料 PI-NN1 — Protected Information（P.17）</h3>
          <p className="text-xs text-muted-foreground mb-3">
            以下自然人的個人資料將自動填入 PI-NN1，每人一頁（不供公眾查閱）。
            資料來源自上方已填寫的授權代表、公司秘書、董事。
          </p>
          {piPersons.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-md text-center">
              ⚠️ 尚未填寫任何自然人（授權代表／秘書／董事）。<br />
              請先在上方各區塊填寫自然人的姓名地址，PI-NN1 頁面將自動生成。
            </div>
          ) : (
            <div className="space-y-2">
              {piPersons.map((p, i) => (
                <div key={i} className="flex items-start gap-3 p-3 border rounded-md bg-muted/30">
                  <span className="text-xs font-mono font-bold text-muted-foreground mt-0.5">P{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {p.surname} {p.otherNames}{p.nameChinese ? ` (${p.nameChinese})` : ''}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.isAR && <span className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">授權代表</span>}
                      {p.isSec && <span className="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded">公司秘書</span>}
                      {p.isDir && <span className="text-xs bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">董事</span>}
                      {p.isAltDir && <span className="text-xs bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded">候補董事</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {[
    p.hkidMain ? `HKID: ${p.hkidMain.slice(0, 4)}${p.hkidMain.length > 4 ? '****' : ''}${p.hkidCheck || ''}` : '',
    (p.passportCountry || p.passportNumber) ? `護照: ${p.passportCountry} ${p.passportNumber}`.trim() : '',
  ].filter(Boolean).join(' · ')}
                      {' · '}{[p.addrFlat, p.addrBuilding, p.addrStreet, p.addrDistrict, p.addrCountry].filter(Boolean).join(', ')}
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-1">
                ✅ 共 {piPersons.length} 位自然人，將生成 {piPersons.length} 頁 PI-NN1。
              </p>
            </div>
          )}
        </div>

        {/* ═══ GENERATE ═══ */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} size="lg" className="bg-primary text-primary-foreground px-12">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN1 PDF</>}
          </Button>
        </div>
      </div>

      <RelatedFormsPrompt
        open={showRelatedPrompt} onOpenChange={setShowRelatedPrompt}
        primaryFormCode="NN1" primaryFormName="NN1 — 註冊非香港公司的註冊申請書"
        primaryFormData={{ proposedNameEn, proposedNameCn, placeOfIncorporation, estDay, estMonth, estYear, addrFlat, addrBuilding, addrStreet, addrDistrict, companyEmail, companyPhone, presenterNameCn: '', presenterNameEn, presenterAddress, presenterPhone, presenterFax, presenterEmail, presenterRef, signatoryName, signDate: signDateDay && signDateMonth && signDateYear ? `${signDateDay}/${signDateMonth}/${signDateYear}` : '', company_id: selectedCompanyId }}
        companyId={selectedCompanyId} companyName={proposedNameEn || selectedCompany?.brNumber || ''} linkages={relatedLinkages}
      />
    </div>
  );
}
