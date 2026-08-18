import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { recordChangeEvent, EVENT_FORM_MAP } from '@/lib/changeEvents';
import { toast } from '@/hooks/use-toast';

export interface ShareTransaction {
  id: string;
  company_id: string;
  transaction_date: string;
  transaction_type: string;
  from_person_id: string | null;
  from_name: string;
  to_person_id: string | null;
  to_name: string;
  shares: number;
  share_type: string;
  currency: string;
  price_per_share: string;
  total_consideration: string;
  instrument_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ── Consideration = 股數 × 每股股價（需求：consideration 一律自動計算）──
export function computeConsideration(shares: number | undefined, pricePerShare: string | undefined): string {
  const sh = Number(shares) || 0;
  const price = parseFloat(String(pricePerShare ?? '').replace(/,/g, ''));
  if (sh > 0 && !isNaN(price) && price > 0) return String(sh * price);
  return '';
}

// ── 編號：按發生時間順序 1,2,3,4…（日期升序、同日按建立時間；無日期排最後）──
// newTx 以物件身份在清單中定位；找不到時排在最後。
export function computeTransactionSeq(existing: ShareTransaction[], newTx: Partial<ShareTransaction>): number {
  const list = [...existing.filter((t) => t.id !== newTx.id), { ...newTx, _new: true } as any]
    .sort((a, b) => {
      const da = (a.transaction_date || '') ? a.transaction_date : '￿';
      const db = (b.transaction_date || '') ? b.transaction_date : '￿';
      if (da !== db) return da < db ? -1 : 1;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  const idx = list.findIndex((t) => (t as any)._new);
  return (idx < 0 ? list.length : idx) + 1;
}

export function useShareTransactions(companyId: string | undefined) {
  return useQuery({
    queryKey: ['share_transactions', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ShareTransaction[]> => {
      const { data, error } = await supabase
        .from('share_transactions' as any)
        .select('*')
        .eq('company_id', companyId)
        .order('transaction_date', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ShareTransaction[];
    },
  });
}

export function useUpsertShareTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tx: Partial<ShareTransaction>) => {
      // Consideration = 股數 × 每股股價（自動計算；股價未填才保留手填值）
      const computed = computeConsideration(tx.shares, tx.price_per_share);
      const payload: any = {
        company_id: tx.company_id,
        transaction_date: tx.transaction_date || '',
        transaction_type: tx.transaction_type || 'transfer',
        from_person_id: tx.from_person_id || null,
        from_name: tx.from_name || '',
        to_person_id: tx.to_person_id || null,
        to_name: tx.to_name || '',
        shares: tx.shares || 0,
        share_type: tx.share_type || '',
        currency: tx.currency || 'HKD',
        price_per_share: tx.price_per_share || '',
        total_consideration: computed || tx.total_consideration || '',
        instrument_number: tx.instrument_number || '',
        notes: tx.notes || '',
      };
      if (tx.id) {
        const { error } = await supabase.from('share_transactions' as any).update(payload).eq('id', tx.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('share_transactions' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: async (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['share_transactions', vars.company_id] });
      // Record change event for NAR1 smart filing
      const txType = vars.transaction_type || 'transfer';
      const eventType = txType === 'allotment' ? 'share_allotment' : 'share_transfer';
      recordChangeEvent({
        company_id: vars.company_id || '',
        event_type: eventType,
        new_value: {
          transaction_type: txType,
          from_person_id: vars.from_person_id || '',
          from_name: vars.from_name,
          to_person_id: vars.to_person_id || '',
          to_name: vars.to_name,
          shares: vars.shares,
          share_type: vars.share_type,
          price_per_share: vars.price_per_share,
          total_consideration: computeConsideration(vars.shares, vars.price_per_share) || vars.total_consideration,
          currency: vars.currency,
          instrument_number: vars.instrument_number,
          transaction_date: vars.transaction_date,
        },
        related_form_type: EVENT_FORM_MAP[eventType] || '',
        change_date: vars.transaction_date,
      });

      // ═══ 股份轉讓完成 → 受讓人自動成為股東（僅新交易；編輯不重複套用）═══
      if (!vars.id && Number(vars.shares) > 0) {
        try {
          const type = vars.transaction_type || 'transfer';
          const buyerDelta = (type === 'transfer' || type === 'allotment' || type === 'capital_increase')
            ? Number(vars.shares) : 0;
          const sellerDelta = (type === 'transfer' || type === 'repurchase')
            ? -Number(vars.shares) : 0;
          if (buyerDelta) {
            const bid = await resolvePersonId(vars.to_name || '', vars.to_person_id);
            if (bid) {
              await applyShareChange(vars.company_id || '', bid, buyerDelta, vars);
            } else if (vars.to_name) {
              toast({ title: '提示', description: `受讓人「${vars.to_name}」不在系統人員中，未自動加入股東列表` });
            }
          }
          if (sellerDelta) {
            const sid = await resolvePersonId(vars.from_name || '', vars.from_person_id);
            if (sid) await applyShareChange(vars.company_id || '', sid, sellerDelta, vars);
          }
          qc.invalidateQueries({ queryKey: ['companies'] });
        } catch (e: any) {
          console.error('[share-transfer] shareholder write-back failed:', e?.message || e);
        }
      }
    },
  });
}

// ── 由姓名解析 persons.id（picker 未帶 person id，存庫交易只有姓名）──
export async function resolvePersonId(name: string, personId?: string | null): Promise<string | null> {
  if (personId) return personId;
  const n = String(name || '').trim();
  if (!n) return null;
  try {
    const exact = await supabase.from('persons').select('id').eq('name_english', n).limit(5);
    if ((exact.data as any[])?.length) return (exact.data as any[])[0].id;
    const fuzzy = await supabase.from('persons').select('id').eq('name_english__like', `%${n}%`).limit(5);
    if ((fuzzy.data as any[])?.length) return (fuzzy.data as any[])[0].id;
  } catch (e: any) {
    console.error('[share-transfer] resolvePersonId failed:', e?.message || e);
  }
  return null;
}

// ── 更新 person_company_roles 持股：delta>0 加股（受讓人）、delta<0 減股（轉讓人）──
export async function applyShareChange(
  companyId: string, personId: string, delta: number, tx: Partial<ShareTransaction>,
): Promise<void> {
  const { data: rows } = await supabase.from('person_company_roles')
    .select('*').eq('company_id', companyId).eq('person_id', personId).eq('role', 'shareholder');
  const row = (rows as any[])?.[0];
  if (row) {
    const newShares = Math.max(0, (Number(row.shares) || 0) + delta);
    const upd: any = { shares: newShares };
    if (delta > 0 && row.date_ceased) upd.date_ceased = '';  // 曾退出 → 重新入冊
    if (delta < 0 && newShares === 0) {
      upd.date_ceased = tx.transaction_date || new Date().toLocaleDateString('en-GB');
    }
    if (delta > 0 && tx.price_per_share) upd.issue_price = tx.price_per_share;
    if (delta > 0 && tx.share_type) upd.share_type = tx.share_type;
    await supabase.from('person_company_roles').update(upd).eq('id', row.id);
  } else if (delta > 0) {
    await supabase.from('person_company_roles').insert({
      person_id: personId,
      company_id: companyId,
      role: 'shareholder',
      date_appointed: tx.transaction_date || new Date().toLocaleDateString('en-GB'),
      date_ceased: '',
      is_reserve: 0,
      shares: delta,
      share_type: tx.share_type || '',
      currency: tx.currency || 'HKD',
      issue_price: tx.price_per_share || '',
      paid_up: '',
      unpaid: '',
      service_address_override: '',
    } as any);
  }
}

export function useDeleteShareTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; companyId: string }) => {
      const { error } = await supabase.from('share_transactions' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['share_transactions', vars.companyId] });
    },
  });
}
