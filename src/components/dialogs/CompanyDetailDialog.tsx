import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Company, Person, Shareholder } from '@/types';
import {
  Building2, Users, UserCheck, Briefcase, ArrowLeft, User, ShieldCheck, Copy,
  Edit, Save, X, Plus, Trash2, Upload, FileText, Download, Loader2, Paperclip, UsersRound, UserCog, UserPlus, FileClock, History, FileOutput, Landmark, Undo2,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  useUpdateCompany,
  useAddOfficer, useUpdateOfficer, useDeleteOfficer,
  useAddShareholder, useUpdateShareholder, useDeleteShareholder,
} from '@/hooks/useCompanies';
import { SCRTab } from './SCRTab';
import { RegistersTab } from './RegistersTab';
import { CompanyChronicleTab } from './CompanyChronicleTab';
import { PersonnelSection } from './PersonnelChangeTab';
import { DocGenerationTab } from './DocGenerationTab';
import { TabChangeEventsFooter } from '@/components/forms/TabChangeEventsFooter';
import { ShareCapitalTab } from './ShareCapitalTab';
import { ShareholderEditForm, type ShFormType, emptyShForm, calcUnpaid, computeShMoney, shFormFromSh } from './ShareholderEditForm';
import { CopyFromCompanyDialog } from './CopyFromCompanyDialog';
import { SearchableSelect } from '@/components/ui/searchable-multiselect';
import { useOfficers } from '@/hooks/useOfficers';
import { useCompanies } from '@/hooks/useCompanies';
import { useSecretaryTemplates } from '@/hooks/useSecretaryTemplates';
import { useUnassignedChangeEvents, useChangeEvents, EVENT_TYPE_LABELS } from '@/hooks/useChangeEvents';
import { useUndoChangeEvent, UNDOABLE_EVENT_TYPES } from '@/hooks/useUndoChangeEvent';
import { useNAR1Status, getNAR1StatusBadge } from '@/hooks/useNAR1Status';
import type { ChangeEvent } from '@/hooks/useChangeEvents';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface CompanyDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

const composeAddr5 = (flat: string, building: string, street: string, district: string, region: string) =>
  [flat, building, street, district, region].map((s: string) => (s || '').trim()).filter(Boolean).join(', ');

const emptyOfficerForm = () => ({ nameEnglish: '', nameChinese: '', identity: 'natural', idNumber: '', email: '', tcspNumber: '', authScope: '', address: '', addrFlat: '', addrBuilding: '', addrStreet: '', addrDistrict: '', addrRegion: '', serviceAddress: '', svcAddrFlat: '', svcAddrBuilding: '', svcAddrStreet: '', svcAddrDistrict: '', svcAddrRegion: '', dateAppointed: '', dateCeased: '', placeIncorporated: '', companyNumberRef: '', dateOfBirth: '' });

