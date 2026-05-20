import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Download, Loader2, Building2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';

interface OfficerEntry {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director';
  identity: 'natural' | 'corporate';
  nameChinese: string;
  nameEnglish: string;
  formerNameChinese: string;
  formerNameEnglish: string;
  idNumber: string;
  address: string;
  dateAppointed: string;
  dateCeased: string;
  companyName: string;
  companyNumber: string;
  placeIncorporated: string;
}

const emptyOfficer = (): OfficerEntry => ({
  type: 'appointment',
  role: 'director',
  identity: 'natural',
  nameChinese: '',
  nameEnglish: '',
  formerNameChinese: '',
  formerNameEnglish: '',
  idNumber: '',
  address: '',
  dateAppointed: '',
  dateCeased: '',
  companyName: '',
  companyNumber: '',
  placeIncorporated: '',
});

interface ND2AGeneratorFormProps {
  onBack: () => void;
}

export default function ND2AGeneratorForm({ onBack }: ND2AGeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [brNumber, setBrNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [officers, setOfficers] = useState<OfficerEntry[]>([emptyOfficer()]);
  const [signerName, setSignerName] = useState('');
  const [signDate, setSignDate] = useState('');
  const [presentorName, setPresentorName] = useState('');
  const [presentorAddress, setPresentorAddress] = useState('');
  const [presentorContact, setPresentorContact] = useState('');

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setBrNumber(company.brNumber);
      setCompanyName(company.name);
      setPresentorName(company.name);
    }
  };

  const updateOfficer = (idx: number, field: string, value: string) => {
    setOfficers(prev => prev.map((o, i) => i === idx ? { ...o, [field]: value } : o));
  };

  const addOfficer = () => setOfficers(prev => [...prev, emptyOfficer()]);
  const removeOfficer = (idx: number) => setOfficers(prev => prev.filter((_, i) => i !== idx));

  const handleGenerate = async (debug = false) => {
    if (!brNumber || !companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const resp = await fetch(`/api/generate-nd2a-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brNumber, companyName, officers, signerName, signDate, presentorName, presentorAddress, presentorContact, debug }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      const byteChars = atob(result.pdf);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ND2A_${brNumber}_${companyName.replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: '生成成功', description: 'ND2A 表格已下載' });
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
          <h1 className="text-2xl font-bold">ND2A — 出任/停任董事及公司秘書通知書</h1>
          <p className="text-sm text-muted-foreground">Notice of Change of Company Secretary and Director (Appointment/Cessation)</p>
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
            <div><Label>商業登記號碼 *</Label><Input value={brNumber} onChange={e => setBrNumber(e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={companyName} onChange={e => setCompanyName(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Officers */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">董事/秘書出任或停任</h3>
            <Button variant="outline" size="sm" onClick={addOfficer}><Plus className="h-4 w-4 mr-1" />新增人員</Button>
          </div>
          {officers.map((officer, idx) => (
            <div key={idx} className="border border-border rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">人員 #{idx + 1}</span>
                {officers.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeOfficer(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>變更類型</Label>
                  <Select value={officer.type} onValueChange={v => updateOfficer(idx, 'type', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="appointment">出任 Appointment</SelectItem>
                      <SelectItem value="cessation">停任 Cessation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>職位</Label>
                  <Select value={officer.role} onValueChange={v => updateOfficer(idx, 'role', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="director">董事 Director</SelectItem>
                      <SelectItem value="secretary">公司秘書 Secretary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>身分</Label>
                  <Select value={officer.identity} onValueChange={v => updateOfficer(idx, 'identity', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="natural">自然人 Natural Person</SelectItem>
                      <SelectItem value="corporate">法人團體 Body Corporate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {officer.identity === 'natural' ? (
                  <>
                    <div><Label>英文姓名</Label><Input value={officer.nameEnglish} onChange={e => updateOfficer(idx, 'nameEnglish', e.target.value)} className="mt-1" /></div>
                    <div><Label>中文姓名</Label><Input value={officer.nameChinese} onChange={e => updateOfficer(idx, 'nameChinese', e.target.value)} className="mt-1" /></div>
                    <div><Label>證件號碼</Label><Input value={officer.idNumber} onChange={e => updateOfficer(idx, 'idNumber', e.target.value)} className="mt-1" /></div>
                    <div className="col-span-2"><Label>住址</Label><Input value={officer.address} onChange={e => updateOfficer(idx, 'address', e.target.value)} className="mt-1" /></div>
                  </>
                ) : (
                  <>
                    <div><Label>公司名稱</Label><Input value={officer.companyName} onChange={e => updateOfficer(idx, 'companyName', e.target.value)} className="mt-1" /></div>
                    <div><Label>公司編號</Label><Input value={officer.companyNumber} onChange={e => updateOfficer(idx, 'companyNumber', e.target.value)} className="mt-1" /></div>
                    <div><Label>成立地點</Label><Input value={officer.placeIncorporated} onChange={e => updateOfficer(idx, 'placeIncorporated', e.target.value)} className="mt-1" /></div>
                  </>
                )}
                <div><Label>{officer.type === 'appointment' ? '委任日期' : '停任日期'}</Label><Input type="date" value={officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased} onChange={e => updateOfficer(idx, officer.type === 'appointment' ? 'dateAppointed' : 'dateCeased', e.target.value)} className="mt-1" /></div>
              </div>
            </div>
          ))}
        </div>

        {/* Signature & Presentor */}
        <div>
          <h3 className="font-semibold mb-3">簽署及提交人</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>簽署人姓名</Label><Input value={signerName} onChange={e => setSignerName(e.target.value)} className="mt-1" /></div>
            <div><Label>簽署日期</Label><Input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人名稱</Label><Input value={presentorName} onChange={e => setPresentorName(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人地址</Label><Input value={presentorAddress} onChange={e => setPresentorAddress(e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>電話/傳真/電郵</Label><Input value={presentorContact} onChange={e => setPresentorContact(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={() => handleGenerate(false)} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 ND2A PDF</>}
          </Button>
          <Button variant="outline" onClick={() => handleGenerate(true)} disabled={generating}>生成測試 PDF（Debug）</Button>
        </div>
      </div>
    </div>
  );
}
