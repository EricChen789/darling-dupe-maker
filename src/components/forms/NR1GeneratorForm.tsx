import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { Company } from '@/types';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

interface NR1GeneratorFormProps {
  onBack: () => void;
  initialCompanyId?: string;
}

export default function NR1GeneratorForm({ onBack, initialCompanyId }: NR1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '',
    companyName: '',
    flat: '',
    building: '',
    street: '',
    district: '',
    region: '香港 Hong Kong',
    addressEffectiveDay: dd,
    addressEffectiveMonth: mm,
    addressEffectiveYear: yyyy,
    email: '',
    emailEffectiveDay: dd,
    emailEffectiveMonth: mm,
    emailEffectiveYear: yyyy,
    phone: '',
    phoneEffectiveDay: dd,
    phoneEffectiveMonth: mm,
    phoneEffectiveYear: yyyy,
    signerName: '',
    signDateDay: dd,
    signDateMonth: mm,
    signDateYear: yyyy,
    presentorName: '',
    presentorAddress: '',
    presentorContact: '',
  });

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({
        ...prev,
        brNumber: company.brNumber,
        companyName: company.name,
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

  const handleGenerate = async (debug = false) => {
    if (!formData.brNumber || !formData.companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const resp = await fetch(`/api/generate-nr1-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...formData, debug }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      downloadBase64Pdf(result.pdf, 'NR1-form.pdf');
      toast({ title: '生成成功', description: 'NR1 表格已下載' });
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
          <h1 className="text-2xl font-bold">NR1 — 註冊辦事處地址變更通知書</h1>
          <p className="text-sm text-muted-foreground">Notice of Change of Address of Registered Office</p>
        </div>
      </div>

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

        {/* New address */}
        <div>
          <h3 className="font-semibold mb-3">2(a) 新註冊辦事處地址</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>室／樓／座</Label><Input value={formData.flat} onChange={e => update('flat', e.target.value)} placeholder="e.g. Room 1001, 10/F" className="mt-1" /></div>
            <div><Label>大廈</Label><Input value={formData.building} onChange={e => update('building', e.target.value)} placeholder="e.g. ABC Building" className="mt-1" /></div>
            <div><Label>街道／屋苑／地段</Label><Input value={formData.street} onChange={e => update('street', e.target.value)} placeholder="e.g. 1 Queensway" className="mt-1" /></div>
            <div><Label>區</Label><Input value={formData.district} onChange={e => update('district', e.target.value)} placeholder="e.g. Admiralty" className="mt-1" /></div>
            <div>
              <Label>地區</Label>
              <Select value={formData.region} onValueChange={v => update('region', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="香港 Hong Kong">香港 Hong Kong</SelectItem>
                  <SelectItem value="九龍 Kowloon">九龍 Kowloon</SelectItem>
                  <SelectItem value="新界 New Territories">新界 New Territories</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>生效日 (DD)</Label><Input value={formData.addressEffectiveDay} onChange={e => update('addressEffectiveDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月 (MM)</Label><Input value={formData.addressEffectiveMonth} onChange={e => update('addressEffectiveMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年 (YYYY)</Label><Input value={formData.addressEffectiveYear} onChange={e => update('addressEffectiveYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        {/* Email */}
        <div>
          <h3 className="font-semibold mb-3">2(b) 新電郵地址（如適用）</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>電郵地址</Label><Input value={formData.email} onChange={e => update('email', e.target.value)} className="mt-1" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>生效日</Label><Input value={formData.emailEffectiveDay} onChange={e => update('emailEffectiveDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月</Label><Input value={formData.emailEffectiveMonth} onChange={e => update('emailEffectiveMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年</Label><Input value={formData.emailEffectiveYear} onChange={e => update('emailEffectiveYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        {/* Phone */}
        <div>
          <h3 className="font-semibold mb-3">2(c) 新聯絡電話號碼（如適用）</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>電話號碼</Label><Input value={formData.phone} onChange={e => update('phone', e.target.value)} placeholder="+852 xxxx xxxx" className="mt-1" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>生效日</Label><Input value={formData.phoneEffectiveDay} onChange={e => update('phoneEffectiveDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月</Label><Input value={formData.phoneEffectiveMonth} onChange={e => update('phoneEffectiveMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年</Label><Input value={formData.phoneEffectiveYear} onChange={e => update('phoneEffectiveYear', e.target.value)} className="mt-1" /></div>
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
          <div className="grid grid-cols-2 gap-4">
            <div><Label>姓名／名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>電話 / 傳真 / 電郵</Label><Input value={formData.presentorContact} onChange={e => update('presentorContact', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={() => handleGenerate(false)} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NR1 PDF</>}
          </Button>
          <Button variant="outline" onClick={() => handleGenerate(true)} disabled={generating}>
            生成測試 PDF（Debug）
          </Button>
        </div>
      </div>
    </div>
  );
}
