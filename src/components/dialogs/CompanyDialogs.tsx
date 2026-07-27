import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Company, Person, Shareholder } from '@/types';
import { toast } from '@/hooks/use-toast';
import { useCompanies, useBatchAssign } from '@/hooks/useCompanies';
import { useOfficers } from '@/hooks/useOfficers';
import { usePresenterList } from '@/hooks/usePresenters';
import { SearchableMultiSelect, SearchableSelect, type MultiSelectOption } from '@/components/ui/searchable-multiselect';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileText, Loader2, Sparkles, X, Plus, Check, Users, Building2,
  ArrowRightLeft, ChevronDown, ChevronRight,
} from 'lucide-react';

// ── Types ──
type DialogMode = 'create' | 'edit' | 'assign';

interface CompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DialogMode;
  company?: Company | null;
  onSave?: (company: Partial<Company>) => void;
}

type AssignSubMode = 'many-to-one' | 'one-to-many';

interface RoleGroup {
  id: string;       // unique key for React
  role: string;
  people: string[];
}

let _groupCounter = 0;
const nextGroupId = () => `rg_${++_groupCounter}`;

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
type ExtractKind = 'br' | 'ci' | 'other1' | 'other2';

const HK_DISTRICTS = [
  { value: '中西區 Central and Western', label: '中西區 Central and Western' },
  { value: '東區 Eastern', label: '東區 Eastern' },
  { value: '南區 Southern', label: '南區 Southern' },
  { value: '灣仔 Wan Chai', label: '灣仔 Wan Chai' },
  { value: '九龍城 Kowloon City', label: '九龍城 Kowloon City' },
  { value: '觀塘 Kwun Tong', label: '觀塘 Kwun Tong' },
  { value: '深水埗 Sham Shui Po', label: '深水埗 Sham Shui Po' },
  { value: '黃大仙 Wong Tai Sin', label: '黃大仙 Wong Tai Sin' },
  { value: '油尖旺 Yau Tsim Mong', label: '油尖旺 Yau Tsim Mong' },
  { value: '離島 Islands', label: '離島 Islands' },
  { value: '葵青 Kwai Tsing', label: '葵青 Kwai Tsing' },
  { value: '北區 North', label: '北區 North' },
  { value: '西貢 Sai Kung', label: '西貢 Sai Kung' },
  { value: '沙田 Sha Tin', label: '沙田 Sha Tin' },
  { value: '大埔 Tai Po', label: '大埔 Tai Po' },
  { value: '荃灣 Tsuen Wan', label: '荃灣 Tsuen Wan' },
  { value: '屯門 Tuen Mun', label: '屯門 Tuen Mun' },
  { value: '元朗 Yuen Long', label: '元朗 Yuen Long' },
];

const ROLE_OPTIONS = [
  { value: 'director', label: '董事' },
  { value: 'reserve_director', label: '候補董事' },
  { value: 'secretary', label: '秘書' },
  { value: 'shareholder', label: '股東' },
  { value: 'authorized_representative', label: '授權代表' },
];

const mergeArr = <T extends Record<string, any>>(existing: T[], incoming: any[] = [], keyFn: (x: any) => string): T[] => {
  const map = new Map<string, T>();
  for (const e of existing) map.set(keyFn(e).toLowerCase().trim(), e);
  for (const i of incoming) {
    const k = keyFn(i).toLowerCase().trim();
    if (!k) continue;
    if (!map.has(k)) map.set(k, i as T);
  }
  return Array.from(map.values());
};

