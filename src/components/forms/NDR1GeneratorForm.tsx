import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { usePresenterList, type Presenter } from '@/hooks/usePresenters';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PersonPicker, { type PersonPickOption } from './PersonPicker';
import RelatedFormsPrompt from './RelatedFormsPrompt';

interface NDR1GeneratorFormProps { onBack: () => void; initialCompanyId?: string; }

export default function NDR1GeneratorForm({ onBack, initialCompanyId }: NDR1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const { data: presenters = [] } = usePresenterList();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showRelatedPrompt, setShowRelatedPrompt] = useState(false);
  const [relatedLinkages, setRelatedLinkages] = useState<any[]>([]);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '', companyName: '',
    // 撤銷條件確認
    noOngoingBusiness: true,
    noOutstandingLiabilities: true,
    noLegalProceedings: true,
    noPropertyHeld: true,
    allMembersConsent: true,
    notBeingWoundUp: true,
    // A. 申請人身份: 'company' | 'director' | 'member'
    applicantCapacity: 'director' as string,
    // P.1 提交人資料 Presentor's Reference
    presenterNameCN: '', presenterNameEN: '',
    presenterAddress1: '', presenterAddress2: '', presenterAddress3: '',
    presenterTel: '', presenterFax: '', presenterEmail: '', presenterReference: '',
    // P.2 申請人資料
    applicantType: 'natural' as string,
    appChineseName: '', appSurname: '', appOtherNames: '',
    appBodyCorpName: '',
    appAddrFlat: '', appAddrBuilding: '', appAddrStreet: '', appAddrDistrict: '', appAddrCountry: '',
    appEmail: '', appFax: '',
    // P.3 獲提名自然人（僅公司自身申請時需要）
    nomChineseName: '', nomSurname: '', nomOtherNames: '',
    nomAddrFlat: '', nomAddrBuilding: '', nomAddrStreet: '', nomAddrDistrict: '', nomAddrCountry: '',
    nomEmail: '', nomFax: '',
    // P.4 簽署
    signerName: '', signerRole: 'director', signDate: `${yyyy}-${mm}-${dd}`,
  });

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({
        ...prev, brNumber: company.brNumber, companyName: company.name,
        // 公司自身作申請人時：用公司名填入法人名稱
        appBodyCorpName: company.name,
        // 提交人默認用公司名
        presenterNameEN: company.name,
        presenterNameCN: company.chineseName || '',
      }));
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  const update = (field: string, value: string | boolean) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleLoadHistory = (data: any) => {
    if (data.formData) setFormData((prev: any) => ({ ...prev, ...data.formData }));
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
  };

  // ── 申請人身份變更 ──
  const setApplicantCapacity = (capacity: string) => {
    setFormData(prev => ({
      ...prev,
      applicantCapacity: capacity,
      applicantType: capacity === 'company' ? 'corporate' : 'natural',
    }));
  };

  // ── PersonPicker: 從公司人員/提交人中選擇 → 填入 P.1 提交人 + P.2 申請人 ──
  const handlePersonPick = (data: PersonPickOption['data'], source: string, role?: string) => {
    setFormData(prev => {
      const next = { ...prev };
      // P.1 提交人資料
      if (data.nameChinese !== undefined) next.presenterNameCN = data.nameChinese;
      if (data.nameEnglish !== undefined) next.presenterNameEN = data.nameEnglish;
      if (data.addrFlat !== undefined) next.presenterAddress1 = data.addrFlat;
      if (data.addrBuilding !== undefined || data.addrStreet !== undefined)
        next.presenterAddress2 = [data.addrBuilding, data.addrStreet].filter(Boolean).join(', ');
      if (data.addrDistrict !== undefined || data.addrRegion !== undefined)
        next.presenterAddress3 = [data.addrDistrict, data.addrRegion].filter(Boolean).join(', ');
      if (data.phone !== undefined) next.presenterTel = data.phone;
      if (data.fax !== undefined) next.presenterFax = data.fax;
      if (data.email !== undefined) next.presenterEmail = data.email;
      if (data.reference !== undefined) next.presenterReference = data.reference;

      // P.2 申請人資料 — 根據來源身份決定
      if (source === 'company') {
        if (role === 'director') {
          next.applicantCapacity = 'director';
          next.applicantType = 'natural';
          next.appChineseName = data.nameChinese || '';
          next.appSurname = data.nameEnglish ? (data.nameEnglish.split(' ').pop() || '') : '';
          next.appOtherNames = data.nameEnglish ? data.nameEnglish.split(' ').slice(0, -1).join(' ') : '';
          next.appBodyCorpName = '';
        } else {
          // secretary → 提交人身份不限，但秘書不是公司董事/成員
          // 保持原有 capacity，只填入聯絡資料
        }
        if (data.addrFlat !== undefined) next.appAddrFlat = data.addrFlat || '';
        if (data.addrBuilding !== undefined) next.appAddrBuilding = data.addrBuilding || '';
        if (data.addrStreet !== undefined) next.appAddrStreet = data.addrStreet || '';
        if (data.addrDistrict !== undefined) next.appAddrDistrict = data.addrDistrict || '';
        if (data.addrRegion !== undefined) next.appAddrCountry = data.addrRegion || '';
        if (data.email !== undefined) next.appEmail = data.email;
        if (data.fax !== undefined) next.appFax = data.fax;
      } else if (source === 'presenter') {
        // 提交人 — 僅填入 P.1，不影響 P.2
      }
      return next;
    });
  };

  // ── 選擇提交人(Presenter) → 填入 P.1 提交人資料 ──
  const handlePresenterSelect = (p: Presenter) => {
    setFormData(prev => ({
      ...prev,
      presenterNameCN: (p as any).nameChinese || '',
      presenterNameEN: p.nameEnglish || p.name || '',
      presenterAddress1: p.address || '',
      presenterTel: p.phone || '',
      presenterFax: p.fax || '',
      presenterEmail: p.email || '',
      presenterReference: p.reference || '',
    }));
  };

  // ── 簽署人選擇 ──
  const handleSignerPick = (data: PersonPickOption['data']) => {
    setFormData(prev => ({
      ...prev,
      signerName: data.nameEnglish || data.nameChinese || prev.signerName,
    }));
  };

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    if (!formData.presenterNameEN) { toast({ title: '錯誤', description: '請填寫提交人英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const resp = await fetch(`/api/generate-ndr1-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formData),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NDR1-form.pdf');
      toast({ title: '生成成功', description: 'NDR1 表格已下載' });
      saveFormHistory({ formType: 'NDR1', formData: { formData, selectedCompanyId } });

      try {
        const linkResp = await fetch(`/api/form-linkages?primary=NDR1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const linkData = await linkResp.json();
        if (linkData.linkages && linkData.linkages.length > 0) {
          setRelatedLinkages(linkData.linkages);
          setShowRelatedPrompt(true);
        }
      } catch (_) { /* non-critical */ }
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  const showNomineeSection = formData.applicantCapacity === 'company';

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NDR1 — 私人公司或擔保有限公司撤銷註冊申請書</h1><p className="text-sm text-muted-foreground">Application for Deregistration of Private Company or Company Limited by Guarantee</p></div>
      </div>

      <FormHistorySelector formType="NDR1" onSelect={handleLoadHistory} />

      {/* 選擇公司 */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><Building2 className="h-4 w-4 text-primary" /><Label className="font-medium">選擇公司自動填入</Label></div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
          <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.brNumber})</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">

        {/* ── 公司資料 ── */}
        <div><h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── 撤銷條件 ── */}
        <div><h3 className="font-semibold mb-3">撤銷註冊條件確認（全選方可申請）</h3>
          <div className="space-y-3">
            {[
              ['noOngoingBusiness', '公司從未開始營業，或已停止營業超過三個月'],
              ['noOutstandingLiabilities', '公司沒有尚未清償的債務（包括税款及罰款）'],
              ['noLegalProceedings', '公司不是任何法律程序的一方'],
              ['noPropertyHeld', '公司沒有持有任何不動產'],
              ['allMembersConsent', '全體成員（股東）同意撤銷註冊'],
              ['notBeingWoundUp', '公司並非處於清盤或破產程序中'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <Checkbox checked={!!(formData as any)[key]} onCheckedChange={v => update(key, !!v)} />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* ── A. 申請人身份（P.1 勾選框 cb_1~cb_3）── */}
        <div>
          <h3 className="font-semibold mb-3">A. 申請人的身分 Capacity of Applicant（P.1 勾選）</h3>
          <p className="text-xs text-muted-foreground mb-3">此撤銷註冊的申請是由以下人士作出 — 請選擇其一</p>
          <RadioGroup value={formData.applicantCapacity} onValueChange={setApplicantCapacity} className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <RadioGroupItem value="company" />
              <span className="text-sm">上述公司 <span className="text-muted-foreground">the above named company</span></span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <RadioGroupItem value="director" />
              <span className="text-sm">上述公司的一名董事 <span className="text-muted-foreground">a director of the above named company</span></span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <RadioGroupItem value="member" />
              <span className="text-sm">上述公司的一名成員 <span className="text-muted-foreground">a member of the above named company</span></span>
            </label>
          </RadioGroup>
          {formData.applicantCapacity === 'company' && (
            <p className="text-xs text-amber-600 mt-2">⚠️ 如申請人為上述公司，請同時填報下方「C. 獲提名自然人資料」（Section 2C）</p>
          )}
        </div>

        {/* ── P.1 提交人資料 ── */}
        <div>
          <h3 className="font-semibold mb-3">提交人資料 Presentor's Reference（P.1 左下角）</h3>
          {/* 從已儲存提交人選取 */}
          {presenters.length > 0 && (
            <div className="mb-3">
              <Label className="text-xs text-muted-foreground mb-1 block">從已儲存提交人載入</Label>
              <Select onValueChange={(id) => {
                const p = presenters.find(pr => pr.id === id);
                if (p) handlePresenterSelect(p);
              }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="選擇已儲存提交人..." /></SelectTrigger>
                <SelectContent>
                  {presenters.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{p.phone ? ` · ${p.phone}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">中文名稱</Label><Input value={formData.presenterNameCN} onChange={e => update('presenterNameCN', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            <div><Label className="text-xs">英文名稱 *</Label><Input value={formData.presenterNameEN} onChange={e => update('presenterNameEN', e.target.value)} className="mt-1 h-8 text-sm" /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 mt-3">
            <div><Label className="text-xs">地址 1</Label><Input value={formData.presenterAddress1} onChange={e => update('presenterAddress1', e.target.value)} className="mt-1 h-8 text-sm" placeholder="Flat, Floor, Block" /></div>
            <div><Label className="text-xs">地址 2</Label><Input value={formData.presenterAddress2} onChange={e => update('presenterAddress2', e.target.value)} className="mt-1 h-8 text-sm" placeholder="Building, Street" /></div>
            <div><Label className="text-xs">地址 3</Label><Input value={formData.presenterAddress3} onChange={e => update('presenterAddress3', e.target.value)} className="mt-1 h-8 text-sm" placeholder="District, Region, Country" /></div>
          </div>
          <div className="grid grid-cols-4 gap-3 mt-3">
            <div><Label className="text-xs">電話</Label><Input value={formData.presenterTel} onChange={e => update('presenterTel', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            <div><Label className="text-xs">傳真</Label><Input value={formData.presenterFax} onChange={e => update('presenterFax', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            <div><Label className="text-xs">電郵</Label><Input value={formData.presenterEmail} onChange={e => update('presenterEmail', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            <div><Label className="text-xs">參考編號</Label><Input value={formData.presenterReference} onChange={e => update('presenterReference', e.target.value)} className="mt-1 h-8 text-sm" /></div>
          </div>
        </div>

        {/* ── B. 申請人資料（P.2）── */}
        <div>
          <h3 className="font-semibold mb-3">B. 申請人的資料 Particulars of Applicant（P.2）</h3>

          {formData.applicantType === 'natural' ? (
            /* 自然人 */
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><Label className="text-xs">中文姓名</Label><Input value={formData.appChineseName} onChange={e => update('appChineseName', e.target.value)} className="mt-1 h-8 text-sm" /></div>
                <div><Label className="text-xs">英文姓氏 Surname</Label><Input value={formData.appSurname} onChange={e => update('appSurname', e.target.value)} className="mt-1 h-8 text-sm" /></div>
                <div><Label className="text-xs">英文名字 Other Names</Label><Input value={formData.appOtherNames} onChange={e => update('appOtherNames', e.target.value)} className="mt-1 h-8 text-sm" /></div>
              </div>
              {/* 董事/成員 從公司人員選取 */}
              {selectedCompany && formData.applicantCapacity !== 'company' && (
                <div className="bg-muted/30 border border-border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /><Label className="text-xs font-medium">從公司人員載入</Label></div>
                  <Select onValueChange={(id) => {
                    const allPeople = [
                      ...(selectedCompany.directors || []).map(d => ({ ...d, _role: 'director' as const })),
                      ...(selectedCompany.secretaries || []).map(s => ({ ...s, _role: 'secretary' as const })),
                    ];
                    const person = allPeople.find(p => p.id === id);
                    if (person) {
                      const en = person.nameEnglish || '';
                      const parts = en.split(' ');
                      const surname = parts.pop() || '';
                      const other = parts.join(' ');
                      setFormData(prev => ({
                        ...prev,
                        applicantCapacity: person._role === 'director' ? 'director' : prev.applicantCapacity,
                        appChineseName: person.nameChinese || '',
                        appSurname: surname,
                        appOtherNames: other,
                        appAddrFlat: person.addrFlat || '',
                        appAddrBuilding: person.addrBuilding || '',
                        appAddrStreet: person.addrStreet || '',
                        appAddrDistrict: person.addrDistrict || '',
                        appAddrCountry: person.addrRegion || '',
                        appEmail: person.email || '',
                      }));
                    }
                  }}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="選擇董事/秘書..." /></SelectTrigger>
                    <SelectContent>
                      {(selectedCompany.directors || []).map(d => (
                        <SelectItem key={d.id} value={d.id}>{d.nameEnglish || d.nameChinese || '?'} — 董事</SelectItem>
                      ))}
                      {(selectedCompany.secretaries || []).map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.nameEnglish || s.nameChinese || '?'} — 秘書</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ) : (
            /* 法人團體（公司自身） */
            <div>
              <Label className="text-xs">申請人名稱（法人團體）Name of Applicant (Body Corporate)</Label>
              <Input value={formData.appBodyCorpName} onChange={e => update('appBodyCorpName', e.target.value)} className="mt-1 text-sm" placeholder="公司全稱" />
            </div>
          )}

          {/* P.2 地址 + 聯絡（自然人和法人通用） */}
          <div className="grid grid-cols-1 gap-3 mt-3">
            <div><Label className="text-xs">室／樓／座等 Flat / Floor / Block etc.</Label><Input value={formData.appAddrFlat} onChange={e => update('appAddrFlat', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            <div><Label className="text-xs">大廈 Building</Label><Input value={formData.appAddrBuilding} onChange={e => update('appAddrBuilding', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            <div><Label className="text-xs">街道／屋苑／地段／村等 Street / Estate / Lot / Village etc.</Label><Input value={formData.appAddrStreet} onChange={e => update('appAddrStreet', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            <div><Label className="text-xs">區／市／省／州等 District / City / Province / State etc.</Label><Input value={formData.appAddrDistrict} onChange={e => update('appAddrDistrict', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            <div><Label className="text-xs">國家／地區 Country / Region</Label><Input value={formData.appAddrCountry} onChange={e => update('appAddrCountry', e.target.value)} className="mt-1 h-8 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div><Label className="text-xs">電郵地址 Email Address</Label><Input value={formData.appEmail} onChange={e => update('appEmail', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            <div><Label className="text-xs">圖文傳真號碼 Fax Number</Label><Input value={formData.appFax} onChange={e => update('appFax', e.target.value)} className="mt-1 h-8 text-sm" /></div>
          </div>
        </div>

        {/* ── C. 獲提名自然人（P.3 Section 2C）— 僅公司自身申請時顯示 ── */}
        {showNomineeSection && (
          <div className="bg-amber-50/30 border border-amber-200 rounded-lg p-4">
            <h3 className="font-semibold mb-1">C. 獲提名負責接收撤銷註冊通知書的自然人的資料（P.3 Section 2C）</h3>
            <p className="text-xs text-muted-foreground mb-3">Particulars of the Natural Person Nominated to be Given Notice of the Deregistration — 申請人為上述公司時必須填寫</p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div><Label className="text-xs">中文姓名</Label><Input value={formData.nomChineseName} onChange={e => update('nomChineseName', e.target.value)} className="mt-1 h-8 text-sm" /></div>
              <div><Label className="text-xs">英文姓氏 Surname</Label><Input value={formData.nomSurname} onChange={e => update('nomSurname', e.target.value)} className="mt-1 h-8 text-sm" /></div>
              <div><Label className="text-xs">英文名字 Other Names</Label><Input value={formData.nomOtherNames} onChange={e => update('nomOtherNames', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            </div>
            {/* 從公司人員選取獲提名人 */}
            {selectedCompany && (
              <div className="bg-background border border-border rounded-lg p-3 mb-3">
                <Label className="text-xs font-medium mb-1 block">從公司董事/秘書載入獲提名人</Label>
                <Select onValueChange={(id) => {
                  const allPeople = [
                    ...(selectedCompany.directors || []).map(d => ({ ...d, _role: 'director' })),
                    ...(selectedCompany.secretaries || []).map(s => ({ ...s, _role: 'secretary' })),
                  ];
                  const person = allPeople.find(p => p.id === id);
                  if (person) {
                    const en = person.nameEnglish || '';
                    const parts = en.split(' ');
                    setFormData(prev => ({
                      ...prev,
                      nomChineseName: person.nameChinese || '',
                      nomSurname: parts.pop() || '',
                      nomOtherNames: parts.join(' '),
                      nomAddrFlat: person.addrFlat || '',
                      nomAddrBuilding: person.addrBuilding || '',
                      nomAddrStreet: person.addrStreet || '',
                      nomAddrDistrict: person.addrDistrict || '',
                      nomAddrCountry: person.addrRegion || '',
                      nomEmail: person.email || '',
                    }));
                  }
                }}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="選擇人員..." /></SelectTrigger>
                  <SelectContent>
                    {(selectedCompany.directors || []).map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.nameEnglish || d.nameChinese || '?'} — 董事</SelectItem>
                    ))}
                    {(selectedCompany.secretaries || []).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.nameEnglish || s.nameChinese || '?'} — 秘書</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3">
              <div><Label className="text-xs">室／樓／座等</Label><Input value={formData.nomAddrFlat} onChange={e => update('nomAddrFlat', e.target.value)} className="mt-1 h-8 text-sm" /></div>
              <div><Label className="text-xs">大廈</Label><Input value={formData.nomAddrBuilding} onChange={e => update('nomAddrBuilding', e.target.value)} className="mt-1 h-8 text-sm" /></div>
              <div><Label className="text-xs">街道／屋苑等</Label><Input value={formData.nomAddrStreet} onChange={e => update('nomAddrStreet', e.target.value)} className="mt-1 h-8 text-sm" /></div>
              <div><Label className="text-xs">區／市／省等</Label><Input value={formData.nomAddrDistrict} onChange={e => update('nomAddrDistrict', e.target.value)} className="mt-1 h-8 text-sm" /></div>
              <div><Label className="text-xs">國家／地區</Label><Input value={formData.nomAddrCountry} onChange={e => update('nomAddrCountry', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div><Label className="text-xs">電郵地址</Label><Input value={formData.nomEmail} onChange={e => update('nomEmail', e.target.value)} className="mt-1 h-8 text-sm" /></div>
              <div><Label className="text-xs">圖文傳真號碼</Label><Input value={formData.nomFax} onChange={e => update('nomFax', e.target.value)} className="mt-1 h-8 text-sm" /></div>
            </div>
          </div>
        )}

        {/* ── P.4 簽署 ── */}
        <div>
          <h3 className="font-semibold mb-3">簽署（P.4）</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">簽署人姓名 *</Label>
              <Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1 h-8 text-sm" />
              {/* 從公司人員載入 */}
              {selectedCompany && (
                <Select onValueChange={(id) => {
                  const allPeople = [
                    ...(selectedCompany.directors || []).map(d => ({ ...d, _role: 'director' })),
                    ...(selectedCompany.secretaries || []).map(s => ({ ...s, _role: 'secretary' })),
                  ];
                  const person = allPeople.find(p => p.id === id);
                  if (person) {
                    update('signerName', person.nameEnglish || person.nameChinese || '');
                    update('signerRole', person._role || 'director');
                  }
                }}>
                  <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue placeholder="從公司選..." /></SelectTrigger>
                  <SelectContent>
                    {(selectedCompany.directors || []).map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.nameEnglish || '?'} — 董事</SelectItem>
                    ))}
                    {(selectedCompany.secretaries || []).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.nameEnglish || '?'} — 秘書</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label className="text-xs">簽署人身份</Label>
              <Select value={formData.signerRole} onValueChange={v => update('signerRole', v)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="director">董事 Director</SelectItem>
                  <SelectItem value="secretary">公司秘書 Company Secretary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">簽署日期</Label>
              <Input type="date" value={formData.signDate} onChange={e => update('signDate', e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
          </div>
        </div>

        {/* ── 生成按鈕 ── */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NDR1 PDF</>}
          </Button>
        </div>
      </div>

      <RelatedFormsPrompt
        open={showRelatedPrompt}
        onOpenChange={setShowRelatedPrompt}
        primaryFormCode="NDR1"
        primaryFormName="NDR1 — 撤銷註冊申請書"
        primaryFormData={{ ...formData, company_id: selectedCompanyId }}
        companyId={selectedCompanyId}
        companyName={formData.companyName}
        linkages={relatedLinkages}
      />
    </div>
  );
}
