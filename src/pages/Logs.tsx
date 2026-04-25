import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Search, RefreshCw, X, FileText, Save, Loader2, Pencil } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanyLogs, useCompanyLogContent, useUpdateCompanyLog } from '@/hooks/useCompanyLogs';
import { useCompanies } from '@/hooks/useCompanies';

const docTypes = [
  { value: 'all', label: '所有類型' },
  { value: 'ROD', label: 'ROD（董事登記冊）' },
  { value: 'ROM', label: 'ROM（成員登記冊）' },
  { value: 'OTHER', label: '其他' },
];

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

const docTypeBadge = (t: string) => {
  if (t === 'ROD') return <Badge variant="default">ROD</Badge>;
  if (t === 'ROM') return <Badge variant="secondary">ROM</Badge>;
  return <Badge variant="outline">{t}</Badge>;
};

const stripLogHtml = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

type LogEntry = {
  nameAddress: string[];
  birthIncorpOccupation: string[];
  idPassport?: string;
  position?: string;
  appointedMeeting: string[];
  ceasedReason: string[];
};

// Pure column-header / template lines we drop entirely
const HEADER_NOISE = new Set([
  'Date of', 'Entry / Update', 'Name', 'Particulars', 'Remarks / Notes',
  'Entry', 'No', 'Position', 'Date(s) Appointed', '/Meeting',
  'Reason / Date(s)', 'Ceased', 'Date(s) Ceased',
  'Name / Service / Residential Address',
  'Date / Place Birth / Place', 'Incorporated / Occupation /',
  'ID No / Passport Details',
  'Address', 'Security', 'Date', 'Date Ceased', 'Date Entered',
  '/ Ceased', 'Transaction', 'Type', 'Units', 'Par Value',
  'Paid Up Value', 'Certificate', 'Balance',
  'Transferred To/From, Redeemed,', 'Reissued',
  'Per Share', 'Distinctive Numbers',
]);
const PAGE_NOISE_RE = /^(- ?\d+ ?-|REGISTER OF|Company Number|Quorum)/i;
const SECTION_RE = /^(Significant Controllers|Designated Representatives|Directors?|Secretar(?:y|ies)|Members?|Officers?|Reserve Directors?|Alternate Directors?)$/i;
const POSITION_RE = /^(Director|Secretary|Reserve Director|Alternate Director|Member|Designated Representative)$/i;
const STATUS_RE = /^(Resigned|Ceased|Removed|Deceased|Struck Off)$/i;
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const ENTRY_NO_RE = /^\d{1,3}$/;
const ID_PASSPORT_RE = /^(?:[A-Z]{1,3}\d{4,8}(?:\([0-9A-Z]\))?|\d{4,10})$/i;

const createLogEntry = (): LogEntry => ({
  nameAddress: [],
  birthIncorpOccupation: [],
  appointedMeeting: [],
  ceasedReason: [],
});

const applyPrePositionColumns = (entry: LogEntry, lines: string[]) => {
  if (!lines.length) return;

  const idIndex = [...lines].reverse().findIndex((line) => ID_PASSPORT_RE.test(line));
  const realIdIndex = idIndex >= 0 ? lines.length - 1 - idIndex : -1;
  const bodyLines = realIdIndex >= 0 ? lines.filter((_, idx) => idx !== realIdIndex) : lines;

  if (realIdIndex >= 0) entry.idPassport = lines[realIdIndex];

  const birthOrIncorpIndex = bodyLines.findIndex((line) => DATE_RE.test(line));
  if (birthOrIncorpIndex >= 0) {
    entry.nameAddress = bodyLines.slice(0, birthOrIncorpIndex);
    entry.birthIncorpOccupation = bodyLines.slice(birthOrIncorpIndex);
  } else {
    entry.nameAddress = bodyLines;
  }
};

