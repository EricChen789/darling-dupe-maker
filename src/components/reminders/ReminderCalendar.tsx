import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Reminder } from '@/hooks/useReminders';

export interface EnrichedReminder extends Reminder {
  _isOverdue?: boolean;
  _company?: { id: string; name: string } | undefined;
}

interface Props {
  reminders: EnrichedReminder[];
  onSelect: (r: EnrichedReminder) => void;
}

const WEEK_HEADERS = ['日', '一', '二', '三', '四', '五', '六'];

// 依狀態（含逾期）決定提醒色塊樣式
function chipClass(r: EnrichedReminder): string {
  if (r._isOverdue) return 'bg-destructive/15 text-destructive border-destructive/40';
  switch (r.status) {
    case 'completed': return 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/40';
    case 'submitted': return 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40';
    case 'ignored':   return 'bg-muted text-muted-foreground border-border';
    default:          return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40'; // pending
  }
}

function ymd(d: Date) {
  // 以本地時間輸出 YYYY-MM-DD，避免 UTC 位移
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ReminderCalendar({ reminders, onSelect }: Props) {
  const todayStr = ymd(new Date());
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });

  // 依 due_date 分組（YYYY-MM-DD → 提醒陣列）
  const byDate = useMemo(() => {
    const map: Record<string, EnrichedReminder[]> = {};
    for (const r of reminders) {
      const key = (r.due_date || '').slice(0, 10);
      if (!key) continue;
      (map[key] ||= []).push(r);
    }
    return map;
  }, [reminders]);

  // 建立 6 週 × 7 天格線（含前後月溢出格）
  const cells = useMemo(() => {
    const first = new Date(cursor);
    const startOffset = first.getDay(); // 0=Sun
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startOffset);
    const out: { date: Date; inMonth: boolean; key: string }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      out.push({ date: d, inMonth: d.getMonth() === cursor.getMonth(), key: ymd(d) });
    }
    return out;
  }, [cursor]);

  const monthLabel = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;
  const shift = (n: number) => {
    const d = new Date(cursor); d.setMonth(cursor.getMonth() + n); setCursor(d);
  };
  const goToday = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCursor(d); };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* 月份導航 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <span className="font-semibold">{monthLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => shift(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={goToday}>今天</Button>
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => shift(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 星期表頭 */}
      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground border-b border-border">
        {WEEK_HEADERS.map((w, i) => (
          <div key={w} className={cn('py-2 font-medium', (i === 0 || i === 6) && 'text-destructive/70')}>{w}</div>
        ))}
      </div>

      {/* 日期格 */}
      <div className="grid grid-cols-7">
        {cells.map(({ date, inMonth, key }) => {
          const items = byDate[key] || [];
          const isToday = key === todayStr;
          const hasOverdue = items.some(r => r._isOverdue);
          return (
            <div
              key={key}
              className={cn(
                'min-h-[96px] border-b border-r border-border p-1.5 flex flex-col gap-1',
                !inMonth && 'bg-muted/20',
                hasOverdue && 'bg-destructive/5',
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  'text-xs w-5 h-5 flex items-center justify-center rounded-full',
                  isToday && 'bg-primary text-primary-foreground font-semibold',
                  !inMonth && 'text-muted-foreground/50',
                )}>
                  {date.getDate()}
                </span>
                {items.length > 0 && (
                  <span className={cn(
                    'text-[10px] px-1 rounded',
                    hasOverdue ? 'text-destructive font-semibold' : 'text-muted-foreground',
                  )}>
                    {items.length}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {items.slice(0, 3).map(r => (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r)}
                    title={`${r._company?.name || ''}｜${r.title}`}
                    className={cn(
                      'text-[10px] leading-tight px-1 py-0.5 rounded border text-left truncate hover:brightness-95 transition',
                      chipClass(r),
                    )}
                  >
                    {r.reminder_type}｜{r._company?.name || r.title}
                  </button>
                ))}
                {items.length > 3 && (
                  <span className="text-[10px] text-muted-foreground px-1">+{items.length - 3} 更多…</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 圖例 */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border">
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-destructive/40 inline-block" /> 逾期</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 inline-block" /> 待辦</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-blue-500/40 inline-block" /> 已提交</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-green-500/40 inline-block" /> 已完成</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-muted inline-block border border-border" /> 已忽略</span>
      </div>
    </div>
  );
}
