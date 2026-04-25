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

// === Officer (ROD) entry ===
type OfficerEntry = {
  name: string[];           // English + Chinese name lines
  address: string[];         // residential / service address lines
  birthIncorp: string[];     // DOB or place of incorporation
  idPassport?: string;       // ID number or CR number
  position?: string;
  appointedMeeting: string[];
  ceasedReason: string[];
};

// === Member (ROM) entry ===
type ShareTxn = {
  units?: string;
  date?: string;
  transactionType?: string;
  parValue?: string;
  paidUpValue?: string;
  certificateNo?: string;
  balance?: string;
  notes?: string;            // Transferred To/From etc.
};

type MemberEntry = {
  name: string[];            // English + Chinese name lines
  idPassport?: string;
  address: string[];
  security?: string;
  dateEntered?: string;
  dateCeased?: string;
  transactions: ShareTxn[];
};

type ParsedLog =
  | { kind: 'rod'; sections: { section: string; entries: OfficerEntry[] }[] }
  | { kind: 'rom'; members: MemberEntry[] }
  | { kind: 'unknown'; raw: string[] };

// Lines treated as pure column-header noise we drop
const HEADER_NOISE = new Set([
  'Date of', 'Entry / Update', 'Particulars', 'Remarks / Notes',
  'Entry', 'No', 'Date(s) Appointed', '/Meeting',
  'Reason / Date(s)', 'Date(s) Ceased',
  'Name / Service / Residential Address',
  'Date / Place Birth / Place', 'Incorporated / Occupation /',
  'ID No / Passport Details',
  'Date Entered', '/ Ceased', 'Transaction', 'Type', 'Units',
  'Par Value', 'Paid Up Value', 'Certificate', 'Balance',
  'Transferred To/From, Redeemed,', 'Reissued',
  'Per Share', 'Distinctive Numbers',
]);
const PAGE_NOISE_RE = /^(- ?\d+ ?-|REGISTER OF|Company Number|Quorum)/i;
const POSITION_RE = /^(Director|Secretary|Reserve Director|Alternate Director|Designated Representative)$/i;
const STATUS_RE = /^(Resigned|Ceased|Removed|Deceased|Struck Off)$/i;
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
// Capture HK ID like P373848(9) including the trailing parenthesised check digit.
const ID_INLINE_RE = /\(Hong Kong ID No\s*:\s*([A-Z]{1,3}\d{4,8}(?:\([0-9A-Z]\))?|\d{4,10})\s*\)/i;
const PASSPORT_TOKEN_RE = /^[A-Z]{1,3}\d{4,8}(?:\([0-9A-Z]\))?$/i;
const CR_NUMBER_RE = /^\d{4,10}$/;
const NUMERIC_BALANCE_RE = /^\(?-?[\d,]+\)?$/;
const HK_MONEY_RE = /^HK\$/i;

const cleanParagraphs = (html: string): string[] =>
  (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [])
    .map(stripLogHtml)
    .filter(Boolean)
    .filter((t) => !PAGE_NOISE_RE.test(t) && !HEADER_NOISE.has(t));

const looksLikeRom = (paragraphs: string[]): boolean =>
  paragraphs.some((p) => /Hong Kong ID No\s*:/i.test(p)) ||
  paragraphs.filter((p) => p === 'Security').length > 0;