const parseLogEntries = (html: string): { section: string; entries: LogEntry[] }[] => {
  const paragraphs = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [])
    .map(stripLogHtml)
    .filter(Boolean)
    .filter((t) => !PAGE_NOISE_RE.test(t) && !HEADER_NOISE.has(t));

  const sections: { section: string; entries: LogEntry[] }[] = [];
  let currentSection = '記錄';
  let current: LogEntry | null = null;
  let prePositionLines: string[] = [];
  let phase: 'prePosition' | 'postPosition' = 'prePosition';

  const ensureSection = () => {
    let bucket = sections.find((s) => s.section === currentSection);
    if (!bucket) {
      bucket = { section: currentSection, entries: [] };
      sections.push(bucket);
    }
    return bucket;
  };

  const flush = () => {
    if (current) {
      applyPrePositionColumns(current, prePositionLines);
    }
    if (current && (current.nameAddress.length || current.idPassport || current.position)) {
      ensureSection().entries.push(current);
    }
    current = null;
    prePositionLines = [];
    phase = 'prePosition';
  };

  paragraphs.forEach((text) => {
    if (SECTION_RE.test(text)) {
      flush();
      currentSection = text;
      return;
    }

    // Entry number after a completed row → end of record
    if (ENTRY_NO_RE.test(text) && phase === 'postPosition') {
      flush();
      return;
    }

    if (STATUS_RE.test(text)) {
      if (!current) return;
      current.ceasedReason.push(text);
      phase = 'postPosition';
      return;
    }

    if (POSITION_RE.test(text)) {
      if (!current) current = createLogEntry();
      current.position = text;
      phase = 'postPosition';
      return;
    }

    if (DATE_RE.test(text) && phase === 'postPosition') {
      if (!current) current = createLogEntry();
      if (current.ceasedReason.length) current.ceasedReason.push(text);
      else current.appointedMeeting.push(text);
      return;
    }

    // Regular text after appointed/ceased columns starts the next row.
    if (phase === 'postPosition') flush();

    if (!current) current = createLogEntry();
    prePositionLines.push(text);
  });
  flush();

  return sections;
};

