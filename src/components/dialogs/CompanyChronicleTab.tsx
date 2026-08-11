import { useMemo, useState, type ReactNode } from 'react';
import { Company } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';
import {
  useShareTransactions, useUpsertShareTransaction, useDeleteShareTransaction,
  type ShareTransaction,
} from '@/hooks/useShareTransactions';
import { useCompanyVersions, useCreateVersionSnapshot, versionFieldLabel, type CompanyVersion } from '@/hooks/useCompanyVersions';
import { useCompanyLogs, useCreateCompanyLog, type CompanyLog } from '@/hooks/useCompanyLogs';
import {
  ArrowUp, ArrowDown, ArrowRight, Plus, Camera, History, FileText,
  Loader2, Pencil, Trash2, Save, X, Filter, Coins, Users, GitBranch,
  UserPlus, UserMinus, TrendingUp, FileOutput, Download,
} from 'lucide-react';
import { QuickFormDialog } from '@/components/forms/QuickFormDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { downloadBase64File, RTF_MIME } from '@/lib/downloadPdf';
import { ShareTransactionForm } from '@/components/forms/ShareTransactionForm';

// ── 日期工具 ──
function fmtDate(s?: string): string {
  if (!s) return '—';
  const t = String(s).trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  return t;
}

function sortableDate(s?: string): number {
  if (!s) return 0;
  const t = String(s).trim();
  let d = '', m = '', y = '';
  if (/^\d{8}$/.test(t)) { d = t.slice(0, 2); m = t.slice(2, 4); y = t.slice(4, 8); }
  else if (/^\d{4}-\d{2}-\d{2}/.test(t)) { y = t.slice(0, 4); m = t.slice(5, 7); d = t.slice(8, 10); }
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) {
    const [dd, mm, yy] = t.split('/'); d = dd.padStart(2, '0'); m = mm.padStart(2, '0'); y = yy;
  } else return 0;
  return parseInt(`${y}${m}${d}`, 10) || 0;
}

function personName(p: any): string {
  const en = (p.nameEnglish || '').trim();
  const cn = (p.nameChinese || '').trim();
  return en && cn ? `${en}（${cn}）` : en || cn || '（無名稱）';
}

// ── 統一事變類型 ──
type EventCategory = 'personnel' | 'share' | 'version' | 'file';

interface ChronicleEvent {
  id: string;
  date: string;
  sortDate: number;
  category: EventCategory;
  type: string;         // appoint | cease | transfer | allotment | repurchase | capital_increase | shareholder_add | shareholder_remove | snapshot | log
  title: string;
  subtitle: string;
  icon: ReactNode;
  dotColor: string;     // tailwind bg class
  raw: any;
}

const CATEGORY_LABELS: Record<EventCategory, string> = {
  personnel: '人事變更',
  share: '股份交易',
  version: '版本快照',
  file: '文件記錄',
};

const TYPE_LABEL: Record<string, string> = {
  appoint: '委任',
  cease: '辭任',
  transfer: '轉讓',
  allotment: '配發',
  repurchase: '購回',
  capital_increase: '增資',
  shareholder_add: '增股東',
  shareholder_remove: '減股東',
  snapshot: '快照',
  log: '文件',
};

const TX_TYPE_LABEL: Record<string, string> = {
  transfer: '轉讓', allotment: '配發', repurchase: '購回', capital_increase: '增資',
};

const DOC_TYPE_LABEL: Record<string, string> = {
  ROD: '董事登記冊', ROM: '成員登記冊', CI_BR: '公司註冊證 / 商業登記',
  NAR1: '周年申報表', ND2A: '委任／停任董事秘書', ND2B: '更改董事秘書詳情',
  ND4: '董事秘書辭任', NSC1: '股份分配申報', NNC1: '法團成立', NNC2: '更改公司名稱',
  MINUTES: '會議紀錄', BOARD_MINUTES: '董事會會議紀錄', SHAREHOLDER_RESOLUTION: '股東決議',
  SHARE_TRANSFER: '股份轉讓', BANKING: '銀行文件', CORRESPONDENCE: '往來函件',
  BIR51: '利得税報税表', AUDIT: '審計報告', AUDIT_REPORT: '審計報告',
  BR_RENEWAL: '商業登記續期', WINDING_UP: '清盤', WINDING_UP_ORDER: '清盤令',
  STATEMENT_OF_AFFAIRS: '財務狀況說明書', STRIKE_OFF: '除名',
  CR_STRIKE_OFF: '公司註冊處除名', CR_DISSOLUTION: '公司解散',
  PERSONNEL_APPOINT: '人事委任', SHARE_TX: '股份交易', VERSION_SNAPSHOT: '版本快照',
  OTHER: '其他',
};

