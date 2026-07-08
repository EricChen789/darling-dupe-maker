import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

interface NN1GeneratorFormProps { onBack: () => void; }
interface OfficerEntry { role: string; nameChinese: string; nameEnglish: string; identity: string; address: string; }
interface ShareholderEntry { name: string; shares: string; class: string; }

export default function NN1GeneratorForm({ onBack }: NN1GeneratorFormProps) {
  const [generating, setGenerating] = useState(false);

  const [formData, setFormData] = useState({
    proposedNameEnglish: '', proposedNameChinese: '',
    companyType: '私人股份有限公司 Private Company Limited by Shares',
    flat: '', building: '', street: '', district: '', region: '香港 Hong Kong',
    presentorName: '', presentorContact: '',
  });

  const [officers, setOfficers] = useState<OfficerEntry[]>([
    { role: 'director', nameChinese: '', nameEnglish: '', identity: 'natural', address: '' },
    { role: 'secretary', nameChinese: '', nameEnglish: '', identity: 'natural', address: '' },
  ]);
  const [shareholders, setShareholders] = useState<ShareholderEntry[]>([{ name: '', shares: '', class: '普通股 Ordinary' }]);

  const update = (f: string, v: string) => setFormData(prev => ({ ...prev, [f]: v }));
  const updateOfficer = (i: number, f: keyof OfficerEntry, v: string) => setOfficers(prev => prev.map((o, idx) => idx === i ? { ...o, [f]: v } : o));
  const addOfficer = () => setOfficers(prev => [...prev, { role: 'director', nameChinese: '', nameEnglish: '', identity: 'natural', address: '' }]);
  const removeOfficer = (i: number) => setOfficers(prev => prev.filter((_, idx) => idx !== i));
  const updateShareholder = (i: number, f: keyof ShareholderEntry, v: string) => setShareholders(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const addShareholder = () => setShareholders(prev => [...prev, { name: '', shares: '', class: '普通股 Ordinary' }]);
  const removeShareholder = (i: number) => setShareholders(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  const handleGenerate = async () => {
    if (!formData.proposedNameEnglish) { toast({ title: '錯誤', description: '請填寫擬用公司英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      // Map to official NN1 template (註冊非香港公司的註冊申請書)
      const fields: Record<string, string> = {
        'fill_1_P.1': formData.proposedNameEnglish,
        'fill_2_P.1': formData.proposedNameChinese || '',
        'fill_3_P.1': formData.companyType || '',
        'fill_4_P.1': formData.flat || '',
        'fill_5_P.1': formData.building || '',
        'fill_6_P.1': formData.street || '',
        'fill_7_P.1': formData.district || '',
        'fill_8_P.1': formData.region || '',
        'fill_14_P.1': formData.presentorName || '',
        'fill_15_P.1': formData.presentorContact || '',
      };
      const resp = await fetch(`/api/generate-template-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ template: 'NN1-template.pdf', fields }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NN1-form.pdf');
      toast({ title: '生成成功', description: 'NN1 表格已下載' });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NN1 — 註冊非香港公司的註冊申請書</h1><p className="text-sm text-muted-foreground">Application for Registration of a Non-Hong Kong Company</p></div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <div><h3 className="font-semibold mb-3">擬用公司名稱</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>英文名稱 *</Label><Input value={formData.proposedNameEnglish} onChange={e => update('proposedNameEnglish', e.target.value)} placeholder="e.g. ABC Limited" className="mt-1" /></div>
            <div><Label>中文名稱</Label><Input value={formData.proposedNameChinese} onChange={e => update('proposedNameChinese', e.target.value)} placeholder="e.g. 甲乙丙有限公司" className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">公司類別</h3>
          <Select value={formData.companyType} onValueChange={v => update('companyType', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="私人股份有限公司 Private Company Limited by Shares">私人股份有限公司 Private Company Limited by Shares</SelectItem>
              <SelectItem value="公眾股份有限公司 Public Company Limited by Shares">公眾股份有限公司 Public Company Limited by Shares</SelectItem>
              <SelectItem value="擔保有限公司 Company Limited by Guarantee">擔保有限公司 Company Limited by Guarantee</SelectItem>
            </SelectContent>
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

        <div>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">首任董事及公司秘書</h3>
            <Button variant="outline" size="sm" onClick={addOfficer}><Plus className="h-4 w-4 mr-1" />新增</Button>
          </div>
          {officers.map((o, i) => (
            <div key={i} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3"><span className="font-medium text-sm">人員 #{i + 1}</span>
                {officers.length > 2 && <Button variant="ghost" size="sm" onClick={() => removeOfficer(i)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>角色</Label>
                  <Select value={o.role} onValueChange={v => updateOfficer(i, 'role', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="director">董事 Director</SelectItem><SelectItem value="secretary">公司秘書 Company Secretary</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>身份</Label>
                  <Select value={o.identity} onValueChange={v => updateOfficer(i, 'identity', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="natural">自然人 Natural Person</SelectItem><SelectItem value="corporate">法人 Corporate</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>中文名稱</Label><Input value={o.nameChinese} onChange={e => updateOfficer(i, 'nameChinese', e.target.value)} className="mt-1" /></div>
                <div><Label>英文名稱</Label><Input value={o.nameEnglish} onChange={e => updateOfficer(i, 'nameEnglish', e.target.value)} className="mt-1" /></div>
                <div className="col-span-2"><Label>地址</Label><Input value={o.address} onChange={e => updateOfficer(i, 'address', e.target.value)} className="mt-1" /></div>
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">股東／創辦成員</h3>
            <Button variant="outline" size="sm" onClick={addShareholder}><Plus className="h-4 w-4 mr-1" />新增</Button>
          </div>
          {shareholders.map((s, i) => (
            <div key={i} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3"><span className="font-medium text-sm">股東 #{i + 1}</span>
                {shareholders.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeShareholder(i)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>姓名／名稱</Label><Input value={s.name} onChange={e => updateShareholder(i, 'name', e.target.value)} className="mt-1" /></div>
                <div><Label>股份類別</Label>
                  <Select value={s.class} onValueChange={v => updateShareholder(i, 'class', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="普通股 Ordinary">普通股 Ordinary</SelectItem><SelectItem value="優先股 Preference">優先股 Preference</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>股份數目</Label><Input value={s.shares} onChange={e => updateShareholder(i, 'shares', e.target.value)} className="mt-1" /></div>
              </div>
            </div>
          ))}
        </div>

        <div><h3 className="font-semibold mb-3">提交人資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>姓名／名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>電話 / 傳真 / 電郵</Label><Input value={formData.presentorContact} onChange={e => update('presentorContact', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN1 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
