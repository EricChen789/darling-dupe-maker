import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

interface NDR1GeneratorFormProps { onBack: () => void; initialCompanyId?: string; }

export default function NDR1GeneratorForm({ onBack, initialCompanyId }: NDR1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);

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
    // 其他
    dissolutionDay: dd, dissolutionMonth: mm, dissolutionYear: yyyy,
    signerName: '', signerCapacity: 'Director',
    signDateDay: dd, signDateMonth: mm, signDateYear: yyyy,
    presentorName: '', presentorContact: '',
  });

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({
        ...prev, brNumber: company.brNumber, companyName: company.name, presentorName: company.name,
      }));
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  const update = (field: string, value: string | boolean) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const fields: Record<string, string> = {
        'fill_1_P.1': formData.brNumber,
        'fill_2_P.1': formData.companyName,
        'fill_3_P.1': formData.dissolutionDay,
        'fill_4_P.1': formData.dissolutionMonth,
        'fill_5_P.1': formData.dissolutionYear,
        'fill_6_P.1': formData.signerName || '',
        'fill_7_P.1': formData.signerCapacity || '',
        'fill_8_P.1': formData.signDateDay,
        'fill_9_P.1': formData.signDateMonth,
        'fill_10_P.1': formData.signDateYear,
        'fill_11_P.1': formData.presentorName || '',
        'fill_12_P.1': formData.presentorContact || '',
      };
      const checkboxes: string[] = [];
      if (formData.noOngoingBusiness) checkboxes.push('cb_1_P.1');
      if (formData.noOutstandingLiabilities) checkboxes.push('cb_2_P.1');
      if (formData.noLegalProceedings) checkboxes.push('cb_3_P.1');
      if (formData.noPropertyHeld) checkboxes.push('cb_4_P.1');
      if (formData.allMembersConsent) checkboxes.push('cb_5_P.1');
      if (formData.notBeingWoundUp) checkboxes.push('cb_6_P.1');

      const resp = await fetch(`/api/generate-template-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ template: 'NDR1-template.pdf', fields, checkboxes }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NDR1-form.pdf');
      toast({ title: '生成成功', description: 'NDR1 表格已下載' });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NDR1 — 私人公司或擔保有限公司撤銷註冊申請書</h1><p className="text-sm text-muted-foreground">Application for Deregistration of Private Company or Company Limited by Guarantee</p></div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><Building2 className="h-4 w-4 text-primary" /><Label className="font-medium">選擇公司自動填入</Label></div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
          <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.brNumber})</SelectItem>)}</SelectContent>
        </Select>
      </div>

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
              <span className="text-sm">公司沒有尚未清償的債務（包括稅款及罰款）</span>
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

        <div><h3 className="font-semibold mb-3">擬撤銷日期</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>日 (DD)</Label><Input value={formData.dissolutionDay} onChange={e => update('dissolutionDay', e.target.value)} className="mt-1" /></div>
            <div><Label>月 (MM)</Label><Input value={formData.dissolutionMonth} onChange={e => update('dissolutionMonth', e.target.value)} className="mt-1" /></div>
            <div><Label>年 (YYYY)</Label><Input value={formData.dissolutionYear} onChange={e => update('dissolutionYear', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">簽署</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>簽署人姓名</Label><Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1" /></div>
            <div><Label>身份</Label><Input value={formData.signerCapacity} onChange={e => update('signerCapacity', e.target.value)} className="mt-1" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>日 (DD)</Label><Input value={formData.signDateDay} onChange={e => update('signDateDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月 (MM)</Label><Input value={formData.signDateMonth} onChange={e => update('signDateMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年 (YYYY)</Label><Input value={formData.signDateYear} onChange={e => update('signDateYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">提交人資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>姓名／名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>電話 / 傳真 / 電郵</Label><Input value={formData.presentorContact} onChange={e => update('presentorContact', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NDR1 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
