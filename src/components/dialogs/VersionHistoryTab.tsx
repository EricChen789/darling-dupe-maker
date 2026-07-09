import { useMemo, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { FileText, History, Loader2, StickyNote } from 'lucide-react';
import { Company } from '@/types';
import { useCompanyLogs, type CompanyLog } from '@/hooks/useCompanyLogs';

// 文件類型 → 繁體中文標籤
const DOC_TYPE_LABEL: Record<string, string> = {
  ROD: '董事登記冊',
  ROM: '成員登記冊',
  CI_BR: '公司註冊證 / 商業登記',
  NAR1: '周年申報表 (NAR1)',
  ND2A: '委任／停任董事秘書 (ND2A)',
  ND2B: '更改董事秘書詳情 (ND2B)',
  ND4: '董事秘書辭任 (ND4)',
  NSC1: '股份分配申報 (NSC1)',
  NNC1: '法團成立 (NNC1)',
  NNC2: '更改公司名稱 (NNC2)',
  MINUTES: '會議紀錄',
  BOARD_MINUTES: '董事會會議紀錄',
  SHAREHOLDER_RESOLUTION: '股東決議',
  SHARE_TRANSFER: '股份轉讓',
  BANKING: '銀行文件',
  CORRESPONDENCE: '往來函件',
  BIR51: '利得稅報稅表 (BIR51)',
  AUDIT: '審計報告',
  AUDIT_REPORT: '審計報告',
  BR_RENEWAL: '商業登記續期',
  WINDING_UP: '清盤',
  WINDING_UP_ORDER: '清盤令',
  STATEMENT_OF_AFFAIRS: '財務狀況說明書 (s.190)',
  STRIKE_OFF: '除名',
  CR_STRIKE_OFF: '公司註冊處除名 (s.744)',
  CR_DISSOLUTION: '公司解散 (s.746)',
  OTHER: '其他',
};

const docTypeLabel = (t: string) => DOC_TYPE_LABEL[t] || t || '文件';

const docTypeVariant = (t: string): 'default' | 'secondary' | 'outline' => {
  if (t === 'ROD' || t === 'NAR1') return 'default';
  if (t === 'ROM' || t === 'SHARE_TRANSFER' || t === 'BOARD_MINUTES') return 'secondary';
  return 'outline';
};

// 取一個可顯示的日期：優先 doc_date，其次 created_at
const displayDate = (log: CompanyLog): string => {
  if (log.doc_date) return log.doc_date;
  if (log.created_at) {
    const d = new Date(log.created_at);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('zh-HK');
  }
  return '—';
};

// 用於排序的時間戳（doc_date 或 created_at）
const sortKey = (log: CompanyLog): number => {
  const raw = log.doc_date || log.created_at || '';
  const t = new Date(raw).getTime();
  return isNaN(t) ? 0 : t;
};

export function VersionHistoryTab({ company, title = '版本歷史', icon }: { company: Company; title?: string; icon?: ReactNode }) {
  const { data: logs = [], isLoading } = useCompanyLogs({ companyId: company.id });

  const sorted = useMemo(
    () => [...logs].sort((a, b) => sortKey(b) - sortKey(a)),
    [logs]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> 載入{title}中...
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <History className="h-8 w-8 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">尚無{title}記錄</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          公司的文件變更與提交記錄將顯示於此
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        {icon || <History className="h-4 w-4 text-primary" />} {title}
        <Badge variant="secondary" className="text-xs">{sorted.length}</Badge>
      </h3>

      {/* 時間線 */}
      <div className="relative pl-6">
        {/* 縱向連線 */}
        <div className="absolute left-[9px] top-1 bottom-1 w-px bg-border" aria-hidden />

        <div className="space-y-3">
          {sorted.map((log) => (
            <div key={log.id} className="relative">
              {/* 歷史節點 */}
              <span className="absolute -left-6 top-2 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary/10 ring-2 ring-background">
                <History className="h-3 w-3 text-primary" />
              </span>

              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant={docTypeVariant(log.doc_type)} className="text-xs shrink-0">
                      {docTypeLabel(log.doc_type)}
                    </Badge>
                    <span className="font-medium truncate">{displayDate(log)}</span>
                  </div>
                </div>

                {log.original_filename && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">{log.original_filename}</span>
                  </div>
                )}

                {log.notes && (
                  <div className="text-xs text-muted-foreground flex items-start gap-1">
                    <StickyNote className="h-3 w-3 shrink-0 mt-0.5" />
                    <span className="break-words">{log.notes}</span>
                  </div>
                )}

                {log.updated_at && (
                  <div className="text-[11px] text-muted-foreground/70 pt-0.5">
                    更新於 {new Date(log.updated_at).toLocaleString('zh-HK')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
