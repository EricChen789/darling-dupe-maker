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
  dateOfBirth?: string;
  passportDetails?: string;
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
  'Reason / Date(s)', 'Date(s) Ceased', 'Ceased', 'Position',
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
const CN_ID_RE = /^\d{15,18}[0-9Xx]?$/;
const PASSPORT_LINE_RE = /^Passport\s+Number\s+/i;
const CR_NUMBER_RE = /^\d{4,10}$/;
const NUMERIC_BALANCE_RE = /^\(?-?[\d,]+\)?$/;
const CURRENCY_RE = /^(HK\$|US\$|USD|RMB|CNY|EUR|GBP|JPY|AUD|SGD|CAD|NZD)\s*[\d,.]+$/i;
const TXN_TYPE_RE = /^(Subscription|Allotment|Transfer In|Transfer Out|Redemption|Reissue|Bonus|Issue|Surrender|Forfeiture)/i;

// Some RTF exports collapse an entire ROD/ROM table row into a single <p>.
// Detect those and split into the logical lines before parsing.
// Match company titles in either Latin (\b boundary) or CJK form (no \b for Chinese).
const COMPANY_TITLE_RE = /(\b(LIMITED|CORPORATION|HOLDINGS|COMPANY|CO\.|LTD\.?)\b|有限公司|股?份有限公司|集團)/i;
const explodeCompoundLine = (text: string): string[] => {
  // Look for a position keyword glued to a date, e.g. "...Director01/01/2016" or "...Secretary 01/01/2016"
  const POS_DATE = /(Director|Secretary|Reserve Director|Alternate Director|Designated Representative)\s*(\d{1,2}\/\d{1,2}\/\d{4})/;
  const m = text.match(POS_DATE);
  if (!m) return [text];
  const pos = m[1];
  const date = m[2];
  const idx = text.indexOf(m[0]);
  const head = text.slice(0, idx).trim();
  const tail = text.slice(idx + m[0].length).trim();

  const out: string[] = [];
  // Split head: try to peel off a leading company title (ENG + optional CJK) before the personal record.
  // Heuristic: find the first run of uppercase ASCII personal name (>=2 words) following the company title.
  let personStart = -1;
  // Scan for a pattern like ' AU KWOK LAM' — uppercase tokens after a LIMITED/有限公司 boundary.
  const compMatch = head.match(/^(.*?(?:LIMITED|有限公司|CORPORATION|HOLDINGS)[^\sA-Z]*)\s*([\u4e00-\u9fff]+)?\s*([A-Z][A-Z\s]{3,}?)\s+/);
  if (compMatch) {
    personStart = compMatch[0].length - compMatch[3].length - 1;
    // Drop the company title entirely (it's redundant — the section header already shows it)
  }
  const rest = personStart >= 0 ? head.slice(personStart).trim() : head;

  // Try to peel ID like "—P373848(9)" or "(Hong Kong ID No : ...)" off the end of `rest`.
  let body = rest;
  let idLine: string | undefined;
  const idTail = body.match(/[—\-–]\s*([A-Z]{1,3}\d{4,8}(?:\([0-9A-Z]\))?)\s*$/);
  if (idTail) {
    idLine = idTail[1];
    body = body.slice(0, idTail.index).trim();
  }

  // Split body into name + address by detecting first address keyword
  const ADDR_KEYS = /(FLAT|ROOM|UNIT|G\/F|\d+\/F|FLOOR|HOUSE|TOWER|BUILDING|BLOCK|ESTATE|ROAD|STREET|AVENUE|LANE|VILLAGE|CENTRE|CENTER|PLAZA|COURT|GARDEN|MANSION|NO\.\s*\d)/i;
  const addrMatch = body.match(ADDR_KEYS);
  if (addrMatch && addrMatch.index !== undefined) {
    const namePart = body.slice(0, addrMatch.index).trim();
    const addrPart = body.slice(addrMatch.index).trim();
    if (namePart) out.push(namePart);
    if (addrPart) out.push(addrPart);
  } else if (body) {
    out.push(body);
  }

  if (idLine) out.push(idLine);
  out.push(pos);
  out.push(date);
  if (tail) out.push(...explodeCompoundLine(tail));
  return out;
};

