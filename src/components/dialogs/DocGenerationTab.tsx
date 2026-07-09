import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FileText, FileType, Download, Loader2, FileOutput } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Company } from '@/types';
import { NAR1Generator } from '@/components/nar1/NAR1Generator';
import ND2AGeneratorForm from '@/components/forms/ND2AGeneratorForm';
import ND2BGeneratorForm from '@/components/forms/ND2BGeneratorForm';
import ND4GeneratorForm from '@/components/forms/ND4GeneratorForm';
import NDR1GeneratorForm from '@/components/forms/NDR1GeneratorForm';
import NR1GeneratorForm from '@/components/forms/NR1GeneratorForm';
import NSC1GeneratorForm from '@/components/forms/NSC1GeneratorForm';
import { useGenerateDocx, DOCX_DOC_TYPES, type GenerateDocxInput } from '@/hooks/useWordDoc';

interface DocGenerationTabProps {
  company: Company;
}

// PDF 表格清單（DG-04 ~ DG-13）— 全部以公司資料預填
const PDF_FORMS: { key: string; code: string; label: string; desc: string }[] = [
  { key: 'nar1', code: 'NAR1', label: '周年申報表', desc: '已填入公司／董事／秘書資料' },
  { key: 'nd2a', code: 'ND2A', label: '更改公司秘書及董事通知書', desc: '委任／停任變更資料' },
  { key: 'nd2b', code: 'ND2B', label: '更改公司秘書及董事詳情通知書', desc: '姓名／地址等詳情變更' },
  { key: 'nd4',  code: 'ND4',  label: '公司秘書及董事辭任通知書', desc: '辭任資料' },
  { key: 'ndr1', code: 'NDR1', label: '撤銷註冊申請書', desc: '私人公司撤銷註冊' },
  { key: 'nr1',  code: 'NR1',  label: '註冊辦事處地址變更通知書', desc: '註冊地址變更' },
  { key: 'nsc1', code: 'NSC1', label: '股份配發申報書', desc: '股份分配資料' },
];

/** 公司詳情 → 文件生成（截圖指南「七、文件生成服務」DG-01~13）。 */
export function DocGenerationTab({ company }: DocGenerationTabProps) {
  const [pdfForm, setPdfForm] = useState<string | null>(null);   // 開啟中的 CR 表格生成器
  const [nar1Open, setNar1Open] = useState(false);

  // ── DOCX ──
  const generateDocx = useGenerateDocx();
  const [pendingDocx, setPendingDocx] = useState('');
  const [contentDialog, setContentDialog] = useState<{ docType: string; label: string } | null>(null);
  const [meetingDate, setMeetingDate] = useState('');
  const [location, setLocation] = useState('');
  const [content, setContent] = useState('');

  const openPdfForm = (key: string) => {
    if (key === 'nar1') setNar1Open(true);
    else setPdfForm(key);
  };

  const doGenerateDocx = async (input: GenerateDocxInput, label: string) => {
    setPendingDocx(input.doc_type);
    try {
      const res = await generateDocx.mutateAsync(input);
      toast({ title: '已生成', description: `${label} 已下載（${res.filename}）` });
      setContentDialog(null);
    } catch (e: any) {
      toast({ title: '生成失敗', description: e.message, variant: 'destructive' });
    } finally {
      setPendingDocx('');
    }
  };

  const handleDocxClick = (dt: typeof DOCX_DOC_TYPES[number]) => {
    if (dt.needsContent) {
      setMeetingDate(''); setLocation(''); setContent('');
      setContentDialog({ docType: dt.key, label: dt.label });
    } else {
      doGenerateDocx({ company_id: company.id, doc_type: dt.key }, dt.label);
    }
  };

  const submitContentDialog = () => {
    if (!contentDialog) return;
    doGenerateDocx({
      company_id: company.id,
      doc_type: contentDialog.docType,
      content: content.trim() || undefined,
      meeting_date: meetingDate || undefined,
      location: location.trim() || undefined,
    }, contentDialog.label);
  };

  // 承載選中的 CR 表格生成器（傳 initialCompanyId 自動預填當前公司）
  const renderPdfForm = () => {
    const onBack = () => setPdfForm(null);
    const cid = company.id;
    switch (pdfForm) {
      case 'nd2a': return <ND2AGeneratorForm onBack={onBack} initialCompanyId={cid} />;
      case 'nd2b': return <ND2BGeneratorForm onBack={onBack} initialCompanyId={cid} />;
      case 'nd4':  return <ND4GeneratorForm onBack={onBack} initialCompanyId={cid} />;
      case 'ndr1': return <NDR1GeneratorForm onBack={onBack} initialCompanyId={cid} />;
      case 'nr1':  return <NR1GeneratorForm onBack={onBack} initialCompanyId={cid} />;
      case 'nsc1': return <NSC1GeneratorForm onBack={onBack} initialCompanyId={cid} />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* DG-01 入口說明 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileOutput className="h-4 w-4 text-primary" />
        以「{company.name}」的系統資料自動填入，選擇要生成的文件類型。
      </div>

      {/* PDF 政府表格（DG-04 ~ DG-13） */}
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
          <FileText className="h-4 w-4 text-primary" /> 政府表格 PDF
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PDF_FORMS.map(f => (
            <button key={f.key} onClick={() => openPdfForm(f.key)}
              className="text-left rounded-lg border border-border bg-card p-3 hover:border-primary/50 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">{f.code}</span>
                <span className="font-medium text-sm">{f.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{f.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Word 文件 DOCX（DG-02 / DG-03） */}
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
          <FileType className="h-4 w-4 text-primary" /> Word 文件 (.docx)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOCX_DOC_TYPES.map(dt => {
            const busy = generateDocx.isPending && pendingDocx === dt.key;
            return (
              <div key={dt.key} className="rounded-lg border border-border bg-card p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <FileType className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-medium text-sm">{dt.label}</span>
                </div>
                <p className="text-xs text-muted-foreground flex-1 mb-2.5 leading-relaxed">{dt.description}</p>
                <Button size="sm" variant="outline" className="w-full" disabled={busy}
                  onClick={() => handleDocxClick(dt)}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  {dt.needsContent ? '填寫並生成' : '生成 Word'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* NAR1 自帶 Dialog */}
      <NAR1Generator open={nar1Open} onOpenChange={setNar1Open} company={company} />

      {/* CR 表格生成器（全屏 Dialog 承載） */}
      <Dialog open={!!pdfForm} onOpenChange={o => { if (!o) setPdfForm(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {renderPdfForm()}
        </DialogContent>
      </Dialog>

      {/* 決議 / 會議記錄 內容對話框 */}
      <Dialog open={!!contentDialog} onOpenChange={o => { if (!o) setContentDialog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{contentDialog?.label} — {company.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{contentDialog?.docType === 'meeting_minutes' ? '會議日期' : '決議日期'}</Label>
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
            <p className="text-[11px] text-muted-foreground">出席／簽署董事欄位會依系統內該公司的董事名單自動帶入。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContentDialog(null)}>取消</Button>
            <Button onClick={submitContentDialog} disabled={generateDocx.isPending}>
              {generateDocx.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              生成 Word
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
