import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import type { Presenter } from '@/hooks/usePresenters';

interface IRC3111AGeneratorFormProps {
  onBack: () => void;
  initialCompanyId?: string;
}

export default function IRC3111AGeneratorForm({ onBack, initialCompanyId }: IRC3111AGeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '',
    companyName: '',
    oldFlat: '',
    oldBuilding: '',
    oldStreet: '',
    oldDistrict: '',
    oldRegion: '',
    newFlat: '',
    newBuilding: '',
    newStreet: '',
    newDistrict: '',
    newRegion: '',
    effectiveDay: dd,
    effectiveMonth: mm,
    effectiveYear: yyyy,
    signerName: '',
    signDateDay: dd,
    signDateMonth: mm,
    signDateYear: yyyy,
    presentorName: '',
    presentorAddress: '',
    presentorContact: '',
  });

  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({
        ...prev,
        brNumber: company.brNumber,
        companyName: company.name,
        oldFlat: company.regFlat || '',
        oldBuilding: company.regBuilding || '',
        oldStreet: company.regStreet || '',
        oldDistrict: company.regDistrict || '',
        oldRegion: company.regRegion || '',
        presentorName: company.name,
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
  };

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    const oldAddr = [formData.oldFlat, formData.oldBuilding, formData.oldStreet, formData.oldDistrict, formData.oldRegion]
      .filter(Boolean).join(', ');
    const newAddr = [formData.newFlat, formData.newBuilding, formData.newStreet, formData.newDistrict, formData.newRegion]
      .filter(Boolean).join(', ');
    if (!newAddr) {
      toast({ title: '錯誤', description: '請填寫新業務地址', variant: 'destructive' });
      return;
    }

    setGenerating(true);
    try {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch('/api/generate-irc3111a-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          companyName: formData.companyName,
          brNumber: formData.brNumber,
          oldAddress: oldAddr,
          newAddress: newAddr,
          changeDate: `${formData.effectiveDay}/${formData.effectiveMonth}/${formData.effectiveYear}`,
          signerName: formData.signerName,
          signDate: `${formData.signDateDay}/${formData.signDateMonth}/${formData.signDateYear}`,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      downloadBase64Pdf(result.pdf, 'IRC3111A-form.pdf');
      toast({ title: '生成成功', description: 'IRC 3111A 表格已下載' });
      saveFormHistory({ formType: 'IRC3111A', formData: { formData, selectedCompanyId } });
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
          <h1 className="text-2xl font-bold">IRC 3111A — 通知更改業務地址（税務局）</h1>
          <p className="text-sm text-muted-foreground">Notification of Change of Business Address (Inland Revenue Department)</p>
        </div>
      </div>

      <FormHistorySelector formType="IRC3111A" onSelect={handleLoadHistory} />

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
          <div className="grid grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Old Address (auto-filled from company) */}
        <div>
          <h3 className="font-semibold mb-3">現有業務地址（舊地址）</h3>
          <p className="text-xs text-muted-foreground mb-2">從公司資料自動填入，可手動修改</p>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>室／樓／座</Label><Input value={formData.oldFlat} onChange={e => update('oldFlat', e.target.value)} placeholder="e.g. Room 1001, 10/F" className="mt-1" /></div>
            <div><Label>大廈</Label><Input value={formData.oldBuilding} onChange={e => update('oldBuilding', e.target.value)} placeholder="e.g. ABC Building" className="mt-1" /></div>
            <div><Label>街道／屋苑／地段</Label><Input value={formData.oldStreet} onChange={e => update('oldStreet', e.target.value)} className="mt-1" /></div>
            <div><Label>區</Label><Input value={formData.oldDistrict} onChange={e => update('oldDistrict', e.target.value)} className="mt-1" /></div>
            <div><Label>國家／地區</Label><Input value={formData.oldRegion} onChange={e => update('oldRegion', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* New Address */}
        <div>
          <h3 className="font-semibold mb-3">新業務地址 *</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>室／樓／座</Label><Input value={formData.newFlat} onChange={e => update('newFlat', e.target.value)} placeholder="e.g. Room 2001, 20/F" className="mt-1" /></div>
            <div><Label>大廈</Label><Input value={formData.newBuilding} onChange={e => update('newBuilding', e.target.value)} placeholder="e.g. XYZ Tower" className="mt-1" /></div>
            <div><Label>街道／屋苑／地段</Label><Input value={formData.newStreet} onChange={e => update('newStreet', e.target.value)} className="mt-1" /></div>
            <div><Label>區</Label><Input value={formData.newDistrict} onChange={e => update('newDistrict', e.target.value)} placeholder="e.g. Central" className="mt-1" /></div>
            <div><Label>國家／地區</Label><Input value={formData.newRegion} onChange={e => update('newRegion', e.target.value)} placeholder="e.g. 香港" className="mt-1" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>生效日 (DD)</Label><Input value={formData.effectiveDay} onChange={e => update('effectiveDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月 (MM)</Label><Input value={formData.effectiveMonth} onChange={e => update('effectiveMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年 (YYYY)</Label><Input value={formData.effectiveYear} onChange={e => update('effectiveYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        {/* Signature */}
        <div>
          <h3 className="font-semibold mb-3">簽署</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>簽署人姓名</Label><Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>日期 (DD)</Label><Input value={formData.signDateDay} onChange={e => update('signDateDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月 (MM)</Label><Input value={formData.signDateMonth} onChange={e => update('signDateMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年 (YYYY)</Label><Input value={formData.signDateYear} onChange={e => update('signDateYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        {/* Presentor */}
        <div>
          <h3 className="font-semibold mb-3">提交人資料</h3>
          <PresenterSelector
            currentData={{ name: formData.presentorName, address: formData.presentorAddress, contact: formData.presentorContact }}
            onSelect={(p: Presenter) => {
              update('presentorName', p.name);
              update('presentorAddress', p.address);
              update('presentorContact', [p.phone, p.fax, p.email].filter(Boolean).join(' / '));
            }}
          />
          <div className="grid grid-cols-2 gap-4">
            <div><Label>姓名／名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>電話 / 傳真 / 電郵</Label><Input value={formData.presentorContact} onChange={e => update('presentorContact', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 IRC 3111A PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
