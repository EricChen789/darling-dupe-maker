import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import type { Presenter } from '@/hooks/usePresenters';

interface NSC1GeneratorFormProps { onBack: () => void; initialCompanyId?: string; }

interface ShareAllotment {
  class: string; currency: string; numberOfShares: string;
  amountPaid: string; amountUnpaid: string; allotteeName: string;
}

export default function NSC1GeneratorForm({ onBack, initialCompanyId }: NSC1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '', companyName: '',
    allotmentFromDay: dd, allotmentFromMonth: mm, allotmentFromYear: yyyy,
    allotmentToDay: dd, allotmentToMonth: mm, allotmentToYear: yyyy,
    presentorName: '', presentorAddress: '', presentorTel: '', presentorFax: '',
    presentorEmail: '', presentorReference: '',
    signDay: dd, signMonth: mm, signYear: yyyy,
  });

  const [allotments, setAllotments] = useState<ShareAllotment[]>([
    { class: '普通股 Ordinary', currency: 'HKD', numberOfShares: '', amountPaid: '', amountUnpaid: '', allotteeName: '' },
  ]);

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({
        ...prev,
        brNumber: company.brNumber || '',
        companyName: company.name || '',
        presentorName: company.name || '',
        presentorAddress: [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion].filter(Boolean).join(', '),
        presentorTel: company.phone || '',
        presentorEmail: company.email || '',
        presentorFax: company.fax || '',
        presentorReference: '',
      }));
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
  }, [initialCompanyId, companies.length]);

  const update = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }));
  const updateAllotment = (i: number, f: keyof ShareAllotment, v: string) =>
    setAllotments(prev => prev.map((a, idx) => idx === i ? { ...a, [f]: v } : a));
  const addAllotment = () =>
    setAllotments(prev => [...prev, { class: '普通股 Ordinary', currency: 'HKD', numberOfShares: '', amountPaid: '', amountUnpaid: '', allotteeName: '' }]);
  const removeAllotment = (i: number) =>
    setAllotments(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  // Auto-calculate totals
  const totals = allotments.reduce((acc, a) => {
    const shares = parseFloat(a.numberOfShares) || 0;
    const paid = parseFloat(a.amountPaid) || 0;
    const unpaid = parseFloat(a.amountUnpaid) || 0;
    return {
      totalShares: acc.totalShares + shares,
      totalPaid: acc.totalPaid + paid * shares,
      totalUnpaid: acc.totalUnpaid + unpaid * shares,
      currency: a.currency || acc.currency,
    };
  }, { totalShares: 0, totalPaid: 0, totalUnpaid: 0, currency: 'HKD' });

  const handleLoadHistory = (data: any) => {
    if (data.formData) setFormData((prev: any) => ({ ...prev, ...data.formData }));
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
  };

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) {
      toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const a = allotments; // shorthand

      const fields: Record<string, string> = {
        // ── P.1: Company info ──
        'fill_1_P.1': formData.brNumber,
        'fill_2_P.1': formData.companyName,

        // ── P.1: Allotment period "From" (fill_3/4/5 = D/M/Y) ──
        'fill_3_P.1': formData.allotmentFromDay,
        'fill_4_P.1': formData.allotmentFromMonth,
        'fill_5_P.1': formData.allotmentFromYear,

        // ── P.1: Allotment period "To" (fill_6/7/8 = D/M/Y) ──
        'fill_6_P.1': formData.allotmentToDay,
        'fill_7_P.1': formData.allotmentToMonth,
        'fill_8_P.1': formData.allotmentToYear,

        // ── P.1: Totals of this Allotment ──
        'fill_9_P.1': totals.currency,
        'fill_10_P.1': totals.totalPaid ? `$${totals.totalPaid.toLocaleString()}` : '',

        // ── P.1: Share detail table (Section A, 3 rows) ──
        // Row 1 (fill_15-19): Class, Currency, Number, Paid, Unpaid
        'fill_15_P.1': a[0]?.class || '',
        'fill_16_P.1': a[0]?.currency || '',
        'fill_17_P.1': a[0]?.numberOfShares || '',
        'fill_18_P.1': a[0]?.amountPaid || '',
        'fill_19_P.1': a[0]?.amountUnpaid || '',
        // Row 2 (fill_20-24)
        'fill_20_P.1': a[1]?.class || '',
        'fill_21_P.1': a[1]?.currency || '',
        'fill_22_P.1': a[1]?.numberOfShares || '',
        'fill_23_P.1': a[1]?.amountPaid || '',
        'fill_24_P.1': a[1]?.amountUnpaid || '',
        // Row 3 (fill_25-29)
        'fill_25_P.1': a[2]?.class || '',
        'fill_26_P.1': a[2]?.currency || '',
        'fill_27_P.1': a[2]?.numberOfShares || '',
        'fill_28_P.1': a[2]?.amountPaid || '',
        'fill_29_P.1': a[2]?.amountUnpaid || '',

        // ── P.2: Continuation sheet — BR only (rest mapped via P.1) ──
        'fill_1_P.2': formData.brNumber,

        // ── P.3-6: BR only ──
        'fill_1_P.3': formData.brNumber,
        'fill_1_P.4': formData.brNumber,
        'fill_1_P.5': formData.brNumber,
        'fill_1_P.6': formData.brNumber,

        // ── P.1 bottom: Presentor info ──
        'fill_30_P.1': formData.presentorName || '',
        'fill_31_P.1': formData.presentorAddress || '',
        'fill_32_P.1': formData.presentorTel || '',
        'fill_33_P.1': formData.presentorFax || '',
        'fill_34_P.1': formData.presentorEmail || '',
        'fill_35_P.1': formData.presentorReference || '',

        // ── P.3: Signature section ──
        'fill_27_P.3': formData.presentorName || '',

        // ── P.7: Schedule 2 — Allottee Details (NOT presentor!) ──
        'fill_1_P.7': formData.brNumber,
        // Allottee #1
        'fill_4_P.7': a[0]?.allotteeName || '',
        'fill_13_P.7': a[0]?.numberOfShares || '',
        // Allottee #2 (if present)
        'fill_15_P.7': a[1]?.allotteeName || '',
        'fill_24_P.7': a[1]?.numberOfShares || '',

        // ── P.8-10: BR on every page ──
        'fill_1_P.8': formData.brNumber,
        'fill_1_P.9': formData.brNumber,
        'fill_1_P.10': formData.brNumber,
      };

      const checkboxes: string[] = [
        'cb_1_P.1',   // Share capital IS increased
        'cb_1_P.7',   // Declaration checkbox
      ];

      const overlays: Array<{page: number; text: string; x: number; y: number; fontsize: number}> = [
        // P.3 signature date (index 2) — no AcroForm widgets at "Date:" position (y≈771)
        { page: 2, text: `${formData.signDay} / ${formData.signMonth} / ${formData.signYear}`, x: 395, y: 768, fontsize: 10 },
      ];

      const resp = await fetch(`/api/generate-template-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ template: 'NSC1-template.pdf', fields, checkboxes, brNumber: formData.brNumber, overlays, fieldMinFontSize: { 'fill_31_P.1': 10 } }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, `NSC1_股份配發申報書_${formData.companyName}.pdf`);
      toast({ title: '生成成功', description: 'NSC1 表格已下載' });
      saveFormHistory({ formType: 'NSC1', formData: { formData, selectedCompanyId } });
    } catch (err: any) {
      toast({ title: '生成失敗', description: err.message, variant: 'destructive' });
    } finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div>
          <h1 className="text-2xl font-bold">NSC1 — 股份配發申報書</h1>
          <p className="text-sm text-muted-foreground">Return of Allotment</p>
        </div>
      </div>

      <FormHistorySelector formType="NSC1" onSelect={handleLoadHistory} />

      {/* ── Company Selector ── */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="h-4 w-4 text-primary" />
          <Label className="font-medium">選擇公司自動填入（BR、公司名、提交人資料）</Label>
        </div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
          <SelectContent>
            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.brNumber})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* ── Company Info ── */}
        <div>
          <h3 className="font-semibold mb-3">公司資料（P.1）</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── Allotment Period ── */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-3">分配期間 — 由 (From)</h3>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>日 (DD)</Label><Input value={formData.allotmentFromDay} onChange={e => update('allotmentFromDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月 (MM)</Label><Input value={formData.allotmentFromMonth} onChange={e => update('allotmentFromMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年 (YYYY)</Label><Input value={formData.allotmentFromYear} onChange={e => update('allotmentFromYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
          <div>
            <h3 className="font-semibold mb-3">分配期間 — 至 (To)</h3>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>日 (DD)</Label><Input value={formData.allotmentToDay} onChange={e => update('allotmentToDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月 (MM)</Label><Input value={formData.allotmentToMonth} onChange={e => update('allotmentToMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年 (YYYY)</Label><Input value={formData.allotmentToYear} onChange={e => update('allotmentToYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        {/* ── Totals (auto-calculated) ── */}
        <div>
          <h3 className="font-semibold mb-2">是次分配總額（自動計算）</h3>
          <div className="grid grid-cols-4 gap-3 p-3 bg-muted/40 rounded-lg text-sm">
            <div><span className="text-muted-foreground">貨幣：</span><strong>{totals.currency}</strong></div>
            <div><span className="text-muted-foreground">總股數：</span><strong>{totals.totalShares.toLocaleString()}</strong></div>
            <div><span className="text-muted-foreground">已繳總額：</span><strong>${totals.totalPaid.toLocaleString()}</strong></div>
            <div><span className="text-muted-foreground">未繳總額：</span><strong>${totals.totalUnpaid.toLocaleString()}</strong></div>
          </div>
        </div>

        {/* ── Share Allotments ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">股份分配詳情（P.1 Section A + P.2 續頁）</h3>
            <Button variant="outline" size="sm" onClick={addAllotment}><Plus className="h-4 w-4 mr-1" />新增</Button>
          </div>
          {allotments.map((a, i) => (
            <div key={i} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">
                  項目 #{i + 1}{i < 3 ? ` → P.1 Row ${i + 1} / P.2 Row ${i + 1}` : ` → P.2+ 續頁`}
                </span>
                {allotments.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeAllotment(i)} className="text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>股份類別</Label>
                  <Select value={a.class} onValueChange={v => updateAllotment(i, 'class', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="普通股 Ordinary">普通股 Ordinary</SelectItem>
                      <SelectItem value="優先股 Preference">優先股 Preference</SelectItem>
                      <SelectItem value="A股 Class A">A股 Class A</SelectItem>
                      <SelectItem value="B股 Class B">B股 Class B</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>貨幣</Label>
                  <Select value={a.currency} onValueChange={v => updateAllotment(i, 'currency', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HKD">HKD</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="CNY">CNY</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>股份數目</Label><Input placeholder="例如：10,000" value={a.numberOfShares} onChange={e => updateAllotment(i, 'numberOfShares', e.target.value)} className="mt-1" /></div>
                <div><Label>每股已繳金額</Label><Input placeholder="例如：1.00" value={a.amountPaid} onChange={e => updateAllotment(i, 'amountPaid', e.target.value)} className="mt-1" /></div>
                <div><Label>每股未繳金額</Label><Input placeholder="例如：0.00" value={a.amountUnpaid} onChange={e => updateAllotment(i, 'amountUnpaid', e.target.value)} className="mt-1" /></div>
                <div><Label>獲分配人名稱</Label><Input placeholder="例如：CHAN Tai Man" value={a.allotteeName} onChange={e => updateAllotment(i, 'allotteeName', e.target.value)} className="mt-1" /></div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Sign Date ── */}
        <div>
          <h3 className="font-semibold mb-3">簽署日期（P.3 + P.7）</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>日 (DD)</Label><Input value={formData.signDay} onChange={e => update('signDay', e.target.value)} className="mt-1" /></div>
            <div><Label>月 (MM)</Label><Input value={formData.signMonth} onChange={e => update('signMonth', e.target.value)} className="mt-1" /></div>
            <div><Label>年 (YYYY)</Label><Input value={formData.signYear} onChange={e => update('signYear', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── Presentor ── */}
        <div>
          <h3 className="font-semibold mb-3">提交人資料（P.1 底部 + P.3 簽署）</h3>
          <PresenterSelector companyId={selectedCompanyId}
            currentData={{ name: formData.presentorName, address: formData.presentorAddress, phone: formData.presentorTel, fax: formData.presentorFax, email: formData.presentorEmail, reference: formData.presentorReference }}
            onSelect={(p: Presenter) => {
              update('presentorName', p.name);
              update('presentorAddress', p.address);
              update('presentorTel', p.phone);
              update('presentorFax', p.fax);
              update('presentorEmail', p.email);
              update('presentorReference', p.reference);
            }}
          />
          <div className="grid grid-cols-2 gap-4">
            <div><Label>姓名／名稱 *</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>參考編號（檔號）</Label><Input value={formData.presentorReference} onChange={e => update('presentorReference', e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div><Label>電話</Label><Input value={formData.presentorTel} onChange={e => update('presentorTel', e.target.value)} className="mt-1" /></div>
            <div><Label>傳真</Label><Input value={formData.presentorFax} onChange={e => update('presentorFax', e.target.value)} className="mt-1" /></div>
            <div><Label>電郵</Label><Input value={formData.presentorEmail} onChange={e => update('presentorEmail', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── Generate ── */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NSC1 PDF</>}
          </Button>
          <span className="text-xs text-muted-foreground">
            涵蓋 P.1-P.14，自動填入公司、股份、獲分配人、提交人資料
          </span>
        </div>
      </div>
    </div>
  );
}