// ── 編輯交易表單 ──
type EditTx = Partial<ShareTransaction>;
const emptyTx = (companyId: string): EditTx => ({
  company_id: companyId, transaction_date: '', transaction_type: 'transfer',
  from_name: '', to_name: '', shares: 0, share_type: 'Ordinary', currency: 'HKD',
  price_per_share: '', total_consideration: '', instrument_number: '', notes: '',
});

// ── 版本對比 ──
function diffSnapshots(a?: CompanyVersion, b?: CompanyVersion) {
  if (!a || !b) return [];
  const [older, newer] = a.version_no < b.version_no ? [a, b] : [b, a];
  const keys = new Set([...Object.keys(older.snapshot), ...Object.keys(newer.snapshot)]);
  const rows: { key: string; before: string; after: string }[] = [];
  keys.forEach((k) => {
    const before = older.snapshot[k] ?? '';
    const after = newer.snapshot[k] ?? '';
    if (String(before) !== String(after)) rows.push({ key: k, before: String(before), after: String(after) });
  });
  return rows;
}

export function CompanyChronicleTab({ company }: { company: Company }) {
  // ── 數據抓取 ──
  const { data: txs = [], isLoading: txsLoading } = useShareTransactions(company.id);
  const { data: versions = [], isLoading: versionsLoading } = useCompanyVersions(company.id);
  const { data: logs = [], isLoading: logsLoading } = useCompanyLogs({ companyId: company.id });

  const upsertTx = useUpsertShareTransaction();
  const delTx = useDeleteShareTransaction();
  const createSnapshot = useCreateVersionSnapshot();
  const createLog = useCreateCompanyLog();

  // ── 狀態 ──
  const [filter, setFilter] = useState<EventCategory | 'all'>('all');
  const [editingTx, setEditingTx] = useState<EditTx | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [quickFormEvent, setQuickFormEvent] = useState<ChronicleEvent | null>(null);
  const [quickFormOpen, setQuickFormOpen] = useState(false);

  const isLoading = txsLoading || versionsLoading || logsLoading;

  // ── 構建統一事變列表 ──
  const allEvents = useMemo(() => {
    const list: ChronicleEvent[] = [];

    // 1. 人事變更（董事 + 秘書）
    const pushPersonnel = (people: any[], role: string) => {
      for (const p of people) {
        if (p.dateAppointed) {
          list.push({
            id: `${p.id}-appoint`,
            date: p.dateAppointed,
            sortDate: sortableDate(p.dateAppointed),
            category: 'personnel' as const,
            type: 'appoint',
            title: personName(p),
            subtitle: `委任為${role}　·　${p.identity === 'corporate' ? '法人' : '自然人'}`,
            icon: <ArrowUp className="h-3 w-3 text-green-600" />,
            dotColor: 'bg-green-500',
            raw: { ...p, role, action: 'appoint' },
          });
        }
        if (p.dateCeased) {
          list.push({
            id: `${p.id}-cease`,
            date: p.dateCeased,
            sortDate: sortableDate(p.dateCeased),
            category: 'personnel' as const,
            type: 'cease',
            title: personName(p),
            subtitle: `辭任${role}　·　${p.identity === 'corporate' ? '法人' : '自然人'}`,
            icon: <ArrowDown className="h-3 w-3 text-destructive" />,
            dotColor: 'bg-destructive',
            raw: { ...p, role, action: 'cease' },
          });
        }
      }
    };
    pushPersonnel(company.directors, '董事');
    pushPersonnel(company.secretaries, '秘書');

    // 1b. 股東變更（增股東 / 減股東）
    for (const sh of company.shareholders || []) {
      if (sh.dateAppointed) {
        list.push({
          id: `${sh.id}-sh-appoint`,
          date: sh.dateAppointed,
          sortDate: sortableDate(sh.dateAppointed),
          category: 'share' as const,
          type: 'shareholder_add',
          title: sh.nameEnglish || sh.nameChinese || sh.name || '（無名稱）',
          subtitle: `成為股東　·　${sh.identity === 'corporate' ? '法人' : '自然人'}${sh.shares ? `　·　${Number(sh.shares).toLocaleString()} 股` : ''}`,
          icon: <UserPlus className="h-3 w-3 text-emerald-600" />,
          dotColor: 'bg-emerald-500',
          raw: { ...sh, action: 'shareholder_add' },
        });
      }
      if (sh.dateCeased) {
        list.push({
          id: `${sh.id}-sh-cease`,
          date: sh.dateCeased,
          sortDate: sortableDate(sh.dateCeased),
          category: 'share' as const,
          type: 'shareholder_remove',
          title: sh.nameEnglish || sh.nameChinese || sh.name || '（無名稱）',
          subtitle: `退出股東　·　${sh.identity === 'corporate' ? '法人' : '自然人'}${sh.shares ? `　·　${Number(sh.shares).toLocaleString()} 股` : ''}`,
          icon: <UserMinus className="h-3 w-3 text-orange-600" />,
          dotColor: 'bg-orange-500',
          raw: { ...sh, action: 'shareholder_remove' },
        });
      }
    }

    // 2. 股份交易（轉讓/配發/購回/增資）
    for (const tx of txs) {
      const isCapIncrease = tx.transaction_type === 'capital_increase';
      list.push({
        id: tx.id,
        date: tx.transaction_date,
        sortDate: sortableDate(tx.transaction_date),
        category: 'share' as const,
        type: tx.transaction_type,
        title: isCapIncrease
          ? `增資 ${(tx.shares || 0).toLocaleString()} 股`
          : `${tx.from_name || '（新發行）'} → ${tx.to_name || '—'}`,
        subtitle: isCapIncrease
          ? `${tx.share_type ? `股份類別：${tx.share_type}` : ''}${tx.price_per_share ? ` · 每股 ${tx.currency || 'HKD'} ${tx.price_per_share}` : ''}${tx.total_consideration ? ` · 總額 ${tx.currency || 'HKD'} ${tx.total_consideration}` : ''}`
          : `${(tx.shares || 0).toLocaleString()} 股${tx.share_type ? ` · ${tx.share_type}` : ''}${tx.price_per_share ? ` · ${tx.currency || 'HKD'} ${tx.price_per_share}/股` : ''}`,
        icon: isCapIncrease
          ? <TrendingUp className="h-3 w-3 text-violet-600" />
          : <ArrowRight className="h-3 w-3 text-blue-600" />,
        dotColor: isCapIncrease ? 'bg-violet-500' : 'bg-blue-500',
        raw: tx,
      });
    }

    // 3. 版本快照
    for (const v of versions) {
      const changedLabels = v.changed_fields.slice(0, 3).map(f => versionFieldLabel(f)).join('、');
      list.push({
        id: v.id,
        date: v.created_at,
        sortDate: sortableDate(v.created_at),
        category: 'version' as const,
        type: 'snapshot',
        title: `v${v.version_no}　${v.change_summary || '更新'}`,
        subtitle: changedLabels ? `變更欄位：${changedLabels}${v.changed_fields.length > 3 ? ` 等${v.changed_fields.length}項` : ''}` : '無欄位變更',
        icon: <Camera className="h-3 w-3 text-purple-600" />,
        dotColor: 'bg-purple-500',
        raw: v,
      });
    }

    // 4. 文件記錄
    for (const log of logs) {
      const docDate = log.doc_date || log.created_at || '';
      list.push({
        id: log.id,
        date: docDate,
        sortDate: sortableDate(docDate),
        category: 'file' as const,
        type: 'log',
        title: DOC_TYPE_LABEL[log.doc_type] || log.doc_type || '文件',
        subtitle: log.original_filename || log.notes || '',
        icon: <FileText className="h-3 w-3 text-amber-600" />,
        dotColor: 'bg-amber-500',
        raw: log,
      });
    }

    // 日期倒序
    list.sort((a, b) => b.sortDate - a.sortDate);
    return list;
  }, [company.directors, company.secretaries, txs, versions, logs]);

  const filteredEvents = useMemo(
    () => filter === 'all' ? allEvents : allEvents.filter(e => e.category === filter),
    [allEvents, filter],
  );

  // ── 篩選計數 ──
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: allEvents.length };
    for (const e of allEvents) c[e.category] = (c[e.category] || 0) + 1;
    return c;
  }, [allEvents]);

  // ── 版本對比 ──
  const [cmpA, cmpB] = useMemo(() => {
    const a = versions.find(v => v.id === compareIds[0]);
    const b = versions.find(v => v.id === compareIds[1]);
    return [a, b];
  }, [versions, compareIds]);

  const diffRows = useMemo(() => diffSnapshots(cmpA, cmpB), [cmpA, cmpB]);

  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  // ── 操作 ──
  const saveTx = () => {
    if (!editingTx) return;
    if (!editingTx.transaction_date) { toast({ title: '請填寫交易日期', variant: 'destructive' }); return; }
    upsertTx.mutate(editingTx, {
      onSuccess: () => {
        toast({ title: '交易記錄已儲存' });
        // 同步寫入公司日誌
        const txTypeLabel = TX_TYPE_LABEL[editingTx.transaction_type || 'transfer'] || editingTx.transaction_type;
        const desc = editingTx.transaction_type === 'capital_increase'
          ? `增資 ${(editingTx.shares || 0).toLocaleString()} 股`
          : `${editingTx.from_name || '（新發行）'} → ${editingTx.to_name || '—'}，${(editingTx.shares || 0).toLocaleString()} 股`;
        createLog.mutate({
          company_id: company.id,
          company_name_hint: company.name,
          doc_type: 'SHARE_TX',
          doc_date: editingTx.transaction_date,
          source_folder: '公司誌',
          notes: `${txTypeLabel}：${desc}${editingTx.notes ? `（備註：${editingTx.notes}）` : ''}`,
          html_content: `<p>股份交易 — ${txTypeLabel}</p><p>${desc}</p><p>日期：${editingTx.transaction_date}</p>${editingTx.notes ? `<p>備註：${editingTx.notes}</p>` : ''}`,
        });
        setEditingTx(null);
      },
      onError: (e: any) => toast({ title: '儲存失敗', description: e.message, variant: 'destructive' }),
    });
  };

  // ── 凭证 RTF 生成 ──
  const genCert = async (tx: ShareTransaction, docType: string) => {
    try {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch('/api/generate-share-transfer-rtf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId: tx.company_id, transactionId: tx.id, documentType: docType }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const result = await resp.json();
      if (result.rtf) {
        const filename = result.filename || `${docType}_${tx.instrument_number || tx.id}.rtf`;
        downloadBase64File(result.rtf, filename, RTF_MIME);
        toast({ title: '憑證已生成', description: 'RTF 已下載' });
        // 同步寫入公司日誌
        const certTypeMap: Record<string, string> = { bought_sold_note: '買賣票據', instrument_of_transfer: '轉讓文書', share_certificate: '股票證書' };
        createLog.mutate({
          company_id: company.id,
          company_name_hint: company.name,
          doc_type: 'SHARE_CERTIFICATE',
          doc_date: new Date().toISOString().slice(0, 10),
          source_folder: '公司誌',
          notes: `已生成${certTypeMap[docType] || docType}：${tx.from_name || '新發行'} → ${tx.to_name || '—'}，${(tx.shares || 0).toLocaleString()} 股`,
          html_content: `<p>已生成${certTypeMap[docType] || docType}</p><p>${tx.from_name || '新發行'} → ${tx.to_name || '—'}，${(tx.shares || 0).toLocaleString()} 股</p>`,
        });
      }
    } catch (e: any) {
      toast({ title: '生成失敗', description: e.message, variant: 'destructive' });
    }
  };

  const handleSnapshot = () => {
    createSnapshot.mutate(company.id, {
      onSuccess: (r) => {
        toast({ title: r.created ? `已建立版本 v${r.version_no}` : '資料無變化', description: r.created ? undefined : '與最新版本相同，未建立新版本' });
        if (r.created) {
          // 同步寫入公司日誌
          createLog.mutate({
            company_id: company.id,
            company_name_hint: company.name,
            doc_type: 'VERSION_SNAPSHOT',
            doc_date: new Date().toISOString().slice(0, 10),
            source_folder: '公司誌',
            notes: `版本 v${r.version_no}：${r.change_summary || '公司資料快照'}`,
            html_content: `<p>版本快照 v${r.version_no}</p><p>${r.change_summary || '公司資料快照'}</p><p>變更欄位：${(r.changed_fields || []).join('、') || '無'}</p>`,
          });
        }
      },
      onError: () => toast({ title: '建立版本失敗', variant: 'destructive' }),
    });
  };

  const filterBadges: { key: EventCategory | 'all'; label: string; icon: ReactNode }[] = [
    { key: 'all', label: '全部', icon: <Filter className="h-3 w-3" /> },
    { key: 'personnel', label: '人事', icon: <Users className="h-3 w-3" /> },
    { key: 'share', label: '股份', icon: <Coins className="h-3 w-3" /> },
    { key: 'version', label: '版本', icon: <GitBranch className="h-3 w-3" /> },
    { key: 'file', label: '文件', icon: <FileText className="h-3 w-3" /> },
  ];

  // ── 渲染 ──
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> 載入公司誌中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── 頂部操作欄 ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterBadges.map(fb => (
            <Button
              key={fb.key}
              variant={filter === fb.key ? 'default' : 'outline'}
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setFilter(fb.key)}
            >
              {fb.icon}
              {fb.label}
              {counts[fb.key] !== undefined && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-0.5">{counts[fb.key]}</Badge>
              )}
            </Button>
          ))}
        </div>

        <div className="flex gap-2">
          {versions.length >= 2 && (
            <Button
              variant={compareMode ? 'default' : 'outline'} size="sm" className="h-7 text-xs"
              onClick={() => { setCompareMode(m => !m); setCompareIds([]); setExpandedVersion(null); }}
            >
              {compareMode ? '退出對比' : '版本對比'}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleSnapshot} disabled={createSnapshot.isPending}>
            {createSnapshot.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Camera className="h-3.5 w-3.5 mr-1" />}
            建立快照
          </Button>
          {!editingTx && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingTx(emptyTx(company.id))}>
              <Plus className="h-3.5 w-3.5 mr-1" /> 新增股份交易
            </Button>
          )}
        </div>
      </div>

      {/* ── 版本對比面板 ── */}
      {compareMode && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs text-muted-foreground mb-2">
            {compareIds.length < 2 ? `從時間線點擊版本卡片以選擇兩個版本進行對比（已選 ${compareIds.length}/2）` : '對比結果如下：'}
          </p>
          {compareIds.length === 2 && cmpA && cmpB && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Badge variant="outline">v{Math.min(cmpA.version_no, cmpB.version_no)}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <Badge variant="default">v{Math.max(cmpA.version_no, cmpB.version_no)}</Badge>
                <span className="text-muted-foreground font-normal text-xs ml-1">共 {diffRows.length} 項變更</span>
              </div>
              {diffRows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2 text-center">兩個版本之間沒有欄位差異</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {diffRows.map(r => (
                    <div key={r.key} className="rounded border border-border bg-muted/20 p-2 text-xs">
                      <div className="font-medium mb-0.5">{versionFieldLabel(r.key)}</div>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 rounded bg-destructive/10 text-destructive px-2 py-0.5 line-through break-words">{r.before || '（空）'}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="flex-1 rounded bg-green-500/10 text-green-700 px-2 py-0.5 break-words">{r.after || '（空）'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 新增/編輯交易表單 ── */}
      {editingTx && (
        <ShareTransactionForm
          tx={editingTx}
          onChange={setEditingTx}
          onSave={saveTx}
          onCancel={() => setEditingTx(null)}
          saving={upsertTx.isPending}
        />
      )}

      <Separator />

      {/* ── 時間線 ── */}
      {filteredEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <History className="h-8 w-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">尚無{filter === 'all' ? '' : CATEGORY_LABELS[filter]}記錄</p>
          <p className="text-xs text-muted-foreground/70 mt-1">公司的人事變更、股份交易、版本快照與文件記錄將統一顯示於此</p>
        </div>
      ) : (
        <div className="relative pl-6">
          {/* 縱向連線 */}
          <div className="absolute left-[9px] top-1 bottom-1 w-px bg-border" aria-hidden />

          <div className="space-y-2">
            {filteredEvents.map(event => {
              const isVersion = event.category === 'version';
              const isShare = event.category === 'share';
              const isShareTx = isShare && event.type !== 'shareholder_add' && event.type !== 'shareholder_remove';
              const isVersionSelected = isVersion && compareMode && compareIds.includes(event.id);
              const isVersionExpanded = isVersion && expandedVersion === event.id;

              return (
                <div key={event.id} className="relative">
                  {/* 時間線節點 */}
                  <span className={`absolute -left-6 top-2 flex h-[18px] w-[18px] items-center justify-center rounded-full ring-2 ring-background ${event.dotColor}/15`}>
                    {event.icon}
                  </span>

                  {/* 事變卡片 */}
                  <div
                    className={`rounded-md border p-3 text-sm transition-colors ${
                      isVersionSelected
                        ? 'border-primary bg-primary/10'
                        : isVersion && compareMode
                          ? 'border-border bg-muted/30 hover:bg-muted/60 cursor-pointer'
                          : 'border-border bg-muted/30'
                    }`}
                    onClick={isVersion && compareMode ? () => toggleCompare(event.id) : undefined}
                    role={isVersion && compareMode ? 'button' : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge
                          variant={event.category === 'personnel' ? (event.type === 'appoint' ? 'default' : 'destructive') : 'outline'}
                          className={`text-xs shrink-0 ${event.category === 'personnel' && event.type === 'appoint' ? 'bg-green-600 hover:bg-green-600' : ''}`}
                        >
                          {CATEGORY_LABELS[event.category]}
                        </Badge>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {event.category === 'personnel'
                            ? (event.type === 'appoint' ? '委任' : '辭任')
                            : event.category === 'share' && (event.type === 'shareholder_add' || event.type === 'shareholder_remove')
                              ? TYPE_LABEL[event.type]
                              : event.category === 'share'
                                ? TX_TYPE_LABEL[event.type] || event.type
                                : event.category === 'version'
                                  ? `v${event.raw.version_no}`
                                  : DOC_TYPE_LABEL[event.raw.doc_type] || event.raw.doc_type || '文件'
                          }
                        </Badge>
                        <span className="font-medium truncate">{event.title}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs font-mono text-muted-foreground">{fmtDate(event.date)}</span>
                        {compareMode && isVersion && (
                          <span className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] shrink-0 ${
                            isVersionSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'
                          }`}>
                            {isVersionSelected && '✓'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 副標題 */}
                    {event.subtitle && (
                      <div className="text-xs text-muted-foreground mt-1">{event.subtitle}</div>
                    )}

                    {/* 附加信息 */}
                    {isShareTx && event.raw.notes && (
                      <div className="text-xs text-muted-foreground mt-1">備註：{event.raw.notes}</div>
                    )}
                    {isShareTx && event.raw.instrument_number && (
                      <div className="text-xs text-muted-foreground mt-1">文件編號：{event.raw.instrument_number}</div>
                    )}
                    {isShareTx && event.raw.total_consideration && (
                      <div className="text-xs text-muted-foreground mt-1">
                        總代價：{event.raw.currency || 'HKD'} {event.raw.total_consideration}
                      </div>
                    )}

                    {/* 版本：展開詳情 */}
                    {isVersion && isVersionExpanded && !compareMode && (
                      <div className="mt-2 rounded border border-border bg-background p-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          {Object.entries(event.raw.snapshot as Record<string, string>).map(([k, val]) => (
                            <div key={k}>
                              <span className="text-muted-foreground text-xs">{versionFieldLabel(k)}</span>
                              <p className={`font-medium mt-0.5 break-words text-xs ${(event.raw.changed_fields as string[]).includes(k) ? 'text-primary' : ''}`}>
                                {val || '—'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 版本：變更欄位標籤 */}
                    {isVersion && event.raw.changed_fields?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {event.raw.changed_fields.map((f: string) => (
                          <Badge key={f} variant="outline" className="text-[10px] py-0">{versionFieldLabel(f)}</Badge>
                        ))}
                      </div>
                    )}

                    {/* 文件：檔案名 & 備註 */}
                    {event.category === 'file' && event.raw.original_filename && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="truncate">{event.raw.original_filename}</span>
                      </div>
                    )}
                    {event.category === 'file' && event.raw.notes && !event.raw.original_filename && (
                      <div className="text-xs text-muted-foreground mt-1">{event.raw.notes}</div>
                    )}

                    {/* 操作按鈕 */}
                    <div className="flex gap-1 mt-2 pt-2 border-t border-border/50">
                      {/* 生成表單按鈕 (Phase 3.3) — for personnel & share events */}
                      {(event.type === 'appoint' || event.type === 'cease' ||
                        event.type === 'transfer' || event.type === 'allotment' ||
                        event.type === 'shareholder_add' || event.type === 'shareholder_remove') && (
                        <Button variant="outline" size="sm" className="h-6 px-1.5 text-xs"
                          onClick={e => {
                            e.stopPropagation();
                            setQuickFormEvent(event);
                            setQuickFormOpen(true);
                          }}>
                          <FileOutput className="h-3 w-3 mr-1" /> 生成表格
                        </Button>
                      )}
                      {isShareTx && (
                        <>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs"
                                onClick={e => e.stopPropagation()}>
                                <FileText className="h-3 w-3 mr-0.5" /> 憑證
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="min-w-[180px]">
                              <DropdownMenuItem onClick={e => { e.stopPropagation(); genCert(event.raw as ShareTransaction, 'bought_sold_note'); }}>
                                <Download className="h-3.5 w-3.5 mr-2" /> 買賣票據
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={e => { e.stopPropagation(); genCert(event.raw as ShareTransaction, 'instrument_of_transfer'); }}>
                                <Download className="h-3.5 w-3.5 mr-2" /> 轉讓文書
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={e => { e.stopPropagation(); genCert(event.raw as ShareTransaction, 'share_certificate'); }}>
                                <Download className="h-3.5 w-3.5 mr-2" /> 股票證書
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs"
                            onClick={e => { e.stopPropagation(); setEditingTx(event.raw as ShareTransaction); }}>
                            <Pencil className="h-3 w-3 mr-1" /> 編輯
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-destructive"
                            onClick={e => {
                              e.stopPropagation();
                              if (confirm('確定刪除此交易記錄？')) {
                                const txRaw = event.raw;
                                const delDesc = txRaw.transaction_type === 'capital_increase'
                                  ? `增資 ${(txRaw.shares || 0).toLocaleString()} 股`
                                  : `${txRaw.from_name || '（新發行）'} → ${txRaw.to_name || '—'}，${(txRaw.shares || 0).toLocaleString()} 股`;
                                delTx.mutate({ id: event.id, companyId: company.id }, {
                                  onSuccess: () => {
                                    createLog.mutate({
                                      company_id: company.id,
                                      company_name_hint: company.name,
                                      doc_type: 'SHARE_TX',
                                      doc_date: new Date().toISOString().slice(0, 10),
                                      source_folder: '公司誌',
                                      notes: `已刪除股份交易：${delDesc}`,
                                      html_content: `<p>已刪除股份交易</p><p>${delDesc}</p><p>原交易日期：${txRaw.transaction_date || '—'}</p>`,
                                    });
                                  },
                                });
                              }
                            }}>
                            <Trash2 className="h-3 w-3 mr-1" /> 刪除
                          </Button>
                        </>
                      )}
                      {isVersion && !compareMode && (
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs"
                          onClick={e => {
                            e.stopPropagation();
                            setExpandedVersion(isVersionExpanded ? null : event.id);
                          }}>
                          {isVersionExpanded ? '收起詳情' : '查看快照'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Form Dialog (Phase 3.3) */}
      <QuickFormDialog
        open={quickFormOpen}
        onOpenChange={setQuickFormOpen}
        company={company}
        event={quickFormEvent}
      />
    </div>
  );
}
