import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, Save, X } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { usePresenters, useUpsertPresenter, useDeletePresenter, Presenter } from '@/hooks/usePresenters';

const empty = (): Partial<Presenter> => ({ name: '', address: '', contact: '', type: 'individual' });

export const PresenterManagement = () => {
  const { data: presenters = [], isLoading } = usePresenters();
  const upsert = useUpsertPresenter();
  const del = useDeletePresenter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<Presenter>>(empty());

  const startEdit = (p: Presenter) => {
    setEditingId(p.id);
    setAdding(false);
    setForm({ ...p });
  };
  const startAdd = () => {
    setAdding(true);
    setEditingId(null);
    setForm(empty());
  };
  const cancel = () => {
    setEditingId(null);
    setAdding(false);
    setForm(empty());
  };

  const save = () => {
    if (!form.name) {
      toast({ title: '請填寫名稱', variant: 'destructive' });
      return;
    }
    upsert.mutate(form as any, {
      onSuccess: () => {
        toast({ title: editingId ? '已更新' : '已新增' });
        cancel();
      },
      onError: (e: any) => toast({ title: '儲存失敗', description: e.message, variant: 'destructive' }),
    });
  };

  const remove = (p: Presenter) => {
    if (!confirm(`確認刪除提交人「${p.name}」？`)) return;
    del.mutate(p.id, {
      onSuccess: () => toast({ title: '已刪除' }),
      onError: () => toast({ title: '刪除失敗', variant: 'destructive' }),
    });
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">提交人 Presenters</h2>
        <Button size="sm" onClick={startAdd} disabled={adding}>
          <Plus className="h-4 w-4 mr-1" /> 新增提交人
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        管理 NAR1 等表格的預設提交人選項（如 Paul Tang、Twinsail、個人）。
      </p>
      <div className="space-y-2">
        {adding && <PresenterForm form={form} setForm={setForm} onSave={save} onCancel={cancel} />}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中...</p>
        ) : presenters.length === 0 && !adding ? (
          <p className="text-sm text-muted-foreground">尚無提交人，點擊「新增」開始建立。</p>
        ) : (
          presenters.map(p =>
            editingId === p.id ? (
              <PresenterForm key={p.id} form={form} setForm={setForm} onSave={save} onCancel={cancel} />
            ) : (
              <div key={p.id} className="border border-border rounded-lg p-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {p.name}
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {p.type === 'tcsp' ? 'TCSP' : p.type === 'company' ? '公司' : '個人'}
                    </span>
                  </div>
                  {p.address && <div className="text-xs text-muted-foreground mt-0.5">{p.address}</div>}
                  {p.contact && <div className="text-xs text-muted-foreground mt-0.5">{p.contact}</div>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(p)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
};

function PresenterForm({ form, setForm, onSave, onCancel }: {
  form: Partial<Presenter>;
  setForm: (f: Partial<Presenter>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border border-primary/40 bg-primary/5 rounded-lg p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">名稱 *</Label>
          <Input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">類別</Label>
          <Select value={form.type || 'individual'} onValueChange={v => setForm({ ...form, type: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">個人 Individual</SelectItem>
              <SelectItem value="company">公司 Company</SelectItem>
              <SelectItem value="tcsp">TCSP 持牌公司</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 col-span-2">
          <Label className="text-xs">地址</Label>
          <Textarea rows={2} value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="space-y-1 col-span-2">
          <Label className="text-xs">聯絡資訊（電話／傳真／電郵／參考編號）</Label>
          <Textarea rows={2} value={form.contact || ''} onChange={e => setForm({ ...form, contact: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1" /> 取消
        </Button>
        <Button size="sm" onClick={onSave}>
          <Save className="h-3.5 w-3.5 mr-1" /> 儲存
        </Button>
      </div>
    </div>
  );
}
