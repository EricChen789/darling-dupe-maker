import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Company } from '@/types';

export interface EmailTemplate {
  id: string;
  name: string;
  template_type: string; // invoice | collection | reminder | general
  subject: string;
  body: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface EmailLog {
  id: string;
  company_id: string | null;
  template_id: string | null;
  to_email: string;
  cc_email: string;
  subject: string;
  body: string;
  status: string; // sent | scheduled | failed
  scheduled_at: string | null;
  sent_at: string | null;
  error: string;
  email_type: string; // invoice | collection | reminder | general
  created_at: string;
  updated_at: string;
}

// ── 可用變數（供 UI 提示 + 替換）──
export const EMAIL_VARIABLES: { key: string; label: string }[] = [
  { key: 'company_name', label: '公司英文名稱' },
  { key: 'company_name_cn', label: '公司中文名稱' },
  { key: 'br_number', label: '商業登記號碼' },
  { key: 'company_email', label: '公司電郵' },
  { key: 'client_name', label: '客戶／聯絡人' },
  { key: 'due_date', label: '到期日' },
  { key: 'invoice_number', label: '發票編號' },
  { key: 'amount', label: '金額' },
  { key: 'currency', label: '貨幣' },
  { key: 'sender_name', label: '發送人／秘書行' },
  { key: 'today', label: '今日日期' },
];

// 以 {key} 佔位符替換；未知變數保留原樣
export function substituteVariables(text: string, vars: Record<string, string>): string {
  if (!text) return '';
  return text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, key) =>
    vars[key] !== undefined && vars[key] !== '' ? vars[key] : m
  );
}

// 從公司資料建立預設變數表（其餘欄位可由使用者手動補足）
export function buildCompanyVars(company?: Company | null): Record<string, string> {
  const today = new Date().toLocaleDateString('zh-HK');
  if (!company) return { today, sender_name: 'Muse Labs 公司秘書', currency: 'HKD' };
  const firstDirector = company.directors?.[0];
  const clientName =
    firstDirector?.nameChinese || firstDirector?.nameEnglish || company.chineseName || company.name || '';
  return {
    company_name: company.name || '',
    company_name_cn: company.chineseName || '',
    br_number: company.brNumber || '',
    company_email: company.email || '',
    client_name: clientName,
    sender_name: 'Muse Labs 公司秘書',
    currency: 'HKD',
    today,
  };
}

// ── 模板 CRUD ──
export function useEmailTemplates() {
  return useQuery({
    queryKey: ['email_templates'],
    queryFn: async (): Promise<EmailTemplate[]> => {
      const { data, error } = await supabase
        .from('email_templates' as any)
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data || []) as unknown as EmailTemplate[];
    },
  });
}

export function useSaveEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: Partial<EmailTemplate> & { id?: string }) => {
      const payload: any = {
        name: t.name || '',
        template_type: t.template_type || 'general',
        subject: t.subject || '',
        body: t.body || '',
        is_default: t.is_default ? 1 : 0,
      };
      if (t.id) {
        const { error } = await supabase.from('email_templates' as any).update(payload).eq('id', t.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('email_templates' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email_templates'] }),
  });
}

export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('email_templates' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email_templates'] }),
  });
}

// ── 發送記錄 ──
export function useEmailLogs() {
  return useQuery({
    queryKey: ['email_logs'],
    queryFn: async (): Promise<EmailLog[]> => {
      const { data, error } = await supabase
        .from('email_logs' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data || []) as unknown as EmailLog[];
    },
    refetchInterval: 30000, // 讓排程郵件狀態變化能自動反映
  });
}

// ── 發送 / 排程 ──
export interface SendEmailInput {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  company_id?: string;
  template_id?: string;
  scheduled_at?: string; // ISO；留空即立即發送
  variables?: Record<string, string>; // 服務端變數替換 {key} → value
}

export function useSendEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendEmailInput) => {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok || result.success === false) {
        throw new Error(result.error || `HTTP ${resp.status}`);
      }
      return result as { success: boolean; id: string; status: string; simulated?: boolean };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email_logs'] }),
  });
}
