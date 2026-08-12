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

  const title = buildEventTitle(ev, raw);

  // For ND2B changes, pass the original event_type so payload builder
  // can determine which change type (address/name/id/contact) to use.
  if (qfType === 'nd2b_change') {
    raw._event_type = ev.event_type;
  }

  return {
    type: qfType,
    title,
    raw,
  };
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
  const [expanded, setExpanded] = useState(false);
  const [qfOpen, setQfOpen] = useState(false);
  const [qfEvent, setQfEvent] = useState<any>(null);

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

  const handleGenerate = (ev: ChangeEvent) => {
    const qfEv = changeEventToQfEvent(ev);
    setQfEvent(qfEv);
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

              // Parse raw for name display
              let personName = '';
              try {
                const raw = typeof ev.new_value === 'string' ? JSON.parse(ev.new_value) : (ev.new_value || {});
                personName = raw.nameEnglish || raw.name_english || raw.name || '';
              } catch { /* ignore */ }
              // For transactions, show from→to
              let txDesc = '';
              try {
                const raw = typeof ev.new_value === 'string' ? JSON.parse(ev.new_value) : (ev.new_value || {});
                const from = raw.from_name || raw.fromName || '';
                const to = raw.to_name || raw.toName || '';
                const sh = raw.shares || 0;
                if (from || to) {
                  txDesc = `${from || '（新發行）'} → ${to || '—'}${sh ? `，${Number(sh).toLocaleString()} 股` : ''}`;
                }
              } catch { /* ignore */ }

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
        event={qfEvent}
      />
    </>
  );
}
