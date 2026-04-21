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
const emptyShForm = () => ({ name: '', nameEnglish: '', nameChinese: '', shares: 0, identity: 'natural', idNumber: '', address: '', serviceAddress: '', email: '', shareType: '' });

export const CompanyDetailDialog = ({ open, onOpenChange, company }: CompanyDetailDialogProps) => {
  const [selectedPerson, setSelectedPerson] = useState<(Person & { roleLabel: string }) | null>(null);
  const [selectedSh, setSelectedSh] = useState<Shareholder | null>(null);
  const [editingCompany, setEditingCompany] = useState(false);
  const [editingPerson, setEditingPerson] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<string | null>(null);
  const [editingShDetail, setEditingShDetail] = useState(false);
  const [addingOfficer, setAddingOfficer] = useState<'director' | 'secretary' | null>(null);
  const [addingShareholder, setAddingShareholder] = useState(false);

  const [companyForm, setCompanyForm] = useState({ name: '', chineseName: '', brNumber: '', tradingName: '', businessNature: '', companyType: '', businessCode: '', regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '', incorporationDate: '', jurisdiction: 'Hong Kong', ciFilePath: '', brFilePath: '' });
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
    if (company) {
      setCompanyForm({
        name: company.name, chineseName: company.chineseName || '', brNumber: company.brNumber, tradingName: company.tradingName,
        businessNature: company.businessNature, companyType: company.companyType, businessCode: company.businessCode,
        regFlat: company.regFlat || '', regBuilding: company.regBuilding || '', regStreet: company.regStreet || '',
        regDistrict: company.regDistrict || '', regRegion: company.regRegion || '',
        incorporationDate: company.incorporationDate || '', jurisdiction: company.jurisdiction || 'Hong Kong',
        ciFilePath: company.ciFilePath || '', brFilePath: company.brFilePath || '',
      });
    }
  }, [company]);

  useEffect(() => {
    if (selectedPerson) {
      setPersonForm({
        nameEnglish: selectedPerson.nameEnglish, nameChinese: selectedPerson.nameChinese,
        identity: selectedPerson.identity, idNumber: selectedPerson.idNumber || '',
        address: selectedPerson.address || '',
        serviceAddress: selectedPerson.serviceAddress || '',
        dateAppointed: selectedPerson.dateAppointed || '',
        dateCeased: selectedPerson.dateCeased || '', placeIncorporated: selectedPerson.placeIncorporated || '',
        companyNumberRef: selectedPerson.companyNumberRef || '',
      });
    }
  }, [selectedPerson]);

  if (!company) return null;

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
    setShForm({ name: sh.name, nameEnglish: sh.nameEnglish, nameChinese: sh.nameChinese, shares: sh.shares, identity: sh.identity, idNumber: sh.idNumber, address: sh.address, serviceAddress: sh.serviceAddress || '', email: sh.email, shareType: sh.shareType || '' });
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
      const newForm = { ...companyForm, [kind === 'ci' ? 'ciFilePath' : 'brFilePath']: path };
      setCompanyForm(newForm);
      updateCompany.mutate({ id: company.id, data: newForm }, {
        onSuccess: () => toast({ title: kind === 'ci' ? 'CI 已上傳' : 'BR 已上傳' }),
        onError: () => toast({ title: '上傳成功，儲存連結失敗', variant: 'destructive' }),
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

  const handleSavePerson = () => {
    if (!selectedPerson) return;
    updateOfficer.mutate({ id: selectedPerson.id, data: {
      name_english: personForm.nameEnglish, name_chinese: personForm.nameChinese,
      identity: personForm.identity, id_number: personForm.idNumber,
      address: personForm.address, date_appointed: personForm.dateAppointed || undefined,
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
      address: newOfficerForm.address, date_appointed: newOfficerForm.dateAppointed || undefined,
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

  const handleSaveShareholder = (id: string) => {
    updateShareholder.mutate({ id, data: { name: shForm.name, name_english: shForm.nameEnglish, name_chinese: shForm.nameChinese, shares: shForm.shares, identity: shForm.identity, id_number: shForm.idNumber, address: shForm.address, email: shForm.email, share_type: shForm.shareType } }, {
      onSuccess: () => { toast({ title: '股東已更新' }); setEditingShareholder(null); },
      onError: () => toast({ title: '更新失敗', variant: 'destructive' }),
    });
  };

  const handleAddShareholder = () => {
    if (!shForm.name && !shForm.nameEnglish) { toast({ title: '請填寫股東名稱', variant: 'destructive' }); return; }
    addShareholder.mutate({
      company_id: company.id, name: shForm.name || shForm.nameEnglish,
      name_english: shForm.nameEnglish, name_chinese: shForm.nameChinese,
      shares: shForm.shares, identity: shForm.identity, id_number: shForm.idNumber,
      address: shForm.address, email: shForm.email, share_type: shForm.shareType,
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
                    <InfoItem label="中文名稱" value={company.chineseName} />
                    <InfoItem label="商業登記號碼" value={company.brNumber} />
                    <InfoItem label="商業名稱" value={company.tradingName} />
                    <InfoItem label="公司類型" value={company.companyType} />
                    <InfoItem label="業務性質" value={company.businessNature} />
                    <InfoItem label="業務代碼" value={company.businessCode} />
                    <InfoItem label="成立日期" value={company.incorporationDate} />
                    <InfoItem label="司法管轄區" value={company.jurisdiction} />
                    <div className="col-span-2">
                      <InfoItem label="註冊辦事處地址" value={[company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion].filter(Boolean).join(', ') || '—'} />
                    </div>
                    <InfoItem label="最後更新" value={company.updatedAt} />
                    <div className="col-span-2 border-t border-border pt-3 mt-2 grid grid-cols-2 gap-4">
                      <DocSlot label="公司註冊證書 (CI)" path={company.ciFilePath} uploading={uploadingCi}
                        onUpload={(f) => uploadDoc(f, 'ci')} onDownload={() => downloadDoc(company.ciFilePath || '')} />
                      <DocSlot label="商業登記證 (BR)" path={company.brFilePath} uploading={uploadingBr}
                        onUpload={(f) => uploadDoc(f, 'br')} onDownload={() => downloadDoc(company.brFilePath || '')} />
                    </div>
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
                {/* Directors */}
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<Users className="h-4 w-4 text-primary" />} title="董事" count={company.directors.length} />
                  <Button variant="ghost" size="sm" onClick={() => { setAddingOfficer('director'); setNewOfficerForm(emptyOfficerForm()); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                  </Button>
                </div>
                {addingOfficer === 'director' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} />}
                {company.directors.length > 0 ? (
                  <div className="grid gap-2">
                    {company.directors.map((d, i) => (
                      <PersonRow key={i} person={d} isSelected={selectedPerson?.id === d.id}
                        onClick={() => selectPerson(d, '董事')}
                        onDelete={() => handleDeleteOfficer(d, '董事')} />
                    ))}
                  </div>
                ) : !addingOfficer && <p className="text-muted-foreground text-sm">無董事記錄</p>}

                <Separator className="my-4" />

                {/* Secretaries */}
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<UserCheck className="h-4 w-4 text-primary" />} title="秘書" count={company.secretaries.length} />
                  <Button variant="ghost" size="sm" onClick={() => { setAddingOfficer('secretary'); setNewOfficerForm(emptyOfficerForm()); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> 新增
                  </Button>
                </div>
                {addingOfficer === 'secretary' && <NewOfficerForm form={newOfficerForm} setForm={setNewOfficerForm} onSave={handleAddOfficer} onCancel={() => setAddingOfficer(null)} />}
                {company.secretaries.length > 0 ? (
                  <div className="grid gap-2">
                    {company.secretaries.map((s, i) => (
                      <PersonRow key={i} person={s} isSelected={selectedPerson?.id === s.id}
                        onClick={() => selectPerson(s, '秘書')}
                        onDelete={() => handleDeleteOfficer(s, '秘書')} />
                    ))}
                  </div>
                ) : !addingOfficer && <p className="text-muted-foreground text-sm">無秘書記錄</p>}
              </TabsContent>

              {/* Tab: 股東 */}
              <TabsContent value="shareholders">
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader icon={<Briefcase className="h-4 w-4 text-primary" />} title="股東" count={company.shareholders.length} />
                  <Button variant="ghost" size="sm" onClick={() => { setAddingShareholder(true); setShForm(emptyShForm()); }}>
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
                        <div key={i} className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors group ${
                          selectedSh?.id === sh.id ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/60'
                        }`} onClick={() => selectShareholder(sh)}>
                           <span className="font-medium">{sh.nameEnglish || sh.nameChinese || sh.name}</span>
                           {sh.nameEnglish && sh.nameChinese && <span className="ml-2 text-muted-foreground">{sh.nameChinese}</span>}
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{sh.shares.toLocaleString()} 股</Badge>
                            {sh.shareType && <Badge variant="outline" className="text-xs">{sh.shareType}</Badge>}
                            <div className="hidden group-hover:flex gap-1">
                              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={e => {
                                e.stopPropagation(); setEditingShareholder(sh.id);
                                setShForm({ name: sh.name, nameEnglish: sh.nameEnglish, nameChinese: sh.nameChinese, shares: sh.shares, identity: sh.identity, idNumber: sh.idNumber, address: sh.address, email: sh.email, shareType: sh.shareType || '' });
                              }}>
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive" onClick={e => { e.stopPropagation(); handleDeleteShareholder(sh); }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                ) : !addingShareholder && <p className="text-muted-foreground text-sm">無股東記錄</p>}
              </TabsContent>
            </Tabs>
          </div>

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
                  <div className="col-span-2 space-y-1"><Label className="text-xs">地址</Label><Textarea value={personForm.address} onChange={e => setPersonForm({ ...personForm, address: e.target.value })} rows={2} /></div>
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
                  <Button variant="ghost" size="sm" onClick={() => setEditingShDetail(true)}>
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
                  <div className="col-span-2 space-y-1"><Label className="text-xs">地址</Label><Textarea value={shForm.address} onChange={e => setShForm({ ...shForm, address: e.target.value })} rows={2} /></div>
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

function PersonRow({ person, isSelected, onClick, onDelete }: { person: Person; isSelected: boolean; onClick: () => void; onDelete: () => void }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors group ${
        isSelected ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/60'
      }`}
      onClick={onClick}
    >
      <div>
        <span className="font-medium">{person.nameEnglish || person.nameChinese}</span>
        {person.nameEnglish && person.nameChinese && (
          <span className="ml-2 text-muted-foreground">{person.nameChinese}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {person.identity === 'natural' ? '自然人' : '法人'}
        </Badge>
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
        <div className="col-span-2 space-y-1"><Label className="text-xs">地址</Label><Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} placeholder="地址 Address" /></div>
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

type ShFormType = { name: string; nameEnglish: string; nameChinese: string; shares: number; identity: string; idNumber: string; address: string; serviceAddress: string; email: string; shareType: string };

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
        <div className="space-y-1"><Label className="text-xs">電郵</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">地址</Label><Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} placeholder="地址 Address" /></div>
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
        <div className="space-y-1"><Label className="text-xs">股數</Label><Input type="number" value={shForm.shares} onChange={e => setShForm({ ...shForm, shares: parseInt(e.target.value) || 0 })} /></div>
        <div className="space-y-1"><Label className="text-xs">股份類別</Label><Input value={shForm.shareType} onChange={e => setShForm({ ...shForm, shareType: e.target.value })} /></div>
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

function DocSlot({ label, path, uploading, onUpload, onDownload }: {
  label: string; path?: string; uploading: boolean;
  onUpload: (f: File) => void; onDownload: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="flex items-center gap-2">
        {path ? (
          <Button type="button" variant="outline" size="sm" onClick={onDownload} className="gap-1">
            <FileText className="h-3.5 w-3.5" /> 查看
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">尚未上傳</span>
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
