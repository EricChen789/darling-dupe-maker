import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import AddressQuickPick from './AddressQuickPick';
import type { Presenter } from '@/hooks/usePresenters';

interface IRBR2GeneratorFormProps {
  onBack: () => void;
  initialCompanyId?: string;
}

export default function IRBR2GeneratorForm({ onBack, initialCompanyId }: IRBR2GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );
  const [generating, setGenerating] = useState(false);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '',
    companyName: '',
    businessNameChinese: '',
    businessNameEnglish: '',
    businessNature: '',
    commencementDay: dd,
    commencementMonth: mm,
    commencementYear: yyyy,
    presentorName: '',
    presentorAddress: '',
    presentorContact: '',
  });
  const [irbr2Registered, setIrbr2Registered] = useState(true);
  const [irbr2Elect3yr, setIrbr2Elect3yr] = useState(true);

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      const regAddress = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
        .filter(Boolean).join(', ');
      setFormData(prev => ({
        ...prev,
        brNumber: (company as any).brNumber || '',
        companyName: company.name,
        businessNameChinese: (company as any).chineseName || '',
        businessNameEnglish: company.name || '',
        businessNature: (company as any).businessNature || '',
        presentorName: company.name,
        presentorAddress: regAddress,
      }));
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  const update = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleLoadHistory = (data: any) => {
    if (data.formData) setFormData((prev: any) => ({ ...prev, ...data.formData }));
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
    if (data.irbr2Registered !== undefined) setIrbr2Registered(data.irbr2Registered);
    if (data.irbr2Elect3yr !== undefined) setIrbr2Elect3yr(data.irbr2Elect3yr);
  };

  const handleGenerate = async (debug = false) => {
    if (!formData.brNumber) {
      toast({ title: '錯誤', description: '請填寫商業登記號碼', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const body = {
        brNumber: formData.brNumber,
        businessNameChinese: formData.businessNameChinese,
        businessNameEnglish: formData.businessNameEnglish,
        businessNature: formData.businessNature,
        commencementDate: `${formData.commencementDay}/${formData.commencementMonth}/${formData.commencementYear}`,
        irbr2_registered: irbr2Registered,
        irbr2_elect3yr: irbr2Elect3yr,
        presentorName: formData.presentorName,
        presentorAddress: formData.presentorAddress,
        presentorContact: formData.presentorContact,
        debug,
      };
      const resp = await fetch(`/api/generate-irbr2-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      downloadBase64Pdf(result.pdf, 'IRBR2-form.pdf');
      toast({ title: '生成成功', description: 'IRBR2 表格已下載' });
      saveFormHistory({
        formType: 'IRBR2',
        formData: { formData, irbr2Registered, irbr2Elect3yr, selectedCompanyId },
      });
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
          <h1 className="text-2xl font-bold">IRBR2 — 致商業登記署通知書（非香港公司）</h1>
          <p className="text-sm text-muted-foreground">Notice to Business Registration Office — Non-Hong Kong Company</p>
        </div>
      </div>

      <FormHistorySelector formType="IRBR2" onSelect={handleLoadHistory} />

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
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Business details */}
        <div>
          <h3 className="font-semibold mb-3">業務詳情</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>業務名稱（中文）</Label><Input value={formData.businessNameChinese} onChange={e => update('businessNameChinese', e.target.value)} className="mt-1" /></div>
            <div><Label>業務名稱（英文）</Label><Input value={formData.businessNameEnglish} onChange={e => update('businessNameEnglish', e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>業務性質描述</Label><Textarea rows={3} value={formData.businessNature} onChange={e => update('businessNature', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Commencement date */}
        <div>
          <h3 className="font-semibold mb-3">開業日期</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-md">
            <div><Label>日 (DD)</Label><Input value={formData.commencementDay} onChange={e => update('commencementDay', e.target.value)} className="mt-1" /></div>
            <div><Label>月 (MM)</Label><Input value={formData.commencementMonth} onChange={e => update('commencementMonth', e.target.value)} className="mt-1" /></div>
            <div><Label>年 (YYYY)</Label><Input value={formData.commencementYear} onChange={e => update('commencementYear', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Notification questions */}
        <div>
          <h3 className="font-semibold mb-3">通知事項</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">是否已根據《商業登記條例》(第310章)登記？</Label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="irbr2-reg310" checked={irbr2Registered} onChange={() => setIrbr2Registered(true)} className="h-4 w-4" />
                  <span>是 Yes</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="irbr2-reg310" checked={!irbr2Registered} onChange={() => setIrbr2Registered(false)} className="h-4 w-4" />
                  <span>否 No</span>
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">是否選擇3年有效期商業登記證？</Label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="irbr2-3yr" checked={irbr2Elect3yr} onChange={() => setIrbr2Elect3yr(true)} className="h-4 w-4" />
                  <span>是 Yes</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="irbr2-3yr" checked={!irbr2Elect3yr} onChange={() => setIrbr2Elect3yr(false)} className="h-4 w-4" />
                  <span>否 No</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Presenter */}
        <div>
          <h3 className="font-semibold mb-3">提交人資料</h3>
          {selectedCompanyId && (
            <div className="mb-3">
              <AddressQuickPick companyId={selectedCompanyId}
                onPick={(d) => {
                  if (d._raw || d.flat) update('presentorAddress', d._raw || [d.flat, d.building, d.street, d.district, d.country || d.region].filter(Boolean).join(', '));
                }}
              />
            </div>
          )}
          <PresenterSelector companyId={selectedCompanyId}
            currentData={{ name: formData.presentorName, address: formData.presentorAddress, contact: formData.presentorContact }}
            onSelect={(p: Presenter) => {
              update('presentorName', p.name);
              update('presentorAddress', p.address);
              update('presentorContact', [p.phone, p.fax, p.email].filter(Boolean).join(' / '));
            }}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>姓名／名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>電話 / 傳真 / 電郵</Label><Input value={formData.presentorContact} onChange={e => update('presentorContact', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={() => handleGenerate(false)} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 IRBR2 PDF</>}
          </Button>
          <Button variant="outline" onClick={() => handleGenerate(true)} disabled={generating}>
            生成測試 PDF（Debug）
          </Button>
        </div>
      </div>
    </div>
  );
}
