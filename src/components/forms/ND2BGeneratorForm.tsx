import { useState, useEffect, useMemo, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import { ArrowLeft, Download, Loader2, Building2, User2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { Person } from '@/types';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import PresenterSelector from './PresenterSelector';
import type { Presenter } from '@/hooks/usePresenters';
import AddressQuickPick from './AddressQuickPick';
import { recordChangeEvent } from '@/lib/changeEvents';

// ── 香港 18 區（繁體，用於下拉選單） ──
const HK_DISTRICTS = [
  '中西區', '灣仔', '東區', '南區',
  '油尖旺', '深水埗', '九龍城', '黃大仙',
  '觀塘', '葵青', '荃灣', '屯門',
  '元朗', '北區', '大埔', '沙田',
  '西貢', '離島',
];

const HK_REGIONS = ['香港', '九龍', '新界'];

// ── 提取变更值用于 change_event 记录 ──
function getChangeValue(changeType: string, formData: any): Record<string, any> | null {
  switch (changeType) {
    case 'address': {
      const addr: Record<string, string> = {};
      if (formData.newFlat) addr.addr_flat = formData.newFlat;
      if (formData.newBuilding) addr.addr_building = formData.newBuilding;
      if (formData.newStreet) addr.addr_street = formData.newStreet;
      if (formData.newDistrict) addr.addr_district = formData.newDistrict;
      if (formData.newRegion) addr.addr_region = formData.newRegion;
      return Object.keys(addr).length > 0 ? addr : null;
    }
    case 'name': {
      const name: Record<string, string> = {};
      const fullEng = [formData.newNameSurname, formData.newNameOtherNames].filter(Boolean).join(' ').trim();
      if (fullEng) name.name_english = fullEng;
      if (formData.newNameChinese) name.name_chinese = formData.newNameChinese;
      if (formData.newAliasEnglish) name.alias_english = formData.newAliasEnglish;
      if (formData.newAliasChinese) name.alias_chinese = formData.newAliasChinese;
      return Object.keys(name).length > 0 ? name : null;
    }
    case 'id':
      return formData.newIdNumber ? { id_number: formData.newIdNumber } : null;
    case 'contact':
      return formData.newEmail ? { email: formData.newEmail } : null;
    default:
      return null;
  }
}

// ── 地址欄位值型別 ──
interface AddressValues {
  flat: string;
  building: string;
  street: string;
  district: string;
  region: string;
}

// ── 模組級別 AddressFields（避免 inline component 導致輸入失焦） ──
const AddressFields = memo(function AddressFields({
  label,
  values,
  onChange,
}: {
  label: string;
  values: AddressValues;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <div>
      <Label className="font-medium mb-2 block">{label}</Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">室／樓層 Flat／Room</Label>
          <Input
            value={values.flat}
            onChange={e => onChange('flat', e.target.value)}
            className="mt-1" placeholder="Flat / Room"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">座／大廈／屋苑 Block／Building</Label>
          <Input
            value={values.building}
            onChange={e => onChange('building', e.target.value)}
            className="mt-1" placeholder="Block / Building / Estate"
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">街道 Street</Label>
          <Input
            value={values.street}
            onChange={e => onChange('street', e.target.value)}
            className="mt-1" placeholder="Street / Road"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">區 District</Label>
          <Select value={values.district} onValueChange={v => onChange('district', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="選擇地區..." /></SelectTrigger>
            <SelectContent>
              {HK_DISTRICTS.map(d => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">國家／地區 Country／Region</Label>
          <Input
            value={values.region}
            onChange={e => onChange('region', e.target.value)}
            className="mt-1" placeholder="e.g. 香港"
          />
        </div>
      </div>
    </div>
  );
});

// ── ND2BGeneratorForm ──
interface ND2BGeneratorFormProps {
  onBack: () => void;
  prefillPerson?: Person | null;
  prefillNewAddress?: string;
  initialCompanyId?: string;
}

export default function ND2BGeneratorForm({ onBack, prefillPerson, prefillNewAddress, initialCompanyId }: ND2BGeneratorFormProps) {
  const { data: allCompanies = [] } = useCompanies();
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const companies = prefillPerson?.companies?.length
    ? allCompanies.filter(c => prefillPerson.companies.some(pc => pc.id === c.id))
    : allCompanies;

  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState(prefillPerson?.id || '');
  const [generating, setGenerating] = useState(false);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [formData, setFormData] = useState({
    brNumber: '',
    companyName: '',
    role: (prefillPerson?.role === 'secretary' ? 'secretary' : 'director') as 'secretary' | 'director',
    identity: (prefillPerson?.identity || 'natural') as 'natural' | 'corporate',
    nameSurname: '',
    nameOtherNames: '',
    nameEnglish: prefillPerson?.nameEnglish || '',
    nameChinese: prefillPerson?.nameChinese || '',
    idNumber: prefillPerson?.idNumber || '',
    passportNumber: prefillPerson?.passportNumber || '',
    passportPlaceOfIssue: '',
    // 現有通訊地址
    addrFlat: prefillPerson?.addrFlat || '',
    addrBlock: '',
    addrBuilding: prefillPerson?.addrBuilding || '',
    addrStreet: prefillPerson?.addrStreet || '',
    addrDistrict: prefillPerson?.addrDistrict || '',
    addrRegion: prefillPerson?.addrRegion || '',
    // 變更類型（多選）
    changeTypes: ([] as string[]),
    // 新名稱
    newNameChinese: '',
    newNameSurname: '',
    newNameOtherNames: '',
    // 別名（Also Known As）
    newAliasEnglish: '',
    newAliasChinese: '',
    // 新證件
    newIdNumber: '',
    // 新通訊地址
    newFlat: '',
    newBlock: '',
    newBuilding: '',
    newStreet: '',
    newDistrict: '',
    newRegion: '',
    // 新聯絡資料
    newEmail: '',
    // 變更說明
    changeDescription: '',
    effectiveDate: todayStr,
    // 簽署及提交
    signerName: '',
    signDate: todayStr,
    presentorName: '',
    presentorAddress: '',
    presentorPhone: '',
    presentorFax: '',
    presentorEmail: '',
    presentorReference: '',
  });

  const newAddrValues = useMemo<AddressValues>(() => ({
    flat: formData.newFlat,
    building: formData.newBuilding,
    street: formData.newStreet,
    district: formData.newDistrict,
    region: formData.newRegion,
  }), [formData.newFlat, formData.newBuilding, formData.newStreet, formData.newDistrict, formData.newRegion]);

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );

  const companyPeople = useMemo(() => {
    if (!selectedCompany) return [];
    const people: (Person & { _label: string })[] = [];
    for (const d of selectedCompany.directors || []) {
      people.push({ ...d, _label: `${d.nameEnglish || d.nameChinese} — 董事 Director` });
    }
    for (const s of selectedCompany.secretaries || []) {
      people.push({ ...s, _label: `${s.nameEnglish || s.nameChinese} — 公司秘書 Secretary` });
    }
    return people;
  }, [selectedCompany]);

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    setSelectedPersonId('');
    const company = companies.find(c => c.id === companyId);
    if (company) {
      const regAddress = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
        .filter(Boolean).join(', ');
      setFormData(prev => ({
        ...prev,
        brNumber: company.brNumber,
        companyName: company.name,
        presentorName: company.name,
        presentorAddress: regAddress,
      }));
    }
  };

  const handlePersonSelect = (personId: string) => {
    setSelectedPersonId(personId);
    const person = companyPeople.find(p => p.id === personId);
    if (person) {
      // Split nameEnglish: first word = surname, rest = other names
      const nameParts = (person.nameEnglish || '').trim().split(/\s+/);
      const personSurname = nameParts[0] || '';
      const personOtherNames = nameParts.slice(1).join(' ');
      setFormData(prev => ({
        ...prev,
        role: person.role === 'secretary' ? 'secretary' : 'director',
        identity: person.identity || 'natural',
        nameEnglish: person.nameEnglish || '',
        nameChinese: person.nameChinese || '',
        nameSurname: prev.nameSurname || personSurname,
        nameOtherNames: prev.nameOtherNames || personOtherNames,
        idNumber: person.idNumber || '',
        passportNumber: person.passportNumber || '',
        addrFlat: person.addrFlat || '',
        addrBlock: '',
        addrBuilding: person.addrBuilding || '',
        addrStreet: person.addrStreet || '',
        addrDistrict: person.addrDistrict || '',
        addrRegion: person.addrRegion || '',
        newFlat: prev.newFlat || person.addrFlat || '',
        newBuilding: prev.newBuilding || person.addrBuilding || '',
        newStreet: prev.newStreet || person.addrStreet || '',
        newDistrict: prev.newDistrict || person.addrDistrict || '',
        newRegion: prev.newRegion || person.addrRegion || '',
      }));
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) {
      handleCompanySelect(initialCompanyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  // Apply prefillPerson if provided (from People page)
  useEffect(() => {
    if (prefillPerson && selectedPersonId !== prefillPerson.id) {
      setSelectedPersonId(prefillPerson.id || '');
      const nameParts = (prefillPerson.nameEnglish || '').trim().split(/\s+/);
      const personSurname = nameParts[0] || '';
      const personOtherNames = nameParts.slice(1).join(' ');
      setFormData(prev => ({
        ...prev,
        role: prefillPerson.role === 'secretary' ? 'secretary' : 'director',
        identity: prefillPerson.identity || 'natural',
        nameEnglish: prefillPerson.nameEnglish || '',
        nameChinese: prefillPerson.nameChinese || '',
        nameSurname: prev.nameSurname || personSurname,
        nameOtherNames: prev.nameOtherNames || personOtherNames,
        idNumber: prefillPerson.idNumber || '',
        passportNumber: prefillPerson.passportNumber || '',
        addrFlat: prefillPerson.addrFlat || '',
        addrBlock: '',
        addrBuilding: prefillPerson.addrBuilding || '',
        addrStreet: prefillPerson.addrStreet || '',
        addrDistrict: prefillPerson.addrDistrict || '',
        addrRegion: prefillPerson.addrRegion || '',
        newFlat: prev.newFlat || prefillPerson.addrFlat || '',
        newBuilding: prev.newBuilding || prefillPerson.addrBuilding || '',
        newStreet: prev.newStreet || prefillPerson.addrStreet || '',
        newDistrict: prev.newDistrict || prefillPerson.addrDistrict || '',
        newRegion: prev.newRegion || prefillPerson.addrRegion || '',
      }));
    }
  }, [prefillPerson, prefillNewAddress]);

  const update = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleLoadHistory = (data: any) => {
    if (data.formData) {
      // Backward compat: if old history had nameEnglish but not nameSurname, auto-split
      const fd = { ...data.formData };
      if ((!fd.nameSurname && !fd.nameOtherNames) && fd.nameEnglish) {
        const parts = fd.nameEnglish.trim().split(/\s+/);
        fd.nameSurname = parts[0] || '';
        fd.nameOtherNames = parts.slice(1).join(' ');
      }
      // Backward compat: old newNameEnglish → split into newNameSurname + newNameOtherNames
      if (fd.newNameEnglish && !fd.newNameSurname && !fd.newNameOtherNames) {
        const parts = fd.newNameEnglish.trim().split(/\s+/);
        fd.newNameSurname = parts[0] || '';
        fd.newNameOtherNames = parts.slice(1).join(' ');
        delete fd.newNameEnglish;
      }
      // Backward compat: old changeType string → changeTypes array
      if (typeof fd.changeType === 'string' && fd.changeType) {
        fd.changeTypes = [fd.changeType];
        delete fd.changeType;
      }
      if (!Array.isArray(fd.changeTypes)) fd.changeTypes = [];
      // Backward compat: old history may not have passportPlaceOfIssue
      if (!fd.passportPlaceOfIssue) fd.passportPlaceOfIssue = '';
      setFormData(prev => ({ ...prev, ...fd }));
    }
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
    if (data.selectedPersonId) setSelectedPersonId(data.selectedPersonId);
  };

  const handleGenerate = async (debug = false) => {
    if (!formData.brNumber || !formData.companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    if (!formData.nameSurname && !formData.nameChinese) {
      toast({ title: '錯誤', description: '請填寫人員姓名', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const payload = {
        ...formData,
        companyId: selectedCompanyId,
        personId: selectedPersonId,
        debug,
      };
      const resp = await fetch(`/api/generate-nd2b-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      downloadBase64Pdf(result.pdf, `ND2B-${formData.companyName || 'form'}.pdf`);
      saveFormHistory({ formType: 'ND2B', formData: { formData, selectedCompanyId, selectedPersonId } });

      // Record change events to Supabase (fire-and-forget)
      if (selectedCompanyId && selectedPersonId && formData.changeTypes.length > 0) {
        for (const ct of formData.changeTypes) {
          const eventType = {
            address: 'person_address_change',
            name: 'person_name_change',
            id: 'person_id_change',
            contact: 'person_contact_change',
          }[ct];
          const newValue = getChangeValue(ct, formData);
          if (eventType && newValue) {
            recordChangeEvent({
              company_id: selectedCompanyId,
              person_id: selectedPersonId,
              event_type: eventType,
              role: formData.role,
              new_value: newValue,
              related_form_type: 'ND2B',
              change_date: formData.effectiveDate,
            });
          }
        }
      }

      const changeCount = formData.changeTypes.length;
      const changeDesc = changeCount > 0
        ? `已記錄 ${changeCount} 項變更：${formData.changeTypes.map((t: string) => ({address:'地址', name:'姓名', id:'證件', contact:'聯絡'}[t] || t)).join('、')}`
        : '';
      toast({ title: '生成成功', description: `ND2B 表格已下載${changeDesc ? ' · ' + changeDesc : ''}` });
    } catch (err: any) {
      toast({ title: '生成失敗', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div>
          <h1 className="text-2xl font-bold">ND2B — 更改公司秘書及董事詳情通知書</h1>
          <p className="text-sm text-muted-foreground">Notice of Change in Particulars of Company Secretary and Director</p>
        </div>
      </div>

      <FormHistorySelector formType="ND2B" onSelect={handleLoadHistory} />

      {/* Company selector */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="h-4 w-4 text-primary" />
          <Label className="font-medium">選擇公司自動填入</Label>
        </div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
          <SelectContent>
            {companies.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name} ({c.brNumber})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Person selector */}
      {selectedCompany && companyPeople.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <User2 className="h-4 w-4 text-primary" />
            <Label className="font-medium">選擇董事/秘書自動填入</Label>
            <span className="text-xs text-muted-foreground">（從 {selectedCompany.name} 的人員中選取）</span>
          </div>
          <Select value={selectedPersonId} onValueChange={handlePersonSelect}>
            <SelectTrigger><SelectValue placeholder="選擇人員..." /></SelectTrigger>
            <SelectContent>
              {companyPeople.map(p => (
                <SelectItem key={p.id} value={p.id}>{p._label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* Company info */}
        <div>
          <h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Officer current info */}
        <div>
          <h3 className="font-semibold mb-3">董事/秘書現有資料</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <Label>職位</Label>
              <Select value={formData.role} onValueChange={v => update('role', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="director">董事 Director</SelectItem>
                  <SelectItem value="secretary">公司秘書 Secretary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>身分</Label>
              <Select value={formData.identity} onValueChange={v => update('identity', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">自然人 Natural Person</SelectItem>
                  <SelectItem value="corporate">法人團體 Body Corporate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* Name fields — full width to match PDF order */}
          <div className="mb-4">
            <Label>中文姓名</Label>
            <Input value={formData.nameChinese} onChange={e => update('nameChinese', e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div><Label>英文姓氏 Surname *</Label><Input value={formData.nameSurname} onChange={e => update('nameSurname', e.target.value)} className="mt-1" placeholder="e.g. Zhao" /></div>
            <div><Label>英文名字 Other Names</Label><Input value={formData.nameOtherNames} onChange={e => update('nameOtherNames', e.target.value)} className="mt-1" placeholder="e.g. Tong" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>身份證號碼</Label><Input value={formData.idNumber} onChange={e => update('idNumber', e.target.value)} className="mt-1" placeholder="e.g. F3689283" /></div>
            <div><Label>護照號碼</Label><Input value={formData.passportNumber} onChange={e => update('passportNumber', e.target.value)} className="mt-1" placeholder="e.g. EL1234567" /></div>
          </div>
        </div>

        {/* Change details */}
        <div>
          <h3 className="font-semibold mb-3">變更詳情</h3>

          {/* Checkbox 多選變更類型 */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
            {([
              { value: 'address', label: '住址更改' },
              { value: 'name', label: '姓名更改' },
              { value: 'id', label: '證件號碼更改' },
              { value: 'contact', label: '聯絡資料更改' },
            ]).map(item => (
              <label key={item.value} className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={formData.changeTypes.includes(item.value)}
                  onCheckedChange={() => {
                    setFormData(prev => {
                      const types = prev.changeTypes.includes(item.value)
                        ? prev.changeTypes.filter(t => t !== item.value)
                        : [...prev.changeTypes, item.value];
                      return { ...prev, changeTypes: types };
                    });
                  }}
                />
                <span className="text-sm">{item.label}</span>
              </label>
            ))}
          </div>

          <div className="space-y-4">
            {formData.changeTypes.includes('address') && (
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-sm mb-3 text-primary">住址更改</h4>
                {selectedCompanyId && (
                  <AddressQuickPick companyId={selectedCompanyId}
                    onPick={(d) => {
                      if (d.flat) update('newFlat', d.flat);
                      if (d.building) update('newBuilding', d.building);
                      if (d.street) update('newStreet', d.street);
                      if (d.district) update('newDistrict', d.district);
                      if (d.country || d.region) update('newRegion', d.country || d.region || '');
                    }}
                  />
                )}
                <AddressFields
                  label="更改後的新通訊地址"
                  values={newAddrValues}
                  onChange={(field, value) => update(`new${field.charAt(0).toUpperCase() + field.slice(1)}`, value)}
                />
              </div>
            )}

            {formData.changeTypes.includes('name') && (
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-sm mb-3 text-primary">姓名更改</h4>
                <div><Label>新中文姓名</Label><Input value={formData.newNameChinese} onChange={e => update('newNameChinese', e.target.value)} className="mt-1" placeholder="更改後的中文姓名" /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                  <div><Label>新英文姓氏 Surname</Label><Input value={formData.newNameSurname} onChange={e => update('newNameSurname', e.target.value)} className="mt-1" placeholder="e.g. CHAN" /></div>
                  <div><Label>新英文名字 Other Names</Label><Input value={formData.newNameOtherNames} onChange={e => update('newNameOtherNames', e.target.value)} className="mt-1" placeholder="e.g. Tai Man" /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-border">
                  <div><Label>英文別名（Also Known As）</Label><Input value={formData.newAliasEnglish} onChange={e => update('newAliasEnglish', e.target.value)} className="mt-1" placeholder="別名／前用名（英文）" /></div>
                  <div><Label>中文別名</Label><Input value={formData.newAliasChinese} onChange={e => update('newAliasChinese', e.target.value)} className="mt-1" placeholder="別名／前用名（中文）" /></div>
                </div>
              </div>
            )}

            {formData.changeTypes.includes('id') && (
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-sm mb-3 text-primary">證件號碼更改</h4>
                <div className="mb-4"><Label>新證件號碼</Label><Input value={formData.newIdNumber} onChange={e => update('newIdNumber', e.target.value)} className="mt-1" placeholder="填入新證件號碼" /></div>
                <div className="border-t border-border pt-4 mt-4">
                  <h4 className="font-medium text-sm mb-3 text-muted-foreground">護照更改</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div><Label>護照簽發地區</Label><Input value={formData.passportPlaceOfIssue} onChange={e => update('passportPlaceOfIssue', e.target.value)} className="mt-1" placeholder="e.g. HKSAR / BNO" /></div>
                    <div><Label>護照號碼</Label><Input value={formData.passportNumber} onChange={e => update('passportNumber', e.target.value)} className="mt-1" placeholder="e.g. EL1234567" /></div>
                  </div>
                </div>
              </div>
            )}

            {formData.changeTypes.includes('contact') && (
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-sm mb-3 text-primary">聯絡資料更改</h4>
                <div><Label>新電郵</Label><Input value={formData.newEmail} onChange={e => update('newEmail', e.target.value)} className="mt-1" placeholder="new@email.com" /></div>
              </div>
            )}
          </div>

          <div className="mt-4"><Label>生效日期</Label><Input type="date" value={formData.effectiveDate} onChange={e => update('effectiveDate', e.target.value)} className="mt-1" /></div>
        </div>

        {/* Signature & Presentor */}
        <div>
          <h3 className="font-semibold mb-3">簽署及提交人</h3>
          <PresenterSelector companyId={selectedCompanyId}
            currentData={{ name: formData.presentorName, address: formData.presentorAddress, phone: formData.presentorPhone, fax: formData.presentorFax, email: formData.presentorEmail, reference: formData.presentorReference }}
            onSelect={(p: Presenter) => {
              update('presentorName', p.name);
              update('presentorAddress', p.address);
              update('presentorPhone', p.phone);
              update('presentorFax', p.fax);
              update('presentorEmail', p.email);
              update('presentorReference', p.reference);
            }}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>簽署人姓名</Label><Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1" /></div>
            <div><Label>簽署日期</Label><Input type="date" value={formData.signDate} onChange={e => update('signDate', e.target.value)} className="mt-1" /></div>
            <div><Label>提交人名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>提交人地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div><Label>電話 Tel</Label><Input value={formData.presentorPhone} onChange={e => update('presentorPhone', e.target.value)} className="mt-1" /></div>
            <div><Label>傳真 Fax</Label><Input value={formData.presentorFax} onChange={e => update('presentorFax', e.target.value)} className="mt-1" /></div>
            <div><Label>電郵 Email</Label><Input value={formData.presentorEmail} onChange={e => update('presentorEmail', e.target.value)} className="mt-1" /></div>
            <div><Label>參考編號 Ref</Label><Input value={formData.presentorReference} onChange={e => update('presentorReference', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={() => handleGenerate(false)} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 ND2B PDF</>}
          </Button>
          <Button variant="outline" onClick={() => handleGenerate(true)} disabled={generating}>生成測試 PDF（Debug）</Button>
        </div>
      </div>
    </div>
  );
}
