import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Download, Loader2, Building2, User2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { Person } from '@/types';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import RelatedFormsPrompt from './RelatedFormsPrompt';

interface NDR1GeneratorFormProps { onBack: () => void; initialCompanyId?: string; }

export default function NDR1GeneratorForm({ onBack, initialCompanyId }: NDR1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState('');
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
    // 撤銷條件確認 (P.1)
    noOngoingBusiness: true,
    noOutstandingLiabilities: true,
    noLegalProceedings: true,
    // 申請人資料 (P.1 左下角：fill_3=中文名, fill_4=英文名, fill_5/6/7=地址, fill_8=電話, fill_9=傳真, fill_10=電郵, fill_11=參考編號)
    applicantNameCN: '', applicantNameEN: '',
    applicantAddress: '', applicantAddress2: '', applicantAddress3: '',
    applicantTel: '', applicantFax: '', applicantEmail: '', applicantReference: '',
    // 簽署 (P.4: fill_2=簽署人, fill_3=日期)
    signerName: '', signDate: `${yyyy}-${mm}-${dd}`,
  });

  // Build list of directors + secretaries from selected company
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
    setSelectedPersonId(''); // reset person selection
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({
        ...prev, brNumber: company.brNumber, companyName: company.name,
        applicantNameEN: company.name, applicantNameCN: company.chineseName || '',
      }));
    }
  };

  const handlePersonSelect = (personId: string) => {
    setSelectedPersonId(personId);
    const person = companyPeople.find(p => p.id === personId);
    if (person) {
      const personAddr = [
        person.addrFlat, person.addrBuilding, person.addrStreet, person.addrDistrict,
      ].filter(Boolean).join(', ') || person.address || '';
      setFormData(prev => ({
        ...prev,
        applicantNameCN: person.nameChinese || '',
        applicantNameEN: person.nameEnglish || '',
        applicantAddress: person.addrFlat || '',
        applicantAddress2: [person.addrBuilding, person.addrStreet].filter(Boolean).join(', '),
        applicantAddress3: [person.addrDistrict, person.addrRegion].filter(Boolean).join(', '),
        applicantTel: person.phone || '',
        applicantEmail: person.email || '',
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

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      // Include selected person data for P.2-P.3 natural person applicant
      const selectedPerson = selectedPersonId ? companyPeople.find(p => p.id === selectedPersonId) : null;
      const body = {
        ...formData,
        ...(selectedPerson ? { selectedPerson: {
          nameChinese: selectedPerson.nameChinese,
          nameEnglish: selectedPerson.nameEnglish,
          address: selectedPerson.address,
          addrFlat: selectedPerson.addrFlat,
          addrBuilding: selectedPerson.addrBuilding,
          addrStreet: selectedPerson.addrStreet,
          addrDistrict: selectedPerson.addrDistrict,
          addrRegion: selectedPerson.addrRegion,
          email: selectedPerson.email,
          phone: selectedPerson.phone,
        }} : {}),
      };
      const resp = await fetch(`/api/generate-ndr1-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NDR1-form.pdf');
      toast({ title: '生成成功', description: 'NDR1 表格已下載' });
      saveFormHistory({ formType: 'NDR1', formData: { formData, selectedCompanyId } });

      // Phase 5: Check for related forms
      try {
        const linkResp = await fetch(`/api/form-linkages?primary=NDR1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const linkData = await linkResp.json();
        if (linkData.linkages && linkData.linkages.length > 0) {
          setRelatedLinkages(linkData.linkages);
          setShowRelatedPrompt(true);
        }
      } catch (_) { /* linkage check is non-critical */ }
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NDR1 — 私人公司或擔保有限公司撤銷註冊申請書</h1><p className="text-sm text-muted-foreground">Application for Deregistration of Private Company or Company Limited by Guarantee</p></div>
      </div>

      <FormHistorySelector formType="NDR1" onSelect={handleLoadHistory} />

      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><Building2 className="h-4 w-4 text-primary" /><Label className="font-medium">選擇公司自動填入</Label></div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
          <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.brNumber})</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Person selector — 从已选公司的董事/秘書中选人自动填入申请人资料 */}
      {selectedCompany && companyPeople.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <User2 className="h-4 w-4 text-primary" />
            <Label className="font-medium">選擇董事/秘書自動填入申請人資料</Label>
            <span className="text-xs text-muted-foreground">（從 {selectedCompany.name} 的人員中選取，填入 P.2 自然人申請人）</span>
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
        <div><h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">撤銷註冊條件確認（全選方可申請）</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={formData.noOngoingBusiness} onCheckedChange={v => update('noOngoingBusiness', !!v)} />
              <span className="text-sm">公司從未開始營業，或已停止營業超過三個月</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={formData.noOutstandingLiabilities} onCheckedChange={v => update('noOutstandingLiabilities', !!v)} />
              <span className="text-sm">公司沒有尚未清償的債務（包括税款及罰款）</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={formData.noLegalProceedings} onCheckedChange={v => update('noLegalProceedings', !!v)} />
              <span className="text-sm">公司不是任何法律程序的一方</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={formData.noPropertyHeld} onCheckedChange={v => update('noPropertyHeld', !!v)} />
              <span className="text-sm">公司沒有持有任何不動產</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={formData.allMembersConsent} onCheckedChange={v => update('allMembersConsent', !!v)} />
              <span className="text-sm">全體成員（股東）同意撤銷註冊</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={formData.notBeingWoundUp} onCheckedChange={v => update('notBeingWoundUp', !!v)} />
              <span className="text-sm">公司並非處於清盤或破產程序中</span>
            </label>
          </div>
        </div>

        {/* P.1 左下角：申請人資料 */}
        <div><h3 className="font-semibold mb-3">申請人資料（P.1 左下角）</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>中文名稱</Label><Input value={formData.applicantNameCN} onChange={e => update('applicantNameCN', e.target.value)} className="mt-1" placeholder="例如：彭鄧會計師事務所有限公司" /></div>
            <div><Label>英文名稱</Label><Input value={formData.applicantNameEN} onChange={e => update('applicantNameEN', e.target.value)} className="mt-1" placeholder="例如：PAUL TANG AND COMPANY LIMITED" /></div>
          </div>
          <div className="grid grid-cols-1 gap-4 mt-4">
            <div><Label>地址 1</Label><Input value={formData.applicantAddress} onChange={e => update('applicantAddress', e.target.value)} className="mt-1" placeholder="Flat, Floor, Block etc." /></div>
            <div><Label>地址 2</Label><Input value={formData.applicantAddress2} onChange={e => update('applicantAddress2', e.target.value)} className="mt-1" placeholder="Building, Street, District etc." /></div>
            <div><Label>地址 3</Label><Input value={formData.applicantAddress3} onChange={e => update('applicantAddress3', e.target.value)} className="mt-1" placeholder="Country, Region etc." /></div>
          </div>
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div><Label>電話</Label><Input value={formData.applicantTel} onChange={e => update('applicantTel', e.target.value)} className="mt-1" /></div>
            <div><Label>傳真</Label><Input value={formData.applicantFax} onChange={e => update('applicantFax', e.target.value)} className="mt-1" /></div>
            <div><Label>電郵</Label><Input value={formData.applicantEmail} onChange={e => update('applicantEmail', e.target.value)} className="mt-1" /></div>
            <div><Label>參考編號</Label><Input value={formData.applicantReference} onChange={e => update('applicantReference', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* P.4：簽署 */}
        <div><h3 className="font-semibold mb-3">簽署（P.4）</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>簽署人姓名</Label><Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1" /></div>
            <div><Label>簽署日期</Label><Input type="date" value={formData.signDate} onChange={e => update('signDate', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

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
