import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { FileText, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import {
  useGenerateDocx, DOCX_DOC_TYPES, type GenerateDocxInput,
} from '@/hooks/useWordDoc';

const WordDocs = () => {
  const { data: companies = [], isLoading: companiesLoading } = useCompanies();
  const generate = useGenerateDocx();

  const [companyId, setCompanyId] = useState('');
  const selectedCompany = companies.find(c => c.id === companyId) || null;

  // 需要內容的文件（決議 / 會議記錄）走對話框補充
  const [contentDialog, setContentDialog] = useState<{ docType: string; label: string } | null>(null);
  const [meetingDate, setMeetingDate] = useState('');
  const [location, setLocation] = useState('');
  const [content, setContent] = useState('');

  const [pendingType, setPendingType] = useState('');

  const doGenerate = async (input: GenerateDocxInput, label: string) => {
    setPendingType(input.doc_type);
    try {
      const res = await generate.mutateAsync(input);
      toast({ title: '已生成', description: `${label} 已下載（${res.filename}）` });
      setContentDialog(null);
    } catch (e: any) {
      toast({ title: '生成失敗', description: e.message, variant: 'destructive' });
    } finally {
      setPendingType('');
    }
  };

  const handleCardClick = (dt: typeof DOCX_DOC_TYPES[number]) => {
    if (!companyId) { toast({ title: '請先選擇公司', variant: 'destructive' }); return; }
    if (dt.needsContent) {
      setMeetingDate(''); setLocation(''); setContent('');
      setContentDialog({ docType: dt.key, label: dt.label });
    } else {
      doGenerate({ company_id: companyId, doc_type: dt.key }, dt.label);
    }
  };

  const submitContentDialog = () => {
    if (!contentDialog) return;
    doGenerate({
      company_id: companyId,
      doc_type: contentDialog.docType,
      content: content.trim() || undefined,
      meeting_date: meetingDate || undefined,
      location: location.trim() || undefined,
    }, contentDialog.label);
  };

  const companyLabel = useMemo(() => {
    if (!selectedCompany) return '';
    return [selectedCompany.name, selectedCompany.chineseName].filter(Boolean).join('　');
  }, [selectedCompany]);

  return (
    <div>
      <PageHeader
        title="Word 文件生成"
        description="基於系統數據自動生成 Microsoft Word (.docx) 公司秘書文件 — 自動填入公司、董事、秘書、股本資料"
      />

      {/* 公司選擇 */}
      <div className="mb-6 max-w-xl">
        <Label className="text-xs mb-1.5 block">選擇公司 *</Label>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger>
            <SelectValue placeholder={companiesLoading ? '載入中...' : '選擇要生成文件的公司...'} />
          </SelectTrigger>
          <SelectContent>
            {companies.map(c => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}{c.chineseName ? `（${c.chineseName}）` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedCompany && (
          <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
            <Building2 className="h-3 w-3" /> {companyLabel}
            {selectedCompany.brNumber ? `　·　BR ${selectedCompany.brNumber}` : ''}
          </p>
        )}
      </div>

      {/* 文件類型卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {DOCX_DOC_TYPES.map(dt => {
          const busy = generate.isPending && pendingType === dt.key;
          return (
            <div key={dt.key}
              className="rounded-lg border border-border bg-card p-4 flex flex-col hover:border-primary/50 transition-colors">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <span className="font-medium">{dt.label}</span>
              </div>
              <p className="text-xs text-muted-foreground flex-1 mb-3 leading-relaxed">{dt.description}</p>
              <Button size="sm" className="w-full" disabled={busy || !companyId}
                onClick={() => handleCardClick(dt)}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                {dt.needsContent ? '填寫並生成' : '生成 Word'}
              </Button>
            </div>
          );
        })}
      </div>

      {!companyId && (
        <p className="text-sm text-muted-foreground mt-6">請先於上方選擇公司，再點擊文件類型生成。</p>
      )}

      {/* 決議 / 會議記錄 內容對話框 */}
      <Dialog open={!!contentDialog} onOpenChange={o => { if (!o) setContentDialog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{contentDialog?.label} — {companyLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">
                  {contentDialog?.docType === 'meeting_minutes' ? '會議日期' : '決議日期'}
                </Label>
                <Input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} />
              </div>
              {contentDialog?.docType === 'meeting_minutes' && (
                <div className="space-y-1">
                  <Label className="text-xs">會議地點</Label>
                  <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="公司註冊辦事處" />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">議決事項（每行一項，可留空使用範本佔位）</Label>
              <Textarea rows={7} value={content} onChange={e => setContent(e.target.value)}
                placeholder={'1. 通過核准截至 2025 年 12 月 31 日之財務報表\n2. 委任 XXX 為公司董事\n3. ...'} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              出席／簽署董事欄位會依系統內該公司的董事名單自動帶入。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContentDialog(null)}>取消</Button>
            <Button onClick={submitContentDialog} disabled={generate.isPending}>
              {generate.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              生成 Word
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WordDocs;
