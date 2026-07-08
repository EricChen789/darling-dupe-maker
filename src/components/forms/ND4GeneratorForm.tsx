import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

interface ND4GeneratorFormProps { onBack: () => void; }

export default function ND4GeneratorForm({ onBack }: ND4GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '', companyName: '',
    officerType: 'director' as 'director' | 'secretary',
    officerNameChinese: '', officerNameEnglish: '',
    identity: 'natural' as 'natural' | 'corporate',
    resignationDay: dd, resignationMonth: mm, resignationYear: yyyy,
    signerName: '', signerCapacity: 'Director',
    signDateDay: dd, signDateMonth: mm, signDateYear: yyyy,
    presentorName: '', presentorContact: '',
  });

  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({
        ...prev, brNumber: company.brNumber, companyName: company.name, presentorName: company.name,
      }));
    }
  };

  const handleOfficerSelect = (type: 'director' | 'secretary', index: number) => {
    const officers = type === 'director' ? selectedCompany?.directors : selectedCompany?.secretaries;
    const officer = officers?.[index];
    if (officer) {
      setFormData(prev => ({
        ...prev, officerType: type,
        officerNameChinese: officer.nameChinese || '',
        officerNameEnglish: officer.nameEnglish || '',
        identity: officer.identity || 'natural',
      }));
    }
  };

  const update = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    if (!formData.officerNameEnglish) { toast({ title: '錯誤', description: '請填寫辭任人英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      // Map form data to official ND4 template AcroForm fields
      const fields: Record<string, string> = {
        'fill_1_P.1': formData.brNumber,
        'fill_2_P.1': formData.companyName,
        'fill_3_P.1': formData.officerNameChinese || '',
        'fill_4_P.1': formData.officerNameEnglish || '',
        'fill_11_P.1': formData.resignationDay,
        'fill_12_P.1': formData.resignationMonth,
        'fill_13_P.1': formData.resignationYear,
        'fill_14_P.1': formData.signerName || '',
        'fill_15_P.1': formData.signerCapacity || '',
        'fill_16_P.1': formData.signDateDay,
        'fill_17_P.1': formData.signDateMonth,
        'fill_18_P.1': formData.signDateYear,
        'fill_19_P.1': formData.presentorName || '',
        'fill_1_P.2': formData.presentorName || '',
      };
      const checkboxes: string[] = [];
      // Officer type checkbox
      if (formData.officerType === 'secretary') checkboxes.push('cb_1_P.1');
      else checkboxes.push('cb_2_P.1');
      // Identity toggle
      if (formData.identity === 'natural') checkboxes.push('toggle_4_P.1');
      else checkboxes.push('toggle_5_P.1');
      // Resignation notice type on P.2
      checkboxes.push('cb_1_P.2');

      const resp = await fetch(`/api/generate-template-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ template: 'ND4-template.pdf', fields, checkboxes }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'ND4-form.pdf');
      toast({ title: '生成成功', description: 'ND4 表格已下載' });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  const directors = selectedCompany?.directors || [];
  const secretaries = selectedCompany?.secretaries || [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">ND4 — 公司秘書及董事辭任通知書</h1><p className="text-sm text-muted-foreground">Notice of Resignation of Company Secretary and Director</p></div>
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

        <div><h3 className="font-semibold mb-3">辭任人</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>身份類別</Label>
              <Select value={formData.officerType} onValueChange={v => update('officerType', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="director">董事 Director</SelectItem><SelectItem value="secretary">公司秘書 Company Secretary</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>自然人/法人</Label>
              <Select value={formData.identity} onValueChange={v => update('identity', v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="natural">自然人 Natural Person</SelectItem><SelectItem value="corporate">法人 Corporate</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          {selectedCompany && (
            <div className="mt-3 grid grid-cols-2 gap-4">
              {formData.officerType === 'director' && directors.length > 0 && (
                <div><Label>從公司董事列表選擇</Label>
                  <Select onValueChange={v => handleOfficerSelect('director', parseInt(v))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="選擇董事..." /></SelectTrigger>
                    <SelectContent>{directors.map((d, i) => <SelectItem key={i} value={String(i)}>{d.nameEnglish || d.nameChinese}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {formData.officerType === 'secretary' && secretaries.length > 0 && (
                <div><Label>從公司秘書列表選擇</Label>
                  <Select onValueChange={v => handleOfficerSelect('secretary', parseInt(v))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="選擇秘書..." /></SelectTrigger>
                    <SelectContent>{secretaries.map((s, i) => <SelectItem key={i} value={String(i)}>{s.nameEnglish || s.nameChinese}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div><Label>中文名稱</Label><Input value={formData.officerNameChinese} onChange={e => update('officerNameChinese', e.target.value)} className="mt-1" /></div>
            <div><Label>英文名稱 *</Label><Input value={formData.officerNameEnglish} onChange={e => update('officerNameEnglish', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">辭任生效日期</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>日 (DD)</Label><Input value={formData.resignationDay} onChange={e => update('resignationDay', e.target.value)} className="mt-1" /></div>
            <div><Label>月 (MM)</Label><Input value={formData.resignationMonth} onChange={e => update('resignationMonth', e.target.value)} className="mt-1" /></div>
            <div><Label>年 (YYYY)</Label><Input value={formData.resignationYear} onChange={e => update('resignationYear', e.target.value)} className="mt-1" /></div>
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
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 ND4 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
