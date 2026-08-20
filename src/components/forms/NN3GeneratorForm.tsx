import { useState, useEffect, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, ArrowLeft, Download, Loader2, Plus, Trash2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Person } from '@/types';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import AddressQuickPick from './AddressQuickPick';
import PersonQuickPick from './PersonQuickPick';
import type { Presenter } from '@/hooks/usePresenters';
import { NAR1YearChangesPanel } from '@/components/nar1/NAR1YearChangesPanel';

interface NN3GeneratorFormProps { onBack: () => void; initialCompanyId?: string; }

// ── Types ──

interface DateParts { day: string; month: string; year: string; }

type SignerCapacity = 'director' | 'secretary' | 'manager' | 'authorizedRep' | '';

interface AuthRepNatEntry {
  id: string;
  nameChinese: string; surname: string; otherNames: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
  hkidMain: string; hkidCheck: string; passportCountry: string; passportNumber: string;
}

interface AuthRepCorpEntry {
  id: string;
  nameChinese: string; nameEnglish: string;
  isLawFirm: boolean; isCpaFirm: boolean;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
}

interface NatSecEntry {
  id: string;
  nameChinese: string; surname: string; otherNames: string;
  prevNameChinese: string; prevNameEnglish: string;
  aliasChinese: string; aliasEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
  hkidMain: string; hkidCheck: string; passportCountry: string; passportNumber: string;
}

interface CorpSecEntry {
  id: string;
  nameChinese: string; nameEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
  brNumber: string;
}

interface NatDirEntry {
  id: string;
  isAlternate: boolean; alternateTo: string;
  nameChinese: string; surname: string; otherNames: string;
  prevNameChinese: string; prevNameEnglish: string;
  aliasChinese: string; aliasEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
  hkidMain: string; hkidCheck: string; passportCountry: string; passportNumber: string;
}

interface CorpDirEntry {
  id: string;
  isAlternate: boolean; alternateTo: string;
  nameChinese: string; nameEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
  brNumber: string;
}

// ── Helpers ──

let _idCounter = 0;
const uid = () => `nn3_${++_idCounter}`;

function toDate(d: string, m: string, y: string): Date | null {
  if (!d || !m || !y) return null;
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  return isNaN(date.getTime()) ? null : date;
}

function splitHkid(raw: string): { main: string; check: string } {
  if (!raw) return { main: '', check: '' };
  const cleaned = raw.replace(/[()\-\s]/g, '');
  if (cleaned.length <= 1) return { main: cleaned, check: '' };
  return { main: cleaned.slice(0, -1), check: cleaned.slice(-1) };
}

/** 解析 DD/MM/YYYY（en-GB，D1 存儲格式）或 ISO YYYY-MM-DD → 日/月/年 */
function parseDmy(s?: string): DateParts | null {
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { day: m[3], month: m[2], year: m[1] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { day: m[1].padStart(2, '0'), month: m[2].padStart(2, '0'), year: m[3] };
  return null;
}

/** 地址 5 欄：優先分欄欄位；全空時整串地址回退到「街道」欄（老資料只有 address 字串） */
function splitAddr(p: { addrFlat?: string; addrBuilding?: string; addrStreet?: string; addrDistrict?: string; addrRegion?: string; address?: string }) {
  const hasSplit = !!(p.addrFlat || p.addrBuilding || p.addrStreet || p.addrDistrict || p.addrRegion);
  return {
    addrFlat: p.addrFlat || '',
    addrBuilding: p.addrBuilding || '',
    addrStreet: p.addrStreet || (!hasSplit ? (p.address || '') : ''),
    addrDistrict: p.addrDistrict || '',
    addrRegion: p.addrRegion || '',
  };
}

const pad2 = (v: string) => v.padStart(2, '0');

/**
 * NN3 周年日 = 香港註冊日期（Section 3）的最近一個已過周年日
 * （例：6/1 註冊的公司今天應生成 2026-06-01 結算的申報，而非下一個周年日）
 */
const computeReturnDate = (baseDate?: string): string => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  if (baseDate) {
    let d: Date;
    if (baseDate.includes('/')) {
      const parts = baseDate.split('/');
      d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    } else {
      d = new Date(baseDate);
    }
    if (!isNaN(d.getTime())) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      let targetYear = currentYear;
      const candidate = new Date(targetYear, d.getMonth(), d.getDate());
      if (candidate > today) targetYear = currentYear - 1;
      return `${targetYear}-${mm}-${dd}`;
    }
  }
  return today.toISOString().split('T')[0];
};

// ── Factory functions ──

const emptyAuthRepNat = (): AuthRepNatEntry => ({
  id: uid(),
  nameChinese: '', surname: '', otherNames: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', hkidMain: '', hkidCheck: '', passportCountry: '', passportNumber: '',
});

const emptyAuthRepCorp = (): AuthRepCorpEntry => ({
  id: uid(),
  nameChinese: '', nameEnglish: '',
  isLawFirm: false, isCpaFirm: false,
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '',
});

const emptyNatSec = (): NatSecEntry => ({
  id: uid(),
  nameChinese: '', surname: '', otherNames: '',
  prevNameChinese: '', prevNameEnglish: '', aliasChinese: '', aliasEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', hkidMain: '', hkidCheck: '', passportCountry: '', passportNumber: '',
});

const emptyCorpSec = (): CorpSecEntry => ({
  id: uid(),
  nameChinese: '', nameEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', brNumber: '',
});

const emptyNatDir = (): NatDirEntry => ({
  id: uid(),
  isAlternate: false, alternateTo: '',
  nameChinese: '', surname: '', otherNames: '',
  prevNameChinese: '', prevNameEnglish: '', aliasChinese: '', aliasEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', hkidMain: '', hkidCheck: '', passportCountry: '', passportNumber: '',
});

const emptyCorpDir = (): CorpDirEntry => ({
  id: uid(),
  isAlternate: false, alternateTo: '',
  nameChinese: '', nameEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', brNumber: '',
});

// ── DatePickerInput (same as NAR1) ──

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

// ═══════════════ MAIN COMPONENT ═══════════════

