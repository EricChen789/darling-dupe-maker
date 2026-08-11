import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import type { Presenter } from '@/hooks/usePresenters';
import PersonQuickPick from './PersonQuickPick';
import AddressQuickPick from './AddressQuickPick';
import { ArrowLeft, Download, Loader2, Building2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import RelatedFormsPrompt from './RelatedFormsPrompt';

interface OfficerEntry {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director' | 'alternate';
  alternateTo: string;
  alreadyDirector: 'yes' | 'no' | '';
  identity: 'natural' | 'corporate';
  nameChinese: string;
  nameSurname: string;
  nameOtherNames: string;
  nameEnglish: string;  // 保留向后兼容
  formerNameChinese: string;
  formerNameEnglish: string;
  idNumber: string;
  passportCountry: string;
  passportNumber: string;
  address: string;
  addrFlatBlock: string;
  addrBuilding: string;
  addrStreetEstate: string;
  addrDistrict: string;
  addrRegion: string;
  dateAppointed: string;
  dateCeased: string;
  companyName: string;
  companyNumber: string;
  placeIncorporated: string;
}

const emptyOfficer = (): OfficerEntry => ({
  type: 'appointment',
  role: 'director',
  alternateTo: '',
  alreadyDirector: '',
  identity: 'natural',
  nameChinese: '',
  nameSurname: '',
  nameOtherNames: '',
  nameEnglish: '',
  formerNameChinese: '',
  formerNameEnglish: '',
  idNumber: '',
  passportCountry: '',
  passportNumber: '',
  address: '',
  addrFlatBlock: '',
  addrBuilding: '',
  addrStreetEstate: '',
  addrDistrict: '',
  addrRegion: '',
  dateAppointed: '',
  dateCeased: '',
  companyName: '',
  companyNumber: '',
  placeIncorporated: '',
});

interface ND2AGeneratorFormProps {
  onBack: () => void;
  initialCompanyId?: string;
}

export default function ND2AGeneratorForm({ onBack, initialCompanyId }: ND2AGeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const { mutate: saveFormHistory } = useSaveFormHistory();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [brNumber, setBrNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [officers, setOfficers] = useState<OfficerEntry[]>([emptyOfficer()]);
  const [signerId, setSignerId] = useState('');  // '' = 自动（首个秘书→首个董事）, officer id, '__manual__' = 手动输入
  const [signerName, setSignerName] = useState('');
  const [signDate, setSignDate] = useState('');
  const [presentorName, setPresentorName] = useState('');
  const [presentorAddress, setPresentorAddress] = useState('');
  const [presentorPhone, setPresentorPhone] = useState('');
  const [presentorFax, setPresentorFax] = useState('');
  const [presentorEmail, setPresentorEmail] = useState('');
  const [presentorReference, setPresentorReference] = useState('');
  // Phase 5: Related forms prompt (ND2A→ND4 conditional linkage)
  const [showRelatedPrompt, setShowRelatedPrompt] = useState(false);
  const [relatedLinkages, setRelatedLinkages] = useState<any[]>([]);

  // 所选公司的人员（用于签署人下拉）
  const selectedCompany = companies.find(c => c.id === selectedCompanyId);
  const companyOfficers = selectedCompany
    ? [...selectedCompany.directors.map(d => ({ ...d, _role: 'director' as const })),
       ...selectedCompany.secretaries.map(s => ({ ...s, _role: 'secretary' as const }))]
    : [];

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setBrNumber(company.brNumber);
      setCompanyName(company.name);
      setPresentorName(company.name);
      // Auto-fill presentor address from company registered address
      const regAddress = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
        .filter(Boolean).join(', ');
      setPresentorAddress(regAddress);
      // 签署人自动选首个秘书/董事
      setSignerId('');
      const autoSigner = company.secretaries[0] || company.directors[0];
      setSignerName(autoSigner ? (autoSigner.nameEnglish || autoSigner.nameChinese || '') : '');
    }
  };

  // 從「公司詳情 → 文件生成」進入時，自動預選當前公司
  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) {
      handleCompanySelect(initialCompanyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  const handleLoadHistory = (data: any) => {
    if (data.brNumber) setBrNumber(data.brNumber);
    if (data.companyName) setCompanyName(data.companyName);
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
    // Restore passport fields for each officer (they may not exist in older history)
    if (data.officers) {
      const restored = data.officers.map((o: any) => ({
        ...emptyOfficer(),
        ...o,
        passportCountry: o.passportCountry || '',
        passportNumber: o.passportNumber || '',
      }));
      setOfficers(restored);
    }
    if (data.signerName !== undefined) setSignerName(data.signerName);
    if (data.signerId !== undefined) setSignerId(data.signerId);
    if (data.signDate !== undefined) setSignDate(data.signDate);
    if (data.presentorName !== undefined) setPresentorName(data.presentorName);
    if (data.presentorAddress !== undefined) setPresentorAddress(data.presentorAddress);
    if (data.presentorPhone !== undefined) setPresentorPhone(data.presentorPhone);
    if (data.presentorFax !== undefined) setPresentorFax(data.presentorFax);
    if (data.presentorEmail !== undefined) setPresentorEmail(data.presentorEmail);
    if (data.presentorReference !== undefined) setPresentorReference(data.presentorReference);
  };

  const updateOfficer = (idx: number, field: string, value: string) => {
    setOfficers(prev => prev.map((o, i) => i === idx ? { ...o, [field]: value } : o));
  };

  const addOfficer = () => setOfficers(prev => [...prev, emptyOfficer()]);
  const removeOfficer = (idx: number) => setOfficers(prev => prev.filter((_, i) => i !== idx));

  const handleGenerate = async (debug = false) => {
    if (!brNumber || !companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const resp = await fetch(`/api/generate-nd2a-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brNumber, companyName, officers, signerName, signDate, presentorName, presentorAddress, presentorPhone, presentorFax, presentorEmail, presentorReference, debug }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      downloadBase64Pdf(result.pdf, `ND2A_${brNumber}_${companyName.replace(/\s+/g, '_')}.pdf`);
      saveFormHistory({ formType: 'ND2A', formData: { brNumber, companyName, selectedCompanyId, officers, signerId, signerName, signDate, presentorName, presentorAddress, presentorPhone, presentorFax, presentorEmail, presentorReference } });
      toast({ title: '生成成功', description: 'ND2A 表格已下載' });

      // Phase 5: Check for related forms (ND2A→ND4 conditional: only if cessation exists)
      const hasCessation = officers.some(o => o.type === 'cessation');
      if (hasCessation) {
        try {
          const linkResp = await fetch(`/api/form-linkages?primary=ND2A`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const linkData = await linkResp.json();
          if (linkData.linkages && linkData.linkages.length > 0) {
            setRelatedLinkages(linkData.linkages);
            setShowRelatedPrompt(true);
          }
        } catch (_) { /* linkage check is non-critical */ }
      }
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
          <h1 className="text-2xl font-bold">ND2A — 更改公司秘書及董事通知書 (委任╱停任)</h1>
          <p className="text-sm text-muted-foreground">Notice of Change of Company Secretary and Director (Appointment／Cessation)</p>
        </div>
      </div>

      <FormHistorySelector formType="ND2A" onSelect={handleLoadHistory} />

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

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* Company info */}
        <div>
          <h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={brNumber} onChange={e => setBrNumber(e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={companyName} onChange={e => setCompanyName(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Officers */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">董事/秘書出任或停任</h3>
            <Button variant="outline" size="sm" onClick={addOfficer}><Plus className="h-4 w-4 mr-1" />新增人員</Button>
          </div>
          {officers.map((officer, idx) => (
            <div key={idx} className="border border-border rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">人員 #{idx + 1}</span>
                {officers.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeOfficer(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>變更類型</Label>
                  <Select value={officer.type} onValueChange={v => updateOfficer(idx, 'type', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="appointment">出任 Appointment</SelectItem>
                      <SelectItem value="cessation">停任 Cessation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>職位</Label>
                  <Select value={officer.role} onValueChange={v => updateOfficer(idx, 'role', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="director">董事 Director</SelectItem>
                      <SelectItem value="alternate">候補董事 Alternate Director</SelectItem>
                      <SelectItem value="secretary">公司秘書 Secretary</SelectItem>
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
                {officer.identity === 'natural' ? (
                  <>
                    {selectedCompany && (
                      <div className="col-span-2">
                        <PersonQuickPick companyId={selectedCompanyId}
                          onPick={(d) => {
                            updateOfficer(idx, 'nameChinese', d.nameChinese || '');
                            updateOfficer(idx, 'nameSurname', d.surname || '');
                            updateOfficer(idx, 'nameOtherNames', d.otherNames || '');
                            if (d.idNumber) updateOfficer(idx, 'idNumber', d.idNumber);
                            if (d.addrFlat) updateOfficer(idx, 'addrFlatBlock', d.addrFlat);
                            if (d.addrBuilding) updateOfficer(idx, 'addrBuilding', d.addrBuilding);
                            if (d.addrStreet) updateOfficer(idx, 'addrStreetEstate', d.addrStreet);
                            if (d.addrDistrict) updateOfficer(idx, 'addrDistrict', d.addrDistrict);
                            if (d.addrRegion) updateOfficer(idx, 'addrRegion', d.addrRegion);
                          }}
                        />
                      </div>
                    )}
                    <div><Label>中文姓名</Label><Input value={officer.nameChinese} onChange={e => updateOfficer(idx, 'nameChinese', e.target.value)} className="mt-1" /></div>
                    <div>
                      <Label>英文姓名</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                        <Input placeholder="姓氏 Surname" value={officer.nameSurname} onChange={e => updateOfficer(idx, 'nameSurname', e.target.value)} />
                        <Input placeholder="名字 Other Names" value={officer.nameOtherNames} onChange={e => updateOfficer(idx, 'nameOtherNames', e.target.value)} />
                      </div>
                    </div>
                    {officer.role === 'alternate' && (
                      <div><Label>代替人</Label><Input placeholder="代替哪位董事 Alternate to" value={officer.alternateTo} onChange={e => updateOfficer(idx, 'alternateTo', e.target.value)} className="mt-1" /></div>
                    )}
                    <div><Label>證件號碼</Label><Input value={officer.idNumber} onChange={e => updateOfficer(idx, 'idNumber', e.target.value)} className="mt-1" /></div>
                    <div><Label>護照簽發國家／地區</Label><Input value={officer.passportCountry} onChange={e => updateOfficer(idx, 'passportCountry', e.target.value)} placeholder="如：HKSAR" className="mt-1" /></div>
                    <div><Label>護照號碼</Label><Input value={officer.passportNumber} onChange={e => updateOfficer(idx, 'passportNumber', e.target.value)} className="mt-1" /></div>
                    <div className="col-span-2">
                      {selectedCompany && (
                        <AddressQuickPick companyId={selectedCompanyId}
                          onPick={(d) => {
                            if (d.flat) updateOfficer(idx, 'addrFlatBlock', d.flat);
                            if (d.building) updateOfficer(idx, 'addrBuilding', d.building);
                            if (d.street) updateOfficer(idx, 'addrStreetEstate', d.street);
                            if (d.district) updateOfficer(idx, 'addrDistrict', d.district);
                            if (d.country || d.region) updateOfficer(idx, 'addrRegion', d.country || d.region || '');
                          }}
                        />
                      )}
                      <Label>住址 Residential Address</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                        <div className="space-y-1">
                          <Label className="text-xs" style={{ lineHeight: 1.3 }}>Flat／Floor／Block etc. 室／樓／座等</Label>
                          <Input placeholder="例如 Flat A, 12/F" value={officer.addrFlatBlock} onChange={e => updateOfficer(idx, 'addrFlatBlock', e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs" style={{ lineHeight: 1.3 }}>Building 大廈</Label>
                          <Input placeholder="大廈名稱" value={officer.addrBuilding} onChange={e => updateOfficer(idx, 'addrBuilding', e.target.value)} />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs" style={{ lineHeight: 1.3 }}>Street／Estate／Lot／Village etc. 街道／屋苑／地段／村等</Label>
                          <Input placeholder="街道及門牌號" value={officer.addrStreetEstate} onChange={e => updateOfficer(idx, 'addrStreetEstate', e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs" style={{ lineHeight: 1.3 }}>District／City／Province／State／Postal Code etc. 區／市／省／州／郵遞區號等</Label>
                          <Input placeholder="例如 Central／中環" value={officer.addrDistrict} onChange={e => updateOfficer(idx, 'addrDistrict', e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs" style={{ lineHeight: 1.3 }}>Country／Region 國家／地區</Label>
                          <Input placeholder="例如 Hong Kong／香港" value={officer.addrRegion} onChange={e => updateOfficer(idx, 'addrRegion', e.target.value)} list="nd2a-region-suggestions" />
                          <datalist id="nd2a-region-suggestions">
                            <option value="Hong Kong 香港" />
                            <option value="Kowloon 九龍" />
                            <option value="New Territories 新界" />
                            <option value="Mainland China 中國內地" />
                            <option value="Macau 澳門" />
                            <option value="Taiwan 台灣" />
                            <option value="BVI" />
                            <option value="Cayman Islands" />
                            <option value="Bermuda" />
                            <option value="Singapore 新加坡" />
                            <option value="United Kingdom 英國" />
                            <option value="United States 美國" />
                            <option value="Other 其他" />
                          </datalist>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div><Label>公司名稱</Label><Input value={officer.companyName} onChange={e => updateOfficer(idx, 'companyName', e.target.value)} className="mt-1" /></div>
                    <div><Label>公司編號</Label><Input value={officer.companyNumber} onChange={e => updateOfficer(idx, 'companyNumber', e.target.value)} className="mt-1" /></div>
                    <div><Label>成立地點</Label><Input value={officer.placeIncorporated} onChange={e => updateOfficer(idx, 'placeIncorporated', e.target.value)} className="mt-1" /></div>
                  </>
                )}
                <div><Label>{officer.type === 'appointment' ? '委任日期' : '停任日期'}</Label><Input type="date" value={officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased} onChange={e => updateOfficer(idx, officer.type === 'appointment' ? 'dateAppointed' : 'dateCeased', e.target.value)} className="mt-1" /></div>
                {officer.type === 'appointment' && officer.identity === 'natural' && (
                  <div className="col-span-2">
                    <Label>上述董事或候補董事在獲得這次委任時，是否已經是這公司的現任候補董事或董事？</Label>
                    <p className="text-xs text-muted-foreground mb-1">Is this director or alternate director already an existing alternate director or director in this company at the time of this appointment?</p>
                    <div className="flex gap-4 mt-1">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name={`alreadyDirector-${idx}`} checked={officer.alreadyDirector === 'yes'} onChange={() => updateOfficer(idx, 'alreadyDirector', 'yes')} /> 是 Yes
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name={`alreadyDirector-${idx}`} checked={officer.alreadyDirector === 'no'} onChange={() => updateOfficer(idx, 'alreadyDirector', 'no')} /> 否 No
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Signature & Presentor */}
        <div>
          <h3 className="font-semibold mb-3">簽署及提交人</h3>

          <div className="mb-4">
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
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>簽署人</Label>
              {selectedCompany && companyOfficers.length > 0 ? (
                <div className="space-y-2 mt-1">
                  <Select
                    value={signerId || '__auto__'}
                    onValueChange={v => {
                      if (v === '__auto__') { setSignerId(''); const s = selectedCompany.secretaries[0] || selectedCompany.directors[0]; setSignerName(s ? (s.nameEnglish || s.nameChinese || '') : ''); }
                      else if (v === '__manual__') { setSignerId('__manual__'); setSignerName(''); }
                      else {
                        setSignerId(v);
                        const o = companyOfficers.find(x => x.id === v);
                        setSignerName(o ? (o.nameEnglish || o.nameChinese || '') : '');
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="自動選擇（首個秘書 → 首個董事）" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">自動選擇（首個秘書 → 首個董事）</SelectItem>
                      {selectedCompany.directors.map(d => (
                        <SelectItem key={d.id} value={d.id}>🧑‍💼 董事：{d.nameEnglish || d.nameChinese}</SelectItem>
                      ))}
                      {selectedCompany.secretaries.map(s => (
                        <SelectItem key={s.id} value={s.id}>📋 秘書：{s.nameEnglish || s.nameChinese}</SelectItem>
                      ))}
                      <SelectItem value="__manual__">✏️ 手動輸入...</SelectItem>
                    </SelectContent>
                  </Select>
                  {signerId !== '__manual__' && (
                    <Input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="簽署人姓名（可手動修改）" />
                  )}
                </div>
              ) : (
                <Input value={signerName} onChange={e => setSignerName(e.target.value)} className="mt-1" placeholder="簽署人姓名" />
              )}
              {!selectedCompany && (
                <p className="text-xs text-muted-foreground mt-1">請先選擇公司，即可從其董事/秘書中選取簽署人</p>
              )}
            </div>
            <div><Label>簽署日期</Label><Input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人名稱</Label><Input value={presentorName} onChange={e => setPresentorName(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人地址</Label><Input value={presentorAddress} onChange={e => setPresentorAddress(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人電話</Label><Input value={presentorPhone} onChange={e => setPresentorPhone(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人傳真</Label><Input value={presentorFax} onChange={e => setPresentorFax(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人電郵</Label><Input value={presentorEmail} onChange={e => setPresentorEmail(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人檔號</Label><Input value={presentorReference} onChange={e => setPresentorReference(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={() => handleGenerate(false)} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 ND2A PDF</>}
          </Button>
          <Button variant="outline" onClick={() => handleGenerate(true)} disabled={generating}>生成測試 PDF（Debug）</Button>
        </div>
      </div>

      <RelatedFormsPrompt
        open={showRelatedPrompt}
        onOpenChange={setShowRelatedPrompt}
        primaryFormCode="ND2A"
        primaryFormName="ND2A — 更改公司秘書及董事通知書"
        primaryFormData={{ brNumber, companyName, officers, signerName, signDate, presentorName, presentorAddress, presentorPhone, presentorFax, presentorEmail, presentorReference, company_id: selectedCompanyId }}
        companyId={selectedCompanyId}
        companyName={companyName}
        linkages={relatedLinkages}
      />
    </div>
  );
}