// ── Component ──
export const CompanyDialog = ({ open, onOpenChange, mode, company, onSave }: CompanyDialogProps) => {
  const isAssignMode = mode === 'assign';
  const isEditMode = mode === 'edit';

  // ── Company form state (create/edit only) ──
  const { data: presenters = [] } = usePresenterList();
  const defaultPresenterId = presenters.find(p => p.name === 'Twinsail Consultants Limited')?.id || '';
  const [formData, setFormData] = useState({
    name: '', chineseName: '', brNumber: '', tradingName: '', businessNature: '',
    companyType: '私人公司 Private company', businessCode: '', incorporationDate: '',
    jurisdiction: 'Hong Kong', regFlat: '', regBuilding: '', regStreet: '',
    regDistrict: '', regRegion: '', preferredPresenterId: '',
    presenterReference: '',
  });
  const [directors, setDirectors] = useState<Partial<Person>[]>([]);
  const [secretaries, setSecretaries] = useState<Partial<Person>[]>([]);
  const [shareholders, setShareholders] = useState<Partial<Shareholder>[]>([]);

  const [extracting, setExtracting] = useState<Record<ExtractKind, boolean>>({
    br: false, ci: false, other1: false, other2: false,
  });
  const [fileNames, setFileNames] = useState<Record<ExtractKind, string>>({
    br: '', ci: '', other1: '', other2: '',
  });
  const refs: Record<ExtractKind, React.RefObject<HTMLInputElement>> = {
    br: useRef<HTMLInputElement>(null), ci: useRef<HTMLInputElement>(null),
    other1: useRef<HTMLInputElement>(null), other2: useRef<HTMLInputElement>(null),
  };

  // ── People association state (shared) ──
  const { officers = [], refetch: refetchOfficers } = useOfficers();
  const { data: companies = [], refetch: refetchCompanies } = useCompanies();
  const queryClient = useQueryClient();
  const batchAssign = useBatchAssign();

  // Collapsible people section (create/edit mode) — 多角色组
  const [showPeopleSection, setShowPeopleSection] = useState(false);
  const [assocGroups, setAssocGroups] = useState<RoleGroup[]>([{ id: nextGroupId(), role: 'director', people: [] }]);

  // Inline create person — 完整欄位
  interface NewPersonData {
    nameEn: string; nameZh: string; identity: 'natural' | 'corporate';
    email: string; phone: string; idNumber: string;
    address: string; serviceAddress: string; dateOfBirth: string;
  }
  const defaultNewPerson = (): NewPersonData => ({
    nameEn: '', nameZh: '', identity: 'natural',
    email: '', phone: '', idNumber: '',
    address: '', serviceAddress: '', dateOfBirth: '',
  });
  const [showNewPersonInline, setShowNewPersonInline] = useState(false);
  const [newPerson, setNewPerson] = useState<NewPersonData>(defaultNewPerson());
  const updateNewPerson = (patch: Partial<NewPersonData>) => setNewPerson(prev => ({ ...prev, ...patch }));
  const [creatingPerson, setCreatingPerson] = useState(false);

  // ── Create sub-mode (新增公司对话框顶部的模式切换) ──
  type CreateSubMode = 'one-company-many-people' | 'one-person-many-companies';
  const [createSubMode, setCreateSubMode] = useState<CreateSubMode>('one-company-many-people');

  // 一公司多人：每行一个人员（含完整信息栏）
  interface PersonRow {
    key: string; personId: string; role: string; expanded: boolean;
    nameEnglish: string; nameChinese: string; identity: 'natural' | 'corporate';
    idNumber: string; email: string; address: string; serviceAddress: string;
    dateAppointed: string; dateCeased: string; dateOfBirth: string;
    tcspNumber: string; placeIncorporated: string; companyNumberRef: string;
  }
  const emptyPersonRow = (): PersonRow => ({
    key: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    personId: '', role: 'director', expanded: false,
    nameEnglish: '', nameChinese: '', identity: 'natural',
    idNumber: '', email: '', address: '', serviceAddress: '',
    dateAppointed: '', dateCeased: '', dateOfBirth: '',
    tcspNumber: '', placeIncorporated: '', companyNumberRef: '',
  });
  const [personRows, setPersonRows] = useState<PersonRow[]>([emptyPersonRow()]);

  // 一人多公司：每行一家公司
  interface CompanyRow { key: string; companyId: string; role: string; }
  const [companyRows, setCompanyRows] = useState<CompanyRow[]>([
    { key: 'cr_1', companyId: '', role: 'director' },
  ]);

  // 一人多公司：人员信息（含完整字段）
  const [onePersonNameEn, setOnePersonNameEn] = useState('');
  const [onePersonNameZh, setOnePersonNameZh] = useState('');
  const [onePersonIdentity, setOnePersonIdentity] = useState<'natural' | 'corporate'>('natural');
  const [onePersonIdNumber, setOnePersonIdNumber] = useState('');
  const [onePersonEmail, setOnePersonEmail] = useState('');
  const [onePersonPhone, setOnePersonPhone] = useState('');
  const [onePersonAddress, setOnePersonAddress] = useState('');
  const [onePersonServiceAddress, setOnePersonServiceAddress] = useState('');
  const [onePersonDateOfBirth, setOnePersonDateOfBirth] = useState('');

  // Batch assign mode state (assign mode only)
  const [assignSubMode, setAssignSubMode] = useState<AssignSubMode>('many-to-one');
  const [assignGroups, setAssignGroups] = useState<RoleGroup[]>([{ id: nextGroupId(), role: 'director', people: [] }]);
  const [assignSelectedCompanies, setAssignSelectedCompanies] = useState<string[]>([]);
  const [assignSelectedCompany, setAssignSelectedCompany] = useState<string>('');
  const [assignSelectedPerson, setAssignSelectedPerson] = useState<string>('');
  const [assignRole, setAssignRole] = useState<string>('director');  // for one-to-many mode only
  const [companyRoles, setCompanyRoles] = useState<Record<string, string>>({}); // per-company role overrides
  const [quickMode, setQuickMode] = useState(false);
  const [quickModeRole, setQuickModeRole] = useState('director');

  // Inline create company — 完整欄位
  interface NewCompanyData {
    name: string; nameZh: string; brNumber: string;
    email: string; phone: string;
    regFlat: string; regBuilding: string; regStreet: string; regDistrict: string; regRegion: string;
    companyType: string; jurisdiction: string;
  }
  const defaultNewCompany = (): NewCompanyData => ({
    name: '', nameZh: '', brNumber: '',
    email: '', phone: '',
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '',
    companyType: '私人公司 Private company', jurisdiction: 'Hong Kong',
  });
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [newCompany, setNewCompany] = useState<NewCompanyData>(defaultNewCompany());
  const updateNewCompany = (patch: Partial<NewCompanyData>) => setNewCompany(prev => ({ ...prev, ...patch }));
  const [creating, setCreating] = useState(false);

  // ── Pending items (deferred creation) ──
  interface PendingPerson extends NewPersonData { tempId: string }
  interface PendingCompany extends NewCompanyData { tempId: string }

  const [pendingPeople, setPendingPeople] = useState<PendingPerson[]>([]);
  const [pendingCompanies, setPendingCompanies] = useState<PendingCompany[]>([]);

  const addPendingPerson = (onDone?: (tempId: string) => void) => {
    if (!newPerson.nameEn.trim()) { toast({ title: '請填寫英文姓名', variant: 'destructive' }); return; }
    const tempId = `pending_p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setPendingPeople(prev => [...prev, { ...newPerson, tempId }]);
    setNewPerson(defaultNewPerson());
    setShowNewPersonInline(false);
    toast({ title: '已添加到列表', description: `${newPerson.nameEn.trim()}（待建立）` });
    onDone?.(tempId);
  };

  const addPendingCompany = (onDone?: (tempId: string) => void) => {
    if (!newCompany.name.trim() || !newCompany.brNumber.trim()) {
      toast({ title: '請填寫公司名稱和商業登記號碼', variant: 'destructive' }); return;
    }
    const tempId = `pending_c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setPendingCompanies(prev => [...prev, { ...newCompany, tempId }]);
    setNewCompany(defaultNewCompany());
    setShowNewCompany(false);
    toast({ title: '已添加到列表', description: `${newCompany.name.trim()}（待建立）` });
    onDone?.(tempId);
  };

  const removePendingPerson = (tempId: string) => {
    setPendingPeople(prev => prev.filter(p => p.tempId !== tempId));
    // Also remove from assignGroups
    setAssignGroups(prev => prev.map(g => ({ ...g, people: g.people.filter(id => id !== tempId) })));
    if (assignSelectedPerson === tempId) setAssignSelectedPerson('');
  };

  const removePendingCompany = (tempId: string) => {
    setPendingCompanies(prev => prev.filter(c => c.tempId !== tempId));
    if (assignSelectedCompany === tempId) setAssignSelectedCompany('');
    setAssignSelectedCompanies(prev => prev.filter(id => id !== tempId));
  };

  // ── Options ──
  const personOptions: MultiSelectOption[] = useMemo(
    () => {
      const existing = officers.map(p => ({
        id: p.id,
        label: p.nameEnglish || p.nameChinese || '(無名稱)',
        sub: p.nameChinese && p.nameEnglish ? p.nameChinese : p.email || undefined,
        meta: p.role === 'director' ? '董事' : p.role === 'secretary' ? '秘書' : p.role === 'shareholder' ? '股東' : undefined,
      }));
      const pending: MultiSelectOption[] = pendingPeople.map(p => ({
        id: p.tempId,
        label: `🆕 ${p.nameEn}`,
        sub: p.nameZh || p.email || p.phone || undefined,
        meta: '待建立',
      }));
      return [...existing, ...pending];
    },
    [officers, pendingPeople]
  );

  const companyOptions: MultiSelectOption[] = useMemo(
    () => {
      const existing = companies.map(c => ({
        id: c.id,
        label: c.name,
        sub: c.brNumber ? `BR ${c.brNumber}` : undefined,
        meta: c.jurisdiction && c.jurisdiction !== 'Hong Kong' ? c.jurisdiction : undefined,
      }));
      const pending: MultiSelectOption[] = pendingCompanies.map(c => ({
        id: c.tempId,
        label: `🆕 ${c.name}`,
        sub: c.brNumber ? `BR ${c.brNumber}` : undefined,
        meta: '待建立',
      }));
      return [...existing, ...pending];
    },
    [companies, pendingCompanies]
  );

  // ── Reset ──
  useEffect(() => {
    if (open) {
      if (!isAssignMode) {
        setFormData({
          name: company?.name || '', chineseName: company?.chineseName || '',
          brNumber: company?.brNumber || '', tradingName: company?.tradingName || '',
          businessNature: company?.businessNature || '',
          companyType: company?.companyType || '私人公司 Private company',
          businessCode: company?.businessCode || '',
          incorporationDate: company?.incorporationDate || '',
          jurisdiction: company?.jurisdiction || 'Hong Kong',
          regFlat: company?.regFlat || '', regBuilding: company?.regBuilding || '',
          regStreet: company?.regStreet || '', regDistrict: company?.regDistrict || '',
          regRegion: company?.regRegion || '',
          preferredPresenterId: company?.preferredPresenterId || (company ? '' : defaultPresenterId),
          presenterReference: company?.presenterReference || '',
        });
        setDirectors([]); setSecretaries([]); setShareholders([]);
        setFileNames({ br: '', ci: '', other1: '', other2: '' });
      }
      // Reset people association
      setShowPeopleSection(false);
      setAssocGroups([{ id: nextGroupId(), role: 'director', people: [] }]);
      setShowNewPersonInline(false);
      setNewPerson(defaultNewPerson());
      // Reset create sub-mode & person/company rows
      setCreateSubMode('one-company-many-people');
      setPersonRows([emptyPersonRow()]);
      setCompanyRows([{ key: 'cr_1', companyId: '', role: 'director' }]);
      setOnePersonNameEn(''); setOnePersonNameZh('');
      setOnePersonIdentity('natural');
      setOnePersonIdNumber(''); setOnePersonEmail(''); setOnePersonPhone('');
      setOnePersonAddress(''); setOnePersonServiceAddress('');
      setOnePersonDateOfBirth('');
      // Reset assign mode
      setAssignSubMode('many-to-one');
      setAssignGroups([{ id: nextGroupId(), role: 'director', people: [] }]);
      setAssignSelectedCompanies([]);
      setAssignSelectedCompany(''); setAssignSelectedPerson('');
      setAssignRole('director');
      setCompanyRoles({});
      setQuickMode(false);
      setQuickModeRole('director');
      setShowNewCompany(false);
      setNewCompany(defaultNewCompany());
      // Reset pending items
      setPendingPeople([]);
      setPendingCompanies([]);
    }
  }, [open, company, isAssignMode]);

  // ── Role group helpers ──
  const updateGroupRole = (setter: React.Dispatch<React.SetStateAction<RoleGroup[]>>, groupId: string, role: string) => {
    setter(prev => prev.map(g => g.id === groupId ? { ...g, role } : g));
  };
  const updateGroupPeople = (setter: React.Dispatch<React.SetStateAction<RoleGroup[]>>, groupId: string, people: string[]) => {
    setter(prev => prev.map(g => g.id === groupId ? { ...g, people } : g));
  };
  const addGroup = (setter: React.Dispatch<React.SetStateAction<RoleGroup[]>>) => {
    setter(prev => [...prev, { id: nextGroupId(), role: 'director', people: [] }]);
  };
  const removeGroup = (setter: React.Dispatch<React.SetStateAction<RoleGroup[]>>, groupId: string) => {
    setter(prev => prev.length <= 1 ? prev : prev.filter(g => g.id !== groupId));
  };
  const flatGroups = (groups: RoleGroup[]) =>
    groups.flatMap(g => g.people.map(pid => ({ personId: pid, role: g.role })));

  // ── Person/Company row helpers (create sub-mode) ──
  const addPersonRow = () => setPersonRows(prev => [...prev, emptyPersonRow()]);
  const removePersonRow = (key: string) =>
    setPersonRows(prev => prev.length <= 1 ? prev : prev.filter(r => r.key !== key));
  const updatePersonRow = (key: string, patch: Partial<PersonRow>) =>
    setPersonRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  const togglePersonRowExpand = (key: string) =>
    setPersonRows(prev => prev.map(r => r.key === key ? { ...r, expanded: !r.expanded } : r));
  // Auto-fill row from selected existing person
  const selectPersonForRow = (key: string, personId: string) => {
    const officer = officers.find(o => o.id === personId);
    if (officer) {
      setPersonRows(prev => prev.map(r => r.key === key ? {
        ...r, personId,
        nameEnglish: officer.nameEnglish || '',
        nameChinese: officer.nameChinese || '',
        identity: officer.identity || 'natural',
        idNumber: officer.idNumber || '',
        email: officer.email || '',
        address: officer.address || '',
        serviceAddress: officer.serviceAddress || '',
        tcspNumber: officer.tcspNumber || '',
        placeIncorporated: officer.placeIncorporated || '',
        companyNumberRef: officer.companyNumberRef || '',
      } : r));
    } else {
      updatePersonRow(key, { personId });
    }
  };

  const addCompanyRow = () => setCompanyRows(prev => [...prev, {
    key: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    companyId: '', role: 'director',
  }]);
  const removeCompanyRow = (key: string) =>
    setCompanyRows(prev => prev.length <= 1 ? prev : prev.filter(r => r.key !== key));
  const updateCompanyRow = (key: string, field: 'companyId' | 'role', value: string) =>
    setCompanyRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r));

  // ── AI Extract ──
  const extract = async (file: File, kind: ExtractKind) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ title: '不支援的檔案格式', description: '請上傳 PDF 或圖片檔案（PNG、JPG）', variant: 'destructive' });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: '檔案太大', description: '檔案大小不能超過 20MB', variant: 'destructive' });
      return;
    }
    const fnName = kind === 'br' ? 'extract-br-info' : kind === 'ci' ? 'extract-ci-info' : 'extract-resolution-info';
    setExtracting(p => ({ ...p, [kind]: true }));
    setFileNames(p => ({ ...p, [kind]: file.name }));
    try {
      const body = new FormData(); body.append('file', file);
      const token = localStorage.getItem("secretary_jwt") || "";
      const resp = await fetch(`/api/${fnName}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'AI 辨識失敗');
      const data = result.data || {};
      setFormData(prev => ({
        ...prev,
        name: prev.name || data.companyName || '',
        chineseName: prev.chineseName || data.chineseName || '',
        brNumber: prev.brNumber || data.brNumber || '',
        tradingName: prev.tradingName || data.tradingName || '',
        businessNature: prev.businessNature || data.businessNature || '',
        businessCode: prev.businessCode || data.businessCode || '',
        companyType: data.companyType || prev.companyType,
        incorporationDate: prev.incorporationDate || data.incorporationDate || '',
        jurisdiction: data.jurisdiction || prev.jurisdiction,
        regFlat: prev.regFlat || data.regFlat || '',
        regBuilding: prev.regBuilding || data.regBuilding || '',
        regStreet: prev.regStreet || data.regStreet || '',
        regDistrict: prev.regDistrict || data.regDistrict || '',
        regRegion: data.regRegion || prev.regRegion,
      }));
      if (Array.isArray(data.directors) && data.directors.length)
        setDirectors(prev => mergeArr(prev, data.directors, x => `${x.nameEnglish || ''}|${x.nameChinese || ''}`));
      if (Array.isArray(data.secretaries) && data.secretaries.length)
        setSecretaries(prev => mergeArr(prev, data.secretaries, x => `${x.nameEnglish || ''}|${x.nameChinese || ''}`));
      if (Array.isArray(data.shareholders) && data.shareholders.length)
        setShareholders(prev => mergeArr(prev, data.shareholders, x => `${x.nameEnglish || ''}|${x.nameChinese || ''}|${x.idNumber || ''}`));
      const extractedCounts = [
        Array.isArray(data.directors) && data.directors.length ? `董事 ${data.directors.length}` : '',
        Array.isArray(data.secretaries) && data.secretaries.length ? `秘書 ${data.secretaries.length}` : '',
        Array.isArray(data.shareholders) && data.shareholders.length ? `股東 ${data.shareholders.length}` : '',
      ].filter(Boolean).join('、');
      toast({ title: 'AI 辨識完成', description: kind === 'br' ? '已填入商業登記證資料。' : kind === 'ci' ? '已填入公司註冊證書資料。' : `已從文件提取資料${extractedCounts ? `（${extractedCounts}）` : ''}，請檢查並確認。` });
    } catch (err: any) {
      console.error(`${kind} extraction error:`, err);
      toast({ title: 'AI 辨識失敗', description: err.message || '請重試或手動輸入資料', variant: 'destructive' });
    } finally {
      setExtracting(p => ({ ...p, [kind]: false }));
      const ref = refs[kind];
      if (ref.current) ref.current.value = '';
    }
  };

  // ── Inline create person (shared) ──
  const handleCreatePerson = async (onDone?: (newId: string) => void) => {
    if (!newPerson.nameEn.trim()) { toast({ title: '請填寫英文姓名', variant: 'destructive' }); return; }
    if (!newPerson.idNumber.trim()) { toast({ title: '請填寫香港身份證號碼', variant: 'destructive' }); return; }
    if (!newPerson.dateOfBirth.trim()) { toast({ title: '請填寫出生日期', variant: 'destructive' }); return; }
    if (!newPerson.address.trim()) { toast({ title: '請填寫居住地址', variant: 'destructive' }); return; }
    setCreatingPerson(true);
    try {
      const normKey = newPerson.nameEn.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const payload: Record<string, any> = {
        identity: newPerson.identity,
        name_english: newPerson.nameEn.trim(),
        name_chinese: newPerson.nameZh.trim(),
        normalized_key: normKey,
      };
      if (newPerson.email) payload.email = newPerson.email.trim();
      if (newPerson.phone) payload.phone = newPerson.phone.trim();
      if (newPerson.idNumber) payload.id_number = newPerson.idNumber.trim();
      if (newPerson.address) payload.address = newPerson.address.trim();
      if (newPerson.serviceAddress) payload.service_address = newPerson.serviceAddress.trim();
      if (newPerson.dateOfBirth) payload.date_of_birth = newPerson.dateOfBirth.trim();
      const { data: created, error } = await supabase
        .from('persons').insert(payload as any).select('id').single();
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      await refetchOfficers();
      // Also invalidate companies queries so member lists reflect the new person
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      const desc = newPerson.nameZh.trim()
        ? `${newPerson.nameEn.trim()}（${newPerson.nameZh.trim()}）已加入選擇`
        : `${newPerson.nameEn.trim()} 已加入選擇`;
      toast({ title: '人員已建立', description: desc });
      onDone?.(created.id);
      setShowNewPersonInline(false);
      setNewPerson(defaultNewPerson());
    } catch (e: any) {
      toast({ title: '建立人員失敗', description: e.message, variant: 'destructive' });
    } finally { setCreatingPerson(false); }
  };

  // ── Inline create company (shared) ──
  const handleCreateCompany = async () => {
    if (!newCompany.name.trim() || !newCompany.brNumber.trim()) {
      toast({ title: '請填寫公司名稱和商業登記號碼', variant: 'destructive' }); return;
    }
    setCreating(true);
    try {
      const payload: Record<string, any> = {
        name: newCompany.name.trim(),
        chinese_name: newCompany.nameZh.trim(),
        company_number: newCompany.brNumber.trim(),
        email: newCompany.email.trim(),
        phone: newCompany.phone.trim(),
        reg_flat: newCompany.regFlat.trim(),
        reg_building: newCompany.regBuilding.trim(),
        reg_street: newCompany.regStreet.trim(),
        reg_district: newCompany.regDistrict.trim(),
        reg_region: newCompany.regRegion.trim() || '',
        jurisdiction: newCompany.jurisdiction.trim() || 'Hong Kong',
        company_type: newCompany.companyType || '私人公司 Private company',
      };
      const { data: created, error } = await supabase
        .from('companies').insert(payload as any).select('id').single();
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      await refetchCompanies();
      toast({ title: '公司已建立', description: newCompany.name.trim() });
      const newId = created.id;
      if (assignSubMode === 'many-to-one') setAssignSelectedCompany(newId);
      else setAssignSelectedCompanies(prev => [...prev, newId]);
      setShowNewCompany(false);
      setNewCompany(defaultNewCompany());
    } catch (e: any) {
      toast({ title: '建立公司失敗', description: e.message, variant: 'destructive' });
    } finally { setCreating(false); }
  };

  // ── Submit: one person → many companies (create sub-mode) ──
  const handleOnePersonSubmit = async () => {
    if (!onePersonNameEn.trim()) {
      toast({ title: '請填寫英文姓名', variant: 'destructive' }); return;
    }
    // Include pending companies in valid rows
    const hasPending = pendingCompanies.length > 0;
    const validRows = companyRows.filter(r => r.companyId);
    if (validRows.length === 0 && !hasPending) {
      toast({ title: '請選擇或新建至少一間公司', variant: 'destructive' }); return;
    }
    setCreating(true);
    try {
      // 0. Resolve pending companies (deferred creation)
      const { companyIdMap } = await resolvePendingItems();

      // Replace temp IDs with real IDs
      const resolvedCompanyIds = validRows.map(r => companyIdMap[r.companyId] || r.companyId);

      // 1. Find or create person (with full fields)
      const normKey = onePersonNameEn.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const personPayload: Record<string, any> = {
        identity: onePersonIdentity,
        name_english: onePersonNameEn.trim(),
        name_chinese: onePersonNameZh.trim(),
        normalized_key: normKey,
      };
      if (onePersonIdNumber) personPayload.id_number = onePersonIdNumber;
      if (onePersonEmail) personPayload.email = onePersonEmail;
      if (onePersonPhone) personPayload.phone = onePersonPhone;
      if (onePersonAddress) personPayload.address = onePersonAddress;
      if (onePersonServiceAddress) personPayload.service_address = onePersonServiceAddress;
      if (onePersonDateOfBirth) personPayload.date_of_birth = onePersonDateOfBirth;

      let personId: string;
      const { data: existing } = await supabase
        .from('persons').select('id')
        .eq('normalized_key', normKey)
        .eq('name_chinese', onePersonNameZh.trim())
        .limit(1);
      if (existing && existing.length > 0) {
        personId = existing[0].id;
        // Patch any additional fields
        const patch: Record<string, any> = {};
        if (onePersonIdentity) patch.identity = onePersonIdentity;
        if (onePersonIdNumber) patch.id_number = onePersonIdNumber;
        if (onePersonEmail) patch.email = onePersonEmail;
        if (onePersonPhone) patch.phone = onePersonPhone;
        if (onePersonAddress) patch.address = onePersonAddress;
        if (onePersonServiceAddress) patch.service_address = onePersonServiceAddress;
        if (onePersonDateOfBirth) patch.date_of_birth = onePersonDateOfBirth;
        if (Object.keys(patch).length > 0) {
          await supabase.from('persons').update(patch as any).eq('id', personId);
        }
      } else {
        const { data: created, error } = await supabase
          .from('persons').insert(personPayload as any).select('id').single();
        if (error) throw error;
        personId = created.id;
      }

      // 2. Batch insert roles (with dedup)
      const inserts: any[] = [];
      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        const realCompanyId = resolvedCompanyIds[i];
        const isReserve = row.role === 'reserve_director';
        const dbRole = isReserve ? 'director' : row.role;
        const { data: dup } = await supabase
          .from('person_company_roles')
          .select('id')
          .eq('person_id', personId)
          .eq('company_id', realCompanyId)
          .eq('role', dbRole)
          .limit(1);
        if (dup && dup.length > 0) continue;
        inserts.push({
          person_id: personId, company_id: realCompanyId, role: dbRole,
          is_reserve: isReserve,
          date_appointed: new Date().toLocaleDateString('en-GB'), date_ceased: '', service_address_override: '',
          shares: 0, share_type: '', currency: 'HKD', issue_price: '', paid_up: '', unpaid: '',
        });
      }
      if (inserts.length > 0) {
        const { error } = await supabase.from('person_company_roles').insert(inserts as any);
        if (error) throw error;

        // ── 寫入公司日誌：人員委任記錄 ──
        const today = new Date().toLocaleDateString('en-GB');
        const ROLE_LABEL_MAP: Record<string, string> = {
          director: '董事', secretary: '秘書', shareholder: '股東',
          reserve_director: '候補董事', authorized_representative: '授權代表',
        };
        const personName = onePersonNameZh.trim() ? `${onePersonNameEn.trim()}（${onePersonNameZh.trim()}）` : onePersonNameEn.trim();
        const logEntries: any[] = [];
        for (const ins of inserts) {
          const roleLabel = ROLE_LABEL_MAP[ins.role] || ins.role;
          logEntries.push({
            company_id: ins.company_id,
            doc_type: 'PERSONNEL_APPOINT',
            doc_date: ins.date_appointed || today,
            notes: `委任${roleLabel}：${personName}`,
            html_content: `<p>委任${roleLabel}</p><p>${personName}</p><p>日期：${ins.date_appointed || today}</p>`,
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

      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      await queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      const pendingInfo = pendingCompanies.length > 0 ? `（含 ${pendingCompanies.length} 間新建公司）` : '';
      toast({ title: '關聯成功', description: `已將「${onePersonNameEn.trim()}」關聯到 ${inserts.length} 間公司${pendingInfo}` });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: '操作失敗', description: e.message, variant: 'destructive' });
    } finally { setCreating(false); }
  };

  // ── Submit: create/edit company ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.brNumber) {
      toast({ title: '錯誤', description: '請填寫必填欄位', variant: 'destructive' }); return;
    }
    setCreating(true);
    try {
      // Process person rows: create new persons with full data if needed
      const manualPeople: { personId: string; role: string; dateAppointed?: string; dateCeased?: string; isReserve?: boolean }[] = [];
      for (const row of personRows) {
        // If has personId, use it directly; optionally update their details
        if (row.personId) {
          // Update person details if any extra fields were filled
          const patch: Record<string, any> = {};
          if (row.idNumber) patch.id_number = row.idNumber;
          if (row.email) patch.email = row.email;
          if (row.address) patch.address = row.address;
          if (row.serviceAddress) patch.service_address = row.serviceAddress;
          if (row.dateOfBirth) patch.date_of_birth = row.dateOfBirth;
          if (row.tcspNumber) patch.tcsp_number = row.tcspNumber;
          if (row.placeIncorporated) patch.place_incorporated = row.placeIncorporated;
          if (row.companyNumberRef) patch.company_number_ref = row.companyNumberRef;
          if (Object.keys(patch).length > 0) {
            await supabase.from('persons').update(patch as any).eq('id', row.personId);
          }
          const isReserve = row.role === 'reserve_director';
          manualPeople.push({
            personId: row.personId,
            role: isReserve ? 'director' : row.role,
            dateAppointed: row.dateAppointed,
            dateCeased: row.dateCeased,
            isReserve,
          });
        } else if (row.nameEnglish.trim()) {
          // Create new person with all filled fields
          const normKey = row.nameEnglish.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
          const { data: created, error } = await supabase
            .from('persons').insert({
              identity: row.identity || 'natural',
              name_english: row.nameEnglish.trim(),
              name_chinese: row.nameChinese.trim(),
              normalized_key: normKey,
              id_number: row.idNumber,
              email: row.email,
              address: row.address,
              service_address: row.serviceAddress,
              date_of_birth: row.dateOfBirth,
              tcsp_number: row.tcspNumber,
              place_incorporated: row.placeIncorporated,
              company_number_ref: row.companyNumberRef,
            } as any).select('id').single();
          if (error) throw error;
          const isReserve = row.role === 'reserve_director';
          manualPeople.push({
            personId: created.id,
            role: isReserve ? 'director' : row.role,
            dateAppointed: row.dateAppointed,
            dateCeased: row.dateCeased,
            isReserve,
          });
        }
      }
      const payload: Partial<Company> & { manualPeople?: { personId: string; role: string; dateAppointed?: string; dateCeased?: string; isReserve?: boolean }[] } = {
        ...formData,
        directors: directors as Person[],
        secretaries: secretaries as Person[],
        shareholders: shareholders as Shareholder[],
        manualPeople,
      };
      onSave?.(payload);
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: '操作失敗', description: e.message, variant: 'destructive' });
    } finally { setCreating(false); }
  };

  // ── Resolve pending items (create in DB, return temp→real ID mappings) ──
  const resolvePendingItems = async () => {
    const companyIdMap: Record<string, string> = {};
    const personIdMap: Record<string, string> = {};

    // Create pending companies
    for (const pc of pendingCompanies) {
      const { data: created, error } = await supabase.from('companies').insert({
        name: pc.name, chinese_name: pc.nameZh, company_number: pc.brNumber,
        email: pc.email, phone: pc.phone,
        reg_flat: pc.regFlat, reg_building: pc.regBuilding, reg_street: pc.regStreet,
        reg_district: pc.regDistrict, reg_region: pc.regRegion,
        jurisdiction: pc.jurisdiction, company_type: pc.companyType,
      } as any).select('id').single();
      if (error) throw new Error(`建立公司「${pc.name}」失敗：${error.message}`);
      companyIdMap[pc.tempId] = created.id;
    }

    // Create pending people
    for (const pp of pendingPeople) {
      const payload: Record<string, any> = {
        identity: pp.identity, name_english: pp.nameEn, name_chinese: pp.nameZh,
        normalized_key: pp.nameEn.toLowerCase().replace(/[^a-z0-9]/g, ''),
      };
      if (pp.email) payload.email = pp.email;
      if (pp.phone) payload.phone = pp.phone;
      if (pp.idNumber) payload.id_number = pp.idNumber;
      if (pp.address) payload.address = pp.address;
      if (pp.serviceAddress) payload.service_address = pp.serviceAddress;
      if (pp.dateOfBirth) payload.date_of_birth = pp.dateOfBirth;
      const { data: created, error } = await supabase.from('persons').insert(payload as any).select('id').single();
      if (error) throw new Error(`建立人員「${pp.nameEn}」失敗：${error.message}`);
      personIdMap[pp.tempId] = created.id;
    }

    return { companyIdMap, personIdMap };
  };

  // Helper: replace temp IDs in an array with real IDs
  const replaceTempIds = (ids: string[], companyMap: Record<string, string>, personMap: Record<string, string>): string[] =>
    ids.map(id => companyMap[id] || personMap[id] || id);

  // ── Submit: batch assign ──
  const handleAssignSubmit = async () => {
    if (assignSubMode === 'many-to-one') {
      if (!assignSelectedCompany) { toast({ title: '請選擇或新建公司', variant: 'destructive' }); return; }
      const groups = assignGroups.filter(g => g.people.length > 0);
      if (groups.length === 0 && pendingPeople.length === 0) { toast({ title: '請選擇或新建至少一位人員', variant: 'destructive' }); return; }
      setCreating(true);
      try {
        // Step 1: Create all pending companies & people
        const { companyIdMap, personIdMap } = await resolvePendingItems();
        const resolvedCompanyId = companyIdMap[assignSelectedCompany] || assignSelectedCompany;

        let totalCount = 0;
        const allInserts: any[] = []; // collect for company_logs
        for (const g of groups) {
          // Replace temp person IDs with real IDs
          const resolvedPeople = replaceTempIds(g.people, companyIdMap, personIdMap);
          // Chunked insert (50 per batch)
          const chunks = [];
          for (let i = 0; i < resolvedPeople.length; i += 50) chunks.push(resolvedPeople.slice(i, i + 50));
          for (const chunk of chunks) {
            const inserts: any[] = [];
            for (const personId of chunk) {
              const { data: existing } = await supabase.from('person_company_roles').select('id').eq('person_id', personId).eq('company_id', resolvedCompanyId).eq('role', g.role).limit(1);
              if (existing && existing.length > 0) continue;
              inserts.push({ person_id: personId, company_id: resolvedCompanyId, role: g.role, date_appointed: new Date().toLocaleDateString('en-GB'), date_ceased: '', service_address_override: '', shares: 0, share_type: '', currency: 'HKD', issue_price: '', paid_up: '', unpaid: '' });
            }
            if (inserts.length > 0) {
              const { error } = await supabase.from('person_company_roles').insert(inserts);
              if (error) throw error;
              totalCount += inserts.length;
              allInserts.push(...inserts);
            }
          }
        }
        // ── 寫入公司日誌：人員委任記錄 ──
        if (allInserts.length > 0) {
          const today = new Date().toLocaleDateString('en-GB');
          const ROLE_LABEL_MAP: Record<string, string> = {
            director: '董事', secretary: '秘書', shareholder: '股東',
            reserve_director: '候補董事', authorized_representative: '授權代表',
          };
          const uniquePersonIds = [...new Set(allInserts.map((ins: any) => ins.person_id))];
          const { data: persons } = await supabase.from('persons')
            .select('id,name_english,name_chinese').in('id', uniquePersonIds);
          const personMap = new Map<string, { nameEn: string; nameZh: string }>();
          if (persons) {
            for (const p of persons as any[]) {
              personMap.set(p.id, { nameEn: p.name_english || '', nameZh: p.name_chinese || '' });
            }
          }
          const logEntries: any[] = [];
          for (const ins of allInserts) {
            const p = personMap.get(ins.person_id);
            const nameEn = p?.nameEn || ins.person_id;
            const nameZh = p?.nameZh || '';
            const personName = nameZh ? `${nameEn}（${nameZh}）` : nameEn;
            const roleLabel = ROLE_LABEL_MAP[ins.role] || ins.role;
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
        await queryClient.invalidateQueries({ queryKey: ['companies'] });
        await queryClient.invalidateQueries({ queryKey: ['persons-list'] });
        const pendingInfo = pendingPeople.length > 0 ? `（含 ${pendingPeople.length} 位新建人員）` : '';
        toast({ title: '批量關聯成功', description: `已建立 ${totalCount} 筆關聯${pendingInfo}` });
        onOpenChange(false);
      } catch (e: any) {
        toast({ title: '批量關聯失敗', description: e.message, variant: 'destructive' });
      } finally { setCreating(false); }
    } else {
      if (!assignSelectedPerson) { toast({ title: '請選擇或新建人員', variant: 'destructive' }); return; }
      if (assignSelectedCompanies.length === 0 && pendingCompanies.length === 0) { toast({ title: '請選擇或新建至少一間公司', variant: 'destructive' }); return; }
      setCreating(true);
      try {
        // Step 1: Create all pending companies & people
        const { companyIdMap, personIdMap } = await resolvePendingItems();
        const resolvedPersonId = personIdMap[assignSelectedPerson] || assignSelectedPerson;
        const resolvedCompanyIds = replaceTempIds(assignSelectedCompanies, companyIdMap, personIdMap);

        batchAssign.mutate({
          mode: assignSubMode,
          personIds: [resolvedPersonId],
          companyIds: resolvedCompanyIds,
          role: assignRole,
          companyRoles: assignSubMode === 'one-to-many' ? companyRoles : undefined,
        }, {
          onSuccess: (result) => {
            const roleLabel = ROLE_OPTIONS.find(r => r.value === assignRole)?.label || assignRole;
            const pendingInfo = pendingPeople.length > 0 || pendingCompanies.length > 0 ? `（含 ${pendingPeople.length} 位新建人員、${pendingCompanies.length} 間新建公司）` : '';
            toast({ title: '批量關聯成功', description: `已建立 ${result.count} 筆「${roleLabel}」關聯${pendingInfo}` });
            onOpenChange(false);
          },
          onError: (e: any) => toast({ title: '批量關聯失敗', description: e.message, variant: 'destructive' }),
        });
      } catch (e: any) {
        toast({ title: '批量關聯失敗', description: e.message, variant: 'destructive' });
      } finally { setCreating(false); }
    }
  };

  // ── Helpers ──
  const removeFromArray = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, idx: number) => {
    setter(prev => prev.filter((_, i) => i !== idx));
  };

  const renderUploadCard = (kind: ExtractKind, title: string, hint: string) => (
    <div className="p-3 border-2 border-dashed border-primary/30 rounded-lg bg-primary/5">
      <div className="flex items-center gap-2 mb-1"><Sparkles className="h-4 w-4 text-primary" /><span className="text-sm font-medium">{title}</span></div>
      <p className="text-xs text-muted-foreground mb-2">{hint}</p>
      {fileNames[kind] && (
        <div className="flex items-center gap-1 mb-2 text-xs text-primary truncate"><FileText className="h-3 w-3 shrink-0" /><span className="truncate">{fileNames[kind]}</span></div>
      )}
      <input ref={refs[kind]} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
        onChange={e => { const f = e.target.files?.[0]; if (f) extract(f, kind); }} className="hidden" />
      <Button type="button" variant="outline" size="sm" disabled={extracting[kind]}
        onClick={() => refs[kind].current?.click()} className="gap-2 w-full">
        {extracting[kind] ? <><Loader2 className="h-4 w-4 animate-spin" />辨識中...</> : <><Upload className="h-4 w-4" />上傳</>}
      </Button>
    </div>
  );

  const renderPeoplePreview = (title: string, items: Partial<Person>[] | Partial<Shareholder>[], setter: any) => {
    if (!items.length) return null;
    return (
      <div className="col-span-2 mt-2">
        <div className="text-sm font-medium mb-2">{title}（AI 提取，{items.length}）</div>
        <div className="space-y-1 max-h-40 overflow-y-auto rounded border p-2 bg-muted/20">
          {items.map((p: any, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 border-b last:border-0">
              <div className="flex-1 truncate">
                <span className="font-medium">{p.nameEnglish || p.nameChinese || p.name || '(未命名)'}</span>
                {p.nameChinese && p.nameEnglish && <span className="text-muted-foreground"> · {p.nameChinese}</span>}
                {p.idNumber && <span className="text-muted-foreground"> · {p.idNumber}</span>}
                {typeof p.shares === 'number' && p.shares > 0 && <span className="text-muted-foreground"> · {p.shares} 股</span>}
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeFromArray(setter, i)}><X className="h-3 w-3" /></Button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── Shared inline create company form ──
  const renderInlineCompanyForm = (onSubmit: () => void, createLabel: string) => (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label className="text-xs">公司英文名稱 *</Label><Input value={newCompany.name} onChange={e => updateNewCompany({ name: e.target.value })} placeholder="例如 PAUL TANG AND CO LTD" /></div>
        <div className="space-y-1"><Label className="text-xs">中文名稱</Label><Input value={newCompany.nameZh} onChange={e => updateNewCompany({ nameZh: e.target.value })} placeholder="例如 彭鄧會計師事務所" /></div>
        <div className="space-y-1"><Label className="text-xs">商業登記號碼 *</Label><Input value={newCompany.brNumber} onChange={e => updateNewCompany({ brNumber: e.target.value })} placeholder="例如 07281051" /></div>
        <div className="space-y-1"><Label className="text-xs">公司類型</Label><Select value={newCompany.companyType} onValueChange={v => updateNewCompany({ companyType: v })}><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="私人公司 Private company">私人公司</SelectItem><SelectItem value="公眾公司 Public company">公眾公司</SelectItem><SelectItem value="擔保有限公司 Company limited by guarantee">擔保有限公司</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label className="text-xs">電郵</Label><Input type="email" value={newCompany.email} onChange={e => updateNewCompany({ email: e.target.value })} placeholder="email@example.com" /></div>
        <div className="space-y-1"><Label className="text-xs">電話</Label><Input value={newCompany.phone} onChange={e => updateNewCompany({ phone: e.target.value })} placeholder="+852 XXXX XXXX" /></div>
        <div className="space-y-1"><Label className="text-xs">司法管轄區</Label><Input value={newCompany.jurisdiction} onChange={e => updateNewCompany({ jurisdiction: e.target.value })} placeholder="Hong Kong" /></div>
      </div>
      <div className="text-xs text-muted-foreground mt-1">註冊辦事處地址</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label className="text-xs">室/樓</Label><Input value={newCompany.regFlat} onChange={e => updateNewCompany({ regFlat: e.target.value })} placeholder="Flat A, 12/F" /></div>
        <div className="space-y-1"><Label className="text-xs">大廈</Label><Input value={newCompany.regBuilding} onChange={e => updateNewCompany({ regBuilding: e.target.value })} placeholder="大廈名稱" /></div>
        <div className="space-y-1"><Label className="text-xs">街道</Label><Input value={newCompany.regStreet} onChange={e => updateNewCompany({ regStreet: e.target.value })} placeholder="街道及門牌" /></div>
        <div className="space-y-1"><Label className="text-xs">區</Label><Input value={newCompany.regDistrict} onChange={e => updateNewCompany({ regDistrict: e.target.value })} placeholder="e.g. 中西區" /></div>
        <div className="space-y-1"><Label className="text-xs">國家/地區</Label><Input value={newCompany.regRegion} onChange={e => updateNewCompany({ regRegion: e.target.value })} placeholder="香港" /></div>
      </div>
      <div className="flex gap-1 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewCompany(false)}>取消</Button>
        <Button type="button" size="sm" onClick={onSubmit} disabled={creating} className="bg-primary text-primary-foreground">
          <Check className="h-3 w-3 mr-1" />{createLabel}
        </Button>
      </div>
    </div>
  );

  // ── Shared inline create person form ──
  const renderInlinePersonForm = (onSubmit: () => void, createLabel: string) => (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label className="text-xs">英文姓名 *</Label><Input value={newPerson.nameEn} onChange={e => updateNewPerson({ nameEn: e.target.value })} placeholder="例如 CHAN TAI MAN" /></div>
        <div className="space-y-1"><Label className="text-xs">中文姓名</Label><Input value={newPerson.nameZh} onChange={e => updateNewPerson({ nameZh: e.target.value })} placeholder="例如 陳大文" /></div>
        <div className="space-y-1"><Label className="text-xs">身份類型</Label><Select value={newPerson.identity} onValueChange={v => updateNewPerson({ identity: v as 'natural' | 'corporate' })}><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="natural">自然人</SelectItem><SelectItem value="corporate">法人</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label className="text-xs">證件號碼 <span className="text-destructive">*</span></Label><Input value={newPerson.idNumber} onChange={e => updateNewPerson({ idNumber: e.target.value })} placeholder="HKID / Passport" /></div>
        <div className="space-y-1"><Label className="text-xs">電郵</Label><Input type="email" value={newPerson.email} onChange={e => updateNewPerson({ email: e.target.value })} placeholder="email@example.com" /></div>
        <div className="space-y-1"><Label className="text-xs">電話 / WhatsApp</Label><Input value={newPerson.phone} onChange={e => updateNewPerson({ phone: e.target.value })} placeholder="+852 XXXX XXXX" /></div>
        <div className="space-y-1"><Label className="text-xs">出生日期 <span className="text-destructive">*</span></Label><Input value={newPerson.dateOfBirth} onChange={e => updateNewPerson({ dateOfBirth: e.target.value })} placeholder="DD/MM/YYYY" /></div>
      </div>
      <div className="space-y-1"><Label className="text-xs">居住地址 <span className="text-destructive">*</span></Label><Input value={newPerson.address} onChange={e => updateNewPerson({ address: e.target.value })} placeholder="地址 Address" /></div>
      <div className="space-y-1"><Label className="text-xs">服務地址</Label><Input value={newPerson.serviceAddress} onChange={e => updateNewPerson({ serviceAddress: e.target.value })} placeholder="留空則使用註冊辦事處地址" /></div>
      <div className="flex gap-1 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewPersonInline(false)}>取消</Button>
        <Button type="button" size="sm" onClick={onSubmit} disabled={creatingPerson} className="bg-primary text-primary-foreground">
          <Check className="h-3 w-3 mr-1" />{createLabel}
        </Button>
      </div>
    </div>
  );

  // ── Pending items badges ──
  const renderPendingBadges = (
    items: { tempId: string; name?: string; nameEn?: string; nameZh?: string }[],
    onRemove: (tempId: string) => void,
    label: string,
  ) => {
    if (items.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1 items-center mt-1">
        <span className="text-xs text-muted-foreground mr-1">{label}：</span>
        {items.map(item => (
          <Badge key={item.tempId} variant="secondary" className="text-xs gap-1 pr-1">
            <span className="max-w-[120px] truncate">{item.name || item.nameEn || item.tempId}</span>
            <Button type="button" variant="ghost" size="sm" className="h-4 w-4 p-0 hover:text-destructive"
              onClick={() => onRemove(item.tempId)}>
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        ))}
      </div>
    );
  };

  // ── Assign mode summary ──
  const assignSummary = useMemo(() => {
    if (assignSubMode === 'many-to-one') {
      const compName = assignSelectedCompany
        ? (companies.find(c => c.id === assignSelectedCompany)?.name
          || pendingCompanies.find(c => c.tempId === assignSelectedCompany)?.name
          || newCompany.name)
        : null;
      const totalPeople = assignGroups.reduce((s, g) => s + g.people.length, 0);
      const roleSummary = assignGroups.filter(g => g.people.length > 0).map(g => `${ROLE_OPTIONS.find(r => r.value === g.role)?.label || g.role} ${g.people.length}人`).join('、');
      return totalPeople > 0 && compName ? `將 ${totalPeople} 人（${roleSummary}）關聯到「${compName}」` : null;
    } else {
      const personName = assignSelectedPerson
        ? (officers.find(p => p.id === assignSelectedPerson)?.nameEnglish
          || officers.find(p => p.id === assignSelectedPerson)?.nameChinese
          || pendingPeople.find(p => p.tempId === assignSelectedPerson)?.nameEn
          || newPerson.nameEn)
        : null;
      const totalCompanies = assignSelectedCompanies.length
        + pendingCompanies.filter(c => assignSelectedCompanies.includes(c.tempId)).length;
      return assignSelectedCompanies.length > 0 && personName ? `將「${personName}」關聯到 ${assignSelectedCompanies.length} 間公司${totalCompanies > assignSelectedCompanies.length ? `（含 ${totalCompanies - assignSelectedCompanies.length} 間待建立）` : ''}` : null;
    }
  }, [assignSubMode, assignGroups, assignSelectedCompanies, assignSelectedCompany, assignSelectedPerson, companies, officers, newCompany, newPerson, pendingPeople, pendingCompanies]);

  // ── Render: Assign Mode ──
  if (isAssignMode) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" /> 批量關聯
            </DialogTitle>
            <DialogDescription>將人員快速關聯到公司 — 可選現有或新建</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Mode Toggle */}
            <div className="space-y-2">
              <Label>關聯模式</Label>
              <Tabs value={assignSubMode} onValueChange={v => setAssignSubMode(v as AssignSubMode)} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="many-to-one" className="gap-2">
                    <Users className="h-4 w-4" />
                    <div className="text-left"><div className="text-sm font-medium">多人一公司</div><div className="text-xs text-muted-foreground">選/建多人 → 加到一間公司</div></div>
                  </TabsTrigger>
                  <TabsTrigger value="one-to-many" className="gap-2">
                    <Building2 className="h-4 w-4" />
                    <div className="text-left"><div className="text-sm font-medium">一人多公司</div><div className="text-xs text-muted-foreground">選/建一人 → 加到多間公司</div></div>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <hr className="border-border" />

            {/* Many-to-One */}
            {assignSubMode === 'many-to-one' && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />目標公司</Label>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                      onClick={() => { setShowNewCompany(!showNewCompany); setShowNewPersonInline(false); }}>
                      <Plus className="h-3 w-3 mr-1" />新建公司
                    </Button>
                  </div>
                  {showNewCompany && renderInlineCompanyForm(() => addPendingCompany(tempId => setAssignSelectedCompany(tempId)), '添加到列表')}
                  {!showNewCompany && (
                    <SearchableSelect options={companyOptions} selected={assignSelectedCompany} onSelect={setAssignSelectedCompany}
                      placeholder="搜尋並選擇一間公司..." searchPlaceholder="搜尋公司名稱或 BR 號碼..." emptyText="找不到匹配的公司" />
                  )}
                </div>
                {renderPendingBadges(pendingCompanies.map(c => ({ tempId: c.tempId, name: c.name })), removePendingCompany, '待建立公司')}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" />角色分組（不同角色可各自選人）</Label>

                  {showNewPersonInline && renderInlinePersonForm(() => addPendingPerson(undefined), '添加到列表')}
                  {renderPendingBadges(pendingPeople.map(p => ({ tempId: p.tempId, nameEn: p.nameEn, nameZh: p.nameZh })), removePendingPerson, '待建立人員')}

                  {assignGroups.map((group, gi) => (
                    <div key={group.id} className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-28 shrink-0">
                          <Select value={group.role} onValueChange={v => updateGroupRole(setAssignGroups, group.id, v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {group.people.length > 0 && <Badge variant="secondary" className="text-xs">{group.people.length} 人</Badge>}
                        </div>
                        <div className="flex-1" />
                        <div className="flex gap-1">
                          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                            onClick={() => { setShowNewPersonInline(!showNewPersonInline); setShowNewCompany(false); }}>
                            <Plus className="h-3 w-3 mr-1" />新建人員
                          </Button>
                          {assignGroups.length > 1 && (
                            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => removeGroup(setAssignGroups, group.id)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <SearchableMultiSelect options={personOptions} selected={group.people}
                        onToggle={id => {
                          const newPeople = group.people.includes(id) ? group.people.filter(x => x !== id) : [...group.people, id];
                          updateGroupPeople(setAssignGroups, group.id, newPeople);
                        }}
                        placeholder="搜尋並選擇人員..." searchPlaceholder="搜尋姓名..." emptyText="找不到匹配的人員" />
                      {group.people.length > 0 && (
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {group.people.map((pid) => {
                            const p = officers.find((o) => o.id === pid);
                            const name = p?.nameEnglish || p?.nameChinese || pid.slice(0, 8);
                            return (
                              <div key={pid} className="flex items-center gap-1.5 text-xs px-1">
                                <span className="flex-1 min-w-0 truncate">{name}</span>
                                <Button
                                  type="button" variant="ghost" size="sm"
                                  className="h-5 w-5 p-0 hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => {
                                    const newPeople = group.people.filter(x => x !== pid);
                                    updateGroupPeople(setAssignGroups, group.id, newPeople);
                                  }}
                                  title="移除"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}

                  <Button type="button" variant="outline" size="sm" className="w-full h-8 text-xs"
                    onClick={() => addGroup(setAssignGroups)}>
                    <Plus className="h-3 w-3 mr-1" />添加角色組
                  </Button>
                </div>
              </>
            )}

            {/* One-to-Many */}
            {assignSubMode === 'one-to-many' && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" />目標人員</Label>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                      onClick={() => { setShowNewPersonInline(!showNewPersonInline); setShowNewCompany(false); }}>
                      <Plus className="h-3 w-3 mr-1" />新建人員
                    </Button>
                  </div>
                  {showNewPersonInline && renderInlinePersonForm(() => addPendingPerson(tempId => setAssignSelectedPerson(tempId)), '添加到列表')}
                  {!showNewPersonInline && (
                    <SearchableSelect options={personOptions} selected={assignSelectedPerson} onSelect={setAssignSelectedPerson}
                      placeholder="搜尋並選擇一位人員..." searchPlaceholder="搜尋姓名..." emptyText="找不到匹配的人員" />
                  )}
                  {renderPendingBadges(pendingPeople.map(p => ({ tempId: p.tempId, nameEn: p.nameEn, nameZh: p.nameZh })), removePendingPerson, '待建立人員')}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />選擇公司</Label>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                      onClick={() => { setShowNewCompany(!showNewCompany); setShowNewPersonInline(false); }}>
                      <Plus className="h-3 w-3 mr-1" />新建公司
                    </Button>
                  </div>
                  {showNewCompany && renderInlineCompanyForm(() => addPendingCompany(tempId => setAssignSelectedCompanies(prev => [...prev, tempId])), '添加到列表')}
                  <SearchableMultiSelect options={companyOptions} selected={assignSelectedCompanies}
                    onToggle={id => {
                      setAssignSelectedCompanies(prev => {
                        if (prev.includes(id)) {
                          setCompanyRoles(cr => { const n = { ...cr }; delete n[id]; return n; });
                          return prev.filter(x => x !== id);
                        } else {
                          const r = quickMode ? quickModeRole : assignRole;
                          setCompanyRoles(cr => ({ ...cr, [id]: cr[id] || r }));
                          return [...prev, id];
                        }
                      });
                    }}
                    placeholder="搜尋並選擇多間公司..." searchPlaceholder="搜尋公司名稱或 BR 號碼..." emptyText="找不到匹配的公司" />

                  {assignSelectedCompanies.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">
                          已選擇 {assignSelectedCompanies.length} 間公司
                        </Label>
                        <div className="flex items-center gap-2">
                          <Label htmlFor="quick-mode-company" className="text-xs cursor-pointer select-none">
                            快速模式：統一角色
                          </Label>
                          <Switch
                            id="quick-mode-company"
                            checked={quickMode}
                            onCheckedChange={(checked) => {
                              setQuickMode(checked);
                              if (checked) {
                                const commonRole = assignRole;
                                setQuickModeRole(commonRole);
                                const synced: Record<string, string> = {};
                                assignSelectedCompanies.forEach((cid) => { synced[cid] = commonRole; });
                                setCompanyRoles(synced);
                              }
                            }}
                          />
                        </div>
                      </div>

                      {quickMode && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs">統一角色：</span>
                          <Select
                            value={quickModeRole}
                            onValueChange={(v) => {
                              setQuickModeRole(v);
                              setAssignRole(v);
                              const synced: Record<string, string> = {};
                              assignSelectedCompanies.forEach((cid) => { synced[cid] = v; });
                              setCompanyRoles(synced);
                            }}
                          >
                            <SelectTrigger className="w-[150px] h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-md border p-2">
                        {assignSelectedCompanies.map((cid) => {
                          const comp = companies.find((c) => c.id === cid);
                          const compName = comp?.name || cid.slice(0, 8);
                          const cr = companyRoles[cid] || assignRole;
                          return (
                            <div key={cid} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1.5">
                              {quickMode && (
                                <Badge variant="secondary" className="text-xs shrink-0">
                                  {ROLE_OPTIONS.find(r => r.value === cr)?.label}
                                </Badge>
                              )}
                              <span className="text-sm flex-1 min-w-0 truncate" title={compName}>{compName}</span>
                              {!quickMode && (
                                <Select value={cr} onValueChange={(v) => setCompanyRoles(prev => ({ ...prev, [cid]: v }))}>
                                  <SelectTrigger className="w-[130px] h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              )}
                              <Button
                                type="button" variant="ghost" size="sm"
                                className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => {
                                  setAssignSelectedCompanies(prev => prev.filter(x => x !== cid));
                                  setCompanyRoles(cr => { const n = { ...cr }; delete n[cid]; return n; });
                                }}
                                title="移除"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {renderPendingBadges(pendingCompanies.map(c => ({ tempId: c.tempId, name: c.name })), removePendingCompany, '待建立公司')}
                </div>
              </>
            )}

            {assignSummary && (
              <div className="rounded-md bg-primary/5 border border-primary/30 p-3">
                <p className="text-sm font-medium text-primary flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" />{assignSummary}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={handleAssignSubmit} className="bg-primary text-primary-foreground" disabled={batchAssign.isPending || creating}>
              {batchAssign.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />關聯中...</> : '確認關聯'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Render: Create/Edit Mode ──
  // Edit mode: no sub-mode toggle, same layout as before
  if (isEditMode) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>編輯公司</DialogTitle>
            <DialogDescription>修改公司資料</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-2"><Label htmlFor="name">公司名稱 <span className="text-destructive">*</span></Label><Input id="name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="輸入公司名稱" /></div>
              <div className="space-y-2"><Label htmlFor="chineseName">中文名稱</Label><Input id="chineseName" value={formData.chineseName} onChange={e => setFormData({ ...formData, chineseName: e.target.value })} placeholder="輸入中文名稱" /></div>
              <div className="space-y-2"><Label htmlFor="brNumber">商業登記號碼 <span className="text-destructive">*</span></Label><Input id="brNumber" value={formData.brNumber} onChange={e => setFormData({ ...formData, brNumber: e.target.value })} placeholder="輸入商業登記號碼" /></div>
              <div className="space-y-2"><Label htmlFor="incorporationDate">成立日期</Label><Input id="incorporationDate" value={formData.incorporationDate} onChange={e => setFormData({ ...formData, incorporationDate: e.target.value })} placeholder="DD/MM/YYYY" /></div>
              <div className="space-y-2"><Label htmlFor="tradingName">商業名稱</Label><Input id="tradingName" value={formData.tradingName} onChange={e => setFormData({ ...formData, tradingName: e.target.value })} placeholder="輸入商業名稱" /></div>
              <div className="space-y-2"><Label htmlFor="jurisdiction">司法管轄區</Label><Input id="jurisdiction" value={formData.jurisdiction} onChange={e => setFormData({ ...formData, jurisdiction: e.target.value })} placeholder="Hong Kong" /></div>
              <div className="space-y-2"><Label htmlFor="businessNature">業務性質</Label><Input id="businessNature" value={formData.businessNature} onChange={e => setFormData({ ...formData, businessNature: e.target.value })} placeholder="輸入業務性質" /></div>
              <div className="space-y-2">
                <Label htmlFor="companyType">公司類型</Label>
                <Select value={formData.companyType} onValueChange={value => setFormData({ ...formData, companyType: value })}>
                  <SelectTrigger><SelectValue placeholder="選擇公司類型" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="私人公司 Private company">私人公司 Private company</SelectItem>
                    <SelectItem value="公眾公司 Public company">公眾公司 Public company</SelectItem>
                    <SelectItem value="擔保有限公司 Company limited by guarantee">擔保有限公司</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2"><Label htmlFor="businessCode">業務代碼</Label><Input id="businessCode" value={formData.businessCode} onChange={e => setFormData({ ...formData, businessCode: e.target.value })} placeholder="輸入業務代碼" /></div>
              <div className="col-span-2 mt-2 text-sm font-medium">註冊辦事處地址</div>
              <div className="space-y-2"><Label htmlFor="regFlat">室/樓</Label><Input id="regFlat" value={formData.regFlat} onChange={e => setFormData({ ...formData, regFlat: e.target.value })} placeholder="例如 Flat A, 12/F" /></div>
              <div className="space-y-2"><Label htmlFor="regBuilding">大廈</Label><Input id="regBuilding" value={formData.regBuilding} onChange={e => setFormData({ ...formData, regBuilding: e.target.value })} placeholder="大廈名稱" /></div>
              <div className="space-y-2"><Label htmlFor="regStreet">街道</Label><Input id="regStreet" value={formData.regStreet} onChange={e => setFormData({ ...formData, regStreet: e.target.value })} placeholder="街道及門牌" /></div>
              <div className="space-y-2"><Label htmlFor="regDistrict">區</Label><Input id="regDistrict" value={formData.regDistrict} onChange={e => setFormData({ ...formData, regDistrict: e.target.value })} placeholder="e.g. 中西區" /></div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="regRegion">國家/地區</Label>
                <Input id="regRegion" value={formData.regRegion} onChange={e => setFormData({ ...formData, regRegion: e.target.value })} placeholder="香港" />
              </div>
              <div className="col-span-2 mt-2 text-sm font-medium">表格提交人 Presenter</div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="preferredPresenter">預設提交人（用於 NAR1 等表格）</Label>
                <Select value={formData.preferredPresenterId || '__none__'} onValueChange={value => setFormData({ ...formData, preferredPresenterId: value === '__none__' ? '' : value })}>
                  <SelectTrigger><SelectValue placeholder="選擇提交人..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— 不指定 —</SelectItem>
                    {presenters.map(p => <SelectItem key={p.id} value={p.id}>{p.name} {p.type === 'tcsp' ? '(TCSP)' : p.type === 'company' ? '(公司)' : '(個人)'}</SelectItem>)}
                  </SelectContent>
                </Select>
                {presenters.length === 0 && <p className="text-xs text-muted-foreground">尚無提交人資料，請先到「提交人資料」頁面新增。</p>}
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="presenterReference">提交人參考號碼（公司專屬，可覆寫預設值）</Label>
                <Input id="presenterReference" value={formData.presenterReference} onChange={e => setFormData({ ...formData, presenterReference: e.target.value })} placeholder="留空則使用提交人預設參考號碼" />
                <p className="text-xs text-muted-foreground">此欄位會優先用於該公司的表格生成；留空則自動套用所選提交人本身的參考號碼。</p>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="submit" className="bg-primary text-primary-foreground">儲存變更</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Create mode with sub-mode toggle ──
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增公司</DialogTitle>
          <DialogDescription>上傳 BR / CI / 會議紀錄等文件，AI 自動辨識並填入</DialogDescription>
        </DialogHeader>

        {/* ── Sub-mode Toggle ── */}
        <div className="space-y-2">
          <Label>關聯模式</Label>
          <Tabs value={createSubMode} onValueChange={v => setCreateSubMode(v as CreateSubMode)} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="one-company-many-people" className="gap-2">
                <Building2 className="h-4 w-4" />
                <div className="text-left"><div className="text-sm font-medium">一公司多人</div><div className="text-xs text-muted-foreground">新建公司，關聯多名人員</div></div>
              </TabsTrigger>
              <TabsTrigger value="one-person-many-companies" className="gap-2">
                <Users className="h-4 w-4" />
                <div className="text-left"><div className="text-sm font-medium">一人多公司</div><div className="text-xs text-muted-foreground">新建人員，關聯多家公司</div></div>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <hr className="border-border" />

        {/* ── Sub-mode A: 一公司多人 ── */}
        {createSubMode === 'one-company-many-people' && (
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {renderUploadCard('br', '商業登記證 (BR)', 'AI 自動辨識')}
              {renderUploadCard('ci', '公司註冊證書 (CI)', 'AI 自動辨識')}
              {renderUploadCard('other1', '其他文件 1', '會議紀錄/決議等')}
              {renderUploadCard('other2', '其他文件 2', '會議紀錄/決議等')}
            </div>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-2"><Label htmlFor="name">公司名稱 <span className="text-destructive">*</span></Label><Input id="name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="輸入公司名稱" /></div>
              <div className="space-y-2"><Label htmlFor="chineseName">中文名稱</Label><Input id="chineseName" value={formData.chineseName} onChange={e => setFormData({ ...formData, chineseName: e.target.value })} placeholder="輸入中文名稱" /></div>
              <div className="space-y-2"><Label htmlFor="brNumber">商業登記號碼 <span className="text-destructive">*</span></Label><Input id="brNumber" value={formData.brNumber} onChange={e => setFormData({ ...formData, brNumber: e.target.value })} placeholder="輸入商業登記號碼" /></div>
              <div className="space-y-2"><Label htmlFor="incorporationDate">成立日期</Label><Input id="incorporationDate" value={formData.incorporationDate} onChange={e => setFormData({ ...formData, incorporationDate: e.target.value })} placeholder="DD/MM/YYYY" /></div>
              <div className="space-y-2"><Label htmlFor="tradingName">商業名稱</Label><Input id="tradingName" value={formData.tradingName} onChange={e => setFormData({ ...formData, tradingName: e.target.value })} placeholder="輸入商業名稱" /></div>
              <div className="space-y-2"><Label htmlFor="jurisdiction">司法管轄區</Label><Input id="jurisdiction" value={formData.jurisdiction} onChange={e => setFormData({ ...formData, jurisdiction: e.target.value })} placeholder="Hong Kong" /></div>
              <div className="space-y-2"><Label htmlFor="businessNature">業務性質</Label><Input id="businessNature" value={formData.businessNature} onChange={e => setFormData({ ...formData, businessNature: e.target.value })} placeholder="輸入業務性質" /></div>
              <div className="space-y-2">
                <Label htmlFor="companyType">公司類型</Label>
                <Select value={formData.companyType} onValueChange={value => setFormData({ ...formData, companyType: value })}>
                  <SelectTrigger><SelectValue placeholder="選擇公司類型" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="私人公司 Private company">私人公司 Private company</SelectItem>
                    <SelectItem value="公眾公司 Public company">公眾公司 Public company</SelectItem>
                    <SelectItem value="擔保有限公司 Company limited by guarantee">擔保有限公司</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2"><Label htmlFor="businessCode">業務代碼</Label><Input id="businessCode" value={formData.businessCode} onChange={e => setFormData({ ...formData, businessCode: e.target.value })} placeholder="輸入業務代碼" /></div>
              <div className="col-span-2 mt-2 text-sm font-medium">註冊辦事處地址</div>
              <div className="space-y-2"><Label htmlFor="regFlat">室/樓</Label><Input id="regFlat" value={formData.regFlat} onChange={e => setFormData({ ...formData, regFlat: e.target.value })} placeholder="例如 Flat A, 12/F" /></div>
              <div className="space-y-2"><Label htmlFor="regBuilding">大廈</Label><Input id="regBuilding" value={formData.regBuilding} onChange={e => setFormData({ ...formData, regBuilding: e.target.value })} placeholder="大廈名稱" /></div>
              <div className="space-y-2"><Label htmlFor="regStreet">街道</Label><Input id="regStreet" value={formData.regStreet} onChange={e => setFormData({ ...formData, regStreet: e.target.value })} placeholder="街道及門牌" /></div>
              <div className="space-y-2"><Label htmlFor="regDistrict">區</Label><Input id="regDistrict" value={formData.regDistrict} onChange={e => setFormData({ ...formData, regDistrict: e.target.value })} placeholder="e.g. 中西區" /></div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="regRegion">國家/地區</Label>
                <Input id="regRegion" value={formData.regRegion} onChange={e => setFormData({ ...formData, regRegion: e.target.value })} placeholder="香港" />
              </div>
              <div className="col-span-2 mt-2 text-sm font-medium">表格提交人 Presenter</div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="preferredPresenter">預設提交人（用於 NAR1 等表格）</Label>
                <Select value={formData.preferredPresenterId || '__none__'} onValueChange={value => setFormData({ ...formData, preferredPresenterId: value === '__none__' ? '' : value })}>
                  <SelectTrigger><SelectValue placeholder="選擇提交人..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— 不指定 —</SelectItem>
                    {presenters.map(p => <SelectItem key={p.id} value={p.id}>{p.name} {p.type === 'tcsp' ? '(TCSP)' : p.type === 'company' ? '(公司)' : '(個人)'}</SelectItem>)}
                  </SelectContent>
                </Select>
                {presenters.length === 0 && <p className="text-xs text-muted-foreground">尚無提交人資料，請先到「提交人資料」頁面新增。</p>}
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="presenterReference">提交人參考號碼（公司專屬，可覆寫預設值）</Label>
                <Input id="presenterReference" value={formData.presenterReference} onChange={e => setFormData({ ...formData, presenterReference: e.target.value })} placeholder="留空則使用提交人預設參考號碼" />
                <p className="text-xs text-muted-foreground">此欄位會優先用於該公司的表格生成；留空則自動套用所選提交人本身的參考號碼。</p>
              </div>
              {renderPeoplePreview('董事', directors, setDirectors)}
              {renderPeoplePreview('秘書', secretaries, setSecretaries)}
              {renderPeoplePreview('股東', shareholders, setShareholders)}
            </div>

            {/* ── 人員關聯（一公司多人） ── */}
            <div className="border-t border-border pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <Label className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4 text-primary" />人員關聯（可選）</Label>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => setShowNewPersonInline(!showNewPersonInline)}>
                  <Plus className="h-3 w-3 mr-1" />新建人員
                </Button>
              </div>

              {showNewPersonInline && renderInlinePersonForm(() => handleCreatePerson(id => {
                // Add newly created person to existing empty row or append
                setPersonRows(prev => {
                  const emptyIdx = prev.findIndex(r => !r.personId && !r.nameEnglish);
                  // Capture current form values before they get cleared by handleCreatePerson
                  const rowData = { personId: id, nameEnglish: newPerson.nameEn, nameChinese: newPerson.nameZh, identity: newPerson.identity };
                  if (emptyIdx >= 0) {
                    return prev.map((r, i) => i === emptyIdx ? { ...r, ...rowData } : r);
                  }
                  return [...prev, { ...emptyPersonRow(), ...rowData }];
                });
              }), '建立並加入')}

              <div className="space-y-2">
                {personRows.map((row) => (
                  <div key={row.key} className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
                    {/* Header row — always visible */}
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"
                        onClick={() => togglePersonRowExpand(row.key)}>
                        {row.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <div className="flex-1 min-w-0">
                        {row.personId ? (
                          <span className="text-sm font-medium truncate block">
                            {personOptions.find(o => o.id === row.personId)?.label || '已選擇'}
                          </span>
                        ) : row.nameEnglish ? (
                          <span className="text-sm font-medium truncate block">{row.nameEnglish}</span>
                        ) : (
                          <SearchableSelect
                            options={personOptions}
                            selected={row.personId}
                            onSelect={id => selectPersonForRow(row.key, id)}
                            placeholder="搜尋並選擇人員..."
                            searchPlaceholder="搜尋姓名..."
                            emptyText="找不到匹配的人員"
                          />
                        )}
                      </div>
                      <div className="w-32 shrink-0">
                        <Select value={row.role} onValueChange={v => updatePersonRow(row.key, { role: v })}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => removePersonRow(row.key)} disabled={personRows.length <= 1}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Expandable detail form */}
                    {row.expanded && (
                      <div className="pl-9 grid grid-cols-2 gap-2 pt-1 border-t border-border/50">
                        <div className="space-y-1">
                          <Label className="text-xs">英文姓名 {!row.personId && <span className="text-destructive">*</span>}</Label>
                          <Input value={row.nameEnglish} onChange={e => updatePersonRow(row.key, { nameEnglish: e.target.value })} placeholder="English name" className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">中文姓名</Label>
                          <Input value={row.nameChinese} onChange={e => updatePersonRow(row.key, { nameChinese: e.target.value })} placeholder="中文名" className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">身份類型</Label>
                          <Select value={row.identity} onValueChange={v => updatePersonRow(row.key, { identity: v as 'natural' | 'corporate' })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="natural">自然人</SelectItem>
                              <SelectItem value="corporate">法人</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">證件號碼</Label>
                          <Input value={row.idNumber} onChange={e => updatePersonRow(row.key, { idNumber: e.target.value })} placeholder="HKID / Passport" className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">電郵</Label>
                          <Input type="email" value={row.email} onChange={e => updatePersonRow(row.key, { email: e.target.value })} placeholder="email@example.com" className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">委任日期</Label>
                          <Input value={row.dateAppointed} onChange={e => updatePersonRow(row.key, { dateAppointed: e.target.value })} placeholder="DD/MM/YYYY" className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">辭任日期</Label>
                          <Input value={row.dateCeased} onChange={e => updatePersonRow(row.key, { dateCeased: e.target.value })} placeholder="DD/MM/YYYY" className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">出生日期</Label>
                          <Input value={row.dateOfBirth} onChange={e => updatePersonRow(row.key, { dateOfBirth: e.target.value })} placeholder="DD/MM/YYYY" className="h-8 text-xs" />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">居住地址</Label>
                          <Input value={row.address} onChange={e => updatePersonRow(row.key, { address: e.target.value })} placeholder="地址 Address" className="h-8 text-xs" />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">服務地址</Label>
                          <Input value={row.serviceAddress} onChange={e => updatePersonRow(row.key, { serviceAddress: e.target.value })} placeholder="留空則使用註冊辦事處地址" className="h-8 text-xs" />
                        </div>
                        {row.identity === 'corporate' && (
                          <>
                            <div className="space-y-1">
                              <Label className="text-xs">TCSP 牌照號碼</Label>
                              <Input value={row.tcspNumber} onChange={e => updatePersonRow(row.key, { tcspNumber: e.target.value })} placeholder="TC No." className="h-8 text-xs" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">成立地點</Label>
                              <Input value={row.placeIncorporated} onChange={e => updatePersonRow(row.key, { placeIncorporated: e.target.value })} className="h-8 text-xs" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">公司編號</Label>
                              <Input value={row.companyNumberRef} onChange={e => updatePersonRow(row.key, { companyNumberRef: e.target.value })} className="h-8 text-xs" />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="w-full h-8 text-xs"
                  onClick={addPersonRow}>
                  <Plus className="h-3 w-3 mr-1" />添加人員
                </Button>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="submit" className="bg-primary text-primary-foreground">新增公司</Button>
            </DialogFooter>
          </form>
        )}

        {/* ── Sub-mode B: 一人多公司 ── */}
        {createSubMode === 'one-person-many-companies' && (
          <div className="space-y-4 py-2">
            {/* Person Info — one-person-many-companies */}
            <div className="space-y-3">
              <div className="text-sm font-medium flex items-center gap-2"><Users className="h-4 w-4 text-primary" />人員資訊</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">英文姓名 <span className="text-destructive">*</span></Label>
                  <Input value={onePersonNameEn} onChange={e => setOnePersonNameEn(e.target.value)} placeholder="例如 CHAN TAI MAN" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">中文姓名</Label>
                  <Input value={onePersonNameZh} onChange={e => setOnePersonNameZh(e.target.value)} placeholder="例如 陳大文" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">身份類型</Label>
                  <Select value={onePersonIdentity} onValueChange={v => setOnePersonIdentity(v as 'natural' | 'corporate')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="natural">自然人</SelectItem>
                      <SelectItem value="corporate">法人</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">證件號碼</Label>
                  <Input value={onePersonIdNumber} onChange={e => setOnePersonIdNumber(e.target.value)} placeholder="HKID / Passport" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">電郵</Label>
                  <Input type="email" value={onePersonEmail} onChange={e => setOnePersonEmail(e.target.value)} placeholder="email@example.com" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">電話 / WhatsApp</Label>
                  <Input value={onePersonPhone} onChange={e => setOnePersonPhone(e.target.value)} placeholder="+852 XXXX XXXX" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">出生日期</Label>
                  <Input value={onePersonDateOfBirth} onChange={e => setOnePersonDateOfBirth(e.target.value)} placeholder="DD/MM/YYYY" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">居住地址</Label>
                  <Input value={onePersonAddress} onChange={e => setOnePersonAddress(e.target.value)} placeholder="地址 Address" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">服務地址</Label>
                  <Input value={onePersonServiceAddress} onChange={e => setOnePersonServiceAddress(e.target.value)} placeholder="留空則使用註冊辦事處地址" />
                </div>
              </div>
            </div>

            <hr className="border-border" />

            {/* Company Rows */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />公司關聯</div>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => { setShowNewCompany(!showNewCompany); }}>
                  <Plus className="h-3 w-3 mr-1" />新建公司
                </Button>
              </div>

              {showNewCompany && renderInlineCompanyForm(() => addPendingCompany(tempId => {
                // Replace the first empty company row with the pending company
                setCompanyRows(prev => {
                  const emptyIdx = prev.findIndex(r => !r.companyId);
                  if (emptyIdx >= 0) {
                    return prev.map((r, i) => i === emptyIdx ? { ...r, companyId: tempId } : r);
                  }
                  return [...prev, { key: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, companyId: tempId, role: 'director' }];
                });
              }), '添加到列表')}

              {renderPendingBadges(pendingCompanies.map(c => ({ tempId: c.tempId, name: c.name })), removePendingCompany, '待建立公司')}

              <div className="space-y-2">
                {companyRows.map((row) => (
                  <div key={row.key} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
                    <div className="flex-1 min-w-0">
                      <SearchableSelect
                        options={companyOptions}
                        selected={row.companyId}
                        onSelect={id => updateCompanyRow(row.key, 'companyId', id)}
                        placeholder="搜尋並選擇公司..."
                        searchPlaceholder="搜尋公司名稱或 BR 號碼..."
                        emptyText="找不到匹配的公司"
                      />
                    </div>
                    <div className="w-32 shrink-0">
                      <Select value={row.role} onValueChange={v => updateCompanyRow(row.key, 'role', v)}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeCompanyRow(row.key)} disabled={companyRows.length <= 1}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="w-full h-8 text-xs"
                  onClick={addCompanyRow}>
                  <Plus className="h-3 w-3 mr-1" />添加公司關聯
                </Button>
              </div>

              {/* Summary */}
              {(() => {
                const rowCount = companyRows.filter(r => r.companyId).length;
                const pendingCount = pendingCompanies.length;
                const totalCount = rowCount + pendingCount;
                return totalCount > 0 && onePersonNameEn.trim() && (
                  <div className="rounded-md bg-primary/5 border border-primary/30 p-3">
                    <p className="text-sm font-medium text-primary flex items-center gap-2">
                      <ArrowRightLeft className="h-4 w-4" />
                      將「{onePersonNameEn.trim()}」關聯到 {totalCount} 間公司{pendingCount > 0 && `（含 ${pendingCount} 間待建立）`}
                    </p>
                  </div>
                );
              })()}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button onClick={handleOnePersonSubmit} className="bg-primary text-primary-foreground" disabled={creating}>
                {creating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />處理中...</> : '建立人員並關聯'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ── DeleteConfirmDialog (unchanged) ──
interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  loading?: boolean;
}

export const DeleteConfirmDialog = ({ open, onOpenChange, title, description, onConfirm, loading }: DeleteConfirmDialogProps) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {loading ? '刪除中...' : '確認刪除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
