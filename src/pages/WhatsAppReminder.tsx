import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Send, MessageCircle, Phone, AlertTriangle, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { useReminders } from '@/hooks/useReminders';

interface SendResult {
  companyName: string;
  phone: string;
  taskTitle: string;
  success: boolean;
  error?: string;
}

const WhatsAppReminder = () => {
  const { data: companies = [], isLoading: companiesLoading } = useCompanies();
  const { data: reminders = [], isLoading: remindersLoading } = useReminders();
  const [sendingTasks, setSendingTasks] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<SendResult[]>([]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parse YYYY-MM-DD as local date (not UTC) to match `today`
  const parseLocalDate = (dateStr: string): Date => {
    if (!dateStr) {
      console.warn('parseLocalDate: empty date string');
      return new Date(NaN);
    }
    const parts = dateStr.split('-');
    if (parts.length !== 3) {
      console.warn(`parseLocalDate: unexpected format "${dateStr}"`);
      return new Date(NaN);
    }
    const [y, m, d] = parts.map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) {
      console.warn(`parseLocalDate: non-numeric parts in "${dateStr}"`);
      return new Date(NaN);
    }
    const date = new Date(y, m - 1, d);
    if (isNaN(date.getTime())) {
      console.warn(`parseLocalDate: invalid date "${dateStr}"`);
      return new Date(NaN);
    }
    return date;
  };

  // Find companies with pending reminders that are overdue or due within 2 days
  const companiesWithUrgentTasks = useMemo(() => {
    return companies
      .map(company => {
        const companyReminders = reminders.filter(r =>
          r.company_id === company.id && r.status === 'pending'
        );

        const urgentTasks = companyReminders.filter(r => {
          if (!r.due_date) return false;
          const dueDate = parseLocalDate(r.due_date);
          const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return diffDays <= 2; // overdue (negative) or within 2 days
        });

        if (urgentTasks.length === 0) return null;

        return {
          company,
          urgentTasks,
          hasPhone: !!company.phone,
        };
      })
      .filter(Boolean) as {
      company: typeof companies[0];
      urgentTasks: typeof reminders;
      hasPhone: boolean;
    }[];
  }, [companies, reminders, today]);

  const totalUrgent = useMemo(
    () => companiesWithUrgentTasks.reduce((sum, c) => sum + c.urgentTasks.length, 0),
    [companiesWithUrgentTasks]
  );
  const withPhone = useMemo(
    () => companiesWithUrgentTasks.filter(c => c.hasPhone).length,
    [companiesWithUrgentTasks]
  );
  const withoutPhone = useMemo(
    () => companiesWithUrgentTasks.filter(c => !c.hasPhone).length,
    [companiesWithUrgentTasks]
  );

  const getUrgencyLabel = (diffDays: number): string => {
    if (diffDays < 0) return '已逾期';
    if (diffDays === 0) return '今日到期';
    return `${diffDays}日後到期`;
  };

  // Map reminder_type to readable Chinese label
  const TYPE_LABEL_MAP: Record<string, string> = {
    NAR1: '周年申報表 (NAR1)',
    IRD: '利得稅報稅表 (IRD)',
    BR: '商業登記續期 (BR)',
    CR: '公司註冊處申報',
    AUDIT: '審計報告',
    AGM: '股東週年大會',
    ND2A: '董事變更通知 (ND2A)',
    GENERAL: '一般任務',
  };

  const getTypeLabel = (reminderType: string): string => {
    return TYPE_LABEL_MAP[reminderType] || reminderType;
  };

  const buildMessage = (task: typeof reminders[0], company: typeof companies[0], diffDays: number): string => {
    if (!task.due_date) return '（任務缺少到期日）';
    const dueDate = parseLocalDate(task.due_date);
    const dateStr = dueDate.toLocaleDateString('zh-HK');
    const typeLabel = getTypeLabel(task.reminder_type || '');

    if (diffDays < 0) {
      return `Reminder: ${typeLabel} — ${task.title} 已逾期！\n公司: ${company.name}\n到期日: ${dateStr}`;
    }
    if (diffDays === 0) {
      return `Reminder: ${typeLabel} — ${task.title} 今日到期！\n公司: ${company.name}\n到期日: ${dateStr}`;
    }
    return `Reminder: ${typeLabel} — ${task.title} 即將到期（${diffDays}日後到期）\n公司: ${company.name}\n到期日: ${dateStr}`;
  };

  const handleSendSingle = async (
    company: typeof companies[0],
    task: typeof reminders[0],
  ) => {
    const taskKey = `${company.id}-${task.id}`;
    if (!task.due_date) {
        toast({ title: '發送失敗', description: '任務缺少到期日，無法發送', variant: 'destructive' });
        return;
    }
    const dueDate = parseLocalDate(task.due_date);
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const message = buildMessage(task, company, diffDays);

    setSendingTasks(prev => new Set(prev).add(taskKey));

    try {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          phone: company.phone,
          message,
          company_name: company.name,
          task_title: task.title,
        }),
      });
      const data = await resp.json();
      const ok = resp.ok && data.success;

      setResults(prev => [...prev, {
        companyName: company.name,
        phone: company.phone || '',
        taskTitle: task.title,
        success: ok,
        error: data.error,
      }]);

      if (ok) {
        toast({ title: '已發送', description: `WhatsApp 提醒已發送至 ${company.name}` });
      } else {
        toast({ title: '發送失敗', description: data.error || '未知錯誤', variant: 'destructive' });
      }
    } catch (e: any) {
      setResults(prev => [...prev, {
        companyName: company.name,
        phone: company.phone || '',
        taskTitle: task.title,
        success: false,
        error: e.message,
      }]);
      toast({ title: '發送失敗', description: e.message, variant: 'destructive' });
    } finally {
      setSendingTasks(prev => {
        const next = new Set(prev);
        next.delete(taskKey);
        return next;
      });
    }
  };

  const isLoading = companiesLoading || remindersLoading;

  return (
    <div>
      <PageHeader
        title="WhatsApp 提醒"
        description="檢查即將逾期或已逾期嘅任務，逐一發送 WhatsApp 提醒俾相關公司"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-2xl font-bold">{totalUrgent}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">緊急任務（逾期 / 2日內到期）</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-green-600">
              <Phone className="h-5 w-5" />
              <span className="text-2xl font-bold">{withPhone}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">有電話號碼嘅公司</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-red-500">
              <XCircle className="h-5 w-5" />
              <span className="text-2xl font-bold">{withoutPhone}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">欠電話號碼嘅公司</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-blue-600">
              <MessageCircle className="h-5 w-5" />
              <span className="text-2xl font-bold">{companiesWithUrgentTasks.length}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">受影響公司總數</p>
          </CardContent>
        </Card>
      </div>

      {/* Urgent Tasks Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[160px]">公司</TableHead>
              <TableHead className="w-[120px]">電話號碼</TableHead>
              <TableHead className="w-[90px]">類型</TableHead>
              <TableHead>任務</TableHead>
              <TableHead className="w-[110px]">到期日</TableHead>
              <TableHead className="w-[100px]">狀態</TableHead>
              <TableHead className="w-[90px] text-right">動作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin inline mr-2" />載入中...
                </TableCell>
              </TableRow>
            ) : companiesWithUrgentTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  冇緊急任務！所有任務都準時 ✅
                </TableCell>
              </TableRow>
            ) : (
              companiesWithUrgentTasks.flatMap(item =>
                item.urgentTasks.map(task => {
                  if (!task.due_date) return null;
                  const dueDate = parseLocalDate(task.due_date);
                  const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  const isOverdue = diffDays < 0;
                  const taskKey = `${item.company.id}-${task.id}`;
                  const isThisSending = sendingTasks.has(taskKey);

                  return (
                    <TableRow key={taskKey}>
                      <TableCell className="font-medium">{item.company.name}</TableCell>
                      <TableCell>
                        {item.hasPhone ? (
                          <span className="flex items-center gap-1 text-sm">
                            <Phone className="h-3 w-3 text-green-500" />
                            {item.company.phone}
                          </span>
                        ) : (
                          <Badge variant="destructive" className="text-xs">無電話</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[11px]">
                          {getTypeLabel(task.reminder_type || '')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{task.title}</TableCell>
                      <TableCell className="text-sm">{dueDate.toLocaleDateString('zh-HK')}</TableCell>
                      <TableCell>
                        {isOverdue ? (
                          <Badge variant="destructive" className="gap-1 text-xs">
                            <AlertTriangle className="h-3 w-3" /> 已逾期
                          </Badge>
                        ) : diffDays === 0 ? (
                          <Badge variant="destructive" className="gap-1 text-xs">
                            <Clock className="h-3 w-3" /> 今日到期
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <Clock className="h-3 w-3" /> {diffDays}日後
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={isOverdue ? 'destructive' : 'default'}
                          disabled={!item.hasPhone || isThisSending}
                          onClick={() => handleSendSingle(item.company, task)}
                          className="gap-1"
                        >
                          {isThisSending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          Send
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )
            )}
          </TableBody>
        </Table>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold mb-3">發送記錄</h3>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>公司</TableHead>
                  <TableHead>電話</TableHead>
                  <TableHead>任務</TableHead>
                  <TableHead className="w-[80px]">狀態</TableHead>
                  <TableHead>錯誤</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{r.companyName}</TableCell>
                    <TableCell className="text-sm">{r.phone}</TableCell>
                    <TableCell className="text-sm">{r.taskTitle}</TableCell>
                    <TableCell>
                      {r.success ? (
                        <Badge className="bg-green-600 gap-1">
                          <CheckCircle2 className="h-3 w-3" /> 已發送
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <XCircle className="h-3 w-3" /> 失敗
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.error || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppReminder;
