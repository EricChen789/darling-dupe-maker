import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useFormHistoryList, useDeleteFormHistory } from '@/hooks/useFormHistory';
import { History, Loader2, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface FormHistorySelectorProps {
  formType: string;
  onSelect: (formData: any) => void;
}

export default function FormHistorySelector({ formType, onSelect }: FormHistorySelectorProps) {
  const { data: historyList = [], isLoading } = useFormHistoryList(formType);
  const deleteMutation = useDeleteFormHistory();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string | number; label: string } | null>(null);

  if (isLoading) return null;

  if (!historyList || historyList.length === 0) {
    return (
      <div className="bg-muted/30 border border-border rounded-lg p-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">載入過往提交紀錄</h3>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          尚無歷史紀錄，生成 PDF 後會自動儲存于此。
        </p>
      </div>
    );
  }

  const handleSelect = async (id: string) => {
    if (!id) return;
    setLoadingId(id);
    const t = localStorage.getItem('secretary_jwt') || '';
    try {
      const resp = await fetch(`/api/form-history/load?id=${id}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `Server error (${resp.status})`);
      }
      const item = await resp.json();
      const data = item.entry?.form_data;
      if (!data) {
        toast({ title: '載入提示', description: '此紀錄沒有儲存的表單資料' });
        return;
      }
      onSelect(data);
      toast({ title: '已載入', description: `已載入過往紀錄：${item.entry?.label || id}` });
    } catch (err: any) {
      toast({ title: '載入失敗', description: err.message, variant: 'destructive' });
    } finally {
      setLoadingId(null);
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { id: deleteTarget.id, formType },
      {
        onSuccess: () => {
          toast({ title: '已刪除', description: `「${deleteTarget.label}」已刪除，序號已自動更新` });
          setDeleteTarget(null);
        },
        onError: (err: any) => {
          toast({ title: '刪除失敗', description: err.message, variant: 'destructive' });
          setDeleteTarget(null);
        },
      }
    );
  };

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">載入過往提交紀錄</h3>
        {loadingId && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <span className="text-xs text-muted-foreground ml-auto">共 {historyList.length} 次</span>
      </div>

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {historyList.map(h => (
          <div
            key={String(h.id)}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-background hover:bg-accent/30 transition-colors"
          >
            <span className="flex-1 text-sm truncate">{h.label}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={loadingId === String(h.id)}
              onClick={() => handleSelect(String(h.id))}
            >
              {loadingId === String(h.id) ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                '載入'
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
              disabled={deleteMutation.isPending}
              onClick={() => setDeleteTarget({ id: h.id, label: h.label })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        點擊「載入」自動填入所有欄位；點擊垃圾桶圖示刪除紀錄。請核對資料後再生成 PDF。
      </p>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認刪除</AlertDialogTitle>
            <AlertDialogDescription>
              確定要刪除「{deleteTarget?.label}」嗎？此操作無法復原，刪除後其餘紀錄的序號會自動遞補。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
