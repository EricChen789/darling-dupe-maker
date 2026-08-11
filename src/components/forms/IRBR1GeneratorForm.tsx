import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2, AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';

interface IRBR1GeneratorFormProps {
  onBack: () => void;
  initialCompanyId?: string;
}

export default function IRBR1GeneratorForm({ onBack, initialCompanyId }: IRBR1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );
  const [generating, setGenerating] = useState(false);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const [formData, setFormData] = useState({
    brNumber: '',
    companyName: '',
  });
  const [irbr1Yes, setIrbr1Yes] = useState(true);

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData({
        brNumber: (company as any).brNumber || '',
        companyName: company.name,
      });
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  const handleLoadHistory = (data: any) => {
    if (data.formData) {
      if (data.formData.brNumber) setFormData((prev: any) => ({ ...prev, brNumber: data.formData.brNumber }));
      if (data.formData.companyName) setFormData((prev: any) => ({ ...prev, companyName: data.formData.companyName }));
    }
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
    if (data.irbr1Yes !== undefined) setIrbr1Yes(data.irbr1Yes);
  };

  const handleGenerate = async (debug = false) => {
    if (!formData.brNumber) {
      toast({ title: '錯誤', description: '請填寫商業登記號碼', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const resp = await fetch(`/api/generate-irbr1-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ irbr1_yes: irbr1Yes, brNumber: formData.brNumber, debug }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      downloadBase64Pdf(result.pdf, 'IRBR1-form.pdf');
      toast({ title: '生成成功', description: 'IRBR1 表格已下載' });
      saveFormHistory({ formType: 'IRBR1', formData: { formData, irbr1Yes, selectedCompanyId } });
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
          <h1 className="text-2xl font-bold">IRBR1 — 致商業登記署通知書（本地公司）</h1>
          <p className="text-sm text-muted-foreground">Notice to Business Registration Office — Local Company</p>
        </div>
      </div>

      <FormHistorySelector formType="IRBR1" onSelect={handleLoadHistory} />

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
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => setFormData(prev => ({ ...prev, brNumber: e.target.value }))} className="mt-1" /></div>
            <div><Label>公司名稱</Label><Input value={formData.companyName} onChange={e => setFormData(prev => ({ ...prev, companyName: e.target.value }))} className="mt-1" /></div>
          </div>
        </div>

        {/* IRBR1 specific — 是否申請公司註冊 */}
        <div>
          <h3 className="font-semibold mb-3">通知事項</h3>
          <div className="space-y-3">
            <Label className="text-sm">是否申請公司註冊？</Label>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="irbr1-yesno"
                  checked={irbr1Yes}
                  onChange={() => setIrbr1Yes(true)}
                  className="h-4 w-4"
                />
                <span>是 Yes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="irbr1-yesno"
                  checked={!irbr1Yes}
                  onChange={() => setIrbr1Yes(false)}
                  className="h-4 w-4"
                />
                <span>否 No</span>
              </label>
            </div>
          </div>

          {!irbr1Yes && (
            <div className="flex items-start gap-2 mt-3 p-3 rounded bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              若選擇「否」代表不申請公司註冊但仍需通知商業登記署。
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={() => handleGenerate(false)} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 IRBR1 PDF</>}
          </Button>
          <Button variant="outline" onClick={() => handleGenerate(true)} disabled={generating}>
            生成測試 PDF（Debug）
          </Button>
        </div>
      </div>
    </div>
  );
}
