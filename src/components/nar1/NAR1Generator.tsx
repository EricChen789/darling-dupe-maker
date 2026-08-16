import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { FileText, Download, Loader2, Plus, Trash2 } from 'lucide-react';
import { Company, Person } from '@/types';
import { toast } from '@/hooks/use-toast';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import FormHistorySelector from '@/components/forms/FormHistorySelector';
import PresenterSelector from '@/components/forms/PresenterSelector';
import { usePresenterList, type Presenter } from '@/hooks/usePresenters';
import AddressQuickPick from '@/components/forms/AddressQuickPick';
import PersonQuickPick from '@/components/forms/PersonQuickPick';

// ── Types ──

interface NAR1GeneratorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

interface DateParts { day: string; month: string; year: string; }

interface NatSecEntry {
  id: string;
  nameChinese: string; surname: string; otherNames: string;
  prevNameChinese: string; prevNameEnglish: string;
  aliasChinese: string; aliasEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
  hkidMain: string; hkidCheck: string; passportCountry: string; passportNumber: string;
  tcspLicense: string; tcspExempt: boolean;
  day: string; month: string; year: string;
}

interface CorpSecEntry {
  id: string;
  nameChinese: string; nameEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
  brNumber: string;
  tcspLicense: string; tcspExempt: boolean;
  day: string; month: string; year: string;
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
  day: string; month: string; year: string;
}

interface CorpDirEntry {
  id: string;
  isAlternate: boolean; alternateTo: string;
  nameChinese: string; nameEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
  brNumber: string;
  day: string; month: string; year: string;
}

interface ReserveDirEntry {
  nameChinese: string; surname: string; otherNames: string;
  prevNameChinese: string; prevNameEnglish: string;
  aliasChinese: string; aliasEnglish: string;
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  email: string;
  hkidMain: string; hkidCheck: string; passportCountry: string; passportNumber: string;
}

interface ShareholderEntry {
  id: string;
  nameChinese: string; nameEnglish: string;
  identity: 'natural' | 'corporate';
  addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string;
  shareClass: string; shares: string; currency: string;
  issuePrice: string; paidUp: string; unpaid: string;
  jointHolder: boolean; remarks: string;
}

interface CompanyRecordEntry {
  id: string;
  records: string; address: string;
}

// ── Helpers ──

let _idCounter = 0;
const uid = () => `nar1_${++_idCounter}`;

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

/**
 * NAR1 有效簽署人：公司設定 signerRoleId（person_company_roles.id，即 Person.id）→
 * 無效或未設時 fallback：第一個秘書 → 第一個董事（與 Companies 列表/後端慣例一致）。
 */
function resolveEffectiveSigner(company: Company): { person?: Person; role: 'director' | 'secretary' | '' } {
  const allIds = [...company.directors.map(d => d.id), ...company.secretaries.map(s => s.id)];
  const explicit = company.signerRoleId || '';
  const effId = (explicit && allIds.includes(explicit))
    ? explicit
    : (company.secretaries[0]?.id || company.directors[0]?.id || '');
  if (!effId) return { role: '' };
  const sec = company.secretaries.find(s => s.id === effId);
  if (sec) return { person: sec, role: 'secretary' };
  const dir = company.directors.find(d => d.id === effId);
  if (dir) return { person: dir, role: 'director' };
  return { role: '' };
}

const computeReturnDate = (incorporationDate?: string): string => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  if (incorporationDate) {
    let d: Date;
    if (incorporationDate.includes('/')) {
      const parts = incorporationDate.split('/');
      d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    } else {
      d = new Date(incorporationDate);
    }
    if (!isNaN(d.getTime())) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      let targetYear = currentYear;
      const candidate = new Date(targetYear, d.getMonth(), d.getDate());
      if (candidate < today) targetYear = currentYear + 1;
      return `${targetYear}-${mm}-${dd}`;
    }
  }
  return today.toISOString().split('T')[0];
};

// ── Factory functions ──

const emptyNatSec = (): NatSecEntry => ({
  id: uid(),
  nameChinese: '', surname: '', otherNames: '',
  prevNameChinese: '', prevNameEnglish: '', aliasChinese: '', aliasEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', hkidMain: '', hkidCheck: '', passportCountry: '', passportNumber: '',
  tcspLicense: '', tcspExempt: false,
  day: '', month: '', year: '',
});

const emptyCorpSec = (): CorpSecEntry => ({
  id: uid(),
  nameChinese: '', nameEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', brNumber: '',
  tcspLicense: '', tcspExempt: false,
  day: '', month: '', year: '',
});

const emptyNatDir = (): NatDirEntry => ({
  id: uid(),
  isAlternate: false, alternateTo: '',
  nameChinese: '', surname: '', otherNames: '',
  prevNameChinese: '', prevNameEnglish: '', aliasChinese: '', aliasEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', hkidMain: '', hkidCheck: '', passportCountry: '', passportNumber: '',
  day: '', month: '', year: '',
});

const emptyCorpDir = (): CorpDirEntry => ({
  id: uid(),
  isAlternate: false, alternateTo: '',
  nameChinese: '', nameEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', brNumber: '',
  day: '', month: '', year: '',
});

const emptyReserveDir = (): ReserveDirEntry => ({
  nameChinese: '', surname: '', otherNames: '',
  prevNameChinese: '', prevNameEnglish: '', aliasChinese: '', aliasEnglish: '',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  email: '', hkidMain: '', hkidCheck: '', passportCountry: '', passportNumber: '',
});

const emptyShareholder = (): ShareholderEntry => ({
  id: uid(),
  nameChinese: '', nameEnglish: '',
  identity: 'natural',
  addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '',
  shareClass: 'Ordinary 普通股', shares: '', currency: 'HKD',
  issuePrice: '', paidUp: '', unpaid: '',
  jointHolder: false, remarks: '',
});

const emptyRecord = (): CompanyRecordEntry => ({
  id: uid(),
  records: '', address: '',
});

// ── DatePickerInput (from NN1) ──

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

