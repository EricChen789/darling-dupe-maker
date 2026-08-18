// TabChangeEventsFooter — compact change_events list at the bottom of each
// CompanyDetailDialog tab, filtered to that tab's relevant event types.
// Each event has a "生成表格" button that opens QuickFormDialog.
import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useChangeEvents, EVENT_TYPE_LABELS, type ChangeEvent } from '@/hooks/useChangeEvents';
import { QuickFormDialog } from '@/components/forms/QuickFormDialog';
import { FileOutput, ChevronDown, ChevronRight, History, Clock } from 'lucide-react';

// ── Map change_events.event_type → QuickFormDialog's event.type ──
const EVENT_TYPE_TO_QF_TYPE: Record<string, string> = {
  director_appoint: 'appoint',
  director_cease: 'cease',
  secretary_appoint: 'appoint',
  secretary_cease: 'cease',
  reserve_director_appoint: 'appoint',
  reserve_director_cease: 'cease',
  shareholder_add: 'shareholder_add',
  shareholder_remove: 'shareholder_remove',
  share_transfer: 'transfer',
  share_allotment: 'allotment',
  // ND2B person-level changes
  person_address_change: 'nd2b_change',
  person_name_change: 'nd2b_change',
  person_id_change: 'nd2b_change',
  person_contact_change: 'nd2b_change',
  // 公司资料变更（公司资料 Tab）
  address_change: 'nr1',
  name_change: 'nnc2',
};

// ── Map event_type to role for QuickFormDialog ──
const EVENT_TYPE_TO_ROLE: Record<string, string> = {
  director_appoint: 'director',
  director_cease: 'director',
  secretary_appoint: 'secretary',
  secretary_cease: 'secretary',
  reserve_director_appoint: 'alternate',
  reserve_director_cease: 'alternate',
};

// ── Event types that QuickFormDialog can handle ──
const QF_SUPPORTED_TYPES = new Set(Object.keys(EVENT_TYPE_TO_QF_TYPE));

// ── 人事事件（委任／辭任）— 同一天打包生成 ND2A ──
const PERSONNEL_EVENT_TYPES = new Set<string>([
  'director_appoint', 'director_cease',
  'secretary_appoint', 'secretary_cease',
  'reserve_director_appoint', 'reserve_director_cease',
]);

// ── Normalise change_date (DD/MM/YYYY | YYYY-MM-DD | DDMMYYYY) → YYYYMMDD ──
function dayKeyOf(dateStr?: string): string {
  if (!dateStr) return '';
  const t = String(dateStr).trim();
  let d = '', m = '', y = '';
  if (/^\d{8}$/.test(t)) { d = t.slice(0, 2); m = t.slice(2, 4); y = t.slice(4, 8); }
  else if (/^\d{4}-\d{2}-\d{2}/.test(t)) { y = t.slice(0, 4); m = t.slice(5, 7); d = t.slice(8, 10); }
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) {
    const [dd, mm, yy] = t.split('/'); d = dd.padStart(2, '0'); m = mm.padStart(2, '0'); y = yy;
  } else return '';
  return `${y}${m}${d}`;
}

