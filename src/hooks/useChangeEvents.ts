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
}

/** Get all change events for a company, ordered by change_date descending */
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
      return (data || []) as unknown as ChangeEvent[];
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
