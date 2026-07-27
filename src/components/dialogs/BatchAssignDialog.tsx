import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { SearchableMultiSelect, SearchableSelect, type MultiSelectOption } from '@/components/ui/searchable-multiselect';
import { useCompanies, useAddCompany, useBatchAssign } from '@/hooks/useCompanies';
import { useOfficers } from '@/hooks/useOfficers';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { Users, Building2, ArrowRightLeft, Loader2, Plus, Check, X, Wrench } from 'lucide-react';

type AssignMode = 'many-to-one' | 'one-to-many' | 'manage';
type ManageView = 'company' | 'person';

interface BatchAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_OPTIONS = [
  { value: 'director', label: '董事' },
  { value: 'secretary', label: '秘書' },
  { value: 'shareholder', label: '股東' },
  { value: 'authorized_representative', label: '授權代表' },
];

export function BatchAssignDialog({ open, onOpenChange }: BatchAssignDialogProps) {
  const [mode, setMode] = useState<AssignMode>('many-to-one');
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [selectedPerson, setSelectedPerson] = useState<string>('');
  const [role, setRole] = useState<string>('director');
  // Per-company role overrides (one-to-many mode)
  const [companyRoles, setCompanyRoles] = useState<Record<string, string>>({});
  // Quick mode: all companies share the same role
  const [quickMode, setQuickMode] = useState(false);
  const [quickModeRole, setQuickModeRole] = useState('director');

  // Inline creation state
  const [showNewPerson, setShowNewPerson] = useState(false);
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [newPersonNameEn, setNewPersonNameEn] = useState('');
  const [newPersonNameZh, setNewPersonNameZh] = useState('');
  const [newPersonIdentity, setNewPersonIdentity] = useState<'natural' | 'corporate'>('natural');
  const [newPersonIdNumber, setNewPersonIdNumber] = useState('');
  const [newPersonDateOfBirth, setNewPersonDateOfBirth] = useState('');
  const [newPersonAddress, setNewPersonAddress] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyBR, setNewCompanyBR] = useState('');
  const [creating, setCreating] = useState(false);

  // ── Manage mode state ──
  const [manageView, setManageView] = useState<ManageView>('company');
  const [selectedManageCompany, setSelectedManageCompany] = useState('');
  const [selectedManagePerson, setSelectedManagePerson] = useState('');
  const [manageRoles, setManageRoles] = useState<any[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);

  const { data: companies = [], refetch: refetchCompanies } = useCompanies();
  const { officers = [], refetch: refetchOfficers } = useOfficers();
  const batchAssign = useBatchAssign();
  const addCompany = useAddCompany();
  const queryClient = useQueryClient();

  // Build options for selectors
  const personOptions: MultiSelectOption[] = useMemo(
    () =>
      officers.map((p) => ({
        id: p.id,
        label: p.nameEnglish || p.nameChinese || '(無名稱)',
        sub: p.nameChinese && p.nameEnglish ? p.nameChinese : p.email || undefined,
        meta:
          p.role === 'director'
            ? '董事'
            : p.role === 'secretary'
              ? '秘書'
              : p.role === 'shareholder'
                ? '股東'
                : undefined,
      })),
    [officers]
  );

  const companyOptions: MultiSelectOption[] = useMemo(
    () =>
      companies.map((c) => ({
        id: c.id,
        label: c.name,
        sub: c.brNumber ? `BR ${c.brNumber}` : undefined,
        meta: c.jurisdiction && c.jurisdiction !== 'Hong Kong' ? c.jurisdiction : undefined,
      })),
    [companies]
  );

  const reset = () => {
    setSelectedPeople([]);
    setSelectedCompanies([]);
    setSelectedCompany('');
    setSelectedPerson('');
    setRole('director');
    setCompanyRoles({});
    setQuickMode(false);
    setQuickModeRole('director');
    setSelectedManageCompany('');
    setSelectedManagePerson('');
    setManageRoles([]);
    setManageView('company');
    setShowNewPerson(false);
    setShowNewCompany(false);
    setNewPersonNameEn('');
    setNewPersonNameZh('');
    setNewPersonIdentity('natural');
    setNewPersonIdNumber('');
    setNewPersonDateOfBirth('');
    setNewPersonAddress('');
    setNewCompanyName('');
    setNewCompanyBR('');
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleTogglePerson = (id: string) => {
    setSelectedPeople((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleToggleCompany = (id: string) => {
    setSelectedCompanies((prev) => {
      if (prev.includes(id)) {
        // Remove company and its role override
        setCompanyRoles((cr) => { const n = { ...cr }; delete n[id]; return n; });
        return prev.filter((x) => x !== id);
      } else {
        // Add company with default role
        setCompanyRoles((cr) => ({ ...cr, [id]: cr[id] || role }));
        return [...prev, id];
      }
    });
  };

  const handleCompanyRoleChange = (companyId: string, newRole: string) => {
    setCompanyRoles((cr) => ({ ...cr, [companyId]: newRole }));
  };

  // Create new person inline
  const handleCreatePerson = async () => {
    if (!newPersonNameEn.trim()) {
      toast({ title: '請填寫英文姓名', variant: 'destructive' });
      return;
    }
    if (!newPersonIdNumber.trim()) {
      toast({ title: '請填寫香港身份證號碼', variant: 'destructive' });
      return;
    }
    if (!newPersonDateOfBirth.trim()) {
      toast({ title: '請填寫出生日期', variant: 'destructive' });
      return;
    }
    if (!newPersonAddress.trim()) {
      toast({ title: '請填寫居住地址', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const normKey = newPersonNameEn.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const payload: Record<string, any> = {
        identity: newPersonIdentity,
        name_english: newPersonNameEn.trim(),
        name_chinese: newPersonNameZh.trim(),
        normalized_key: normKey,
        id_number: newPersonIdNumber.trim(),
        date_of_birth: newPersonDateOfBirth.trim(),
        address: newPersonAddress.trim(),
      };
      const { data: created, error } = await supabase
        .from('persons')
        .insert(payload as any)
        .select('id')
        .single();
      if (error) throw error;

      // Invalidate and refetch to get the new person in the list
      await queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      await refetchOfficers();
      // Also invalidate companies queries so member lists reflect the new person
      queryClient.invalidateQueries({ queryKey: ['companies'] });

      const newId = created.id;
      if (mode === 'many-to-one') {
        setSelectedPeople((prev) => [...prev, newId]);
      } else {
        setSelectedPerson(newId);
      }

      const desc = newPersonNameZh.trim()
        ? `${newPersonNameEn.trim()}（${newPersonNameZh.trim()}）已加入選擇`
        : `${newPersonNameEn.trim()} 已加入選擇`;
      toast({ title: '人員已建立', description: desc });
      setShowNewPerson(false);
      setNewPersonNameEn('');
      setNewPersonNameZh('');
      setNewPersonIdentity('natural');
      setNewPersonIdNumber('');
      setNewPersonDateOfBirth('');
      setNewPersonAddress('');
    } catch (e: any) {
      toast({ title: '建立人員失敗', description: e.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  // Create new company inline
  const handleCreateCompany = async () => {
    if (!newCompanyName.trim() || !newCompanyBR.trim()) {
      toast({ title: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      // Use addCompany mutation but handle it imperatively
      const { data: created, error } = await supabase
        .from('companies')
        .insert({
          name: newCompanyName.trim(),
          company_number: newCompanyBR.trim(),
          jurisdiction: 'Hong Kong',
          company_type: '私人公司 Private company',
          reg_region: '',
        } as any)
        .select('id')
        .single();
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      await refetchCompanies();

      const newId = created.id;
      if (mode === 'many-to-one') {
        setSelectedCompany(newId);
      } else {
        setSelectedCompanies((prev) => [...prev, newId]);
      }

      toast({ title: '公司已建立', description: newCompanyName.trim() });
      setShowNewCompany(false);
      setNewCompanyName('');
      setNewCompanyBR('');
    } catch (e: any) {
      toast({ title: '建立公司失敗', description: e.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleSubmit = () => {
    // Validate
    if (mode === 'many-to-one') {
      if (!selectedCompany) {
        toast({ title: '請選擇或新建公司', variant: 'destructive' });
        return;
      }
      if (selectedPeople.length === 0) {
        toast({ title: '請選擇或新建至少一位人員', variant: 'destructive' });
        return;
      }
    } else {
      if (!selectedPerson) {
        toast({ title: '請選擇或新建人員', variant: 'destructive' });
        return;
      }
      if (selectedCompanies.length === 0) {
        toast({ title: '請選擇或新建至少一間公司', variant: 'destructive' });
        return;
      }
    }

    batchAssign.mutate(
      {
        mode,
        personIds: mode === 'many-to-one' ? selectedPeople : [selectedPerson],
        companyIds: mode === 'many-to-one' ? [selectedCompany] : selectedCompanies,
        role,
        companyRoles: mode === 'one-to-many' ? companyRoles : undefined,
      },
      {
        onSuccess: (result) => {
          const companyLabel =
            mode === 'many-to-one'
              ? companies.find((c) => c.id === selectedCompany)?.name ||
                newCompanyName ||
                '目標公司'
              : `${result.count} 間公司`;
          const personLabel =
            mode === 'many-to-one'
              ? `${result.count} 人`
              : officers.find((p) => p.id === selectedPerson)?.nameEnglish ||
                officers.find((p) => p.id === selectedPerson)?.nameChinese ||
                newPersonNameEn ||
                '目標人員';

          const roleLabels =
            mode === 'one-to-many'
              ? [...new Set(Object.values(companyRoles))].map(r => ROLE_OPTIONS.find(o => o.value === r)?.label || r).join('、')
              : ROLE_OPTIONS.find((r) => r.value === role)?.label;

          toast({
            title: '批量關聯成功',
            description: `已將 ${personLabel} 以「${roleLabels}」身份關聯到 ${companyLabel}`,
          });
          handleClose(false);
        },
        onError: (e: any) => {
          toast({
            title: '批量關聯失敗',
            description: e.message,
            variant: 'destructive',
          });
        },
      }
    );
  };

  // ── Manage mode handlers ──
  const loadCompanyRoles = async (companyId: string) => {
    setLoadingRoles(true);
    try {
      const { data } = await supabase.from('person_company_roles').select('*').eq('company_id', companyId);
      const roles = Array.isArray(data) ? data : (data ? [data] : []);
      // Enrich with person names
      if (roles.length > 0) {
        const personIds = [...new Set(roles.map((r: any) => r.person_id))];
        const { data: persons } = await supabase.from('persons').select('id,name_english,name_chinese').in('id', personIds);
        const pMap = new Map<string, any>();
        if (persons && Array.isArray(persons)) {
          for (const p of persons as any[]) pMap.set(p.id, p);
        }
        for (const r of roles) {
          const p = pMap.get(r.person_id);
          r._personName = p ? (p.name_chinese ? `${p.name_english || ''}（${p.name_chinese}）` : (p.name_english || r.person_id)) : r.person_id;
        }
      }
      setManageRoles(roles);
    } catch (e: any) {
      toast({ title: '加載失敗', description: e.message, variant: 'destructive' });
      setManageRoles([]);
    } finally { setLoadingRoles(false); }
  };

  const loadPersonRoles = async (personId: string) => {
    setLoadingRoles(true);
    try {
      const { data } = await supabase.from('person_company_roles').select('*').eq('person_id', personId);
      const roles = Array.isArray(data) ? data : (data ? [data] : []);
      // Enrich with company names
      if (roles.length > 0) {
        const companyIds = [...new Set(roles.map((r: any) => r.company_id))];
        const { data: companies2 } = await supabase.from('companies').select('id,name').in('id', companyIds);
        const cMap = new Map<string, any>();
        if (companies2 && Array.isArray(companies2)) {
          for (const c of companies2 as any[]) cMap.set(c.id, c);
        }
        for (const r of roles) {
          const c = cMap.get(r.company_id);
          r._companyName = c?.name || r.company_id;
        }
      }
      setManageRoles(roles);
    } catch (e: any) {
      toast({ title: '加載失敗', description: e.message, variant: 'destructive' });
      setManageRoles([]);
    } finally { setLoadingRoles(false); }
  };

  const handleRoleUpdate = async (roleId: string, newRole: string) => {
    setUpdatingRoleId(roleId);
    try {
      const { error } = await supabase.from('person_company_roles').update({ role: newRole }).eq('id', roleId);
      if (error) throw error;
      setManageRoles(prev => prev.map(r => r.id === roleId ? { ...r, role: newRole } : r));
      toast({ title: '已更新角色' });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    } catch (e: any) {
      toast({ title: '更新失敗', description: e.message, variant: 'destructive' });
    } finally { setUpdatingRoleId(null); }
  };

  const handleRoleDelete = async (roleId: string) => {
    try {
      const { error } = await supabase.from('person_company_roles').delete().eq('id', roleId);
      if (error) throw error;
      setManageRoles(prev => prev.filter(r => r.id !== roleId));
      toast({ title: '已刪除關聯' });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
    } catch (e: any) {
      toast({ title: '刪除失敗', description: e.message, variant: 'destructive' });
    }
  };

  // Load roles when manage selection changes
  const refreshManageRoles = () => {
    if (manageView === 'company' && selectedManageCompany) {
      loadCompanyRoles(selectedManageCompany);
    } else if (manageView === 'person' && selectedManagePerson) {
      loadPersonRoles(selectedManagePerson);
    }
  };

  // Summary text
  const summaryText = useMemo(() => {
    if (mode === 'manage') return null;
    if (mode === 'many-to-one') {
      const compName = selectedCompany
        ? companies.find((c) => c.id === selectedCompany)?.name || newCompanyName
        : null;
      return selectedPeople.length > 0 && compName
        ? `將 ${selectedPeople.length} 人關聯到「${compName}」`
        : null;
    } else {
      const personName = selectedPerson
        ? officers.find((p) => p.id === selectedPerson)?.nameEnglish ||
          officers.find((p) => p.id === selectedPerson)?.nameChinese ||
          newPersonNameEn
        : null;
      if (!(selectedCompanies.length > 0 && personName)) return null;
      const roleSummary = [...new Set(Object.values(companyRoles))].map(r => ROLE_OPTIONS.find(o => o.value === r)?.label || r).join('、');
      return `將「${personName}」以「${roleSummary}」身份關聯到 ${selectedCompanies.length} 間公司`;
    }
  }, [mode, selectedPeople, selectedCompanies, selectedCompany, selectedPerson, companies, officers, newCompanyName, newPersonNameEn, companyRoles]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            批量關聯
          </DialogTitle>
          <DialogDescription>
            將人員快速關聯到公司 — 可選現有或新建
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode Toggle */}
          <div className="space-y-2">
            <Label>關聯模式</Label>
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as AssignMode)}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="many-to-one" className="gap-2">
                  <Users className="h-4 w-4" />
                  <div className="text-left">
                    <div className="text-sm font-medium">多人一公司</div>
                    <div className="text-xs text-muted-foreground">選/建多人 → 加到一間公司</div>
                  </div>
                </TabsTrigger>
                <TabsTrigger value="one-to-many" className="gap-2">
                  <Building2 className="h-4 w-4" />
                  <div className="text-left">
                    <div className="text-sm font-medium">一人多公司</div>
                    <div className="text-xs text-muted-foreground">選/建一人 → 加到多間公司</div>
                  </div>
                </TabsTrigger>
                <TabsTrigger value="manage" className="gap-2">
                  <Wrench className="h-4 w-4" />
                  <div className="text-left">
                    <div className="text-sm font-medium">管理關聯</div>
                    <div className="text-xs text-muted-foreground">修改角色 / 刪除關聯</div>
                  </div>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {mode !== 'manage' && (<>
          {/* Role Selector */}
          <div className="space-y-2">
            <Label>角色</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <hr className="border-border" />

          {/* Mode A: Many People → One Company */}
          {mode === 'many-to-one' && (
            <>
              {/* Company selector + new company inline */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    目標公司
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setShowNewCompany(!showNewCompany); setShowNewPerson(false); }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    新建公司
                  </Button>
                </div>

                {showNewCompany && (
                  <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">公司英文名稱 *</Label>
                        <Input
                          value={newCompanyName}
                          onChange={(e) => setNewCompanyName(e.target.value)}
                          placeholder="例如 PAUL TANG AND CO LTD"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">商業登記號碼 *</Label>
                        <Input
                          value={newCompanyBR}
                          onChange={(e) => setNewCompanyBR(e.target.value)}
                          placeholder="例如 07281051"
                        />
                      </div>
                    </div>
                    <div className="flex gap-1 justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewCompany(false)}>
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreateCompany}
                        disabled={creating}
                        className="bg-primary text-primary-foreground"
                      >
                        {creating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                        建立並選擇
                      </Button>
                    </div>
                  </div>
                )}

                {!showNewCompany && (
                  <SearchableSelect
                    options={companyOptions}
                    selected={selectedCompany}
                    onSelect={setSelectedCompany}
                    placeholder="搜尋並選擇一間公司..."
                    searchPlaceholder="搜尋公司名稱或 BR 號碼..."
                    emptyText="找不到匹配的公司"
                  />
                )}
              </div>

              {/* People multi-select + new person inline */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    選擇人員
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setShowNewPerson(!showNewPerson); setShowNewCompany(false); }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    新建人員
                  </Button>
                </div>

                {showNewPerson && (
                  <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">英文姓名 <span className="text-destructive">*</span></Label>
                        <Input
                          value={newPersonNameEn}
                          onChange={(e) => setNewPersonNameEn(e.target.value)}
                          placeholder="例如 CHAN TAI MAN"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">中文姓名</Label>
                        <Input
                          value={newPersonNameZh}
                          onChange={(e) => setNewPersonNameZh(e.target.value)}
                          placeholder="例如 陳大文"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">身份類型</Label>
                        <Select
                          value={newPersonIdentity}
                          onValueChange={(v) => setNewPersonIdentity(v as 'natural' | 'corporate')}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="natural">自然人</SelectItem>
                            <SelectItem value="corporate">法人</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">香港身份證號碼 <span className="text-destructive">*</span></Label>
                        <Input
                          value={newPersonIdNumber}
                          onChange={(e) => setNewPersonIdNumber(e.target.value)}
                          placeholder="例如 A123456(7)"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">出生日期 <span className="text-destructive">*</span></Label>
                        <Input
                          value={newPersonDateOfBirth}
                          onChange={(e) => setNewPersonDateOfBirth(e.target.value)}
                          placeholder="DD/MM/YYYY"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">居住地址 <span className="text-destructive">*</span></Label>
                      <Input
                        value={newPersonAddress}
                        onChange={(e) => setNewPersonAddress(e.target.value)}
                        placeholder="地址 Address"
                      />
                    </div>
                    <div className="flex gap-1 justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewPerson(false)}>
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreatePerson}
                        disabled={creating}
                        className="bg-primary text-primary-foreground"
                      >
                        {creating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                        建立{selectedPeople.length > 0 ? '並加入選擇' : '並選擇'}
                      </Button>
                    </div>
                  </div>
                )}

                <SearchableMultiSelect
                  options={personOptions}
                  selected={selectedPeople}
                  onToggle={handleTogglePerson}
                  placeholder="搜尋並選擇人員..."
                  searchPlaceholder="搜尋姓名或證件號碼..."
                  emptyText="找不到匹配的人員"
                />
                {selectedPeople.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      已選擇 {selectedPeople.length} 位人員，將以「
                      {ROLE_OPTIONS.find((r) => r.value === role)?.label}
                      」身份關聯到目標公司
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-md border p-2">
                      {selectedPeople.map((pid) => {
                        const p = officers.find((o) => o.id === pid);
                        const name = p?.nameEnglish || p?.nameChinese || pid.slice(0, 8);
                        return (
                          <div key={pid} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1.5">
                            <span className="text-sm flex-1 min-w-0 truncate" title={name}>
                              {name}
                              {p?.nameChinese && p?.nameEnglish && (
                                <span className="text-xs text-muted-foreground ml-1">（{p.nameChinese}）</span>
                              )}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => handleTogglePerson(pid)}
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
              </div>
            </>
          )}

          {/* Mode B: One Person → Many Companies */}
          {mode === 'one-to-many' && (
            <>
              {/* Person selector + new person inline */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    目標人員
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setShowNewPerson(!showNewPerson); setShowNewCompany(false); }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    新建人員
                  </Button>
                </div>

                {showNewPerson && (
                  <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">英文姓名 <span className="text-destructive">*</span></Label>
                        <Input
                          value={newPersonNameEn}
                          onChange={(e) => setNewPersonNameEn(e.target.value)}
                          placeholder="例如 CHAN TAI MAN"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">中文姓名</Label>
                        <Input
                          value={newPersonNameZh}
                          onChange={(e) => setNewPersonNameZh(e.target.value)}
                          placeholder="例如 陳大文"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">身份類型</Label>
                        <Select
                          value={newPersonIdentity}
                          onValueChange={(v) => setNewPersonIdentity(v as 'natural' | 'corporate')}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="natural">自然人</SelectItem>
                            <SelectItem value="corporate">法人</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">香港身份證號碼 <span className="text-destructive">*</span></Label>
                        <Input
                          value={newPersonIdNumber}
                          onChange={(e) => setNewPersonIdNumber(e.target.value)}
                          placeholder="例如 A123456(7)"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">出生日期 <span className="text-destructive">*</span></Label>
                        <Input
                          value={newPersonDateOfBirth}
                          onChange={(e) => setNewPersonDateOfBirth(e.target.value)}
                          placeholder="DD/MM/YYYY"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">居住地址 <span className="text-destructive">*</span></Label>
                      <Input
                        value={newPersonAddress}
                        onChange={(e) => setNewPersonAddress(e.target.value)}
                        placeholder="地址 Address"
                      />
                    </div>
                    <div className="flex gap-1 justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewPerson(false)}>
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreatePerson}
                        disabled={creating}
                        className="bg-primary text-primary-foreground"
                      >
                        {creating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                        建立並選擇
                      </Button>
                    </div>
                  </div>
                )}

                {!showNewPerson && (
                  <SearchableSelect
                    options={personOptions}
                    selected={selectedPerson}
                    onSelect={setSelectedPerson}
                    placeholder="搜尋並選擇一位人員..."
                    searchPlaceholder="搜尋姓名或證件號碼..."
                    emptyText="找不到匹配的人員"
                  />
                )}
              </div>

              {/* Companies multi-select + new company inline */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    選擇公司
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setShowNewCompany(!showNewCompany); setShowNewPerson(false); }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    新建公司
                  </Button>
                </div>

                {showNewCompany && (
                  <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">公司英文名稱 *</Label>
                        <Input
                          value={newCompanyName}
                          onChange={(e) => setNewCompanyName(e.target.value)}
                          placeholder="例如 PAUL TANG AND CO LTD"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">商業登記號碼 *</Label>
                        <Input
                          value={newCompanyBR}
                          onChange={(e) => setNewCompanyBR(e.target.value)}
                          placeholder="例如 07281051"
                        />
                      </div>
                    </div>
                    <div className="flex gap-1 justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewCompany(false)}>
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreateCompany}
                        disabled={creating}
                        className="bg-primary text-primary-foreground"
                      >
                        {creating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                        建立{selectedCompanies.length > 0 ? '並加入選擇' : '並選擇'}
                      </Button>
                    </div>
                  </div>
                )}

                <SearchableMultiSelect
                  options={companyOptions}
                  selected={selectedCompanies}
                  onToggle={handleToggleCompany}
                  placeholder="搜尋並選擇多間公司..."
                  searchPlaceholder="搜尋公司名稱或 BR 號碼..."
                  emptyText="找不到匹配的公司"
                />
                {/* Selected companies with per-company role + remove */}
                {selectedCompanies.length > 0 && (
                  <div className="space-y-2">
                    {/* Quick mode toggle */}
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">
                        已選擇 {selectedCompanies.length} 間公司
                      </Label>
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor="quick-mode"
                          className="text-xs cursor-pointer select-none"
                        >
                          快速模式：全部公司統一角色
                        </Label>
                        <Switch
                          id="quick-mode"
                          checked={quickMode}
                          onCheckedChange={(checked) => {
                            setQuickMode(checked);
                            if (checked) {
                              // Sync all companies to the current default role
                              const commonRole = role;
                              setQuickModeRole(commonRole);
                              const synced: Record<string, string> = {};
                              selectedCompanies.forEach((cid) => { synced[cid] = commonRole; });
                              setCompanyRoles(synced);
                            }
                          }}
                        />
                      </div>
                    </div>

                    {quickMode ? (
                      /* Quick mode: single role selector + simplified company rows */
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-xs">統一角色：</span>
                          <Select
                            value={quickModeRole}
                            onValueChange={(v) => {
                              setQuickModeRole(v);
                              const synced: Record<string, string> = {};
                              selectedCompanies.forEach((cid) => { synced[cid] = v; });
                              setCompanyRoles(synced);
                            }}
                          >
                            <SelectTrigger className="w-[150px] h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-md border p-2">
                          {selectedCompanies.map((cid) => {
                            const comp = companies.find((c) => c.id === cid);
                            const compName = comp?.name || cid.slice(0, 8);
                            return (
                              <div key={cid} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1.5">
                                <Badge variant="secondary" className="text-xs shrink-0">
                                  {ROLE_OPTIONS.find((r) => r.value === quickModeRole)?.label}
                                </Badge>
                                <span className="text-sm flex-1 min-w-0 truncate" title={compName}>
                                  {compName}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => handleToggleCompany(cid)}
                                  title="移除"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      /* Per-company role mode */
                      <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-md border p-2">
                        {selectedCompanies.map((cid) => {
                          const comp = companies.find((c) => c.id === cid);
                          const compName = comp?.name || cid.slice(0, 8);
                          return (
                            <div key={cid} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1.5">
                              <span className="text-sm flex-1 min-w-0 truncate" title={compName}>
                                {compName}
                              </span>
                              <Select
                                value={companyRoles[cid] || role}
                                onValueChange={(v) => handleCompanyRoleChange(cid, v)}
                              >
                                <SelectTrigger className="w-[130px] h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLE_OPTIONS.map((r) => (
                                    <SelectItem key={r.value} value={r.value}>
                                      {r.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => handleToggleCompany(cid)}
                                title="移除"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          </>)
          }

          {/* ── Manage Mode ── */}
          {mode === 'manage' && (
            <div className="space-y-4">
              {/* Sub-mode tabs */}
              <div className="space-y-2">
                <Label>管理視角</Label>
                <Tabs value={manageView} onValueChange={(v) => { setManageView(v as ManageView); setManageRoles([]); }} className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="company" className="gap-2">
                      <Building2 className="h-4 w-4" />
                      <span>公司視角</span>
                    </TabsTrigger>
                    <TabsTrigger value="person" className="gap-2">
                      <Users className="h-4 w-4" />
                      <span>人員視角</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <hr className="border-border" />

              {manageView === 'company' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />選擇公司</Label>
                    <SearchableSelect
                      options={companyOptions}
                      selected={selectedManageCompany}
                      onSelect={(id) => { setSelectedManageCompany(id); setTimeout(() => loadCompanyRoles(id), 50); }}
                      placeholder="搜尋並選擇一間公司..."
                      searchPlaceholder="搜尋公司名稱..."
                      emptyText="找不到匹配的公司"
                    />
                  </div>

                  {loadingRoles && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}

                  {!loadingRoles && selectedManageCompany && manageRoles.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">此公司暫無人員關聯</p>
                  )}

                  {!loadingRoles && manageRoles.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        共 {manageRoles.length} 筆關聯
                      </Label>
                      <div className="max-h-64 overflow-y-auto space-y-1 rounded-md border p-2">
                        {manageRoles.map((r: any) => (
                          <div key={r.id} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1.5">
                            <span className="text-sm flex-1 min-w-0 truncate" title={r._personName}>
                              {r._personName || r.person_id?.slice(0, 8)}
                            </span>
                            <Select
                              value={r.role}
                              onValueChange={(v) => handleRoleUpdate(r.id, v)}
                              disabled={updatingRoleId === r.id}
                            >
                              <SelectTrigger className="w-[130px] h-7 text-xs">
                                {updatingRoleId === r.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <SelectValue />
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_OPTIONS.map((ro) => (
                                  <SelectItem key={ro.value} value={ro.value}>{ro.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button" variant="ghost" size="sm"
                              className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => handleRoleDelete(r.id)}
                              title="刪除此關聯"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {manageView === 'person' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" />選擇人員</Label>
                    <SearchableSelect
                      options={personOptions}
                      selected={selectedManagePerson}
                      onSelect={(id) => { setSelectedManagePerson(id); setTimeout(() => loadPersonRoles(id), 50); }}
                      placeholder="搜尋並選擇一位人員..."
                      searchPlaceholder="搜尋姓名..."
                      emptyText="找不到匹配的人員"
                    />
                  </div>

                  {loadingRoles && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}

                  {!loadingRoles && selectedManagePerson && manageRoles.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">此人暫無公司關聯</p>
                  )}

                  {!loadingRoles && manageRoles.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        共 {manageRoles.length} 間公司
                      </Label>
                      <div className="max-h-64 overflow-y-auto space-y-1 rounded-md border p-2">
                        {manageRoles.map((r: any) => (
                          <div key={r.id} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1.5">
                            <span className="text-sm flex-1 min-w-0 truncate" title={r._companyName}>
                              {r._companyName || r.company_id?.slice(0, 8)}
                            </span>
                            <Select
                              value={r.role}
                              onValueChange={(v) => handleRoleUpdate(r.id, v)}
                              disabled={updatingRoleId === r.id}
                            >
                              <SelectTrigger className="w-[130px] h-7 text-xs">
                                {updatingRoleId === r.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <SelectValue />
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_OPTIONS.map((ro) => (
                                  <SelectItem key={ro.value} value={ro.value}>{ro.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button" variant="ghost" size="sm"
                              className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => handleRoleDelete(r.id)}
                              title="移除此公司關聯"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          {summaryText && (
            <div className="rounded-md bg-primary/5 border border-primary/30 p-3">
              <p className="text-sm font-medium text-primary flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4" />
                {summaryText}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            關閉
          </Button>
          {mode !== 'manage' && (
            <Button
              onClick={handleSubmit}
              className="bg-primary text-primary-foreground"
              disabled={batchAssign.isPending || creating}
            >
              {batchAssign.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />關聯中...</>
              ) : '確認關聯'}
            </Button>
          )}
          {mode === 'manage' && (
            <Button variant="outline" onClick={refreshManageRoles} disabled={loadingRoles}>
              {loadingRoles && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              刷新
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
