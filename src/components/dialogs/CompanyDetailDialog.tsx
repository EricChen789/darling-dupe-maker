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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Company, Person, Shareholder } from '@/types';
import {
  Building2, Users, UserCheck, Briefcase, ArrowLeft, User,
  Edit, Save, X, Plus, Trash2,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  useUpdateCompany,
  useAddOfficer, useUpdateOfficer, useDeleteOfficer,
  useAddShareholder, useUpdateShareholder, useDeleteShareholder,
} from '@/hooks/useCompanies';

interface CompanyDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

export const CompanyDetailDialog = ({ open, onOpenChange, company }: CompanyDetailDialogProps) => {
  const [selectedPerson, setSelectedPerson] = useState<(Person & { roleLabel: string }) | null>(null);
  const [selectedSh, setSelectedSh] = useState<Shareholder | null>(null);
  const [editingCompany, setEditingCompany] = useState(false);
  const [editingPerson, setEditingPerson] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<string | null>(null);
  const [editingShDetail, setEditingShDetail] = useState(false);
  const [addingOfficer, setAddingOfficer] = useState<'director' | 'secretary' | null>(null);
  const [addingShareholder, setAddingShareholder] = useState(false);

  // Company edit form
  const [companyForm, setCompanyForm] = useState({ name: '', brNumber: '', tradingName: '', businessNature: '', companyType: '', businessCode: '' });
  // Person edit form
  const [personForm, setPersonForm] = useState({ nameEnglish: '', nameChinese: '', identity: 'natural' as string, idNumber: '' });
  // New officer form
  const [newOfficerForm, setNewOfficerForm] = useState({ nameEnglish: '', nameChinese: '', identity: 'natural', idNumber: '' });
  // Shareholder edit form
  const [shForm, setShForm] = useState({ name: '', nameEnglish: '', nameChinese: '', shares: 0, identity: 'natural', idNumber: '', address: '', email: '' });

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
        name: company.name, brNumber: company.brNumber, tradingName: company.tradingName,
        businessNature: company.businessNature, companyType: company.companyType, businessCode: company.businessCode,
      });
    }
  }, [company]);

  useEffect(() => {
    if (selectedPerson) {
      setPersonForm({
        nameEnglish: selectedPerson.nameEnglish, nameChinese: selectedPerson.nameChinese,
        identity: selectedPerson.identity, idNumber: '',
      });
    }
  }, [selectedPerson]);

  if (!company) return null;

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setSelectedPerson(null);
      setSelectedSh(null);
      setEditingCompany(false);
      setEditingPerson(false);
      setEditingShDetail(false);
      setAddingOfficer(null);
      setAddingShareholder(false);
      setEditingShareholder(null);
    }
    onOpenChange(v);
  };

  const selectPerson = (p: Person, roleLabel: string) => {
    setSelectedSh(null);
    setEditingShDetail(false);
    setSelectedPerson({ ...p, roleLabel });
  };

  const selectShareholder = (sh: Shareholder) => {
    setSelectedPerson(null);
    setEditingPerson(false);
    setSelectedSh(sh);
    setShForm({ name: sh.name, nameEnglish: sh.nameEnglish, nameChinese: sh.nameChinese, shares: sh.shares, identity: sh.identity, idNumber: sh.idNumber, address: sh.address, email: sh.email });
  };

  const handleSaveCompany = () => {
    updateCompany.mutate({ id: company.id, data: companyForm }, {
      onSuccess: () => { toast({ title: '公司資料已更新' }); setEditingCompany(false); },
      onError: () => toast({ title: '更新失敗', variant: 'destructive' }),
    });
  };

  const handleSavePerson = () => {
    if (!selectedPerson) return;
    updateOfficer.mutate({ id: selectedPerson.id, data: { name_english: personForm.nameEnglish, name_chinese: personForm.nameChinese, identity: personForm.identity } }, {
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
    }, {
      onSuccess: () => {
        toast({ title: `${addingOfficer === 'director' ? '董事' : '秘書'}已新增` });
        setAddingOfficer(null);
        setNewOfficerForm({ nameEnglish: '', nameChinese: '', identity: 'natural', idNumber: '' });
      },
      onError: () => toast({ title: '新增失敗', variant: 'destructive' }),
    });
  };

  const handleSaveShareholder = (id: string) => {
    updateShareholder.mutate({ id, data: { name: shForm.name, name_english: shForm.nameEnglish, name_chinese: shForm.nameChinese, shares: shForm.shares, identity: shForm.identity, id_number: shForm.idNumber, address: shForm.address, email: shForm.email } }, {
      onSuccess: () => { toast({ title: '股東已更新' }); setEditingShareholder(null); },
      onError: () => toast({ title: '更新失敗', variant: 'destructive' }),
    });
  };

  const handleAddShareholder = () => {
    if (!shForm.name) { toast({ title: '請填寫股東名稱', variant: 'destructive' }); return; }
    addShareholder.mutate({ company_id: company.id, name: shForm.name, shares: shForm.shares }, {
      onSuccess: () => {
        toast({ title: '股東已新增' });
        setAddingShareholder(false);
        setShForm({ name: '', nameEnglish: '', nameChinese: '', shares: 0, identity: 'natural', idNumber: '', address: '', email: '' });
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
          {/* Left: Company info */}
          <div className={`overflow-y-auto p-6 pt-2 transition-all ${(selectedPerson || selectedSh) ? 'w-1/2 border-r border-border' : 'w-full'}`}>

            {/* Company basic info */}
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
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <InfoItem label="商業登記號碼" value={company.brNumber} />
                <InfoItem label="商業名稱" value={company.tradingName} />
                <InfoItem label="公司類型" value={company.companyType} />
                <InfoItem label="業務性質" value={company.businessNature} />
                <InfoItem label="業務代碼" value={company.businessCode} />
                <InfoItem label="最後更新" value={company.updatedAt} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div className="space-y-1"><Label className="text-xs">公司名稱</Label><Input value={companyForm.name} onChange={e => setCompanyForm({ ...companyForm, name: e.target.value })} /></div>
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
              </div>
            )}

            <Separator className="my-4" />

            {/* Directors */}
            <div className="flex items-center justify-between mb-2">
              <SectionHeader icon={<Users className="h-4 w-4 text-primary" />} title="董事" count={company.directors.length} />
              <Button variant="ghost" size="sm" onClick={() => { setAddingOfficer('director'); setNewOfficerForm({ nameEnglish: '', nameChinese: '', identity: 'natural', idNumber: '' }); }}>
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
              <Button variant="ghost" size="sm" onClick={() => { setAddingOfficer('secretary'); setNewOfficerForm({ nameEnglish: '', nameChinese: '', identity: 'natural', idNumber: '' }); }}>
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

            <Separator className="my-4" />

            {/* Shareholders */}
            <div className="flex items-center justify-between mb-2">
              <SectionHeader icon={<Briefcase className="h-4 w-4 text-primary" />} title="股東" count={company.shareholders.length} />
              <Button variant="ghost" size="sm" onClick={() => { setAddingShareholder(true); setShForm({ name: '', shares: 0 }); }}>
                <Plus className="h-3.5 w-3.5 mr-1" /> 新增
              </Button>
            </div>
            {addingShareholder && (
              <div className="rounded-md border border-primary/50 bg-primary/5 p-3 mb-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label className="text-xs">股東名稱</Label><Input value={shForm.name} onChange={e => setShForm({ ...shForm, name: e.target.value })} placeholder="輸入股東名稱" /></div>
                  <div className="space-y-1"><Label className="text-xs">股數</Label><Input type="number" value={shForm.shares} onChange={e => setShForm({ ...shForm, shares: parseInt(e.target.value) || 0 })} /></div>
                </div>
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setAddingShareholder(false)}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
                  <Button size="sm" onClick={handleAddShareholder} className="bg-primary text-primary-foreground"><Save className="h-3.5 w-3.5 mr-1" /> 新增</Button>
                </div>
              </div>
            )}
            {company.shareholders.length > 0 ? (
              <div className="grid gap-2">
                {company.shareholders.map((sh, i) => (
                  editingShareholder === sh.id ? (
                    <div key={i} className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1"><Label className="text-xs">股東名稱</Label><Input value={shForm.name} onChange={e => setShForm({ ...shForm, name: e.target.value })} /></div>
                        <div className="space-y-1"><Label className="text-xs">股數</Label><Input type="number" value={shForm.shares} onChange={e => setShForm({ ...shForm, shares: parseInt(e.target.value) || 0 })} /></div>
                      </div>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setEditingShareholder(null)}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
                        <Button size="sm" onClick={() => handleSaveShareholder(sh.id)} className="bg-primary text-primary-foreground"><Save className="h-3.5 w-3.5 mr-1" /> 儲存</Button>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors group ${
                      selectedSh?.id === sh.id ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/60'
                    }`} onClick={() => selectShareholder(sh)}>
                      <span className="font-medium">{sh.name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{sh.shares.toLocaleString()} 股</Badge>
                        <div className="hidden group-hover:flex gap-1">
                          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={e => { e.stopPropagation(); setEditingShareholder(sh.id); setShForm({ name: sh.name, shares: sh.shares }); }}>
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
                  <InfoItem label="電郵" value={selectedPerson.email} />
                  <InfoItem label="商業登記號碼" value={selectedPerson.brNumber || ''} />
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
                  <InfoItem label="股東名稱" value={selectedSh.name} />
                  <InfoItem label="持股數量" value={selectedSh.shares.toLocaleString() + ' 股'} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1"><Label className="text-xs">股東名稱</Label><Input value={shForm.name} onChange={e => setShForm({ ...shForm, name: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">持股數量</Label><Input type="number" value={shForm.shares} onChange={e => setShForm({ ...shForm, shares: parseInt(e.target.value) || 0 })} /></div>
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

function NewOfficerForm({ form, setForm, onSave, onCancel }: {
  form: { nameEnglish: string; nameChinese: string; identity: string; idNumber: string };
  setForm: (f: any) => void; onSave: () => void; onCancel: () => void;
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
        <div className="space-y-1"><Label className="text-xs">身份證號碼</Label><Input value={form.idNumber} onChange={e => setForm({ ...form, idNumber: e.target.value })} placeholder="ID Number" /></div>
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
