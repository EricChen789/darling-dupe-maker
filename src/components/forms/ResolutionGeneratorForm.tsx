import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Download, Loader2, Sparkles, Save } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { useSaveResolution } from '@/hooks/useResolutions';
import { downloadGenericFormPdf } from '@/lib/genericFormPdf';
import { supabase } from '@/integrations/supabase/client';

interface Props { onBack: () => void; }

const TEMPLATES: Record<string, { title: string; type: string; body: (vars: Record<string, string>) => string }> = {
  appointment_director: {
    title: '委任董事決議書 Appointment of Director',
    type: 'appointment_director',
    body: (v) => `RESOLVED THAT ${v.personName} of ${v.personAddress || '[address]'} be and is hereby appointed as a Director of the Company with effect from ${v.effectiveDate || v.resolutionDate}.

茲決議：委任 ${v.personName} 為本公司董事，於 ${v.effectiveDate || v.resolutionDate} 起生效。`,
  },
  resignation_director: {
    title: '董事辭任決議書 Resignation of Director',
    type: 'resignation_director',
    body: (v) => `RESOLVED THAT the resignation of ${v.personName} as a Director of the Company with effect from ${v.effectiveDate || v.resolutionDate} be and is hereby accepted.

茲決議：接納 ${v.personName} 辭任本公司董事一職，於 ${v.effectiveDate || v.resolutionDate} 起生效。`,
  },
  address_change: {
    title: '更改註冊辦事處地址決議書 Change of Registered Office',
    type: 'address_change',
    body: (v) => `RESOLVED THAT the Registered Office of the Company be changed from ${v.oldAddress || '[old]'} to ${v.newAddress || '[new address]'} with effect from ${v.effectiveDate || v.resolutionDate}, and that Form NR1 be filed with the Companies Registry within 15 days.

茲決議：本公司註冊辦事處地址由 ${v.oldAddress || '[舊地址]'} 變更為 ${v.newAddress || '[新地址]'}，於 ${v.effectiveDate || v.resolutionDate} 起生效，並於 15 日內向公司註冊處提交 NR1 表格。`,
  },
  rename: {
    title: '更改公司名稱特別決議 Special Resolution — Change of Name',
    type: 'rename',
    body: (v) => `SPECIAL RESOLUTION:
RESOLVED THAT the name of the Company be changed from "${v.oldName || '[old name]'}" to "${v.newName || '[new name]'}" subject to the approval of the Registrar of Companies, and that Form NNC2 be filed accordingly.

特別決議：
茲決議：本公司名稱由 "${v.oldName || '[舊名稱]'}" 變更為 "${v.newName || '[新名稱]'}"，須獲公司註冊處長批准，並提交 NNC2 表格辦理。`,
  },
  share_transfer: {
    title: '股份轉讓決議書 Share Transfer',
    type: 'share_transfer',
    body: (v) => `RESOLVED THAT the transfer of ${v.shares || '[X]'} ${v.shareClass || 'Ordinary'} shares from ${v.fromName || '[transferor]'} to ${v.toName || '[transferee]'} be and is hereby approved, and the Register of Members be updated accordingly.

茲決議：批准由 ${v.fromName || '[轉讓人]'} 將 ${v.shares || '[X]'} 股 ${v.shareClass || '普通股'} 轉讓予 ${v.toName || '[受讓人]'}，並相應更新股東名冊。`,
  },
  capital_increase: {
    title: '增加股本決議書 Increase of Capital',
    type: 'capital_increase',
    body: (v) => `RESOLVED THAT the issued share capital of the Company be increased by the allotment of ${v.newShares || '[X]'} new ${v.shareClass || 'Ordinary'} shares at ${v.issuePrice || 'HKD 1.00'} per share to ${v.allotteeName || '[allottee]'}.

茲決議：本公司增發新 ${v.shareClass || '普通'} 股 ${v.newShares || '[X]'} 股，每股 ${v.issuePrice || 'HKD 1.00'} 配發予 ${v.allotteeName || '[配發對象]'}。`,
  },
};

