import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Database } from 'lucide-react';
import type { WritebackSummaryItem } from '@/lib/formWriteback';

interface ConfirmWritebackDialogProps {
  open: boolean;
  title: string;
  summary: WritebackSummaryItem[];
  /** 公司解析成功 → 正常寫回；失敗 → warning 變體「仍然生成（不寫回資料庫）」 */
  canWrite: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmWritebackDialog({ open, title, summary, canWrite, onConfirm, onCancel }: ConfirmWritebackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {canWrite
              ? '生成 PDF 的同時，本表格中的資料將寫入公司檔案資料庫（人員、職位及變更紀錄）。'
              : '未能根據商業登記號碼在資料庫找到這家公司。'}
          </DialogDescription>
        </DialogHeader>

        {summary.length > 0 && (
          <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 max-h-60 overflow-y-auto">
            {summary.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Database className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <div>
                  <div>{s.label}</div>
                  {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {!canWrite && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>只會生成 PDF，不會寫入任何資料庫記錄。</span>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={onConfirm} className="bg-primary text-primary-foreground">
            {canWrite ? '確認並生成' : '仍然生成（不寫回資料庫）'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
