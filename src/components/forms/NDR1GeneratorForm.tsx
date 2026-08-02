import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PersonPicker, { type PersonPickOption } from './PersonPicker';
import RelatedFormsPrompt from './RelatedFormsPrompt';

interface NDR1GeneratorFormProps { onBack: () => void; initialCompanyId?: string; }

export default function NDR1GeneratorForm({ onBack, initialCompanyId }: NDR1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
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
    // 撤銷條件確認 (P.1)
    noOngoingBusiness: true,
    noOutstandingLiabilities: true,
    noLegalProceedings: true,
    noPropertyHeld: true,
    allMembersConsent: true,
    notBeingWoundUp: true,
    // 申請人資料 (P.1 左下角)
    applicantNameCN: '', applicantNameEN: '',
    applicantAddress: '', applicantAddress2: '', applicantAddress3: '',
    applicantTel: '', applicantFax: '', applicantEmail: '', applicantReference: '',
    // 簽署 (P.4)
    signerName: '', signDate: `${yyyy}-${mm}-${dd}`,
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

  // ── PersonPicker callbacks ──

  const handleApplicantPick = (data: PersonPickOption['data']) => {
    setFormData(prev => ({
      ...prev,
      ...(data.nameChinese !== undefined ? { applicantNameCN: data.nameChinese } : {}),
      ...(data.nameEnglish !== undefined ? { applicantNameEN: data.nameEnglish } : {}),
      // Build address from structured fields or flat address
      ...(data.addrFlat !== undefined || data.addrBuilding !== undefined || data.addrStreet !== undefined
        ? { applicantAddress: [data.addrFlat, data.addrBuilding, data.addrStreet].filter(Boolean).join(', ') }
        : data.address !== undefined ? { applicantAddress: data.address } : {}),
      ...(data.addrDistrict !== undefined || data.addrRegion !== undefined
        ? { applicantAddress2: [data.addrDistrict, data.addrRegion].filter(Boolean).join(', ') } : {}),
      ...(data.phone !== undefined ? { applicantTel: data.phone } : {}),
      ...(data.fax !== undefined ? { applicantFax: data.fax } : {}),
      ...(data.email !== undefined ? { applicantEmail: data.email } : {}),
      ...(data.reference !== undefined ? { applicantReference: data.reference } : {}),
    }));
  };

  const handleSignerPick = (data: PersonPickOption['data']) => {
    setFormData(prev => ({
      ...prev,
      ...(data.nameEnglish ? { signerName: data.nameEnglish } : {}),
      ...(data.nameChinese && !data.nameEnglish ? { signerName: data.nameChinese } : {}),
    }));
  };

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
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

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* 公司資料 */}
        <div><h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* 撤銷條件 */}
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

        {/* 🆕 申請人 — PersonPicker: 公司人員 / 提交人 / 手動輸入 */}
        <PersonPicker
          label="申請人資料（P.1 左下角）"
          companyId={selectedCompanyId}
          currentData={{
            nameChinese: formData.applicantNameCN,
            nameEnglish: formData.applicantNameEN,
            address1: formData.applicantAddress,
            address2: formData.applicantAddress2,
            address3: formData.applicantAddress3,
            phone: formData.applicantTel,
            fax: formData.applicantFax,
            email: formData.applicantEmail,
            reference: formData.applicantReference,
          }}
          onPick={handleApplicantPick}
        />

        {/* 🆕 簽署人 — PersonPicker (dropdownOnly: name only) */}
        <PersonPicker
          label="簽署人（P.4）"
          companyId={selectedCompanyId}
          currentData={{
            nameChinese: formData.signerName,
            nameEnglish: formData.signerName,
          }}
          onPick={handleSignerPick}
          showFields={['nameEnglish']}
          fieldLabels={{ nameEnglish: '簽署人姓名' }}
          dropdownOnly
        />

        {/* 簽署日期 */}
        <div><h3 className="font-semibold mb-3">簽署日期（P.4）</h3>
          <div className="w-48">
            <Label>簽署日期</Label>
            <Input type="date" value={formData.signDate} onChange={e => update('signDate', e.target.value)} className="mt-1" />
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