export default function NN3GeneratorForm({ onBack, initialCompanyId }: NN3GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );

  // ── P.1: Company Info ──
  const [brNumber, setBrNumber] = useState('');
  const [companyNameEnglish, setCompanyNameEnglish] = useState('');
  const [companyNameChinese, setCompanyNameChinese] = useState('');
  const [returnDate, setReturnDate] = useState('');                     // ISO YYYY-MM-DD
  const [regDay, setRegDay] = useState('');                             // Section 3 香港註冊日期
  const [regMonth, setRegMonth] = useState('');
  const [regYear, setRegYear] = useState('');
  const [placeOfIncorporation, setPlaceOfIncorporation] = useState('');
  const [ppbFlat, setPpbFlat] = useState('');
  const [ppbBuilding, setPpbBuilding] = useState('');
  const [ppbStreet, setPpbStreet] = useState('');
  const [ppbDistrict, setPpbDistrict] = useState('');
  const [ppbRegion, setPpbRegion] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // ── P.2: Office in Place of Incorporation ──
  const [offAFlat, setOffAFlat] = useState('');
  const [offABuilding, setOffABuilding] = useState('');
  const [offAStreet, setOffAStreet] = useState('');
  const [offADistrictCity, setOffADistrictCity] = useState('');
  const [offACountry, setOffACountry] = useState('');
  const [offBFlat, setOffBFlat] = useState('');
  const [offBBuilding, setOffBBuilding] = useState('');
  const [offBStreet, setOffBStreet] = useState('');
  const [offBDistrictCity, setOffBDistrictCity] = useState('');
  const [offBCountry, setOffBCountry] = useState('');
  const [emailInPlace, setEmailInPlace] = useState('');

  // ── P.3: Authorized Representatives ──
  const [authRepNats, setAuthRepNats] = useState<AuthRepNatEntry[]>([]);
  const addAuthRepNat = () => setAuthRepNats(prev => [...prev, emptyAuthRepNat()]);
  const removeAuthRepNat = (id: string) => setAuthRepNats(prev => prev.filter(a => a.id !== id));
  const updateAuthRepNat = (id: string, patch: Partial<AuthRepNatEntry>) => setAuthRepNats(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  const [authRepCorps, setAuthRepCorps] = useState<AuthRepCorpEntry[]>([]);
  const addAuthRepCorp = () => setAuthRepCorps(prev => [...prev, emptyAuthRepCorp()]);
  const removeAuthRepCorp = (id: string) => setAuthRepCorps(prev => prev.filter(a => a.id !== id));
  const updateAuthRepCorp = (id: string, patch: Partial<AuthRepCorpEntry>) => setAuthRepCorps(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── P.4: Company Secretary ──
  const [natSecs, setNatSecs] = useState<NatSecEntry[]>([]);
  const addNatSec = () => setNatSecs(prev => [...prev, emptyNatSec()]);
  const removeNatSec = (id: string) => setNatSecs(prev => prev.filter(a => a.id !== id));
  const updateNatSec = (id: string, patch: Partial<NatSecEntry>) => setNatSecs(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  const [corpSecs, setCorpSecs] = useState<CorpSecEntry[]>([]);
  const addCorpSec = () => setCorpSecs(prev => [...prev, emptyCorpSec()]);
  const removeCorpSec = (id: string) => setCorpSecs(prev => prev.filter(a => a.id !== id));
  const updateCorpSec = (id: string, patch: Partial<CorpSecEntry>) => setCorpSecs(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── P.5–6: Directors (Natural) ──
  const [natDirs, setNatDirs] = useState<NatDirEntry[]>([]);
  const addNatDir = () => setNatDirs(prev => [...prev, emptyNatDir()]);
  const removeNatDir = (id: string) => setNatDirs(prev => prev.filter(a => a.id !== id));
  const updateNatDir = (id: string, patch: Partial<NatDirEntry>) => setNatDirs(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── P.7: Directors (Body Corporate) ──
  const [corpDirs, setCorpDirs] = useState<CorpDirEntry[]>([]);
  const addCorpDir = () => setCorpDirs(prev => [...prev, emptyCorpDir()]);
  const removeCorpDir = (id: string) => setCorpDirs(prev => prev.filter(a => a.id !== id));
  const updateCorpDir = (id: string, patch: Partial<CorpDirEntry>) => setCorpDirs(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── P.7: Share Capital + Mortgage ──
  const [authCurrency, setAuthCurrency] = useState('');
  const [authNominal, setAuthNominal] = useState('');
  const [issuedCurrency, setIssuedCurrency] = useState('');
  const [issuedNominal, setIssuedNominal] = useState('');
  const [mortgageAmount, setMortgageAmount] = useState('');

  // ── P.8: Accounts + Signer ──
  const [accountsMode, setAccountsMode] = useState<'' | 'delivered' | 'notDelivered'>('');
  const [accFrom, setAccFrom] = useState('');
  const [accTo, setAccTo] = useState('');
  const [notDeliveredReason, setNotDeliveredReason] = useState<'' | '1' | '2'>('');
  const [signerName, setSignerName] = useState('');
  const [signerCapacity, setSignerCapacity] = useState<SignerCapacity>('');
  const [signerDate, setSignerDate] = useState('');

  // ── Presenter ──
  const [presenterName, setPresenterName] = useState('');
  const [presenterAddress, setPresenterAddress] = useState('');
  const [presenterPhone, setPresenterPhone] = useState('');
  const [presenterFax, setPresenterFax] = useState('');
  const [presenterEmail, setPresenterEmail] = useState('');
  const [presenterRef, setPresenterRef] = useState('');

  // ── 頂部勾選：自動填入公司所有人員（董事／秘書），默認勾選 ──
  const [autoFillPeople, setAutoFillPeople] = useState(true);

  // ── 快照狀態（復用 /api/nar1-snapshot 按結算日 as-of 還原人員 + 本年度變動）──
  const [snapshotPeriod, setSnapshotPeriod] = useState<{ start: string; end: string } | null>(null);
  const [snapshotChanges, setSnapshotChanges] = useState<any[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotFailed, setSnapshotFailed] = useState(false);
  // 歷史載入守護：handleLoadHistory 之後不讓快照 refetch 覆蓋已載入的資料
  const suppressSnapshotRef = useRef(false);
  const signerDateTouchedRef = useRef(false);   // 用戶手改簽署日期後不再跟隨申報日期
  const signerTouchedRef = useRef(false);       // 用戶手改簽署人（姓名/身份）後不再跟隨首名董事

  // ── 續頁計數（只讀展示，後端會重算）──
  const continuationCounts = useMemo(() => ({
    sheetA: Math.max(0, authRepNats.length - 1) + Math.max(0, authRepCorps.length - 1),
    sheetB: Math.max(0, natSecs.length - 1) + Math.max(0, corpSecs.length - 1),
    sheetC: Math.max(0, natDirs.length - 2),                       // #1 P.5 / #2 P.6 / #3+ 續頁C
    sheetD: corpDirs.length > 1 ? Math.ceil((corpDirs.length - 1) / 2) : 0, // 2 人/頁
  }), [authRepNats.length, authRepCorps.length, natSecs.length, corpSecs.length, natDirs.length, corpDirs.length]);

  // ── 年度快選：香港註冊日期周年日往回 5 個 ──
  const yearChips = useMemo(() => {
    if (!regDay || !regMonth || !regYear) return [] as string[];
    const dd = Number(regDay), mm = Number(regMonth), yy = Number(regYear);
    if (!dd || !mm || !yy) return [] as string[];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const chips: string[] = [];
    for (let y = today.getFullYear(); chips.length < 5 && y >= yy; y--) {
      const candidate = new Date(y, mm - 1, dd);
      if (!isNaN(candidate.getTime()) && candidate <= today) {
        chips.push(`${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
      }
    }
    return chips;
  }, [regDay, regMonth, regYear]);

  // ── 公司選擇：自動填 BR／公司中英名／提交人（不自動填註冊日期）──
  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (!company) return;
    const regAddress = [
      company.regFlat, company.regBuilding, company.regStreet,
      company.regDistrict, company.regRegion,
    ].filter(Boolean).join(', ');
    // 重置與公司相關的欄位（註冊日期/申報日期等保持手填）
    setBrNumber(company.brNumber || '');
    setCompanyNameEnglish(company.name || '');
    setCompanyNameChinese(company.chineseName || '');
    setRegDay(''); setRegMonth(''); setRegYear('');
    setReturnDate('');
    setPlaceOfIncorporation('');
    setPpbFlat(''); setPpbBuilding(''); setPpbStreet(''); setPpbDistrict(''); setPpbRegion('');
    setEmail(company.email || '');
    setPhone(company.phone || '');
    setOffAFlat(''); setOffABuilding(''); setOffAStreet(''); setOffADistrictCity(''); setOffACountry('');
    setOffBFlat(''); setOffBBuilding(''); setOffBStreet(''); setOffBDistrictCity(''); setOffBCountry('');
    setEmailInPlace('');
    setAuthRepNats([]); setAuthRepCorps([]);
    setAuthCurrency(''); setAuthNominal(''); setIssuedCurrency(''); setIssuedNominal('');
    setMortgageAmount('');
    setAccountsMode(''); setAccFrom(''); setAccTo(''); setNotDeliveredReason('');
    setSignerName(''); setSignerCapacity(''); setSignerDate('');
    // 提交人預填公司資料
    setPresenterName(company.name || '');
    setPresenterAddress(regAddress || '');
    setPresenterPhone(company.phone || '');
    setPresenterFax('');
    setPresenterEmail(company.email || '');
    setPresenterRef(company.presenterReference || '');
    suppressSnapshotRef.current = false;
    if (autoFillPeople) applyPeopleFromCompany(company);
    else { setNatSecs([]); setCorpSecs([]); setNatDirs([]); setCorpDirs([]); }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  // ── 自動填入來源：快照 as-of 或公司當前值（同形）──
  interface PeopleSource {
    secretaries: Person[];
    directors: Person[];
  }

  /** 人員源 → 六個數組；順帶自動選簽署人（第一個自然人董事） */
  const applyPeopleFromSource = (src: PeopleSource) => {
    const natSecArr: NatSecEntry[] = [];
    const corpSecArr: CorpSecEntry[] = [];
    for (const s of src.secretaries) {
      if (s.identity === 'corporate') {
        corpSecArr.push({
          id: uid(),
          nameChinese: s.nameChinese || '', nameEnglish: s.nameEnglish || '',
          ...splitAddr(s),
          email: s.email || '',
          brNumber: (s as any).brNumber || s.companyNumberRef || '',
        });
      } else {
        const hkid = splitHkid(s.idNumber || '');
        natSecArr.push({
          id: uid(),
          nameChinese: s.nameChinese || '', surname: '', otherNames: s.nameEnglish || '',
          prevNameChinese: (s as any).previousNameChinese || '', prevNameEnglish: (s as any).previousNameEnglish || '',
          aliasChinese: (s as any).aliasChinese || '', aliasEnglish: (s as any).aliasEnglish || '',
          ...splitAddr(s),
          email: s.email || '',
          hkidMain: hkid.main, hkidCheck: hkid.check,
          passportCountry: s.passportCountry || '', passportNumber: s.passportNumber || '',
        });
      }
    }
    setNatSecs(natSecArr);
    setCorpSecs(corpSecArr);

    const natDirArr: NatDirEntry[] = [];
    const corpDirArr: CorpDirEntry[] = [];
    for (const d of src.directors) {
      if (d.identity === 'corporate') {
        corpDirArr.push({
          id: uid(), isAlternate: false, alternateTo: '',
          nameChinese: d.nameChinese || '', nameEnglish: d.nameEnglish || '',
          ...splitAddr(d),
          email: d.email || '',
          brNumber: (d as any).brNumber || d.companyNumberRef || '',
        });
      } else {
        const hkid = splitHkid(d.idNumber || '');
        natDirArr.push({
          id: uid(), isAlternate: !!(d as any).isReserve, alternateTo: '',
          nameChinese: d.nameChinese || '', surname: '', otherNames: d.nameEnglish || '',
          prevNameChinese: (d as any).previousNameChinese || '', prevNameEnglish: (d as any).previousNameEnglish || '',
          aliasChinese: (d as any).aliasChinese || '', aliasEnglish: (d as any).aliasEnglish || '',
          ...splitAddr(d),
          email: d.email || '',
          hkidMain: hkid.main, hkidCheck: hkid.check,
          passportCountry: d.passportCountry || '', passportNumber: d.passportNumber || '',
        });
      }
    }
    setNatDirs(natDirArr);
    setCorpDirs(corpDirArr);

    // 簽署人自動：第一個自然人董事（用戶手改後不再跟隨；快照重載會同步重設，避免董事清空後殘留舊簽署人）
    const firstDirName = natDirArr[0]
      ? `${natDirArr[0].surname} ${natDirArr[0].otherNames}`.trim() || natDirArr[0].nameChinese
      : '';
    if (!signerTouchedRef.current) {
      setSignerName(firstDirName);
      setSignerCapacity(firstDirName ? 'director' : '');
    }
  };

  /** fallback：公司當前值整批填入（快照端點不可用時） */
  const applyPeopleFromCompany = (company: any) => {
    applyPeopleFromSource({
      secretaries: company.secretaries || [],
      directors: company.directors || [],
    });
  };

  // ── 勾選開關：ON=自動填人；OFF=清空人員列表（手動填寫）──
  const handleAutoFillToggle = (on: boolean) => {
    setAutoFillPeople(on);
    if (on) {
      if (selectedCompany) {
        applyPeopleFromCompany(selectedCompany);
        suppressSnapshotRef.current = false;
      }
    } else {
      setNatSecs([]);
      setCorpSecs([]);
      setNatDirs([]);
      setCorpDirs([]);
      setSignerName('');
      setSignerCapacity('');
      setSnapshotPeriod(null);
      setSnapshotChanges([]);
      setSnapshotFailed(false);
    }
  };

  // ── 快照自動化：按申報日期取 as-of 董事／秘書 + 本年度變動（復用 NAR1 快照端點，不改它）──
  useEffect(() => {
    if (!selectedCompanyId || !autoFillPeople || suppressSnapshotRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) return;
    let cancelled = false;
    setSnapshotLoading(true);
    const token = localStorage.getItem('secretary_jwt') || '';
    fetch('/api/nar1-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ companyId: selectedCompanyId, returnDate }),
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((snap) => {
        if (cancelled || suppressSnapshotRef.current) return;
        // 快照的 reserveDirectors 併入 directors（映射體用 isReserve 標記候補董事）
        applyPeopleFromSource({
          secretaries: snap.officers?.secretaries || [],
          directors: [
            ...(snap.officers?.directors || []),
            ...(snap.officers?.reserveDirectors || []).map((r: Person) => ({ ...r, isReserve: true })),
          ],
        });
        setSnapshotPeriod(snap.period || null);
        setSnapshotChanges(snap.changes || []);
        setSnapshotFailed(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('NN3 snapshot failed, keeping current entries:', err);
        // 不覆蓋已填入的人員：handleCompanySelect 已填公司當前值；快照重載失敗保留現有數據
        setSnapshotPeriod(null);
        setSnapshotChanges([]);
        setSnapshotFailed(true);
        toast({
          title: '自動化快照不可用',
          description: '已保留目前填入的人員資料。',
        });
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId, autoFillPeople, returnDate]);

  // ── 註冊日期變更 → 申報日期為空或不匹配時自動設為最近周年日 ──
  useEffect(() => {
    if (!regDay || !regMonth || !regYear) return;
    const mm = pad2(regMonth), dd = pad2(regDay);
    if (!returnDate || !returnDate.endsWith(`-${mm}-${dd}`)) {
      setReturnDate(computeReturnDate(`${regYear}-${mm}-${dd}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regDay, regMonth, regYear]);

  // ── 簽署日期默認 = 申報日期（用戶手改後不再跟隨）──
  useEffect(() => {
    if (!signerDateTouchedRef.current && returnDate) setSignerDate(returnDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnDate]);

  // ── Load history（兼容舊扁平格式）──
  const handleLoadHistory = (data: any) => {
    // 載入歷史表單後不讓快照 effect refetch 覆蓋（點年度 chips 時才解除）
    suppressSnapshotRef.current = true;
    const fd = data.formData?.formData ?? data.formData ?? data ?? {};
    if (fd.selectedCompanyId) setSelectedCompanyId(fd.selectedCompanyId);

    if (fd.companyNameEnglish !== undefined) setCompanyNameEnglish(fd.companyNameEnglish);
    if (fd.companyNameChinese !== undefined) setCompanyNameChinese(fd.companyNameChinese);
    if (fd.brNumber !== undefined) setBrNumber(fd.brNumber);
    if (fd.placeOfIncorporation !== undefined) setPlaceOfIncorporation(fd.placeOfIncorporation);
    if (fd.email !== undefined) setEmail(fd.email);
    if (fd.phone !== undefined) setPhone(fd.phone);

    // returnDate：新格式 ISO 或舊格式三段
    if (fd.returnDate) {
      setReturnDate(fd.returnDate);
    } else if (fd.returnDay || fd.returnMonth || fd.returnYear) {
      setReturnDate(`${fd.returnYear}-${pad2(fd.returnMonth)}-${pad2(fd.returnDay)}`);
    }
    if (fd.regDay) setRegDay(pad2(fd.regDay));
    if (fd.regMonth) setRegMonth(pad2(fd.regMonth));
    if (fd.regYear) setRegYear(fd.regYear);

    // 5(a) 地址
    if (fd.ppbFlat !== undefined) {
      setPpbFlat(fd.ppbFlat); setPpbBuilding(fd.ppbBuilding || ''); setPpbStreet(fd.ppbStreet || '');
      setPpbDistrict(fd.ppbDistrict || ''); setPpbRegion(fd.ppbRegion || '');
    } else {
      if (fd.flat !== undefined) setPpbFlat(fd.flat);
      if (fd.building !== undefined) setPpbBuilding(fd.building);
      if (fd.street !== undefined) setPpbStreet(fd.street);
      if (fd.district !== undefined) setPpbDistrict(fd.district);
      if (fd.region !== undefined) setPpbRegion(fd.region);
    }

    // P.2 成立地辦事處
    if (fd.offAFlat !== undefined) {
      setOffAFlat(fd.offAFlat); setOffABuilding(fd.offABuilding || ''); setOffAStreet(fd.offAStreet || '');
      setOffADistrictCity(fd.offADistrictCity || ''); setOffACountry(fd.offACountry || '');
      setOffBFlat(fd.offBFlat || ''); setOffBBuilding(fd.offBBuilding || ''); setOffBStreet(fd.offBStreet || '');
      setOffBDistrictCity(fd.offBDistrictCity || ''); setOffBCountry(fd.offBCountry || '');
      setEmailInPlace(fd.emailInPlace || '');
    }

    // P.7 股本／按揭
    if (fd.authCurrency !== undefined) setAuthCurrency(fd.authCurrency);
    if (fd.authNominal !== undefined) setAuthNominal(fd.authNominal);
    if (fd.issuedCurrency !== undefined) setIssuedCurrency(fd.issuedCurrency);
    if (fd.issuedNominal !== undefined) setIssuedNominal(fd.issuedNominal);
    if (fd.mortgageAmount !== undefined) setMortgageAmount(fd.mortgageAmount);

    // P.8 帳目／簽署人
    if (fd.accountsMode) setAccountsMode(fd.accountsMode);
    if (fd.accFrom) setAccFrom(fd.accFrom);
    if (fd.accTo) setAccTo(fd.accTo);
    if (fd.notDeliveredReason) setNotDeliveredReason(fd.notDeliveredReason);
    if (fd.signerName !== undefined) { setSignerName(fd.signerName); signerTouchedRef.current = true; }
    if (fd.signerCapacity !== undefined) { setSignerCapacity(fd.signerCapacity); signerTouchedRef.current = true; }
    if (fd.signerDate !== undefined) { setSignerDate(fd.signerDate); signerDateTouchedRef.current = true; }

    // 提交人（新格式 presenter* 或舊格式 presentor*）
    if (fd.presenterName !== undefined) {
      setPresenterName(fd.presenterName); setPresenterAddress(fd.presenterAddress || '');
      setPresenterPhone(fd.presenterPhone || ''); setPresenterFax(fd.presenterFax || '');
      setPresenterEmail(fd.presenterEmail || ''); setPresenterRef(fd.presenterRef || '');
    } else {
      if (fd.presentorName !== undefined) setPresenterName(fd.presentorName);
      if (fd.presentorAddress !== undefined) setPresenterAddress(fd.presentorAddress);
      if (fd.presentorPhone !== undefined) setPresenterPhone(fd.presentorPhone);
      if (fd.presentorFax !== undefined) setPresenterFax(fd.presentorFax);
      if (fd.presentorEmail !== undefined) setPresenterEmail(fd.presentorEmail);
      if (fd.presentorReference !== undefined) setPresenterRef(fd.presentorReference);
    }

    // 人員數組（新格式直接載入；舊格式 directors/secretary/shareholders 是字串 → 顯式丟棄）
    if (Array.isArray(fd.authRepNats)) setAuthRepNats(fd.authRepNats.map((x: any) => ({ ...emptyAuthRepNat(), ...x })));
    if (Array.isArray(fd.authRepCorps)) setAuthRepCorps(fd.authRepCorps.map((x: any) => ({ ...emptyAuthRepCorp(), ...x })));
    if (Array.isArray(fd.natSecs)) setNatSecs(fd.natSecs.map((x: any) => ({ ...emptyNatSec(), ...x })));
    if (Array.isArray(fd.corpSecs)) setCorpSecs(fd.corpSecs.map((x: any) => ({ ...emptyCorpSec(), ...x })));
    if (Array.isArray(fd.natDirs)) setNatDirs(fd.natDirs.map((x: any) => ({ ...emptyNatDir(), ...x })));
    if (Array.isArray(fd.corpDirs)) setCorpDirs(fd.corpDirs.map((x: any) => ({ ...emptyCorpDir(), ...x })));
  };

  // ── Generate ──
  const handleGenerate = async () => {
    if (!companyNameEnglish) {
      toast({ title: '錯誤', description: '請填寫公司英文名稱', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem('secretary_jwt') || '';
      const joinAddr = (a: string[]) => a.filter(Boolean).join(', ');
      const registrationDate = regDay && regMonth && regYear ? `${regYear}-${pad2(regMonth)}-${pad2(regDay)}` : '';
      const signerDateParts = parseDmy(signerDate);

      const payload = {
        brNumber: brNumber || undefined,
        companyNameEnglish,
        companyNameChinese: companyNameChinese || undefined,
        returnDate: returnDate || undefined,
        registrationDate: registrationDate || undefined,
        placeOfIncorporation: placeOfIncorporation || undefined,
        principalPlaceOfBusiness: {
          flat: ppbFlat, building: ppbBuilding, street: ppbStreet,
          district: ppbDistrict, region: ppbRegion,
        },
        email: email || undefined,
        phone: phone || undefined,
        officeInPlaceOfIncorporation: {
          flat: offAFlat, building: offABuilding, street: offAStreet,
          districtCityProvince: offADistrictCity, country: offACountry,
        },
        principalPlaceInPlaceOfIncorporation: {
          flat: offBFlat, building: offBBuilding, street: offBStreet,
          districtCityProvince: offBDistrictCity, country: offBCountry,
        },
        emailInPlaceOfIncorporation: emailInPlace || undefined,
        presenter: {
          name: presenterName, address: presenterAddress,
          phone: presenterPhone, fax: presenterFax,
          email: presenterEmail, reference: presenterRef,
        },
        authorizedReps: [
          ...authRepNats.map(e => ({
            nameChinese: e.nameChinese,
            nameEnglish: `${e.surname} ${e.otherNames}`.trim(),
            email: e.email,
            identity: 'natural' as const,
            address: joinAddr([e.addrFlat, e.addrBuilding, e.addrStreet, e.addrDistrict, e.addrRegion]),
            idNumber: e.hkidMain ? `${e.hkidMain}(${e.hkidCheck})` : '',
            passportCountry: e.passportCountry, passportNumber: e.passportNumber,
          })),
          ...authRepCorps.map(e => ({
            nameChinese: e.nameChinese, nameEnglish: e.nameEnglish,
            email: e.email,
            identity: 'corporate' as const,
            isLawFirm: e.isLawFirm || false, isCpaFirm: e.isCpaFirm || false,
            address: joinAddr([e.addrFlat, e.addrBuilding, e.addrStreet, e.addrDistrict, e.addrRegion]),
          })),
        ],
        secretaries: [
          ...natSecs.map(e => ({
            nameChinese: e.nameChinese,
            nameEnglish: `${e.surname} ${e.otherNames}`.trim(),
            email: e.email,
            identity: 'natural' as const,
            prevNameChinese: e.prevNameChinese, prevNameEnglish: e.prevNameEnglish,
            aliasChinese: e.aliasChinese, aliasEnglish: e.aliasEnglish,
            address: joinAddr([e.addrFlat, e.addrBuilding, e.addrStreet, e.addrDistrict, e.addrRegion]),
            idNumber: e.hkidMain ? `${e.hkidMain}(${e.hkidCheck})` : '',
            passportCountry: e.passportCountry, passportNumber: e.passportNumber,
          })),
          ...corpSecs.map(e => ({
            nameChinese: e.nameChinese, nameEnglish: e.nameEnglish,
            email: e.email,
            identity: 'corporate' as const,
            brNumber: e.brNumber,
            address: joinAddr([e.addrFlat, e.addrBuilding, e.addrStreet, e.addrDistrict, e.addrRegion]),
          })),
        ],
        directors: [
          ...natDirs.map(e => ({
            nameChinese: e.nameChinese,
            nameEnglish: `${e.surname} ${e.otherNames}`.trim(),
            email: e.email,
            identity: 'natural' as const,
            isAlternate: e.isAlternate || false, alternateTo: e.alternateTo || '',
            prevNameChinese: e.prevNameChinese, prevNameEnglish: e.prevNameEnglish,
            aliasChinese: e.aliasChinese, aliasEnglish: e.aliasEnglish,
            address: joinAddr([e.addrFlat, e.addrBuilding, e.addrStreet, e.addrDistrict, e.addrRegion]),
            idNumber: e.hkidMain ? `${e.hkidMain}(${e.hkidCheck})` : '',
            passportCountry: e.passportCountry, passportNumber: e.passportNumber,
          })),
          ...corpDirs.map(e => ({
            nameChinese: e.nameChinese, nameEnglish: e.nameEnglish,
            email: e.email,
            identity: 'corporate' as const,
            isAlternate: e.isAlternate || false, alternateTo: e.alternateTo || '',
            brNumber: e.brNumber,
            address: joinAddr([e.addrFlat, e.addrBuilding, e.addrStreet, e.addrDistrict, e.addrRegion]),
          })),
        ],
        accounts: accountsMode
          ? (accountsMode === 'delivered'
            ? { mode: 'delivered' as const, periodFrom: accFrom || undefined, periodTo: accTo || undefined }
            : { mode: 'notDelivered' as const, notDeliveredReason: Number(notDeliveredReason) as 1 | 2 })
          : undefined,
        shareCapital: {
          authorizedCurrency: authCurrency, authorizedNominal: authNominal,
          issuedCurrency: issuedCurrency, issuedNominal: issuedNominal,
        },
        mortgageAmount: mortgageAmount || undefined,
        signer: signerName || signerCapacity ? {
          name: signerName || undefined,
          capacity: signerCapacity || undefined,
          date: signerDateParts ? signerDate || undefined : undefined,
        } : undefined,
      };

      const resp = await fetch('/api/generate-nn3-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || `HTTP ${resp.status}`);
      downloadBase64Pdf(result.pdf, result.filename || `NN3_${brNumber || 'form'}.pdf`);
      toast({ title: '生成成功', description: 'NN3 表格已下載' });

      saveFormHistory({
        formType: 'NN3',
        formData: {
          selectedCompanyId,
          companyNameEnglish, companyNameChinese, brNumber,
          returnDate, regDay, regMonth, regYear, placeOfIncorporation,
          ppbFlat, ppbBuilding, ppbStreet, ppbDistrict, ppbRegion,
          email, phone,
          offAFlat, offABuilding, offAStreet, offADistrictCity, offACountry,
          offBFlat, offBBuilding, offBStreet, offBDistrictCity, offBCountry,
          emailInPlace,
          presenterName, presenterAddress, presenterPhone, presenterFax, presenterEmail, presenterRef,
          authRepNats, authRepCorps, natSecs, corpSecs, natDirs, corpDirs,
          accountsMode, accFrom, accTo, notDeliveredReason,
          authCurrency, authNominal, issuedCurrency, issuedNominal, mortgageAmount,
          signerName, signerCapacity, signerDate,
        },
      });
    } catch (err: any) {
      toast({ title: '生成失敗', description: err.message || '無法生成 NN3 表格', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NN3 — 註冊非香港公司周年申報表</h1><p className="text-sm text-muted-foreground">Annual Return of Registered Non-Hong Kong Company</p></div>
      </div>

      <FormHistorySelector formType="NN3" onSelect={handleLoadHistory} />

      {/* ═══ 公司選擇 ═══ */}
      <div className="bg-muted/30 border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">選擇現有公司（自動填充）</h3>
        </div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder="— 選擇公司 —" />
          </SelectTrigger>
          <SelectContent>
            {companies.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}{c.chineseName ? ` (${c.chineseName})` : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ═══ 自動填入公司所有人員開關 ═══ */}
      <label className="flex items-center gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 cursor-pointer select-none mb-4">
        <input
          type="checkbox"
          className="h-4 w-4 accent-blue-600"
          checked={autoFillPeople}
          onChange={e => handleAutoFillToggle(e.target.checked)}
        />
        <span className="text-sm font-medium">自動填入公司所有人員（董事／秘書）</span>
        <span className="text-xs text-muted-foreground">Auto-fill officers — 取消勾選可自行手動填寫</span>
      </label>

      {/* ═══ 本年度變動面板（快照端點載入，只讀）═══ */}
      {autoFillPeople && selectedCompanyId && (
        <div className="mb-4">
          <NAR1YearChangesPanel
            loading={snapshotLoading}
            failed={snapshotFailed}
            period={snapshotPeriod}
            changes={snapshotChanges}
          />
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* ═══ P.1: 公司基本資料 ═══ */}
        <div>
          <h3 className="font-semibold mb-3">1. 公司名稱 Company Name</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>英文名稱 *</Label><Input value={companyNameEnglish} onChange={e => setCompanyNameEnglish(e.target.value)} placeholder="e.g. ABC Limited" className="mt-1" /></div>
            <div><Label>中文名稱</Label><Input value={companyNameChinese} onChange={e => setCompanyNameChinese(e.target.value)} placeholder="e.g. 甲乙丙有限公司" className="mt-1" /></div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-3">2. 本申報表的日期 Date of this Return</h3>
          <p className="text-xs text-muted-foreground mb-3">最近周年日 The Most Recent Anniversary of the Date of Registration（香港註冊日期的周年日）</p>
          <div className="max-w-xs">
            <DatePickerInput label="日期 Date"
              day={returnDate ? returnDate.split('-')[2] : ''}
              month={returnDate ? returnDate.split('-')[1] : ''}
              year={returnDate ? returnDate.split('-')[0] : ''}
              onChange={({ day, month, year }) => {
                if (day && month && year) setReturnDate(`${year}-${month}-${day}`);
                else setReturnDate('');
              }} />
          </div>
          {yearChips.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-xs text-muted-foreground">年度快選：</span>
              {yearChips.map(d => (
                <button key={d} type="button"
                  className={cn('px-2 py-0.5 rounded text-xs border transition-colors',
                    returnDate === d ? 'bg-blue-600 text-white border-blue-600' : 'bg-background border-border hover:bg-accent')}
                  onClick={() => {
                    // 明確切年度 = 重新按該年 as-of 填入
                    suppressSnapshotRef.current = false;
                    setReturnDate(d);
                  }}>
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-3">3. 註冊日期 Date of Registration</h3>
          <p className="text-xs text-muted-foreground mb-3">根據《公司條例》第16部或《前身條例》第XI部的註冊日期（系統無此欄位，請手填）</p>
          <div className="max-w-xs">
            <DatePickerInput label="日期 Date"
              day={regDay} month={regMonth} year={regYear}
              onChange={({ day, month, year }) => {
                setRegDay(day); setRegMonth(month); setRegYear(year);
              }} />
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-3">4. 成立為法團所在地方 Place of Incorporation</h3>
          <div className="max-w-md">
            <Input value={placeOfIncorporation} onChange={e => setPlaceOfIncorporation(e.target.value)} placeholder="e.g. British Virgin Islands / 英屬維爾京群島" className="mt-1" />
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-3">5(a). 香港主要營業地點地址 Address of Principal Place of Business in HK</h3>
          {selectedCompanyId && (
            <div className="mb-3">
              <AddressQuickPick companyId={selectedCompanyId} includeAllCompanies
                onPick={(d) => {
                  if (d.flat) setPpbFlat(d.flat);
                  if (d.building) setPpbBuilding(d.building);
                  if (d.street) setPpbStreet(d.street);
                  if (d.district) setPpbDistrict(d.district);
                  if (d.country || d.region) setPpbRegion(d.country || d.region || '');
                }}
              />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>室／樓／座 Flat／Floor／Block</Label><Input value={ppbFlat} onChange={e => setPpbFlat(e.target.value)} className="mt-1" /></div>
            <div><Label>大廈 Building</Label><Input value={ppbBuilding} onChange={e => setPpbBuilding(e.target.value)} className="mt-1" /></div>
            <div><Label>街道／屋苑／地段 Street／Estate／Lot</Label><Input value={ppbStreet} onChange={e => setPpbStreet(e.target.value)} className="mt-1" /></div>
            <div><Label>區 District</Label><Input value={ppbDistrict} onChange={e => setPpbDistrict(e.target.value)} placeholder="e.g. 旺角 Mong Kok" className="mt-1" /></div>
            <div><Label>國家／地區 Country／Region</Label>
              <Input value={ppbRegion} onChange={e => setPpbRegion(e.target.value)} placeholder="e.g. 香港" className="mt-1" />
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-3">5(b)(c). 聯絡資料 Email & Telephone</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>電郵地址 Email Address</Label><Input value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. info@company.com" className="mt-1" /></div>
            <div><Label>香港聯絡電話號碼 +852</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 12345678" className="mt-1" /></div>
          </div>
        </div>

        <Separator />

        {/* ═══ 提交人 ═══ */}
        <div>
          <h3 className="font-semibold mb-3">提交人資料 Presenter's Reference</h3>
          {selectedCompany && <p className="text-xs text-primary mb-3">已從 {selectedCompany.name} 自動填入，可修改</p>}
          <PresenterSelector companyId={selectedCompanyId}
            currentData={{ name: presenterName, address: presenterAddress, phone: presenterPhone, fax: presenterFax, email: presenterEmail, reference: presenterRef }}
            onSelect={(p: Presenter) => {
              setPresenterName(p.name);
              setPresenterAddress(p.address);
              setPresenterPhone(p.phone);
              setPresenterFax(p.fax);
              setPresenterEmail(p.email);
              setPresenterRef(p.reference);
            }}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>姓名／名稱 Name</Label><Input value={presenterName} onChange={e => setPresenterName(e.target.value)} className="mt-1" /></div>
            <div><Label>地址 Address</Label><Input value={presenterAddress} onChange={e => setPresenterAddress(e.target.value)} className="mt-1" /></div>
            <div><Label>電話 Tel</Label><Input value={presenterPhone} onChange={e => setPresenterPhone(e.target.value)} className="mt-1" /></div>
            <div><Label>傳真 Fax</Label><Input value={presenterFax} onChange={e => setPresenterFax(e.target.value)} className="mt-1" /></div>
            <div><Label>電郵 Email</Label><Input value={presenterEmail} onChange={e => setPresenterEmail(e.target.value)} className="mt-1" /></div>
            <div><Label>檔號 Reference</Label><Input value={presenterRef} onChange={e => setPresenterRef(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ═══ P.2: 成立地方辦事處 ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="font-semibold mb-3">6. 在成立為法團所在地方的辦事處 Office in Place of Incorporation（P.2）</h3>
          <h4 className="text-sm font-medium mb-2">(a) 註冊辦事處地址 Address of Registered Office</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            <Input className="h-8 text-xs" placeholder="室／樓／座 Flat／Floor／Block" value={offAFlat} onChange={e => setOffAFlat(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="大廈 Building" value={offABuilding} onChange={e => setOffABuilding(e.target.value)} />
            <Input className="h-8 text-xs col-span-2" placeholder="街道 Street" value={offAStreet} onChange={e => setOffAStreet(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="區／市／省 District／City／Province" value={offADistrictCity} onChange={e => setOffADistrictCity(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="國家 Country" value={offACountry} onChange={e => setOffACountry(e.target.value)} />
          </div>
          <h4 className="text-sm font-medium mb-2">(b) 主要營業地點地址 Address of Principal Place of Business（如有）</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            <Input className="h-8 text-xs" placeholder="室／樓／座 Flat／Floor／Block" value={offBFlat} onChange={e => setOffBFlat(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="大廈 Building" value={offBBuilding} onChange={e => setOffBBuilding(e.target.value)} />
            <Input className="h-8 text-xs col-span-2" placeholder="街道 Street" value={offBStreet} onChange={e => setOffBStreet(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="區／市／省 District／City／Province" value={offBDistrictCity} onChange={e => setOffBDistrictCity(e.target.value)} />
            <Input className="h-8 text-xs" placeholder="國家 Country" value={offBCountry} onChange={e => setOffBCountry(e.target.value)} />
          </div>
          <h4 className="text-sm font-medium mb-2">(c) 電郵地址 Email Address</h4>
          <div className="max-w-md">
            <Input className="h-8 text-xs" placeholder="e.g. bvi@company.com" value={emailInPlace} onChange={e => setEmailInPlace(e.target.value)} />
          </div>
        </div>

        {/* ═══ P.3: 授權代表 ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">7. 授權代表 Authorized Representatives（P.3）</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addAuthRepCorp}><Plus className="h-4 w-4 mr-1" />新增非自然人</Button>
              <Button variant="outline" size="sm" onClick={addAuthRepNat}><Plus className="h-4 w-4 mr-1" />新增自然人</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">系統沒有授權代表記錄，請手動填寫或從人員庫選擇（首名自然人／非自然人填入 P.3，其餘自動續頁 A）</p>
          {authRepNats.length === 0 && authRepCorps.length === 0 && (
            <p className="text-sm text-muted-foreground mb-3">尚未添加。（如不需要可留空）</p>
          )}
          {authRepNats.map((e, i) => (
            <div key={e.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">自然人 #{i + 1} — {i === 0 ? 'P.3' : `續頁A #${i}`}</span>
                <Button variant="ghost" size="sm" onClick={() => removeAuthRepNat(e.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <PersonQuickPick companyId={selectedCompanyId || undefined} includeAllPersons
                onPick={p => {
                  const hkid = splitHkid(p.idNumber || '');
                  updateAuthRepNat(e.id, {
                    nameChinese: p.nameChinese || '', surname: p.surname || '', otherNames: p.otherNames || '',
                    addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                    addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                    email: p.email || '',
                    hkidMain: hkid.main, hkidCheck: hkid.check,
                    passportCountry: p.passportCountry || '', passportNumber: p.passportNumber || '',
                  });
                }} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
                <Input className="h-8 text-xs" placeholder="中文姓名" value={e.nameChinese} onChange={ev => updateAuthRepNat(e.id, { nameChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={e.surname} onChange={ev => updateAuthRepNat(e.id, { surname: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={e.otherNames} onChange={ev => updateAuthRepNat(e.id, { otherNames: ev.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">地址 Address（4 行）</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="室／樓／座" value={e.addrFlat} onChange={ev => updateAuthRepNat(e.id, { addrFlat: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={e.addrBuilding} onChange={ev => updateAuthRepNat(e.id, { addrBuilding: ev.target.value })} />
                <Input className="h-8 text-xs col-span-2" placeholder="街道／屋苑／地段" value={e.addrStreet} onChange={ev => updateAuthRepNat(e.id, { addrStreet: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="區" value={e.addrDistrict} onChange={ev => updateAuthRepNat(e.id, { addrDistrict: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="國家／地區" value={e.addrRegion} onChange={ev => updateAuthRepNat(e.id, { addrRegion: ev.target.value })} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="電郵 Email" value={e.email} onChange={ev => updateAuthRepNat(e.id, { email: ev.target.value })} />
                <div className="flex items-center gap-0.5">
                  <Input className="h-8 text-xs flex-1 font-mono" placeholder="HKID" value={e.hkidMain} onChange={ev => updateAuthRepNat(e.id, { hkidMain: ev.target.value })} maxLength={8} />
                  <span className="text-xs text-muted-foreground font-mono">(</span>
                  <Input className="h-8 w-8 text-xs text-center font-mono" value={e.hkidCheck} onChange={ev => updateAuthRepNat(e.id, { hkidCheck: ev.target.value.replace(/[^A-Za-z0-9]/g, '') })} maxLength={1} />
                  <span className="text-xs text-muted-foreground font-mono">)</span>
                </div>
                <Input className="h-8 text-xs" placeholder="護照簽發國" value={e.passportCountry} onChange={ev => updateAuthRepNat(e.id, { passportCountry: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="護照號碼" value={e.passportNumber} onChange={ev => updateAuthRepNat(e.id, { passportNumber: ev.target.value })} />
              </div>
            </div>
          ))}
          {authRepCorps.map((e, i) => (
            <div key={e.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">非自然人 #{i + 1} — {i === 0 ? 'P.3' : `續頁A #${i}`}</span>
                <Button variant="ghost" size="sm" onClick={() => removeAuthRepCorp(e.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <PersonQuickPick companyId={selectedCompanyId || undefined} includeAllPersons
                onPick={p => updateAuthRepCorp(e.id, {
                  nameChinese: p.nameChinese || '', nameEnglish: p.nameEnglish || '',
                  addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                  addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                  email: p.email || '',
                })} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <Input className="h-8 text-xs" placeholder="中文名稱" value={e.nameChinese} onChange={ev => updateAuthRepCorp(e.id, { nameChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名稱" value={e.nameEnglish} onChange={ev => updateAuthRepCorp(e.id, { nameEnglish: ev.target.value })} />
              </div>
              <div className="flex items-center gap-4 mt-2">
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={e.isLawFirm} onCheckedChange={v => updateAuthRepCorp(e.id, { isLawFirm: !!v })} />
                  律師行 Firm of Solicitors
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={e.isCpaFirm} onCheckedChange={v => updateAuthRepCorp(e.id, { isCpaFirm: !!v })} />
                  會計師事務所 CPA Firm
                </label>
              </div>
              <p className="text-xs font-medium mt-2">地址 Address（4 行）</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="室／樓／座" value={e.addrFlat} onChange={ev => updateAuthRepCorp(e.id, { addrFlat: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={e.addrBuilding} onChange={ev => updateAuthRepCorp(e.id, { addrBuilding: ev.target.value })} />
                <Input className="h-8 text-xs col-span-2" placeholder="街道／屋苑／地段" value={e.addrStreet} onChange={ev => updateAuthRepCorp(e.id, { addrStreet: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="區" value={e.addrDistrict} onChange={ev => updateAuthRepCorp(e.id, { addrDistrict: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="國家／地區" value={e.addrRegion} onChange={ev => updateAuthRepCorp(e.id, { addrRegion: ev.target.value })} />
              </div>
              <div className="max-w-md mt-2">
                <Input className="h-8 text-xs" placeholder="電郵 Email" value={e.email} onChange={ev => updateAuthRepCorp(e.id, { email: ev.target.value })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.4: 秘書（自然人）═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">8A. 公司秘書（自然人）Company Secretary — Natural Person（P.4）</h3>
            <Button variant="outline" size="sm" onClick={addNatSec}><Plus className="h-4 w-4 mr-1" />新增秘書</Button>
          </div>
          {natSecs.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊「新增秘書」按鈕添加。（如不需要可留空）</p>}
          {natSecs.map((e, i) => (
            <div key={e.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">#{i + 1} — {i === 0 ? 'P.4' : `續頁B #${i}`}</span>
                <Button variant="ghost" size="sm" onClick={() => removeNatSec(e.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <PersonQuickPick companyId={selectedCompanyId || undefined} includeAllPersons
                onPick={p => {
                  const hkid = splitHkid(p.idNumber || '');
                  updateNatSec(e.id, {
                    nameChinese: p.nameChinese || '', surname: p.surname || '', otherNames: p.otherNames || '',
                    prevNameChinese: (p as any).previousNameChinese || '', prevNameEnglish: (p as any).previousNameEnglish || '',
                    aliasChinese: (p as any).aliasChinese || '', aliasEnglish: (p as any).aliasEnglish || '',
                    addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                    addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                    email: p.email || '',
                    hkidMain: hkid.main, hkidCheck: hkid.check,
                    passportCountry: p.passportCountry || '', passportNumber: p.passportNumber || '',
                  });
                }} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
                <Input className="h-8 text-xs" placeholder="中文姓名" value={e.nameChinese} onChange={ev => updateNatSec(e.id, { nameChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={e.surname} onChange={ev => updateNatSec(e.id, { surname: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={e.otherNames} onChange={ev => updateNatSec(e.id, { otherNames: ev.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="前用姓名(中) Previous Name (CN)" value={e.prevNameChinese} onChange={ev => updateNatSec(e.id, { prevNameChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="前用姓名(英) Previous Name (EN)" value={e.prevNameEnglish} onChange={ev => updateNatSec(e.id, { prevNameEnglish: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="別名(中) Alias (CN)" value={e.aliasChinese} onChange={ev => updateNatSec(e.id, { aliasChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="別名(英) Alias (EN)" value={e.aliasEnglish} onChange={ev => updateNatSec(e.id, { aliasEnglish: ev.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">香港地址 Hong Kong Address（5 行）</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="室／樓／座" value={e.addrFlat} onChange={ev => updateNatSec(e.id, { addrFlat: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={e.addrBuilding} onChange={ev => updateNatSec(e.id, { addrBuilding: ev.target.value })} />
                <Input className="h-8 text-xs col-span-2" placeholder="街道／屋苑／地段" value={e.addrStreet} onChange={ev => updateNatSec(e.id, { addrStreet: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="區" value={e.addrDistrict} onChange={ev => updateNatSec(e.id, { addrDistrict: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="國家／地區" value={e.addrRegion} onChange={ev => updateNatSec(e.id, { addrRegion: ev.target.value })} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="電郵 Email" value={e.email} onChange={ev => updateNatSec(e.id, { email: ev.target.value })} />
                <div className="flex items-center gap-0.5">
                  <Input className="h-8 text-xs flex-1 font-mono" placeholder="HKID" value={e.hkidMain} onChange={ev => updateNatSec(e.id, { hkidMain: ev.target.value })} maxLength={8} />
                  <span className="text-xs text-muted-foreground font-mono">(</span>
                  <Input className="h-8 w-8 text-xs text-center font-mono" value={e.hkidCheck} onChange={ev => updateNatSec(e.id, { hkidCheck: ev.target.value.replace(/[^A-Za-z0-9]/g, '') })} maxLength={1} />
                  <span className="text-xs text-muted-foreground font-mono">)</span>
                </div>
                <Input className="h-8 text-xs" placeholder="護照簽發國" value={e.passportCountry} onChange={ev => updateNatSec(e.id, { passportCountry: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="護照號碼" value={e.passportNumber} onChange={ev => updateNatSec(e.id, { passportNumber: ev.target.value })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.4: 秘書（法人）═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">8B. 公司秘書（法人）Company Secretary — Body Corporate（P.4）</h3>
            <Button variant="outline" size="sm" onClick={addCorpSec}><Plus className="h-4 w-4 mr-1" />新增秘書</Button>
          </div>
          {corpSecs.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊按鈕添加。（如不需要可留空）</p>}
          {corpSecs.map((e, i) => (
            <div key={e.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">#{i + 1} — {i === 0 ? 'P.4' : `續頁B #${i}`}</span>
                <Button variant="ghost" size="sm" onClick={() => removeCorpSec(e.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <PersonQuickPick companyId={selectedCompanyId || undefined} includeAllPersons
                onPick={p => updateCorpSec(e.id, {
                  nameChinese: p.nameChinese || '', nameEnglish: p.nameEnglish || '',
                  addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                  addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                  email: p.email || '',
                  brNumber: p.companyNumberRef || '',
                })} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="中文名稱" value={e.nameChinese} onChange={ev => updateCorpSec(e.id, { nameChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名稱" value={e.nameEnglish} onChange={ev => updateCorpSec(e.id, { nameEnglish: ev.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">香港地址 Hong Kong Address（5 行）</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="室／樓／座" value={e.addrFlat} onChange={ev => updateCorpSec(e.id, { addrFlat: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={e.addrBuilding} onChange={ev => updateCorpSec(e.id, { addrBuilding: ev.target.value })} />
                <Input className="h-8 text-xs col-span-2" placeholder="街道／屋苑／地段" value={e.addrStreet} onChange={ev => updateCorpSec(e.id, { addrStreet: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="區" value={e.addrDistrict} onChange={ev => updateCorpSec(e.id, { addrDistrict: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="國家／地區" value={e.addrRegion} onChange={ev => updateCorpSec(e.id, { addrRegion: ev.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="電郵 Email" value={e.email} onChange={ev => updateCorpSec(e.id, { email: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="商業登記號碼 BR Number" value={e.brNumber} onChange={ev => updateCorpSec(e.id, { brNumber: ev.target.value })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.5–6: 董事（自然人）═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">9A. 董事（自然人）Directors — Natural Person（P.5–6）</h3>
            <Button variant="outline" size="sm" onClick={addNatDir}><Plus className="h-4 w-4 mr-1" />新增董事</Button>
          </div>
          {natDirs.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊「新增董事」按鈕添加。</p>}
          {natDirs.map((e, i) => (
            <div key={e.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">#{i + 1} — {i === 0 ? 'P.5' : i === 1 ? 'P.6' : `續頁C #${i - 1}`}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox checked={e.isAlternate} onCheckedChange={v => updateNatDir(e.id, { isAlternate: !!v })} />
                    候補董事 Alternate
                  </label>
                  {e.isAlternate && <Input className="h-7 w-32 text-xs" placeholder="代替 Alternate to" value={e.alternateTo} onChange={ev => updateNatDir(e.id, { alternateTo: ev.target.value })} />}
                  <Button variant="ghost" size="sm" onClick={() => removeNatDir(e.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <PersonQuickPick companyId={selectedCompanyId || undefined} includeAllPersons
                onPick={p => {
                  const hkid = splitHkid(p.idNumber || '');
                  updateNatDir(e.id, {
                    nameChinese: p.nameChinese || '', surname: p.surname || '', otherNames: p.otherNames || '',
                    prevNameChinese: (p as any).previousNameChinese || '', prevNameEnglish: (p as any).previousNameEnglish || '',
                    aliasChinese: (p as any).aliasChinese || '', aliasEnglish: (p as any).aliasEnglish || '',
                    addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                    addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                    email: p.email || '',
                    hkidMain: hkid.main, hkidCheck: hkid.check,
                    passportCountry: p.passportCountry || '', passportNumber: p.passportNumber || '',
                  });
                }} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
                <Input className="h-8 text-xs" placeholder="中文姓名" value={e.nameChinese} onChange={ev => updateNatDir(e.id, { nameChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={e.surname} onChange={ev => updateNatDir(e.id, { surname: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={e.otherNames} onChange={ev => updateNatDir(e.id, { otherNames: ev.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="前用姓名(中) Previous Name (CN)" value={e.prevNameChinese} onChange={ev => updateNatDir(e.id, { prevNameChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="前用姓名(英) Previous Name (EN)" value={e.prevNameEnglish} onChange={ev => updateNatDir(e.id, { prevNameEnglish: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="別名(中) Alias (CN)" value={e.aliasChinese} onChange={ev => updateNatDir(e.id, { aliasChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="別名(英) Alias (EN)" value={e.aliasEnglish} onChange={ev => updateNatDir(e.id, { aliasEnglish: ev.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">通訊地址 Correspondence Address（5 行）</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="室／樓／座" value={e.addrFlat} onChange={ev => updateNatDir(e.id, { addrFlat: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={e.addrBuilding} onChange={ev => updateNatDir(e.id, { addrBuilding: ev.target.value })} />
                <Input className="h-8 text-xs col-span-2" placeholder="街道／屋苑／地段" value={e.addrStreet} onChange={ev => updateNatDir(e.id, { addrStreet: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="區／市／省" value={e.addrDistrict} onChange={ev => updateNatDir(e.id, { addrDistrict: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="國家／地區" value={e.addrRegion} onChange={ev => updateNatDir(e.id, { addrRegion: ev.target.value })} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="電郵 Email" value={e.email} onChange={ev => updateNatDir(e.id, { email: ev.target.value })} />
                <div className="flex items-center gap-0.5">
                  <Input className="h-8 text-xs flex-1 font-mono" placeholder="HKID" value={e.hkidMain} onChange={ev => updateNatDir(e.id, { hkidMain: ev.target.value })} maxLength={8} />
                  <span className="text-xs text-muted-foreground font-mono">(</span>
                  <Input className="h-8 w-8 text-xs text-center font-mono" value={e.hkidCheck} onChange={ev => updateNatDir(e.id, { hkidCheck: ev.target.value.replace(/[^A-Za-z0-9]/g, '') })} maxLength={1} />
                  <span className="text-xs text-muted-foreground font-mono">)</span>
                </div>
                <Input className="h-8 text-xs" placeholder="護照簽發國" value={e.passportCountry} onChange={ev => updateNatDir(e.id, { passportCountry: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="護照號碼" value={e.passportNumber} onChange={ev => updateNatDir(e.id, { passportNumber: ev.target.value })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.7: 董事（法人）═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">9B. 董事（法人）Directors — Body Corporate（P.7）</h3>
            <Button variant="outline" size="sm" onClick={addCorpDir}><Plus className="h-4 w-4 mr-1" />新增法人董事</Button>
          </div>
          {corpDirs.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊按鈕添加。（如不需要可留空）</p>}
          {corpDirs.map((e, i) => (
            <div key={e.id} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">#{i + 1} — {i === 0 ? 'P.7' : `續頁D #${Math.ceil(i / 2)}`}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox checked={e.isAlternate} onCheckedChange={v => updateCorpDir(e.id, { isAlternate: !!v })} />
                    候補董事 Alternate
                  </label>
                  {e.isAlternate && <Input className="h-7 w-32 text-xs" placeholder="代替 Alternate to" value={e.alternateTo} onChange={ev => updateCorpDir(e.id, { alternateTo: ev.target.value })} />}
                  <Button variant="ghost" size="sm" onClick={() => removeCorpDir(e.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <PersonQuickPick companyId={selectedCompanyId || undefined} includeAllPersons
                onPick={p => updateCorpDir(e.id, {
                  nameChinese: p.nameChinese || '', nameEnglish: p.nameEnglish || '',
                  addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                  addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                  email: p.email || '',
                  brNumber: p.companyNumberRef || '',
                })} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="中文名稱" value={e.nameChinese} onChange={ev => updateCorpDir(e.id, { nameChinese: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="英文名稱" value={e.nameEnglish} onChange={ev => updateCorpDir(e.id, { nameEnglish: ev.target.value })} />
              </div>
              <p className="text-xs font-medium mt-2">地址 Address（5 行）</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="室／樓／座" value={e.addrFlat} onChange={ev => updateCorpDir(e.id, { addrFlat: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="大廈" value={e.addrBuilding} onChange={ev => updateCorpDir(e.id, { addrBuilding: ev.target.value })} />
                <Input className="h-8 text-xs col-span-2" placeholder="街道／屋苑／地段" value={e.addrStreet} onChange={ev => updateCorpDir(e.id, { addrStreet: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="區／市／省" value={e.addrDistrict} onChange={ev => updateCorpDir(e.id, { addrDistrict: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="國家／地區" value={e.addrRegion} onChange={ev => updateCorpDir(e.id, { addrRegion: ev.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Input className="h-8 text-xs" placeholder="電郵 Email" value={e.email} onChange={ev => updateCorpDir(e.id, { email: ev.target.value })} />
                <Input className="h-8 text-xs" placeholder="商業登記號碼 BR Number" value={e.brNumber} onChange={ev => updateCorpDir(e.id, { brNumber: ev.target.value })} />
              </div>
            </div>
          ))}
        </div>

        {/* ═══ P.7: 股本 + 按揭 ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="font-semibold mb-3">10–11. 股本及按揭 Share Capital & Mortgages（P.7）</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
            <div><Label>法定股本貨幣 Currency (Authorized)</Label><Input className="mt-1" value={authCurrency} onChange={e => setAuthCurrency(e.target.value)} placeholder="e.g. HKD" /></div>
            <div><Label>法定股本總面值 Total Nominal (Authorized)</Label><Input className="mt-1" value={authNominal} onChange={e => setAuthNominal(e.target.value)} placeholder="e.g. 100,000" /></div>
            <div><Label>已發行股本貨幣 Currency (Issued)</Label><Input className="mt-1" value={issuedCurrency} onChange={e => setIssuedCurrency(e.target.value)} placeholder="e.g. HKD" /></div>
            <div><Label>已發行股本總面值 Total Nominal (Issued)</Label><Input className="mt-1" value={issuedNominal} onChange={e => setIssuedNominal(e.target.value)} placeholder="e.g. 50,000" /></div>
          </div>
          <div className="max-w-md">
            <Label>按揭及押記負債總額 Mortgages and Charges</Label>
            <Input className="mt-1" value={mortgageAmount} onChange={e => setMortgageAmount(e.target.value)} placeholder="e.g. 20,000（如無可留空）" />
          </div>
        </div>

        {/* ═══ P.8: 帳目 + 簽署人 ═══ */}
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="font-semibold mb-3">12. 帳目 Accounts（P.8）</h3>
          <div className="flex gap-4 mb-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="nn3-accounts-mode" checked={accountsMode === 'delivered'}
                onChange={() => setAccountsMode('delivered')} className="h-3.5 w-3.5" />
              <span className="text-xs">A. 已交付帳目 Accounts Delivered</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="nn3-accounts-mode" checked={accountsMode === 'notDelivered'}
                onChange={() => setAccountsMode('notDelivered')} className="h-3.5 w-3.5" />
              <span className="text-xs">B. 帳目未交付 Not Delivered</span>
            </label>
          </div>
          {accountsMode === 'delivered' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 max-w-md">
              <DatePickerInput label="期間由 Period From"
                day={accFrom ? accFrom.split('-')[2] : ''}
                month={accFrom ? accFrom.split('-')[1] : ''}
                year={accFrom ? accFrom.split('-')[0] : ''}
                onChange={({ day, month, year }) => {
                  if (day && month && year) setAccFrom(`${year}-${month}-${day}`);
                  else setAccFrom('');
                }} />
              <DatePickerInput label="期間至 Period To"
                day={accTo ? accTo.split('-')[2] : ''}
                month={accTo ? accTo.split('-')[1] : ''}
                year={accTo ? accTo.split('-')[0] : ''}
                onChange={({ day, month, year }) => {
                  if (day && month && year) setAccTo(`${year}-${month}-${day}`);
                  else setAccTo('');
                }} />
            </div>
          )}
          {accountsMode === 'notDelivered' && (
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="nn3-not-delivered-reason" checked={notDeliveredReason === '1'}
                  onChange={() => setNotDeliveredReason('1')} className="h-3.5 w-3.5" />
                <span className="text-xs">成立為法團所在地方的法域並無要求發表帳目</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="nn3-not-delivered-reason" checked={notDeliveredReason === '2'}
                  onChange={() => setNotDeliveredReason('2')} className="h-3.5 w-3.5" />
                <span className="text-xs">本公司於該財政年度成立為法團不足 18 個月</span>
              </label>
            </div>
          )}

          <Separator className="my-3" />

          <h3 className="font-semibold mb-3">簽署人 Signer（P.8）</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
            <div className="max-w-md"><Label>簽署人姓名 Name of Signer</Label><Input className="mt-1" value={signerName} onChange={e => { setSignerName(e.target.value); signerTouchedRef.current = true; }} placeholder="e.g. Chan Tai Man, David" /></div>
            <div className="max-w-xs">
              <DatePickerInput label="簽署日期 Date of Signing"
                day={signerDate ? signerDate.split('-')[2] : ''}
                month={signerDate ? signerDate.split('-')[1] : ''}
                year={signerDate ? signerDate.split('-')[0] : ''}
                onChange={({ day, month, year }) => {
                  if (day && month && year) { setSignerDate(`${year}-${month}-${day}`); signerDateTouchedRef.current = true; }
                  else { setSignerDate(''); signerDateTouchedRef.current = false; }
                }} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 mb-3">
            {([
              { key: 'director' as const, label: '董事 Director' },
              { key: 'secretary' as const, label: '秘書 Secretary' },
              { key: 'manager' as const, label: '經理 Manager' },
              { key: 'authorizedRep' as const, label: '授權代表 Authorized Rep' },
            ]).map(opt => (
              <label key={opt.key} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="nn3-signer-capacity" checked={signerCapacity === opt.key}
                  onChange={() => { setSignerCapacity(opt.key); signerTouchedRef.current = true; }} className="h-3.5 w-3.5" />
                <span className="text-xs">{opt.label}</span>
              </label>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            續頁計數（只讀，後端重算）：A 授權代表 {continuationCounts.sheetA} 頁 · B 秘書 {continuationCounts.sheetB} 頁 · C 自然人董事 {continuationCounts.sheetC} 頁 · D 法人董事 {continuationCounts.sheetD} 頁
          </p>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN3 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
