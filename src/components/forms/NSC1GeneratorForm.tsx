import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

interface NSC1GeneratorFormProps { onBack: () => void; initialCompanyId?: string; }

interface ShareAllotment { class: string; currency: string; numberOfShares: string; amountPaid: string; allotteeName: string; }

export default function NSC1GeneratorForm({ onBack, initialCompanyId }: NSC1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '', companyName: '',
    allotmentDay: dd, allotmentMonth: mm, allotmentYear: yyyy,
    presentorName: '', presentorContact: '',
  });

  const [allotments, setAllotments] = useState<ShareAllotment[]>([
    { class: '普通股 Ordinary', currency: 'HKD', numberOfShares: '', amountPaid: '', allotteeName: '' },
  ]);

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({ ...prev, brNumber: company.brNumber, companyName: company.name, presentorName: company.name }));
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  const update = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }));
  const updateAllotment = (i: number, f: keyof ShareAllotment, v: string) => setAllotments(prev => prev.map((a, idx) => idx === i ? { ...a, [f]: v } : a));
  const addAllotment = () => setAllotments(prev => [...prev, { class: '普通股 Ordinary', currency: 'HKD', numberOfShares: '', amountPaid: '', allotteeName: '' }]);
  const removeAllotment = (i: number) => setAllotments(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      // Map form data to official NSC1 template AcroForm fields
      const fields: Record<string, string> = {
        // P.1: Company info
        'fill_1_P.1': formData.brNumber,
        'fill_2_P.1': formData.companyName,
        // P.1: Allotment date
        'fill_8_P.1': formData.allotmentDay,
        'fill_9_P.1': formData.allotmentMonth,
        'fill_10_P.1': formData.allotmentYear,
        // P.1: First allotment details
        'fill_11_P.1': allotments[0]?.class || '',
        'fill_12_P.1': allotments[0]?.currency || 'HKD',
        // P.2: Shares info
        'fill_1_P.2': allotments[0]?.numberOfShares || '',
        'fill_2_P.2': allotments[0]?.amountPaid || '',
        'fill_3_P.2': allotments[0]?.amountPaid || '',
        'fill_7_P.2': allotments[0]?.allotteeName || '',
        // P.7: Presentor & signature
        'fill_14_P.7': formData.presentorName || '',
        'fill_15_P.7': formData.presentorContact || '',
        'fill_23_P.7': formData.presentorName || '',
        'fill_24_P.7': formData.allotmentDay,
        'fill_25_P.7': formData.allotmentMonth,
        'fill_26_P.7': formData.allotmentYear,
      };
      const checkboxes: string[] = ['cb_1_P.1', 'cb_1_P.7'];

      const resp = await fetch(`/api/generate-template-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ template: 'NSC1-template.pdf', fields, checkboxes }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NSC1-form.pdf');
      toast({ title: '生成成功', description: 'NSC1 表格已下載' });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NSC1 — 股份配發申報書</h1><p className="text-sm text-muted-foreground">Return of Allotment</p></div>
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

        <div><h3 className="font-semibold mb-3">分配日期</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>日 (DD)</Label><Input value={formData.allotmentDay} onChange={e => update('allotmentDay', e.target.value)} className="mt-1" /></div>
            <div><Label>月 (MM)</Label><Input value={formData.allotmentMonth} onChange={e => update('allotmentMonth', e.target.value)} className="mt-1" /></div>
            <div><Label>年 (YYYY)</Label><Input value={formData.allotmentYear} onChange={e => update('allotmentYear', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">股份分配詳情</h3>
            <Button variant="outline" size="sm" onClick={addAllotment}><Plus className="h-4 w-4 mr-1" />新增</Button>
          </div>
          {allotments.map((a, i) => (
            <div key={i} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3"><span className="font-medium text-sm">項目 #{i + 1}</span>
                {allotments.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeAllotment(i)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>股份類別</Label>
                  <Select value={a.class} onValueChange={v => updateAllotment(i, 'class', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="普通股 Ordinary">普通股 Ordinary</SelectItem><SelectItem value="優先股 Preference">優先股 Preference</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>貨幣</Label>
                  <Select value={a.currency} onValueChange={v => updateAllotment(i, 'currency', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="HKD">HKD</SelectItem><SelectItem value="USD">USD</SelectItem><SelectItem value="CNY">CNY</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>股份數目</Label><Input value={a.numberOfShares} onChange={e => updateAllotment(i, 'numberOfShares', e.target.value)} className="mt-1" /></div>
                <div><Label>每股已繳金額</Label><Input value={a.amountPaid} onChange={e => updateAllotment(i, 'amountPaid', e.target.value)} className="mt-1" /></div>
                <div className="col-span-2"><Label>獲分配人名稱</Label><Input value={a.allotteeName} onChange={e => updateAllotment(i, 'allotteeName', e.target.value)} className="mt-1" /></div>
              </div>
            </div>
          ))}
        </div>

        <div><h3 className="font-semibold mb-3">提交人資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>姓名／名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>電話 / 傳真 / 電郵</Label><Input value={formData.presentorContact} onChange={e => update('presentorContact', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NSC1 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