// ── Parse a change_event into QuickFormDialog-compatible format ──
function changeEventToQfEvent(ev: ChangeEvent) {
  const qfType = EVENT_TYPE_TO_QF_TYPE[ev.event_type] || '';
  const explicitRole = EVENT_TYPE_TO_ROLE[ev.event_type] || '';

  // Parse new_value/old_value JSON for person/transaction data
  let raw: Record<string, any> = {};
  try {
    // For cessation events, old_value has the full person data
    // For appointment events, new_value has the person data
    const source = ev.event_type.endsWith('_cease') || ev.event_type === 'shareholder_remove'
      ? (ev.old_value || '{}')
      : (ev.new_value || '{}');
    raw = typeof source === 'string' ? JSON.parse(source) : (source || {});
  } catch { /* keep empty raw */ }

  // Ensure role is set for personnel events
  if (explicitRole && !raw.role) {
    raw.role = explicitRole;
  }
  // For reserve directors
  if (ev.event_type.startsWith('reserve_director')) {
    raw.isReserve = true;
  }
  // Date fallback: 辭任事件的 old_value 常缺 date_ceased、委任缺 date_appointed
  // → 用 change_events.change_date（DD/MM/YYYY）補上，QuickFormDialog 會歸一化
  if (explicitRole && ev.change_date) {
    if (ev.event_type.endsWith('_cease') && !raw.date_ceased) {
      raw.date_ceased = ev.change_date;
    }
    if (ev.event_type.endsWith('_appoint') && !raw.date_appointed) {
      raw.date_appointed = ev.change_date;
    }
  }

  let title = buildEventTitle(ev, raw);
  // raw 里没名字的事件（person_*_change 等）用 enrich 的 person_name 补上
  if (title === (EVENT_TYPE_LABELS[ev.event_type] || ev.event_type) && ev.person_name) {
    title = `${title}：${ev.person_name}`;
  }

  // name_change 的 NNC2 需要旧公司名称（old_value 里）
  if (qfType === 'nnc2' && ev.old_value) {
    try {
      const oldRaw = typeof ev.old_value === 'string' ? JSON.parse(ev.old_value) : (ev.old_value || {});
      if (oldRaw.name) raw.old_name = oldRaw.name;
      if (oldRaw.chinese_name) raw.old_chinese_name = oldRaw.chinese_name;
    } catch { /* keep empty */ }
  }
  // 公司资料变更（NR1/NNC2）：生效日期用变更事件本身的 change_date
  if ((qfType === 'nr1' || qfType === 'nnc2') && ev.change_date) {
    raw.change_date = ev.change_date;
  }

  // For ND2B changes, pass the original event_type so payload builder
  // can determine which change type (address/name/id/contact) to use.
  if (qfType === 'nd2b_change') {
    raw._event_type = ev.event_type;
    // person_*_change 事件的 new_value 只有更改后的字段，没有现时资料
    // （姓名/HKID/護照/職位）→ 从 persons 表 enrich 的 ev.person 补齐。
    // 只补缺失字段：person_name_change/person_id_change 的 new_value
    // 本身就带新姓名/新证件号，不能被旧资料覆盖。
    if (ev.person) {
      if (!raw.name_english && ev.person.name_english) raw.name_english = ev.person.name_english;
      if (!raw.name_chinese && ev.person.name_chinese) raw.name_chinese = ev.person.name_chinese;
      if (!raw.id_number && ev.person.id_number) raw.id_number = ev.person.id_number;
      if (!raw.passport_number && ev.person.passport_number) raw.passport_number = ev.person.passport_number;
    }
    if (!raw.role && ev.role) raw.role = ev.role;
    // 生效日期用变更事件本身的 change_date（QuickFormDialog 会归一化）
    if (ev.change_date) raw.change_date = ev.change_date;
  }

  return {
    type: qfType,
    title,
    raw,
  };
}

// ── Extract display name from a change_event ──
// 辞任/退出：old_value 优先；委任/其他：new_value 优先；两源都查。
// 兼容 snake_case（写入端实际字段）/camelCase/法人 company_name。
// 最后 fallback 到 hook enrich 的 person_name（person_id → persons 表）。
function extractPersonName(ev: ChangeEvent): string {
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
    } catch { /* try next source */ }
  }
  return ev.person_name || '';
}

// ── Extract transaction description (share transfer/allotment) ──
function extractTxDesc(ev: ChangeEvent): string {
  try {
    const raw: Record<string, any> = typeof ev.new_value === 'string' ? JSON.parse(ev.new_value) : (ev.new_value || {});
    const from = raw.from_name || raw.fromName || '';
    const to = raw.to_name || raw.toName || '';
    const sh = raw.shares || 0;
    if (from || to) {
      return `${from || '（新發行）'} → ${to || '—'}${sh ? `，${Number(sh).toLocaleString()} 股` : ''}`;
    }
  } catch { /* ignore */ }
  return '';
}

function buildEventTitle(ev: ChangeEvent, raw: Record<string, any>): string {
  const label = EVENT_TYPE_LABELS[ev.event_type] || ev.event_type;
  // Try to extract person name or transaction description
  const nameEn = raw.nameEnglish || raw.name_english || raw.name || '';
  const nameCn = raw.nameChinese || raw.name_chinese || '';
  const fromName = raw.from_name || raw.fromName || '';
  const toName = raw.to_name || raw.toName || '';
  const shares = raw.shares || 0;

  if (nameEn) {
    return `${label}：${nameEn}${nameCn ? ` (${nameCn})` : ''}`;
  }
  if (fromName || toName) {
    const amt = shares ? `${Number(shares).toLocaleString()} 股` : '';
    return `${label}：${fromName || '（新發行）'} → ${toName || '—'}${amt ? `，${amt}` : ''}`;
  }
  return label;
}

