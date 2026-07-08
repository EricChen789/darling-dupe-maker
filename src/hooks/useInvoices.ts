import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Invoice } from '@/types';

interface DbInvoice {
  id: string;
  company_id: string;
  invoice_number: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  issue_date: string;
  due_date: string;
  created_at: string;
  updated_at: string;
}

const fromDb = (inv: DbInvoice, companyMap: Map<string, { name: string; brNumber: string }>): Invoice => ({
  id: inv.id,
  invoiceNumber: inv.invoice_number || '',
  description: inv.description || '',
  companyId: inv.company_id || '',
  companyName: companyMap.get(inv.company_id)?.name || '',
  companyBrNumber: companyMap.get(inv.company_id)?.brNumber || '',
  amount: inv.amount || 0,
  currency: inv.currency || 'HKD',
  status: (inv.status as 'paid' | 'pending' | 'overdue') || 'pending',
  issueDate: (inv.issue_date || '').replace(/-/g, '/'),
  dueDate: (inv.due_date || '').replace(/-/g, '/'),
});

async function fetchAllInvoices(): Promise<DbInvoice[]> {
  const pageSize = 1000;
  const all: DbInvoice[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || []) as DbInvoice[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function fetchCompanyMap(): Promise<Map<string, { name: string; brNumber: string }>> {
  const map = new Map<string, { name: string; brNumber: string }>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, company_number')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const c of (data || []) as any[]) {
      map.set(c.id, { name: c.name || '', brNumber: c.company_number || '' });
    }
    if ((data || []).length < pageSize) break;
    from += pageSize;
  }
  return map;
}

export function useInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: async (): Promise<Invoice[]> => {
      const [invoices, companyMap] = await Promise.all([
        fetchAllInvoices(),
        fetchCompanyMap(),
      ]);
      return invoices.map(inv => fromDb(inv, companyMap));
    },
  });
}

export function useSaveInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inv: Partial<Invoice> & { id?: string }) => {
      const payload: any = {
        company_id: inv.companyId || '',
        invoice_number: inv.invoiceNumber || '',
        description: inv.description || '',
        amount: inv.amount || 0,
        currency: inv.currency || 'HKD',
        status: inv.status || 'pending',
        issue_date: (inv.issueDate || '').replace(/\//g, '-'),
        due_date: (inv.dueDate || '').replace(/\//g, '-'),
      };
      if (inv.id) {
        const { error } = await supabase.from('invoices').update(payload).eq('id', inv.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('invoices').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('invoices').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
}
