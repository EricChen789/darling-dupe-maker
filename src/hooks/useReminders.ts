import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Reminder {
  id: string;
  company_id: string;
  reminder_type: string;
  title: string;
  due_date: string;
  status: string;
  notes: string;
  notified_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useReminders() {
  return useQuery({
    queryKey: ['reminders'],
    queryFn: async (): Promise<Reminder[]> => {
      const { data, error } = await supabase
        .from('reminders' as any)
        .select('*')
        .order('due_date', { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data || []) as unknown as Reminder[];
    },
  });
}

export function useUpsertReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: Partial<Reminder>) => {
      const payload: any = {
        company_id: r.company_id,
        reminder_type: r.reminder_type || 'NAR1',
        title: r.title || '',
        due_date: r.due_date || '',
        status: r.status || 'pending',
        notes: r.notes || '',
      };
      if (r.id) {
        const { error } = await supabase.from('reminders' as any).update(payload).eq('id', r.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('reminders' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reminders' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}

export function useUpdateReminderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: any = { status };
      if (status === 'completed') update.completed_at = new Date().toISOString();
      const { error } = await supabase.from('reminders' as any).update(update).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}