// ══════════════════════════════════════════════════════════════
interface TabChangeEventsFooterProps {
  companyId: string;
  company: {
    id: string;
    name: string;
    chineseName?: string;
    brNumber?: string;
    ciNumber?: string;
    incorporationDate?: string;
    jurisdiction?: string;
  };
  eventTypes: string[];
  /** Label for the section header, e.g. "董事變更記錄" */
  label?: string;
}

export function TabChangeEventsFooter({ companyId, company, eventTypes, label }: TabChangeEventsFooterProps) {
  const [expanded, setExpanded] = useState(true); // 默认展开；用户可手动点击收起
  const [qfOpen, setQfOpen] = useState(false);
  const [qfEvents, setQfEvents] = useState<any[]>([]);

  const { data: allEvents = [], isLoading } = useChangeEvents(companyId);

  // Filter to only this tab's event types + only QF-supported types (for generation button)
  const filtered = useMemo(() => {
    return (allEvents || []).filter(ev =>
      eventTypes.includes(ev.event_type)
    );
  }, [allEvents, eventTypes]);

  const withForm = useMemo(() => {
    return filtered.filter(ev => QF_SUPPORTED_TYPES.has(ev.event_type));
  }, [filtered]);

  if (isLoading) return null;
  if (filtered.length === 0) return null;

  // ── 生成表格：同一天的全部人事事件（委任＋辭任）一併打包 ──
  // 從 allEvents（全公司）分組，不限本 tab 過濾 — 董事 tab 也能帶上同日秘書變更
  const handleGenerate = (ev: ChangeEvent) => {
    const isPersonnel = PERSONNEL_EVENT_TYPES.has(ev.event_type);
    const dayKey = dayKeyOf(ev.change_date);
    const sameDay = isPersonnel && dayKey
      ? allEvents.filter(e => PERSONNEL_EVENT_TYPES.has(e.event_type) && dayKeyOf(e.change_date) === dayKey)
      : [ev];
    setQfEvents(sameDay.map(e => changeEventToQfEvent(e)));
    setQfOpen(true);
  };

  const sectionLabel = label || '變更記錄';
  const canGenerateCount = withForm.length;

  return (
    <>
      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <History className="h-3.5 w-3.5" />
          <span className="font-medium">{sectionLabel}</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1">{filtered.length}</Badge>
          {canGenerateCount > 0 && (
            <span className="text-[10px] text-muted-foreground/70 ml-1">
              ({canGenerateCount} 可生成表格)
            </span>
          )}
        </button>

        {expanded && (
          <div className="mt-2 space-y-1.5 pl-5 border-l-2 border-border/50 ml-1.5">
            {filtered.map(ev => {
              const canGen = QF_SUPPORTED_TYPES.has(ev.event_type);
              const label = EVENT_TYPE_LABELS[ev.event_type] || ev.event_type;
              const personName = extractPersonName(ev);
              const txDesc = extractTxDesc(ev);

              return (
                <div key={ev.id} className="flex items-center justify-between gap-2 rounded-sm py-1 text-xs group">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Clock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    <span className="text-muted-foreground font-mono text-[10px] shrink-0">
                      {ev.change_date || ev.created_at?.slice(0, 10) || '—'}
                    </span>
                    <Badge variant="outline" className="text-[10px] py-0 shrink-0">{label}</Badge>
                    <span className="truncate text-muted-foreground">
                      {txDesc || personName || '—'}
                    </span>
                  </div>
                  {canGen && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleGenerate(ev); }}
                    >
                      <FileOutput className="h-3 w-3 mr-0.5" /> 生成表格
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* QuickFormDialog shared instance */}
      <QuickFormDialog
        open={qfOpen}
        onOpenChange={setQfOpen}
        company={company}
        events={qfEvents}
      />
    </>
  );
}