const cleanParagraphs = (html: string): string[] => {
  const raw = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [])
    .map(stripLogHtml)
    .filter(Boolean);
  const exploded: string[] = [];
  for (const t of raw) {
    if (/(Director|Secretary|Representative)\s*\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) {
      exploded.push(...explodeCompoundLine(t));
    } else {
      exploded.push(t);
    }
  }
  // Drop preamble company-title lines that appear BEFORE the first officer/member record begins.
  // Keep company-title lines that appear inside officer entries (e.g. corporate director/secretary names
  // such as "TWINSAIL CONSULTANTS LIMITED" / "雙帆顧問有限公司").
  const trimmed = exploded.map((t) => t.trim()).filter(Boolean);
  // First "real" record marker: a Position keyword (ROD) or "Name" anchor (ROM).
  let firstRecordIdx = trimmed.findIndex(
    (t) => POSITION_RE.test(t) || t === 'Name'
  );
  if (firstRecordIdx < 0) firstRecordIdx = trimmed.length;

  return trimmed.filter((t, i) => {
    if (PAGE_NOISE_RE.test(t)) return false;
    if (HEADER_NOISE.has(t)) return false;
    const isCompanyTitle =
      COMPANY_TITLE_RE.test(t) &&
      !/(FLAT|ROOM|FLOOR|ROAD|STREET|HOUSE|BUILDING|ESTATE|TOWER)/i.test(t) &&
      t.length < 80;
    // Drop company-title lines only in the preamble (before first officer/member record).
    if (isCompanyTitle && i < firstRecordIdx) return false;
    return true;
  });
};

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

    // 1) Locate ID line. Multiple possible formats:
    //    - HK ID standalone (e.g. P373848(9))
    //    - CN national ID (15-18 digits, optional X)
    //    - CR number (4-10 digits) — only when no DOB present (corporate secretary)
    //    - "Passport Number XXX issued by YYY" possibly spanning 2 lines
    let idVal: string | undefined;
    const consumed = new Set<number>();

    // Passport Number multi-line
    const pIdx = buffer.findIndex((l) => PASSPORT_LINE_RE.test(l));
    if (pIdx >= 0) {
      const parts = [buffer[pIdx]];
      consumed.add(pIdx);
      // Optionally consume the next line if it begins with "issued by" or starts lowercase / CJK continuation
      if (pIdx + 1 < buffer.length) {
        const nxt = buffer[pIdx + 1];
        if (/^issued\s+by/i.test(nxt) || (!POSITION_RE.test(nxt) && !DATE_RE.test(nxt) && parts[0].length < 60)) {
          // Heuristic: only merge if line looks like continuation (short, contains "issued" or place name)
          if (/^issued\s+by/i.test(nxt) || /[\u4e00-\u9fff]/.test(nxt) || /^[A-Z][A-Z\s]+$/.test(nxt)) {
            parts.push(nxt);
            consumed.add(pIdx + 1);
          }
        }
      }
      idVal = parts.join(' ');
    } else {
      const idIdx = buffer.findIndex((l) =>
        PASSPORT_TOKEN_RE.test(l) || CN_ID_RE.test(l) || CR_NUMBER_RE.test(l)
      );
      if (idIdx >= 0) {
        idVal = buffer[idIdx];
        consumed.add(idIdx);
      }
    }

    const rest = buffer.filter((_, i) => !consumed.has(i));

    // 2) Detect first DATE line → DOB / Incorp date; everything from there until end (excl. id) is birth/incorp/occupation.
    const dateIdx = rest.findIndex((l) => DATE_RE.test(l));
    let nameAddr: string[];
    let birth: string[] = [];
    if (dateIdx >= 0) {
      nameAddr = rest.slice(0, dateIdx);
      birth = rest.slice(dateIdx);
    } else {
      // No DOB. If we still have an "occupation" / place-only line (e.g. MERCHANT) at the end,
      // treat trailing lines that look like single-token occupations as birthIncorp.
      // Heuristic: from the end, peel off lines that are short uppercase tokens or CJK-only short lines.
      let cut = rest.length;
      while (cut > 1) {
        const cand = rest[cut - 1];
        const isShortOccupation =
          /^[A-Z][A-Z\s.\-/&]{1,30}$/.test(cand) && !/(ROAD|STREET|ESTATE|FLAT|ROOM|BUILDING|HOUSE|TOWER|HONG KONG|KOWLOON|TERRITORIES|FLOOR|VILLAGE|CENTRE|CENTER|AVENUE|LANE|PLAZA|COURT|GARDEN|MANSION)/i.test(cand);
        const isShortCJK = /^[\u4e00-\u9fff]{1,8}$/.test(cand);
        if (isShortOccupation || isShortCJK) {
          cut--;
        } else break;
      }
      nameAddr = rest.slice(0, cut);
      birth = rest.slice(cut);
    }

    // 3) Split name vs address
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
      // Only accept entries with a real Position (filters out preamble/title noise)
      if (current.position && current.name.length) {
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
  const members: MemberEntry[] = [];
  const n = paragraphs.length;

  const newMember = (): MemberEntry => ({ name: [], address: [], transactions: [] });

  // Find all member start indices (paragraph "Name")
  const starts: number[] = [];
  paragraphs.forEach((p, idx) => { if (p === 'Name') starts.push(idx); });

  // Lines appearing before the first "Name" are document/page headers — skip them
  // when they reappear inside continuation pages.
  const headerSet = new Set(
    starts.length ? paragraphs.slice(0, starts[0]) : []
  );

  // Anchors that delimit member-card sub-fields
  const MEMBER_ANCHORS = new Set([
    'Address', 'Date of Birth', 'Passport Details',
    'Security', 'Date', 'Date Ceased',
  ]);

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1] : n;
    const slice = paragraphs.slice(start + 1, end).filter((p) => !headerSet.has(p));
    const m = newMember();

    let cursor = 0;

    // --- Name (until next anchor) ---
    while (cursor < slice.length && !MEMBER_ANCHORS.has(slice[cursor])) {
      const line = slice[cursor];
      // Defensive: skip company-title / page-header lines that may slip past headerSet
      // (e.g. continuation-page company name reappearing inside a member's slice).
      if (
        COMPANY_TITLE_RE.test(line) &&
        !/(FLAT|ROOM|FLOOR|ROAD|STREET|HOUSE|BUILDING|ESTATE|TOWER|VILLAGE)/i.test(line) &&
        line.length < 80
      ) {
        cursor++;
        continue;
      }
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

    // --- Walk through anchored sub-sections until we hit transaction header zone ---
    // Transaction header zone starts when we see lines like "Date Entered" or noise table headers.
    // After Date Ceased we expect the transaction column-header block (already filtered as HEADER_NOISE).
    while (cursor < slice.length && MEMBER_ANCHORS.has(slice[cursor])) {
      const anchor = slice[cursor];
      cursor++;
      if (anchor === 'Date' || anchor === 'Date Ceased') {
        // Peek exactly one date line if present; otherwise leave empty.
        if (cursor < slice.length && DATE_RE.test(slice[cursor])) {
          if (anchor === 'Date') m.dateEntered = slice[cursor];
          else m.dateCeased = slice[cursor];
          cursor++;
        }
        continue;
      }
      // Collect value lines until next anchor OR until a line that clearly
      // belongs to the transaction table (numeric units or a stray date).
      const vals: string[] = [];
      while (cursor < slice.length && !MEMBER_ANCHORS.has(slice[cursor])) {
        const line = slice[cursor];
        if (NUMERIC_BALANCE_RE.test(line) || DATE_RE.test(line)) break;
        vals.push(line);
        cursor++;
      }
      switch (anchor) {
        case 'Address': m.address = vals; break;
        case 'Date of Birth': m.dateOfBirth = vals.join(' ').trim() || undefined; break;
        case 'Passport Details': m.passportDetails = vals.join(' ').trim() || undefined; break;
        case 'Security': m.security = vals.join(' ').trim() || undefined; break;
      }
    }

    // --- Remaining = transaction rows ---
    // Per row order observed in source RTF stream:
    //   Units, Date, [counterparty notes lines], Type, Par, Paid, Balance, Cert
    const tail = slice.slice(cursor).filter(Boolean);

    let pending: ShareTxn = {};
    let noteBuf: string[] = [];
    let stage: 'units' | 'date' | 'notes_or_type' | 'par' | 'paid' | 'balance' | 'cert' = 'units';

    const pushTxn = () => {
      if (
        pending.units !== undefined ||
        pending.date !== undefined ||
        pending.transactionType !== undefined ||
        pending.balance !== undefined
      ) {
        if (noteBuf.length) pending.notes = noteBuf.join(' ');
        m.transactions.push(pending);
      }
      pending = {};
      noteBuf = [];
      stage = 'units';
    };

    const isCurrencyLike = (l: string) => CURRENCY_RE.test(l) || /^[A-Z]{2,4}\s*[\d,.]+$/.test(l);

    for (let k = 0; k < tail.length; k++) {
      const line = tail[k];

      if (stage === 'units') {
        if (NUMERIC_BALANCE_RE.test(line)) { pending.units = line; stage = 'date'; continue; }
        // Skip stray non-numeric line at units stage
        continue;
      }
      if (stage === 'date') {
        if (DATE_RE.test(line)) { pending.date = line; stage = 'notes_or_type'; continue; }
        // No date — treat current line as note start
        stage = 'notes_or_type';
        // fallthrough
      }
      if (stage === 'notes_or_type') {
        if (TXN_TYPE_RE.test(line)) {
          pending.transactionType = line;
          stage = 'par';
          continue;
        }
        // Counterparty / transferred-to lines accumulate
        if (!NUMERIC_BALANCE_RE.test(line) && !isCurrencyLike(line) && !DATE_RE.test(line)) {
          noteBuf.push(line);
          continue;
        }
        // Unexpected — skip
        continue;
      }
      if (stage === 'par') {
        if (isCurrencyLike(line)) { pending.parValue = line; stage = 'paid'; continue; }
        // Some templates skip par/paid; if numeric, treat as balance
        if (NUMERIC_BALANCE_RE.test(line)) { pending.balance = line; stage = 'cert'; continue; }
        continue;
      }
      if (stage === 'paid') {
        if (isCurrencyLike(line)) { pending.paidUpValue = line; stage = 'balance'; continue; }
        if (NUMERIC_BALANCE_RE.test(line)) { pending.balance = line; stage = 'cert'; continue; }
        continue;
      }
      if (stage === 'balance') {
        if (NUMERIC_BALANCE_RE.test(line)) { pending.balance = line; stage = 'cert'; continue; }
        continue;
      }
      if (stage === 'cert') {
        if (NUMERIC_BALANCE_RE.test(line)) {
          pending.certificateNo = line;
          pushTxn();
          continue;
        }
        // Next row started without explicit cert
        pushTxn();
        // Reprocess this line as the start of next row
        k--;
        continue;
      }
    }
    pushTxn();

    if (m.name.length || m.idPassport || m.address.length) members.push(m);
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
            <div className="text-xs text-muted-foreground mb-0.5">HK ID</div>
            <div className="font-mono text-xs">{m.idPassport || '—'}</div>
          </div>
          <div className="md:col-span-6">
            <div className="text-xs text-muted-foreground mb-0.5">地址 / Address</div>
            <div className="text-xs whitespace-pre-wrap break-words">
              {m.address.length ? m.address.join(' ') : '—'}
            </div>
          </div>
          <div className="md:col-span-3">
            <div className="text-xs text-muted-foreground mb-0.5">出生日期</div>
            <div className="text-xs font-mono">{m.dateOfBirth || '—'}</div>
          </div>
          <div className="md:col-span-5">
            <div className="text-xs text-muted-foreground mb-0.5">護照詳情 / Passport</div>
            <div className="text-xs">{m.passportDetails || '—'}</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs text-muted-foreground mb-0.5">登記日期</div>
            <div className="text-xs font-mono">{m.dateEntered || '—'}</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs text-muted-foreground mb-0.5">終止日期</div>
            <div className="text-xs font-mono">{m.dateCeased || '—'}</div>
          </div>
          <div className="md:col-span-12">
            <div className="text-xs text-muted-foreground mb-0.5">證券類別 / Security</div>
            <div className="text-xs">{m.security || '—'}</div>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead className="min-w-[110px]">日期</TableHead>
              <TableHead className="min-w-[120px]">交易類別</TableHead>
              <TableHead className="text-right min-w-[90px]">股數</TableHead>
              <TableHead className="text-right min-w-[90px]">面值/股</TableHead>
              <TableHead className="text-right min-w-[90px]">已繳/股</TableHead>
              <TableHead className="text-right min-w-[80px]">證書編號</TableHead>
              <TableHead className="min-w-[150px]">對方 / 備註</TableHead>
              <TableHead className="text-right min-w-[90px]">結餘</TableHead>
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
                  <TableCell className="text-xs font-mono text-right">{t.units ?? '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{t.parValue || '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{t.paidUpValue || '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{t.certificateNo ?? '—'}</TableCell>
                  <TableCell className="text-xs whitespace-pre-wrap break-words">{t.notes || '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-right font-medium">{t.balance ?? '—'}</TableCell>
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

// =============================================================================
// Editable structured editors (Excel-like cell-by-cell editing)
// =============================================================================

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Extract the document preamble (paragraphs before the first officer/member record)
// from the original HTML so it survives a round-trip through editing.
const extractPreamble = (html: string): string[] => {
  const raw = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [])
    .map(stripLogHtml)
    .map((t) => t.trim())
    .filter(Boolean);
  const firstIdx = raw.findIndex((t) => POSITION_RE.test(t) || t === 'Name');
  return firstIdx <= 0 ? raw : raw.slice(0, firstIdx);
};

const linesToParagraphs = (lines: string[]): string =>
  lines
    .map((l) => l.split('\n').map((x) => x.trim()).filter(Boolean))
    .flat()
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join('\n');

const serializeRod = (
  preamble: string[],
  sections: { section: string; entries: OfficerEntry[] }[],
): string => {
  const out: string[] = preamble.map((p) => `<p>${escapeHtml(p)}</p>`);
  sections.forEach((sec) => {
    sec.entries.forEach((e) => {
      e.name.forEach((n) => out.push(`<p>${escapeHtml(n)}</p>`));
      e.address.forEach((a) => out.push(`<p>${escapeHtml(a)}</p>`));
      e.birthIncorp.forEach((b) => out.push(`<p>${escapeHtml(b)}</p>`));
      if (e.idPassport) out.push(`<p>${escapeHtml(e.idPassport)}</p>`);
      if (e.position) out.push(`<p>${escapeHtml(e.position)}</p>`);
      e.appointedMeeting.forEach((d) => out.push(`<p>${escapeHtml(d)}</p>`));
      e.ceasedReason.forEach((c) => out.push(`<p>${escapeHtml(c)}</p>`));
    });
  });
  return out.join('\n');
};

const serializeRom = (preamble: string[], members: MemberEntry[]): string => {
  const out: string[] = preamble.map((p) => `<p>${escapeHtml(p)}</p>`);
  members.forEach((m) => {
    out.push(`<p>Name</p>`);
    m.name.forEach((n, i) => {
      // Re-attach HK ID inline on the first name line if present and not already inline.
      if (i === 0 && m.idPassport && !/Hong Kong ID No/i.test(n)) {
        out.push(`<p>${escapeHtml(`${n} (Hong Kong ID No : ${m.idPassport})`)}</p>`);
      } else {
        out.push(`<p>${escapeHtml(n)}</p>`);
      }
    });
    if (m.address.length) {
      out.push(`<p>Address</p>`);
      m.address.forEach((a) => out.push(`<p>${escapeHtml(a)}</p>`));
    }
    if (m.dateOfBirth) {
      out.push(`<p>Date of Birth</p>`);
      out.push(`<p>${escapeHtml(m.dateOfBirth)}</p>`);
    }
    if (m.passportDetails) {
      out.push(`<p>Passport Details</p>`);
      out.push(`<p>${escapeHtml(m.passportDetails)}</p>`);
    }
    if (m.security) {
      out.push(`<p>Security</p>`);
      out.push(`<p>${escapeHtml(m.security)}</p>`);
    }
    if (m.dateEntered) {
      out.push(`<p>Date</p>`);
      out.push(`<p>${escapeHtml(m.dateEntered)}</p>`);
    }
    if (m.dateCeased) {
      out.push(`<p>Date Ceased</p>`);
      out.push(`<p>${escapeHtml(m.dateCeased)}</p>`);
    }
    m.transactions.forEach((t) => {
      if (t.units !== undefined) out.push(`<p>${escapeHtml(t.units)}</p>`);
      if (t.date) out.push(`<p>${escapeHtml(t.date)}</p>`);
      if (t.notes) t.notes.split('\n').forEach((ln) => ln.trim() && out.push(`<p>${escapeHtml(ln.trim())}</p>`));
      if (t.transactionType) out.push(`<p>${escapeHtml(t.transactionType)}</p>`);
      if (t.parValue) out.push(`<p>${escapeHtml(t.parValue)}</p>`);
      if (t.paidUpValue) out.push(`<p>${escapeHtml(t.paidUpValue)}</p>`);
      if (t.balance !== undefined) out.push(`<p>${escapeHtml(t.balance)}</p>`);
      if (t.certificateNo !== undefined) out.push(`<p>${escapeHtml(t.certificateNo)}</p>`);
    });
  });
  return out.join('\n');
};

// Tiny inline editor: textarea that auto-grows with rows={lines}.
const CellEditor = ({
  value,
  onChange,
  multiline = false,
  placeholder,
  className = '',
  mono = false,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) => {
  const base = `w-full bg-transparent border border-transparent hover:border-border focus:border-ring focus:bg-background rounded px-1.5 py-1 text-xs ${mono ? 'font-mono' : ''} ${className}`;
  if (multiline) {
    const rows = Math.max(1, value.split('\n').length);
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`${base} resize-y outline-none`}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${base} outline-none`}
    />
  );
};

const EditableRodTable = ({
  sections,
  onChange,
}: {
  sections: { section: string; entries: OfficerEntry[] }[];
  onChange: (next: { section: string; entries: OfficerEntry[] }[]) => void;
}) => {
  const updateEntry = (sIdx: number, eIdx: number, patch: Partial<OfficerEntry>) => {
    const next = sections.map((s, i) =>
      i !== sIdx ? s : { ...s, entries: s.entries.map((e, j) => (j !== eIdx ? e : { ...e, ...patch })) }
    );
    onChange(next);
  };
  const addRow = (sIdx: number) => {
    const next = sections.map((s, i) =>
      i !== sIdx
        ? s
        : {
            ...s,
            entries: [
              ...s.entries,
              { name: [''], address: [], birthIncorp: [], appointedMeeting: [], ceasedReason: [] } as OfficerEntry,
            ],
          }
    );
    onChange(next);
  };
  const removeRow = (sIdx: number, eIdx: number) => {
    const next = sections.map((s, i) =>
      i !== sIdx ? s : { ...s, entries: s.entries.filter((_, j) => j !== eIdx) }
    );
    onChange(next);
  };

  return (
    <div className="space-y-6">
      {sections.map((section, sIdx) => (
        <div key={sIdx} className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-muted/50 font-medium text-sm flex items-center justify-between">
            <span>{section.section}</span>
            <Button size="sm" variant="outline" onClick={() => addRow(sIdx)}>+ 新增一列</Button>
          </div>
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
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.entries.map((entry, idx) => (
                <TableRow key={idx} className="align-top">
                  <TableCell className="text-center text-xs text-muted-foreground font-mono">{idx + 1}</TableCell>
                  <TableCell>
                    <CellEditor
                      multiline
                      value={entry.name.join('\n')}
                      onChange={(v) => updateEntry(sIdx, idx, { name: v.split('\n') })}
                      placeholder="英文名 / 中文名"
                    />
                  </TableCell>
                  <TableCell>
                    <CellEditor
                      multiline
                      value={entry.address.join('\n')}
                      onChange={(v) => updateEntry(sIdx, idx, { address: v.split('\n') })}
                    />
                  </TableCell>
                  <TableCell>
                    <CellEditor
                      multiline
                      value={entry.birthIncorp.join('\n')}
                      onChange={(v) => updateEntry(sIdx, idx, { birthIncorp: v.split('\n') })}
                      placeholder="DD/MM/YYYY"
                    />
                  </TableCell>
                  <TableCell>
                    <CellEditor
                      mono
                      value={entry.idPassport || ''}
                      onChange={(v) => updateEntry(sIdx, idx, { idPassport: v || undefined })}
                    />
                  </TableCell>
                  <TableCell>
                    <CellEditor
                      value={entry.position || ''}
                      onChange={(v) => updateEntry(sIdx, idx, { position: v || undefined })}
                    />
                  </TableCell>
                  <TableCell>
                    <CellEditor
                      mono
                      multiline
                      value={entry.appointedMeeting.join('\n')}
                      onChange={(v) => updateEntry(sIdx, idx, { appointedMeeting: v.split('\n').filter(Boolean) })}
                    />
                  </TableCell>
                  <TableCell>
                    <CellEditor
                      multiline
                      value={entry.ceasedReason.join('\n')}
                      onChange={(v) => updateEntry(sIdx, idx, { ceasedReason: v.split('\n').filter(Boolean) })}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button size="sm" variant="ghost" onClick={() => removeRow(sIdx, idx)}>
                      <X className="h-3 w-3" />
                    </Button>
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

const EditableRomTable = ({
  members,
  onChange,
}: {
  members: MemberEntry[];
  onChange: (next: MemberEntry[]) => void;
}) => {
  const updateMember = (idx: number, patch: Partial<MemberEntry>) => {
    onChange(members.map((m, i) => (i !== idx ? m : { ...m, ...patch })));
  };
  const updateTxn = (mIdx: number, tIdx: number, patch: Partial<ShareTxn>) => {
    onChange(
      members.map((m, i) =>
        i !== mIdx
          ? m
          : { ...m, transactions: m.transactions.map((t, j) => (j !== tIdx ? t : { ...t, ...patch })) }
      )
    );
  };
  const addTxn = (mIdx: number) => {
    onChange(members.map((m, i) => (i !== mIdx ? m : { ...m, transactions: [...m.transactions, {}] })));
  };
  const removeTxn = (mIdx: number, tIdx: number) => {
    onChange(
      members.map((m, i) =>
        i !== mIdx ? m : { ...m, transactions: m.transactions.filter((_, j) => j !== tIdx) }
      )
    );
  };
  const addMember = () => {
    onChange([...members, { name: [''], address: [], transactions: [] }]);
  };
  const removeMember = (mIdx: number) => {
    onChange(members.filter((_, i) => i !== mIdx));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={addMember}>+ 新增成員</Button>
      </div>
      {members.map((m, idx) => (
        <div key={idx} className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-muted/50 font-medium text-sm flex items-center justify-between">
            <span>成員 #{idx + 1}</span>
            <Button size="sm" variant="ghost" onClick={() => removeMember(idx)}>
              <X className="h-3 w-3 mr-1" />刪除成員
            </Button>
          </div>
          <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-12 gap-3 text-sm">
            <div className="md:col-span-4">
              <Label className="text-xs text-muted-foreground mb-1 block">姓名 / Name</Label>
              <CellEditor
                multiline
                value={m.name.join('\n')}
                onChange={(v) => updateMember(idx, { name: v.split('\n') })}
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">HK ID</Label>
              <CellEditor mono value={m.idPassport || ''} onChange={(v) => updateMember(idx, { idPassport: v || undefined })} />
            </div>
            <div className="md:col-span-6">
              <Label className="text-xs text-muted-foreground mb-1 block">地址 / Address</Label>
              <CellEditor
                multiline
                value={m.address.join('\n')}
                onChange={(v) => updateMember(idx, { address: v.split('\n') })}
              />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs text-muted-foreground mb-1 block">出生日期</Label>
              <CellEditor mono value={m.dateOfBirth || ''} onChange={(v) => updateMember(idx, { dateOfBirth: v || undefined })} />
            </div>
            <div className="md:col-span-5">
              <Label className="text-xs text-muted-foreground mb-1 block">護照詳情 / Passport</Label>
              <CellEditor value={m.passportDetails || ''} onChange={(v) => updateMember(idx, { passportDetails: v || undefined })} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">登記日期</Label>
              <CellEditor mono value={m.dateEntered || ''} onChange={(v) => updateMember(idx, { dateEntered: v || undefined })} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">終止日期</Label>
              <CellEditor mono value={m.dateCeased || ''} onChange={(v) => updateMember(idx, { dateCeased: v || undefined })} />
            </div>
            <div className="md:col-span-12">
              <Label className="text-xs text-muted-foreground mb-1 block">證券類別 / Security</Label>
              <CellEditor value={m.security || ''} onChange={(v) => updateMember(idx, { security: v || undefined })} />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead className="min-w-[110px]">日期</TableHead>
                <TableHead className="min-w-[120px]">交易類別</TableHead>
                <TableHead className="text-right min-w-[90px]">股數</TableHead>
                <TableHead className="text-right min-w-[90px]">面值/股</TableHead>
                <TableHead className="text-right min-w-[90px]">已繳/股</TableHead>
                <TableHead className="text-right min-w-[80px]">證書編號</TableHead>
                <TableHead className="min-w-[150px]">對方 / 備註</TableHead>
                <TableHead className="text-right min-w-[90px]">結餘</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {m.transactions.map((t, i) => (
                <TableRow key={i} className="align-top">
                  <TableCell className="text-center text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                  <TableCell><CellEditor mono value={t.date || ''} onChange={(v) => updateTxn(idx, i, { date: v || undefined })} /></TableCell>
                  <TableCell><CellEditor value={t.transactionType || ''} onChange={(v) => updateTxn(idx, i, { transactionType: v || undefined })} /></TableCell>
                  <TableCell><CellEditor mono value={t.units || ''} onChange={(v) => updateTxn(idx, i, { units: v || undefined })} /></TableCell>
                  <TableCell><CellEditor mono value={t.parValue || ''} onChange={(v) => updateTxn(idx, i, { parValue: v || undefined })} /></TableCell>
                  <TableCell><CellEditor mono value={t.paidUpValue || ''} onChange={(v) => updateTxn(idx, i, { paidUpValue: v || undefined })} /></TableCell>
                  <TableCell><CellEditor mono value={t.certificateNo || ''} onChange={(v) => updateTxn(idx, i, { certificateNo: v || undefined })} /></TableCell>
                  <TableCell><CellEditor multiline value={t.notes || ''} onChange={(v) => updateTxn(idx, i, { notes: v || undefined })} /></TableCell>
                  <TableCell><CellEditor mono value={t.balance || ''} onChange={(v) => updateTxn(idx, i, { balance: v || undefined })} /></TableCell>
                  <TableCell className="text-center">
                    <Button size="sm" variant="ghost" onClick={() => removeTxn(idx, i)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={10} className="text-center py-2">
                  <Button size="sm" variant="ghost" onClick={() => addTxn(idx)}>+ 新增交易</Button>
                </TableCell>
              </TableRow>
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
  const [editMode, setEditMode] = useState<'table' | 'html'>('table');
  const [draftHtml, setDraftHtml] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftParsed, setDraftParsed] = useState<ParsedLog | null>(null);
  const [draftPreamble, setDraftPreamble] = useState<string[]>([]);

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
    const parsed = parseLog(openLog.html_content || '');
    setDraftParsed(parsed);
    setDraftPreamble(extractPreamble(openLog.html_content || ''));
    setEditMode(parsed.kind === 'unknown' ? 'html' : 'table');
    setEditing(true);
  };

  const handleSave = async () => {
    if (!openLog) return;
    try {
      let htmlToSave = draftHtml;
      if (editMode === 'table' && draftParsed) {
        if (draftParsed.kind === 'rod') {
          htmlToSave = serializeRod(draftPreamble, draftParsed.sections);
        } else if (draftParsed.kind === 'rom') {
          htmlToSave = serializeRom(draftPreamble, draftParsed.members);
        }
      }
      await updateLog.mutateAsync({
        id: openLog.id,
        html_content: htmlToSave,
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
