import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown, ArrowUp, ArrowDown, User, FileClock } from 'lucide-react';
import { Company, Person } from '@/types';
import { VersionHistoryTab } from './VersionHistoryTab';

// 日期正規化：DDMMYYYY→DD/MM/YYYY；其餘原樣回傳
function fmtDate(s?: string): string {
  if (!s) return '—';
  const t = String(s).trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4, 8)}`;
  return t;
}

// 轉為可排序的 YYYYMMDD 數字（無法解析回傳 0，排最後）
function sortableDate(s?: string): number {
  if (!s) return 0;
  const t = String(s).trim();
  let d = '', m = '', y = '';
  if (/^\d{8}$/.test(t)) { d = t.slice(0, 2); m = t.slice(2, 4); y = t.slice(4, 8); }
  else if (/^\d{4}-\d{2}-\d{2}/.test(t)) { y = t.slice(0, 4); m = t.slice(5, 7); d = t.slice(8, 10); }
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) {
    const [dd, mm, yy] = t.split('/'); d = dd.padStart(2, '0'); m = mm.padStart(2, '0'); y = yy;
  } else return 0;
  return parseInt(`${y}${m}${d}`, 10) || 0;
}

interface ChangeEvent {
  key: string;
  name: string;
  role: string;          // 董事 / 秘書
  action: 'appoint' | 'cease';
  date: string;
  identity: string;
}

function personName(p: Person): string {
  const en = (p.nameEnglish || '').trim();
  const cn = (p.nameChinese || '').trim();
  return en && cn ? `${en}（${cn}）` : en || cn || '（無名稱）';
}

export function ChangeRecordsTab({ company }: { company: Company }) {
  return (
    <div className="space-y-6">
      <PersonnelSection company={company} />
      <div className="border-t border-border pt-4">
        <VersionHistoryTab company={company} title="其他變更" icon={<FileClock className="h-4 w-4 text-primary" />} />
      </div>
    </div>
  );
}

export function PersonnelSection({ company }: { company: Company }) {
  const events = useMemo(() => {
    const list: ChangeEvent[] = [];
    const push = (people: Person[], role: string) => {
      for (const p of people) {
        if (p.dateAppointed) {
          list.push({ key: `${p.id}-a`, name: personName(p), role, action: 'appoint', date: p.dateAppointed, identity: p.identity });
        }
        if (p.dateCeased) {
          list.push({ key: `${p.id}-c`, name: personName(p), role, action: 'cease', date: p.dateCeased, identity: p.identity });
        }
      }
    };
    push(company.directors, '董事');
    push(company.secretaries, '秘書');
    // 日期倒序（最近的在上）
    return list.sort((a, b) => sortableDate(b.date) - sortableDate(a.date));
  }, [company.directors, company.secretaries]);

  if (events.length === 0) {
    return (
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2 mb-2">
          <ArrowUpDown className="h-4 w-4 text-primary" /> 人事變更
          <Badge variant="secondary" className="text-xs">0</Badge>
        </h3>
        <p className="text-sm text-muted-foreground py-6 text-center">
          尚無人事變更記錄（董事及秘書的委任與辭任記錄將顯示於此）
        </p>
      </div>
    );
  }

  const appointCount = events.filter(e => e.action === 'appoint').length;
  const ceaseCount = events.filter(e => e.action === 'cease').length;

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <ArrowUpDown className="h-4 w-4 text-primary" /> 人事變更
        <Badge variant="secondary" className="text-xs">{events.length}</Badge>
        <span className="text-xs font-normal text-muted-foreground ml-1">
          委任 {appointCount}　辭任 {ceaseCount}
        </span>
      </h3>

      {/* 時間線 */}
      <div className="relative pl-6">
        <div className="absolute left-[9px] top-1 bottom-1 w-px bg-border" aria-hidden />

        <div className="space-y-3">
          {events.map((e) => {
            const isAppoint = e.action === 'appoint';
            return (
              <div key={e.key} className="relative">
                {/* 節點：委任=綠色向上、辭任=紅色向下 */}
                <span className={`absolute -left-6 top-2 flex h-[18px] w-[18px] items-center justify-center rounded-full ring-2 ring-background ${
                  isAppoint ? 'bg-green-500/15' : 'bg-destructive/15'
                }`}>
                  {isAppoint
                    ? <ArrowUp className="h-3 w-3 text-green-600" />
                    : <ArrowDown className="h-3 w-3 text-destructive" />}
                </span>

                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        variant={isAppoint ? 'default' : 'destructive'}
                        className={`text-xs shrink-0 ${isAppoint ? 'bg-green-600 hover:bg-green-600' : ''}`}
                      >
                        {isAppoint ? '委任' : '辭任'}
                      </Badge>
                      <Badge variant="outline" className="text-xs shrink-0">{e.role}</Badge>
                      <span className="font-medium truncate">{e.name}</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">{fmtDate(e.date)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3 shrink-0" />
                    <span>{e.identity === 'corporate' ? '法人' : '自然人'}{e.role}　·　{isAppoint ? '委任日期' : '辭任日期'} {fmtDate(e.date)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
