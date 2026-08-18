// Change event recording — called from mutation onSuccess callbacks
// to automatically track personnel/share/address changes for NAR1 smart filing.

import { supabase } from '@/integrations/supabase/client';

export interface ChangeEventInput {
  company_id: string;
  event_type: string;
  person_id?: string;
  role?: string;
  old_value?: Record<string, any>;
  new_value?: Record<string, any>;
  change_date?: string;
  related_form_type?: string;
}

/**
 * Record a change event to the change_events table.
 * This is a fire-and-forget call — failures are logged but don't block the UI.
 */
export async function recordChangeEvent(input: ChangeEventInput): Promise<void> {
  try {
    const today = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
    const payload: Record<string, any> = {
      company_id: input.company_id,
      event_type: input.event_type,
      person_id: input.person_id || '',
      role: input.role || '',
      old_value: input.old_value ? JSON.stringify(input.old_value) : '',
      new_value: input.new_value ? JSON.stringify(input.new_value) : '',
      change_date: input.change_date || today,
      related_form_type: input.related_form_type || '',
      nar1_period_id: '',
    };

    const { error } = await supabase.from('change_events').insert(payload as any);
    if (error) {
      console.warn('[changeEvents] Failed to record event:', input.event_type, error);
    }
  } catch (err) {
    console.warn('[changeEvents] Error recording event:', input.event_type, err);
  }
}

/** Event type → related CR form mapping */
export const EVENT_FORM_MAP: Record<string, string> = {
  director_appoint: 'ND2A',
  director_cease: 'ND4',
  secretary_appoint: 'ND2A',
  secretary_cease: 'ND4',
  shareholder_add: 'NSC1',
  shareholder_remove: 'Share Transfer',
  share_transfer: 'Bought Sold Note',
  share_allotment: 'NSC1',
  address_change: 'NR1',
  name_change: 'NNC2',
  company_email_change: 'NR1',
  company_phone_change: 'NR1',
  reserve_director_appoint: 'ND2A',
  reserve_director_cease: 'ND4',
  authorized_rep_appoint: 'NN1',
  // ND2B person-level changes
  person_address_change: 'ND2B',
  person_name_change: 'ND2B',
  person_id_change: 'ND2B',
  person_contact_change: 'ND2B',
};