export const NAR1Generator = ({ open, onOpenChange, company }: NAR1GeneratorProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  // ── P.1: Company Info ──
  const [returnDate, setReturnDate] = useState('');
  const [companyType, setCompanyType] = useState<'private' | 'public' | 'guarantee'>('private');
  const [businessCode, setBusinessCode] = useState('');
  const [businessNature, setBusinessNature] = useState('');
  const [tradingName, setTradingName] = useState('');
  const [regFlat, setRegFlat] = useState('');
  const [regBuilding, setRegBuilding] = useState('');
  const [regStreet, setRegStreet] = useState('');
  const [regDistrict, setRegDistrict] = useState('');
  const [regRegion, setRegRegion] = useState('');

  // ── P.2: Contact + Share Capital ──
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [mortgageAmount, setMortgageAmount] = useState('');

  // ── P.3: Company Secretary (Natural) ──
  const [natSecs, setNatSecs] = useState<NatSecEntry[]>([]);
  const addNatSec = () => setNatSecs(prev => [...prev, emptyNatSec()]);
  const removeNatSec = (id: string) => setNatSecs(prev => prev.filter(a => a.id !== id));
  const updateNatSec = (id: string, patch: Partial<NatSecEntry>) => setNatSecs(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── P.4: Company Secretary (Body Corporate) ──
  const [corpSecs, setCorpSecs] = useState<CorpSecEntry[]>([]);
  const addCorpSec = () => setCorpSecs(prev => [...prev, emptyCorpSec()]);
  const removeCorpSec = (id: string) => setCorpSecs(prev => prev.filter(a => a.id !== id));
  const updateCorpSec = (id: string, patch: Partial<CorpSecEntry>) => setCorpSecs(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── P.5: Directors (Natural) ──
  const [natDirs, setNatDirs] = useState<NatDirEntry[]>([]);
  const addNatDir = () => setNatDirs(prev => [...prev, emptyNatDir()]);
  const removeNatDir = (id: string) => setNatDirs(prev => prev.filter(a => a.id !== id));
  const updateNatDir = (id: string, patch: Partial<NatDirEntry>) => setNatDirs(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── P.6: Directors (Body Corporate) ──
  const [corpDirs, setCorpDirs] = useState<CorpDirEntry[]>([]);
  const addCorpDir = () => setCorpDirs(prev => [...prev, emptyCorpDir()]);
  const removeCorpDir = (id: string) => setCorpDirs(prev => prev.filter(a => a.id !== id));
  const updateCorpDir = (id: string, patch: Partial<CorpDirEntry>) => setCorpDirs(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── P.7: Reserve Director ──
  const [hasReserveDir, setHasReserveDir] = useState(false);
  const [reserveDir, setReserveDir] = useState<ReserveDirEntry>(emptyReserveDir());

  // ── Schedule 1: Shareholders ──
  const [shareholders, setShareholders] = useState<ShareholderEntry[]>([]);
  const addShareholder = () => setShareholders(prev => [...prev, emptyShareholder()]);
  const removeShareholder = (id: string) => setShareholders(prev => prev.filter(a => a.id !== id));
  const updateShareholder = (id: string, patch: Partial<ShareholderEntry>) => setShareholders(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── P.8: Signer ──
  const [signerRole, setSignerRole] = useState<'director' | 'secretary' | ''>('');
  // ── Company Records (P.15) ──
  const [companyRecords, setCompanyRecords] = useState<CompanyRecordEntry[]>([]);
  const addRecord = () => setCompanyRecords(prev => [...prev, emptyRecord()]);
  const removeRecord = (id: string) => setCompanyRecords(prev => prev.filter(a => a.id !== id));
  const updateRecord = (id: string, patch: Partial<CompanyRecordEntry>) => setCompanyRecords(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  // ── Presenter ──
  const [presenterNameCn, setPresenterNameCn] = useState('');
  const [presenterNameEn, setPresenterNameEn] = useState('');
  const [presenterAddress, setPresenterAddress] = useState('');
  const [presenterPhone, setPresenterPhone] = useState('');
  const [presenterFax, setPresenterFax] = useState('');
  const [presenterEmail, setPresenterEmail] = useState('');
  const [presenterRef, setPresenterRef] = useState('');

  const { mutate: saveFormHistory } = useSaveFormHistory();
  const { data: presenters = [] } = usePresenterList();

  // ── Effective NAR1 signer (explicit signerRoleId → first secretary → first director) ──
  const effectiveSigner = useMemo<{ person?: Person; role: 'director' | 'secretary' | '' }>(
    () => (company ? resolveEffectiveSigner(company) : { person: undefined, role: '' }),
    [company],
  );

  // ── Continuation counts (auto-calculated) ──
  const continuationCounts = useMemo(() => ({
    sheetA: Math.max(0, natSecs.length - 1),      // 1st on P.3, rest on cont A (P.11)
    sheetB: Math.max(0, corpSecs.length - 1),      // 1st on P.4, rest on cont B (P.12)
    sheetC: Math.max(0, natDirs.length - 1),       // 1st on P.5, rest on cont C (P.13)
    sheetD: Math.max(0, Math.ceil(corpDirs.length / 2) - 1), // 2 per P.6, rest on cont D (P.14)
    sched1: Math.max(0, Math.ceil(shareholders.length / 2)), // P.8 填附表一总页数（与 generate-nar1-pdf.ts 一致）
  }), [natSecs.length, corpSecs.length, natDirs.length, corpDirs.length, shareholders.length]);

  // ── Load company data on open ──
  useEffect(() => {
    if (!company || !open) return;
    setReturnDate(computeReturnDate(company.incorporationDate));
    setCompanyType((company.companyType as any) || 'private');
    setBusinessCode(company.businessCode || '');
    setBusinessNature(company.businessNature || '');
    setTradingName(company.tradingName || '');
    setRegFlat(company.regFlat || '');
    setRegBuilding(company.regBuilding || '');
    setRegStreet(company.regStreet || '');
    setRegDistrict(company.regDistrict || '');
    setRegRegion(company.regRegion || '');
    setCompanyEmail(company.email || '');
    setCompanyPhone(company.phone || '');
    setMortgageAmount('');

    // Load secretaries
    const natSecArr: NatSecEntry[] = [];
    const corpSecArr: CorpSecEntry[] = [];
    for (const s of company.secretaries) {
      if (s.identity === 'corporate') {
        corpSecArr.push({
          id: uid(),
          nameChinese: s.nameChinese || '', nameEnglish: s.nameEnglish || '',
          ...splitAddr(s),
          email: s.email || '', brNumber: s.brNumber || s.companyNumberRef || '',
          tcspLicense: s.tcspNumber || '', tcspExempt: false,
          ...(parseDmy(s.dateAppointed) || { day: '', month: '', year: '' }),
        });
      } else {
        const hkid = splitHkid(s.idNumber || '');
        natSecArr.push({
          id: uid(),
          nameChinese: s.nameChinese || '', surname: '', otherNames: s.nameEnglish || '',
          prevNameChinese: s.previousNameChinese || '', prevNameEnglish: s.previousNameEnglish || '',
          aliasChinese: s.aliasChinese || '', aliasEnglish: s.aliasEnglish || '',
          ...splitAddr(s),
          email: s.email || '',
          hkidMain: hkid.main, hkidCheck: hkid.check,
          passportCountry: s.passportCountry || '', passportNumber: s.passportNumber || '',
          tcspLicense: s.tcspNumber || '', tcspExempt: !s.tcspNumber,
          ...(parseDmy(s.dateAppointed) || { day: '', month: '', year: '' }),
        });
      }
    }
    setNatSecs(natSecArr);
    setCorpSecs(corpSecArr);

    // Load directors
    const natDirArr: NatDirEntry[] = [];
    const corpDirArr: CorpDirEntry[] = [];
    for (const d of company.directors) {
      if (d.identity === 'corporate') {
        corpDirArr.push({
          id: uid(), isAlternate: false, alternateTo: '',
          nameChinese: d.nameChinese || '', nameEnglish: d.nameEnglish || '',
          ...splitAddr(d),
          email: d.email || '', brNumber: d.brNumber || d.companyNumberRef || '',
          ...(parseDmy(d.dateAppointed) || { day: '', month: '', year: '' }),
        });
      } else {
        const hkid = splitHkid(d.idNumber || '');
        natDirArr.push({
          id: uid(), isAlternate: !!d.isReserve, alternateTo: '',
          nameChinese: d.nameChinese || '', surname: '', otherNames: d.nameEnglish || '',
          prevNameChinese: d.previousNameChinese || '', prevNameEnglish: d.previousNameEnglish || '',
          aliasChinese: d.aliasChinese || '', aliasEnglish: d.aliasEnglish || '',
          ...splitAddr(d),
          email: d.email || '',
          hkidMain: hkid.main, hkidCheck: hkid.check,
          passportCountry: d.passportCountry || '', passportNumber: d.passportNumber || '',
          ...(parseDmy(d.dateAppointed) || { day: '', month: '', year: '' }),
        });
      }
    }
    setNatDirs(natDirArr);
    setCorpDirs(corpDirArr);

    // Load shareholders (auto-fill from existing share capital data)
    const shArr: ShareholderEntry[] = company.shareholders.map(sh => ({
      id: uid(),
      nameChinese: sh.nameChinese || sh.name || '', nameEnglish: sh.nameEnglish || '',
      identity: sh.identity || 'natural',
      ...splitAddr(sh),
      shareClass: sh.shareType || 'Ordinary 普通股', shares: String(sh.shares || ''),
      currency: sh.currency || 'HKD', issuePrice: sh.issuePrice || '',
      paidUp: sh.paidUp || '', unpaid: sh.unpaid || '',
      jointHolder: false, remarks: '',
    }));
    setShareholders(shArr);

    // Load presenter — auto-pick preferred presenter if already cached
    const preferred = company.preferredPresenterId
      ? presenters.find(p => p.id === company.preferredPresenterId)
      : undefined;
    setPresenterNameCn('');
    setPresenterNameEn(preferred?.name || '');
    setPresenterAddress(preferred?.address || '');
    setPresenterPhone(preferred?.phone || '');
    setPresenterFax(preferred?.fax || '');
    setPresenterEmail(preferred?.email || '');
    setPresenterRef(company.presenterReference || preferred?.reference || '');

    // Signer — auto-pick: explicit signerRoleId → first secretary → first director
    setSignerRole(resolveEffectiveSigner(company).role);

    // Records
    setCompanyRecords([]);

  }, [company, open]);

  // Auto-fill preferred presenter once the presenters list loads (won't clobber user edits)
  useEffect(() => {
    if (!open || !company?.preferredPresenterId) return;
    if (presenterNameEn || presenterNameCn || presenterAddress || presenterPhone || presenterEmail) return;
    const p = presenters.find(x => x.id === company.preferredPresenterId);
    if (!p) return;
    setPresenterNameCn('');
    setPresenterNameEn(p.name || '');
    setPresenterAddress(p.address || '');
    setPresenterPhone(p.phone || '');
    setPresenterFax(p.fax || '');
    setPresenterEmail(p.email || '');
    setPresenterRef(company.presenterReference || p.reference || '');
  }, [open, company, presenters]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load history ──
  const handleLoadHistory = (data: any) => {
    const fd = data.formData || data;
    if (fd.returnDate) setReturnDate(fd.returnDate);
    if (fd.companyType) setCompanyType(fd.companyType);
    if (fd.businessCode) setBusinessCode(fd.businessCode);
    if (fd.businessNature) setBusinessNature(fd.businessNature);
    if (fd.tradingName) setTradingName(fd.tradingName);
    if (fd.regFlat !== undefined) setRegFlat(fd.regFlat);
    if (fd.regBuilding !== undefined) setRegBuilding(fd.regBuilding);
    if (fd.regStreet !== undefined) setRegStreet(fd.regStreet);
    if (fd.regDistrict !== undefined) setRegDistrict(fd.regDistrict);
    if (fd.regRegion !== undefined) setRegRegion(fd.regRegion);
    if (fd.companyEmail !== undefined) setCompanyEmail(fd.companyEmail);
    if (fd.companyPhone !== undefined) setCompanyPhone(fd.companyPhone);
    if (fd.mortgageAmount !== undefined) setMortgageAmount(fd.mortgageAmount);
    if (fd.presenterNameCn !== undefined) setPresenterNameCn(fd.presenterNameCn);
    if (fd.presenterNameEn !== undefined) setPresenterNameEn(fd.presenterNameEn);
    if (fd.presenterAddress !== undefined) setPresenterAddress(fd.presenterAddress);
    if (fd.presenterPhone !== undefined) setPresenterPhone(fd.presenterPhone);
    if (fd.presenterFax !== undefined) setPresenterFax(fd.presenterFax);
    if (fd.presenterEmail !== undefined) setPresenterEmail(fd.presenterEmail);
    if (fd.presenterRef !== undefined) setPresenterRef(fd.presenterRef);
    if (fd.signerRole !== undefined) setSignerRole(fd.signerRole);
    if (fd.hasReserveDir !== undefined) setHasReserveDir(fd.hasReserveDir);
    if (data.reserveDir) setReserveDir(data.reserveDir);
    if (data.natSecs && Array.isArray(data.natSecs)) setNatSecs(data.natSecs);
    if (data.corpSecs && Array.isArray(data.corpSecs)) setCorpSecs(data.corpSecs);
    if (data.natDirs && Array.isArray(data.natDirs)) setNatDirs(data.natDirs);
    if (data.corpDirs && Array.isArray(data.corpDirs)) setCorpDirs(data.corpDirs);
    if (data.shareholders && Array.isArray(data.shareholders)) setShareholders(data.shareholders.map((sh: any) => ({
      ...sh,
      issuePrice: sh.issuePrice || '', paidUp: sh.paidUp || '', unpaid: sh.unpaid || '',
    })));
    if (data.companyRecords && Array.isArray(data.companyRecords)) setCompanyRecords(data.companyRecords);
  };

  // ── Generate ──
  const handleGenerate = async () => {
    if (!company) return;
    setIsGenerating(true);

    try {
      const token = localStorage.getItem("secretary_jwt") || "";

      // Build presenter contact string
      const contactParts: string[] = [];
      if (presenterPhone) contactParts.push(`電話: ${presenterPhone}`);
      if (presenterFax) contactParts.push(`傳真: ${presenterFax}`);
      if (presenterEmail) contactParts.push(`電郵: ${presenterEmail}`);
      if (presenterRef) contactParts.push(`參考編號: ${presenterRef}`);
      const presenterContact = contactParts.join('  ');

      // Map directors to API format
      const allDirectors = [
        ...natDirs.map(d => ({
          nameChinese: d.nameChinese,
          nameEnglish: `${d.surname} ${d.otherNames}`.trim(),
          email: d.email,
          identity: 'natural' as const,
          isAlternate: d.isAlternate || false,
          alternateTo: d.alternateTo || '',
          brNumber: '',
          address: [d.addrFlat, d.addrBuilding, d.addrStreet, d.addrDistrict, d.addrRegion].filter(Boolean).join(', '),
          idNumber: d.hkidMain ? `${d.hkidMain}(${d.hkidCheck})` : '',
          dateAppointed: d.day && d.month && d.year ? `${d.day}/${d.month}/${d.year}` : '',
          placeIncorporated: '',
          companyNumberRef: '',
          passportNumber: d.passportNumber,
          passportCountry: d.passportCountry,
          nationality: d.passportCountry || '',
        })),
        ...corpDirs.map(d => ({
          nameChinese: d.nameChinese,
          nameEnglish: d.nameEnglish,
          email: d.email,
          identity: 'corporate' as const,
          isAlternate: d.isAlternate || false,
          alternateTo: d.alternateTo || '',
          brNumber: d.brNumber,
          address: [d.addrFlat, d.addrBuilding, d.addrStreet, d.addrDistrict, d.addrRegion].filter(Boolean).join(', '),
          idNumber: '',
          dateAppointed: d.day && d.month && d.year ? `${d.day}/${d.month}/${d.year}` : '',
          placeIncorporated: '',
          companyNumberRef: d.brNumber,
          passportNumber: '',
          passportCountry: '',
          nationality: '',
        })),
      ];

      // Map secretaries to API format
      const allSecretaries = [
        ...natSecs.map(s => ({
          nameChinese: s.nameChinese,
          nameEnglish: `${s.surname} ${s.otherNames}`.trim(),
          email: s.email,
          identity: 'natural' as const,
          brNumber: '',
          address: [s.addrFlat, s.addrBuilding, s.addrStreet, s.addrDistrict, s.addrRegion].filter(Boolean).join(', '),
          serviceAddress: '',
          idNumber: s.hkidMain ? `${s.hkidMain}(${s.hkidCheck})` : '',
          dateAppointed: s.day && s.month && s.year ? `${s.day}/${s.month}/${s.year}` : '',
          placeIncorporated: '',
          companyNumberRef: '',
          tcspNumber: s.tcspExempt ? '' : s.tcspLicense,
          passportNumber: s.passportNumber,
          passportCountry: s.passportCountry,
        })),
        ...corpSecs.map(s => ({
          nameChinese: s.nameChinese,
          nameEnglish: s.nameEnglish,
          email: s.email,
          identity: 'corporate' as const,
          brNumber: s.brNumber,
          address: [s.addrFlat, s.addrBuilding, s.addrStreet, s.addrDistrict, s.addrRegion].filter(Boolean).join(', '),
          serviceAddress: '',
          idNumber: '',
          dateAppointed: s.day && s.month && s.year ? `${s.day}/${s.month}/${s.year}` : '',
          placeIncorporated: '',
          companyNumberRef: s.brNumber,
          tcspNumber: s.tcspExempt ? '' : s.tcspLicense,
          passportNumber: '',
          passportCountry: '',
        })),
      ];

      // Map shareholders (with financial fields auto-filled from existing data)
      const allShareholders = shareholders.map(sh => ({
        name: sh.nameEnglish || sh.nameChinese,
        nameEnglish: sh.nameEnglish,
        nameChinese: sh.nameChinese,
        shares: parseInt(sh.shares) || 0,
        identity: sh.identity,
        idNumber: '',
        address: [sh.addrFlat, sh.addrBuilding, sh.addrStreet, sh.addrDistrict, sh.addrRegion].filter(Boolean).join(', '),
        shareType: sh.shareClass,
        currency: sh.currency,
        issuePrice: sh.issuePrice || '',
        paidUp: sh.paidUp || '',
        unpaid: sh.unpaid || '',
      }));

      // Effective signer name: explicit signerRoleId → first secretary → first director
      const effSigner = resolveEffectiveSigner(company);
      const signerName = (effSigner.person ? (effSigner.person.nameEnglish || effSigner.person.nameChinese) : '')
        || (signerRole === 'director'
          ? (natDirs[0] ? `${natDirs[0].surname} ${natDirs[0].otherNames}`.trim() || natDirs[0].nameChinese : presenterNameEn)
          : (natSecs[0] ? `${natSecs[0].surname} ${natSecs[0].otherNames}`.trim() || natSecs[0].nameChinese : corpSecs[0]?.nameEnglish || presenterNameEn));

      const payload = {
        name: company.name,
        chineseName: company.chineseName || '',
        brNumber: company.brNumber,
        tradingName,
        businessNature,
        businessCode,
        companyType,
        registeredOffice: {
          flat: regFlat,
          building: regBuilding,
          street: regStreet,
          district: regDistrict,
          region: regRegion,
          country: regRegion,
        },
        directors: allDirectors,
        secretaries: allSecretaries,
        shareholders: allShareholders,
        returnDate,
        incorporationDate: company.incorporationDate || '',
        companyEmail: companyEmail || company.email || '',
        companyPhone: companyPhone || company.phone || '',
        presenter: {
          name: presenterNameEn || presenterNameCn || '',
          address: presenterAddress,
          contact: presenterContact,
          reference: presenterRef,
          phone: presenterPhone,
          fax: presenterFax,
          email: presenterEmail,
        },
        companyRecords: companyRecords
          .filter(r => r.records.trim() || r.address.trim())
          .map(r => ({ records: r.records, address: r.address })),
        signer: signerRole ? {
          name: signerName,
          role: signerRole,
        } : null,
        mortgageAmount,
        continuationCounts,
      };

      const resp = await fetch('/api/generate-nar1-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const result = await resp.json();
      downloadBase64Pdf(result.pdf, `NAR1_${company.brNumber}_${Date.now()}.pdf`);

      toast({
        title: 'PDF 已生成',
        description: `NAR1 表格已成功生成並下載`,
      });

      saveFormHistory({
        formType: 'NAR1',
        formData: {
          returnDate, companyType, businessCode, businessNature, tradingName,
          regFlat, regBuilding, regStreet, regDistrict, regRegion,
          companyEmail, companyPhone, mortgageAmount,
          presenterNameCn, presenterNameEn, presenterAddress,
          presenterPhone, presenterFax, presenterEmail, presenterRef,
          signerRole, hasReserveDir,
          natSecs, corpSecs, natDirs, corpDirs, shareholders, companyRecords,
          reserveDir: hasReserveDir ? reserveDir : null,
        },
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: '生成失敗',
        description: error instanceof Error ? error.message : '無法生成 PDF，請稍後再試',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (!company) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            生成 NAR1 周年申報表
          </DialogTitle>
          <DialogDescription>
            為「{company.name}」生成 NAR1 周年申報表 PDF
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">

          {/* ═══ Form History ═══ */}
          <FormHistorySelector formType="NAR1" onSelect={handleLoadHistory} />

          {/* ═══ P.1: Company Basic Info ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="font-semibold mb-3">📋 公司基本資料 Company Particulars（P.1）</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <Label className="text-xs">公司名稱 Company Name</Label>
                <Input className="h-8 text-xs mt-1 bg-muted" disabled value={company.name} />
              </div>
              <div>
                <Label className="text-xs">商業登記號碼 BR Number</Label>
                <Input className="h-8 text-xs mt-1 bg-muted" disabled value={company.brNumber} />
              </div>
              <div>
                <Label className="text-xs">商業名稱 Trading Name（如有）</Label>
                <Input className="h-8 text-xs mt-1" value={tradingName} onChange={e => setTradingName(e.target.value)} placeholder="e.g. ABC Trading" />
              </div>
              <div>
                <Label className="text-xs">公司類別 Type of Company</Label>
                <div className="flex gap-4 mt-2">
                  {([
                    { key: 'private' as const, label: '私人公司 Private' },
                    { key: 'public' as const, label: '公眾公司 Public' },
                    { key: 'guarantee' as const, label: '擔保有限公司 Guarantee' },
                  ]).map(opt => (
                    <label key={opt.key} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="nar1-company-type" checked={companyType === opt.key}
                        onChange={() => setCompanyType(opt.key)} className="h-3.5 w-3.5" />
                      <span className="text-xs">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <Label className="text-xs">業務編碼 Business Code</Label>
                <Input className="h-8 text-xs mt-1" value={businessCode} onChange={e => setBusinessCode(e.target.value)} placeholder="e.g. 46900" />
              </div>
              <div>
                <Label className="text-xs">業務性質 Business Nature</Label>
                <Input className="h-8 text-xs mt-1" value={businessNature} onChange={e => setBusinessNature(e.target.value)} placeholder="e.g. General Trading" />
              </div>
            </div>
            <div className="max-w-xs mb-3">
              <DatePickerInput label="申報表結算日期 Date to which this Return is Made Up"
                day={returnDate ? returnDate.split('-')[2] : ''}
                month={returnDate ? returnDate.split('-')[1] : ''}
                year={returnDate ? returnDate.split('-')[0] : ''}
                onChange={({ day, month, year }) => {
                  if (day && month && year) setReturnDate(`${year}-${month}-${day}`);
                }} />
            </div>
            <Separator className="my-3" />
            <h4 className="text-sm font-medium mb-2">在香港的註冊辦事處地址 Registered Office Address in HK</h4>
            <AddressQuickPick companyId={company.id} includeAllCompanies
              onPick={(d) => {
                if (d.flat) setRegFlat(d.flat);
                if (d.building) setRegBuilding(d.building);
                if (d.street) setRegStreet(d.street);
                if (d.district) setRegDistrict(d.district);
                if (d.country || d.region) setRegRegion(d.country || d.region || '');
              }} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
              <Input className="h-8 text-xs" placeholder="室／樓／座 Flat／Floor／Block" value={regFlat} onChange={e => setRegFlat(e.target.value)} />
              <Input className="h-8 text-xs" placeholder="大廈 Building" value={regBuilding} onChange={e => setRegBuilding(e.target.value)} />
              <Input className="h-8 text-xs col-span-2" placeholder="街道／屋苑／地段／村 Street／Estate／Lot／Village" value={regStreet} onChange={e => setRegStreet(e.target.value)} />
              <Input className="h-8 text-xs" placeholder="區 District" value={regDistrict} onChange={e => setRegDistrict(e.target.value)} />
              <Input className="h-8 text-xs" placeholder="地區 Region（e.g. 香港）" value={regRegion} onChange={e => setRegRegion(e.target.value)} />
            </div>
          </div>

          {/* ═══ P.2: Share Capital & Contact ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="font-semibold mb-3">📞 聯絡資料及股本 Share Capital & Contact（P.2）</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <Label className="text-xs">公司電郵 Email Address</Label>
                <Input className="h-8 text-xs mt-1" type="email" value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} placeholder="company@example.com" />
              </div>
              <div>
                <Label className="text-xs">公司電話 Hong Kong Contact Tel. No.</Label>
                <Input className="h-8 text-xs mt-1" value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} placeholder="+852 XXXX XXXX" />
              </div>
            </div>
            <div className="max-w-xs mb-4">
              <Label className="text-xs">按揭及押記總額 Mortgages and Charges</Label>
              <Input className="h-8 text-xs mt-1" value={mortgageAmount} onChange={e => setMortgageAmount(e.target.value)} placeholder="0" />
            </div>
            <Separator className="my-3" />
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">股本摘要 Share Capital Summary（自動計算 + 可手動編輯）</h4>
              <Button variant="ghost" size="sm" onClick={() => addShareholder()}><Plus className="h-3.5 w-3.5 mr-1" />新增股份類別</Button>
            </div>
            {(() => {
              const normalizeShareClass = (raw?: string) => {
                const t = (raw || '').trim();
                if (!t) return 'Ordinary 普通股';
                const upper = t.toUpperCase().replace(/\s+/g, ' ');
                if (upper === 'ORD' || upper === 'ORD0' || upper === 'ORDINARY' || upper.startsWith('ORDINARY ')) {
                  return 'Ordinary 普通股';
                }
                return t;
              };
              const fmtNum = (v: string) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
              // Aggregate by (class, currency, issuePrice) — same as backend
              const map = new Map<string, { className: string; currency: string; issuePrice: number; totalShares: number; totalPaidUp: number; totalUnpaid: number }>();
              for (const sh of shareholders) {
                const className = normalizeShareClass(sh.shareClass);
                const currency = sh.currency?.trim() || 'HKD';
                const ip = fmtNum(sh.issuePrice);
                const key = `${className}||${currency}||${ip}`;
                const existing = map.get(key) || { className, currency, issuePrice: ip, totalShares: 0, totalPaidUp: 0, totalUnpaid: 0 };
                existing.totalShares += parseInt(sh.shares) || 0;
                existing.totalPaidUp += fmtNum(sh.paidUp);
                existing.totalUnpaid += fmtNum(sh.unpaid);
                map.set(key, existing);
              }
              const rows = Array.from(map.values());
              if (rows.length === 0) return <p className="text-xs text-muted-foreground italic">尚無股東資料。請在下方 Schedule 1 添加股東後自動計算。</p>;
              // Grand totals
              const grandTotalShares = rows.reduce((s, r) => s + r.totalShares, 0);
              const grandTotalAmount = rows.reduce((s, r) => s + r.issuePrice * r.totalShares, 0);
              const grandTotalPaidUp = rows.reduce((s, r) => s + r.totalPaidUp, 0);
              const grandTotalUnpaid = rows.reduce((s, r) => s + r.totalUnpaid, 0);
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-1 pr-1">股份類別</th>
                        <th className="py-1 pr-1">貨幣</th>
                        <th className="py-1 pr-1 text-right">總股數</th>
                        <th className="py-1 pr-1 text-right">每股金額</th>
                        <th className="py-1 pr-1 text-right">總款項</th>
                        <th className="py-1 pr-1 text-right">已繳</th>
                        <th className="py-1 pr-1 text-right">未繳</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const totalAmount = r.issuePrice * r.totalShares;
                        return (
                          <tr key={i} className="border-b border-border/40">
                            <td className="py-1 pr-1 font-medium">{r.className}</td>
                            <td className="py-1 pr-1">{r.currency}</td>
                            <td className="py-1 pr-1 text-right">{r.totalShares.toLocaleString()}</td>
                            <td className="py-1 pr-1 text-right">{r.currency} {r.issuePrice.toLocaleString()}</td>
                            <td className="py-1 pr-1 text-right font-medium">{r.currency} {totalAmount.toLocaleString()}</td>
                            <td className="py-1 pr-1 text-right text-green-700">{r.totalPaidUp > 0 ? `${r.currency} ${r.totalPaidUp.toLocaleString()}` : '—'}</td>
                            <td className="py-1 pr-1 text-right text-orange-700">{r.totalUnpaid > 0 ? `${r.currency} ${r.totalUnpaid.toLocaleString()}` : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {rows.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 border-border font-semibold">
                          <td className="py-1 pr-1">合計</td>
                          <td className="py-1 pr-1">{rows[0]?.currency || 'HKD'}</td>
                          <td className="py-1 pr-1 text-right">{grandTotalShares.toLocaleString()}</td>
                          <td className="py-1 pr-1"></td>
                          <td className="py-1 pr-1 text-right">{rows[0]?.currency} {grandTotalAmount.toLocaleString()}</td>
                          <td className="py-1 pr-1 text-right text-green-700">{grandTotalPaidUp > 0 ? `${rows[0]?.currency} ${grandTotalPaidUp.toLocaleString()}` : '—'}</td>
                          <td className="py-1 pr-1 text-right text-orange-700">{grandTotalUnpaid > 0 ? `${rows[0]?.currency} ${grandTotalUnpaid.toLocaleString()}` : '—'}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              );
            })()}
          </div>

          {/* ═══ P.3: Company Secretary (Natural Person) ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">📝 公司秘書（自然人）Company Secretary — Natural Person（P.3）</h3>
              <Button variant="outline" size="sm" onClick={addNatSec}><Plus className="h-4 w-4 mr-1" />新增秘書</Button>
            </div>
            {natSecs.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊「新增秘書」按鈕添加。（如不需要可留空）</p>}
            {natSecs.map((s, i) => (
              <div key={s.id} className="border border-border rounded-lg p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-sm">#{i + 1} — {i === 0 ? 'P.3' : `續頁A (P.11) #${i}`}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeNatSec(s.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                </div>
                <PersonQuickPick companyId={company.id} includeAllPersons
                  onPick={p => {
                    const hkid = splitHkid(p.idNumber || '');
                    updateNatSec(s.id, {
                      nameChinese: p.nameChinese || '', surname: p.surname || '', otherNames: p.otherNames || '',
                      prevNameChinese: (p as any).previousNameChinese || '', prevNameEnglish: (p as any).previousNameEnglish || '',
                      aliasChinese: (p as any).aliasChinese || '', aliasEnglish: (p as any).aliasEnglish || '',
                      addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                      addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                      email: p.email || '',
                      hkidMain: hkid.main, hkidCheck: hkid.check,
                      passportCountry: p.passportCountry || '', passportNumber: p.passportNumber || '',
                      tcspLicense: p.tcspLicense || '', tcspExempt: !p.tcspLicense,
                    });
                  }} />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
                  <Input className="h-8 text-xs" placeholder="中文姓名" value={s.nameChinese} onChange={e => updateNatSec(s.id, { nameChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={s.surname} onChange={e => updateNatSec(s.id, { surname: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={s.otherNames} onChange={e => updateNatSec(s.id, { otherNames: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="前用姓名(中) Previous Name (CN)" value={s.prevNameChinese} onChange={e => updateNatSec(s.id, { prevNameChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="前用姓名(英) Previous Name (EN)" value={s.prevNameEnglish} onChange={e => updateNatSec(s.id, { prevNameEnglish: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="別名(中) Alias (CN)" value={s.aliasChinese} onChange={e => updateNatSec(s.id, { aliasChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="別名(英) Alias (EN)" value={s.aliasEnglish} onChange={e => updateNatSec(s.id, { aliasEnglish: e.target.value })} />
                </div>
                <p className="text-xs font-medium mt-2">香港通訊地址 Hong Kong Correspondence Address</p>
                <AddressQuickPick companyId={company.id} includeAllCompanies
                  onPick={d => updateNatSec(s.id, { addrFlat: d.flat || '', addrBuilding: d.building || '', addrStreet: d.street || '', addrDistrict: d.district || '', addrRegion: d.country || d.region || '' })} />
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mt-2">
                  <Input className="h-8 text-xs" placeholder="室/樓/座" value={s.addrFlat} onChange={e => updateNatSec(s.id, { addrFlat: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="大廈" value={s.addrBuilding} onChange={e => updateNatSec(s.id, { addrBuilding: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="街道" value={s.addrStreet} onChange={e => updateNatSec(s.id, { addrStreet: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="區" value={s.addrDistrict} onChange={e => updateNatSec(s.id, { addrDistrict: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="地區 (e.g. 香港)" value={s.addrRegion} onChange={e => updateNatSec(s.id, { addrRegion: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="電郵 Email" value={s.email} onChange={e => updateNatSec(s.id, { email: e.target.value })} />
                  <div className="flex items-center gap-0.5">
                    <Input className="h-8 text-xs flex-1 font-mono" placeholder="HKID" value={s.hkidMain} onChange={e => updateNatSec(s.id, { hkidMain: e.target.value })} maxLength={8} />
                    <span className="text-xs text-muted-foreground font-mono">(</span>
                    <Input className="h-8 w-8 text-xs text-center font-mono" value={s.hkidCheck} onChange={e => updateNatSec(s.id, { hkidCheck: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} maxLength={1} />
                    <span className="text-xs text-muted-foreground font-mono">)</span>
                  </div>
                  <Input className="h-8 text-xs" placeholder="護照簽發國" value={s.passportCountry} onChange={e => updateNatSec(s.id, { passportCountry: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="護照號碼" value={s.passportNumber} onChange={e => updateNatSec(s.id, { passportNumber: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="TCSP 牌照號碼" value={s.tcspLicense} onChange={e => updateNatSec(s.id, { tcspLicense: e.target.value })} />
                  <label className="flex items-center gap-2 text-xs mt-1.5">
                    <Checkbox checked={s.tcspExempt} onCheckedChange={v => updateNatSec(s.id, { tcspExempt: !!v })} />
                    無須領有牌照
                  </label>
                </div>
                <div className="max-w-xs mt-2">
                  <DatePickerInput label="獲委任日期 Date of Appointment"
                    day={s.day} month={s.month} year={s.year}
                    onChange={({ day, month, year }) => updateNatSec(s.id, { day, month, year })} />
                </div>
              </div>
            ))}
          </div>

          {/* ═══ P.4: Company Secretary (Body Corporate) ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">🏢 公司秘書（法人）Company Secretary — Body Corporate（P.4）</h3>
              <Button variant="outline" size="sm" onClick={addCorpSec}><Plus className="h-4 w-4 mr-1" />新增秘書</Button>
            </div>
            {corpSecs.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊按鈕添加。（如不需要可留空）</p>}
            {corpSecs.map((s, i) => (
              <div key={s.id} className="border border-border rounded-lg p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-sm">#{i + 1} — {i === 0 ? 'P.4' : `續頁B (P.12) #${i}`}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeCorpSec(s.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                </div>
                <PersonQuickPick companyId={company.id} includeAllPersons
                  onPick={p => updateCorpSec(s.id, {
                    nameChinese: p.nameChinese || '', nameEnglish: p.nameEnglish || '',
                    addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                    addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                    brNumber: p.companyNumberRef || '',
                  })} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="中文名稱" value={s.nameChinese} onChange={e => updateCorpSec(s.id, { nameChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="英文名稱" value={s.nameEnglish} onChange={e => updateCorpSec(s.id, { nameEnglish: e.target.value })} />
                </div>
                <p className="text-xs font-medium mt-2">香港地址 Hong Kong Address</p>
                <AddressQuickPick companyId={company.id} includeAllCompanies
                  onPick={d => updateCorpSec(s.id, { addrFlat: d.flat || '', addrBuilding: d.building || '', addrStreet: d.street || '', addrDistrict: d.district || '', addrRegion: d.country || d.region || '' })} />
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mt-2">
                  <Input className="h-8 text-xs" placeholder="室/樓/座" value={s.addrFlat} onChange={e => updateCorpSec(s.id, { addrFlat: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="大廈" value={s.addrBuilding} onChange={e => updateCorpSec(s.id, { addrBuilding: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="街道" value={s.addrStreet} onChange={e => updateCorpSec(s.id, { addrStreet: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="區" value={s.addrDistrict} onChange={e => updateCorpSec(s.id, { addrDistrict: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="地區 (e.g. 香港)" value={s.addrRegion} onChange={e => updateCorpSec(s.id, { addrRegion: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="電郵 Email" value={s.email} onChange={e => updateCorpSec(s.id, { email: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="商業登記號碼 BR Number" value={s.brNumber} onChange={e => updateCorpSec(s.id, { brNumber: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="TCSP 牌照號碼" value={s.tcspLicense} onChange={e => updateCorpSec(s.id, { tcspLicense: e.target.value })} />
                  <label className="flex items-center gap-2 text-xs mt-1.5">
                    <Checkbox checked={s.tcspExempt} onCheckedChange={v => updateCorpSec(s.id, { tcspExempt: !!v })} />
                    無須領有牌照
                  </label>
                </div>
                <div className="max-w-xs mt-2">
                  <DatePickerInput label="獲委任日期 Date of Appointment"
                    day={s.day} month={s.month} year={s.year}
                    onChange={({ day, month, year }) => updateCorpSec(s.id, { day, month, year })} />
                </div>
              </div>
            ))}
          </div>

          {/* ═══ P.5: Directors (Natural Person) ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">👔 董事（自然人）Directors — Natural Person（P.5）</h3>
              <Button variant="outline" size="sm" onClick={addNatDir}><Plus className="h-4 w-4 mr-1" />新增董事</Button>
            </div>
            {natDirs.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊「新增董事」按鈕添加。</p>}
            {natDirs.map((d, i) => (
              <div key={d.id} className="border border-border rounded-lg p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-sm">#{i + 1} — {i === 0 ? 'P.5' : `續頁C (P.13) #${i}`}</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-xs">
                      <Checkbox checked={d.isAlternate} onCheckedChange={v => updateNatDir(d.id, { isAlternate: !!v })} />
                      候補董事 Alternate
                    </label>
                    {d.isAlternate && <Input className="h-7 w-32 text-xs" placeholder="代替 Alternate to" value={d.alternateTo} onChange={e => updateNatDir(d.id, { alternateTo: e.target.value })} />}
                    <Button variant="ghost" size="sm" onClick={() => removeNatDir(d.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <PersonQuickPick companyId={company.id} includeAllPersons
                  onPick={p => {
                    const hkid = splitHkid(p.idNumber || '');
                    updateNatDir(d.id, {
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
                  <Input className="h-8 text-xs" placeholder="中文姓名" value={d.nameChinese} onChange={e => updateNatDir(d.id, { nameChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={d.surname} onChange={e => updateNatDir(d.id, { surname: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={d.otherNames} onChange={e => updateNatDir(d.id, { otherNames: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="前用姓名(中) Previous Name (CN)" value={d.prevNameChinese} onChange={e => updateNatDir(d.id, { prevNameChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="前用姓名(英) Previous Name (EN)" value={d.prevNameEnglish} onChange={e => updateNatDir(d.id, { prevNameEnglish: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="別名(中) Alias (CN)" value={d.aliasChinese} onChange={e => updateNatDir(d.id, { aliasChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="別名(英) Alias (EN)" value={d.aliasEnglish} onChange={e => updateNatDir(d.id, { aliasEnglish: e.target.value })} />
                </div>
                <p className="text-xs font-medium mt-2">通訊地址 Correspondence Address</p>
                <AddressQuickPick companyId={company.id} includeAllCompanies
                  onPick={ad => updateNatDir(d.id, { addrFlat: ad.flat || '', addrBuilding: ad.building || '', addrStreet: ad.street || '', addrDistrict: ad.district || '', addrRegion: ad.country || ad.region || '' })} />
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mt-2">
                  <Input className="h-8 text-xs" placeholder="室/樓/座" value={d.addrFlat} onChange={e => updateNatDir(d.id, { addrFlat: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="大廈" value={d.addrBuilding} onChange={e => updateNatDir(d.id, { addrBuilding: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="街道" value={d.addrStreet} onChange={e => updateNatDir(d.id, { addrStreet: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="區/市/省" value={d.addrDistrict} onChange={e => updateNatDir(d.id, { addrDistrict: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="國家/地區" value={d.addrRegion} onChange={e => updateNatDir(d.id, { addrRegion: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="電郵 Email" value={d.email} onChange={e => updateNatDir(d.id, { email: e.target.value })} />
                  <div className="flex items-center gap-0.5">
                    <Input className="h-8 text-xs flex-1 font-mono" placeholder="HKID" value={d.hkidMain} onChange={e => updateNatDir(d.id, { hkidMain: e.target.value })} maxLength={8} />
                    <span className="text-xs text-muted-foreground font-mono">(</span>
                    <Input className="h-8 w-8 text-xs text-center font-mono" value={d.hkidCheck} onChange={e => updateNatDir(d.id, { hkidCheck: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} maxLength={1} />
                    <span className="text-xs text-muted-foreground font-mono">)</span>
                  </div>
                  <Input className="h-8 text-xs" placeholder="護照簽發國" value={d.passportCountry} onChange={e => updateNatDir(d.id, { passportCountry: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="護照號碼" value={d.passportNumber} onChange={e => updateNatDir(d.id, { passportNumber: e.target.value })} />
                </div>
                <div className="max-w-xs mt-2">
                  <DatePickerInput label="獲委任日期 Date of Appointment"
                    day={d.day} month={d.month} year={d.year}
                    onChange={({ day, month, year }) => updateNatDir(d.id, { day, month, year })} />
                </div>
              </div>
            ))}
          </div>

          {/* ═══ P.6: Directors (Body Corporate) ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">🏢 董事（法人）Directors — Body Corporate（P.6）</h3>
              <Button variant="outline" size="sm" onClick={addCorpDir}><Plus className="h-4 w-4 mr-1" />新增法人董事</Button>
            </div>
            {corpDirs.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊按鈕添加。（如不需要可留空）</p>}
            {corpDirs.map((d, i) => (
              <div key={d.id} className="border border-border rounded-lg p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-sm">#{i + 1} — {i < 2 ? `P.6 (位置 ${i + 1})` : `續頁D (P.14) #${Math.floor(i / 2) + 1}`}</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-xs">
                      <Checkbox checked={d.isAlternate} onCheckedChange={v => updateCorpDir(d.id, { isAlternate: !!v })} />
                      候補董事 Alternate
                    </label>
                    {d.isAlternate && <Input className="h-7 w-32 text-xs" placeholder="代替 Alternate to" value={d.alternateTo} onChange={e => updateCorpDir(d.id, { alternateTo: e.target.value })} />}
                    <Button variant="ghost" size="sm" onClick={() => removeCorpDir(d.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <PersonQuickPick companyId={company.id} includeAllPersons
                  onPick={p => updateCorpDir(d.id, {
                    nameChinese: p.nameChinese || '', nameEnglish: p.nameEnglish || '',
                    addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                    addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                    brNumber: p.companyNumberRef || '',
                  })} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="中文名稱" value={d.nameChinese} onChange={e => updateCorpDir(d.id, { nameChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="英文名稱" value={d.nameEnglish} onChange={e => updateCorpDir(d.id, { nameEnglish: e.target.value })} />
                </div>
                <p className="text-xs font-medium mt-2">地址 Address</p>
                <AddressQuickPick companyId={company.id} includeAllCompanies
                  onPick={ad => updateCorpDir(d.id, { addrFlat: ad.flat || '', addrBuilding: ad.building || '', addrStreet: ad.street || '', addrDistrict: ad.district || '', addrRegion: ad.country || ad.region || '' })} />
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mt-2">
                  <Input className="h-8 text-xs" placeholder="室/樓/座" value={d.addrFlat} onChange={e => updateCorpDir(d.id, { addrFlat: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="大廈" value={d.addrBuilding} onChange={e => updateCorpDir(d.id, { addrBuilding: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="街道" value={d.addrStreet} onChange={e => updateCorpDir(d.id, { addrStreet: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="區/市/省" value={d.addrDistrict} onChange={e => updateCorpDir(d.id, { addrDistrict: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="國家/地區" value={d.addrRegion} onChange={e => updateCorpDir(d.id, { addrRegion: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="電郵 Email" value={d.email} onChange={e => updateCorpDir(d.id, { email: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="商業登記號碼 BR Number" value={d.brNumber} onChange={e => updateCorpDir(d.id, { brNumber: e.target.value })} />
                </div>
                <div className="max-w-xs mt-2">
                  <DatePickerInput label="獲委任日期 Date of Appointment"
                    day={d.day} month={d.month} year={d.year}
                    onChange={({ day, month, year }) => updateCorpDir(d.id, { day, month, year })} />
                </div>
              </div>
            ))}
          </div>

          {/* ═══ P.7: Reserve Director (optional) ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">🔄 備任董事 Reserve Director（P.7）</h3>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={hasReserveDir} onCheckedChange={v => setHasReserveDir(!!v)} />
                啟用此項（僅私人公司唯一董事兼任唯一成員時適用）
              </label>
            </div>
            {hasReserveDir && (
              <div className="border border-border rounded-lg p-4">
                <PersonQuickPick companyId={company.id} includeAllPersons
                  onPick={p => {
                    const hkid = splitHkid(p.idNumber || '');
                    setReserveDir({
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
                  <Input className="h-8 text-xs" placeholder="中文姓名" value={reserveDir.nameChinese} onChange={e => setReserveDir({ ...reserveDir, nameChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={reserveDir.surname} onChange={e => setReserveDir({ ...reserveDir, surname: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={reserveDir.otherNames} onChange={e => setReserveDir({ ...reserveDir, otherNames: e.target.value })} />
                </div>
                <p className="text-xs font-medium mt-2">通訊地址 Correspondence Address</p>
                <AddressQuickPick companyId={company.id} includeAllCompanies
                  onPick={d => setReserveDir(prev => ({ ...prev, addrFlat: d.flat || '', addrBuilding: d.building || '', addrStreet: d.street || '', addrDistrict: d.district || '', addrRegion: d.country || d.region || '' }))} />
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mt-2">
                  <Input className="h-8 text-xs" placeholder="室/樓/座" value={reserveDir.addrFlat} onChange={e => setReserveDir({ ...reserveDir, addrFlat: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="大廈" value={reserveDir.addrBuilding} onChange={e => setReserveDir({ ...reserveDir, addrBuilding: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="街道" value={reserveDir.addrStreet} onChange={e => setReserveDir({ ...reserveDir, addrStreet: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="區/市/省" value={reserveDir.addrDistrict} onChange={e => setReserveDir({ ...reserveDir, addrDistrict: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="國家/地區" value={reserveDir.addrRegion} onChange={e => setReserveDir({ ...reserveDir, addrRegion: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="電郵 Email" value={reserveDir.email} onChange={e => setReserveDir({ ...reserveDir, email: e.target.value })} />
                  <div className="flex items-center gap-0.5">
                    <Input className="h-8 text-xs flex-1 font-mono" placeholder="HKID" value={reserveDir.hkidMain} onChange={e => setReserveDir({ ...reserveDir, hkidMain: e.target.value })} maxLength={8} />
                    <span className="text-xs text-muted-foreground font-mono">(</span>
                    <Input className="h-8 w-8 text-xs text-center font-mono" value={reserveDir.hkidCheck} onChange={e => setReserveDir({ ...reserveDir, hkidCheck: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} maxLength={1} />
                    <span className="text-xs text-muted-foreground font-mono">)</span>
                  </div>
                  <Input className="h-8 text-xs" placeholder="護照簽發國" value={reserveDir.passportCountry} onChange={e => setReserveDir({ ...reserveDir, passportCountry: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="護照號碼" value={reserveDir.passportNumber} onChange={e => setReserveDir({ ...reserveDir, passportNumber: e.target.value })} />
                </div>
              </div>
            )}
          </div>

          {/* ═══ Schedule 1: Shareholders ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">📊 股東成員 Schedule 1 — Members（P.9，非上市公司）</h3>
              <Button variant="outline" size="sm" onClick={addShareholder}><Plus className="h-4 w-4 mr-1" />新增股東</Button>
            </div>
            {shareholders.length === 0 && <p className="text-sm text-muted-foreground mb-3">尚未添加。點擊「新增股東」按鈕添加。</p>}
            {shareholders.map((sh, i) => (
              <div key={sh.id} className="border border-border rounded-lg p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-sm">股東 #{i + 1} — {i < 2 ? `P.9 (位置 ${i + 1})` : `P.${9 + Math.floor(i / 2)} (位置 ${(i % 2) + 1})`}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeShareholder(sh.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                </div>
                <PersonQuickPick companyId={company.id} includeAllPersons
                  onPick={p => updateShareholder(sh.id, {
                    nameChinese: p.nameChinese || '', nameEnglish: p.nameEnglish || p.surname ? `${p.surname} ${p.otherNames}`.trim() : '',
                    identity: p.identity || 'natural',
                    addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '',
                    addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
                    // Auto-fill share financial data when picking an existing shareholder
                    shares: p.shares ? String(p.shares) : sh.shares,
                    shareClass: p.shareType || sh.shareClass,
                    currency: p.currency || sh.currency,
                    issuePrice: p.issuePrice || sh.issuePrice,
                    paidUp: p.paidUp || sh.paidUp,
                    unpaid: p.unpaid || sh.unpaid,
                  })} />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
                  <Input className="h-8 text-xs" placeholder="中文姓名／名稱" value={sh.nameChinese} onChange={e => updateShareholder(sh.id, { nameChinese: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="英文姓名 English Name" value={sh.nameEnglish} onChange={e => updateShareholder(sh.id, { nameEnglish: e.target.value })} />
                  <div>
                    <Label className="text-xs">身份</Label>
                    <div className="flex gap-3 mt-1">
                      <label className="flex items-center gap-1 text-xs">
                        <input type="radio" name={`sh-identity-${sh.id}`} checked={sh.identity === 'natural'}
                          onChange={() => updateShareholder(sh.id, { identity: 'natural' })} className="h-3 w-3" />
                        自然人
                      </label>
                      <label className="flex items-center gap-1 text-xs">
                        <input type="radio" name={`sh-identity-${sh.id}`} checked={sh.identity === 'corporate'}
                          onChange={() => updateShareholder(sh.id, { identity: 'corporate' })} className="h-3 w-3" />
                        法人
                      </label>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="股份類別 Share Class" value={sh.shareClass} onChange={e => updateShareholder(sh.id, { shareClass: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="持有股份數目 No. of Shares" value={sh.shares} onChange={e => updateShareholder(sh.id, { shares: e.target.value.replace(/\D/g, '') })} />
                  <Input className="h-8 text-xs" placeholder="貨幣 Currency" value={sh.currency} onChange={e => updateShareholder(sh.id, { currency: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                  <Input className="h-8 text-xs" placeholder="每股金額 Issue Price per Share" value={sh.issuePrice} onChange={e => updateShareholder(sh.id, { issuePrice: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="已繳金額 Paid-up Amount" value={sh.paidUp} onChange={e => updateShareholder(sh.id, { paidUp: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="未繳金額 Unpaid Amount" value={sh.unpaid} onChange={e => updateShareholder(sh.id, { unpaid: e.target.value })} />
                </div>
                <div className="flex items-center gap-4 mt-2">
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox checked={sh.jointHolder} onCheckedChange={v => updateShareholder(sh.id, { jointHolder: !!v })} />
                    股份是聯名持有 Jointly Held
                  </label>
                  <Input className="h-8 text-xs flex-1" placeholder="備註 Remarks" value={sh.remarks} onChange={e => updateShareholder(sh.id, { remarks: e.target.value })} />
                </div>
                <p className="text-xs font-medium mt-2">地址 Address</p>
                <AddressQuickPick companyId={company.id} includeAllCompanies
                  onPick={d => updateShareholder(sh.id, { addrFlat: d.flat || '', addrBuilding: d.building || '', addrStreet: d.street || '', addrDistrict: d.district || '', addrRegion: d.country || d.region || '' })} />
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mt-2">
                  <Input className="h-8 text-xs" placeholder="室/樓/座" value={sh.addrFlat} onChange={e => updateShareholder(sh.id, { addrFlat: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="大廈" value={sh.addrBuilding} onChange={e => updateShareholder(sh.id, { addrBuilding: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="街道" value={sh.addrStreet} onChange={e => updateShareholder(sh.id, { addrStreet: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="區/市/省" value={sh.addrDistrict} onChange={e => updateShareholder(sh.id, { addrDistrict: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="國家/地區" value={sh.addrRegion} onChange={e => updateShareholder(sh.id, { addrRegion: e.target.value })} />
                </div>
              </div>
            ))}
          </div>

          {/* ═══ P.8: Signing + Presenter ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="font-semibold mb-3">✍️ 簽署 + 提交人 Signing & Presenter（P.8）</h3>

            {/* Signer Toggle */}
            <div className="mb-4">
              <Label className="text-xs font-medium mb-1 block">簽署人 Signatory <span className="text-muted-foreground">（點擊選擇一個身份，其他畫橫線刪去）</span></Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {([
                  { key: 'director' as const, label: '董事 Director' },
                  { key: 'secretary' as const, label: '公司秘書 Company Secretary' },
                ]).map(role => {
                  const isSelected = signerRole === role.key;
                  const isStrikethrough = signerRole && signerRole !== role.key;
                  return (
                    <button key={role.key} type="button"
                      className={`px-3 py-1.5 rounded-md text-xs border transition-all ${
                        isSelected ? 'bg-blue-600 text-white border-blue-600 font-semibold' :
                        isStrikethrough ? 'bg-muted text-muted-foreground border-border line-through' :
                        'bg-background border-border hover:bg-accent'
                      }`}
                      onClick={() => setSignerRole(isSelected ? '' : role.key)}
                    >
                      {role.label}
                    </button>
                  );
                })}
              </div>
              {signerRole && (
                <p className="text-xs text-muted-foreground mt-1">
                  簽署人：
                  {effectiveSigner.person
                    ? (effectiveSigner.person.nameEnglish || effectiveSigner.person.nameChinese)
                    : (signerRole === 'director'
                      ? (natDirs[0] ? `${natDirs[0].surname} ${natDirs[0].otherNames}`.trim() || natDirs[0].nameChinese || corpDirs[0]?.nameEnglish || '（董事）' : '（董事）')
                      : (natSecs[0] ? `${natSecs[0].surname} ${natSecs[0].otherNames}`.trim() || natSecs[0].nameChinese : corpSecs[0]?.nameEnglish || '（秘書）'))
                  }
                </p>
              )}
            </div>

            <Separator className="my-3" />

            {/* Presenter */}
            <h4 className="text-sm font-medium mb-2">👤 提交人資料 Presentor's Reference（P.1 底部 + P.8）</h4>
            <PresenterSelector companyId={company.id}
              currentData={{ nameChinese: presenterNameCn, nameEnglish: presenterNameEn, address: presenterAddress, phone: presenterPhone, fax: presenterFax, email: presenterEmail, reference: presenterRef }}
              onSelect={(p: Presenter) => {
                setPresenterNameCn(p.nameChinese || '');
                setPresenterNameEn(p.nameEnglish || p.name || '');
                setPresenterAddress(p.address || '');
                setPresenterPhone(p.phone || '');
                setPresenterFax(p.fax || '');
                setPresenterEmail(p.email || '');
                setPresenterRef(p.reference || '');
              }} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <Label className="text-xs">中文名稱 Name in Chinese</Label>
                <Input className="h-8 text-xs mt-1" value={presenterNameCn} onChange={e => setPresenterNameCn(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">⚠️ 留空：如無中文姓名，勿填英文名</p>
              </div>
              <div>
                <Label className="text-xs">英文名稱 Name in English</Label>
                <Input className="h-8 text-xs mt-1" value={presenterNameEn} onChange={e => setPresenterNameEn(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">地址 Address</Label>
                <Input className="h-8 text-xs mt-1" value={presenterAddress} onChange={e => setPresenterAddress(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">電話 Tel</Label>
                <Input className="h-8 text-xs mt-1" value={presenterPhone} onChange={e => setPresenterPhone(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">傳真 Fax</Label>
                <Input className="h-8 text-xs mt-1" value={presenterFax} onChange={e => setPresenterFax(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">電郵 Email</Label>
                <Input className="h-8 text-xs mt-1" type="email" value={presenterEmail} onChange={e => setPresenterEmail(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">檔號 Reference</Label>
                <Input className="h-8 text-xs mt-1" value={presenterRef} onChange={e => setPresenterRef(e.target.value)} />
              </div>
            </div>
          </div>

          {/* ═══ P.15: Company Records ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">📁 公司紀錄保存地點 Company Records（附表 E / P.15）</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  如有公司紀錄並非保存於上述註冊辦事處，請列出。留空則不附加 P.15。
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={addRecord}>
                <Plus className="h-4 w-4 mr-1" />新增紀錄
              </Button>
            </div>
            {companyRecords.length === 0 && (
              <p className="text-xs text-muted-foreground italic">尚未新增任何紀錄。</p>
            )}
            {companyRecords.map((r, i) => (
              <div key={r.id} className="border-t border-border/40 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">紀錄 #{i + 1}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeRecord(r.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">公司紀錄 Company Records</Label>
                    <Input className="h-8 text-xs mt-1" placeholder="例如：Register of Members" value={r.records} onChange={e => updateRecord(r.id, { records: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">地址 Address</Label>
                    <Input className="h-8 text-xs mt-1" placeholder="保存該紀錄的完整地址" value={r.address} onChange={e => updateRecord(r.id, { address: e.target.value })} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ═══ Continuation Counts ═══ */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="font-semibold mb-3">📊 續頁計數 Continuation Sheet Counts（自動計算）</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
              <div className="bg-muted/50 rounded p-2 text-center">
                <div className="text-xs text-muted-foreground">A — 秘書（自然人）</div>
                <div className="font-mono font-bold text-lg">{continuationCounts.sheetA}</div>
              </div>
              <div className="bg-muted/50 rounded p-2 text-center">
                <div className="text-xs text-muted-foreground">B — 秘書（法人）</div>
                <div className="font-mono font-bold text-lg">{continuationCounts.sheetB}</div>
              </div>
              <div className="bg-muted/50 rounded p-2 text-center">
                <div className="text-xs text-muted-foreground">C — 董事（自然人）</div>
                <div className="font-mono font-bold text-lg">{continuationCounts.sheetC}</div>
              </div>
              <div className="bg-muted/50 rounded p-2 text-center">
                <div className="text-xs text-muted-foreground">D — 董事（法人）</div>
                <div className="font-mono font-bold text-lg">{continuationCounts.sheetD}</div>
              </div>
              <div className="bg-muted/50 rounded p-2 text-center">
                <div className="text-xs text-muted-foreground">附表一 頁數（總頁數）</div>
                <div className="font-mono font-bold text-lg">{continuationCounts.sched1}</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              以上頁數根據填寫的人員數量自動計算，將填入 P.8 續頁計數表。
            </p>
          </div>

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="bg-primary text-primary-foreground"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                生成並下載 PDF
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NAR1Generator;
