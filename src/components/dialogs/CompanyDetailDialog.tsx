import { useState, useEffect } from 'react';
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
  Edit, Save, X, Plus, Trash2, Upload, FileText, Download, Loader2, Paperclip, UsersRound, UserCog, UserPlus, FileClock, History, FileOutput,
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
import { CopyFromCompanyDialog } from './CopyFromCompanyDialog';
import { useSecretaryTemplates } from '@/hooks/useSecretaryTemplates';
import { useUnassignedChangeEvents, EVENT_TYPE_LABELS } from '@/hooks/useChangeEvents';
import { useNAR1Status, getNAR1StatusBadge } from '@/hooks/useNAR1Status';

interface CompanyDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

const emptyOfficerForm = () => ({ nameEnglish: '', nameChinese: '', identity: 'natural', idNumber: '', email: '', tcspNumber: '', authScope: '', address: '', serviceAddress: '', dateAppointed: '', dateCeased: '', placeIncorporated: '', companyNumberRef: '', dateOfBirth: '' });
const emptyShForm = () => ({ name: '', nameEnglish: '', nameChinese: '', shares: 0, identity: 'natural', idNumber: '', address: '', serviceAddress: '', email: '', shareType: '', issuePrice: '', currency: 'HKD', paidUp: '', unpaid: '', placeIncorporated: '', companyNumberRef: '', tcspNumber: '' });

// 股東表單金額輔助：自動格式化 + 計算未繳股本
const fmtMoney2 = (v: string) => { const n = parseFloat(v); return isNaN(n) ? v : n.toFixed(2); };
const calcUnpaid = (shares: number, issuePrice: string, paidUp: string) => {
  const price = parseFloat(issuePrice) || 0;
  const paid = parseFloat(paidUp) || 0;
  const unpaid = price * shares - paid;
  return unpaid > 0 ? unpaid.toFixed(2) : '0.00';
};
// 工具：根據現有表單值，返回更新後的 issuePrice (格式化) + unpaid (自動計算)
const computeShMoney = <T extends { shares: number; issuePrice: string; paidUp: string; unpaid: string }>(f: T) => ({
  issuePrice: f.issuePrice ? fmtMoney2(f.issuePrice) : f.issuePrice,
  unpaid: calcUnpaid(f.shares, f.issuePrice, f.paidUp),
});

