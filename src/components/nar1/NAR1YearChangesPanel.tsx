// NAR1YearChangesPanel — NAR1 生成對話框內的「本年度變動」面板（只讀，無生成表格按鈕）。
// 資料來自 /api/nar1-snapshot 的 changes（窗口 [periodStart, returnDate] 閉區間，日期倒序），
// 日期分組列表復用 TabChangeEventsFooter 的 groupByDay/dayLabelOf。
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, CalendarDays, History } from 'lucide-react';
import { EVENT_TYPE_LABELS, dayKeyOf, type ChangeEvent } from '@/hooks/useChangeEvents';
import { groupByDay, dayLabelOf } from '@/components/forms/TabChangeEventsFooter';

// ── 事件詳情（名稱／交易描述，與 footer 的 extractPersonName/extractTxDesc 同款邏輯）──
// 快照端點返回原始 change_events 行（無 person_name enrich）→ 從 old/new_value JSON 取。
function eventDetail(ev: ChangeEvent): string {
  const sources = ev.event_type.endsWith('_cease') || ev.event_type === 'shareholder_remove'
    ? [ev.old_value, ev.new_value]
    : [ev.new_value, ev.old_value];
  for (const src of sources) {
    if (!src) continue;
    try {
      const raw: Record<string, any> = typeof src === 'string' ? JSON.parse(src) : src;
      const en = raw.name_english || raw.nameEnglish || raw.name || raw.company_name || '';
      const cn = raw.name_chinese || raw.nameChinese || '';
      if (en || cn) return cn ? `${en} (${cn})` : en;
      const from = raw.from_name || raw.fromName || '';
      const to = raw.to_name || raw.toName || '';
      const sh = raw.shares || 0;
      if (from || to) {
        return `${from || '（新發行）'} → ${to || '—'}${sh ? `，${Number(sh).toLocaleString()} 股` : ''}`;
      }
    } catch { /* try next source */ }
  }
  return ev.person_name || '';
}

interface NAR1YearChangesPanelProps {
  loading: boolean;
  failed: boolean;
  period: { start: string; end: string } | null;
  changes: any[];
}

export function NAR1YearChangesPanel({ loading, failed, period, changes }: NAR1YearChangesPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const groups = useMemo(() => groupByDay(changes as ChangeEvent[]), [changes]);

  const periodLabel = period
    ? `${dayLabelOf(dayKeyOf(period.start))} – ${dayLabelOf(dayKeyOf(period.end))}`
    : '';

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <History className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-foreground">本年度變動</span>
        {periodLabel && <span className="font-mono text-muted-foreground">（{periodLabel}）</span>}
        {loading ? (
          <span className="text-muted-foreground">載入中…</span>
        ) : failed ? (
          <span className="text-muted-foreground">快照不可用</span>
        ) : (
          <Badge variant="secondary" className="text-[10px] h-4 px-1">{changes.length}</Badge>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 pl-5 border-l-2 border-amber-200/70 ml-1.5">
          {loading && <p className="text-xs text-muted-foreground italic">正在載入本年度變更記錄…</p>}
          {!loading && failed && (
            <p className="text-xs text-muted-foreground">自動化快照載入失敗，已改用公司當前資料填入，變動清單不可用。</p>
          )}
          {!loading && !failed && groups.length === 0 && (
            <p className="text-xs text-muted-foreground">本年度無任何變更。</p>
          )}
          {!loading && !failed && groups.map(group => (
            <div key={group.dayKey || '__unknown__'}>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CalendarDays className="h-3 w-3 shrink-0" />
                <span className="font-mono">{group.dayLabel}</span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1">{group.events.length}</Badge>
              </div>
              <div className="mt-0.5 space-y-0.5 pl-4">
                {group.events.map(ev => (
                  <div key={ev.id} className="flex items-center gap-2 rounded-sm py-0.5 text-xs">
                    <Badge variant="outline" className="text-[10px] py-0 shrink-0">
                      {EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}
                    </Badge>
                    <span className="truncate text-muted-foreground">{eventDetail(ev) || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