export default function ResolutionGeneratorForm({ onBack }: Props) {
  const { data: companies = [] } = useCompanies();
  const save = useSaveResolution();
  const [mode, setMode] = useState<'template' | 'ai'>('template');
  const [companyId, setCompanyId] = useState('');
  const [resolutionType, setResolutionType] = useState('appointment_director');
  const [resolutionDate, setResolutionDate] = useState(new Date().toISOString().slice(0, 10));
  const [vars, setVars] = useState<Record<string, string>>({ resolutionDate: new Date().toISOString().slice(0, 10) });
  const [aiContext, setAiContext] = useState('');
  const [aiLanguage, setAiLanguage] = useState<'zh' | 'en' | 'bilingual'>('bilingual');
  const [content, setContent] = useState('');
  const [signers, setSigners] = useState('');
  const [generating, setGenerating] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const company = companies.find(c => c.id === companyId);

  const updateVar = (k: string, v: string) => setVars(prev => ({ ...prev, [k]: v }));

  const renderFromTemplate = () => {
    const t = TEMPLATES[resolutionType];
    if (!t) return;
    setContent(t.body({ ...vars, resolutionDate }));
  };

  const generateWithAI = async () => {
    if (!company) {
      toast({ title: '請先選擇公司', variant: 'destructive' });
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-resolution', {
        body: {
          resolutionType,
          companyName: company.name,
          companyChineseName: company.chineseName,
          brNumber: company.brNumber,
          resolutionDate,
          context: aiContext,
          language: aiLanguage,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setContent((data as any).content || '');
      toast({ title: 'AI 已生成決議書' });
    } catch (e: any) {
      toast({ title: 'AI 生成失敗', description: e.message, variant: 'destructive' });
    } finally {
      setAiLoading(false);
    }
  };

  const handleGeneratePDF = async () => {
    if (!company) {
      toast({ title: '請先選擇公司', variant: 'destructive' });
      return;
    }
    if (!content.trim()) {
      toast({ title: '請先生成或編輯決議書內容', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const t = TEMPLATES[resolutionType];
      const ok = await downloadGenericFormPdf({
        formCode: 'RESOLUTION',
        title: t?.title || 'Company Resolution / 公司決議書',
        subtitle: 'Written Resolution / 書面決議書',
        companyName: company.name,
        brNumber: company.brNumber,
        sections: [
          { rows: [['Resolution Date 決議日期', resolutionDate], ['Resolution Type 類型', resolutionType]] },
          { heading: 'Resolution / 決議內容', paragraph: content },
        ],
        signatureLines: signers
          ? signers.split(',').map(s => `${s.trim()}: ____________________   Date: __________`)
          : ['Director / 董事 (1): ____________________   Date: __________'],
      }, `Resolution_${resolutionType}`);

      if (ok) {
        // Auto-save resolution record
        save.mutate({
          company_id: company.id,
          resolution_type: resolutionType,
          title: t?.title || 'Resolution',
          resolution_date: resolutionDate,
          content,
          signers,
          is_ai_generated: mode === 'ai',
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveOnly = () => {
    if (!company || !content.trim()) {
      toast({ title: '請選擇公司並填寫內容', variant: 'destructive' });
      return;
    }
    setSaving(true);
    save.mutate({
      company_id: company.id,
      resolution_type: resolutionType,
      title: TEMPLATES[resolutionType]?.title || 'Resolution',
      resolution_date: resolutionDate,
      content,
      signers,
      is_ai_generated: mode === 'ai',
    }, {
      onSuccess: () => { toast({ title: '已儲存' }); setSaving(false); },
      onError: (e: any) => { toast({ title: '儲存失敗', description: e.message, variant: 'destructive' }); setSaving(false); },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> 返回</Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSaveOnly} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} 僅儲存
          </Button>
          <Button onClick={handleGeneratePDF} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />} 生成 PDF
          </Button>
        </div>
      </div>

      <h2 className="text-xl font-semibold">決議書生成器</h2>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">公司</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="選擇公司" /></SelectTrigger>
            <SelectContent>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">決議類型</Label>
          <Select value={resolutionType} onValueChange={setResolutionType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TEMPLATES).map(([k, t]) => (
                <SelectItem key={k} value={k}>{t.title}</SelectItem>
              ))}
              <SelectItem value="general">其他 / Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">決議日期</Label>
          <Input type="date" value={resolutionDate} onChange={e => setResolutionDate(e.target.value)} />
        </div>
      </div>

      <Separator />

      <Tabs value={mode} onValueChange={v => setMode(v as 'template' | 'ai')}>
        <TabsList>
          <TabsTrigger value="template">通用範本</TabsTrigger>
          <TabsTrigger value="ai"><Sparkles className="h-3 w-3 mr-1" /> AI 自由生成</TabsTrigger>
        </TabsList>

        <TabsContent value="template" className="space-y-3 pt-3">
          <TemplateVars resolutionType={resolutionType} vars={vars} updateVar={updateVar} />
          <Button variant="outline" size="sm" onClick={renderFromTemplate}>套用範本至下方</Button>
        </TabsContent>

        <TabsContent value="ai" className="space-y-3 pt-3">
          <div className="space-y-1">
            <Label className="text-xs">提供 AI 上下文（事件、人名、金額、日期等）</Label>
            <Textarea rows={4} value={aiContext} onChange={e => setAiContext(e.target.value)}
              placeholder="例如：委任 Mr. Chan 於 2026-05-01 起出任董事，地址為 ..." />
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-xs">語言</Label>
            <Select value={aiLanguage} onValueChange={v => setAiLanguage(v as any)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bilingual">中英對照</SelectItem>
                <SelectItem value="zh">繁體中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={generateWithAI} disabled={aiLoading}>
              {aiLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />} 生成內容
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <Separator />

      <div className="space-y-1">
        <Label className="text-xs">決議書內容（可手動編輯）</Label>
        <Textarea rows={14} value={content} onChange={e => setContent(e.target.value)}
          placeholder="點擊上方「套用範本」或「AI 生成內容」後將顯示於此..."
          className="font-mono text-sm" />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">簽署人（以逗號分隔，例如：Mr. Chan, Ms. Wong）</Label>
        <Input value={signers} onChange={e => setSigners(e.target.value)} placeholder="留空則使用預設「Director / 董事 (1)」" />
      </div>
    </div>
  );
}

function TemplateVars({ resolutionType, vars, updateVar }: {
  resolutionType: string;
  vars: Record<string, string>;
  updateVar: (k: string, v: string) => void;
}) {
  const fieldsByType: Record<string, [string, string][]> = {
    appointment_director: [['personName', '受任董事姓名'], ['personAddress', '地址'], ['effectiveDate', '生效日期']],
    resignation_director: [['personName', '辭任董事姓名'], ['effectiveDate', '生效日期']],
    address_change: [['oldAddress', '舊地址'], ['newAddress', '新地址'], ['effectiveDate', '生效日期']],
    rename: [['oldName', '舊公司名稱'], ['newName', '新公司名稱']],
    share_transfer: [['fromName', '轉讓人'], ['toName', '受讓人'], ['shares', '股數'], ['shareClass', '股份類別']],
    capital_increase: [['newShares', '新增股數'], ['shareClass', '股份類別'], ['issuePrice', '每股價'], ['allotteeName', '配發對象']],
  };
  const fields = fieldsByType[resolutionType] || [];
  if (fields.length === 0) return <p className="text-xs text-muted-foreground">此類型無需額外變數，直接點「套用範本」即可。</p>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {fields.map(([k, label]) => (
        <div key={k} className="space-y-1">
          <Label className="text-xs">{label}</Label>
          <Input value={vars[k] || ''} onChange={e => updateVar(k, e.target.value)} />
        </div>
      ))}
    </div>
  );
}
