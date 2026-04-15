import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { Person } from '@/types';

interface ND2BGeneratorFormProps {
  onBack: () => void;
  prefillPerson?: Person | null;
  prefillNewAddress?: string;
}

export default function ND2BGeneratorForm({ onBack, prefillPerson, prefillNewAddress }: ND2BGeneratorFormProps) {
  const { data: allCompanies = [] } = useCompanies();
  
  // If prefillPerson has associated companies, only show those
  const companies = prefillPerson?.companies?.length
    ? allCompanies.filter(c => prefillPerson.companies.some(pc => pc.id === c.id))
    : allCompanies;
  
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [formData, setFormData] = useState({
    brNumber: '',
    companyName: '',
    role: (prefillPerson?.role === 'secretary' ? 'secretary' : 'director') as 'secretary' | 'director',
    identity: (prefillPerson?.identity || 'natural') as 'natural' | 'corporate',
    nameEnglish: prefillPerson?.nameEnglish || '',
    nameChinese: prefillPerson?.nameChinese || '',
    idNumber: prefillPerson?.idNumber || '',
    changeType: 'address' as 'address' | 'name' | 'other',
    previousAddress: prefillPerson?.address || '',
    newAddress: prefillNewAddress || '',
    effectiveDate: todayStr,
    signerName: '',
    signDate: todayStr,
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

  const update = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleGenerate = async (debug = false) => {
    if (!formData.brNumber || !formData.companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    if (!formData.nameEnglish && !formData.nameChinese) {
      toast({ title: '錯誤', description: '請填寫人員姓名', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(`${supabaseUrl}/functions/v1/generate-nd2b-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ ...formData, debug }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      const byteChars = atob(result.pdf);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      URL.revokeObjectURL(url);
      toast({ title: '生成成功', description: 'ND2B 表格已開啟' });
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
          <h1 className="text-2xl font-bold">ND2B — 更改董事及公司秘書詳情通知書</h1>
          <p className="text-sm text-muted-foreground">Notice of Change in Particulars of Company Secretary and Director</p>
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

        {/* Officer info */}
        <div>
          <h3 className="font-semibold mb-3">董事/秘書資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>職位</Label>
              <Select value={formData.role} onValueChange={v => update('role', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="director">董事 Director</SelectItem>
                  <SelectItem value="secretary">公司秘書 Secretary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>身分</Label>
              <Select value={formData.identity} onValueChange={v => update('identity', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">自然人 Natural Person</SelectItem>
                  <SelectItem value="corporate">法人團體 Body Corporate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>英文姓名 *</Label><Input value={formData.nameEnglish} onChange={e => update('nameEnglish', e.target.value)} className="mt-1" /></div>
            <div><Label>中文姓名</Label><Input value={formData.nameChinese} onChange={e => update('nameChinese', e.target.value)} className="mt-1" /></div>
            <div><Label>證件號碼</Label><Input value={formData.idNumber} onChange={e => update('idNumber', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Change details */}
        <div>
          <h3 className="font-semibold mb-3">變更詳情 — 住址更改</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Label>原住址</Label><Input value={formData.previousAddress} onChange={e => update('previousAddress', e.target.value)} className="mt-1" placeholder="填入更改前的住址" /></div>
            <div className="col-span-2"><Label>新住址 *</Label><Input value={formData.newAddress} onChange={e => update('newAddress', e.target.value)} className="mt-1" placeholder="填入更改後的新住址" /></div>
            <div><Label>生效日期</Label><Input type="date" value={formData.effectiveDate} onChange={e => update('effectiveDate', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Signature & Presentor */}
        <div>
          <h3 className="font-semibold mb-3">簽署及提交人</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>簽署人姓名</Label><Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1" /></div>
            <div><Label>簽署日期</Label><Input type="date" value={formData.signDate} onChange={e => update('signDate', e.target.value)} className="mt-1" /></div>
            <div><Label>提交人名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>提交人地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>電話/傳真/電郵</Label><Input value={formData.presentorContact} onChange={e => update('presentorContact', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={() => handleGenerate(false)} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 ND2B PDF</>}
          </Button>
          <Button variant="outline" onClick={() => handleGenerate(true)} disabled={generating}>生成測試 PDF（Debug）</Button>
        </div>
      </div>
    </div>
  );
}
