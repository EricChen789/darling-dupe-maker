import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { Person } from '@/types';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

interface NN7GeneratorFormProps {
  onBack: () => void;
  prefillPerson?: Person | null;
}

export default function NN7GeneratorForm({ onBack, prefillPerson }: NN7GeneratorFormProps) {
  const { data: allCompanies = [] } = useCompanies();

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
    // 現有資料
    nameEnglish: prefillPerson?.nameEnglish || '',
    nameChinese: prefillPerson?.nameChinese || '',
    idNumber: prefillPerson?.idNumber || '',
    address: prefillPerson?.address || '',
    // 變更類型
    changeType: 'address' as 'address' | 'name' | 'id' | 'other',
    // 新資料
    newNameEnglish: '',
    newNameChinese: '',
    newIdNumber: '',
    newAddress: '',
    changeDescription: '',
    effectiveDate: todayStr,
    // 簽署及提交
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

  const handleGenerate = async () => {
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
      const token = localStorage.getItem("secretary_jwt") || "";
      const resp = await fetch(`/api/generate-nn7-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formData),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      downloadBase64Pdf(result.pdf, `NN7-${formData.companyName || 'form'}.pdf`);
      toast({ title: '生成成功', description: 'NN7 表格已下載' });
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
          <h1 className="text-2xl font-bold">NN7 — 註冊非香港公司更改公司秘書及董事詳情申報表</h1>
          <p className="text-sm text-muted-foreground">Return of Change of Particulars of Company Secretary and Director of a Registered Non-Hong Kong Company</p>
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

        {/* Person info */}
        <div>
          <h3 className="font-semibold mb-3">董事/秘書現有資料</h3>
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
            <div className="col-span-2"><Label>現有住址</Label><Input value={formData.address} onChange={e => update('address', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Change details */}
        <div>
          <h3 className="font-semibold mb-3">變更詳情</h3>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label>變更類型</Label>
              <Select value={formData.changeType} onValueChange={v => update('changeType', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="address">住址更改 Change of Address</SelectItem>
                  <SelectItem value="name">姓名更改 Change of Name</SelectItem>
                  <SelectItem value="id">證件號碼更改 Change of ID Number</SelectItem>
                  <SelectItem value="other">其他詳情更改 Other Change of Particulars</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.changeType === 'address' && (
              <div><Label>新住址 *</Label><Input value={formData.newAddress} onChange={e => update('newAddress', e.target.value)} className="mt-1" placeholder="填入更改後的新住址" /></div>
            )}

            {formData.changeType === 'name' && (
              <div className="grid grid-cols-2 gap-4">
                <div><Label>新英文姓名 *</Label><Input value={formData.newNameEnglish} onChange={e => update('newNameEnglish', e.target.value)} className="mt-1" placeholder="更改後的英文姓名" /></div>
                <div><Label>新中文姓名</Label><Input value={formData.newNameChinese} onChange={e => update('newNameChinese', e.target.value)} className="mt-1" placeholder="更改後的中文姓名" /></div>
              </div>
            )}

            {formData.changeType === 'id' && (
              <div><Label>新證件號碼 *</Label><Input value={formData.newIdNumber} onChange={e => update('newIdNumber', e.target.value)} className="mt-1" placeholder="填入新證件號碼" /></div>
            )}

            {formData.changeType === 'other' && (
              <div><Label>變更說明 *</Label><Input value={formData.changeDescription} onChange={e => update('changeDescription', e.target.value)} className="mt-1" placeholder="描述需要更改的詳情內容" /></div>
            )}

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
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN7 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
