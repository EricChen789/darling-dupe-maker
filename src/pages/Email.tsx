import { useMemo, useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Send, Clock, FileText, Plus, Edit, Trash2, Save, X, Loader2, RefreshCw, Eye, Calendar,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import {
  useEmailTemplates, useSaveEmailTemplate, useDeleteEmailTemplate,
  useEmailLogs, useSendEmail, substituteVariables, buildCompanyVars,
  EMAIL_VARIABLES, type EmailTemplate,
} from '@/hooks/useEmail';

const TYPE_LABEL: Record<string, string> = {
  invoice: '發票郵件',
  collection: '客戶資料收集',
  reminder: '申報提醒',
  general: '一般',
  incoming: '📥 收到郵件',
};

const typeBadge = (t: string) => (
  <Badge variant={t === 'invoice' ? 'default' : t === 'reminder' ? 'destructive' : t === 'incoming' ? 'default' : 'secondary'} className="text-xs">
    {TYPE_LABEL[t] || t}
  </Badge>
);

const statusBadge = (s: string) => {
  if (s === 'sent') return <Badge className="text-xs bg-green-600 hover:bg-green-600">已發送</Badge>;
  if (s === 'scheduled') return <Badge variant="secondary" className="text-xs">已排程</Badge>;
  if (s === 'failed') return <Badge variant="destructive" className="text-xs">失敗</Badge>;
  if (s === 'incoming') return <Badge className="text-xs bg-blue-600 hover:bg-blue-600">已收到</Badge>;
  return <Badge variant="outline" className="text-xs">{s}</Badge>;
};

const Email = () => {
  const { data: companies = [] } = useCompanies();
  const { data: templates = [], isLoading: tplLoading } = useEmailTemplates();
  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useEmailLogs();
  const saveTemplate = useSaveEmailTemplate();
  const deleteTemplate = useDeleteEmailTemplate();
  const sendEmail = useSendEmail();

  // ── Compose state ──
  const [companyId, setCompanyId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendMode, setSendMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [vars, setVars] = useState<Record<string, string>>(buildCompanyVars(null));

  const selectedCompany = companies.find(c => c.id === companyId) || null;

  // ── Preview (live variable substitution) ──
  const previewSubject = useMemo(() => substituteVariables(subject, vars), [subject, vars]);
  const previewBody = useMemo(() => substituteVariables(body, vars), [body, vars]);

  const applyCompany = (id: string) => {
    setCompanyId(id);
    const company = companies.find(c => c.id === id) || null;
    const nextVars = { ...buildCompanyVars(company), ...pickManual(vars) };
    setVars(nextVars);
    if (company?.email) setTo(company.email);
  };

  // Keep manually-entered vars (not derived from company) when switching company
  const pickManual = (v: Record<string, string>) => {
    const manual: Record<string, string> = {};
    ['due_date', 'invoice_number', 'amount'].forEach(k => { if (v[k]) manual[k] = v[k]; });
    return manual;
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find(x => x.id === id);
    if (t) { setSubject(t.subject); setBody(t.body); }
  };

  const insertVar = (key: string) => {
    setBody(prev => `${prev}{${key}}`);
  };

  const handleSend = async () => {
    if (!to.trim()) { toast({ title: '請填寫收件人', variant: 'destructive' }); return; }
    if (!previewSubject.trim()) { toast({ title: '請填寫主旨', variant: 'destructive' }); return; }
    if (sendMode === 'scheduled' && !scheduledAt) {
      toast({ title: '請選擇排程時間', variant: 'destructive' }); return;
    }
    try {
      const res = await sendEmail.mutateAsync({
        to: to.trim(),
        cc: cc.trim(),
        subject: previewSubject,   // 已套用變數
        body: previewBody,
        company_id: companyId || undefined,
        template_id: templateId || undefined,
        scheduled_at: sendMode === 'scheduled'
          ? new Date(scheduledAt).toISOString()
          : undefined,
        variables: vars,
      });
      if (res.status === 'scheduled') {
        toast({ title: '已排程', description: `郵件將於指定時間自動發送` });
      } else {
        toast({
          title: res.simulated ? '已發送（模擬）' : '已發送',
          description: res.simulated ? '未設定 SMTP，郵件已記錄但未真正寄出' : `已寄至 ${to}`,
        });
      }
    } catch (e: any) {
      toast({ title: '發送失敗', description: e.message, variant: 'destructive' });
    }
  };

  // ── Template dialog ──
  const [editing, setEditing] = useState<Partial<EmailTemplate> | null>(null);

  // ── Scheduled-task dialog (EM-07) ──
  const [schedOpen, setSchedOpen] = useState(false);

  // ── Log type filter (EM-04/05) ──
  const [logTypeFilter, setLogTypeFilter] = useState<string>('all');

  const filteredLogs = useMemo(() => {
    if (logTypeFilter === 'all') return logs;
    return logs.filter(l => l.email_type === logTypeFilter);
  }, [logs, logTypeFilter]);

  // Close scheduled-task dialog on successful send
  useEffect(() => {
    if (sendEmail.isSuccess && schedOpen) setSchedOpen(false);
  }, [sendEmail.isSuccess, schedOpen]);

  const handleSaveTemplate = async () => {
    if (!editing) return;
    if (!editing.name?.trim()) { toast({ title: '請填寫模板名稱', variant: 'destructive' }); return; }
    try {
      await saveTemplate.mutateAsync(editing);
      toast({ title: editing.id ? '模板已更新' : '模板已新增' });
      setEditing(null);
    } catch (e: any) {
      toast({ title: '儲存失敗', description: e.message, variant: 'destructive' });
    }
  };

  const stats = useMemo(() => ({
    templates: templates.length,
    sent: logs.filter(l => l.status === 'sent').length,
    scheduled: logs.filter(l => l.status === 'scheduled').length,
    failed: logs.filter(l => l.status === 'failed').length,
    incoming: logs.filter(l => l.status === 'incoming').length,
  }), [templates, logs]);

  return (
    <div>
      <PageHeader
        title="郵件模塊"
        description="郵件模板管理、變數替換、發票／客戶資料收集郵件、定時發送任務"
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="郵件模板" value={stats.templates} />
        <StatCard label="已發送" value={stats.sent} valueClassName="text-green-600" />
        <StatCard label="已收到" value={stats.incoming} valueClassName="text-blue-600" />
        <StatCard label="已排程" value={stats.scheduled} valueClassName="text-primary" />
        <StatCard label="發送失敗" value={stats.failed} valueClassName="text-destructive" />
      </div>

      <Tabs defaultValue="compose">
        <TabsList className="mb-4">
          <TabsTrigger value="compose" className="gap-1.5"><Send className="h-3.5 w-3.5" /> 撰寫發送</TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> 郵件模板<Badge variant="secondary" className="text-xs ml-1">{templates.length}</Badge></TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5"><Clock className="h-3.5 w-3.5" /> 發送記錄<Badge variant="secondary" className="text-xs ml-1">{logs.length}</Badge></TabsTrigger>
          <TabsTrigger value="scheduled" className="gap-1.5"><Calendar className="h-3.5 w-3.5" /> 定時任務<Badge variant="secondary" className="text-xs ml-1">{logs.filter(l => l.status === 'scheduled').length}</Badge></TabsTrigger>
        </TabsList>

        {/* ── 撰寫發送 ── */}
        <TabsContent value="compose">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: form */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">套用模板</Label>
                  <Select value={templateId} onValueChange={applyTemplate}>
                    <SelectTrigger><SelectValue placeholder="選擇模板..." /></SelectTrigger>
                    <SelectContent>
                      {templates.map(t => (
                        <SelectItem key={t.id} value={t.id}>{TYPE_LABEL[t.template_type] || ''}｜{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">關聯公司（自動帶入變數）</Label>
                  <Select value={companyId} onValueChange={applyCompany}>
                    <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
                    <SelectContent>
                      {companies.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">收件人 *</Label><Input value={to} onChange={e => setTo(e.target.value)} placeholder="client@example.com" /></div>
                <div className="space-y-1"><Label className="text-xs">副本 CC</Label><Input value={cc} onChange={e => setCc(e.target.value)} placeholder="可留空" /></div>
              </div>

              <div className="space-y-1"><Label className="text-xs">主旨 *</Label><Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="可使用 {company_name} 等變數" /></div>

              <div className="space-y-1">
                <Label className="text-xs">內文（點擊下方變數插入）</Label>
                <Textarea value={body} onChange={e => setBody(e.target.value)} rows={10} placeholder="郵件內容，支援 {variable} 變數替換" />
                <div className="flex flex-wrap gap-1 pt-1">
                  {EMAIL_VARIABLES.map(v => (
                    <button key={v.key} type="button" onClick={() => insertVar(v.key)}
                      className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted transition-colors"
                      title={v.label}>
                      {`{${v.key}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* 變數值（可調整） */}
              <div className="rounded-md border border-border p-3 space-y-2">
                <Label className="text-xs font-medium">變數值（可手動調整）</Label>
                <div className="grid grid-cols-2 gap-2">
                  {EMAIL_VARIABLES.map(v => (
                    <div key={v.key} className="space-y-0.5">
                      <Label className="text-[11px] text-muted-foreground">{v.label} {`{${v.key}}`}</Label>
                      <Input className="h-7 text-xs" value={vars[v.key] || ''}
                        onChange={e => setVars({ ...vars, [v.key]: e.target.value })} />
                    </div>
                  ))}
                </div>
              </div>

              {/* 發送方式 */}
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={sendMode} onValueChange={(v: 'now' | 'scheduled') => setSendMode(v)}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="now">立即發送</SelectItem>
                    <SelectItem value="scheduled">定時發送</SelectItem>
                  </SelectContent>
                </Select>
                {sendMode === 'scheduled' && (
                  <Input type="datetime-local" className="w-56" value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)} />
                )}
                <Button onClick={handleSend} disabled={sendEmail.isPending} className="ml-auto">
                  {sendEmail.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> :
                    sendMode === 'scheduled' ? <Clock className="h-4 w-4 mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  {sendMode === 'scheduled' ? '排程發送' : '立即發送'}
                </Button>
              </div>
            </div>

            {/* Right: preview */}
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> 預覽（變數已替換）</Label>
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <div className="text-xs text-muted-foreground">收件人：{to || '（未填）'}{cc && `｜副本：${cc}`}</div>
                  <div className="font-semibold mt-1">{previewSubject || '（無主旨）'}</div>
                </div>
                <div className="p-4 text-sm whitespace-pre-wrap min-h-[300px]">
                  {previewBody || <span className="text-muted-foreground">（無內文）</span>}
                </div>
              </div>
              {!import.meta.env.PROD && (
                <p className="text-[11px] text-muted-foreground">
                  提示：本地未設定 SMTP 時，發送為「模擬」模式（郵件會記錄於發送記錄，但不會真正寄出）。設定環境變數 SMTP_HOST/PORT/USER/PASS 即可真實寄送。
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── 郵件模板 ── */}
        <TabsContent value="templates">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => setEditing({ template_type: 'general', name: '', subject: '', body: '' })}>
              <Plus className="h-4 w-4 mr-1" /> 新增模板
            </Button>
          </div>
          {tplLoading ? (
            <p className="text-muted-foreground text-sm"><Loader2 className="h-4 w-4 inline animate-spin mr-1" />載入中...</p>
          ) : templates.length === 0 ? (
            <p className="text-muted-foreground text-sm">尚無郵件模板</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {templates.map(t => (
                <div key={t.id} className="rounded-md border border-border bg-muted/30 p-3 group">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {typeBadge(t.template_type)}
                      <span className="font-medium truncate">{t.name}</span>
                      {!!t.is_default && <Badge variant="outline" className="text-xs">預設</Badge>}
                    </div>
                    <div className="hidden group-hover:flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setEditing(t)}><Edit className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive"
                        onClick={() => { if (confirm(`刪除模板「${t.name}」？`)) deleteTemplate.mutate(t.id); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-muted-foreground truncate">{t.subject}</div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">{t.body}</div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── 發送記錄 (EM-04/05) ── */}
        <TabsContent value="logs">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">類型：</Label>
              <Select value={logTypeFilter} onValueChange={setLogTypeFilter}>
                <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="invoice">發票郵件</SelectItem>
                  <SelectItem value="collection">客戶資料收集</SelectItem>
                  <SelectItem value="reminder">申報提醒</SelectItem>
                  <SelectItem value="general">一般</SelectItem>
                  <SelectItem value="incoming">📥 收到郵件</SelectItem>
                </SelectContent>
              </Select>
              {logTypeFilter !== 'all' && (
                <Badge variant="secondary" className="text-xs">{filteredLogs.length} 筆</Badge>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
              <RefreshCw className="h-4 w-4 mr-1" /> 重新整理
            </Button>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[90px]">狀態</TableHead>
                  <TableHead className="w-[100px]">類型</TableHead>
                  <TableHead className="w-[190px]">收件人</TableHead>
                  <TableHead>主旨</TableHead>
                  <TableHead className="w-[170px]">時間</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />載入中...</TableCell></TableRow>
                ) : filteredLogs.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">尚無發送記錄</TableCell></TableRow>
                ) : (
                  filteredLogs.map(l => (
                    <TableRow key={l.id}>
                      <TableCell>{statusBadge(l.status)}{l.status === 'failed' && l.error && <div className="text-[11px] text-destructive mt-1 truncate max-w-[80px]" title={l.error}>{l.error}</div>}</TableCell>
                      <TableCell>{typeBadge(l.email_type || 'general')}</TableCell>
                      <TableCell className="text-sm">{l.to_email}{l.cc_email && <span className="text-xs text-muted-foreground"> +CC</span>}</TableCell>
                      <TableCell className="text-sm truncate max-w-[340px]">{l.subject}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.sent_at ? new Date(l.sent_at).toLocaleString('zh-HK') : new Date(l.created_at).toLocaleString('zh-HK')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── 定時任務 (EM-06/07) ── */}
        <TabsContent value="scheduled">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => {
              setSchedOpen(true);
              setSendMode('scheduled');
            }}>
              <Plus className="h-4 w-4 mr-1" /> 新增定時任務
            </Button>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[180px]">排程時間</TableHead>
                  <TableHead className="w-[100px]">類型</TableHead>
                  <TableHead className="w-[190px]">收件人</TableHead>
                  <TableHead>主旨</TableHead>
                  <TableHead className="w-[90px]">狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />載入中...</TableCell></TableRow>
                ) : logs.filter(l => l.status === 'scheduled').length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">尚無定時任務</TableCell></TableRow>
                ) : (
                  logs.filter(l => l.status === 'scheduled').map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-primary" />
                          {new Date(l.scheduled_at || '').toLocaleString('zh-HK')}
                        </span>
                      </TableCell>
                      <TableCell>{typeBadge(l.email_type || 'general')}</TableCell>
                      <TableCell className="text-sm">{l.to_email}</TableCell>
                      <TableCell className="text-sm truncate max-w-[340px]">{l.subject}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 mr-1" />等待中</Badge></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Template editor dialog ── */}
      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? '編輯郵件模板' : '新增郵件模板'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">模板名稱 *</Label><Input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
                <div className="space-y-1">
                  <Label className="text-xs">類型</Label>
                  <Select value={editing.template_type || 'general'} onValueChange={v => setEditing({ ...editing, template_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="invoice">發票郵件</SelectItem>
                      <SelectItem value="collection">客戶資料收集</SelectItem>
                      <SelectItem value="reminder">申報提醒</SelectItem>
                      <SelectItem value="general">一般</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1"><Label className="text-xs">主旨</Label><Input value={editing.subject || ''} onChange={e => setEditing({ ...editing, subject: e.target.value })} placeholder="可使用 {company_name} 等變數" /></div>
              <div className="space-y-1">
                <Label className="text-xs">內文</Label>
                <Textarea value={editing.body || ''} onChange={e => setEditing({ ...editing, body: e.target.value })} rows={10} />
                <div className="flex flex-wrap gap-1 pt-1">
                  {EMAIL_VARIABLES.map(v => (
                    <button key={v.key} type="button"
                      onClick={() => setEditing(prev => prev ? { ...prev, body: `${prev.body || ''}{${v.key}}` } : prev)}
                      className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted transition-colors"
                      title={v.label}>{`{${v.key}}`}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}><X className="h-4 w-4 mr-1" />取消</Button>
            <Button onClick={handleSaveTemplate} disabled={saveTemplate.isPending}>
              {saveTemplate.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 新增定時任務 dialog (EM-07) ── */}
      <Dialog open={schedOpen} onOpenChange={o => { if (!o) setSchedOpen(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" />新增定時任務</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">套用模板</Label>
                <Select value={templateId} onValueChange={applyTemplate}>
                  <SelectTrigger><SelectValue placeholder="選擇模板..." /></SelectTrigger>
                  <SelectContent>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>{TYPE_LABEL[t.template_type] || ''}｜{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">關聯公司</Label>
                <Select value={companyId} onValueChange={applyCompany}>
                  <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">收件人 *</Label><Input value={to} onChange={e => setTo(e.target.value)} placeholder="client@example.com" /></div>
              <div className="space-y-1"><Label className="text-xs">副本 CC</Label><Input value={cc} onChange={e => setCc(e.target.value)} placeholder="可留空" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">主旨 *</Label><Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="可使用 {company_name} 等變數" /></div>
            <div className="space-y-1">
              <Label className="text-xs">內文</Label>
              <Textarea value={body} onChange={e => setBody(e.target.value)} rows={6} placeholder="郵件內容，支援 {variable} 變數替換" />
              <div className="flex flex-wrap gap-1 pt-1">
                {EMAIL_VARIABLES.map(v => (
                  <button key={v.key} type="button" onClick={() => insertVar(v.key)}
                    className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted transition-colors"
                    title={v.label}>{`{${v.key}}`}</button>
                ))}
              </div>
            </div>
            {/* 變數值 */}
            <div className="rounded-md border border-border p-3 space-y-2">
              <Label className="text-xs font-medium">變數值（可手動調整）</Label>
              <div className="grid grid-cols-2 gap-2">
                {EMAIL_VARIABLES.map(v => (
                  <div key={v.key} className="space-y-0.5">
                    <Label className="text-[11px] text-muted-foreground">{v.label} {`{${v.key}}`}</Label>
                    <Input className="h-7 text-xs" value={vars[v.key] || ''}
                      onChange={e => setVars({ ...vars, [v.key]: e.target.value })} />
                  </div>
                ))}
              </div>
            </div>
            {/* 排程時間選擇器 (EM-07 核心) */}
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />排程發送時間 *</Label>
              <Input type="datetime-local" className="w-64" value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                min={new Date().toISOString().slice(0, 16)} />
              <p className="text-[11px] text-muted-foreground">郵件將於指定時間自動發送（需保持系統運行）</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSchedOpen(false); }}><X className="h-4 w-4 mr-1" />取消</Button>
            <Button onClick={handleSend} disabled={sendEmail.isPending}>
              {sendEmail.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Calendar className="h-4 w-4 mr-1" />}排程發送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Email;
