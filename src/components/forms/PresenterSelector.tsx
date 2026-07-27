import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePresenterList, useCreatePresenter, useDeletePresenter, type Presenter } from '@/hooks/usePresenters';
import { UserCheck, Loader2, Trash2, Save } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PresenterData {
  name?: string;
  address?: string;
  phone?: string;
  fax?: string;
  email?: string;
  reference?: string;
  contact?: string;
  // NN1 bilingual
  nameChinese?: string;
  nameEnglish?: string;
}

interface PresenterSelectorProps {
  currentData: PresenterData;
  onSelect: (presenter: Presenter) => void;
}

export default function PresenterSelector({ currentData, onSelect }: PresenterSelectorProps) {
  const { data: presenters = [], isLoading } = usePresenterList();
  const saveMutation = useCreatePresenter();
  const deleteMutation = useDeletePresenter();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Presenter | null>(null);

  const handleSelect = (id: string) => {
    const p = presenters.find(pr => pr.id === id);
    if (p) {
      onSelect(p);
      toast({ title: '已載入', description: `提交人「${p.name}」的資料已自動填入` });
    }
  };

  const handleSave = async () => {
    if (!saveName.trim()) {
      toast({ title: '請輸入名稱', description: '必須為此提交人提供一個名稱', variant: 'destructive' });
      return;
    }
    saveMutation.mutate(
      {
        name: saveName.trim(),
        address: currentData.address || '',
        contact: currentData.contact || currentData.phone || '',
        type: 'individual',
        phone: currentData.phone || '',
        fax: currentData.fax || '',
        email: currentData.email || '',
        reference: currentData.reference || '',
      },
      {
        onSuccess: () => {
          toast({ title: '已儲存', description: `提交人「${saveName.trim()}」已儲存` });
          setShowSaveDialog(false);
          setSaveName('');
        },
        onError: (err: any) => {
          toast({ title: '儲存失敗', description: err.message, variant: 'destructive' });
        },
      }
    );
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ title: '已刪除', description: `提交人「${deleteTarget.name}」已刪除` });
        setDeleteTarget(null);
      },
      onError: (err: any) => {
        toast({ title: '刪除失敗', description: err.message, variant: 'destructive' });
        setDeleteTarget(null);
      },
    });
  };

  if (isLoading) return null;

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <UserCheck className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">常用提交人</h3>
        {presenters.length > 0 && (
          <span className="text-xs text-muted-foreground">{presenters.length} 位</span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          onClick={() => {
            setSaveName(currentData.name || '');
            setShowSaveDialog(true);
          }}
        >
          <Save className="h-3 w-3 mr-1" />
          儲存當前
        </Button>
      </div>

      {presenters.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          尚無已儲存的提交人。填寫好上方提交人資料後，點擊「儲存當前」建立一筆紀錄，下次便可一鍵載入。
        </p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {presenters.map(p => (
            <div
              key={p.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background hover:bg-accent/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {[p.phone, p.email].filter(Boolean).join(' · ') || p.address?.slice(0, 40) || '(無詳細資料)'}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => handleSelect(p.id)}
              >
                載入
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                disabled={deleteMutation.isPending}
                onClick={() => setDeleteTarget(p)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Save dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>儲存為常用提交人</DialogTitle>
            <DialogDescription>
              為此提交人設定一個易記的名稱，下次便可一鍵載入全部資料
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>名稱 *</Label>
              <Input
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder="例如：陳大文 / Paul Tang Office"
                className="mt-1"
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>將儲存以下資料：</div>
              {currentData.address && <div>地址：{currentData.address.slice(0, 60)}</div>}
              {currentData.phone && <div>電話：{currentData.phone}</div>}
              {currentData.fax && <div>傳真：{currentData.fax}</div>}
              {currentData.email && <div>電郵：{currentData.email}</div>}
              {currentData.reference && <div>檔號：{currentData.reference}</div>}
              {!currentData.address && !currentData.phone && !currentData.email && (
                <div className="text-amber-500">⚠️ 目前提交人資料為空，請先在上方填寫後再儲存</div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              儲存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認刪除</AlertDialogTitle>
            <AlertDialogDescription>
              確定要刪除提交人「{deleteTarget?.name}」嗎？此操作無法復原。
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