// 從 Shareholder 建立完整 shForm（避免各處重複的物件字面量遺漏欄位，含法人專屬欄位 ME-08）
const shFormFromSh = (sh: Shareholder) => ({
  name: sh.name, nameEnglish: sh.nameEnglish, nameChinese: sh.nameChinese,
  shares: sh.shares, identity: sh.identity, idNumber: sh.idNumber || '',
  address: sh.address || '', serviceAddress: sh.serviceAddress || '',
  email: sh.email || '', shareType: sh.shareType || '', issuePrice: sh.issuePrice || '',
  currency: sh.currency || 'HKD', paidUp: sh.paidUp || '', unpaid: sh.unpaid || '',
  placeIncorporated: sh.placeIncorporated || '', companyNumberRef: sh.companyNumberRef || '', tcspNumber: sh.tcspNumber || '',
});

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
  const [shForm, setShForm] = useState(emptyShForm());

  const updateCompany = useUpdateCompany();
  const addOfficer = useAddOfficer();
  const updateOfficer = useUpdateOfficer();
  const deleteOfficer = useDeleteOfficer();
  const addShareholder = useAddShareholder();
  const updateShareholder = useUpdateShareholder();
  const deleteShareholder = useDeleteShareholder();
  const { data: secretaryTemplates = [] } = useSecretaryTemplates();
  const { data: unassignedChanges = [] } = useUnassignedChangeEvents(company?.id);
  const { data: nar1Status } = useNAR1Status(company?.id);

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
      setShForm(shFormFromSh(freshShareholder));
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
  };

  const selectShareholder = (sh: Shareholder) => {
    setSelectedPerson(null); setEditingPerson(false);
    setSelectedSh(sh);
    setShForm(shFormFromSh(sh));
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
      service_address: personForm.serviceAddress || personForm.address || regAddrFull,
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
        toast({ title: '刪除失敗', description: msg, variant: 'destructive' });
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
      service_address: newOfficerForm.serviceAddress || newOfficerForm.address || regAddrFull,
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
      service_address: newOfficerForm.serviceAddress || newOfficerForm.address || regAddrFull,
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
      service_address: newOfficerForm.serviceAddress || newOfficerForm.address || regAddrFull,
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

  const handleAddMemberShareholder = () => {
    if (!shForm.name && !shForm.nameEnglish) { toast({ title: '請填寫股東名稱', variant: 'destructive' }); return; }
    addShareholder.mutate({
      company_id: company.id, name: shForm.name || shForm.nameEnglish,
      name_english: shForm.nameEnglish, name_chinese: shForm.nameChinese,
      shares: shForm.shares, identity: shForm.identity, id_number: shForm.idNumber,
      address: shForm.address, service_address: shForm.serviceAddress || shForm.address || regAddrFull,
      email: shForm.email, share_type: shForm.shareType,
      issue_price: shForm.issuePrice, currency: shForm.currency,
      paid_up: shForm.paidUp, unpaid: shForm.unpaid,
      place_incorporated: shForm.placeIncorporated, company_number_ref: shForm.companyNumberRef, tcsp_number: shForm.tcspNumber,
    }, {
      onSuccess: () => { toast({ title: '股東已新增' }); setMemberAddRole(null); setShForm(emptyShForm()); },
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

  const handleSaveShareholder = (id: string) => {
    const nextShareholder: Shareholder = {
      id,
      name: shForm.name || shForm.nameEnglish || shForm.nameChinese,
      nameEnglish: shForm.nameEnglish,
      nameChinese: shForm.nameChinese,
      shares: shForm.shares,
      identity: shForm.identity as Shareholder['identity'],
      idNumber: shForm.idNumber,
      address: shForm.address,
      serviceAddress: shForm.serviceAddress || shForm.address || regAddrFull,
      email: shForm.email,
      shareType: shForm.shareType,
      issuePrice: shForm.issuePrice,
      currency: shForm.currency,
      paidUp: shForm.paidUp,
      unpaid: shForm.unpaid,
      placeIncorporated: shForm.placeIncorporated,
      companyNumberRef: shForm.companyNumberRef,
      tcspNumber: shForm.tcspNumber,
    };

    updateShareholder.mutate({ id, data: { name: nextShareholder.name, name_english: nextShareholder.nameEnglish, name_chinese: nextShareholder.nameChinese, shares: nextShareholder.shares, identity: nextShareholder.identity, id_number: nextShareholder.idNumber, address: nextShareholder.address, service_address: nextShareholder.serviceAddress, email: nextShareholder.email, share_type: nextShareholder.shareType, issue_price: shForm.issuePrice, currency: shForm.currency, paid_up: shForm.paidUp, unpaid: shForm.unpaid, place_incorporated: shForm.placeIncorporated, company_number_ref: shForm.companyNumberRef, tcsp_number: shForm.tcspNumber } }, {
      onSuccess: () => { toast({ title: '股東已更新' }); setEditingShareholder(null); setEditingShDetail(false); if (selectedSh?.id === id) setSelectedSh(nextShareholder); },
      onError: () => toast({ title: '更新失敗', variant: 'destructive' }),
    });
  };

  const handleAddShareholder = () => {
    if (!shForm.name && !shForm.nameEnglish) { toast({ title: '請填寫股東名稱', variant: 'destructive' }); return; }
    addShareholder.mutate({
      company_id: company.id, name: shForm.name || shForm.nameEnglish,
      name_english: shForm.nameEnglish, name_chinese: shForm.nameChinese,
      shares: shForm.shares, identity: shForm.identity, id_number: shForm.idNumber,
      address: shForm.address, service_address: shForm.serviceAddress || shForm.address || regAddrFull,
      email: shForm.email, share_type: shForm.shareType,
      issue_price: shForm.issuePrice, currency: shForm.currency,
      paid_up: shForm.paidUp, unpaid: shForm.unpaid,
      place_incorporated: shForm.placeIncorporated, company_number_ref: shForm.companyNumberRef, tcsp_number: shForm.tcspNumber,
    }, {
      onSuccess: () => {
        toast({ title: '股東已新增' });
        setAddingShareholder(false); setShForm(emptyShForm());
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
                      <Button variant="ghost" size="sm" onClick={() => { setMemberAddRole('director'); setNewOfficerForm({ ...emptyOfficerForm(), serviceAddress: regAddrFull }); setShForm({ ...emptyShForm(), serviceAddress: regAddrFull }); }}>
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
                      <NewShareholderForm form={shForm} setForm={setShForm} onSave={handleAddMemberShareholder} onCancel={() => setMemberAddRole(null)} />
                    ) : (
                      <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm}
                        onSave={() => handleAddMemberOfficer(memberAddRole)} onCancel={() => setMemberAddRole(null)}
                        isSecretary={memberAddRole === 'secretary'} templates={secretaryTemplates}
                        showAuthScope={memberAddRole === 'authorized_representative'} />
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
                    {addingOfficer === 'director' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} />}
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
                {addingOfficer === 'secretary' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} isSecretary templates={secretaryTemplates} />}
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
                {addingOfficer === 'authorized_representative' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} showAuthScope />}
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
                {addingReserve && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddReserve} onCancel={() => setAddingReserve(false)} />}
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
                    <Button variant="ghost" size="sm" onClick={() => { setAddingShareholder(true); setShForm({ ...emptyShForm(), serviceAddress: regAddrFull }); }}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                    </Button>
                  )}
                </div>
                {shView === 'current' && addingShareholder && <NewShareholderForm form={shForm} setForm={setShForm} onSave={handleAddShareholder} onCancel={() => setAddingShareholder(false)} />}
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
                          <InlineShEdit key={i} shForm={shForm} setShForm={setShForm}
                            onSave={() => handleSaveShareholder(sh.id)} onCancel={() => setEditingShareholder(null)} />
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
                                setShForm(shFormFromSh(sh));
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
                  <div className="col-span-2 space-y-1"><Label className="text-xs">居住地址 (Residential)</Label><Textarea value={personForm.address} onChange={e => setPersonForm({ ...personForm, address: e.target.value })} rows={2} /></div>
                  <div className="col-span-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">服務地址 (Service Address)</Label>
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
                        onClick={() => setPersonForm({ ...personForm, serviceAddress: regAddrFull })}>同註冊辦事處</Button>
                    </div>
                    <Textarea value={personForm.serviceAddress} onChange={e => setPersonForm({ ...personForm, serviceAddress: e.target.value })} rows={2} placeholder="預設同註冊辦事處地址" />
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
                  <Button variant="ghost" size="sm" onClick={() => {
                    // Re-sync shForm from the current selectedSh to avoid stale data
                    setShForm(shFormFromSh(selectedSh));
                    setEditingShDetail(true);
                  }}>
                    <Edit className="h-3.5 w-3.5 mr-1" /> 編輯
                  </Button>
                ) : (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditingShDetail(false)}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
                    <Button size="sm" onClick={() => { handleSaveShareholder(selectedSh.id); setEditingShDetail(false); }} className="bg-primary text-primary-foreground"><Save className="h-3.5 w-3.5 mr-1" /> 儲存</Button>
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
                  <InfoItem label="已繳付股本" value={selectedSh.paidUp ? `${selectedSh.currency || 'HKD'} ${selectedSh.paidUp}` : ''} />
                  <InfoItem label="未繳付股本" value={selectedSh.unpaid ? `${selectedSh.currency || 'HKD'} ${selectedSh.unpaid}` : ''} />
                  <InfoItem label="地址" value={selectedSh.address} />
                  <InfoItem label="電郵" value={selectedSh.email} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1"><Label className="text-xs">英文名稱</Label><Input value={shForm.nameEnglish} onChange={e => setShForm({ ...shForm, nameEnglish: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">中文名稱</Label><Input value={shForm.nameChinese} onChange={e => setShForm({ ...shForm, nameChinese: e.target.value })} /></div>
                  <div className="space-y-1">
                    <Label className="text-xs">身份類型</Label>
                    <Select value={shForm.identity} onValueChange={v => setShForm({ ...shForm, identity: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="natural">自然人</SelectItem>
                        <SelectItem value="corporate">法人</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">身份證號碼</Label><Input value={shForm.idNumber} onChange={e => setShForm({ ...shForm, idNumber: e.target.value })} /></div>
                  {shForm.identity === 'corporate' && (
                    <>
                      <div className="space-y-1"><Label className="text-xs">成立地點</Label><Input value={shForm.placeIncorporated} onChange={e => setShForm({ ...shForm, placeIncorporated: e.target.value })} placeholder="e.g. Hong Kong / BVI" /></div>
                      <div className="space-y-1"><Label className="text-xs">公司編號</Label><Input value={shForm.companyNumberRef} onChange={e => setShForm({ ...shForm, companyNumberRef: e.target.value })} placeholder="Company No." /></div>
                      <div className="col-span-2 space-y-1"><Label className="text-xs">TCSP 牌照號碼</Label><Input value={shForm.tcspNumber} onChange={e => setShForm({ ...shForm, tcspNumber: e.target.value })} placeholder="TC No.（如適用）" /></div>
                    </>
                  )}
                  <div className="space-y-1"><Label className="text-xs">持股數量</Label><Input type="number" value={shForm.shares} onChange={e => { const s = parseInt(e.target.value) || 0; setShForm({ ...shForm, shares: s, unpaid: calcUnpaid(s, shForm.issuePrice, shForm.paidUp) }); }} /></div>
                  <div className="space-y-1"><Label className="text-xs">股份類別</Label><Input value={shForm.shareType} onChange={e => setShForm({ ...shForm, shareType: e.target.value })} placeholder="e.g. Ordinary 普通股" /></div>
                  <div className="space-y-1"><Label className="text-xs">貨幣</Label><Input value={shForm.currency} onChange={e => setShForm({ ...shForm, currency: e.target.value })} placeholder="HKD" /></div>
                  <div className="space-y-1"><Label className="text-xs">每股發行價</Label><Input value={shForm.issuePrice} onChange={e => setShForm({ ...shForm, issuePrice: e.target.value })} onBlur={() => { if (shForm.issuePrice) setShForm({ ...shForm, ...computeShMoney(shForm) }); }} placeholder="e.g. 1.00" /></div>
                  <div className="space-y-1"><Label className="text-xs">已繳付股本</Label><Input value={shForm.paidUp} onChange={e => setShForm({ ...shForm, paidUp: e.target.value })} onBlur={() => { if (shForm.paidUp) setShForm({ ...shForm, ...computeShMoney(shForm) }); }} placeholder="Amount paid up" /></div>
                  <div className="space-y-1"><Label className="text-xs">未繳付股本</Label><Input value={shForm.unpaid} onChange={e => setShForm({ ...shForm, unpaid: e.target.value })} placeholder="自動計算" /></div>
                  <div className="col-span-2 space-y-1"><Label className="text-xs">居住地址</Label><Textarea value={shForm.address} onChange={e => setShForm({ ...shForm, address: e.target.value })} rows={2} /></div>
                  <div className="col-span-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">服務地址 (Service Address)</Label>
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
                        onClick={() => setShForm({ ...shForm, serviceAddress: regAddrFull })}>同註冊辦事處</Button>
                    </div>
                    <Textarea value={shForm.serviceAddress} onChange={e => setShForm({ ...shForm, serviceAddress: e.target.value })} rows={2} />
                  </div>
                  <div className="space-y-1"><Label className="text-xs">電郵</Label><Input value={shForm.email} onChange={e => setShForm({ ...shForm, email: e.target.value })} /></div>
                </div>
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

type OfficerFormType = { nameEnglish: string; nameChinese: string; identity: string; idNumber: string; email: string; tcspNumber: string; authScope: string; address: string; serviceAddress: string; dateAppointed: string; dateCeased: string; placeIncorporated: string; companyNumberRef: string; dateOfBirth: string };

function NewOfficerForm({ form, setForm, onSave, onCancel, isSecretary, templates = [], showAuthScope }: {
  form: OfficerFormType;
  setForm: (f: OfficerFormType) => void; onSave: () => void; onCancel: () => void;
  isSecretary?: boolean;
  templates?: import('@/hooks/useSecretaryTemplates').SecretaryTemplate[];
  showAuthScope?: boolean;
}) {
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
        <div className="col-span-2 space-y-1"><Label className="text-xs">居住地址 <span className="text-destructive">*</span></Label><Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} placeholder="地址 Address" /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">服務地址 (預設同註冊辦事處)</Label><Textarea value={form.serviceAddress} onChange={e => setForm({ ...form, serviceAddress: e.target.value })} rows={2} placeholder="留空則自動使用註冊辦事處地址" /></div>
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

type ShFormType = { name: string; nameEnglish: string; nameChinese: string; shares: number; identity: string; idNumber: string; address: string; serviceAddress: string; email: string; shareType: string; issuePrice: string; currency: string; paidUp: string; unpaid: string; placeIncorporated: string; companyNumberRef: string; tcspNumber: string };

function NewShareholderForm({ form, setForm, onSave, onCancel }: {
  form: ShFormType; setForm: (f: ShFormType) => void; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 mb-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label className="text-xs">英文名稱</Label><Input value={form.nameEnglish} onChange={e => setForm({ ...form, nameEnglish: e.target.value })} placeholder="English name" /></div>
        <div className="space-y-1"><Label className="text-xs">中文名稱</Label><Input value={form.nameChinese} onChange={e => setForm({ ...form, nameChinese: e.target.value })} placeholder="中文名稱" /></div>
        <div className="space-y-1"><Label className="text-xs">顯示名稱</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Display name" /></div>
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
        <div className="space-y-1"><Label className="text-xs">證件號碼</Label><Input value={form.idNumber} onChange={e => setForm({ ...form, idNumber: e.target.value })} placeholder="ID / Passport No." /></div>
        {form.identity === 'corporate' && (
          <>
            <div className="space-y-1"><Label className="text-xs">成立地點</Label><Input value={form.placeIncorporated} onChange={e => setForm({ ...form, placeIncorporated: e.target.value })} placeholder="e.g. Hong Kong / BVI" /></div>
            <div className="space-y-1"><Label className="text-xs">公司編號</Label><Input value={form.companyNumberRef} onChange={e => setForm({ ...form, companyNumberRef: e.target.value })} placeholder="Company No." /></div>
            <div className="space-y-1"><Label className="text-xs">TCSP 牌照號碼</Label><Input value={form.tcspNumber} onChange={e => setForm({ ...form, tcspNumber: e.target.value })} placeholder="TC No.（如適用）" /></div>
          </>
        )}
        <div className="space-y-1"><Label className="text-xs">股數</Label><Input type="number" value={form.shares} onChange={e => { const s = parseInt(e.target.value) || 0; setForm({ ...form, shares: s, unpaid: calcUnpaid(s, form.issuePrice, form.paidUp) }); }} /></div>
        <div className="space-y-1"><Label className="text-xs">股份類別</Label><Input value={form.shareType} onChange={e => setForm({ ...form, shareType: e.target.value })} placeholder="e.g. Ordinary 普通股" /></div>
        <div className="space-y-1"><Label className="text-xs">貨幣</Label><Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} placeholder="HKD" /></div>
        <div className="space-y-1"><Label className="text-xs">每股發行價</Label><Input value={form.issuePrice} onChange={e => setForm({ ...form, issuePrice: e.target.value })} onBlur={() => { if (form.issuePrice) setForm({ ...form, ...computeShMoney(form) }); }} placeholder="e.g. 1.00" /></div>
        <div className="space-y-1"><Label className="text-xs">已繳付股本</Label><Input value={form.paidUp} onChange={e => setForm({ ...form, paidUp: e.target.value })} onBlur={() => { if (form.paidUp) setForm({ ...form, ...computeShMoney(form) }); }} placeholder="Amount paid up" /></div>
        <div className="space-y-1"><Label className="text-xs">未繳付股本</Label><Input value={form.unpaid} onChange={e => setForm({ ...form, unpaid: e.target.value })} placeholder="自動計算" /></div>
        <div className="space-y-1"><Label className="text-xs">電郵</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">居住地址</Label><Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} placeholder="地址 Address" /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">服務地址 (預設同註冊辦事處)</Label><Textarea value={form.serviceAddress} onChange={e => setForm({ ...form, serviceAddress: e.target.value })} rows={2} placeholder="留空則自動使用註冊辦事處地址" /></div>
      </div>
      <div className="flex gap-1 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
        <Button size="sm" onClick={onSave} className="bg-primary text-primary-foreground"><Save className="h-3.5 w-3.5 mr-1" /> 新增</Button>
      </div>
    </div>
  );
}

function InlineShEdit({ shForm, setShForm, onSave, onCancel }: {
  shForm: ShFormType; setShForm: (f: ShFormType) => void; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label className="text-xs">英文名稱</Label><Input value={shForm.nameEnglish} onChange={e => setShForm({ ...shForm, nameEnglish: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">中文名稱</Label><Input value={shForm.nameChinese} onChange={e => setShForm({ ...shForm, nameChinese: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">身份證號碼</Label><Input value={shForm.idNumber} onChange={e => setShForm({ ...shForm, idNumber: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">股數</Label><Input type="number" value={shForm.shares} onChange={e => { const s = parseInt(e.target.value) || 0; setShForm({ ...shForm, shares: s, unpaid: calcUnpaid(s, shForm.issuePrice, shForm.paidUp) }); }} /></div>
        {shForm.identity === 'corporate' && (
          <>
            <div className="space-y-1"><Label className="text-xs">成立地點</Label><Input value={shForm.placeIncorporated} onChange={e => setShForm({ ...shForm, placeIncorporated: e.target.value })} placeholder="e.g. Hong Kong / BVI" /></div>
            <div className="space-y-1"><Label className="text-xs">公司編號</Label><Input value={shForm.companyNumberRef} onChange={e => setShForm({ ...shForm, companyNumberRef: e.target.value })} placeholder="Company No." /></div>
            <div className="col-span-2 space-y-1"><Label className="text-xs">TCSP 牌照號碼</Label><Input value={shForm.tcspNumber} onChange={e => setShForm({ ...shForm, tcspNumber: e.target.value })} placeholder="TC No.（如適用）" /></div>
          </>
        )}
        <div className="col-span-2 space-y-1"><Label className="text-xs">股份類別</Label><Input value={shForm.shareType} onChange={e => setShForm({ ...shForm, shareType: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">貨幣</Label><Input value={shForm.currency} onChange={e => setShForm({ ...shForm, currency: e.target.value })} placeholder="HKD" /></div>
        <div className="space-y-1"><Label className="text-xs">每股發行價</Label><Input value={shForm.issuePrice} onChange={e => setShForm({ ...shForm, issuePrice: e.target.value })} onBlur={() => { if (shForm.issuePrice) setShForm({ ...shForm, ...computeShMoney(shForm) }); }} /></div>
        <div className="space-y-1"><Label className="text-xs">已繳付股本</Label><Input value={shForm.paidUp} onChange={e => setShForm({ ...shForm, paidUp: e.target.value })} onBlur={() => { if (shForm.paidUp) setShForm({ ...shForm, ...computeShMoney(shForm) }); }} /></div>
        <div className="space-y-1"><Label className="text-xs">未繳付股本</Label><Input value={shForm.unpaid} onChange={e => setShForm({ ...shForm, unpaid: e.target.value })} placeholder="自動計算" /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">地址</Label><Input value={shForm.address} onChange={e => setShForm({ ...shForm, address: e.target.value })} /></div>
      </div>
      <div className="flex gap-1 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
        <Button size="sm" onClick={onSave} className="bg-primary text-primary-foreground"><Save className="h-3.5 w-3.5 mr-1" /> 儲存</Button>
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