const LogTableView = ({ html }: { html: string }) => {
  const sections = useMemo(() => parseLogEntries(html || ''), [html]);

  if (!sections.length) {
    return (
      <div className="border border-border rounded-lg p-4 text-sm text-muted-foreground">
        沒有可解析的內容
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sections.map((section, sIdx) => (
        <div key={sIdx} className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-muted/50 font-medium text-sm">{section.section}</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead className="min-w-[260px]">Name / Service / Residential Address</TableHead>
                <TableHead className="min-w-[190px]">Date / Place Birth / Place Incorporated / Occupation</TableHead>
                <TableHead className="min-w-[150px]">ID No / Passport Details</TableHead>
                <TableHead className="min-w-[120px]">Position</TableHead>
                <TableHead className="min-w-[130px]">Date(s) Appointed / Meeting</TableHead>
                <TableHead className="min-w-[150px]">Reason / Date(s) Ceased</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.entries.map((entry, idx) => (
                <TableRow key={idx} className="align-top">
                  <TableCell className="text-center text-xs text-muted-foreground font-mono">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="text-sm font-medium whitespace-pre-wrap break-words">
                    {entry.nameAddress.length ? entry.nameAddress.join('\n') : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="space-y-0.5">
                      {entry.birthIncorpOccupation.map((d, i) => (
                        <div key={i} className="whitespace-pre-wrap break-words">{d}</div>
                      ))}
                      {!entry.birthIncorpOccupation.length && <span>—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs font-mono whitespace-nowrap">{entry.idPassport || '—'}</TableCell>
                  <TableCell className="text-sm">{entry.position || '—'}</TableCell>
                  <TableCell className="text-xs font-mono whitespace-nowrap">
                    {entry.appointedMeeting.length ? entry.appointedMeeting.join(', ') : '—'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {entry.ceasedReason.length ? entry.ceasedReason.join(', ') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
};

const Logs = () => {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [docType, setDocType] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftHtml, setDraftHtml] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

  const { data: logs = [], isLoading, refetch } = useCompanyLogs({ search, docType });
  const { data: companies = [] } = useCompanies();
  const { data: openLog } = useCompanyLogContent(openId);
  const updateLog = useUpdateCompanyLog();

  const companyMap = useMemo(() => {
    const m = new Map<string, string>();
    companies.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [companies]);

  const totalPages = Math.max(1, Math.ceil(logs.length / pageSize));
  const pagedLogs = logs.slice((page - 1) * pageSize, page * pageSize);

  const handleSearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleClear = () => {
    setSearchInput('');
    setSearch('');
    setDocType('all');
    setPage(1);
  };

  const handleOpen = (id: string) => {
    setOpenId(id);
    setEditing(false);
  };

  const handleStartEdit = () => {
    if (!openLog) return;
    setDraftHtml(openLog.html_content);
    setDraftNotes(openLog.notes || '');
    setEditing(true);
  };

  const handleSave = async () => {
    if (!openLog) return;
    try {
      await updateLog.mutateAsync({
        id: openLog.id,
        html_content: draftHtml,
        notes: draftNotes,
      });
      toast({ title: '已儲存', description: '日誌內容已更新' });
      setEditing(false);
    } catch (e: any) {
      toast({ title: '儲存失敗', description: e.message, variant: 'destructive' });
    }
  };

  const stats = useMemo(() => {
    const rod = logs.filter((l) => l.doc_type === 'ROD').length;
    const rom = logs.filter((l) => l.doc_type === 'ROM').length;
    const linked = logs.filter((l) => !!l.company_id).length;
    return { total: logs.length, rod, rom, linked, unlinked: logs.length - linked };
  }, [logs]);

  return (
    <div>
      <PageHeader
        title="公司日誌"
        description="ROD（董事登記冊）與 ROM（成員登記冊）等公司歷史文件，可線上閱讀與編輯"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              重新整理
            </Button>
          </div>
        }
      />

      {/* Search */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">搜尋日誌</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="md:col-span-2">
            <Label className="text-sm text-muted-foreground mb-2 block">公司名稱關鍵字</Label>
            <Input
              placeholder="例如 Wingtai、Profit Master..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">文件類型</Label>
            <Select value={docType} onValueChange={(v) => { setDocType(v); setPage(1); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {docTypes.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleClear}>
            <X className="h-4 w-4 mr-1" />清除
          </Button>
          <Button size="sm" onClick={handleSearch}>
            <Search className="h-4 w-4 mr-1" />搜尋
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="總記錄數" value={stats.total} />
        <StatCard label="ROD 文件" value={stats.rod} valueClassName="text-primary" />
        <StatCard label="ROM 文件" value={stats.rom} valueClassName="text-primary" />
        <StatCard label="已關聯公司" value={stats.linked} />
        <StatCard label="未關聯" value={stats.unlinked} valueClassName="text-muted-foreground" />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[100px]">類型</TableHead>
              <TableHead className="w-[200px]">公司關鍵字</TableHead>
              <TableHead>關聯公司</TableHead>
              <TableHead className="w-[280px]">原始檔名</TableHead>
              <TableHead className="w-[120px]">來源資料夾</TableHead>
              <TableHead className="w-[100px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />載入中...</TableCell></TableRow>
            ) : pagedLogs.length > 0 ? (
              pagedLogs.map((log) => (
                <TableRow key={log.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => handleOpen(log.id)}>
                  <TableCell>{docTypeBadge(log.doc_type)}</TableCell>
                  <TableCell className="font-medium">{log.company_name_hint}</TableCell>
                  <TableCell className="text-sm">
                    {log.company_id ? (
                      <span className="text-foreground">{companyMap.get(log.company_id) || log.company_id}</span>
                    ) : (
                      <span className="text-muted-foreground italic">未關聯</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[280px]">{log.original_filename}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{log.source_folder}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleOpen(log.id); }}>
                      <FileText className="h-4 w-4 mr-1" />開啟
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">沒有找到符合條件的記錄</TableCell></TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="text-sm text-muted-foreground">
            顯示 {logs.length === 0 ? 0 : (page - 1) * pageSize + 1} – {Math.min(page * pageSize, logs.length)} 筆，共 {logs.length} 筆
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-24 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n} 筆</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8" disabled={page === 1} onClick={() => setPage(1)}>{'<<'}</Button>
            <Button variant="outline" size="sm" className="h-8" disabled={page === 1} onClick={() => setPage(page - 1)}>{'<'}</Button>
            <span className="px-2 text-sm">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{'>'}</Button>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>{'>>'}</Button>
          </div>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!openId} onOpenChange={(o) => { if (!o) { setOpenId(null); setEditing(false); } }}>
        <DialogContent className="max-w-none w-[95vw] h-[95vh] sm:rounded-lg overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {openLog && docTypeBadge(openLog.doc_type)}
              <span>{openLog?.company_name_hint || '載入中...'}</span>
              {openLog?.company_id && (
                <span className="text-sm text-muted-foreground font-normal">
                  → {companyMap.get(openLog.company_id) || openLog.company_id}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto space-y-3">
            {openLog && (
              <>
                <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                  <span>檔案：{openLog.original_filename}</span>
                  <span>•</span>
                  <span>來源：{openLog.source_folder}</span>
                  <span>•</span>
                  <span>更新於：{new Date(openLog.updated_at).toLocaleString()}</span>
                </div>

                {editing ? (
                  <div>
                    <Label className="text-sm text-muted-foreground mb-1 block">HTML 內容</Label>
                    <Textarea
                      value={draftHtml}
                      onChange={(e) => setDraftHtml(e.target.value)}
                      className="min-h-[420px] font-mono text-xs"
                    />
                  </div>
                ) : (
                  <LogTableView html={openLog.html_content} />
                )}

                <div>
                  <Label className="text-sm text-muted-foreground mb-1 block">備註</Label>
                  <Input
                    value={editing ? draftNotes : openLog.notes || ''}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    disabled={!editing}
                    placeholder="可加入修訂備註..."
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter className="flex-shrink-0">
            {!editing ? (
              <>
                <Button variant="outline" onClick={() => setOpenId(null)}>關閉</Button>
                <Button onClick={handleStartEdit}>
                  <Pencil className="h-4 w-4 mr-1" />編輯
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setEditing(false)} disabled={updateLog.isPending}>取消</Button>
                <Button onClick={handleSave} disabled={updateLog.isPending}>
                  {updateLog.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  儲存
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Logs;
