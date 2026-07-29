// NAR1 Changes Summary component (Phase 4.3)
// Shows change events for the current NAR1 period, displayed in the FormWizard
// between company selection (Step 1) and form filling (Step 2+).

import { useNAR1Changes } from '@/hooks/useNAR1Status';
import { EVENT_TYPE_LABELS } from '@/hooks/useChangeEvents';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, Clock, UserPlus, UserMinus, ArrowRightLeft, Building2, MapPin, FileText, Users } from 'lucide-react';
import type { NAR1ChangesSummary as NCSummary, ChangeEvent } from '@/hooks/useNAR1Status';

interface NAR1ChangesSummaryProps {
  companyId: string;
  periodId?: string;
  /** Called when user clicks "continue" after reviewing changes */
  onContinue?: () => void;
}

const EVENT_ICONS: Record<string, React.ReactNode> = {
  director_appoint: <UserPlus className="h-3.5 w-3.5 text-green-500" />,
  director_cease: <UserMinus className="h-3.5 w-3.5 text-red-500" />,
  secretary_appoint: <UserPlus className="h-3.5 w-3.5 text-blue-500" />,
  secretary_cease: <UserMinus className="h-3.5 w-3.5 text-orange-500" />,
  shareholder_add: <Users className="h-3.5 w-3.5 text-green-500" />,
  shareholder_remove: <Users className="h-3.5 w-3.5 text-red-500" />,
  share_transfer: <ArrowRightLeft className="h-3.5 w-3.5 text-purple-500" />,
  share_allotment: <FileText className="h-3.5 w-3.5 text-indigo-500" />,
  address_change: <MapPin className="h-3.5 w-3.5 text-amber-500" />,
  name_change: <Building2 className="h-3.5 w-3.5 text-cyan-500" />,
};

function formatChangeValue(evt: ChangeEvent): string | null {
  if (!evt.new_value) return null;
  try {
    const v = JSON.parse(evt.new_value);
    if (evt.event_type === 'address_change') {
      const parts = [v.reg_flat, v.reg_building, v.reg_street, v.reg_district, v.reg_region].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : null;
    }
    if (evt.event_type === 'name_change') {
      return v.name || v.chinese_name || null;
    }
    if (evt.event_type === 'director_appoint' || evt.event_type === 'secretary_appoint') {
      return v.name_english || v.name_chinese || null;
    }
    return null;
  } catch {
    return evt.new_value.length > 80 ? evt.new_value.substring(0, 80) + '...' : evt.new_value;
  }
}

function SummaryStat({ label, count, icon }: { label: string; count: number; icon: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-xs">
      {icon}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{count}</span>
    </div>
  );
}

export function NAR1ChangesSummary({ companyId, periodId, onContinue }: NAR1ChangesSummaryProps) {
  const { data, isLoading, error } = useNAR1Changes(companyId, periodId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Clock className="h-8 w-8 mx-auto mb-3 animate-pulse" />
          <p>正在載入本年度變更記錄...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-amber-500" />
          <p>無法載入變更記錄</p>
          <p className="text-xs mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </CardContent>
      </Card>
    );
  }

  const summary: NCSummary = data?.summary || { total_changes: 0, director_appointments: 0, director_cessations: 0, secretary_appointments: 0, secretary_cessations: 0, shareholder_changes: 0, share_transfers: 0, share_allotments: 0, address_changes: 0, name_changes: 0, other_changes: 0 };
  const changes: ChangeEvent[] = data?.changes || [];
  const period = data?.period;

  const hasChanges = summary.total_changes > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          NAR1 本年度變更摘要
          {period && (
            <span className="text-sm font-normal text-muted-foreground">
              ({period.period_start} ~ {period.period_end})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        {hasChanges ? (
          <>
            <div className="flex flex-wrap gap-2">
              <SummaryStat label="委任董事" count={summary.director_appointments} icon={<UserPlus className="h-3 w-3 text-green-500" />} />
              <SummaryStat label="董事辭任" count={summary.director_cessations} icon={<UserMinus className="h-3 w-3 text-red-500" />} />
              <SummaryStat label="委任秘書" count={summary.secretary_appointments} icon={<UserPlus className="h-3 w-3 text-blue-500" />} />
              <SummaryStat label="秘書辭任" count={summary.secretary_cessations} icon={<UserMinus className="h-3 w-3 text-orange-500" />} />
              <SummaryStat label="股東變更" count={summary.shareholder_changes} icon={<Users className="h-3 w-3 text-purple-500" />} />
              <SummaryStat label="股份轉讓" count={summary.share_transfers} icon={<ArrowRightLeft className="h-3 w-3 text-purple-500" />} />
              <SummaryStat label="股份配發" count={summary.share_allotments} icon={<FileText className="h-3 w-3 text-indigo-500" />} />
              <SummaryStat label="地址變更" count={summary.address_changes} icon={<MapPin className="h-3 w-3 text-amber-500" />} />
              <SummaryStat label="名稱變更" count={summary.name_changes} icon={<Building2 className="h-3 w-3 text-cyan-500" />} />
            </div>

            {/* Change timeline */}
            {changes.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                <h4 className="text-xs font-medium text-muted-foreground">變更記錄</h4>
                {changes.map((evt) => (
                  <div key={evt.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/30 text-xs">
                    <span className="mt-0.5 shrink-0">
                      {EVENT_ICONS[evt.event_type] || <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          {evt.change_date}
                        </Badge>
                        <span className="font-medium">{EVENT_TYPE_LABELS[evt.event_type] || evt.event_type}</span>
                      </div>
                      {formatChangeValue(evt) && (
                        <p className="text-muted-foreground mt-0.5 truncate">{formatChangeValue(evt)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-6">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-400" />
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              本年度無任何變更
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {period
                ? `${period.period_start} ~ ${period.period_end} 期間無需申報的變更事項`
                : '尚未建立 NAR1 申報期'}
            </p>
            {onContinue && (
              <button
                onClick={onContinue}
                className="mt-4 text-xs text-primary hover:underline"
              >
                繼續填寫 NAR1 表格 →
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
