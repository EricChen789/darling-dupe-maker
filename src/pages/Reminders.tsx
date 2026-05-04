import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, CheckCircle2, Bell, Loader2, Wand2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useReminders, useUpsertReminder, useDeleteReminder, useUpdateReminderStatus, type Reminder } from '@/hooks/useReminders';
import { useCompanies } from '@/hooks/useCompanies';
import { useUserRole } from '@/hooks/useUserRole';

function addDays(d: Date, days: number) { const c = new Date(d); c.setDate(c.getDate() + days); return c; }
function fmtISO(d: Date) { return d.toISOString().slice(0, 10); }
function statusColor(s: string) {
  if (s === 'completed') return 'default';
  if (s === 'overdue') return 'destructive';
  if (s === 'submitted') return 'secondary';
  return 'outline';
}

export default function Reminders() {
  const { data: reminders = [], isLoading } = useReminders();
  const { data: companies = [] } = useCompanies();
  const upsert = useUpsertReminder();
  const del = useDeleteReminder();
  const updateStatus = useUpdateReminderStatus();
  const { canDelete } = useUserRole();

  const [editing, setEditing] = useState<Partial<Reminder> | null>(null);
  const [generating, setGenerating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const enriched = useMemo(() => {
    let list = reminders.map(r => {
      const due = r.due_date ? new Date(r.due_date) : null;
      const isOverdue = !!due && r.status === 'pending' && due < today;
      return { ...r, _isOverdue: isOverdue, _company: companies.find(c => c.id === r.company_id) };
    });
    if (statusFilter !== 'all') {
      list = list.filter(r => statusFilter === 'overdue' ? r._isOverdue : r.status === statusFilter);
    }
    list.sort((a, b) => {
      const da = a.due_date || ''; const db = b.due_date || '';
      return sortDir === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
    });
    return list;
  }, [reminders, companies, today, statusFilter, sortDir]);


  const handleAutoGenerate = async () => {
    setGenerating(true);
    try {
      let created = 0;
      for (const c of companies) {
        if (!c.incorporationDate) continue;
        const inc = new Date(c.incorporationDate);
        if (isNaN(inc.getTime())) continue;
        const thisYear = new Date();
        thisYear.setMonth(inc.getMonth(), inc.getDate());
        if (thisYear < new Date()) thisYear.setFullYear(thisYear.getFullYear() + 1);
        const due = addDays(thisYear, 42);
        const dueStr = fmtISO(due);
        const exists = reminders.some(r => r.company_id === c.id && r.reminder_type === 'NAR1' && r.due_date === dueStr);
        if (exists) continue;
        await upsert.mutateAsync({
          company_id: c.id, reminder_type: 'NAR1',
          title: `${c.name} — NAR1 周年申報`, due_date: dueStr, status: 'pending',
          notes: `成立週年 ${fmtISO(thisYear)} + 42 日`,
        });
        created++;
      }
      toast({ title: `已建立 ${created} 筆 NAR1 提醒` });
    } catch (e: any) {
      toast({ title: '生成失敗', description: e.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = () => {
    if (!editing?.company_id || !editing.due_date || !editing.title) {
      toast({ title: '請填寫公司、標題、到期日', variant: 'destructive' });
      return;
    }
    upsert.mutate(editing, {
      onSuccess: () => { toast({ title: '已儲存' }); setEditing(null); },
      onError: (e: any) => toast({ title: '儲存失敗', description: e.message, variant: 'destructive' }),
    });
  };

  return (
    <div>
      <PageHeader
        title="周年申報提醒"
        description="管理 NAR1、IRD、SCR 及其他申報提醒，自動依公司成立日期生成 NAR1 提醒。"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleAutoGenerate} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
              自動生成 NAR1 提醒
            </Button>
            <Button size="sm" className="bg-primary text-primary-foreground"
              onClick={() => setEditing({ reminder_type: 'NAR1', status: 'pending', due_date: fmtISO(new Date()) })}>
              <Plus className="h-4 w-4 mr-1" /> 新增提醒
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <p className="text-muted-foreground text-sm">載入中...</p>
      ) : enriched.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
          尚無提醒記錄。點擊「自動生成 NAR1 提醒」依成立日期建立。
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="text-left p-3">到期日</th>
                <th className="text-left p-3">類型</th>
                <th className="text-left p-3">公司</th>
                <th className="text-left p-3">標題</th>
                <th className="text-left p-3">狀態</th>
                <th className="text-left p-3">備註</th>
                <th className="text-right p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs">{r.due_date}</td>
                  <td className="p-3"><Badge variant="outline" className="text-xs">{r.reminder_type}</Badge></td>
                  <td className="p-3">{r._company?.name || <span className="text-muted-foreground">(已刪除)</span>}</td>
                  <td className="p-3">{r.title}</td>
                  <td className="p-3">
                    <Badge variant={statusColor(r._isOverdue ? 'overdue' : r.status) as any} className="text-xs">
                      {r._isOverdue ? '逾期' : r.status === 'pending' ? '待辦' : r.status === 'submitted' ? '已提交' : r.status === 'completed' ? '已完成' : r.status}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground max-w-xs truncate">{r.notes}</td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      {r.status !== 'completed' && (
                        <Button size="sm" variant="ghost" className="h-7 px-2"
                          onClick={() => updateStatus.mutate({ id: r.id, status: 'completed' })}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(r)}>編輯</Button>
                      {canDelete && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive"
                          onClick={() => del.mutate(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? '編輯提醒' : '新增提醒'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">公司</Label>
                <Select value={editing.company_id || ''} onValueChange={v => setEditing({ ...editing, company_id: v })}>
                  <SelectTrigger><SelectValue placeholder="選擇公司" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">類型</Label>
                  <Select value={editing.reminder_type || 'NAR1'} onValueChange={v => setEditing({ ...editing, reminder_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NAR1">NAR1 周年申報</SelectItem>
                      <SelectItem value="IRD">IRD 報稅</SelectItem>
                      <SelectItem value="SCR">SCR 更新</SelectItem>
                      <SelectItem value="BR_RENEWAL">商業登記續期</SelectItem>
                      <SelectItem value="OTHER">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">狀態</Label>
                  <Select value={editing.status || 'pending'} onValueChange={v => setEditing({ ...editing, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">待辦</SelectItem>
                      <SelectItem value="submitted">已提交</SelectItem>
                      <SelectItem value="completed">已完成</SelectItem>
                      <SelectItem value="ignored">已忽略</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1"><Label className="text-xs">標題</Label><Input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">到期日</Label><Input type="date" value={editing.due_date || ''} onChange={e => setEditing({ ...editing, due_date: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">備註</Label><Input value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>取消</Button>
                <Button size="sm" onClick={handleSave} disabled={upsert.isPending} className="bg-primary text-primary-foreground">
                  {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null} 儲存
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