// ----- ROD parser -----
const parseRod = (paragraphs: string[]): { section: string; entries: OfficerEntry[] }[] => {
  const sections: { section: string; entries: OfficerEntry[] }[] = [];
  let bucket = { section: '官員記錄', entries: [] as OfficerEntry[] };
  sections.push(bucket);

  let current: OfficerEntry | null = null;
  let buffer: string[] = [];
  let phase: 'pre' | 'post' = 'pre';

  const newEntry = (): OfficerEntry => ({
    name: [], address: [], birthIncorp: [], appointedMeeting: [], ceasedReason: [],
  });

  const finalizePre = (entry: OfficerEntry) => {
    if (!buffer.length) return;
    // Detect id/passport/CR token: should be a standalone line
    const idIdx = buffer.findIndex((l) => PASSPORT_TOKEN_RE.test(l) || CR_NUMBER_RE.test(l));
    let idVal: string | undefined;
    let rest = buffer;
    if (idIdx >= 0) {
      idVal = buffer[idIdx];
      rest = buffer.filter((_, i) => i !== idIdx);
    }
    // Inside `rest`: detect first DATE line → birth/incorp + place, otherwise everything is name+address.
    const dateIdx = rest.findIndex((l) => DATE_RE.test(l));
    let nameAddr: string[];
    let birth: string[] = [];
    if (dateIdx >= 0) {
      nameAddr = rest.slice(0, dateIdx);
      birth = rest.slice(dateIdx);
    } else {
      nameAddr = rest;
    }
    // Split name vs address: first 1-2 lines that contain CJK or are obvious name lines
    // Heuristic: name is the first line; if next line also contains CJK and no digits, treat as Chinese name.
    if (nameAddr.length) {
      entry.name.push(nameAddr[0]);
      let addrStart = 1;
      if (nameAddr.length > 1) {
        const second = nameAddr[1];
        const hasCJK = /[\u4e00-\u9fff]/.test(second);
        const hasDigit = /\d/.test(second);
        const looksAddr = /,/.test(second) || /(ROAD|STREET|ESTATE|FLAT|ROOM|BUILDING|HOUSE|TOWER|HONG KONG|KOWLOON|TERRITORIES|G\/F|F\.|FLOOR|VILLAGE|CENTRE|CENTER)/i.test(second);
        if (hasCJK && !hasDigit && !looksAddr) {
          entry.name.push(second);
          addrStart = 2;
        }
      }
      entry.address = nameAddr.slice(addrStart);
    }
    entry.birthIncorp = birth;
    if (idVal) entry.idPassport = idVal;
  };

  const flush = () => {
    if (current) {
      finalizePre(current);
      if (current.name.length || current.idPassport || current.position) {
        bucket.entries.push(current);
      }
    }
    current = null;
    buffer = [];
    phase = 'pre';
  };

  paragraphs.forEach((text) => {
    if (POSITION_RE.test(text)) {
      if (!current) current = newEntry();
      current.position = text;
      phase = 'post';
      return;
    }
    if (STATUS_RE.test(text)) {
      if (!current) current = newEntry();
      current.ceasedReason.push(text);
      phase = 'post';
      return;
    }
    if (DATE_RE.test(text) && phase === 'post') {
      if (!current) current = newEntry();
      if (current.ceasedReason.length) current.ceasedReason.push(text);
      else current.appointedMeeting.push(text);
      return;
    }
    // New text after we've completed a record's post phase → start next entry
    if (phase === 'post') flush();
    if (!current) current = newEntry();
    buffer.push(text);
  });
  flush();

  return sections;
};

