// Hook for reading change events and unassigned changes (for NAR1 smart filing)
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ChangeEvent {
  id: string;
  company_id: string;
  event_type: string;
  person_id: string;
  role: string;
  old_value: string;
  new_value: string;
  change_date: string;
  related_form_type: string;
  nar1_period_id: string;
  created_at: string;
  /** Enriched: person's display name (from persons table via person_id) */
  person_name?: string;
  /** Enriched: full person record (name_english/name_chinese/id_number) */
  person?: any;
}

/** Normalise a date string (DD/MM/YYYY | YYYY-MM-DD | DDMMYYYY) → YYYYMMDD.
 *  Returns '' when unparseable — those sort last and group under「日期不詳」.
 *  Shared by useChangeEvents' sort and TabChangeEventsFooter's date grouping. */
export function dayKeyOf(dateStr?: string): string {
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

/** Get all change events for a company, ordered by change_date descending.
 *  Enriches each event with person_name (from persons via person_id) so
 *  footers can show names even when old/new_value has no name fields. */
export function useChangeEvents(companyId: string | undefined) {
  return useQuery({
    queryKey: ['change_events', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ChangeEvent[]> => {
      const { data, error } = await supabase
        .from('change_events' as any)
        .select('*')
        .eq('company_id', companyId)
        .order('change_date', { ascending: false });
      if (error) throw error;
      const events = (data || []) as unknown as ChangeEvent[];
      // 客户端排序：change_date（DD/MM/YYYY → YYYYMMDD 可比键）倒序，
      // 同日多个事件再按 created_at 倒序，最新在前
      // ⚠️ change_events.created_at 在 D1 是 TEXT DEFAULT '' 且前端从不写入，
      //    多数为空 → 同日内部顺序实际上不可靠（跨日期排序正常）
      events.sort((a, b) => {
        const dc = dayKeyOf(b.change_date).localeCompare(dayKeyOf(a.change_date));
        if (dc !== 0) return dc;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });

      // Enrich person names — needed for events whose values carry no name
      // (person_address/id/contact_change) or no old_value (shareholder_remove)
      const personIds = [...new Set(events.map(e => e.person_id).filter(Boolean))];
      if (personIds.length > 0) {
        try {
          const { data: persons } = await supabase
            .from('persons')
            .select('id, name_english, name_chinese, id_number, passport_number') as any;
          const byId = new Map<string, any>((persons || []).map((p: any) => [p.id, p]));
          for (const ev of events) {
            const p = byId.get(ev.person_id);
            if (!p) continue;
            const en = p.name_english || '';
            const cn = p.name_chinese || '';
            ev.person_name = cn ? `${en} (${cn})` : en;
            ev.person = p;
          }
        } catch { /* enrichment is best-effort, don't block events */ }
      }
      return events;
    },
  });
}

/** Get unassigned change events (nar1_period_id IS NULL or empty) for a company */
export function useUnassignedChangeEvents(companyId: string | undefined) {
  return useQuery({
    queryKey: ['change_events', 'unassigned', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ChangeEvent[]> => {
      // Fetch all events and filter client-side since D1/SQLite
      // doesn't support complex OR/IS NULL queries via the generic API
      const { data, error } = await supabase
        .from('change_events' as any)
        .select('*')
        .eq('company_id', companyId)
        .order('change_date', { ascending: false });
      if (error) throw error;
      const events = (data || []) as unknown as ChangeEvent[];
      return events.filter(e => !e.nar1_period_id || e.nar1_period_id === '');
    },
  });
}

/** Human-readable label for event_type */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  director_appoint: '委任董事',
  director_cease: '董事辭任',
  secretary_appoint: '委任秘書',
  secretary_cease: '秘書辭任',
  shareholder_add: '新增股東',
  shareholder_remove: '股東退出',
  share_transfer: '股份轉讓',
  share_allotment: '股份配發',
  address_change: '地址變更',
  name_change: '公司名稱變更',
  company_email_change: '電郵變更',
  company_phone_change: '電話變更',
  reserve_director_appoint: '委任候補董事',
  reserve_director_cease: '候補董事辭任',
  person_address_change: '董事/秘書地址變更',
  person_name_change: '董事/秘書姓名變更',
  person_id_change: '董事/秘書證件變更',
  person_contact_change: '董事/秘書聯絡變更',
};
