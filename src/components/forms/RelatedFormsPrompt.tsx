import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, FileText, Download } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { getFormLinkageLabel } from '@/hooks/useFormLinkages';

export interface FormLinkage {
  id: string;
  primary_form: string;
  linked_form: string;
  linkage_type: string;
  description: string;
}

interface RelatedFormsPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primaryFormCode: string;
  primaryFormName: string;
  primaryFormData: any;
  companyId: string;
  companyName: string;
  linkages: FormLinkage[];
}

export default function RelatedFormsPrompt({
  open,
  onOpenChange,
  primaryFormCode,
  primaryFormName,
  primaryFormData,
  companyId,
  companyName,
  linkages,
}: RelatedFormsPromptProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(linkages.map(l => l.linked_form)));
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<Array<{ form_code: string; pdf?: string; filename?: string; error?: string; success: boolean }>>([]);
  const [phase, setPhase] = useState<'select' | 'generating' | 'done'>('select');

  useEffect(() => {
    if (open) {
      setSelected(new Set(linkages.map(l => l.linked_form)));
      setPhase('select');
      setResults([]);
    }
  }, [open, linkages]);

  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code); else next.add(code);
    setSelected(next);
  };

  const handleGenerateAll = async () => {
    if (selected.size === 0) return;
    setGenerating(true);
    setPhase('generating');
    try {
      const token = localStorage.getItem('secretary_jwt') || '';
      const linkedForms = Array.from(selected);
      const resp = await fetch('/api/generate-related-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          primary_form: primaryFormCode,
          form_data: primaryFormData,
          company_id: companyId,
          linked_forms: linkedForms,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Batch generation failed');

      const forms: any[] = result.forms || result.results || [];
      const res = forms.map((f: any) => ({
        form_code: f.form_code,
        pdf: f.pdf,
        filename: f.filename || `${f.form_code}_${companyName}.pdf`,
        error: f.error,
        success: !f.error && !!f.pdf,
      }));
      setResults(res);

      // Download each successfully-generated PDF
      let downloaded = 0;
      for (const r of res) {
        if (r.pdf) {
          downloadBase64Pdf(r.pdf, r.filename);
          downloaded++;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      setPhase('done');
      if (downloaded > 0) {
        toast({ title: '批量生成完成', description: `已生成 ${downloaded} 份相關表格` });
      }
    } catch (err: any) {
      toast({ title: '批量生成失敗', description: err.message, variant: 'destructive' });
      setPhase('done');
    } finally {
      setGenerating(false);
    }
  };

  const linkedFormsList = linkages.map(l => ({
    code: l.linked_form,
    label: getFormLinkageLabel(l.linked_form),
    desc: l.description,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            🔗 檢測到關聯表格
          </DialogTitle>
          <DialogDescription>
            {primaryFormName} 生成後，建議一併生成以下關聯表格：
          </DialogDescription>
        </DialogHeader>

        {phase === 'select' && (
          <>
            <div className="space-y-3 py-2">
              {linkedFormsList.map((lf) => (
                <label
                  key={lf.code}
                  className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={selected.has(lf.code)}
                    onCheckedChange={() => toggle(lf.code)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      {lf.label}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{lf.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                跳過
              </Button>
              <Button
                onClick={handleGenerateAll}
                disabled={selected.size === 0 || generating}
                className="bg-primary text-primary-foreground"
              >
                {generating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" />一併生成全部 ({selected.size})</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === 'generating' && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">正在生成關聯表格...</span>
          </div>
        )}

        {phase === 'done' && (
          <>
            <div className="space-y-2 py-2">
              {results.map((r) => (
                <div
                  key={r.form_code}
                  className={`flex items-center gap-3 p-3 border rounded-lg ${
                    r.success ? 'border-green-200 bg-green-50 dark:bg-green-950/20' : 'border-red-200 bg-red-50 dark:bg-red-950/20'
                  }`}
                >
                  <FileText className={`h-4 w-4 ${r.success ? 'text-green-600' : 'text-red-500'}`} />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{getFormLinkageLabel(r.form_code)}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.success ? '✅ 已生成並下載' : `❌ ${r.error || '失敗'}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>完成</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
