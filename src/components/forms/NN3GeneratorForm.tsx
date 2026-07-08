import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

interface NN3GeneratorFormProps { onBack: () => void; }

export default function NN3GeneratorForm({ onBack }: NN3GeneratorFormProps) {
  const [generating, setGenerating] = useState(false);

  const [formData, setFormData] = useState({
    proposedNameEnglish: '', proposedNameChinese: '',
    companyType: '私人股份有限公司 Private Company Limited by Shares',
    flat: '', building: '', street: '', district: '', region: '香港 Hong Kong',
    firstDirectorName: '', firstSecretaryName: '',
    shareholderName: '', shareholderShares: '',
    presentorName: '', presentorContact: '',
  });

  const update = (f: string, v: string) => setFormData(prev => ({ ...prev, [f]: v }));

  const handleGenerate = async () => {
    if (!formData.proposedNameEnglish) { toast({ title: '錯誤', description: '請填寫擬用公司英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const fields: Record<string, string> = {
        'fill_1_P.1': formData.proposedNameEnglish,
        'fill_2_P.1': formData.proposedNameChinese || '',
        'fill_3_P.1': formData.companyType || '',
        'fill_4_P.1': formData.flat || '',
        'fill_5_P.1': formData.building || '',
        'fill_6_P.1': formData.street || '',
        'fill_7_P.1': formData.district || '',
        'fill_8_P.1': formData.region || '',
        'fill_1_P.2': formData.firstDirectorName || '',
        'fill_2_P.2': formData.firstSecretaryName || '',
        'fill_3_P.2': formData.shareholderName || '',
        'fill_4_P.2': formData.shareholderShares || '',
        'fill_1_P.3': formData.presentorName || '',
        'fill_2_P.3': formData.presentorContact || '',
      };
      const resp = await fetch(`/api/generate-template-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ template: 'NN3-template.pdf', fields }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NN3-form.pdf');
      toast({ title: '生成成功', description: 'NN3 表格已下載' });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NN3 — 註冊非香港公司周年申報表</h1><p className="text-sm text-muted-foreground">Annual Return of a Registered Non-Hong Kong Company</p></div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <div><h3 className="font-semibold mb-3">公司現有名稱</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>英文名稱 *</Label><Input value={formData.proposedNameEnglish} onChange={e => update('proposedNameEnglish', e.target.value)} placeholder="e.g. ABC Limited" className="mt-1" /></div>
            <div><Label>中文名稱</Label><Input value={formData.proposedNameChinese} onChange={e => update('proposedNameChinese', e.target.value)} placeholder="e.g. 甲乙丙有限公司" className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">公司類別</h3>
          <Select value={formData.companyType} onValueChange={v => update('companyType', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="私人股份有限公司 Private Company Limited by Shares">私人股份有限公司 Private Company Limited by Shares</SelectItem><SelectItem value="公眾股份有限公司 Public Company Limited by Shares">公眾股份有限公司 Public Company Limited by Shares</SelectItem></SelectContent>
          </Select>
        </div>

        <div><h3 className="font-semibold mb-3">註冊辦事處地址</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>室／樓／座</Label><Input value={formData.flat} onChange={e => update('flat', e.target.value)} className="mt-1" /></div>
            <div><Label>大廈</Label><Input value={formData.building} onChange={e => update('building', e.target.value)} className="mt-1" /></div>
            <div><Label>街道／屋苑／地段</Label><Input value={formData.street} onChange={e => update('street', e.target.value)} className="mt-1" /></div>
            <div><Label>區</Label><Input value={formData.district} onChange={e => update('district', e.target.value)} className="mt-1" /></div>
            <div><Label>地區</Label>
              <Select value={formData.region} onValueChange={v => update('region', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="香港 Hong Kong">香港 Hong Kong</SelectItem><SelectItem value="九龍 Kowloon">九龍 Kowloon</SelectItem><SelectItem value="新界 New Territories">新界 New Territories</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">現任董事及公司秘書</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>董事名稱</Label><Input value={formData.firstDirectorName} onChange={e => update('firstDirectorName', e.target.value)} className="mt-1" /></div>
            <div><Label>秘書名稱</Label><Input value={formData.firstSecretaryName} onChange={e => update('firstSecretaryName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">創辦成員</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>股東姓名／名稱</Label><Input value={formData.shareholderName} onChange={e => update('shareholderName', e.target.value)} className="mt-1" /></div>
            <div><Label>股份數目</Label><Input value={formData.shareholderShares} onChange={e => update('shareholderShares', e.target.value)} className="mt-1" /></div>
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
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN3 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
