import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Users, Bell, AlertTriangle, ClipboardList, FileText,
  Search, Mail, UserCheck, ArrowRight, Briefcase, ScrollText, Landmark,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { useCompanies } from '@/hooks/useCompanies';
import { useReminders } from '@/hooks/useReminders';
import { useCompanyLogs } from '@/hooks/useCompanyLogs';
import { useOfficers } from '@/hooks/useOfficers';

const DOC_TYPE_LABEL: Record<string, string> = {
  NAR1: '周年申報表 NAR1', ND2A: '董事/秘書變更 ND2A', ND2B: '董事/秘書詳情 ND2B',
  ND4: '辭任通知 ND4', BIR51: '利得稅報稅表', AUDIT_REPORT: '審計報告',
  BR_RENEWAL: '商業登記續期', BOARD_MINUTES: '董事會會議記錄',
  SHAREHOLDER_RESOLUTION: '股東決議', SHARE_TRANSFER: '股份轉讓',
  WINDING_UP_ORDER: '清盤令', STATEMENT_OF_AFFAIRS: '公司狀況說明書',
  CR_STRIKE_OFF: '公司註銷', CR_DISSOLUTION: '公司解散', CI_BR: 'CI/BR 證書',
  BANKING: '銀行文件', CORRESPONDENCE: '往來文件', ROD: '董事名冊', ROM: '成員名冊',
};

const RSTATUS: Record<string, { label: string; variant: 'secondary' | 'default' | 'destructive' | 'outline' }> = {
  pending: { label: '待處理', variant: 'secondary' },
  submitted: { label: '已提交', variant: 'default' },
  completed: { label: '已完成', variant: 'outline' },
  dismissed: { label: '已忽略', variant: 'outline' },
};

const ymd = (d: Date) => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
};
const fmtDate = (s?: string) => (s && s.length >= 10 ? s.slice(0, 10) : s || '—');

const QUICK_LINKS = [
  { to: '/companies', label: '公司管理', icon: Building2, desc: '公司資料、股份、附件' },
  { to: '/people', label: '自然人管理', icon: Users, desc: '自然人、地址、證件' },
  { to: '/forms', label: '表單管理', icon: FileText, desc: '14 種法定表格 PDF' },
  { to: '/reminders', label: '任務管理', icon: Bell, desc: '周年申報、任務日曆、逾期警告' },
  { to: '/search', label: '歷史檢索', icon: Search, desc: '公司/董事/股東檢索' },
  { to: '/email', label: '郵件模塊', icon: Mail, desc: '模板、發送、定時任務' },
  { to: '/logs', label: '公司日誌', icon: ClipboardList, desc: '文檔與變更時間線' },
  { to: '/users', label: '使用者管理', icon: UserCheck, desc: '帳號、角色、權限' },
];

const Dashboard = () => {
  const { data: companies = [] } = useCompanies();
  const { officers = [] } = useOfficers();
  const { data: reminders = [] } = useReminders();
  const { data: logs = [] } = useCompanyLogs();

  const today = ymd(new Date());

  const m = useMemo(() => {
    const overdue = reminders.filter(
      (r) => r.status === 'pending' && r.due_date && r.due_date.slice(0, 10) < today,
    );
    const pending = reminders.filter((r) => r.status === 'pending');
    const directors = companies.reduce((s, c) => s + (c.directors?.length || 0), 0);
    const secretaries = companies.reduce((s, c) => s + (c.secretaries?.length || 0), 0);
    const shareholders = companies.reduce((s, c) => s + (c.shareholders?.length || 0), 0);
    const upcoming = [...pending]
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
      .slice(0, 6);
    const recentLogs = [...logs]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 6);
    const cmap = new Map(companies.map((c) => [c.id, c.name]));
    return {
      companies: companies.length,
      persons: officers.length,
      pending: pending.length,
      overdue: overdue.length,
      directors, secretaries, shareholders,
      logs: logs.length,
      upcoming, recentLogs, cmap,
    };
  }, [companies, officers, reminders, logs, today]);

  return (
    <div>
      <PageHeader
        title="儀表板"
        description={`系統概覽 · 截至 ${today} · 公司秘書管理系統（PAUL TANG & CO LTD）`}
      />

      {/* 概覽統計 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard label="公司總數" value={m.companies} />
        <StatCard label="自然人總數" value={m.persons} />
        <StatCard label="待處理提醒" value={m.pending} valueClassName="text-primary" />
        <StatCard label="逾期提醒" value={m.overdue} valueClassName={m.overdue ? 'text-destructive' : ''} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="董事人次" value={m.directors} />
        <StatCard label="公司秘書" value={m.secretaries} />
        <StatCard label="股東人次" value={m.shareholders} />
        <StatCard label="公司日誌" value={m.logs} />
      </div>

      {/* 兩欄：即將到期 + 最近日誌 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* 即將到期申報 */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" /> 即將到期申報
            </h3>
            <Link to="/reminders" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
              全部 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {m.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">暫無待處理提醒</p>
          ) : (
            <ul className="space-y-2">
              {m.upcoming.map((r) => {
                const od = r.due_date && r.due_date.slice(0, 10) < today;
                return (
                  <li key={r.id} className="flex items-center justify-between text-sm border-b border-border/50 pb-2 last:border-0">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.cmap.get(r.company_id) || r.title || '—'}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.reminder_type || '提醒'} · 到期 {fmtDate(r.due_date)}
                      </div>
                    </div>
                    {od ? (
                      <Badge variant="destructive" className="shrink-0">逾期</Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">待處理</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 最近公司日誌 */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" /> 最近公司日誌
            </h3>
            <Link to="/logs" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
              全部 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {m.recentLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">暫無日誌記錄</p>
          ) : (
            <ul className="space-y-2">
              {m.recentLogs.map((l) => (
                <li key={l.id} className="flex items-center justify-between text-sm border-b border-border/50 pb-2 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {l.company_name_hint || m.cmap.get(l.company_id || '') || '—'}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {DOC_TYPE_LABEL[l.doc_type] || l.doc_type} · {fmtDate(l.doc_date || l.created_at)}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0">{l.doc_type}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 快捷入口（管理專屬功能入口） */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-primary" /> 快捷功能入口
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {QUICK_LINKS.map((q) => (
            <Link
              key={q.to}
              to={q.to}
              className="bg-card border border-border rounded-lg p-4 hover:border-primary hover:shadow-sm transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <q.icon className="h-5 w-5 text-primary" />
                <span className="font-medium group-hover:text-primary transition-colors">{q.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{q.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