// ----- ROM parser -----
const parseRom = (paragraphs: string[]): MemberEntry[] => {
  // Walk through paragraphs detecting "Name" markers.
  const members: MemberEntry[] = [];
  let i = 0;
  const n = paragraphs.length;

  const newMember = (): MemberEntry => ({ name: [], address: [], transactions: [] });

  // Find all member start indices (paragraph "Name")
  const starts: number[] = [];
  paragraphs.forEach((p, idx) => { if (p === 'Name') starts.push(idx); });

  // Lines appearing before the first "Name" are document/page headers (company title,
  // Chinese company name, etc.) — skip them whenever they reappear inside a slice
  // (continuation pages repeat the title rows).
  const headerSet = new Set(
    starts.length ? paragraphs.slice(0, starts[0]) : []
  );

  // We'll just split ranges between consecutive "Name" occurrences.
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1] : n;
    const slice = paragraphs.slice(start + 1, end).filter((p) => !headerSet.has(p));
    const m = newMember();

    // Collect name lines until "Address"
    let cursor = 0;
    while (cursor < slice.length && slice[cursor] !== 'Address') {
      const line = slice[cursor];
      const idMatch = line.match(ID_INLINE_RE);
      if (idMatch) {
        m.idPassport = idMatch[1].trim();
        const before = line.replace(ID_INLINE_RE, '').replace(/\s+$/, '').trim();
        if (before) m.name.push(before);
      } else {
        m.name.push(line);
      }
      cursor++;
    }
    // Address
    if (slice[cursor] === 'Address') {
      cursor++;
      while (cursor < slice.length && slice[cursor] !== 'Security' && slice[cursor] !== 'Date') {
        m.address.push(slice[cursor]);
        cursor++;
      }
    }
    // Security
    if (slice[cursor] === 'Security') {
      cursor++;
      if (cursor < slice.length && slice[cursor] !== 'Date') {
        m.security = slice[cursor];
        cursor++;
      }
    }
    // Date / Date Ceased
    if (slice[cursor] === 'Date') {
      cursor++;
      if (cursor < slice.length && DATE_RE.test(slice[cursor])) {
        m.dateEntered = slice[cursor];
        cursor++;
      }
    }
    if (slice[cursor] === 'Date Ceased') {
      cursor++;
      if (cursor < slice.length && DATE_RE.test(slice[cursor])) {
        m.dateCeased = slice[cursor];
        cursor++;
      }
    }
    // Remaining lines = transaction rows. Each transaction has the pattern:
    // Units, Date, TransactionType, ParValue, PaidUpValue, Balance, CertNo
    // with optional preceding "notes" line (e.g. "KWOK AH NAM" before a Transfer).
    const tail = slice.slice(cursor).filter(Boolean);
    // Group by detecting Date markers as txn anchors.
    let pending: ShareTxn = {};
    let prevWasNotes = false;
    let lastNote: string | undefined;
    const pushTxn = () => {
      if (Object.keys(pending).length) members; // keep linter happy
      if (
        pending.units !== undefined ||
        pending.date !== undefined ||
        pending.transactionType !== undefined ||
        pending.balance !== undefined
      ) {
        m.transactions.push(pending);
      }
      pending = {};
    };

    let k = 0;
    while (k < tail.length) {
      const line = tail[k];
      // Units = first numeric (possibly negative / parenthesised)
      if (pending.units === undefined && NUMERIC_BALANCE_RE.test(line)) {
        pending.units = line;
        k++;
        continue;
      }
      // Date for txn
      if (pending.date === undefined && DATE_RE.test(line)) {
        pending.date = line;
        k++;
        continue;
      }
      // Optional note line (e.g. transferee/transferor name) — non-numeric, non-date
      if (
        pending.transactionType === undefined &&
        !NUMERIC_BALANCE_RE.test(line) &&
        !HK_MONEY_RE.test(line) &&
        !DATE_RE.test(line) &&
        !/^(Subscription|Allotment|Transfer In|Transfer Out|Redemption|Reissue|Bonus)/i.test(line)
      ) {
        lastNote = (lastNote ? `${lastNote} ` : '') + line;
        k++;
        continue;
      }
      // Transaction type
      if (pending.transactionType === undefined && /^(Subscription|Allotment|Transfer In|Transfer Out|Redemption|Reissue|Bonus)/i.test(line)) {
        pending.transactionType = line;
        if (lastNote) { pending.notes = lastNote; lastNote = undefined; }
        k++;
        continue;
      }
      // Par value
      if (pending.parValue === undefined && HK_MONEY_RE.test(line)) {
        pending.parValue = line;
        k++;
        continue;
      }
      // Paid Up value
      if (pending.paidUpValue === undefined && HK_MONEY_RE.test(line)) {
        pending.paidUpValue = line;
        k++;
        continue;
      }
      // Balance
      if (pending.balance === undefined && NUMERIC_BALANCE_RE.test(line)) {
        pending.balance = line;
        k++;
        continue;
      }
      // Certificate No
      if (pending.certificateNo === undefined && NUMERIC_BALANCE_RE.test(line)) {
        pending.certificateNo = line;
        k++;
        // End of one transaction
        pushTxn();
        continue;
      }
      // Anything else → push current and restart with this line as units if numeric
      pushTxn();
      if (NUMERIC_BALANCE_RE.test(line)) {
        pending.units = line;
      } else if (DATE_RE.test(line)) {
        pending.date = line;
      } else {
        lastNote = (lastNote ? `${lastNote} ` : '') + line;
      }
      k++;
    }
    pushTxn();

    if (m.name.length || m.idPassport || m.address.length) members.push(m);
    i = end;
  }
  return members;
};

const parseLog = (html: string): ParsedLog => {
  const paragraphs = cleanParagraphs(html);
  if (!paragraphs.length) return { kind: 'unknown', raw: [] };
  if (looksLikeRom(paragraphs)) {
    return { kind: 'rom', members: parseRom(paragraphs) };
  }
  return { kind: 'rod', sections: parseRod(paragraphs) };
};