// 股東表單金額輔助：自動格式化 + 計算未繳股本
// DDMMYYYY / ISO / 其他 → DD/MM/YYYY 顯示（檢索服務 SE-05/SE-07 辭任日期用）
function fmtDate(s?: string) {
  if (!s) return '';
  const t = String(s).trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4, 8)}`;
  return t;
}
const isCeased = (x: { dateCeased?: string }) => !!(x.dateCeased && x.dateCeased.trim());

// ── 同人合併：相同 _personId 的多條記錄合併為一條（預備董事+董事 或 多角色）──
function dedupePersons(persons: Person[]): Person[] {
  const map = new Map<string, Person>();
  for (const p of persons) {
    const pid = (p as any)._personId || p.id;
    const existing = map.get(pid);
    if (existing) {
      // Preserve isReserve flag from either record so badge always shows
      const hasReserve = existing.isReserve || p.isReserve;
      // Both non-reserve plain duplicates → skip
      if (!hasReserve) continue;
      // Merge into a NEW object so originals are not mutated
      const base = !p.isReserve ? p : existing;
      map.set(pid, { ...base, isReserve: true } as Person);
    } else {
      map.set(pid, p);
    }
  }
  return Array.from(map.values());
}

// ── 成員合併：同一人（相同 _personId）持有多個角色時合併為一條 ──
interface MergedMember {
  key: string;
  name: string;
  nameChinese: string;
  identity: 'natural' | 'corporate';
  roles: string[];
  extras: string[];
  primaryPerson: Person | null;
  primaryShareholder: Shareholder | null;
}

/** Extract a human-readable person name from a change event */
function getPersonNameFromEvent(
  event: { event_type: string; person_id: string; new_value: string },
  company: Company | undefined,
): string {
  // Appointment events: extract from new_value JSON
  if (event.event_type.endsWith('_appoint') || event.event_type === 'shareholder_add') {
    try {
      const nv = JSON.parse(event.new_value || '{}');
      const en = nv.name_english || nv.name || '';
      const zh = nv.name_chinese || '';
      return zh ? `${en}（${zh}）` : en || '(未知)';
    } catch { return '(無法解析名稱)'; }
  }
  // Cessation events: look up person_id in company data
  if (event.person_id && company) {
    const allPeople: any[] = [
      ...(company.directors || []),
      ...(company.secretaries || []),
      ...(company.authorizedReps || []),
      ...(company.shareholders || []),
    ];
    const person = allPeople.find(p => (p as any)._personId === event.person_id);
    if (person) {
      const en = person.nameEnglish || '';
      const zh = person.nameChinese || '';
      return zh ? `${en}（${zh}）` : en || `(ID: ${event.person_id})`;
    }
    return `(ID: ${event.person_id})`;
  }
  return '(未知)';
}

function buildMergedMembers(
  directors: Person[],
  secretaries: Person[],
  authorizedReps: Person[],
  shareholders: Shareholder[],
): MergedMember[] {
  const map = new Map<string, MergedMember>();

  const addPerson = (p: Person, roleLabel: string, extra?: string) => {
    const pid = (p as any)._personId || p.id;
    if (!pid) return;
    let entry = map.get(pid);
    if (!entry) {
      entry = {
        key: pid,
        name: p.nameEnglish || p.nameChinese || '',
        nameChinese: p.nameChinese || '',
        identity: p.identity || 'natural',
        roles: [],
        extras: [],
        primaryPerson: null,
        primaryShareholder: null,
      };
      map.set(pid, entry);
    }
    if (!entry.roles.includes(roleLabel)) entry.roles.push(roleLabel);
    if (extra && !entry.extras.includes(extra)) entry.extras.push(extra);
    if (!entry.primaryPerson) entry.primaryPerson = p;
    if (p.nameEnglish || p.nameChinese) {
      entry.name = p.nameEnglish || p.nameChinese || '';
      if (p.nameChinese) entry.nameChinese = p.nameChinese;
    }
  };

  const addShareholder = (sh: Shareholder) => {
    const pid = (sh as any)._personId || sh.id;
    if (!pid) return;
    let entry = map.get(pid);
    if (!entry) {
      entry = {
        key: pid,
        name: sh.nameEnglish || sh.nameChinese || sh.name || '',
        nameChinese: sh.nameChinese || '',
        identity: sh.identity || 'natural',
        roles: [],
        extras: [],
        primaryPerson: null,
        primaryShareholder: null,
      };
      map.set(pid, entry);
    }
    if (!entry.roles.includes('股東')) entry.roles.push('股東');
    const shareExtra = `${(sh.shares || 0).toLocaleString()} 股`;
    if (!entry.extras.includes(shareExtra)) entry.extras.push(shareExtra);
    if (!entry.primaryShareholder) entry.primaryShareholder = sh;
    if (!entry.name) entry.name = sh.nameEnglish || sh.nameChinese || sh.name || '';
    if (!entry.nameChinese && sh.nameChinese) entry.nameChinese = sh.nameChinese;
  };

  for (const d of directors.filter(d => !isCeased(d))) {
    addPerson(d, '董事', d.isReserve ? '備選' : undefined);
  }
  for (const s of secretaries) {
    addPerson(s, '秘書', s.tcspNumber ? `TCSP ${s.tcspNumber}` : undefined);
  }
  for (const a of (authorizedReps || [])) {
    addPerson(a, '授權代表');
  }
  for (const sh of shareholders.filter(sh => !isCeased(sh))) {
    addShareholder(sh);
  }

  return Array.from(map.values());
}

export const CompanyDetailDialog = ({ open, onOpenChange, company }: CompanyDetailDialogProps) => {
  const [selectedPerson, setSelectedPerson] = useState<(Person & { roleLabel: string }) | null>(null);
  const [selectedSh, setSelectedSh] = useState<Shareholder | null>(null);
  const [editingCompany, setEditingCompany] = useState(false);
  const [editingPerson, setEditingPerson] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<string | null>(null);
  const [editingShDetail, setEditingShDetail] = useState(false);
  const [addingOfficer, setAddingOfficer] = useState<'director' | 'secretary' | 'authorized_representative' | null>(null);
  const [addingShareholder, setAddingShareholder] = useState(false);
  const [addingReserve, setAddingReserve] = useState(false);
  const [memberAddRole, setMemberAddRole] = useState<'director' | 'secretary' | 'shareholder' | 'authorized_representative' | null>(null);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyContext, setCopyContext] = useState<{ role: string; isReserve?: boolean } | null>(null);
  // 檢索服務 SE-04~SE-07：董事／股東 tab 的「當前／歷史」子視圖
  const [dirView, setDirView] = useState<'current' | 'historical'>('current');
  const [shView, setShView] = useState<'current' | 'historical'>('current');

  const [companyForm, setCompanyForm] = useState({ name: '', chineseName: '', brNumber: '', tradingName: '', businessNature: '', companyType: '', businessCode: '', regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '', incorporationDate: '', jurisdiction: 'Hong Kong', ciFilePath: '', brFilePath: '', email: '', phone: '', signerRoleId: '' });
  const [uploadingCi, setUploadingCi] = useState(false);
  const [uploadingBr, setUploadingBr] = useState(false);
  const [deletingCi, setDeletingCi] = useState(false);
  const [deletingBr, setDeletingBr] = useState(false);
  const [personForm, setPersonForm] = useState(emptyOfficerForm());
  const [newOfficerForm, setNewOfficerForm] = useState(emptyOfficerForm());

  const updateCompany = useUpdateCompany();
  const addOfficer = useAddOfficer();
  const updateOfficer = useUpdateOfficer();
  const deleteOfficer = useDeleteOfficer();
  const addShareholder = useAddShareholder();
  const updateShareholder = useUpdateShareholder();
  const deleteShareholder = useDeleteShareholder();
  const { data: secretaryTemplates = [] } = useSecretaryTemplates();
  const { data: unassignedChanges = [] } = useUnassignedChangeEvents(company?.id);
  const { data: allChangeEvents = [] } = useChangeEvents(company?.id);
  const undoEvent = useUndoChangeEvent();
  const { data: nar1Status } = useNAR1Status(company?.id);

  // ── 可供撤銷的人事變更事件 ──
  const personnelEvents = useMemo(() =>
    allChangeEvents.filter(e => UNDOABLE_EVENT_TYPES.has(e.event_type)),
    [allChangeEvents]
  );

  // ── 撤銷確認對話框狀態 ──
  const [undoConfirmOpen, setUndoConfirmOpen] = useState(false);
  const [undoConfirmTarget, setUndoConfirmTarget] = useState<ChangeEvent | null>(null);

  // ── 系統地址複製數據源 ──
  const { officers = [] } = useOfficers();
  const { data: companies = [] } = useCompanies();
  const [addrCopyId, setAddrCopyId] = useState('');
  const [svcAddrCopyId, setSvcAddrCopyId] = useState('');

  const addressSourceOptions = useMemo(() => {
    type AddrSource = { id: string; label: string; sub: string; meta: string; addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string };
    const sources: AddrSource[] = [];
    for (const c of companies) {
      if (!c.regFlat && !c.regBuilding && !c.regStreet && !c.regDistrict && !c.regRegion) continue;
      sources.push({
        id: `co-${c.id}`, label: `🏢 ${c.name}`,
        sub: [c.regFlat, c.regBuilding, c.regStreet, c.regDistrict, c.regRegion].filter(Boolean).join(', '),
        meta: '公司', addrFlat: c.regFlat || '', addrBuilding: c.regBuilding || '', addrStreet: c.regStreet || '', addrDistrict: c.regDistrict || '', addrRegion: c.regRegion || '',
      });
    }
    for (const p of officers) {
      if (!p.addrFlat && !p.addrBuilding && !p.addrStreet && !p.addrDistrict && !p.addrRegion) continue;
      sources.push({
        id: `pe-${p.id}`, label: `👤 ${p.nameEnglish || p.nameChinese}`,
        sub: [p.addrFlat, p.addrBuilding, p.addrStreet, p.addrDistrict, p.addrRegion].filter(Boolean).join(', '),
        meta: '人員', addrFlat: p.addrFlat || '', addrBuilding: p.addrBuilding || '', addrStreet: p.addrStreet || '', addrDistrict: p.addrDistrict || '', addrRegion: p.addrRegion || '',
      });
    }
    return sources;
  }, [companies, officers]);

  const fillAddrFromSource = (sourceId: string, targetForm: 'person' | 'newOfficer', target: 'residential' | 'service') => {
    setAddrCopyId(''); setSvcAddrCopyId('');
    const s = addressSourceOptions.find(x => x.id === sourceId);
    if (!s) return;
    const setForm = targetForm === 'person' ? setPersonForm : setNewOfficerForm;
    if (target === 'residential') {
      setForm(prev => ({ ...prev, addrFlat: s.addrFlat, addrBuilding: s.addrBuilding, addrStreet: s.addrStreet, addrDistrict: s.addrDistrict, addrRegion: s.addrRegion, address: [s.addrFlat, s.addrBuilding, s.addrStreet, s.addrDistrict, s.addrRegion].filter(Boolean).join(', ') }));
    } else {
      setForm(prev => ({ ...prev, svcAddrFlat: s.addrFlat, svcAddrBuilding: s.addrBuilding, svcAddrStreet: s.addrStreet, svcAddrDistrict: s.addrDistrict, svcAddrRegion: s.addrRegion, serviceAddress: [s.addrFlat, s.addrBuilding, s.addrStreet, s.addrDistrict, s.addrRegion].filter(Boolean).join(', ') }));
    }
  };

  useEffect(() => {
    // Only sync form from company when NOT in edit mode, to avoid wiping user input
    // when the companies query refetches in the background.
    if (company && !editingCompany) {
      setCompanyForm({
        name: company.name, chineseName: company.chineseName || '', brNumber: company.brNumber, tradingName: company.tradingName,
        businessNature: company.businessNature, companyType: company.companyType, businessCode: company.businessCode,
        regFlat: company.regFlat || '', regBuilding: company.regBuilding || '', regStreet: company.regStreet || '',
        regDistrict: company.regDistrict || '', regRegion: company.regRegion || '',
        incorporationDate: company.incorporationDate || '', jurisdiction: company.jurisdiction || 'Hong Kong',
        ciFilePath: company.ciFilePath || '', brFilePath: company.brFilePath || '',
        email: company.email || '', phone: company.phone || '',
        signerRoleId: company.signerRoleId || '',
      });
    }
  }, [company, editingCompany]);

  useEffect(() => {
    if (!selectedPerson) return;
    // 從最新的 company 資料中找回對應人員（mutation 成功後 query 會 invalidate 並重 fetch）
    const fresh = company
      ? [...company.directors, ...company.secretaries].find(p => p.id === selectedPerson.id)
      : null;
    const source = fresh ? { ...fresh, roleLabel: (selectedPerson as any).roleLabel } : selectedPerson;
    if (fresh && fresh !== selectedPerson) {
      setSelectedPerson(source as any);
    }
    setPersonForm({
      nameEnglish: source.nameEnglish, nameChinese: source.nameChinese,
      identity: source.identity, idNumber: source.idNumber || '',
      email: source.email || '',
      tcspNumber: source.tcspNumber || '',
      authScope: source.authScope || '',
      address: source.address || '',
      serviceAddress: source.serviceAddress || '',
      addrFlat: source.addrFlat || '',
      addrBuilding: source.addrBuilding || '',
      addrStreet: source.addrStreet || '',
      addrDistrict: source.addrDistrict || '',
      addrRegion: source.addrRegion || '',
      svcAddrFlat: source.svcAddrFlat || '',
      svcAddrBuilding: source.svcAddrBuilding || '',
      svcAddrStreet: source.svcAddrStreet || '',
      svcAddrDistrict: source.svcAddrDistrict || '',
      svcAddrRegion: source.svcAddrRegion || '',
      dateAppointed: source.dateAppointed || '',
      dateCeased: source.dateCeased || '', placeIncorporated: source.placeIncorporated || '',
      companyNumberRef: source.companyNumberRef || '',
      dateOfBirth: source.dateOfBirth || '',
    });
  }, [selectedPerson?.id, company]);

  useEffect(() => {
    if (!company || !selectedSh) return;
    const freshShareholder = company.shareholders.find(sh => sh.id === selectedSh.id);
    if (!freshShareholder) return;
    setSelectedSh(freshShareholder);
    if (!editingShDetail) {
    }
  }, [company, selectedSh, editingShDetail]);

  if (!company) return null;

  // 檢索服務 SE-04~SE-07：按辭任日期拆分當前／歷史成員
  const activeDirectors = company.directors.filter(d => !isCeased(d));
  const ceasedDirectors = company.directors.filter(d => isCeased(d));
  const activeShareholders = company.shareholders.filter(sh => !isCeased(sh));
  const ceasedShareholders = company.shareholders.filter(sh => isCeased(sh));
  const memberCount = (() => {
    const seen = new Set<string>();
    const add = (arr: any[]) => arr.forEach(x => { const pid = x?._personId || x?.id; if (pid) seen.add(pid); });
    add(activeDirectors);
    add(company.secretaries);
    add(activeShareholders);
    add(company.authorizedReps || []);
    return seen.size;
  })();

  // 計算實際生效的簽署人 ID（明確選擇 → 第一秘書 → 第一董事）
  const explicitSignerId = company.signerRoleId || '';
  const allOfficerIds = [...company.secretaries, ...company.directors].map(o => o.id);
  const effectiveSignerId = (explicitSignerId && allOfficerIds.includes(explicitSignerId))
    ? explicitSignerId
    : (company.secretaries[0]?.id || company.directors[0]?.id || '');

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setSelectedPerson(null); setSelectedSh(null); setEditingCompany(false);
      setEditingPerson(false); setEditingShDetail(false); setAddingOfficer(null);
      setAddingShareholder(false); setEditingShareholder(null);
      setDirView('current'); setShView('current');
    }
    onOpenChange(v);
  };

  const selectPerson = (p: Person, roleLabel: string) => {
    setSelectedSh(null); setEditingShDetail(false);
    setSelectedPerson({ ...p, roleLabel }); setEditingPerson(true);
    setPersonForm({
      ...emptyOfficerForm(),
      nameEnglish: p.nameEnglish || '',
      nameChinese: p.nameChinese || '',
      identity: p.identity || 'natural',
      idNumber: p.idNumber || '',
      email: p.email || '',
      tcspNumber: p.tcspNumber || '',
      authScope: (p as any).authScope || '',
      address: p.address || '',
      addrFlat: p.addrFlat || '',
      addrBuilding: p.addrBuilding || '',
      addrStreet: p.addrStreet || '',
      addrDistrict: p.addrDistrict || '',
      addrRegion: p.addrRegion || '',
      serviceAddress: p.serviceAddress || '',
      svcAddrFlat: p.svcAddrFlat || '',
      svcAddrBuilding: p.svcAddrBuilding || '',
      svcAddrStreet: p.svcAddrStreet || '',
      svcAddrDistrict: p.svcAddrDistrict || '',
      svcAddrRegion: p.svcAddrRegion || '',
      dateAppointed: (p as any).dateAppointed || '',
      dateCeased: (p as any).dateCeased || '',
      placeIncorporated: (p as any).placeIncorporated || '',
      companyNumberRef: p.companyNumberRef || '',
      dateOfBirth: (p as any).dateOfBirth || '',
    });
  };

  const selectShareholder = (sh: Shareholder) => {
    setSelectedPerson(null); setEditingPerson(false);
    setSelectedSh(sh);
    setEditingShDetail(true);
  };

  const handleSaveCompany = () => {
    updateCompany.mutate({ id: company.id, data: companyForm }, {
      onSuccess: () => { toast({ title: '公司資料已更新' }); setEditingCompany(false); },
      onError: () => toast({ title: '更新失敗', variant: 'destructive' }),
    });
  };

  const uploadDoc = async (file: File, kind: 'ci' | 'br') => {
    const setUploading = kind === 'ci' ? setUploadingCi : setUploadingBr;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `${company.id}/${kind}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('company-documents').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const field = kind === 'ci' ? 'ciFilePath' : 'brFilePath';
      setCompanyForm(prev => ({ ...prev, [field]: path }));
      // Only update the specific file path field to avoid overwriting other fields with stale form state
      updateCompany.mutate({ id: company.id, data: { [field]: path } }, {
        onSuccess: () => toast({ title: kind === 'ci' ? 'CI 已上傳' : 'BR 已上傳' }),
        onError: (e: any) => toast({ title: '上傳成功，儲存連結失敗', description: e?.message, variant: 'destructive' }),
      });
    } catch (e: any) {
      toast({ title: '上傳失敗', description: e.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const downloadDoc = async (path: string) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from('company-documents').createSignedUrl(path, 60);
    if (error || !data) { toast({ title: '取得連結失敗', variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank');
  };

  const downloadDocAsFile = async (path: string) => {
    if (!path) return;
    const filename = path.split('/').pop() || 'document';
    const { data, error } = await supabase.storage.from('company-documents').createSignedUrl(path, 60, { download: filename });
    if (error || !data) { toast({ title: '取得連結失敗', variant: 'destructive' }); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { a.remove(); } catch (_) { /* already removed */ } }, 100);
  };

  const deleteDoc = async (kind: 'ci' | 'br') => {
    const path = kind === 'ci' ? company.ciFilePath : company.brFilePath;
    if (!path) return;
    const setDeleting = kind === 'ci' ? setDeletingCi : setDeletingBr;
    setDeleting(true);
    try {
      // 刪除 R2/本地 storage 中的實際檔案（失敗不阻斷清除連結，避免孤兒引用殘留）
      const { error: rmErr } = await supabase.storage.from('company-documents').remove([path]);
      if (rmErr) console.warn('storage remove failed', rmErr);
      const field = kind === 'ci' ? 'ciFilePath' : 'brFilePath';
      setCompanyForm(prev => ({ ...prev, [field]: '' }));
      updateCompany.mutate({ id: company.id, data: { [field]: '' } }, {
        onSuccess: () => toast({ title: kind === 'ci' ? 'CI 已刪除' : 'BR 已刪除' }),
        onError: (e: any) => toast({ title: '刪除連結失敗', description: e?.message, variant: 'destructive' }),
      });
    } catch (e: any) {
      toast({ title: '刪除失敗', description: e.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const regAddrFull = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion].filter(Boolean).join(', ');

  const handleSavePerson = () => {
    if (!selectedPerson) return;
    updateOfficer.mutate({ id: selectedPerson.id, data: {
      name_english: personForm.nameEnglish, name_chinese: personForm.nameChinese,
      identity: personForm.identity, id_number: personForm.idNumber,
      email: personForm.email, tcsp_number: personForm.tcspNumber,
      auth_scope: personForm.authScope,
      address: personForm.address,
      addr_flat: personForm.addrFlat || '',
      addr_building: personForm.addrBuilding || '',
      addr_street: personForm.addrStreet || '',
      addr_district: personForm.addrDistrict || '',
      addr_region: personForm.addrRegion || '',
      service_address: personForm.serviceAddress || personForm.address || regAddrFull,
      svc_addr_flat: personForm.svcAddrFlat || '',
      svc_addr_building: personForm.svcAddrBuilding || '',
      svc_addr_street: personForm.svcAddrStreet || '',
      svc_addr_district: personForm.svcAddrDistrict || '',
      svc_addr_region: personForm.svcAddrRegion || '',
      date_appointed: personForm.dateAppointed || undefined,
      date_ceased: personForm.dateCeased || undefined,
      place_incorporated: personForm.placeIncorporated, company_number_ref: personForm.companyNumberRef,
      date_of_birth: personForm.dateOfBirth || undefined,
    }}, {
      onSuccess: () => { toast({ title: '人員資料已更新' }); setEditingPerson(false); },
      onError: () => toast({ title: '更新失敗', variant: 'destructive' }),
    });
  };

  const handleDeleteOfficer = (person: Person, label: string) => {
    console.log('[handleDeleteOfficer]', { id: person.id, _personId: (person as any)._personId, label, name: person.nameEnglish, isReserve: person.isReserve });
    if (!person.id) {
      toast({ title: '無法刪除：缺少記錄 ID', description: '請嘗試刷新頁面後再試', variant: 'destructive' });
      return;
    }
    deleteOfficer.mutate(person.id, {
      onSuccess: () => {
        toast({ title: `${label}已刪除`, description: person.nameEnglish || person.nameChinese });
        if (selectedPerson?.id === person.id) setSelectedPerson(null);
      },
      onError: (err: any) => {
        console.error('[handleDeleteOfficer] error:', err);
        const msg = err?.message || err?.error || String(err);
        const status = err?.status ? ` (HTTP ${err.status})` : '';
        toast({ title: '刪除失敗', description: `${msg}${status}`, variant: 'destructive' });
      },
    });
  };

  const handleAddOfficer = () => {
    if (!addingOfficer || !newOfficerForm.nameEnglish) {
      toast({ title: '請填寫英文名稱', variant: 'destructive' }); return;
    }
    if (!newOfficerForm.idNumber.trim()) {
      toast({ title: newOfficerForm.identity === 'corporate' ? '請填寫商業登記號碼' : '請填寫證件號碼', variant: 'destructive' }); return;
    }
    if (!newOfficerForm.email.trim()) {
      toast({ title: '請填寫電郵', variant: 'destructive' }); return;
    }
    if (!newOfficerForm.dateAppointed.trim()) {
      toast({ title: '請填寫委任日期', variant: 'destructive' }); return;
    }
    if (!newOfficerForm.dateOfBirth.trim()) {
      toast({ title: newOfficerForm.identity === 'corporate' ? '請填寫成立日期' : '請填寫出生日期', variant: 'destructive' }); return;
    }
    if (!newOfficerForm.address.trim()) {
      toast({ title: '請填寫居住地址', variant: 'destructive' }); return;
    }
    addOfficer.mutate({
      company_id: company.id, name_english: newOfficerForm.nameEnglish,
      name_chinese: newOfficerForm.nameChinese, role: addingOfficer,
      identity: newOfficerForm.identity, id_number: newOfficerForm.idNumber,
      email: newOfficerForm.email, tcsp_number: newOfficerForm.tcspNumber,
      auth_scope: newOfficerForm.authScope,
      address: newOfficerForm.address,
      addr_flat: newOfficerForm.addrFlat || '',
      addr_building: newOfficerForm.addrBuilding || '',
      addr_street: newOfficerForm.addrStreet || '',
      addr_district: newOfficerForm.addrDistrict || '',
      addr_region: newOfficerForm.addrRegion || '',
      service_address: newOfficerForm.serviceAddress || newOfficerForm.address || regAddrFull,
      svc_addr_flat: newOfficerForm.svcAddrFlat || '',
      svc_addr_building: newOfficerForm.svcAddrBuilding || '',
      svc_addr_street: newOfficerForm.svcAddrStreet || '',
      svc_addr_district: newOfficerForm.svcAddrDistrict || '',
      svc_addr_region: newOfficerForm.svcAddrRegion || '',
      date_appointed: newOfficerForm.dateAppointed || undefined,
      date_ceased: newOfficerForm.dateCeased || undefined,
      place_incorporated: newOfficerForm.placeIncorporated, company_number_ref: newOfficerForm.companyNumberRef,
      date_of_birth: newOfficerForm.dateOfBirth || undefined,
    }, {
      onSuccess: () => {
        toast({ title: `${addingOfficer === 'director' ? '董事' : addingOfficer === 'authorized_representative' ? '授權代表' : '秘書'}已新增` });
        setAddingOfficer(null); setNewOfficerForm(emptyOfficerForm());
      },
      onError: () => toast({ title: '新增失敗', variant: 'destructive' }),
    });
  };

  // 備選董事新增（ME-16/17）：角色 director + is_reserve
  const handleAddReserve = () => {
    if (!newOfficerForm.nameEnglish) { toast({ title: '請填寫英文名稱', variant: 'destructive' }); return; }
    if (!newOfficerForm.idNumber.trim()) { toast({ title: newOfficerForm.identity === 'corporate' ? '請填寫商業登記號碼' : '請填寫證件號碼', variant: 'destructive' }); return; }
    if (!newOfficerForm.email.trim()) { toast({ title: '請填寫電郵', variant: 'destructive' }); return; }
    if (!newOfficerForm.dateAppointed.trim()) { toast({ title: '請填寫委任日期', variant: 'destructive' }); return; }
    if (!newOfficerForm.dateOfBirth.trim()) { toast({ title: newOfficerForm.identity === 'corporate' ? '請填寫成立日期' : '請填寫出生日期', variant: 'destructive' }); return; }
    if (!newOfficerForm.address.trim()) { toast({ title: '請填寫居住地址', variant: 'destructive' }); return; }
    addOfficer.mutate({
      company_id: company.id, name_english: newOfficerForm.nameEnglish,
      name_chinese: newOfficerForm.nameChinese, role: 'director', is_reserve: true,
      identity: newOfficerForm.identity, id_number: newOfficerForm.idNumber,
      email: newOfficerForm.email, tcsp_number: newOfficerForm.tcspNumber,
      address: newOfficerForm.address,
      addr_flat: newOfficerForm.addrFlat || '',
      addr_building: newOfficerForm.addrBuilding || '',
      addr_street: newOfficerForm.addrStreet || '',
      addr_district: newOfficerForm.addrDistrict || '',
      addr_region: newOfficerForm.addrRegion || '',
      service_address: newOfficerForm.serviceAddress || newOfficerForm.address || regAddrFull,
      svc_addr_flat: newOfficerForm.svcAddrFlat || '',
      svc_addr_building: newOfficerForm.svcAddrBuilding || '',
      svc_addr_street: newOfficerForm.svcAddrStreet || '',
      svc_addr_district: newOfficerForm.svcAddrDistrict || '',
      svc_addr_region: newOfficerForm.svcAddrRegion || '',
      date_appointed: newOfficerForm.dateAppointed || undefined,
      date_ceased: newOfficerForm.dateCeased || undefined,
      place_incorporated: newOfficerForm.placeIncorporated, company_number_ref: newOfficerForm.companyNumberRef,
      date_of_birth: newOfficerForm.dateOfBirth || undefined,
    }, {
      onSuccess: () => { toast({ title: '備選董事已新增' }); setAddingReserve(false); setNewOfficerForm(emptyOfficerForm()); },
      onError: () => toast({ title: '新增失敗', variant: 'destructive' }),
    });
  };

  // 成員 tab 統一新增（ME-02）：officer 角色走 addOfficer，股東走 addShareholder
  const handleAddMemberOfficer = (role: 'director' | 'secretary' | 'authorized_representative') => {
    if (!newOfficerForm.nameEnglish) { toast({ title: '請填寫英文名稱', variant: 'destructive' }); return; }
    if (!newOfficerForm.idNumber.trim()) { toast({ title: newOfficerForm.identity === 'corporate' ? '請填寫商業登記號碼' : '請填寫證件號碼', variant: 'destructive' }); return; }
    if (!newOfficerForm.email.trim()) { toast({ title: '請填寫電郵', variant: 'destructive' }); return; }
    if (!newOfficerForm.dateAppointed.trim()) { toast({ title: '請填寫委任日期', variant: 'destructive' }); return; }
    if (!newOfficerForm.dateOfBirth.trim()) { toast({ title: newOfficerForm.identity === 'corporate' ? '請填寫成立日期' : '請填寫出生日期', variant: 'destructive' }); return; }
    if (!newOfficerForm.address.trim()) { toast({ title: '請填寫居住地址', variant: 'destructive' }); return; }
    addOfficer.mutate({
      company_id: company.id, name_english: newOfficerForm.nameEnglish,
      name_chinese: newOfficerForm.nameChinese, role,
      identity: newOfficerForm.identity, id_number: newOfficerForm.idNumber,
      email: newOfficerForm.email, tcsp_number: newOfficerForm.tcspNumber,
      auth_scope: newOfficerForm.authScope,
      address: newOfficerForm.address,
      addr_flat: newOfficerForm.addrFlat || '',
      addr_building: newOfficerForm.addrBuilding || '',
      addr_street: newOfficerForm.addrStreet || '',
      addr_district: newOfficerForm.addrDistrict || '',
      addr_region: newOfficerForm.addrRegion || '',
      service_address: newOfficerForm.serviceAddress || newOfficerForm.address || regAddrFull,
      svc_addr_flat: newOfficerForm.svcAddrFlat || '',
      svc_addr_building: newOfficerForm.svcAddrBuilding || '',
      svc_addr_street: newOfficerForm.svcAddrStreet || '',
      svc_addr_district: newOfficerForm.svcAddrDistrict || '',
      svc_addr_region: newOfficerForm.svcAddrRegion || '',
      date_appointed: newOfficerForm.dateAppointed || undefined,
      place_incorporated: newOfficerForm.placeIncorporated, company_number_ref: newOfficerForm.companyNumberRef,
      date_of_birth: newOfficerForm.dateOfBirth || undefined,
    }, {
      onSuccess: () => {
        toast({ title: `${role === 'director' ? '董事' : role === 'authorized_representative' ? '授權代表' : '秘書'}已新增` });
        setMemberAddRole(null); setNewOfficerForm(emptyOfficerForm());
      },
      onError: () => toast({ title: '新增失敗', variant: 'destructive' }),
    });
  };

  const handleAddMemberShareholder = (data: ShFormType) => {
    if (!data.name && !data.nameEnglish) { toast({ title: '請填寫股東名稱', variant: 'destructive' }); return; }
    addShareholder.mutate({
      company_id: company.id, name: data.name || data.nameEnglish,
      name_english: data.nameEnglish, name_chinese: data.nameChinese,
      shares: data.shares, identity: data.identity, id_number: data.idNumber,
      address: data.address, service_address: data.serviceAddress || data.address || regAddrFull,
      email: data.email, share_type: data.shareType,
      issue_price: data.issuePrice, currency: data.currency,
      paid_up: data.paidUp, unpaid: data.unpaid,
      place_incorporated: data.placeIncorporated, company_number_ref: data.companyNumberRef, tcsp_number: data.tcspNumber,
    }, {
      onSuccess: () => { toast({ title: '股東已新增' }); setMemberAddRole(null); },
      onError: () => toast({ title: '新增失敗', variant: 'destructive' }),
    });
  };

  const handleToggleReserve = (officer: Person) => {
    updateOfficer.mutate(
      { id: officer.id, data: { is_reserve: !officer.isReserve } },
      {
        onSuccess: () => toast({
          title: officer.isReserve ? '已取消預備董事' : '已設為預備董事',
          description: officer.nameEnglish || officer.nameChinese,
        }),
        onError: (e: any) => toast({ title: '更新失敗', description: e.message, variant: 'destructive' }),
      }
    );
  };

  const handleSaveShareholder = (id: string, data: ShFormType) => {
    const nextShareholder: Shareholder = {
      id,
      name: data.name || data.nameEnglish || data.nameChinese,
      nameEnglish: data.nameEnglish,
      nameChinese: data.nameChinese,
      shares: data.shares,
      identity: data.identity as Shareholder['identity'],
      idNumber: data.idNumber,
      address: data.address,
      serviceAddress: data.serviceAddress || data.address || regAddrFull,
      email: data.email,
      shareType: data.shareType,
      issuePrice: data.issuePrice,
      currency: data.currency,
      paidUp: data.paidUp,
      unpaid: data.unpaid,
      placeIncorporated: data.placeIncorporated,
      companyNumberRef: data.companyNumberRef,
      tcspNumber: data.tcspNumber,
    };

    updateShareholder.mutate({ id, data: { name: nextShareholder.name, name_english: nextShareholder.nameEnglish, name_chinese: nextShareholder.nameChinese, shares: nextShareholder.shares, identity: nextShareholder.identity, id_number: nextShareholder.idNumber, address: nextShareholder.address, service_address: nextShareholder.serviceAddress, email: nextShareholder.email, share_type: nextShareholder.shareType, issue_price: data.issuePrice, currency: data.currency, paid_up: data.paidUp, unpaid: data.unpaid, place_incorporated: data.placeIncorporated, company_number_ref: data.companyNumberRef, tcsp_number: data.tcspNumber } }, {
      onSuccess: () => { toast({ title: '股東已更新' }); setEditingShareholder(null); setEditingShDetail(false); if (selectedSh?.id === id) setSelectedSh(nextShareholder); },
      onError: () => toast({ title: '更新失敗', variant: 'destructive' }),
    });
  };

  const handleAddShareholder = (data: ShFormType) => {
    if (!data.name && !data.nameEnglish) { toast({ title: '請填寫股東名稱', variant: 'destructive' }); return; }
    addShareholder.mutate({
      company_id: company.id, name: data.name || data.nameEnglish,
      name_english: data.nameEnglish, name_chinese: data.nameChinese,
      shares: data.shares, identity: data.identity, id_number: data.idNumber,
      address: data.address, service_address: data.serviceAddress || data.address || regAddrFull,
      email: data.email, share_type: data.shareType,
      issue_price: data.issuePrice, currency: data.currency,
      paid_up: data.paidUp, unpaid: data.unpaid,
      place_incorporated: data.placeIncorporated, company_number_ref: data.companyNumberRef, tcsp_number: data.tcspNumber,
    }, {
      onSuccess: () => {
        toast({ title: '股東已新增' });
        setAddingShareholder(false);
      },
      onError: () => toast({ title: '新增失敗', variant: 'destructive' }),
    });
  };

  const handleDeleteShareholder = (sh: Shareholder) => {
    deleteShareholder.mutate(sh.id, {
      onSuccess: () => toast({ title: '股東已刪除', description: sh.name }),
      onError: () => toast({ title: '刪除失敗', variant: 'destructive' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="!flex !flex-col w-[98vw] max-w-[98vw] h-[98vh] max-h-[98vh] overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Building2 className="h-5 w-5 text-primary" />
            {company.name}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {company.chineseName || company.name} 的詳細資料，包含公司資料、成員、股本、公司誌等
          </DialogDescription>
        </DialogHeader>

        {/* NAR1 待辦變更提示 (Phase 3.4 + Phase 4) */}
        {(unassignedChanges.length > 0 || (nar1Status && nar1Status.due_date)) && (
          <div className="px-6 py-2 shrink-0 space-y-2">
            {/* NAR1 Due Date Status Banner (Phase 4) */}
            {nar1Status && nar1Status.due_date && (() => {
              const badge = getNAR1StatusBadge(nar1Status.status);
              const isUrgent = nar1Status.status === 'late' || nar1Status.status === 'due_soon';
              return (
                <div className={`flex items-start gap-2 p-3 rounded-md border text-sm ${
                  isUrgent
                    ? 'border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800'
                    : 'border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800'
                }`}>
                  <span className="text-base shrink-0 mt-0.5">{isUrgent ? '🔴' : '📅'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${isUrgent ? 'text-red-900 dark:text-red-100' : 'text-blue-900 dark:text-blue-100'}`}>
                      NAR1 週年申報：{nar1Status.period_start} ~ {nar1Status.period_end}
                    </p>
                    <p className={`mt-0.5 ${isUrgent ? 'text-red-800 dark:text-red-200' : 'text-blue-800 dark:text-blue-200'}`}>
                      到期日：{nar1Status.due_date}
                      <span className={`inline-block ml-2 px-2 py-0.5 rounded-full text-xs ${badge.bgColor} ${badge.color}`}>
                        {badge.label}
                      </span>
                      {nar1Status.days_remaining !== undefined && (
                        <span className="ml-1">
                          {nar1Status.days_remaining < 0
                            ? `（已逾期 ${Math.abs(nar1Status.days_remaining)} 天）`
                            : nar1Status.days_remaining === 0
                            ? '（今日到期！）'
                            : `（還有 ${nar1Status.days_remaining} 天）`}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })()}
            {/* Unassigned Changes Warning (Phase 3.4) */}
            {unassignedChanges.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 text-sm">
                <span className="text-base shrink-0 mt-0.5">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-amber-900 dark:text-amber-100">
                    自上次 NAR1 申報以來，有 {unassignedChanges.length} 項未申報變更：
                  </p>
                  <p className="text-amber-800 dark:text-amber-200 mt-0.5">
                    {unassignedChanges.slice(0, 5).map((e, i) => (
                      <span key={e.id}>
                        {i > 0 && '、'}
                        {EVENT_TYPE_LABELS[e.event_type] || e.event_type}
                      </span>
                    ))}
                    {unassignedChanges.length > 5 && ` 等${unassignedChanges.length}項`}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-hidden flex">
          {/* Left: Tabbed content */}
          <div className={`overflow-y-auto p-6 pt-2 transition-all ${(selectedPerson || selectedSh) ? 'w-1/2 border-r border-border' : 'w-full'}`}>

            <Tabs defaultValue="info" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="info" className="gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> 基本資料
                </TabsTrigger>
                <TabsTrigger value="attachments" className="gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" /> 附件
                  <Badge variant="secondary" className="text-xs ml-1">{[company.ciFilePath, company.brFilePath].filter(Boolean).length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="members" className="gap-1.5">
                  <UsersRound className="h-3.5 w-3.5" /> 成員
                  <Badge variant="secondary" className="text-xs ml-1">{memberCount}</Badge>
                </TabsTrigger>
                <TabsTrigger value="directors" className="gap-1.5">
                  <Users className="h-3.5 w-3.5" /> 董事
                  <Badge variant="secondary" className="text-xs ml-1">{dedupePersons(activeDirectors).length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="secretaries" className="gap-1.5">
                  <UserCheck className="h-3.5 w-3.5" /> 秘書
                  <Badge variant="secondary" className="text-xs ml-1">{company.secretaries.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="shareholders" className="gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" /> 股東
                  <Badge variant="secondary" className="text-xs ml-1">{activeShareholders.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="sharecapital" className="gap-1.5">
                  <Landmark className="h-3.5 w-3.5" /> 股本
                </TabsTrigger>
                <TabsTrigger value="authreps" className="gap-1.5">
                  <UserCog className="h-3.5 w-3.5" /> 授權代表
                  <Badge variant="secondary" className="text-xs ml-1">{(company.authorizedReps || []).length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="reserve" className="gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" /> 備選董事
                  <Badge variant="secondary" className="text-xs ml-1">{dedupePersons(company.directors.filter(d => d.isReserve)).length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="scr" className="gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> 重要控制人
                </TabsTrigger>
                <TabsTrigger value="registers" className="gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> 登記冊
                </TabsTrigger>
                <TabsTrigger value="docgen" className="gap-1.5">
                  <FileOutput className="h-3.5 w-3.5" /> 文件生成
                </TabsTrigger>
                <TabsTrigger value="chronicle" className="gap-1.5">
                  <FileClock className="h-3.5 w-3.5" /> 公司誌
                </TabsTrigger>
              </TabsList>

              {/* Tab: 附件 (CI / BR) */}
              <TabsContent value="attachments">
                <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
                  <Paperclip className="h-4 w-4 text-primary" /> 公司附件
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <DocSlot label="公司註冊證書 (CI)" path={company.ciFilePath} uploading={uploadingCi} deleting={deletingCi}
                    onUpload={(f) => uploadDoc(f, 'ci')} onView={() => downloadDoc(company.ciFilePath || '')}
                    onDownload={() => downloadDocAsFile(company.ciFilePath || '')} onDelete={() => deleteDoc('ci')} />
                  <DocSlot label="商業登記證 (BR)" path={company.brFilePath} uploading={uploadingBr} deleting={deletingBr}
                    onUpload={(f) => uploadDoc(f, 'br')} onView={() => downloadDoc(company.brFilePath || '')}
                    onDownload={() => downloadDocAsFile(company.brFilePath || '')} onDelete={() => deleteDoc('br')} />
                </div>
                {(company.ciFilePath || company.brFilePath) ? (
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    {company.ciFilePath && <DocPreview path={company.ciFilePath} label="公司註冊證書 (CI)" />}
                    {company.brFilePath && <DocPreview path={company.brFilePath} label="商業登記證 (BR)" />}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm mt-4">尚未上傳任何附件（可拖放或點擊上傳 CI／BR）</p>
                )}
              </TabsContent>

              {/* Tab: 基本資料 */}
              <TabsContent value="info">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">基本資料</h3>
                  {!editingCompany ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditingCompany(true)}>
                      <Edit className="h-3.5 w-3.5 mr-1" /> 編輯
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditingCompany(false)}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
                      <Button size="sm" onClick={handleSaveCompany} className="bg-primary text-primary-foreground"><Save className="h-3.5 w-3.5 mr-1" /> 儲存</Button>
                    </div>
                  )}
                </div>

                {!editingCompany ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <InfoItem label="英文名稱" value={company.name} />
                    <InfoItem label="中文名稱" value={company.chineseName} />
                    <InfoItem label="商業登記號碼" value={company.brNumber} />
                    <InfoItem label="商業名稱" value={company.tradingName} />
                    <InfoItem label="公司類型" value={company.companyType} />
                    <InfoItem label="業務性質" value={company.businessNature} />
                    <InfoItem label="業務代碼" value={company.businessCode} />
                    <InfoItem label="成立日期" value={company.incorporationDate} />
                    <InfoItem label="司法管轄區" value={company.jurisdiction} />
                    <InfoItem label="電郵地址" value={company.email} />
                    <InfoItem label="電話" value={company.phone} />
                    {nar1Status && nar1Status.due_date && (() => {
                      const badge = getNAR1StatusBadge(nar1Status.status);
                      return (
                        <>
                          <InfoItem label="NAR1 到期日" value={nar1Status.due_date} />
                          <div>
                            <Label className="text-xs text-muted-foreground">NAR1 狀態</Label>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-sm font-medium ${badge.color}`}>
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${badge.bgColor} ${badge.color}`}>
                                  {badge.label}
                                </span>
                              </span>
                              {nar1Status.days_remaining !== undefined && (
                                <span className={`text-xs ${nar1Status.days_remaining < 0 ? 'text-red-600' : nar1Status.days_remaining <= 7 ? 'text-orange-600' : 'text-muted-foreground'}`}>
                                  {nar1Status.days_remaining < 0
                                    ? `已逾期 ${Math.abs(nar1Status.days_remaining)} 天`
                                    : nar1Status.days_remaining === 0
                                    ? '今日到期'
                                    : `還有 ${nar1Status.days_remaining} 天`}
                                </span>
                              )}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                    <div className="col-span-2">
                      <InfoItem label="註冊辦事處地址" value={[company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion].filter(Boolean).join(', ') || '—'} />
                    </div>
                    <InfoItem label="最後更新" value={company.updatedAt} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="space-y-1"><Label className="text-xs">公司英文名稱</Label><Input value={companyForm.name} onChange={e => setCompanyForm({ ...companyForm, name: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">公司中文名稱</Label><Input value={companyForm.chineseName} onChange={e => setCompanyForm({ ...companyForm, chineseName: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">商業登記號碼</Label><Input value={companyForm.brNumber} onChange={e => setCompanyForm({ ...companyForm, brNumber: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">商業名稱</Label><Input value={companyForm.tradingName} onChange={e => setCompanyForm({ ...companyForm, tradingName: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">業務性質</Label><Input value={companyForm.businessNature} onChange={e => setCompanyForm({ ...companyForm, businessNature: e.target.value })} /></div>
                    <div className="space-y-1">
                      <Label className="text-xs">公司類型</Label>
                      <Select value={companyForm.companyType} onValueChange={v => setCompanyForm({ ...companyForm, companyType: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="私人公司 Private company">私人公司 Private company</SelectItem>
                          <SelectItem value="公眾公司 Public company">公眾公司 Public company</SelectItem>
                          <SelectItem value="擔保有限公司 Company limited by guarantee">擔保有限公司</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">業務代碼</Label><Input value={companyForm.businessCode} onChange={e => setCompanyForm({ ...companyForm, businessCode: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">成立日期</Label><Input type="date" value={companyForm.incorporationDate} onChange={e => setCompanyForm({ ...companyForm, incorporationDate: e.target.value })} /></div>
                    <div className="space-y-1">
                      <Label className="text-xs">司法管轄區 Jurisdiction</Label>
                      <Input list="jurisdiction-list" value={companyForm.jurisdiction}
                        onChange={e => setCompanyForm({ ...companyForm, jurisdiction: e.target.value })}
                        placeholder="Hong Kong / BVI / Cayman Islands ..." />
                      <datalist id="jurisdiction-list">
                        <option value="Hong Kong" />
                        <option value="BVI" />
                        <option value="Seychelles" />
                        <option value="Samoa" />
                        <option value="Cayman Islands" />
                      </datalist>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">電郵地址</Label><Input type="email" value={companyForm.email} onChange={e => setCompanyForm({ ...companyForm, email: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">電話</Label><Input value={companyForm.phone} onChange={e => setCompanyForm({ ...companyForm, phone: e.target.value })} /></div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">公司簽署人 (NAR1)</Label>
                      <Select
                        value={companyForm.signerRoleId || '__auto__'}
                        onValueChange={v => setCompanyForm({ ...companyForm, signerRoleId: v === '__auto__' ? '' : v })}
                      >
                        <SelectTrigger><SelectValue placeholder="自動 (秘書優先，否則第一董事)" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto__">自動 — 秘書優先，否則第一董事</SelectItem>
                          {company.secretaries.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              秘書：{s.nameEnglish || s.nameChinese || '(無名稱)'}
                            </SelectItem>
                          ))}
                          {company.directors.map(d => (
                            <SelectItem key={d.id} value={d.id}>
                              董事：{d.nameEnglish || d.nameChinese || '(無名稱)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 border-t border-border pt-3 mt-2">
                      <Label className="text-xs font-medium">註冊辦事處地址</Label>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="space-y-1"><Label className="text-xs">室／樓／座</Label><Input value={companyForm.regFlat} onChange={e => setCompanyForm({ ...companyForm, regFlat: e.target.value })} /></div>
                        <div className="space-y-1"><Label className="text-xs">大廈</Label><Input value={companyForm.regBuilding} onChange={e => setCompanyForm({ ...companyForm, regBuilding: e.target.value })} /></div>
                        <div className="col-span-2 space-y-1"><Label className="text-xs">街道</Label><Input value={companyForm.regStreet} onChange={e => setCompanyForm({ ...companyForm, regStreet: e.target.value })} /></div>
                        <div className="space-y-1"><Label className="text-xs">區</Label><Input value={companyForm.regDistrict} onChange={e => setCompanyForm({ ...companyForm, regDistrict: e.target.value })} /></div>
                        <div className="space-y-1">
                          <Label className="text-xs">地區</Label>
                          <Input value={companyForm.regRegion} onChange={e => setCompanyForm({ ...companyForm, regRegion: e.target.value })} placeholder="香港" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <TabChangeEventsFooter
                  companyId={company.id}
                  company={company}
                  eventTypes={['address_change', 'name_change', 'company_email_change', 'company_phone_change']}
                  label="公司資料變更記錄"
                />
              </TabsContent>

              {/* Tab: 成員總覽 (ME-01 / ME-02) */}
              <TabsContent value="members">
                <div className="flex items-center justify-between mb-3">
                  <SectionHeader icon={<UsersRound className="h-4 w-4 text-primary" />} title="公司成員總覽" count={memberCount} />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setCopyContext(null); setCopyDialogOpen(true); }}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> 從所有公司複製
                    </Button>
                    {memberAddRole === null && (
                      <Button variant="ghost" size="sm" onClick={() => { setMemberAddRole('director'); setNewOfficerForm({ ...emptyOfficerForm(), serviceAddress: regAddrFull }); }}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> 新增成員
                      </Button>
                    )}
                  </div>
                </div>

                {memberAddRole !== null && (
                  <div className="mb-3 space-y-2">
                    <div className="rounded-md border border-primary/50 bg-primary/5 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs">指派角色（ME-02）</Label>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setMemberAddRole(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Select value={memberAddRole} onValueChange={(v: 'director' | 'secretary' | 'shareholder' | 'authorized_representative') => setMemberAddRole(v)}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="director">董事</SelectItem>
                          <SelectItem value="secretary">秘書</SelectItem>
                          <SelectItem value="shareholder">股東</SelectItem>
                          <SelectItem value="authorized_representative">授權代表</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {memberAddRole === 'shareholder' ? (
                      <ShareholderEditForm mode="full" initialData={{ serviceAddress: regAddrFull }} companyId={company.id} defaultServiceAddress={regAddrFull} onSave={handleAddMemberShareholder} onCancel={() => setMemberAddRole(null)} />
                    ) : (
                      <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm}
                        onSave={() => handleAddMemberOfficer(memberAddRole)} onCancel={() => setMemberAddRole(null)}
                        isSecretary={memberAddRole === 'secretary'} templates={secretaryTemplates}
                        showAuthScope={memberAddRole === 'authorized_representative'}
                        addressSourceOptions={addressSourceOptions} fillAddrFromSource={fillAddrFromSource} />
                    )}
                  </div>
                )}

                {(() => {
                  const merged = buildMergedMembers(activeDirectors, company.secretaries, company.authorizedReps || [], activeShareholders);
                  return merged.length > 0 ? (
                    <div className="grid gap-2">
                      {merged.map((mm) => {
                        const pid = mm.key;
                        const isOfficerSelected =
                          selectedPerson?.id === mm.primaryPerson?.id ||
                          (mm.primaryPerson && (selectedPerson as any)?._personId === pid);
                        const isShSelected = selectedSh?.id === mm.primaryShareholder?.id;

                        const handleClick = () => {
                          if (mm.primaryPerson) {
                            selectPerson(mm.primaryPerson, mm.roles[0] || '成員');
                          } else if (mm.primaryShareholder) {
                            selectShareholder(mm.primaryShareholder);
                          }
                        };

                        return (
                          <MemberRow
                            key={mm.key}
                            name={mm.name}
                            sub={mm.nameChinese || undefined}
                            roles={mm.roles}
                            identity={mm.identity}
                            extras={mm.extras.length > 0 ? mm.extras : undefined}
                            selected={isOfficerSelected || isShSelected}
                            onClick={handleClick}
                          />
                        );
                      })}
                    </div>
                  ) : memberAddRole === null ? (
                    <p className="text-muted-foreground text-sm">尚無成員記錄</p>
                  ) : null;
                })()}

                {/* 變更歷史（可撤銷） */}
                {personnelEvents.length > 0 && (
                  <div className="mt-6 border-t border-border pt-4">
                    <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                      <FileClock className="h-4 w-4 text-primary" />
                      變更歷史
                      <Badge variant="secondary" className="text-xs">{personnelEvents.length}</Badge>
                      <span className="text-xs text-muted-foreground font-normal">可撤銷的變更記錄</span>
                    </h3>
                    <div className="grid gap-2">
                      {personnelEvents.slice(0, 30).map((event) => {
                        const label = EVENT_TYPE_LABELS[event.event_type] || event.event_type;
                        const isAppoint = event.event_type.endsWith('_appoint') || event.event_type === 'shareholder_add';
                        const personName = getPersonNameFromEvent(event, company);

                        return (
                          <div key={event.id}
                            className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm group hover:bg-muted/60 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className={`shrink-0 ${isAppoint ? 'text-green-600' : 'text-destructive'}`}>
                                {isAppoint ? <Upload className="h-3.5 w-3.5 rotate-90" /> : <Download className="h-3.5 w-3.5 rotate-90" />}
                              </span>
                              <Badge variant={isAppoint ? 'default' : 'destructive'}
                                className={`text-xs shrink-0 ${isAppoint ? 'bg-green-600 hover:bg-green-600' : ''}`}
                              >
                                {label}
                              </Badge>
                              {personName && (
                                <span className="font-medium truncate text-xs">{personName}</span>
                              )}
                              <span className="text-xs font-mono text-muted-foreground shrink-0 ml-auto">
                                {event.change_date}
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 ml-2 hidden group-hover:flex text-destructive shrink-0"
                              disabled={undoEvent.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                setUndoConfirmTarget(event);
                                setUndoConfirmOpen(true);
                              }}
                            >
                              {undoEvent.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Undo2 className="h-3 w-3" />
                              )}
                              <span className="ml-1 text-xs">撤銷</span>
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 委任／辭任日期歷史 (VE-06) */}
                <div className="mt-6 border-t border-border pt-4">
                  <PersonnelSection company={company} />
                </div>
              </TabsContent>

              {/* Tab: 董事 (ME-03 / ME-04 / ME-05 · SE-06 當前 / SE-07 歷史) */}
              <TabsContent value="directors">
                <div className="flex items-center justify-between mb-3">
                  <HistoryToggle
                    view={dirView} onChange={setDirView}
                    currentLabel="當前董事" currentCount={dedupePersons(activeDirectors).length}
                    historicalLabel="歷史董事" historicalCount={dedupePersons(ceasedDirectors).length}
                  />
                  <Button variant="outline" size="sm" onClick={() => { setCopyContext(null); setCopyDialogOpen(true); }}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> 從所有公司複製
                  </Button>
                </div>

                {dirView === 'current' ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <SectionHeader icon={<Users className="h-4 w-4 text-primary" />} title="當前董事" count={dedupePersons(activeDirectors).length} />
                      <Button variant="ghost" size="sm" onClick={() => { setAddingOfficer('director'); setNewOfficerForm({ ...emptyOfficerForm(), serviceAddress: regAddrFull }); }}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                      </Button>
                    </div>
                    {addingOfficer === 'director' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} addressSourceOptions={addressSourceOptions} fillAddrFromSource={fillAddrFromSource} />}
                    {(() => {
                      const deduped = dedupePersons(activeDirectors);
                      return deduped.length > 0 ? (
                        <div className="grid gap-2">
                          {deduped.map((d, i) => (
                            <PersonRow key={i} person={d} isSelected={selectedPerson?.id === d.id}
                              isSigner={effectiveSignerId === d.id}
                              onClick={() => selectPerson(d, '董事')}
                              onToggleReserve={() => handleToggleReserve(d)}
                              onDelete={() => handleDeleteOfficer(d, '董事')} />
                          ))}
                        </div>
                      ) : (!addingOfficer && <p className="text-muted-foreground text-sm">無當前董事記錄</p>);
                    })()}
                  </>
                ) : (
                  <>
                    <SectionHeader icon={<Users className="h-4 w-4 text-muted-foreground" />} title="歷史董事（已辭任）" count={ceasedDirectors.length} />
                    {(() => {
                      const deduped = dedupePersons(ceasedDirectors);
                      return deduped.length > 0 ? (
                        <div className="grid gap-2 mt-2">
                          {deduped.map((d, i) => (
                            <PersonRow key={i} person={d} historical isSelected={selectedPerson?.id === d.id}
                              onClick={() => selectPerson(d, '董事')}
                              onDelete={() => handleDeleteOfficer(d, '董事')} />
                          ))}
                        </div>
                      ) : (<p className="text-muted-foreground text-sm mt-2">無已辭任董事記錄</p>);
                    })()}
                  </>
                )}
                <TabChangeEventsFooter
                  companyId={company.id}
                  company={company}
                  eventTypes={['director_appoint', 'director_cease']}
                  label="董事變更記錄"
                />
              </TabsContent>

              {/* Tab: 秘書 (ME-09 / ME-10 / ME-11) */}
              <TabsContent value="secretaries">
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<UserCheck className="h-4 w-4 text-primary" />} title="秘書" count={company.secretaries.length} />
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setCopyContext(null); setCopyDialogOpen(true); }}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> 從所有公司複製
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setAddingOfficer('secretary'); setNewOfficerForm({ ...emptyOfficerForm(), serviceAddress: regAddrFull }); }}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                    </Button>
                  </div>
                </div>
                {addingOfficer === 'secretary' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} isSecretary templates={secretaryTemplates} addressSourceOptions={addressSourceOptions} fillAddrFromSource={fillAddrFromSource} />}
                {company.secretaries.length > 0 ? (
                  <div className="grid gap-2">
                    {company.secretaries.map((s, i) => (
                      <PersonRow key={i} person={s} isSelected={selectedPerson?.id === s.id}
                        isSigner={effectiveSignerId === s.id}
                        onClick={() => selectPerson(s, '秘書')}
                        onDelete={() => handleDeleteOfficer(s, '秘書')} />
                    ))}
                  </div>
                ) : !addingOfficer && <p className="text-muted-foreground text-sm">無秘書記錄</p>}
                <TabChangeEventsFooter
                  companyId={company.id}
                  company={company}
                  eventTypes={['secretary_appoint', 'secretary_cease']}
                  label="秘書變更記錄"
                />
              </TabsContent>

              {/* Tab: 授權代表 (ME-12 / ME-13) */}
              <TabsContent value="authreps">
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<UserCog className="h-4 w-4 text-primary" />} title="授權代表" count={(company.authorizedReps || []).length} />
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setCopyContext({ role: 'authorized_representative' }); setCopyDialogOpen(true); }}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> 從所有公司複製
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setAddingOfficer('authorized_representative'); setNewOfficerForm({ ...emptyOfficerForm(), serviceAddress: regAddrFull }); }}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                    </Button>
                  </div>
                </div>
                {addingOfficer === 'authorized_representative' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} showAuthScope addressSourceOptions={addressSourceOptions} fillAddrFromSource={fillAddrFromSource} />}
                {(company.authorizedReps || []).length > 0 ? (
                  <div className="grid gap-2">
                    {(company.authorizedReps || []).map((a, i) => (
                      <PersonRow key={i} person={a} isSelected={selectedPerson?.id === a.id}
                        onClick={() => selectPerson(a, '授權代表')}
                        onDelete={() => handleDeleteOfficer(a, '授權代表')} />
                    ))}
                  </div>
                ) : !addingOfficer && <p className="text-muted-foreground text-sm">無授權代表記錄</p>}
              </TabsContent>

              {/* Tab: 備選董事 (ME-16 / ME-17) */}
              <TabsContent value="reserve">
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<UserPlus className="h-4 w-4 text-primary" />} title="備選董事" count={(() => { const reserved = company.directors.filter(d => d.isReserve); const deduped = dedupePersons(reserved); return deduped.length; })()} />
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setCopyContext({ role: 'director', isReserve: true }); setCopyDialogOpen(true); }}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> 從所有公司複製
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setAddingReserve(true); setNewOfficerForm({ ...emptyOfficerForm(), serviceAddress: regAddrFull }); }}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                    </Button>
                  </div>
                </div>
                {addingReserve && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddReserve} onCancel={() => setAddingReserve(false)} addressSourceOptions={addressSourceOptions} fillAddrFromSource={fillAddrFromSource} />}
                {(() => {
                  const deduped = dedupePersons(company.directors.filter(d => d.isReserve));
                  return deduped.length > 0 ? (
                    <div className="grid gap-2">
                      {deduped.map((d, i) => (
                        <PersonRow key={i} person={d} isSelected={selectedPerson?.id === d.id}
                          onClick={() => selectPerson(d, '備選董事')}
                          onToggleReserve={() => handleToggleReserve(d)}
                          onDelete={() => handleDeleteOfficer(d, '備選董事')} />
                      ))}
                    </div>
                  ) : (!addingReserve && <p className="text-muted-foreground text-sm">無備選董事記錄</p>);
                })()}
                <p className="text-xs text-muted-foreground mt-3">備選董事為唯一董事身故時的後備人選。亦可在「董事」分頁用盾牌圖示切換是否備選。</p>
                <TabChangeEventsFooter
                  companyId={company.id}
                  company={company}
                  eventTypes={['reserve_director_appoint', 'reserve_director_cease']}
                  label="備選董事變更記錄"
                />
              </TabsContent>

              {/* Tab: 股東 (SE-04 當前 / SE-05 歷史) */}
              <TabsContent value="shareholders">
                <div className="flex items-center justify-between mb-3">
                  <HistoryToggle
                    view={shView} onChange={setShView}
                    currentLabel="當前股東" currentCount={activeShareholders.length}
                    historicalLabel="歷史股東" historicalCount={ceasedShareholders.length}
                  />
                  <Button variant="outline" size="sm" onClick={() => { setCopyContext(null); setCopyDialogOpen(true); }}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> 從所有公司複製
                  </Button>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<Briefcase className={`h-4 w-4 ${shView === 'current' ? 'text-primary' : 'text-muted-foreground'}`} />}
                    title={shView === 'current' ? '當前股東' : '歷史股東（已退出）'}
                    count={shView === 'current' ? activeShareholders.length : ceasedShareholders.length} />
                  {shView === 'current' && (
                    <Button variant="ghost" size="sm" onClick={() => { setAddingShareholder(true); }}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                    </Button>
                  )}
                </div>
                {shView === 'current' && addingShareholder && <ShareholderEditForm mode="full" initialData={{ serviceAddress: regAddrFull }} companyId={company.id} defaultServiceAddress={regAddrFull} onSave={handleAddShareholder} onCancel={() => setAddingShareholder(false)} />}
                {(() => {
                  const shList = shView === 'current' ? activeShareholders : ceasedShareholders;
                  if (shList.length === 0) {
                    if (shView === 'current') return !addingShareholder && <p className="text-muted-foreground text-sm">無當前股東記錄</p>;
                    return <p className="text-muted-foreground text-sm">無已退出股東記錄</p>;
                  }
                  return (
                    <div className="grid gap-2">
                      {shList.map((sh, i) => (
                        editingShareholder === sh.id ? (
                          <ShareholderEditForm key={i} mode="inline" initialData={shFormFromSh(sh)} companyId={company.id}
                            onSave={(data) => handleSaveShareholder(sh.id, data)} onCancel={() => setEditingShareholder(null)} />
                        ) : (
                          <div key={i} className={`flex items-start justify-between rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors group ${
                            selectedSh?.id === sh.id ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/60'
                          }`} onClick={() => selectShareholder(sh)}>
                            <div className="flex-1 min-w-0">
                              <div>
                                <span className="font-medium">{sh.nameEnglish || sh.nameChinese || sh.name}</span>
                                {sh.nameEnglish && sh.nameChinese && <span className="ml-2 text-muted-foreground">{sh.nameChinese}</span>}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                <Badge variant="outline" className="text-xs">{sh.identity === 'natural' ? '自然人' : '法人'}</Badge>
                                {sh.identity === 'corporate' && sh.companyNumberRef && <Badge variant="secondary" className="text-xs">公司編號 {sh.companyNumberRef}</Badge>}
                                <Badge variant="secondary" className="text-xs">{sh.shares.toLocaleString()} 股</Badge>
                                {sh.shareType && <Badge variant="outline" className="text-xs">{sh.shareType}</Badge>}
                                {sh.issuePrice !== undefined && <Badge variant="outline" className="text-xs">每股: {sh.currency || 'HKD'} {sh.issuePrice || '0'}</Badge>}
                                {sh.paidUp !== undefined && <Badge variant="outline" className="text-xs text-green-700 border-green-300">已繳: {sh.currency || 'HKD'} {sh.paidUp || '0'}</Badge>}
                                {sh.unpaid !== undefined && <Badge variant="outline" className="text-xs text-orange-700 border-orange-300">未繳: {sh.currency || 'HKD'} {sh.unpaid || '0'}</Badge>}
                                {isCeased(sh) && <Badge variant="outline" className="text-xs text-destructive border-destructive/50">已退出 {fmtDate(sh.dateCeased)}</Badge>}
                              </div>
                            </div>
                            <div className="hidden group-hover:flex gap-1 ml-2 shrink-0">
                              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={e => {
                                e.stopPropagation(); setEditingShareholder(sh.id);
                                                          }}>
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive" onClick={e => { e.stopPropagation(); handleDeleteShareholder(sh); }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        )
                      ))}
                    </div>
                  );
                })()}
                <TabChangeEventsFooter
                  companyId={company.id}
                  company={company}
                  eventTypes={['shareholder_add', 'shareholder_remove']}
                  label="股東變更記錄"
                />
              </TabsContent>

              {/* Tab: 股本 (Share Capital) */}
              <TabsContent value="sharecapital">
                <ShareCapitalTab company={company} />
              </TabsContent>

              {/* Tab: SCR (重要控制人) */}
              <TabsContent value="scr">
                <SCRTab company={company} />
              </TabsContent>

              <TabsContent value="registers">
                <RegistersTab company={company} />
              </TabsContent>

              <TabsContent value="docgen">
                <DocGenerationTab company={company} />
              </TabsContent>

              <TabsContent value="chronicle">
                <CompanyChronicleTab company={company} />
              </TabsContent>
            </Tabs>
          </div>

          <CopyFromCompanyDialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen} targetCompany={company} roleOverride={copyContext} />

          {/* 撤銷變更確認對話框 */}
          <AlertDialog open={undoConfirmOpen} onOpenChange={setUndoConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>撤銷變更</AlertDialogTitle>
                <AlertDialogDescription>
                  {undoConfirmTarget
                    ? `確定要撤銷「${EVENT_TYPE_LABELS[undoConfirmTarget.event_type] || undoConfirmTarget.event_type}：${getPersonNameFromEvent(undoConfirmTarget, company)}」嗎？此操作將還原該人員的角色狀態並清除此變更記錄。`
                    : ''}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={undoEvent.isPending}>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (undoConfirmTarget && company) {
                      undoEvent.mutate({ event: undoConfirmTarget, companyId: company.id });
                    }
                    setUndoConfirmOpen(false);
                  }}
                  disabled={undoEvent.isPending}
                >
                  {undoEvent.isPending ? '撤銷中...' : '確認撤銷'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Right: Person detail panel */}
          {selectedPerson && (
            <div className="w-1/2 overflow-y-auto p-6 pt-2 bg-muted/10">
              <div className="flex items-center justify-between mb-4">
                <Button variant="ghost" size="sm" className="-ml-2" onClick={() => { setSelectedPerson(null); setEditingPerson(false); }}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> 返回
                </Button>
                {!editingPerson ? (
                  <Button variant="ghost" size="sm" onClick={() => setEditingPerson(true)}>
                    <Edit className="h-3.5 w-3.5 mr-1" /> 編輯
                  </Button>
                ) : (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditingPerson(false)}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
                    <Button size="sm" onClick={handleSavePerson} className="bg-primary text-primary-foreground"><Save className="h-3.5 w-3.5 mr-1" /> 儲存</Button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{selectedPerson.nameEnglish || selectedPerson.nameChinese}</h2>
                  {selectedPerson.nameEnglish && selectedPerson.nameChinese && (
                    <p className="text-sm text-muted-foreground">{selectedPerson.nameChinese}</p>
                  )}
                </div>
              </div>

              {!editingPerson ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <InfoItem label="角色" value={selectedPerson.roleLabel} />
                  <InfoItem label="身份類型" value={selectedPerson.identity === 'natural' ? '自然人' : '法人'} />
                  <InfoItem label="英文名稱" value={selectedPerson.nameEnglish} />
                  <InfoItem label="中文名稱" value={selectedPerson.nameChinese} />
                  <InfoItem label={selectedPerson.identity === 'corporate' ? '商業登記號碼' : '證件號碼'} value={selectedPerson.idNumber || ''} />
                  <InfoItem label="委任日期" value={selectedPerson.dateAppointed || ''} />
                  <InfoItem label="辭任日期" value={selectedPerson.dateCeased || ''} />
                  <InfoItem label="地址" value={selectedPerson.address || ''} />
                  {selectedPerson.identity === 'corporate' && (
                    <>
                      <InfoItem label="TCSP 牌照號碼" value={selectedPerson.tcspNumber || ''} />
                      <InfoItem label="成立地點" value={selectedPerson.placeIncorporated || ''} />
                      <InfoItem label="公司編號" value={selectedPerson.companyNumberRef || ''} />
                    </>
                  )}
                  {selectedPerson.roleLabel === '授權代表' && (
                    <div className="col-span-2">
                      <InfoItem label="授權範圍" value={selectedPerson.authScope || ''} />
                    </div>
                  )}
                  <InfoItem label="電郵" value={selectedPerson.email} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1"><Label className="text-xs">英文名稱</Label><Input value={personForm.nameEnglish} onChange={e => setPersonForm({ ...personForm, nameEnglish: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">中文名稱</Label><Input value={personForm.nameChinese} onChange={e => setPersonForm({ ...personForm, nameChinese: e.target.value })} /></div>
                  <div className="space-y-1">
                    <Label className="text-xs">身份類型</Label>
                    <Select value={personForm.identity} onValueChange={v => setPersonForm({ ...personForm, identity: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="natural">自然人</SelectItem>
                        <SelectItem value="corporate">法人</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{personForm.identity === 'corporate' ? '商業登記號碼' : '證件號碼'}</Label>
                    <Input value={personForm.idNumber} onChange={e => setPersonForm({ ...personForm, idNumber: e.target.value })} placeholder={personForm.identity === 'corporate' ? 'Business Registration No.' : 'ID / Passport No.'} />
                  </div>
                  <div className="space-y-1"><Label className="text-xs">電郵</Label><Input type="email" value={personForm.email} onChange={e => setPersonForm({ ...personForm, email: e.target.value })} placeholder="email@example.com" /></div>
                  <div className="space-y-1"><Label className="text-xs">委任日期</Label><Input value={personForm.dateAppointed} onChange={e => setPersonForm({ ...personForm, dateAppointed: e.target.value })} placeholder="DD/MM/YYYY" /></div>
                  <div className="space-y-1"><Label className="text-xs">辭任日期</Label><Input value={personForm.dateCeased} onChange={e => setPersonForm({ ...personForm, dateCeased: e.target.value })} placeholder="DD/MM/YYYY" /></div>
                  <div className="space-y-1">
                    <Label className="text-xs">{personForm.identity === 'corporate' ? '成立日期' : '出生日期 DOB'}</Label>
                    <Input value={personForm.dateOfBirth} onChange={e => setPersonForm({ ...personForm, dateOfBirth: e.target.value })} placeholder={personForm.identity === 'corporate' ? 'Date of Incorporation (DD/MM/YYYY)' : 'DD/MM/YYYY'} />
                  </div>
                  {selectedPerson.roleLabel === '授權代表' && (
                    <div className="col-span-2 space-y-1"><Label className="text-xs">授權範圍 (Scope of Authority)</Label><Textarea value={personForm.authScope} onChange={e => setPersonForm({ ...personForm, authScope: e.target.value })} rows={2} placeholder="例如：代表公司簽署及提交法定文件" /></div>
                  )}
                  {/* 通訊地址 */}
                  <div className="col-span-2 border-t pt-2 mt-1">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-semibold">通訊地址（住址）<span className="text-destructive">*</span></Label>
                    </div>
                    <SearchableSelect options={addressSourceOptions} selected={addrCopyId} onSelect={id => fillAddrFromSource(id, 'person', 'residential')} placeholder="從系統複製地址..." searchPlaceholder="搜尋公司或人員..." emptyText="無匹配地址" className="mb-1" />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Flat／Floor／Block etc. 室／樓／座等</Label><Input value={personForm.addrFlat} onChange={e => setPersonForm({ ...personForm, addrFlat: e.target.value, address: composeAddr5(e.target.value, personForm.addrBuilding, personForm.addrStreet, personForm.addrDistrict, personForm.addrRegion) })} placeholder="例如 Flat A, 12/F" /></div>
                      <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Building 大廈</Label><Input value={personForm.addrBuilding} onChange={e => setPersonForm({ ...personForm, addrBuilding: e.target.value, address: composeAddr5(personForm.addrFlat, e.target.value, personForm.addrStreet, personForm.addrDistrict, personForm.addrRegion) })} placeholder="大廈名稱" /></div>
                      <div className="col-span-2 space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Street／Estate／Lot／Village etc. 街道／屋苑／地段／村等</Label><Input value={personForm.addrStreet} onChange={e => setPersonForm({ ...personForm, addrStreet: e.target.value, address: composeAddr5(personForm.addrFlat, personForm.addrBuilding, e.target.value, personForm.addrDistrict, personForm.addrRegion) })} placeholder="街道及門牌號" /></div>
                      <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>District／City／Province／State／Postal Code etc. 區／市／省／州／郵遞區號等</Label><Input value={personForm.addrDistrict} onChange={e => setPersonForm({ ...personForm, addrDistrict: e.target.value, address: composeAddr5(personForm.addrFlat, personForm.addrBuilding, personForm.addrStreet, e.target.value, personForm.addrRegion) })} placeholder="例如 Central／中環" /></div>
                      <div className="space-y-1">
                        <Label className="text-xs" style={{ lineHeight: 1.3 }}>Country／Region 國家／地區</Label>
                        <Input value={personForm.addrRegion} onChange={e => setPersonForm({ ...personForm, addrRegion: e.target.value, address: composeAddr5(personForm.addrFlat, personForm.addrBuilding, personForm.addrStreet, personForm.addrDistrict, e.target.value) })} placeholder="例如 Hong Kong／香港、BVI" list="cd-region-suggestions" />
                        <datalist id="cd-region-suggestions">
                          <option value="Hong Kong 香港" /><option value="Kowloon 九龍" /><option value="New Territories 新界" /><option value="Mainland China 中國內地" /><option value="Macau 澳門" /><option value="Taiwan 台灣" /><option value="BVI British Virgin Islands" /><option value="Cayman Islands 開曼群島" /><option value="Bermuda 百慕達" /><option value="Singapore 新加坡" /><option value="United Kingdom 英國" /><option value="United States 美國" /><option value="Overseas 海外" />
                        </datalist>
                      </div>
                    </div>
                  </div>
                  {/* 送達地址 */}
                  <div className="col-span-2 border-t pt-2 mt-1">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-semibold">送達地址（服務地址）</Label>
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
                        onClick={() => setPersonForm({ ...personForm, svcAddrFlat: personForm.addrFlat, svcAddrBuilding: personForm.addrBuilding, svcAddrStreet: personForm.addrStreet, svcAddrDistrict: personForm.addrDistrict, svcAddrRegion: personForm.addrRegion, serviceAddress: personForm.address })}>同通訊地址</Button>
                    </div>
                    <SearchableSelect options={addressSourceOptions} selected={svcAddrCopyId} onSelect={id => fillAddrFromSource(id, 'person', 'service')} placeholder="從系統複製地址..." searchPlaceholder="搜尋公司或人員..." emptyText="無匹配地址" className="mb-1" />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Flat／Floor／Block etc. 室／樓／座等</Label><Input value={personForm.svcAddrFlat} onChange={e => setPersonForm({ ...personForm, svcAddrFlat: e.target.value, serviceAddress: composeAddr5(e.target.value, personForm.svcAddrBuilding, personForm.svcAddrStreet, personForm.svcAddrDistrict, personForm.svcAddrRegion) })} placeholder="例如 Flat A, 12/F" /></div>
                      <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Building 大廈</Label><Input value={personForm.svcAddrBuilding} onChange={e => setPersonForm({ ...personForm, svcAddrBuilding: e.target.value, serviceAddress: composeAddr5(personForm.svcAddrFlat, e.target.value, personForm.svcAddrStreet, personForm.svcAddrDistrict, personForm.svcAddrRegion) })} placeholder="大廈名稱" /></div>
                      <div className="col-span-2 space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Street／Estate／Lot／Village etc. 街道／屋苑／地段／村等</Label><Input value={personForm.svcAddrStreet} onChange={e => setPersonForm({ ...personForm, svcAddrStreet: e.target.value, serviceAddress: composeAddr5(personForm.svcAddrFlat, personForm.svcAddrBuilding, e.target.value, personForm.svcAddrDistrict, personForm.svcAddrRegion) })} placeholder="街道及門牌號" /></div>
                      <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>District／City／Province／State／Postal Code etc. 區／市／省／州／郵遞區號等</Label><Input value={personForm.svcAddrDistrict} onChange={e => setPersonForm({ ...personForm, svcAddrDistrict: e.target.value, serviceAddress: composeAddr5(personForm.svcAddrFlat, personForm.svcAddrBuilding, personForm.svcAddrStreet, e.target.value, personForm.svcAddrRegion) })} placeholder="例如 Central／中環" /></div>
                      <div className="space-y-1">
                        <Label className="text-xs" style={{ lineHeight: 1.3 }}>Country／Region 國家／地區</Label>
                        <Input value={personForm.svcAddrRegion} onChange={e => setPersonForm({ ...personForm, svcAddrRegion: e.target.value, serviceAddress: composeAddr5(personForm.svcAddrFlat, personForm.svcAddrBuilding, personForm.svcAddrStreet, personForm.svcAddrDistrict, e.target.value) })} placeholder="例如 Hong Kong／香港、BVI" list="cd-region-suggestions-svc" />
                        <datalist id="cd-region-suggestions-svc">
                          <option value="Hong Kong 香港" /><option value="Kowloon 九龍" /><option value="New Territories 新界" /><option value="Mainland China 中國內地" /><option value="Macau 澳門" /><option value="Taiwan 台灣" /><option value="BVI British Virgin Islands" /><option value="Cayman Islands 開曼群島" /><option value="Bermuda 百慕達" /><option value="Singapore 新加坡" /><option value="United Kingdom 英國" /><option value="United States 美國" /><option value="Overseas 海外" />
                        </datalist>
                      </div>
                    </div>
                  </div>
                  {personForm.identity === 'corporate' && (
                    <>
                      <div className="space-y-1"><Label className="text-xs">TCSP 牌照號碼</Label><Input value={personForm.tcspNumber} onChange={e => setPersonForm({ ...personForm, tcspNumber: e.target.value })} placeholder="TC No." /></div>
                      <div className="space-y-1"><Label className="text-xs">成立地點</Label><Input value={personForm.placeIncorporated} onChange={e => setPersonForm({ ...personForm, placeIncorporated: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-xs">公司編號</Label><Input value={personForm.companyNumberRef} onChange={e => setPersonForm({ ...personForm, companyNumberRef: e.target.value })} /></div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Right: Shareholder detail panel */}
          {selectedSh && (
            <div className="w-1/2 overflow-y-auto p-6 pt-2 bg-muted/10">
              <div className="flex items-center justify-between mb-4">
                <Button variant="ghost" size="sm" className="-ml-2" onClick={() => { setSelectedSh(null); setEditingShDetail(false); }}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> 返回
                </Button>
                {!editingShDetail ? (
                  <Button variant="ghost" size="sm" onClick={() => setEditingShDetail(true)}>
                    <Edit className="h-3.5 w-3.5 mr-1" /> 編輯
                  </Button>
                ) : (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditingShDetail(false)}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Briefcase className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{selectedSh.name}</h2>
                  <p className="text-sm text-muted-foreground">股東</p>
                </div>
              </div>

              {!editingShDetail ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <InfoItem label="英文名稱" value={selectedSh.nameEnglish} />
                  <InfoItem label="中文名稱" value={selectedSh.nameChinese} />
                  <InfoItem label="身份類型" value={selectedSh.identity === 'natural' ? '自然人' : '法人'} />
                  <InfoItem label="身份證號碼" value={selectedSh.idNumber} />
                  {selectedSh.identity === 'corporate' && (
                    <>
                      <InfoItem label="成立地點" value={selectedSh.placeIncorporated || ''} />
                      <InfoItem label="公司編號" value={selectedSh.companyNumberRef || ''} />
                      <InfoItem label="TCSP 牌照號碼" value={selectedSh.tcspNumber || ''} />
                    </>
                  )}
                  <InfoItem label="持股數量" value={selectedSh.shares.toLocaleString() + ' 股'} />
                  <InfoItem label="股份類別" value={selectedSh.shareType || ''} />
                  <InfoItem label="每股發行價" value={selectedSh.issuePrice ? `${selectedSh.currency || 'HKD'} ${selectedSh.issuePrice}` : ''} />
                  <InfoItem label="已繳或視作已繳的總款額" value={selectedSh.paidUp ? `${selectedSh.currency || 'HKD'} ${selectedSh.paidUp}` : ''} />
                  <InfoItem label="未繳付股本" value={selectedSh.unpaid ? `${selectedSh.currency || 'HKD'} ${selectedSh.unpaid}` : ''} />
                  <InfoItem label="地址" value={selectedSh.address} />
                  <InfoItem label="電郵" value={selectedSh.email} />
                </div>
              ) : (
                <ShareholderEditForm mode="identity" initialData={shFormFromSh(selectedSh)} companyId={company.id} defaultServiceAddress={regAddrFull}
                  onSave={(data) => { handleSaveShareholder(selectedSh.id, data); setEditingShDetail(false); }}
                  onCancel={() => setEditingShDetail(false)} />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

function PersonRow({ person, isSelected, isSigner, historical, onClick, onDelete, onToggleReserve }: { person: Person; isSelected: boolean; isSigner?: boolean; historical?: boolean; onClick: () => void; onDelete: () => void; onToggleReserve?: () => void }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors group ${
        isSelected ? 'border-primary bg-primary/10' : person.isReserve ? 'border-amber-300 bg-amber-50/40' : 'border-border bg-muted/30 hover:bg-muted/60'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <div>
          <span className="font-medium">{person.nameEnglish || person.nameChinese}</span>
          {person.nameEnglish && person.nameChinese && (
            <span className="ml-2 text-muted-foreground">{person.nameChinese}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {historical && person.dateCeased && (
          <Badge variant="outline" className="text-xs text-destructive border-destructive/50">
            已辭任 {fmtDate(person.dateCeased)}
          </Badge>
        )}
        {person.isReserve && (
          <Badge variant="outline" className="text-xs border-amber-500 text-amber-700">
            預備董事
          </Badge>
        )}
        <Badge variant="outline" className="text-xs">
          {person.identity === 'natural' ? '自然人' : '法人'}
        </Badge>
        {person.role === 'director' && <Badge variant="outline" className="text-xs">董事</Badge>}
        {person.role === 'secretary' && <Badge variant="outline" className="text-xs">秘書</Badge>}
        {person.role === 'shareholder' && <Badge variant="outline" className="text-xs">股東</Badge>}
        {person.role === 'authorized_representative' && <Badge variant="outline" className="text-xs">授權代表</Badge>}
        {person.identity === 'corporate' && person.tcspNumber && (
          <Badge variant="secondary" className="text-xs">
            TCSP: {person.tcspNumber}
          </Badge>
        )}
        {onToggleReserve && (
          <Button variant="ghost" size="sm" className="h-6 px-1.5 hidden group-hover:flex text-amber-700"
            title={person.isReserve ? '取消預備董事' : '設為預備董事'}
            onClick={e => { e.stopPropagation(); onToggleReserve(); }}>
            <ShieldCheck className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 px-1.5 hidden group-hover:flex text-destructive"
          onClick={e => { e.stopPropagation(); onDelete(); }}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// 檢索服務 SE-04~SE-07：當前／歷史記錄切換
function HistoryToggle({ view, onChange, currentLabel, currentCount, historicalLabel, historicalCount }: {
  view: 'current' | 'historical';
  onChange: (v: 'current' | 'historical') => void;
  currentLabel: string; currentCount: number;
  historicalLabel: string; historicalCount: number;
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => onChange('current')}
        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
          view === 'current' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted text-muted-foreground'
        }`}
      >
        {currentLabel} ({currentCount})
      </button>
      <button
        type="button"
        onClick={() => onChange('historical')}
        className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border inline-flex items-center gap-1 ${
          view === 'historical' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted text-muted-foreground'
        }`}
      >
        <History className="h-3 w-3" /> {historicalLabel} ({historicalCount})
      </button>
    </div>
  );
}

function MemberRow({ name, sub, roles, identity, extras, selected, onClick }: {
  name: string; sub?: string; roles: string[]; identity: 'natural' | 'corporate'; extras?: string[]; selected: boolean; onClick: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
        selected ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/60'
      }`}
      onClick={onClick}
    >
      <div className="min-w-0">
        <span className="font-medium">{name}</span>
        {sub && name !== sub && <span className="ml-2 text-muted-foreground">{sub}</span>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {roles.map((r) => (
          <Badge key={r} variant="default" className="text-xs">{r}</Badge>
        ))}
        <Badge variant="outline" className="text-xs">{identity === 'natural' ? '自然人' : '法人'}</Badge>
        {extras?.map((e, i) => (
          <Badge key={i} variant="secondary" className="text-xs">{e}</Badge>
        ))}
      </div>
    </div>
  );
}

type OfficerFormType = { nameEnglish: string; nameChinese: string; identity: string; idNumber: string; email: string; tcspNumber: string; authScope: string; address: string; addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string; serviceAddress: string; svcAddrFlat: string; svcAddrBuilding: string; svcAddrStreet: string; svcAddrDistrict: string; svcAddrRegion: string; dateAppointed: string; dateCeased: string; placeIncorporated: string; companyNumberRef: string; dateOfBirth: string };

function NewOfficerForm({ form, setForm, onSave, onCancel, isSecretary, templates = [], showAuthScope, addressSourceOptions, fillAddrFromSource }: {
  form: OfficerFormType;
  setForm: (f: OfficerFormType) => void; onSave: () => void; onCancel: () => void;
  isSecretary?: boolean;
  templates?: import('@/hooks/useSecretaryTemplates').SecretaryTemplate[];
  showAuthScope?: boolean;
  addressSourceOptions: { id: string; label: string; sub: string; meta: string; addrFlat: string; addrBuilding: string; addrStreet: string; addrDistrict: string; addrRegion: string }[];
  fillAddrFromSource: (sourceId: string, targetForm: 'person' | 'newOfficer', target: 'residential' | 'service') => void;
}) {
  const [addrCopyId2, setAddrCopyId2] = useState('');
  const [svcAddrCopyId2, setSvcAddrCopyId2] = useState('');
  const applyTemplate = (id: string) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    setForm({
      ...form,
      nameEnglish: t.nameEnglish,
      nameChinese: t.nameChinese,
      identity: t.identity,
      idNumber: t.idNumber,
      tcspNumber: t.tcspNumber || form.tcspNumber,
      address: t.address || form.address,
      serviceAddress: t.serviceAddress || form.serviceAddress,
      placeIncorporated: t.placeIncorporated,
      companyNumberRef: t.brNumber,
    });
  };
  return (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 mb-2 space-y-2">
      {isSecretary && templates.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs">從範本帶入</Label>
          <Select onValueChange={applyTemplate}>
            <SelectTrigger><SelectValue placeholder="選擇秘書範本以自動填入..." /></SelectTrigger>
            <SelectContent>
              {templates.map(t => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}{t.isDefault ? ' (預設)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label className="text-xs">英文名稱 *</Label><Input value={form.nameEnglish} onChange={e => setForm({ ...form, nameEnglish: e.target.value })} placeholder="English name" /></div>
        <div className="space-y-1"><Label className="text-xs">中文名稱</Label><Input value={form.nameChinese} onChange={e => setForm({ ...form, nameChinese: e.target.value })} placeholder="中文名稱" /></div>
        <div className="space-y-1">
          <Label className="text-xs">身份類型</Label>
          <Select value={form.identity} onValueChange={v => setForm({ ...form, identity: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="natural">自然人</SelectItem>
              <SelectItem value="corporate">法人</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            {form.identity === 'corporate' ? '商業登記號碼' : '證件號碼'} <span className="text-destructive">*</span>
          </Label>
          <Input value={form.idNumber} onChange={e => setForm({ ...form, idNumber: e.target.value })} placeholder={form.identity === 'corporate' ? 'Business Registration No.' : 'ID / Passport No.'} />
        </div>
        <div className="space-y-1"><Label className="text-xs">電郵 <span className="text-destructive">*</span></Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" /></div>
        <div className="space-y-1"><Label className="text-xs">委任日期 <span className="text-destructive">*</span></Label><Input value={form.dateAppointed} onChange={e => setForm({ ...form, dateAppointed: e.target.value })} placeholder="DD/MM/YYYY" /></div>
        <div className="space-y-1"><Label className="text-xs">辭任日期</Label><Input value={form.dateCeased} onChange={e => setForm({ ...form, dateCeased: e.target.value })} placeholder="DD/MM/YYYY" /></div>
        <div className="space-y-1">
          <Label className="text-xs">
            {form.identity === 'corporate' ? '成立日期' : '出生日期 DOB'} <span className="text-destructive">*</span>
          </Label>
          <Input value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} placeholder={form.identity === 'corporate' ? 'Date of Incorporation (DD/MM/YYYY)' : 'DD/MM/YYYY'} />
        </div>
        {showAuthScope && (
          <div className="col-span-2 space-y-1"><Label className="text-xs">授權範圍 (Scope of Authority)</Label><Textarea value={form.authScope} onChange={e => setForm({ ...form, authScope: e.target.value })} rows={2} placeholder="例如：代表公司簽署及提交法定文件" /></div>
        )}
        <div className="col-span-2 border-t pt-2 mt-1">
          <Label className="text-xs font-semibold mb-1">通訊地址（住址）<span className="text-destructive">*</span></Label>
          <SearchableSelect options={addressSourceOptions} selected={addrCopyId2} onSelect={id => { setAddrCopyId2(''); fillAddrFromSource(id, 'newOfficer', 'residential'); }} placeholder="從系統複製地址..." searchPlaceholder="搜尋公司或人員..." emptyText="無匹配地址" className="mb-1" />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Flat／Floor／Block etc. 室／樓／座等</Label><Input value={form.addrFlat} onChange={e => setForm({ ...form, addrFlat: e.target.value, address: composeAddr5(e.target.value, form.addrBuilding, form.addrStreet, form.addrDistrict, form.addrRegion) })} placeholder="例如 Flat A, 12/F" /></div>
            <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Building 大廈</Label><Input value={form.addrBuilding} onChange={e => setForm({ ...form, addrBuilding: e.target.value, address: composeAddr5(form.addrFlat, e.target.value, form.addrStreet, form.addrDistrict, form.addrRegion) })} placeholder="大廈名稱" /></div>
            <div className="col-span-2 space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Street／Estate／Lot／Village etc. 街道／屋苑／地段／村等</Label><Input value={form.addrStreet} onChange={e => setForm({ ...form, addrStreet: e.target.value, address: composeAddr5(form.addrFlat, form.addrBuilding, e.target.value, form.addrDistrict, form.addrRegion) })} placeholder="街道及門牌號" /></div>
            <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>District／City／Province／State／Postal Code etc. 區／市／省／州／郵遞區號等</Label><Input value={form.addrDistrict} onChange={e => setForm({ ...form, addrDistrict: e.target.value, address: composeAddr5(form.addrFlat, form.addrBuilding, form.addrStreet, e.target.value, form.addrRegion) })} placeholder="例如 Central／中環" /></div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ lineHeight: 1.3 }}>Country／Region 國家／地區</Label>
              <Input value={form.addrRegion} onChange={e => setForm({ ...form, addrRegion: e.target.value, address: composeAddr5(form.addrFlat, form.addrBuilding, form.addrStreet, form.addrDistrict, e.target.value) })} placeholder="例如 Hong Kong／香港、BVI" list="no-region-suggestions" />
              <datalist id="no-region-suggestions"><option value="Hong Kong 香港" /><option value="Kowloon 九龍" /><option value="New Territories 新界" /><option value="Mainland China 中國內地" /><option value="Macau 澳門" /><option value="Taiwan 台灣" /><option value="BVI British Virgin Islands" /><option value="Cayman Islands 開曼群島" /><option value="Bermuda 百慕達" /><option value="Singapore 新加坡" /><option value="United Kingdom 英國" /><option value="United States 美國" /><option value="Overseas 海外" /></datalist>
            </div>
          </div>
        </div>
        <div className="col-span-2 border-t pt-2 mt-1">
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs font-semibold">送達地址（服務地址）</Label>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
              onClick={() => setForm({ ...form, svcAddrFlat: form.addrFlat, svcAddrBuilding: form.addrBuilding, svcAddrStreet: form.addrStreet, svcAddrDistrict: form.addrDistrict, svcAddrRegion: form.addrRegion, serviceAddress: form.address })}>同通訊地址</Button>
          </div>
          <SearchableSelect options={addressSourceOptions} selected={svcAddrCopyId2} onSelect={id => { setSvcAddrCopyId2(''); fillAddrFromSource(id, 'newOfficer', 'service'); }} placeholder="從系統複製地址..." searchPlaceholder="搜尋公司或人員..." emptyText="無匹配地址" className="mb-1" />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Flat／Floor／Block etc. 室／樓／座等</Label><Input value={form.svcAddrFlat} onChange={e => setForm({ ...form, svcAddrFlat: e.target.value, serviceAddress: composeAddr5(e.target.value, form.svcAddrBuilding, form.svcAddrStreet, form.svcAddrDistrict, form.svcAddrRegion) })} placeholder="例如 Flat A, 12/F" /></div>
            <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Building 大廈</Label><Input value={form.svcAddrBuilding} onChange={e => setForm({ ...form, svcAddrBuilding: e.target.value, serviceAddress: composeAddr5(form.svcAddrFlat, e.target.value, form.svcAddrStreet, form.svcAddrDistrict, form.svcAddrRegion) })} placeholder="大廈名稱" /></div>
            <div className="col-span-2 space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>Street／Estate／Lot／Village etc. 街道／屋苑／地段／村等</Label><Input value={form.svcAddrStreet} onChange={e => setForm({ ...form, svcAddrStreet: e.target.value, serviceAddress: composeAddr5(form.svcAddrFlat, form.svcAddrBuilding, e.target.value, form.svcAddrDistrict, form.svcAddrRegion) })} placeholder="街道及門牌號" /></div>
            <div className="space-y-1"><Label className="text-xs" style={{ lineHeight: 1.3 }}>District／City／Province／State／Postal Code etc. 區／市／省／州／郵遞區號等</Label><Input value={form.svcAddrDistrict} onChange={e => setForm({ ...form, svcAddrDistrict: e.target.value, serviceAddress: composeAddr5(form.svcAddrFlat, form.svcAddrBuilding, form.svcAddrStreet, e.target.value, form.svcAddrRegion) })} placeholder="例如 Central／中環" /></div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ lineHeight: 1.3 }}>Country／Region 國家／地區</Label>
              <Input value={form.svcAddrRegion} onChange={e => setForm({ ...form, svcAddrRegion: e.target.value, serviceAddress: composeAddr5(form.svcAddrFlat, form.svcAddrBuilding, form.svcAddrStreet, form.svcAddrDistrict, e.target.value) })} placeholder="例如 Hong Kong／香港、BVI" list="no-region-suggestions-svc" />
              <datalist id="no-region-suggestions-svc"><option value="Hong Kong 香港" /><option value="Kowloon 九龍" /><option value="New Territories 新界" /><option value="Mainland China 中國內地" /><option value="Macau 澳門" /><option value="Taiwan 台灣" /><option value="BVI British Virgin Islands" /><option value="Cayman Islands 開曼群島" /><option value="Bermuda 百慕達" /><option value="Singapore 新加坡" /><option value="United Kingdom 英國" /><option value="United States 美國" /><option value="Overseas 海外" /></datalist>
            </div>
          </div>
        </div>
        {form.identity === 'corporate' && (
          <>
            <div className="space-y-1"><Label className="text-xs">TCSP 牌照號碼</Label><Input value={form.tcspNumber} onChange={e => setForm({ ...form, tcspNumber: e.target.value })} placeholder="TC No." /></div>
            <div className="space-y-1"><Label className="text-xs">成立地點</Label><Input value={form.placeIncorporated} onChange={e => setForm({ ...form, placeIncorporated: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">公司編號</Label><Input value={form.companyNumberRef} onChange={e => setForm({ ...form, companyNumberRef: e.target.value })} /></div>
          </>
        )}
      </div>
      <div className="flex gap-1 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
        <Button size="sm" onClick={onSave} className="bg-primary text-primary-foreground"><Save className="h-3.5 w-3.5 mr-1" /> 新增</Button>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="font-medium mt-0.5">{value || '-'}</p>
    </div>
  );
}

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <h3 className="flex items-center gap-2 font-semibold text-sm">
      {icon} {title}
      <Badge variant="secondary" className="text-xs">{count}</Badge>
    </h3>
  );
}

function DocSlot({ label, path, uploading, deleting, onUpload, onView, onDownload, onDelete }: {
  label: string; path?: string; uploading: boolean; deleting?: boolean;
  onUpload: (f: File) => void; onView: () => void; onDownload: () => void; onDelete?: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (uploading) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onUpload(f);
  };

  return (
    <div
      className={`space-y-1 rounded-md border-2 border-dashed transition-colors p-2 ${
        dragOver ? 'border-primary bg-primary/5' : 'border-transparent'
      }`}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!uploading) setDragOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!uploading) setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
      onDrop={handleDrop}
    >
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="flex items-center gap-2 flex-wrap">
        {path ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onView} className="gap-1">
              <FileText className="h-3.5 w-3.5" /> 查看
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDownload} className="gap-1">
              <Download className="h-3.5 w-3.5" /> 下載
            </Button>
            {onDelete && (
              <Button type="button" variant="outline" size="sm" onClick={onDelete} disabled={deleting || uploading}
                className="gap-1 text-destructive hover:text-destructive">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} 刪除
              </Button>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {dragOver ? '放開以上傳' : '尚未上傳（可拖放檔案）'}
          </span>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs px-2 py-1 rounded hover:bg-accent">
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
          />
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {path ? '更換' : '上傳'}
        </label>
      </div>
    </div>
  );
}

function DocPreview({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.storage.from('company-documents').createSignedUrl(path, 3600).then(({ data }) => {
      if (cancelled) return;
      setUrl(data?.signedUrl || null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [path]);

  const ext = (path.split('.').pop() || '').toLowerCase();
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
  const isPdf = ext === 'pdf';

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-muted/20">
      <div className="px-3 py-2 text-xs font-medium border-b border-border bg-muted/40">{label}</div>
      <div className="h-[500px] flex items-center justify-center">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : !url ? (
          <span className="text-xs text-muted-foreground">無法載入預覽</span>
        ) : isImage ? (
          <img src={url} alt={label} className="max-w-full max-h-full object-contain" />
        ) : isPdf ? (
          <iframe src={url} title={label} className="w-full h-full" />
        ) : (
          <a href={url} target="_blank" rel="noreferrer" className="text-primary text-sm underline">開啟檔案</a>
        )}
      </div>
    </div>
  );
}
