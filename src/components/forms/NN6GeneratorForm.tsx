import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import { ArrowLeft, Download, Loader2, Building2, User2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import PresenterSelector from './PresenterSelector';
import AddressQuickPick from './AddressQuickPick';
import type { Presenter } from '@/hooks/usePresenters';

// ── 香港 18 區（繁體，用於下拉選單） ──
const HK_DISTRICTS = [
  '中西區', '灣仔', '東區', '南區',
  '油尖旺', '深水埗', '九龍城', '黃大仙',
  '觀塘', '葵青', '荃灣', '屯門',
  '元朗', '北區', '大埔', '沙田',
  '西貢', '離島',
];

const HK_REGIONS = ['香港', '九龍', '新界'];

// ── Officer 類型 ──
interface OfficerEntry {
  type: 'appointment' | 'cessation';
  // 身份
  role: 'secretary' | 'director' | 'alternate';
  identity: 'natural' | 'corporate';
  alternateTo: string;          // 代替誰（候補董事時）
  // 姓名
  nameChinese: string;
  nameSurname: string;           // 英文姓氏
  nameOtherNames: string;        // 英文名字
  nameEnglish: string;           // 組合後的全名 (fallback)
  // 前用姓名
  hasFormerName: boolean;
  formerNameChinese: string;
  formerNameEnglish: string;
  // 別名
  hasAlias: boolean;
  aliasChinese: string;
  aliasEnglish: string;
  // 通訊地址
  addrFlatBlock: string;         // 室/樓/座
  addrBuilding: string;          // 大廈
  addrStreetEstate: string;      // 街道/屋苑/地段/村
  addrDistrict: string;          // 區（18區下拉）
  addrRegion: string;            // 國家/地區
  // 聯絡
  email: string;
  // 證件
  idNumber: string;              // 香港身份證
  passportCountry: string;       // 護照簽發國家
  passportNumber: string;        // 護照號碼
  // 日期
  dateAppointed: string;         // 委任日期
  dateCeased: string;            // 停任日期
  // 問題20
  alreadyDirector: 'yes' | 'no' | '';
  // 法人專用
  companyName: string;
  companyNumber: string;
  placeIncorporated: string;
  // 法人簽署
  corpSignerName: string;
  corpSignDate: string;
  // 停任操作
  hasCessation: boolean;
  cessationIdentity: 'natural' | 'corporate';
  cessationRole: 'secretary' | 'director' | 'alternate';
  cessationAlternateTo: string;
  cessationNameChinese: string;
  cessationNameSurname: string;
  cessationNameOtherNames: string;
  cessationNameEnglish: string;
  cessationIdNumber: string;
  cessationPassportNumber: string;
  cessationAlreadyDirector: 'yes' | 'no' | '';
  // 舊地址（兼容）
  address: string;
}

const emptyOfficer = (): OfficerEntry => ({
  type: 'appointment',
  role: 'director',
  identity: 'natural',
  alternateTo: '',
  nameChinese: '',
  nameSurname: '',
  nameOtherNames: '',
  nameEnglish: '',
  hasFormerName: false,
  formerNameChinese: '',
  formerNameEnglish: '',
  hasAlias: false,
  aliasChinese: '',
  aliasEnglish: '',
  addrFlatBlock: '',
  addrBuilding: '',
  addrStreetEstate: '',
  addrDistrict: '',
  addrRegion: '',
  email: '',
  idNumber: '',
  passportCountry: '',
  passportNumber: '',
  dateAppointed: '',
  dateCeased: '',
  alreadyDirector: '',
  companyName: '',
  companyNumber: '',
  placeIncorporated: '',
  corpSignerName: '',
  corpSignDate: '',
  hasCessation: false,
  cessationIdentity: 'natural',
  cessationRole: 'director',
  cessationAlternateTo: '',
  cessationNameChinese: '',
  cessationNameSurname: '',
  cessationNameOtherNames: '',
  cessationNameEnglish: '',
  cessationIdNumber: '',
  cessationPassportNumber: '',
  cessationAlreadyDirector: '',
  address: '',
});

interface NN6GeneratorFormProps {
  onBack: () => void;
  initialCompanyId?: string;
}

export default function NN6GeneratorForm({ onBack, initialCompanyId }: NN6GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [generating, setGenerating] = useState(false);

  // 公司基本資料
  const [brNumber, setBrNumber] = useState('');
  const [companyName, setCompanyName] = useState('');

  // 人員列表
  const [officers, setOfficers] = useState<OfficerEntry[]>([emptyOfficer()]);

  // 提交人
  const [signerName, setSignerName] = useState('');
  const [signDate, setSignDate] = useState('');
  const [presentorName, setPresentorName] = useState('');
  const [presentorAddress, setPresentorAddress] = useState('');
  const [presentorPhone, setPresentorPhone] = useState('');
  const [presentorFax, setPresentorFax] = useState('');
  const [presentorEmail, setPresentorEmail] = useState('');
  const [presentorReference, setPresentorReference] = useState('');

  // ── 選中的公司 ──
  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId),
    [companies, selectedCompanyId],
  );

  // ── 公司內的人員列表 ──
  const companyPeople = useMemo(() => {
    if (!selectedCompany) return [];
    const people: (any & { _label: string })[] = [];
    for (const d of selectedCompany.directors || []) {
      people.push({ ...d, _label: `${d.nameEnglish || d.nameChinese} — 董事 Director` });
    }
    for (const s of selectedCompany.secretaries || []) {
      people.push({ ...s, _label: `${s.nameEnglish || s.nameChinese} — 公司秘書 Secretary` });
    }
    return people;
  }, [selectedCompany]);

  // ── 選公司 ──
  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    setSelectedPersonId('');
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setBrNumber(company.brNumber || '');
      setCompanyName(company.name || '');
      setPresentorName(company.name || '');
      const regAddress = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
        .filter(Boolean).join(', ');
      setPresentorAddress(regAddress);
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  // ── 選人 → 自動填入全部個人資料 ──
  const handlePersonSelect = (personId: string) => {
    setSelectedPersonId(personId);
    const person = companyPeople.find(p => p.id === personId);
    if (!person) return;
    // 更新第一個 officer
    setOfficers(prev => prev.map((o, i) => i === 0 ? {
      ...o,
      role: person.role === 'secretary' ? 'secretary' : 'director',
      identity: person.identity || 'natural',
      nameChinese: person.nameChinese || '',
      nameSurname: person.nameSurname || '',
      nameOtherNames: person.nameOtherNames || '',
      nameEnglish: person.nameEnglish || '',
      idNumber: person.idNumber || '',
      passportNumber: person.passportNumber || '',
      passportCountry: person.passportCountry || '',
      email: person.email || '',
      addrFlatBlock: person.addrFlat || '',
      addrBuilding: person.addrBuilding || '',
      addrStreetEstate: person.addrStreet || '',
      addrDistrict: person.addrDistrict || '',
      addrRegion: person.addrRegion || '',
      address: person.address || '',
    } : o));
  };

  // ── 更新 officer 欄位 ──
  const updateOfficer = (idx: number, field: string, value: any) => {
    setOfficers(prev => prev.map((o, i) => i === idx ? { ...o, [field]: value } : o));
  };

  const addOfficer = () => setOfficers(prev => [...prev, emptyOfficer()]);
  const removeOfficer = (idx: number) => setOfficers(prev => prev.filter((_, i) => i !== idx));

  // ── 載入歷史 ──
  const handleLoadHistory = (data: any) => {
    if (data.brNumber) setBrNumber(data.brNumber);
    if (data.companyName) setCompanyName(data.companyName);
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
    if (data.selectedPersonId) setSelectedPersonId(data.selectedPersonId);
    if (data.officers) {
      const loaded = data.officers.map((o: any) => ({
        ...emptyOfficer(),
        ...o,
        hasFormerName: o.hasFormerName ?? !!(o.formerNameChinese || o.formerNameEnglish),
        hasAlias: o.hasAlias ?? !!(o.aliasChinese || o.aliasEnglish),
        addrRegion: o.addrRegion || '',
        nameSurname: o.nameSurname || '',
        nameOtherNames: o.nameOtherNames || '',
        alternateTo: o.alternateTo || '',
        passportCountry: o.passportCountry || '',
        email: o.email || '',
        alreadyDirector: o.alreadyDirector || '',
        hasCessation: o.hasCessation ?? false,
        cessationIdentity: o.cessationIdentity || 'natural',
        cessationRole: o.cessationRole || 'director',
        cessationAlternateTo: o.cessationAlternateTo || '',
        cessationNameChinese: o.cessationNameChinese || '',
        cessationNameSurname: o.cessationNameSurname || '',
        cessationNameOtherNames: o.cessationNameOtherNames || '',
        cessationNameEnglish: o.cessationNameEnglish || '',
        cessationIdNumber: o.cessationIdNumber || '',
        cessationPassportNumber: o.cessationPassportNumber || '',
        cessationAlreadyDirector: o.cessationAlreadyDirector || '',
        // backward compat: split old nameEnglish
        nameEnglish: o.nameEnglish || '',
      }));
      // Re-split nameEnglish if no surname/otherNames
      for (const o of loaded) {
        if (!o.nameSurname && !o.nameOtherNames && o.nameEnglish) {
          const parts = o.nameEnglish.trim().split(/\s+/);
          o.nameSurname = parts[0] || '';
          o.nameOtherNames = parts.slice(1).join(' ');
        }
        // backward compat: old single address → addrFlatBlock
        if (!o.addrFlatBlock && !o.addrBuilding && !o.addrStreetEstate && o.address) {
          o.addrFlatBlock = o.address;
        }
      }
      setOfficers(loaded);
    }
    if (data.signerName !== undefined) setSignerName(data.signerName);
    if (data.signDate !== undefined) setSignDate(data.signDate);
    if (data.presentorName !== undefined) setPresentorName(data.presentorName);
    if (data.presentorAddress !== undefined) setPresentorAddress(data.presentorAddress);
    if (data.presentorPhone !== undefined) setPresentorPhone(data.presentorPhone);
    if (data.presentorFax !== undefined) setPresentorFax(data.presentorFax);
    if (data.presentorEmail !== undefined) setPresentorEmail(data.presentorEmail);
    if (data.presentorReference !== undefined) setPresentorReference(data.presentorReference);
    // backward compat
    if (data.presentorContact !== undefined && !data.presentorPhone && !data.presentorEmail) {
      setPresentorPhone(data.presentorContact);
    }
  };

  // ── 生成 PDF ──
  const handleGenerate = async () => {
    if (!brNumber || !companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem('secretary_jwt') || '';

      // 構建委任英文全名（後端兼容用）
      const processedOfficers = officers.map(o => ({
        ...o,
        nameEnglish: o.nameEnglish || [o.nameSurname, o.nameOtherNames].filter(Boolean).join(' '),
        // Cessation 不需委任細節，但保留以備後端
        // 法人: companyName = nameEnglish
        companyName: o.identity === 'corporate' ? (o.companyName || o.nameEnglish) : o.companyName,
      }));

      const resp = await fetch(`/api/generate-nn6-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          brNumber,
          companyName,
          officers: processedOfficers,
          signerName,
          signDate,
          presentorName,
          presentorAddress,
          presentorPhone,
          presentorFax,
          presentorEmail,
          presentorReference,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || result.warnings?.join?.(', ') || '生成失敗');

      downloadBase64Pdf(result.pdf, `NN6_${brNumber}_${companyName.replace(/\s+/g, '_')}.pdf`);

      const formData = {
        brNumber, companyName, selectedCompanyId, selectedPersonId,
        officers, signerName, signDate,
        presentorName, presentorAddress,
        presentorPhone, presentorFax, presentorEmail, presentorReference,
      };
      saveFormHistory(
        { formType: 'NN6', formData },
        {
          onError: (err: any) => toast({ title: '儲存歷史失敗', description: err.message, variant: 'destructive' }),
        },
      );
      toast({ title: '生成成功', description: 'NN6 表格已下載' });
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
          <h1 className="text-2xl font-bold">NN6 — 註冊非香港公司更改公司秘書及董事申報表 (委任╱停任)</h1>
          <p className="text-sm text-muted-foreground">Return of Change of Company Secretary and Director of Registered Non-Hong Kong Company (Appointment╱Cessation)</p>
        </div>
      </div>

      <FormHistorySelector formType="NN6" onSelect={handleLoadHistory} />

      {/* ── 公司選擇器 ── */}
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

      {/* ── 人員選擇器 ── */}
      {selectedCompany && companyPeople.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <User2 className="h-4 w-4 text-primary" />
            <Label className="font-medium">選擇公司人員自動填入（選填）</Label>
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

      {/* ── 主表單 ── */}
      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* 公司資料 */}
        <div>
          <h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={brNumber} onChange={e => setBrNumber(e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={companyName} onChange={e => setCompanyName(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── 人員列表 ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">董事/秘書委任或停任</h3>
            <Button variant="outline" size="sm" onClick={addOfficer}><Plus className="h-4 w-4 mr-1" />新增人員</Button>
          </div>

          {officers.map((officer, idx) => (
            <div key={idx} className="border border-border rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">
                  人員 #{idx + 1}
                  {idx === 0 && officer.type === 'cessation' ? ' — 停任 (P.1)' : ''}
                  {officer.type === 'appointment' ? ` — 委任 (P.${idx > 0 ? (idx * 2) + 2 : 2}+)` : ''}
                </span>
                {officers.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeOfficer(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                )}
              </div>

              {/* 基本選項 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                <div>
                  <Label>變更類型</Label>
                  <Select value={officer.type} onValueChange={v => updateOfficer(idx, 'type', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="appointment">委任 Appointment</SelectItem>
                      <SelectItem value="cessation">停任 Cessation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>身分</Label>
                  <Select value={officer.identity} onValueChange={v => updateOfficer(idx, 'identity', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="natural">自然人 Natural Person</SelectItem>
                      <SelectItem value="corporate">法人團體 Body Corporate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{officer.type === 'appointment' ? '委任日期' : '停任日期'}</Label>
                  <Input
                    type="date"
                    value={officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased}
                    onChange={e => updateOfficer(idx, officer.type === 'appointment' ? 'dateAppointed' : 'dateCeased', e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>

              {/* ══════ 停任 (P.1) ══════ */}
              {officer.type === 'cessation' && (
                <>
                  {/* 身份勾選（停任也需要） */}
                  <div className="mb-4">
                    <Label className="mb-2 block">停任身分</Label>
                    <div className="flex gap-4 flex-wrap">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`cessation-role-${idx}`}
                          checked={officer.role === 'secretary'}
                          onChange={() => { updateOfficer(idx, 'role', 'secretary'); updateOfficer(idx, 'alternateTo', ''); }}
                        />
                        <span>公司秘書 Secretary</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`cessation-role-${idx}`}
                          checked={officer.role === 'director'}
                          onChange={() => { updateOfficer(idx, 'role', 'director'); updateOfficer(idx, 'alternateTo', ''); }}
                        />
                        <span>董事 Director</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`cessation-role-${idx}`}
                          checked={officer.role === 'alternate'}
                          onChange={() => updateOfficer(idx, 'role', 'alternate')}
                        />
                        <span>候補董事 Alternate Director</span>
                      </label>
                    </div>
                  </div>
                  {officer.identity === 'natural' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label>中文姓名</Label>
                        <Input value={officer.nameChinese} onChange={e => updateOfficer(idx, 'nameChinese', e.target.value)} className="mt-1" />
                      </div>
                      <div>{/* placeholder */}</div>
                      <div>
                        <Label>英文姓氏 Surname</Label>
                        <Input value={officer.nameSurname} onChange={e => updateOfficer(idx, 'nameSurname', e.target.value)} className="mt-1" placeholder="CHAN" />
                      </div>
                      <div>
                        <Label>英文名字 Other Names</Label>
                        <Input value={officer.nameOtherNames} onChange={e => updateOfficer(idx, 'nameOtherNames', e.target.value)} className="mt-1" placeholder="Tai Man" />
                      </div>
                      <div>
                        <Label>香港身份證號碼</Label>
                        <Input value={officer.idNumber} onChange={e => updateOfficer(idx, 'idNumber', e.target.value)} className="mt-1" placeholder="A123456" />
                      </div>
                      <div>
                        <Label>護照號碼</Label>
                        <Input value={officer.passportNumber} onChange={e => updateOfficer(idx, 'passportNumber', e.target.value)} className="mt-1" />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label>中文名稱</Label>
                        <Input value={officer.nameChinese} onChange={e => updateOfficer(idx, 'nameChinese', e.target.value)} className="mt-1" />
                      </div>
                      <div>
                        <Label>英文名稱</Label>
                        <Input value={officer.companyName || officer.nameEnglish} onChange={e => updateOfficer(idx, 'companyName', e.target.value)} className="mt-1" />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ══════ 委任 (P.2+) ══════ */}
              {officer.type === 'appointment' && (
                <>
                  {officer.identity === 'natural' ? (
                    <div className="space-y-4">
                      {/* 身份勾選 */}
                      <div>
                        <Label className="mb-2 block">委任身分</Label>
                        <div className="flex gap-4 flex-wrap">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`role-${idx}`}
                              checked={officer.role === 'secretary'}
                              onChange={() => { updateOfficer(idx, 'role', 'secretary'); updateOfficer(idx, 'alternateTo', ''); }}
                            />
                            <span>公司秘書 Secretary</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`role-${idx}`}
                              checked={officer.role === 'director'}
                              onChange={() => { updateOfficer(idx, 'role', 'director'); updateOfficer(idx, 'alternateTo', ''); }}
                            />
                            <span>董事 Director</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`role-${idx}`}
                              checked={officer.role === 'alternate'}
                              onChange={() => updateOfficer(idx, 'role', 'alternate')}
                            />
                            <span>候補董事 Alternate Director</span>
                          </label>
                        </div>
                      </div>

                      {/* 代替誰（候補董事時顯示）*/}
                      {officer.role === 'alternate' && (
                        <div>
                          <Label>代替 Alternate to</Label>
                          <Input
                            value={officer.alternateTo}
                            onChange={e => updateOfficer(idx, 'alternateTo', e.target.value)}
                            className="mt-1" placeholder="被代替的董事姓名"
                          />
                        </div>
                      )}

                      {/* 姓名 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                          <Label>中文姓名</Label>
                          <Input value={officer.nameChinese} onChange={e => updateOfficer(idx, 'nameChinese', e.target.value)} className="mt-1" />
                        </div>
                        <div>
                          <Label>英文姓氏 Surname</Label>
                          <Input value={officer.nameSurname} onChange={e => updateOfficer(idx, 'nameSurname', e.target.value)} className="mt-1" placeholder="CHAN" />
                        </div>
                        <div>
                          <Label>英文名字 Other Names</Label>
                          <Input value={officer.nameOtherNames} onChange={e => updateOfficer(idx, 'nameOtherNames', e.target.value)} className="mt-1" placeholder="Tai Man" />
                        </div>
                      </div>

                      {/* 前用姓名 */}
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer mb-2">
                          <input
                            type="checkbox"
                            checked={officer.hasFormerName}
                            onChange={e => updateOfficer(idx, 'hasFormerName', e.target.checked)}
                          />
                          <Label className="cursor-pointer">有前用姓名 Previous Names</Label>
                        </label>
                        {officer.hasFormerName && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ml-6 pl-4 border-l-2 border-border">
                            <div>
                              <Label className="text-xs text-muted-foreground">前用姓名 中文</Label>
                              <Input value={officer.formerNameChinese} onChange={e => updateOfficer(idx, 'formerNameChinese', e.target.value)} className="mt-1" />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">前用姓名 英文</Label>
                              <Input value={officer.formerNameEnglish} onChange={e => updateOfficer(idx, 'formerNameEnglish', e.target.value)} className="mt-1" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 別名 */}
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer mb-2">
                          <input
                            type="checkbox"
                            checked={officer.hasAlias}
                            onChange={e => updateOfficer(idx, 'hasAlias', e.target.checked)}
                          />
                          <Label className="cursor-pointer">有別名 Alias</Label>
                        </label>
                        {officer.hasAlias && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ml-6 pl-4 border-l-2 border-border">
                            <div>
                              <Label className="text-xs text-muted-foreground">別名 中文</Label>
                              <Input value={officer.aliasChinese} onChange={e => updateOfficer(idx, 'aliasChinese', e.target.value)} className="mt-1" />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">別名 英文</Label>
                              <Input value={officer.aliasEnglish} onChange={e => updateOfficer(idx, 'aliasEnglish', e.target.value)} className="mt-1" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 通訊地址 */}
                      <div>
                        <Label className="font-medium mb-2 block">通訊地址 Correspondence Address</Label>
                        {selectedCompanyId && (
                          <div className="mb-3">
                            <AddressQuickPick companyId={selectedCompanyId}
                              onPick={(d) => {
                                updateOfficer(idx, 'addrFlatBlock', d.flat || '');
                                updateOfficer(idx, 'addrBuilding', d.building || '');
                                updateOfficer(idx, 'addrStreetEstate', d.street || '');
                                updateOfficer(idx, 'addrDistrict', d.district || '');
                                updateOfficer(idx, 'addrRegion', d.country || d.region || '');
                              }}
                            />
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">室／樓／座 Flat／Floor／Block</Label>
                            <Input value={officer.addrFlatBlock} onChange={e => updateOfficer(idx, 'addrFlatBlock', e.target.value)} className="mt-1" placeholder="Flat / Floor / Block" />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">大廈 Building</Label>
                            <Input value={officer.addrBuilding} onChange={e => updateOfficer(idx, 'addrBuilding', e.target.value)} className="mt-1" placeholder="Building" />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs text-muted-foreground">街道／屋苑／地段／村 Street／Estate／Lot／Village</Label>
                            <Input value={officer.addrStreetEstate} onChange={e => updateOfficer(idx, 'addrStreetEstate', e.target.value)} className="mt-1" placeholder="Street / Estate / Lot / Village" />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">區 District</Label>
                            <Select value={officer.addrDistrict} onValueChange={v => updateOfficer(idx, 'addrDistrict', v)}>
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
                            <Input value={officer.addrRegion} onChange={e => updateOfficer(idx, 'addrRegion', e.target.value)} className="mt-1" placeholder="e.g. 香港" />
                          </div>
                        </div>
                      </div>

                      {/* 電郵 */}
                      <div>
                        <Label>電郵地址 Email Address</Label>
                        <Input value={officer.email} onChange={e => updateOfficer(idx, 'email', e.target.value)} className="mt-1" type="email" placeholder="email@example.com" />
                      </div>

                      {/* 證件 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                          <Label>香港身份證 HKID</Label>
                          <Input value={officer.idNumber} onChange={e => updateOfficer(idx, 'idNumber', e.target.value)} className="mt-1" placeholder="A123456" />
                        </div>
                        <div>
                          <Label>護照簽發國家 Passport Issuing Country</Label>
                          <Input value={officer.passportCountry} onChange={e => updateOfficer(idx, 'passportCountry', e.target.value)} className="mt-1" placeholder="e.g. China / UK" />
                        </div>
                        <div>
                          <Label>護照號碼 Passport Number</Label>
                          <Input value={officer.passportNumber} onChange={e => updateOfficer(idx, 'passportNumber', e.target.value)} className="mt-1" />
                        </div>
                      </div>

                      {/* 問題20 */}
                      <div>
                        <Label className="mb-2 block">
                          上述董事或候補董事在獲得這次委任時，是否已經是這公司的現任候補董事或董事？
                          <br />
                          <span className="text-xs text-muted-foreground">
                            Is this director or alternate director already an existing alternate director or director in this company at the time of this appointment?
                          </span>
                        </Label>
                        <div className="flex gap-6">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`alreadyDirector-${idx}`}
                              checked={officer.alreadyDirector === 'yes'}
                              onChange={() => updateOfficer(idx, 'alreadyDirector', 'yes')}
                            />
                            <span>是 Yes</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`alreadyDirector-${idx}`}
                              checked={officer.alreadyDirector === 'no'}
                              onChange={() => updateOfficer(idx, 'alreadyDirector', 'no')}
                            />
                            <span>否 No</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* 法人委任 (P.3) */
                    <div className="space-y-4">
                      {/* 身份勾選 */}
                      <div>
                        <Label className="mb-2 block">委任身分</Label>
                        <div className="flex gap-4 flex-wrap">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`corp-role-${idx}`}
                              checked={officer.role === 'secretary'}
                              onChange={() => { updateOfficer(idx, 'role', 'secretary'); updateOfficer(idx, 'alternateTo', ''); }}
                            />
                            <span>公司秘書 Secretary</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`corp-role-${idx}`}
                              checked={officer.role === 'director'}
                              onChange={() => { updateOfficer(idx, 'role', 'director'); updateOfficer(idx, 'alternateTo', ''); }}
                            />
                            <span>董事 Director</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`corp-role-${idx}`}
                              checked={officer.role === 'alternate'}
                              onChange={() => updateOfficer(idx, 'role', 'alternate')}
                            />
                            <span>候補董事 Alternate Director</span>
                          </label>
                        </div>
                      </div>

                      {/* 代替誰（候補董事時顯示）*/}
                      {officer.role === 'alternate' && (
                        <div>
                          <Label>代替 Alternate to</Label>
                          <Input
                            value={officer.alternateTo}
                            onChange={e => updateOfficer(idx, 'alternateTo', e.target.value)}
                            className="mt-1" placeholder="被代替的董事姓名"
                          />
                        </div>
                      )}

                      {/* 法人名稱 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label>中文名稱</Label>
                          <Input value={officer.nameChinese} onChange={e => updateOfficer(idx, 'nameChinese', e.target.value)} className="mt-1" />
                        </div>
                        <div>
                          <Label>英文名稱</Label>
                          <Input value={officer.companyName || officer.nameEnglish} onChange={e => updateOfficer(idx, 'companyName', e.target.value)} className="mt-1" />
                        </div>
                      </div>

                      {/* 通訊地址 */}
                      <div>
                        <Label className="font-medium mb-2 block">通訊地址 Correspondence Address</Label>
                        {selectedCompanyId && (
                          <div className="mb-3">
                            <AddressQuickPick companyId={selectedCompanyId}
                              onPick={(d) => {
                                updateOfficer(idx, 'addrFlatBlock', d.flat || '');
                                updateOfficer(idx, 'addrBuilding', d.building || '');
                                updateOfficer(idx, 'addrStreetEstate', d.street || '');
                                updateOfficer(idx, 'addrDistrict', d.district || '');
                                updateOfficer(idx, 'addrRegion', d.country || d.region || '');
                              }}
                            />
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">室／樓／座 Flat／Floor／Block</Label>
                            <Input value={officer.addrFlatBlock} onChange={e => updateOfficer(idx, 'addrFlatBlock', e.target.value)} className="mt-1" placeholder="Flat / Floor / Block" />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">大廈 Building</Label>
                            <Input value={officer.addrBuilding} onChange={e => updateOfficer(idx, 'addrBuilding', e.target.value)} className="mt-1" placeholder="Building" />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs text-muted-foreground">街道／屋苑／地段／村 Street／Estate／Lot／Village</Label>
                            <Input value={officer.addrStreetEstate} onChange={e => updateOfficer(idx, 'addrStreetEstate', e.target.value)} className="mt-1" placeholder="Street / Estate / Lot / Village" />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">區 District</Label>
                            <Select value={officer.addrDistrict} onValueChange={v => updateOfficer(idx, 'addrDistrict', v)}>
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
                            <Input value={officer.addrRegion} onChange={e => updateOfficer(idx, 'addrRegion', e.target.value)} className="mt-1" placeholder="e.g. 香港" />
                          </div>
                        </div>
                      </div>

                      {/* 電郵 */}
                      <div>
                        <Label>電郵地址 Email Address</Label>
                        <Input value={officer.email} onChange={e => updateOfficer(idx, 'email', e.target.value)} className="mt-1" type="email" placeholder="email@example.com" />
                      </div>

                      {/* 商業登記號碼 */}
                      <div>
                        <Label>商業登記號碼 Business Registration Number</Label>
                        <Input value={officer.companyNumber} onChange={e => updateOfficer(idx, 'companyNumber', e.target.value)} className="mt-1" placeholder="e.g. 12345678" />
                      </div>

                      {/* 委任日期 */}
                      <div>
                        <Label>委任日期 Date of Appointment</Label>
                        <Input
                          type="date"
                          value={officer.dateAppointed}
                          onChange={e => updateOfficer(idx, 'dateAppointed', e.target.value)}
                          className="mt-1"
                        />
                      </div>

                      {/* 是否現任董事 */}
                      <div>
                        <Label className="mb-2 block">
                          上述董事或候補董事在獲得這次委任時，是否已經是這公司的現任候補董事或董事？
                          <br />
                          <span className="text-xs text-muted-foreground">
                            Is this director or alternate director already an existing alternate director or director in this company at the time of this appointment?
                          </span>
                        </Label>
                        <div className="flex gap-6">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`corp-alreadyDirector-${idx}`}
                              checked={officer.alreadyDirector === 'yes'}
                              onChange={() => updateOfficer(idx, 'alreadyDirector', 'yes')}
                            />
                            <span>是 Yes</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`corp-alreadyDirector-${idx}`}
                              checked={officer.alreadyDirector === 'no'}
                              onChange={() => updateOfficer(idx, 'alreadyDirector', 'no')}
                            />
                            <span>否 No</span>
                          </label>
                        </div>
                      </div>

                      {/* 法人簽署 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label>簽署人姓名 Signer Name</Label>
                          <Input value={officer.corpSignerName} onChange={e => updateOfficer(idx, 'corpSignerName', e.target.value)} className="mt-1" placeholder="簽署人姓名" />
                        </div>
                        <div>
                          <Label>簽署日期 Sign Date</Label>
                          <Input
                            type="date"
                            value={officer.corpSignDate}
                            onChange={e => updateOfficer(idx, 'corpSignDate', e.target.value)}
                            className="mt-1"
                          />
                        </div>
                      </div>

                      {/* 是否含有停任操作 */}
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={officer.hasCessation}
                            onChange={e => updateOfficer(idx, 'hasCessation', e.target.checked)}
                          />
                          <Label className="cursor-pointer">是否含有停任操作 Cessation</Label>
                        </label>
                        {officer.hasCessation && (
                          <div className="mt-3 ml-6 pl-4 border-l-2 border-border space-y-4">
                            {/* 停任身分 */}
                            <div>
                              <Label className="mb-2 block">停任身分 Cessation Role</Label>
                              <div className="flex gap-4 flex-wrap">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`cessation-role-${idx}`}
                                    checked={officer.cessationRole === 'secretary'}
                                    onChange={() => { updateOfficer(idx, 'cessationRole', 'secretary'); updateOfficer(idx, 'cessationAlternateTo', ''); }}
                                  />
                                  <span>公司秘書 Secretary</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`cessation-role-${idx}`}
                                    checked={officer.cessationRole === 'director'}
                                    onChange={() => { updateOfficer(idx, 'cessationRole', 'director'); updateOfficer(idx, 'cessationAlternateTo', ''); }}
                                  />
                                  <span>董事 Director</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`cessation-role-${idx}`}
                                    checked={officer.cessationRole === 'alternate'}
                                    onChange={() => updateOfficer(idx, 'cessationRole', 'alternate')}
                                  />
                                  <span>候補董事 Alternate Director</span>
                                </label>
                              </div>
                            </div>

                            {/* 代替誰（候補董事時顯示）*/}
                            {officer.cessationRole === 'alternate' && (
                              <div>
                                <Label>代替 Alternate to</Label>
                                <Input
                                  value={officer.cessationAlternateTo}
                                  onChange={e => updateOfficer(idx, 'cessationAlternateTo', e.target.value)}
                                  className="mt-1" placeholder="被代替的董事姓名"
                                />
                              </div>
                            )}

                            {/* 停任身份：自然人 vs 法人 */}
                            <div>
                              <Label className="mb-2 block">停任人身分 Identity</Label>
                              <div className="flex gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`cessation-identity-${idx}`}
                                    checked={officer.cessationIdentity === 'natural'}
                                    onChange={() => updateOfficer(idx, 'cessationIdentity', 'natural')}
                                  />
                                  <span>自然人 Natural Person</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`cessation-identity-${idx}`}
                                    checked={officer.cessationIdentity === 'corporate'}
                                    onChange={() => updateOfficer(idx, 'cessationIdentity', 'corporate')}
                                  />
                                  <span>法人團體 Body Corporate</span>
                                </label>
                              </div>
                            </div>

                            {/* 選擇公司人員自動填入停任資料 */}
                            {selectedCompany && companyPeople.length > 0 && (
                              <div>
                                <Label className="text-xs text-muted-foreground">選擇公司人員自動填入</Label>
                                <Select
                                  value=""
                                  onValueChange={(personId) => {
                                    const person = companyPeople.find(p => p.id === personId);
                                    if (!person) return;
                                    const isPersonCorp = person.identity === 'corporate';
                                    updateOfficer(idx, 'cessationIdentity', isPersonCorp ? 'corporate' : 'natural');
                                    if (isPersonCorp) {
                                      updateOfficer(idx, 'cessationNameChinese', person.nameChinese || '');
                                      updateOfficer(idx, 'cessationNameEnglish', person.nameEnglish || '');
                                    } else {
                                      updateOfficer(idx, 'cessationNameChinese', person.nameChinese || '');
                                      updateOfficer(idx, 'cessationNameSurname', person.nameSurname || '');
                                      updateOfficer(idx, 'cessationNameOtherNames', person.nameOtherNames || '');
                                      updateOfficer(idx, 'cessationNameEnglish', person.nameEnglish || '');
                                      updateOfficer(idx, 'cessationIdNumber', person.idNumber || '');
                                      updateOfficer(idx, 'cessationPassportNumber', person.passportNumber || '');
                                    }
                                  }}
                                >
                                  <SelectTrigger className="mt-1"><SelectValue placeholder="選擇人員..." /></SelectTrigger>
                                  <SelectContent>
                                    {companyPeople
                                      .filter(p => (p.identity || 'natural') === officer.cessationIdentity)
                                      .map(p => (
                                        <SelectItem key={p.id} value={p.id}>{p._label}</SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            {/* 自然人停任字段 */}
                            {officer.cessationIdentity === 'natural' ? (
                              <div className="space-y-3">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                  <div>
                                    <Label>中文姓名</Label>
                                    <Input value={officer.cessationNameChinese} onChange={e => updateOfficer(idx, 'cessationNameChinese', e.target.value)} className="mt-1" />
                                  </div>
                                  <div>
                                    <Label>英文姓氏 Surname</Label>
                                    <Input value={officer.cessationNameSurname} onChange={e => updateOfficer(idx, 'cessationNameSurname', e.target.value)} className="mt-1" placeholder="CHAN" />
                                  </div>
                                  <div>
                                    <Label>英文名字 Other Names</Label>
                                    <Input value={officer.cessationNameOtherNames} onChange={e => updateOfficer(idx, 'cessationNameOtherNames', e.target.value)} className="mt-1" placeholder="Tai Man" />
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <div>
                                    <Label>香港身份證號碼 HKID</Label>
                                    <Input value={officer.cessationIdNumber} onChange={e => updateOfficer(idx, 'cessationIdNumber', e.target.value)} className="mt-1" placeholder="A123456" />
                                  </div>
                                  <div>
                                    <Label>護照號碼 Passport Number</Label>
                                    <Input value={officer.cessationPassportNumber} onChange={e => updateOfficer(idx, 'cessationPassportNumber', e.target.value)} className="mt-1" />
                                  </div>
                                </div>
                              </div>
                            ) : (
                              /* 法人停任字段 */
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                  <Label>中文名稱</Label>
                                  <Input value={officer.cessationNameChinese} onChange={e => updateOfficer(idx, 'cessationNameChinese', e.target.value)} className="mt-1" />
                                </div>
                                <div>
                                  <Label>英文名稱</Label>
                                  <Input value={officer.cessationNameEnglish} onChange={e => updateOfficer(idx, 'cessationNameEnglish', e.target.value)} className="mt-1" />
                                </div>
                              </div>
                            )}

                            {/* 停任日期 */}
                            <div>
                              <Label>停任日期 Date of Cessation</Label>
                              <Input
                                type="date"
                                value={officer.dateCeased}
                                onChange={e => updateOfficer(idx, 'dateCeased', e.target.value)}
                                className="mt-1"
                              />
                            </div>

                            {/* 是否現任董事 */}
                            <div>
                              <Label className="mb-2 block">
                                上述董事或候補董事在停任日期後，是否仍然擔任這公司的候補董事或董事職位？
                                <br />
                                <span className="text-xs text-muted-foreground">
                                  Is this director or alternate director still an existing alternate director or director in this company after the cessation date?
                                </span>
                              </Label>
                              <div className="flex gap-6">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`cessation-alreadyDirector-${idx}`}
                                    checked={officer.cessationAlreadyDirector === 'yes'}
                                    onChange={() => updateOfficer(idx, 'cessationAlreadyDirector', 'yes')}
                                  />
                                  <span>是 Yes</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`cessation-alreadyDirector-${idx}`}
                                    checked={officer.cessationAlreadyDirector === 'no'}
                                    onChange={() => updateOfficer(idx, 'cessationAlreadyDirector', 'no')}
                                  />
                                  <span>否 No</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {/* ── 簽署及提交人 ── */}
        <div>
          <h3 className="font-semibold mb-3">簽署及提交人</h3>
          <PresenterSelector companyId={selectedCompanyId}
            currentData={{ name: presentorName, address: presentorAddress, phone: presentorPhone, fax: presentorFax, email: presentorEmail, reference: presentorReference }}
            onSelect={(p: Presenter) => {
              setPresentorName(p.name);
              setPresentorAddress(p.address);
              setPresentorPhone(p.phone);
              setPresentorFax(p.fax);
              setPresentorEmail(p.email);
              setPresentorReference(p.reference);
            }}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>簽署人姓名</Label><Input value={signerName} onChange={e => setSignerName(e.target.value)} className="mt-1" /></div>
            <div><Label>簽署日期</Label><Input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人名稱</Label><Input value={presentorName} onChange={e => setPresentorName(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人地址</Label><Input value={presentorAddress} onChange={e => setPresentorAddress(e.target.value)} className="mt-1" /></div>
            <div><Label>電話 Tel</Label><Input value={presentorPhone} onChange={e => setPresentorPhone(e.target.value)} className="mt-1" /></div>
            <div><Label>傳真 Fax</Label><Input value={presentorFax} onChange={e => setPresentorFax(e.target.value)} className="mt-1" /></div>
            <div><Label>電郵 Email</Label><Input value={presentorEmail} onChange={e => setPresentorEmail(e.target.value)} className="mt-1" /></div>
            <div><Label>參考編號 Ref</Label><Input value={presentorReference} onChange={e => setPresentorReference(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── 生成按鈕 ── */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN6 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
