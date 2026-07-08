import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

interface NN9GeneratorFormProps { onBack: () => void; }

export default function NN9GeneratorForm({ onBack }: NN9GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '', companyName: '',
    flat: '', building: '', street: '', district: '', region: '香港 Hong Kong',
    changeDay: dd, changeMonth: mm, changeYear: yyyy,
    resolutionDay: dd, resolutionMonth: mm, resolutionYear: yyyy,
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

  const update = (f: string, v: string) => setFormData(prev => ({ ...prev, [f]: v }));

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    if (!formData.flat && !formData.building && !formData.street) { toast({ title: '錯誤', description: '請填寫新地址', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const fields: Record<string, string> = {
        'fill_1_P.1': formData.brNumber,
        'fill_2_P.1': formData.companyName,
        'fill_3_P.1': formData.flat || '',
        'fill_4_P.1': formData.building || '',
        'fill_5_P.1': formData.street || '',
        'fill_6_P.1': formData.district || '',
        'fill_7_P.1': formData.region || '',
        'fill_8_P.1': formData.changeDay,
        'fill_9_P.1': formData.changeMonth,
        'fill_10_P.1': formData.changeYear,
        'fill_11_P.1': formData.resolutionDay,
        'fill_12_P.1': formData.resolutionMonth,
        'fill_13_P.1': formData.resolutionYear,
        'fill_14_P.1': formData.signerName || '',
        'fill_15_P.1': formData.signerCapacity || '',
        'fill_16_P.1': formData.signDateDay,
        'fill_17_P.1': formData.signDateMonth,
        'fill_18_P.1': formData.signDateYear,
        'fill_19_P.1': formData.presentorName || '',
        'fill_20_P.1': formData.presentorContact || '',
      };
      const resp = await fetch(`/api/generate-template-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ template: 'NN9-template.pdf', fields }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NN9-form.pdf');
      toast({ title: '生成成功', description: 'NN9 表格已下載' });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NN9 — 註冊非香港公司更改地址申報表</h1><p className="text-sm text-muted-foreground">Return of Change of Address of a Registered Non-Hong Kong Company</p></div>
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

        <div><h3 className="font-semibold mb-3">新地址</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>室／樓／座</Label><Input value={formData.flat} onChange={e => update('flat', e.target.value)} placeholder="e.g. Room 1001, 10/F" className="mt-1" /></div>
            <div><Label>大廈</Label><Input value={formData.building} onChange={e => update('building', e.target.value)} placeholder="e.g. ABC Building" className="mt-1" /></div>
            <div><Label>街道／屋苑／地段</Label><Input value={formData.street} onChange={e => update('street', e.target.value)} placeholder="e.g. 1 Queensway" className="mt-1" /></div>
            <div><Label>區</Label><Input value={formData.district} onChange={e => update('district', e.target.value)} placeholder="e.g. Admiralty" className="mt-1" /></div>
            <div><Label>地區</Label>
              <Select value={formData.region} onValueChange={v => update('region', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="香港 Hong Kong">香港 Hong Kong</SelectItem><SelectItem value="九龍 Kowloon">九龍 Kowloon</SelectItem><SelectItem value="新界 New Territories">新界 New Territories</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">更改生效日期</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>日 (DD)</Label><Input value={formData.changeDay} onChange={e => update('changeDay', e.target.value)} className="mt-1" /></div>
            <div><Label>月 (MM)</Label><Input value={formData.changeMonth} onChange={e => update('changeMonth', e.target.value)} className="mt-1" /></div>
            <div><Label>年 (YYYY)</Label><Input value={formData.changeYear} onChange={e => update('changeYear', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">決議日期</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>日 (DD)</Label><Input value={formData.resolutionDay} onChange={e => update('resolutionDay', e.target.value)} className="mt-1" /></div>
            <div><Label>月 (MM)</Label><Input value={formData.resolutionMonth} onChange={e => update('resolutionMonth', e.target.value)} className="mt-1" /></div>
            <div><Label>年 (YYYY)</Label><Input value={formData.resolutionYear} onChange={e => update('resolutionYear', e.target.value)} className="mt-1" /></div>
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
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN9 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
