import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Loader2, Save, X, Edit } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  useSecretaryTemplates,
  useSaveSecretaryTemplate,
  useDeleteSecretaryTemplate,
  SecretaryTemplate,
} from '@/hooks/useSecretaryTemplates';
import { toast } from '@/hooks/use-toast';

const empty = (): Partial<SecretaryTemplate> => ({
  label: '', identity: 'corporate', nameEnglish: '', nameChinese: '',
  idNumber: '', brNumber: '', tcspNumber: '', placeIncorporated: '',
  address: '', serviceAddress: '', email: '', phone: '', isDefault: false,
});

export function SecretaryTemplateManagement() {
  const { data: templates = [], isLoading } = useSecretaryTemplates();
  const save = useSaveSecretaryTemplate();
  const remove = useDeleteSecretaryTemplate();
  const [editing, setEditing] = useState<Partial<SecretaryTemplate> | null>(null);

  const handleSave = () => {
    if (!editing?.label || !editing?.nameEnglish) {
      toast({ title: '請填寫標籤與英文名稱', variant: 'destructive' });
      return;
    }
    save.mutate(editing, {
      onSuccess: () => {
        toast({ title: editing.id ? '範本已更新' : '範本已新增' });
        setEditing(null);
      },
      onError: (e: any) => toast({ title: '儲存失敗', description: e.message, variant: 'destructive' }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">公司秘書範本</h2>
          <p className="text-xs text-muted-foreground">
            常用秘書資料儲存為範本，新增公司時可一鍵套用，免去重複輸入。
          </p>
        </div>
        {!editing && (
          <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setEditing(empty())}>
            <Plus className="h-4 w-4 mr-1" /> 新增範本
          </Button>
        )}
      </div>

      {editing && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">範本名稱 *</Label>
              <Input value={editing.label || ''} onChange={e => setEditing({ ...editing, label: e.target.value })} placeholder="例：Twinsail Secretary" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">類型</Label>
              <Select value={editing.identity || 'corporate'} onValueChange={v => setEditing({ ...editing, identity: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="corporate">法人</SelectItem>
                  <SelectItem value="natural">自然人</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">英文名稱 *</Label>
              <Input value={editing.nameEnglish || ''} onChange={e => setEditing({ ...editing, nameEnglish: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">中文名稱</Label>
              <Input value={editing.nameChinese || ''} onChange={e => setEditing({ ...editing, nameChinese: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">商業登記號碼 / 編號</Label>
              <Input value={editing.brNumber || ''} onChange={e => setEditing({ ...editing, brNumber: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">TCSP 號碼</Label>
              <Input value={editing.tcspNumber || ''} onChange={e => setEditing({ ...editing, tcspNumber: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">身份證/HKID</Label>
              <Input value={editing.idNumber || ''} onChange={e => setEditing({ ...editing, idNumber: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">註冊地</Label>
              <Input value={editing.placeIncorporated || ''} onChange={e => setEditing({ ...editing, placeIncorporated: e.target.value })} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">地址</Label>
              <Textarea rows={2} value={editing.address || ''} onChange={e => setEditing({ ...editing, address: e.target.value })} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">服務地址</Label>
              <Textarea rows={2} value={editing.serviceAddress || ''} onChange={e => setEditing({ ...editing, serviceAddress: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">電郵</Label>
              <Input value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">電話</Label>
              <Input value={editing.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 col-span-2">
              <Switch checked={!!editing.isDefault} onCheckedChange={v => setEditing({ ...editing, isDefault: v })} />
              <Label className="text-xs">設為預設範本（新公司自動建議）</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              <X className="h-4 w-4 mr-1" /> 取消
            </Button>
            <Button size="sm" className="bg-primary text-primary-foreground" onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              儲存
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中...</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚無範本</p>
        ) : (
          templates.map(t => (
            <div key={t.id} className="flex items-center justify-between rounded-md border p-3 bg-card">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{t.label}</span>
                  {t.isDefault && <Badge variant="default" className="text-xs">預設</Badge>}
                  <Badge variant="outline" className="text-xs">{t.identity === 'natural' ? '自然人' : '法人'}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t.nameEnglish}{t.nameChinese ? ` · ${t.nameChinese}` : ''}{t.brNumber ? ` · BR: ${t.brNumber}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive"
                  onClick={() => {
                    if (!confirm(`確定刪除範本「${t.label}」？`)) return;
                    remove.mutate(t.id, {
                      onSuccess: () => toast({ title: '範本已刪除' }),
                      onError: (e: any) => toast({ title: '刪除失敗', description: e.message, variant: 'destructive' }),
                    });
                  }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
