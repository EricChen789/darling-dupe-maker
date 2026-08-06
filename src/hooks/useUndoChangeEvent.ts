// Undo personnel change events — reverses the actual data change
// in person_company_roles, then deletes the change_event record.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type { ChangeEvent } from './useChangeEvents';

// ── Event type classification ──

const APPOINT_EVENTS = new Set([
  'director_appoint', 'secretary_appoint',
  'reserve_director_appoint', 'shareholder_add',
]);
const CEASE_EVENTS = new Set([
  'director_cease', 'secretary_cease',
  'reserve_director_cease', 'shareholder_remove',
]);

/** Event types that can be undone via this hook */
export const UNDOABLE_EVENT_TYPES = new Set([...APPOINT_EVENTS, ...CEASE_EVENTS]);

// ── Helpers ──

const EVENT_LABELS: Record<string, string> = {
  director_appoint: '委任董事', director_cease: '董事辭任',
  secretary_appoint: '委任秘書', secretary_cease: '秘書辭任',
  reserve_director_appoint: '委任候補董事', reserve_director_cease: '候補董事辭任',
  shareholder_add: '新增股東', shareholder_remove: '股東退出',
};

function eventLabel(et: string) { return EVENT_LABELS[et] || et; }

function eventToRole(eventType: string): string {
  if (eventType.startsWith('director_') || eventType.startsWith('reserve_director_')) return 'director';
  if (eventType.startsWith('secretary_')) return 'secretary';
  if (eventType.startsWith('shareholder_')) return 'shareholder';
  return '';
}

function isReserveRole(eventType: string): boolean {
  return eventType.startsWith('reserve_director_');
}

// ── Hook ──

export function useUndoChangeEvent() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ event, companyId }: { event: ChangeEvent; companyId: string }) => {
      const role = eventToRole(event.event_type);
      const label = eventLabel(event.event_type);

      if (APPOINT_EVENTS.has(event.event_type)) {
        // ═══ Undo Appointment: find and DELETE the person_company_roles row ═══
        const nv = tryParseJson(event.new_value);
        const nameEn = (nv.name_english || nv.name || '').trim();
        const nameZh = (nv.name_chinese || '').trim();

        let found = false;
        if (nameEn || nameZh) {
          // Fetch all role rows for this company+role
          const { data: roleRows } = await supabase
            .from('person_company_roles')
            .select('*')
            .eq('company_id', companyId)
            .eq('role', role);

          if (roleRows && roleRows.length > 0) {
            // Collect unique person_ids
            const personIds = [...new Set((roleRows as any[]).map((r: any) => r.person_id).filter(Boolean))];
            const { data: personRows } = personIds.length > 0
              ? await supabase.from('persons').select('id, name_english, name_chinese').in('id', personIds)
              : { data: null };

            const personMap = new Map<string, { nameEn: string; nameZh: string }>();
            if (personRows) {
              for (const p of personRows as any[]) {
                personMap.set(p.id, { nameEn: (p.name_english || '').trim(), nameZh: (p.name_chinese || '').trim() });
              }
            }

            for (const r of roleRows as any[]) {
              const p = personMap.get(r.person_id);
              if (!p) continue;

              // Match by name (case-insensitive English, exact Chinese)
              const enMatch = nameEn && p.nameEn.toLowerCase() === nameEn.toLowerCase();
              const zhMatch = nameZh && p.nameZh === nameZh;
              const nameOk = enMatch || zhMatch;

              // Reserve director check
              const reserveOk = isReserveRole(event.event_type) ? !!r.is_reserve : !r.is_reserve;

              if (nameOk && (isReserveRole(event.event_type) ? !!r.is_reserve : true)) {
                await supabase.from('person_company_roles').delete().eq('id', r.id);
                found = true;
                break;
              }
            }
          }
        }

        // Always clean up the change_event
        await supabase.from('change_events').delete().eq('id', event.id);
        return { found, label };
      }

      if (CEASE_EVENTS.has(event.event_type)) {
        // ═══ Undo Cessation: clear date_ceased or re-create the role row ═══
        const personId = event.person_id;
        if (!personId) {
          // No person_id recorded — just clean up the event
          await supabase.from('change_events').delete().eq('id', event.id);
          return { found: false, label, note: 'no_person_id' };
        }

        // Check if a role row still exists
        const { data: existingRows } = await supabase
          .from('person_company_roles')
          .select('*')
          .eq('company_id', companyId)
          .eq('person_id', personId)
          .eq('role', role);

        const reserveRow = isReserveRole(event.event_type);
        const matchingRow = (existingRows as any[])?.find((r: any) =>
          reserveRow ? !!r.is_reserve : true
        );

        if (matchingRow) {
          if (matchingRow.date_ceased) {
            // Scenario A: Row exists with date_ceased → clear it
            await supabase.from('person_company_roles')
              .update({ date_ceased: '' })
              .eq('id', matchingRow.id);
          }
          // Scenario B: date_ceased already empty → person already re-added, skip
        } else {
          // Scenario C: Row was deleted → re-create it
          const today = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
          await supabase.from('person_company_roles').insert({
            person_id: personId,
            company_id: companyId,
            role,
            date_appointed: today,
            date_ceased: '',
            is_reserve: reserveRow ? 1 : 0,
            shares: 0,
            share_type: '',
            currency: 'HKD',
            issue_price: '',
            paid_up: '',
            unpaid: '',
            service_address_override: '',
          } as any);
        }

        await supabase.from('change_events').delete().eq('id', event.id);
        return { found: true, label };
      }

      throw new Error(`Unsupported event type: ${event.event_type}`);
    },

    onSuccess: (result, _variables) => {
      const label = result.label;
      qc.invalidateQueries({ queryKey: ['change_events'] });
      qc.refetchQueries({ queryKey: ['companies'] });

      if (result.found || !(result as any).note) {
        toast({ title: '已撤銷變更', description: `${label} 已還原` });
      } else {
        toast({
          title: '已清除變更記錄',
          description: `${label} — 未找到對應的角色記錄（可能已被手動刪除）`,
        });
      }
    },

    onError: (err: any, _variables) => {
      console.error('[useUndoChangeEvent]', err);
      toast({
        title: '撤銷失敗',
        description: err?.message || '請再試一次',
        variant: 'destructive',
      });
    },
  });
}

// ── Utility ──

function tryParseJson(raw: string): Record<string, any> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