const RodTable = ({ sections }: { sections: { section: string; entries: OfficerEntry[] }[] }) => (
  <div className="space-y-6">
    {sections.map((section, sIdx) => (
      <div key={sIdx} className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-muted/50 font-medium text-sm">{section.section}</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead className="min-w-[200px]">姓名 / Name</TableHead>
              <TableHead className="min-w-[260px]">服務 / 居住地址</TableHead>
              <TableHead className="min-w-[160px]">出生 / 成立日期 / 地點</TableHead>
              <TableHead className="min-w-[140px]">ID / CR No</TableHead>
              <TableHead className="min-w-[110px]">職位</TableHead>
              <TableHead className="min-w-[120px]">委任日期</TableHead>
              <TableHead className="min-w-[140px]">終止 / 原因</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.entries.map((entry, idx) => (
              <TableRow key={idx} className="align-top">
                <TableCell className="text-center text-xs text-muted-foreground font-mono">{idx + 1}</TableCell>
                <TableCell className="text-sm font-medium whitespace-pre-wrap break-words">
                  {entry.name.length ? entry.name.join('\n') : '—'}
                </TableCell>
                <TableCell className="text-xs whitespace-pre-wrap break-words">
                  {entry.address.length ? entry.address.join(' ') : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                  {entry.birthIncorp.length ? entry.birthIncorp.join(' / ') : '—'}
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

const RomTable = ({ members }: { members: MemberEntry[] }) => (
  <div className="space-y-6">
    {members.map((m, idx) => (
      <div key={idx} className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-muted/40 grid grid-cols-1 md:grid-cols-12 gap-3 text-sm">
          <div className="md:col-span-4">
            <div className="text-xs text-muted-foreground mb-0.5">姓名 / Name</div>
            <div className="font-medium whitespace-pre-wrap break-words">
              {m.name.length ? m.name.join('\n') : '—'}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs text-muted-foreground mb-0.5">ID / Passport</div>
            <div className="font-mono text-xs">{m.idPassport || '—'}</div>
          </div>
          <div className="md:col-span-6">
            <div className="text-xs text-muted-foreground mb-0.5">地址 / Address</div>
            <div className="text-xs whitespace-pre-wrap break-words">
              {m.address.length ? m.address.join(' ') : '—'}
            </div>
          </div>
          <div className="md:col-span-6">
            <div className="text-xs text-muted-foreground mb-0.5">證券類別 / Security</div>
            <div className="text-xs">{m.security || '—'}</div>
          </div>
          <div className="md:col-span-3">
            <div className="text-xs text-muted-foreground mb-0.5">登記日期</div>
            <div className="text-xs font-mono">{m.dateEntered || '—'}</div>
          </div>
          <div className="md:col-span-3">
            <div className="text-xs text-muted-foreground mb-0.5">終止日期</div>
            <div className="text-xs font-mono">{m.dateCeased || '—'}</div>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead className="min-w-[110px]">日期</TableHead>
              <TableHead className="min-w-[120px]">交易類別</TableHead>
              <TableHead className="min-w-[150px]">對方 / 備註</TableHead>
              <TableHead className="text-right min-w-[90px]">股數變動</TableHead>
              <TableHead className="text-right min-w-[90px]">面值</TableHead>
              <TableHead className="text-right min-w-[90px]">已繳值</TableHead>
              <TableHead className="text-right min-w-[90px]">結餘</TableHead>
              <TableHead className="text-right min-w-[80px]">證書編號</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-3">
                  沒有交易記錄
                </TableCell>
              </TableRow>
            ) : (
              m.transactions.map((t, i) => (
                <TableRow key={i} className="align-top">
                  <TableCell className="text-center text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                  <TableCell className="text-xs font-mono whitespace-nowrap">{t.date || '—'}</TableCell>
                  <TableCell className="text-xs">{t.transactionType || '—'}</TableCell>
                  <TableCell className="text-xs whitespace-pre-wrap break-words">{t.notes || '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{t.units ?? '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{t.parValue || '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{t.paidUpValue || '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-right font-medium">{t.balance ?? '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{t.certificateNo ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    ))}
  </div>
);

const LogTableView = ({ html }: { html: string }) => {
  const parsed = useMemo(() => parseLog(html || ''), [html]);

  if (
    parsed.kind === 'unknown' ||
    (parsed.kind === 'rod' && !parsed.sections.length) ||
    (parsed.kind === 'rom' && !parsed.members.length)
  ) {
    return (
      <div className="border border-border rounded-lg p-4 text-sm text-muted-foreground">
        沒有可解析的內容
      </div>
    );
  }

  if (parsed.kind === 'rom') return <RomTable members={parsed.members} />;
  return <RodTable sections={parsed.sections} />;
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
