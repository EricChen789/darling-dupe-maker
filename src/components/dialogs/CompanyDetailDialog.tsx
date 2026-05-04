import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
  Edit, Save, X, Plus, Trash2, Upload, FileText, Download, Loader2,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  useUpdateCompany,
  useAddOfficer, useUpdateOfficer, useDeleteOfficer,
  useAddShareholder, useUpdateShareholder, useDeleteShareholder,
} from '@/hooks/useCompanies';
import { SCRTab } from './SCRTab';
import { CopyFromCompanyDialog } from './CopyFromCompanyDialog';

interface CompanyDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

const emptyOfficerForm = () => ({ nameEnglish: '', nameChinese: '', identity: 'natural', idNumber: '', address: '', serviceAddress: '', dateAppointed: '', dateCeased: '', placeIncorporated: '', companyNumberRef: '' });
const emptyShForm = () => ({ name: '', nameEnglish: '', nameChinese: '', shares: 0, identity: 'natural', idNumber: '', address: '', serviceAddress: '', email: '', shareType: '', issuePrice: '', currency: 'HKD', paidUp: '', unpaid: '' });

export const CompanyDetailDialog = ({ open, onOpenChange, company }: CompanyDetailDialogProps) => {
  const [selectedPerson, setSelectedPerson] = useState<(Person & { roleLabel: string }) | null>(null);
  const [selectedSh, setSelectedSh] = useState<Shareholder | null>(null);
  const [editingCompany, setEditingCompany] = useState(false);
  const [editingPerson, setEditingPerson] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<string | null>(null);
  const [editingShDetail, setEditingShDetail] = useState(false);
  const [addingOfficer, setAddingOfficer] = useState<'director' | 'secretary' | null>(null);
  const [addingShareholder, setAddingShareholder] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);

  const [companyForm, setCompanyForm] = useState({ name: '', chineseName: '', brNumber: '', tradingName: '', businessNature: '', companyType: '', businessCode: '', regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '', incorporationDate: '', jurisdiction: 'Hong Kong', ciFilePath: '', brFilePath: '', email: '', phone: '', signerRoleId: '' });
  const [uploadingCi, setUploadingCi] = useState(false);
  const [uploadingBr, setUploadingBr] = useState(false);
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
      address: source.address || '',
      serviceAddress: source.serviceAddress || '',
      dateAppointed: source.dateAppointed || '',
      dateCeased: source.dateCeased || '', placeIncorporated: source.placeIncorporated || '',
      companyNumberRef: source.companyNumberRef || '',
    });
  }, [selectedPerson?.id, company]);


  useEffect(() => {
    if (!company || !selectedSh) return;
    const freshShareholder = company.shareholders.find(sh => sh.id === selectedSh.id);
    if (!freshShareholder) return;
    setSelectedSh(freshShareholder);
    if (!editingShDetail) {
      setShForm({
        name: freshShareholder.name,
        nameEnglish: freshShareholder.nameEnglish,
        nameChinese: freshShareholder.nameChinese,
        shares: freshShareholder.shares,
        identity: freshShareholder.identity,
        idNumber: freshShareholder.idNumber || '',
        address: freshShareholder.address || '',
        serviceAddress: freshShareholder.serviceAddress || '',
        email: freshShareholder.email || '',
        shareType: freshShareholder.shareType || '',
        issuePrice: freshShareholder.issuePrice || '',
        currency: freshShareholder.currency || 'HKD',
        paidUp: freshShareholder.paidUp || '',
        unpaid: freshShareholder.unpaid || '',
      });
    }
  }, [company, selectedSh, editingShDetail]);

  if (!company) return null;

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
    setShForm({ name: sh.name, nameEnglish: sh.nameEnglish, nameChinese: sh.nameChinese, shares: sh.shares, identity: sh.identity, idNumber: sh.idNumber, address: sh.address, serviceAddress: sh.serviceAddress || '', email: sh.email, shareType: sh.shareType || '', issuePrice: sh.issuePrice || '', currency: sh.currency || 'HKD', paidUp: sh.paidUp || '', unpaid: sh.unpaid || '' });
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
    a.remove();
  };

  const regAddrFull = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion].filter(Boolean).join(', ');

  const handleSavePerson = () => {
    if (!selectedPerson) return;
    updateOfficer.mutate({ id: selectedPerson.id, data: {
      name_english: personForm.nameEnglish, name_chinese: personForm.nameChinese,
      identity: personForm.identity, id_number: personForm.idNumber,
      address: personForm.address,
      service_address: personForm.serviceAddress || personForm.address || regAddrFull,
      date_appointed: personForm.dateAppointed || undefined,
      date_ceased: personForm.dateCeased || undefined,
      place_incorporated: personForm.placeIncorporated, company_number_ref: personForm.companyNumberRef,
    }}, {
      onSuccess: () => { toast({ title: '人員資料已更新' }); setEditingPerson(false); },
      onError: () => toast({ title: '更新失敗', variant: 'destructive' }),
    });
  };

  const handleDeleteOfficer = (person: Person, label: string) => {
    deleteOfficer.mutate(person.id, {
      onSuccess: () => {
        toast({ title: `${label}已刪除`, description: person.nameEnglish || person.nameChinese });
        if (selectedPerson?.id === person.id) setSelectedPerson(null);
      },
      onError: () => toast({ title: '刪除失敗', variant: 'destructive' }),
    });
  };

  const handleAddOfficer = () => {
    if (!addingOfficer || !newOfficerForm.nameEnglish) {
      toast({ title: '請填寫英文名稱', variant: 'destructive' }); return;
    }
    addOfficer.mutate({
      company_id: company.id, name_english: newOfficerForm.nameEnglish,
      name_chinese: newOfficerForm.nameChinese, role: addingOfficer,
      identity: newOfficerForm.identity, id_number: newOfficerForm.idNumber,
      address: newOfficerForm.address,
      service_address: newOfficerForm.serviceAddress || newOfficerForm.address || regAddrFull,
      date_appointed: newOfficerForm.dateAppointed || undefined,
      date_ceased: newOfficerForm.dateCeased || undefined,
      place_incorporated: newOfficerForm.placeIncorporated, company_number_ref: newOfficerForm.companyNumberRef,
    }, {
      onSuccess: () => {
        toast({ title: `${addingOfficer === 'director' ? '董事' : '秘書'}已新增` });
        setAddingOfficer(null); setNewOfficerForm(emptyOfficerForm());
      },
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
    };

    updateShareholder.mutate({ id, data: { name: nextShareholder.name, name_english: nextShareholder.nameEnglish, name_chinese: nextShareholder.nameChinese, shares: nextShareholder.shares, identity: nextShareholder.identity, id_number: nextShareholder.idNumber, address: nextShareholder.address, service_address: nextShareholder.serviceAddress, email: nextShareholder.email, share_type: nextShareholder.shareType, issue_price: shForm.issuePrice, currency: shForm.currency, paid_up: shForm.paidUp, unpaid: shForm.unpaid } }, {
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
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex">
          {/* Left: Tabbed content */}
          <div className={`overflow-y-auto p-6 pt-2 transition-all ${(selectedPerson || selectedSh) ? 'w-1/2 border-r border-border' : 'w-full'}`}>

            <Tabs defaultValue="info" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="info" className="gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> 基本資料
                </TabsTrigger>
                <TabsTrigger value="officers" className="gap-1.5">
                  <Users className="h-3.5 w-3.5" /> 董事/秘書
                  <Badge variant="secondary" className="text-xs ml-1">{company.directors.length + company.secretaries.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="shareholders" className="gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" /> 股東
                  <Badge variant="secondary" className="text-xs ml-1">{company.shareholders.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="scr" className="gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> 重要控制人
                </TabsTrigger>
              </TabsList>

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
                    <div className="col-span-2">
                      <InfoItem label="註冊辦事處地址" value={[company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion].filter(Boolean).join(', ') || '—'} />
                    </div>
                    <InfoItem label="最後更新" value={company.updatedAt} />
                    <div className="col-span-2 border-t border-border pt-3 mt-2 grid grid-cols-2 gap-4">
                      <DocSlot label="公司註冊證書 (CI)" path={company.ciFilePath} uploading={uploadingCi}
                        onUpload={(f) => uploadDoc(f, 'ci')} onView={() => downloadDoc(company.ciFilePath || '')}
                        onDownload={() => downloadDocAsFile(company.ciFilePath || '')} />
                      <DocSlot label="商業登記證 (BR)" path={company.brFilePath} uploading={uploadingBr}
                        onUpload={(f) => uploadDoc(f, 'br')} onView={() => downloadDoc(company.brFilePath || '')}
                        onDownload={() => downloadDocAsFile(company.brFilePath || '')} />
                    </div>
                    {(company.ciFilePath || company.brFilePath) && (
                      <div className="col-span-2 grid grid-cols-2 gap-4">
                        {company.ciFilePath && <DocPreview path={company.ciFilePath} label="公司註冊證書 (CI)" />}
                        {company.brFilePath && <DocPreview path={company.brFilePath} label="商業登記證 (BR)" />}
                      </div>
                    )}
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
                          <Select value={companyForm.regRegion} onValueChange={v => setCompanyForm({ ...companyForm, regRegion: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="香港 Hong Kong">香港 Hong Kong</SelectItem>
                              <SelectItem value="九龍 Kowloon">九龍 Kowloon</SelectItem>
                              <SelectItem value="新界 New Territories">新界 New Territories</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Tab: 董事/秘書 */}
              <TabsContent value="officers">
                <div className="flex justify-end mb-3">
                  <Button variant="outline" size="sm" onClick={() => setCopyDialogOpen(true)}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> 從其他公司複製
                  </Button>
                </div>
                {/* Directors */}
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<Users className="h-4 w-4 text-primary" />} title="董事" count={company.directors.length} />
                  <Button variant="ghost" size="sm" onClick={() => { setAddingOfficer('director'); setNewOfficerForm({ ...emptyOfficerForm(), serviceAddress: regAddrFull }); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                  </Button>
                </div>
                {addingOfficer === 'director' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} />}
                {company.directors.length > 0 ? (
                  <div className="grid gap-2">
                    {company.directors.map((d, i) => (
                      <PersonRow key={i} person={d} isSelected={selectedPerson?.id === d.id}
                        isSigner={effectiveSignerId === d.id}
                        onClick={() => selectPerson(d, '董事')}
                        onToggleReserve={() => handleToggleReserve(d)}
                        onDelete={() => handleDeleteOfficer(d, '董事')} />
                    ))}
                  </div>
                ) : !addingOfficer && <p className="text-muted-foreground text-sm">無董事記錄</p>}

                <Separator className="my-4" />

                {/* Secretaries */}
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<UserCheck className="h-4 w-4 text-primary" />} title="秘書" count={company.secretaries.length} />
                  <Button variant="ghost" size="sm" onClick={() => { setAddingOfficer('secretary'); setNewOfficerForm({ ...emptyOfficerForm(), serviceAddress: regAddrFull }); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                  </Button>
                </div>
                {addingOfficer === 'secretary' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} />}
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

              {/* Tab: 股東 */}
              <TabsContent value="shareholders">
                <div className="flex justify-end mb-3">
                  <Button variant="outline" size="sm" onClick={() => setCopyDialogOpen(true)}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> 從其他公司複製
                  </Button>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<Briefcase className="h-4 w-4 text-primary" />} title="股東" count={company.shareholders.length} />
                  <Button variant="ghost" size="sm" onClick={() => { setAddingShareholder(true); setShForm({ ...emptyShForm(), serviceAddress: regAddrFull }); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                  </Button>
                </div>
                {addingShareholder && <NewShareholderForm form={shForm} setForm={setShForm} onSave={handleAddShareholder} onCancel={() => setAddingShareholder(false)} />}
                {company.shareholders.length > 0 ? (
                  <div className="grid gap-2">
                    {company.shareholders.map((sh, i) => (
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
                              <Badge variant="secondary" className="text-xs">{sh.shares.toLocaleString()} 股</Badge>
                              {sh.shareType && <Badge variant="outline" className="text-xs">{sh.shareType}</Badge>}
                              {sh.issuePrice !== undefined && <Badge variant="outline" className="text-xs">每股: {sh.currency || 'HKD'} {sh.issuePrice || '0'}</Badge>}
                              {sh.paidUp !== undefined && <Badge variant="outline" className="text-xs text-green-700 border-green-300">已繳: {sh.currency || 'HKD'} {sh.paidUp || '0'}</Badge>}
                              {sh.unpaid !== undefined && <Badge variant="outline" className="text-xs text-orange-700 border-orange-300">未繳: {sh.currency || 'HKD'} {sh.unpaid || '0'}</Badge>}
                            </div>
                          </div>
                          <div className="hidden group-hover:flex gap-1 ml-2 shrink-0">
                            <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={e => {
                              e.stopPropagation(); setEditingShareholder(sh.id);
                              setShForm({ name: sh.name, nameEnglish: sh.nameEnglish, nameChinese: sh.nameChinese, shares: sh.shares, identity: sh.identity, idNumber: sh.idNumber, address: sh.address, serviceAddress: sh.serviceAddress || '', email: sh.email, shareType: sh.shareType || '', issuePrice: sh.issuePrice || '', currency: sh.currency || 'HKD', paidUp: sh.paidUp || '', unpaid: sh.unpaid || '' });
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
                ) : !addingShareholder && <p className="text-muted-foreground text-sm">無股東記錄</p>}
              </TabsContent>

              {/* Tab: SCR */}
              <TabsContent value="scr">
                <SCRTab company={company} />
              </TabsContent>
            </Tabs>
          </div>

          <CopyFromCompanyDialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen} targetCompany={company} />

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
                  <InfoItem label="證件號碼" value={selectedPerson.idNumber || ''} />
                  <InfoItem label="委任日期" value={selectedPerson.dateAppointed || ''} />
                  <InfoItem label="辭任日期" value={selectedPerson.dateCeased || ''} />
                  <InfoItem label="地址" value={selectedPerson.address || ''} />
                  {selectedPerson.identity === 'corporate' && (
                    <>
                      <InfoItem label="成立地點" value={selectedPerson.placeIncorporated || ''} />
                      <InfoItem label="公司編號" value={selectedPerson.companyNumberRef || ''} />
                    </>
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
                  <div className="space-y-1"><Label className="text-xs">證件號碼</Label><Input value={personForm.idNumber} onChange={e => setPersonForm({ ...personForm, idNumber: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">委任日期</Label><Input value={personForm.dateAppointed} onChange={e => setPersonForm({ ...personForm, dateAppointed: e.target.value })} placeholder="DD/MM/YYYY" /></div>
                  <div className="space-y-1"><Label className="text-xs">辭任日期</Label><Input value={personForm.dateCeased} onChange={e => setPersonForm({ ...personForm, dateCeased: e.target.value })} placeholder="DD/MM/YYYY" /></div>
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
                    setShForm({
                      name: selectedSh.name, nameEnglish: selectedSh.nameEnglish, nameChinese: selectedSh.nameChinese,
                      shares: selectedSh.shares, identity: selectedSh.identity, idNumber: selectedSh.idNumber || '',
                      address: selectedSh.address || '', serviceAddress: selectedSh.serviceAddress || '',
                      email: selectedSh.email || '', shareType: selectedSh.shareType || '',
                      issuePrice: selectedSh.issuePrice || '', currency: selectedSh.currency || 'HKD',
                      paidUp: selectedSh.paidUp || '', unpaid: selectedSh.unpaid || '',
                    });
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
                  <div className="space-y-1"><Label className="text-xs">持股數量</Label><Input type="number" value={shForm.shares} onChange={e => setShForm({ ...shForm, shares: parseInt(e.target.value) || 0 })} /></div>
                  <div className="space-y-1"><Label className="text-xs">股份類別</Label><Input value={shForm.shareType} onChange={e => setShForm({ ...shForm, shareType: e.target.value })} placeholder="e.g. Ordinary 普通股" /></div>
                  <div className="space-y-1"><Label className="text-xs">貨幣</Label><Input value={shForm.currency} onChange={e => setShForm({ ...shForm, currency: e.target.value })} placeholder="HKD" /></div>
                  <div className="space-y-1"><Label className="text-xs">每股發行價</Label><Input value={shForm.issuePrice} onChange={e => setShForm({ ...shForm, issuePrice: e.target.value })} placeholder="e.g. 1.00" /></div>
                  <div className="space-y-1"><Label className="text-xs">已繳付股本</Label><Input value={shForm.paidUp} onChange={e => setShForm({ ...shForm, paidUp: e.target.value })} placeholder="Amount paid up" /></div>
                  <div className="space-y-1"><Label className="text-xs">未繳付股本</Label><Input value={shForm.unpaid} onChange={e => setShForm({ ...shForm, unpaid: e.target.value })} placeholder="Amount unpaid" /></div>
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

function PersonRow({ person, isSelected, isSigner, onClick, onDelete, onToggleReserve }: { person: Person; isSelected: boolean; isSigner?: boolean; onClick: () => void; onDelete: () => void; onToggleReserve?: () => void }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors group ${
        isSelected ? 'border-primary bg-primary/10' : person.isReserve ? 'border-amber-300 bg-amber-50/40' : 'border-border bg-muted/30 hover:bg-muted/60'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        {isSigner && (
          <span
            className="inline-block h-2 w-2 rounded-full bg-destructive shrink-0"
            title="NAR1 簽署人"
            aria-label="NAR1 簽署人"
          />
        )}
        <div>
          <span className="font-medium">{person.nameEnglish || person.nameChinese}</span>
          {person.nameEnglish && person.nameChinese && (
            <span className="ml-2 text-muted-foreground">{person.nameChinese}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {person.isReserve && (
          <Badge variant="outline" className="text-xs border-amber-500 text-amber-700">
            預備董事
          </Badge>
        )}
        <Badge variant="outline" className="text-xs">
          {person.identity === 'natural' ? '自然人' : '法人'}
        </Badge>
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

type OfficerFormType = { nameEnglish: string; nameChinese: string; identity: string; idNumber: string; address: string; serviceAddress: string; dateAppointed: string; dateCeased: string; placeIncorporated: string; companyNumberRef: string };

function NewOfficerForm({ form, setForm, onSave, onCancel }: {
  form: OfficerFormType;
  setForm: (f: OfficerFormType) => void; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 mb-2 space-y-2">
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
        <div className="space-y-1"><Label className="text-xs">證件號碼</Label><Input value={form.idNumber} onChange={e => setForm({ ...form, idNumber: e.target.value })} placeholder="ID / Passport No." /></div>
        <div className="space-y-1"><Label className="text-xs">委任日期</Label><Input value={form.dateAppointed} onChange={e => setForm({ ...form, dateAppointed: e.target.value })} placeholder="DD/MM/YYYY" /></div>
        <div className="space-y-1"><Label className="text-xs">辭任日期</Label><Input value={form.dateCeased} onChange={e => setForm({ ...form, dateCeased: e.target.value })} placeholder="DD/MM/YYYY" /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">居住地址</Label><Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} placeholder="地址 Address" /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">服務地址 (預設同註冊辦事處)</Label><Textarea value={form.serviceAddress} onChange={e => setForm({ ...form, serviceAddress: e.target.value })} rows={2} placeholder="留空則自動使用註冊辦事處地址" /></div>
        {form.identity === 'corporate' && (
          <>
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

type ShFormType = { name: string; nameEnglish: string; nameChinese: string; shares: number; identity: string; idNumber: string; address: string; serviceAddress: string; email: string; shareType: string; issuePrice: string; currency: string; paidUp: string; unpaid: string };

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
        <div className="space-y-1"><Label className="text-xs">股數</Label><Input type="number" value={form.shares} onChange={e => setForm({ ...form, shares: parseInt(e.target.value) || 0 })} /></div>
        <div className="space-y-1"><Label className="text-xs">股份類別</Label><Input value={form.shareType} onChange={e => setForm({ ...form, shareType: e.target.value })} placeholder="e.g. Ordinary 普通股" /></div>
        <div className="space-y-1"><Label className="text-xs">貨幣</Label><Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} placeholder="HKD" /></div>
        <div className="space-y-1"><Label className="text-xs">每股發行價</Label><Input value={form.issuePrice} onChange={e => setForm({ ...form, issuePrice: e.target.value })} placeholder="e.g. 1.00" /></div>
        <div className="space-y-1"><Label className="text-xs">已繳付股本</Label><Input value={form.paidUp} onChange={e => setForm({ ...form, paidUp: e.target.value })} placeholder="Amount paid up" /></div>
        <div className="space-y-1"><Label className="text-xs">未繳付股本</Label><Input value={form.unpaid} onChange={e => setForm({ ...form, unpaid: e.target.value })} placeholder="Amount unpaid" /></div>
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
        <div className="space-y-1"><Label className="text-xs">股數</Label><Input type="number" value={shForm.shares} onChange={e => setShForm({ ...shForm, shares: parseInt(e.target.value) || 0 })} /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">股份類別</Label><Input value={shForm.shareType} onChange={e => setShForm({ ...shForm, shareType: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">貨幣</Label><Input value={shForm.currency} onChange={e => setShForm({ ...shForm, currency: e.target.value })} placeholder="HKD" /></div>
        <div className="space-y-1"><Label className="text-xs">每股發行價</Label><Input value={shForm.issuePrice} onChange={e => setShForm({ ...shForm, issuePrice: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">已繳付股本</Label><Input value={shForm.paidUp} onChange={e => setShForm({ ...shForm, paidUp: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">未繳付股本</Label><Input value={shForm.unpaid} onChange={e => setShForm({ ...shForm, unpaid: e.target.value })} /></div>
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

function DocSlot({ label, path, uploading, onUpload, onView, onDownload }: {
  label: string; path?: string; uploading: boolean;
  onUpload: (f: File) => void; onView: () => void; onDownload: () => void;
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
