import { useMemo, useState } from 'react';
import { Company } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { StatCard } from '@/components/ui/stat-card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useUpdateShareholder } from '@/hooks/useCompanies';
import {
  useShareTransactions, useUpsertShareTransaction, useDeleteShareTransaction,
  type ShareTransaction,
} from '@/hooks/useShareTransactions';
import { Coins, ArrowRight, Plus, Pencil, Trash2, Save, X, Briefcase, FileText, Download } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { downloadBase64File, DOCX_MIME, RTF_MIME } from '@/lib/downloadPdf';
import { ShareTransactionForm } from '@/components/forms/ShareTransactionForm';
import { TabChangeEventsFooter } from '@/components/forms/TabChangeEventsFooter';
import { ShareholderEditForm, shFormFromSh, type ShFormType } from '@/components/dialogs/ShareholderEditForm';

type EditTx = Partial<ShareTransaction>;
const emptyTx = (companyId: string): EditTx => ({
  company_id: companyId, transaction_date: '', transaction_type: 'transfer',
  from_name: '', to_name: '', shares: 0, share_type: 'Ordinary', currency: 'HKD',
  price_per_share: '', total_consideration: '', instrument_number: '', notes: '',
});

const TX_TYPE_LABEL: Record<string, string> = {
  transfer: '轉讓', allotment: '配發', repurchase: '購回', capital_increase: '增資',
};
const num = (v: any) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;


export const ShareCapitalTab = ({ company }: { company: Company }) => {
  // 僅統計當前股東（排除已退出者，避免污染當前股本合計）；已退出股東見「股東」標籤的歷史記錄
  const shareholders = (company.shareholders || []).filter(sh => !(sh.dateCeased && sh.dateCeased.trim()));
  const updateShareholder = useUpdateShareholder();

  const { data: txs = [], isLoading: txsLoading } = useShareTransactions(company.id);
  const upsertTx = useUpsertShareTransaction();
  const delTx = useDeleteShareTransaction();
  const [editingTx, setEditingTx] = useState<EditTx | null>(null);
  const [editingShId, setEditingShId] = useState<string | null>(null);


  const summary = useMemo(() => {
    const totalShares = shareholders.reduce((s, x) => s + (Number(x.shares) || 0), 0);
    const classes = Array.from(new Set(shareholders.map(x => x.shareType).filter(Boolean)));
    const currencies = Array.from(new Set(shareholders.map(x => x.currency || 'HKD').filter(Boolean)));
    const paidTotal = shareholders.reduce((s, x) => s + num(x.paidUp), 0);
    const unpaidTotal = shareholders.reduce((s, x) => s + num(x.unpaid), 0);
    return {
      count: shareholders.length,
      totalShares,
      classesLabel: classes.length ? classes.join('、') : '—',
      classesCount: classes.length,
      currency: currencies.length === 1 ? currencies[0] : (currencies.length ? currencies.join('/') : 'HKD'),
      paidTotal, unpaidTotal,
    };
  }, [shareholders]);


  const saveSh = (shId: string, data: ShFormType) => {
    updateShareholder.mutate(
      {
        id: shId,
        data: {
          shares: Number(data.shares) || 0,
          share_type: data.shareType,
          currency: data.currency,
          issue_price: data.issuePrice,
          paid_up: data.paidUp,
          unpaid: data.unpaid,
        },
      },
      {
        onSuccess: () => { toast({ title: '股份資料已更新' }); setEditingShId(null); },
        onError: (e: any) => toast({ title: '更新失敗', description: e.message, variant: 'destructive' }),
      },
    );
  };

  const saveTx = () => {
    if (!editingTx) return;
    if (!editingTx.transaction_date) { toast({ title: '請填寫交易日期', variant: 'destructive' }); return; }
    upsertTx.mutate(editingTx, {
      onSuccess: () => { toast({ title: '交易記錄已儲存' }); setEditingTx(null); },
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
      }
    } catch (e: any) {
      toast({ title: '生成失敗', description: e.message, variant: 'destructive' });
    }
  };

  // ── 轉讓決議書 DOCX 生成 ──
  const genTransferResolutions = async (txId?: string) => {
    try {
      const token = localStorage.getItem('secretary_jwt') || '';
      const resp = await fetch('/api/generate-transfer-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId: company.id, transactionId: txId || undefined }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const result = await resp.json();
      if (result.docx) {
        downloadBase64File(result.docx, result.filename || `TransferResolutions_${company.company_number}.docx`, DOCX_MIME);
        toast({ title: '轉讓決議書已生成', description: 'DOCX 已下載' });
      }
    } catch (e: any) {
      toast({ title: '生成失敗', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-5">
      {/* ── 股本結構總覽 (CO-06) ── */}
      <div>
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary" /> 股本結構總覽
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="股東人數" value={summary.count} />
          <StatCard label="已發行股份總數" value={summary.totalShares.toLocaleString()} />
          <StatCard label="股份類別" value={summary.classesCount || '—'} />
          <StatCard label="計價貨幣" value={summary.currency} />
          <StatCard label="已繳或視作已繳的總款額" value={`${summary.currency} ${summary.paidTotal.toLocaleString()}`} valueClassName="text-green-700 text-xl" />
          <StatCard label="未繳股本" value={`${summary.currency} ${summary.unpaidTotal.toLocaleString()}`} valueClassName={summary.unpaidTotal ? 'text-orange-700 text-xl' : 'text-xl'} />
          <StatCard label="股份類別明細" value={summary.classesLabel} valueClassName="text-sm font-normal" className="col-span-2" />
        </div>
      </div>

      <Separator />

      {/* ── 持股明細 (可編輯股份) (CO-07) ── */}
      <div>
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-primary" /> 持股明細
          <Badge variant="secondary" className="text-xs">{shareholders.length}</Badge>
        </h3>
        {shareholders.length === 0 ? (
          <p className="text-muted-foreground text-sm">尚無股東持股記錄。請至「股東」標籤新增股東。</p>
        ) : (
          <div className="space-y-2">
            {shareholders.map(sh => (
              <div key={sh.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium">
                    {sh.nameEnglish || sh.nameChinese || sh.name || '(未命名)'}
                    {sh.nameEnglish && sh.nameChinese && <span className="ml-2 text-xs text-muted-foreground">{sh.nameChinese}</span>}
                    {sh.identity === 'corporate' && <Badge variant="outline" className="text-xs ml-2">法人</Badge>}
                  </div>
                  {editingShId !== sh.id && (
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditingShId(sh.id)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> 編輯股份
                    </Button>
                  )}
                </div>

                {editingShId === sh.id ? (
                  <ShareholderEditForm mode="financial" initialData={shFormFromSh(sh)} companyId={company.id}
                    onSave={(data) => { saveSh(sh.id, data); setEditingShId(null); }}
                    onCancel={() => setEditingShId(null)}
                    saving={updateShareholder.isPending} />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="default" className="text-xs">{(sh.shares || 0).toLocaleString()} 股</Badge>
                    {sh.shareType && <Badge variant="outline" className="text-xs">{sh.shareType}</Badge>}
                    <Badge variant="outline" className="text-xs">每股: {sh.currency || 'HKD'} {sh.issuePrice || '0'}</Badge>
                    <Badge variant="outline" className="text-xs text-green-700 border-green-300">已繳: {sh.currency || 'HKD'} {sh.paidUp || '0'}</Badge>
                    <Badge variant="outline" className="text-xs text-orange-700 border-orange-300">未繳: {sh.currency || 'HKD'} {sh.unpaid || '0'}</Badge>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* ── 股份交易記錄 (CO-08) ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" /> 股份交易記錄
            <Badge variant="secondary" className="text-xs">{txs.length}</Badge>
          </h3>
          {!editingTx && (
            <Button variant="ghost" size="sm" onClick={() => setEditingTx(emptyTx(company.id))}>
              <Plus className="h-3.5 w-3.5 mr-1" /> 新增交易
            </Button>
          )}
        </div>

        {editingTx && (
          <div className="mb-3">
            <ShareTransactionForm
              tx={editingTx}
              onChange={setEditingTx}
              onSave={saveTx}
              onCancel={() => setEditingTx(null)}
              saving={upsertTx.isPending}
              companyId={company.id}
              shareholders={shareholders}
            />
          </div>
        )}

        {txsLoading ? (
          <p className="text-muted-foreground text-sm">載入中…</p>
        ) : txs.length === 0 ? (
          <p className="text-muted-foreground text-sm">尚無股份交易記錄</p>
        ) : (
          <div className="space-y-2">
            {txs.map(tx => (
              <div key={tx.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{TX_TYPE_LABEL[tx.transaction_type] || tx.transaction_type}</Badge>
                    <span className="text-xs text-muted-foreground">{tx.transaction_date}</span>
                  </div>
                  <div className="flex gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs">
                          <FileText className="h-3.5 w-3.5 mr-0.5" /> 憑證
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[180px]">
                        <DropdownMenuItem onClick={() => genCert(tx, 'bought_sold_note')}>
                          <Download className="h-3.5 w-3.5 mr-2" /> 買賣票據
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => genCert(tx, 'instrument_of_transfer')}>
                          <Download className="h-3.5 w-3.5 mr-2" /> 轉讓文書
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => genCert(tx, 'share_certificate')}>
                          <Download className="h-3.5 w-3.5 mr-2" /> 股票證書
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setEditingTx(tx)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive"
                      onClick={() => { if (confirm('確定刪除此交易記錄？')) delTx.mutate({ id: tx.id, companyId: company.id }); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <span>{tx.from_name || '（新發行）'}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{tx.to_name || '—'}</span>
                  <Badge variant="default" className="text-xs ml-1">{(tx.shares || 0).toLocaleString()} 股</Badge>
                  {tx.share_type && <Badge variant="outline" className="text-xs">{tx.share_type}</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {tx.price_per_share && <span className="mr-3">每股 {tx.currency || 'HKD'} {tx.price_per_share}</span>}
                  {tx.total_consideration && <span className="mr-3">總代價 {tx.currency || 'HKD'} {tx.total_consideration}</span>}
                  {tx.instrument_number && <span className="mr-3">文件 {tx.instrument_number}</span>}
                </div>
                {tx.notes && <div className="mt-1 text-xs text-muted-foreground">{tx.notes}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ── 已签发凭证 (CO-09) ── */}
        {txs.filter(t => t.instrument_number).length > 0 && (
          <>
            <Separator className="mt-4" />
            <div className="mt-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-primary" /> 已簽發憑證
                <Badge variant="secondary" className="text-xs">{txs.filter(t => t.instrument_number).length}</Badge>
              </h3>
              <div className="space-y-1.5">
                {txs.filter(t => t.instrument_number).map(tx => (
                  <div key={tx.id} className="rounded-md border border-border bg-muted/20 p-2 text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs font-mono">{tx.instrument_number}</Badge>
                      <span className="text-xs text-muted-foreground">{tx.transaction_date}</span>
                      <span className="text-xs">{tx.to_name || '—'}</span>
                      <Badge variant="default" className="text-xs">{(tx.shares || 0).toLocaleString()} 股</Badge>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs">
                          <Download className="h-3.5 w-3.5 mr-0.5" /> 下載
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[180px]">
                        <DropdownMenuItem onClick={() => genCert(tx, 'bought_sold_note')}>
                          <Download className="h-3.5 w-3.5 mr-2" /> 買賣票據
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => genCert(tx, 'instrument_of_transfer')}>
                          <Download className="h-3.5 w-3.5 mr-2" /> 轉讓文書
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => genCert(tx, 'share_certificate')}>
                          <Download className="h-3.5 w-3.5 mr-2" /> 股票證書
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── 轉讓決議書 (CO-10) ── */}
        <Separator className="mt-4" />
        <div className="mt-4">
          <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-primary" /> 轉讓決議書
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            生成 Sole Director 書面決議書（轉讓股份），自動填入公司資料及最近一筆交易記錄。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => genTransferResolutions()}>
              <Download className="h-3.5 w-3.5 mr-1" /> 生成決議書 (最新交易)
            </Button>
            {txs.filter(t => t.transaction_type === 'transfer').map(tx => (
              <Button key={tx.id} variant="ghost" size="sm"
                onClick={() => genTransferResolutions(tx.id)}>
                <FileText className="h-3.5 w-3.5 mr-1" />
                {tx.transaction_date} — {tx.to_name || '?'} ({tx.shares?.toLocaleString()}股)
              </Button>
            ))}
          </div>
        </div>
      </div>

      <TabChangeEventsFooter
        companyId={company.id}
        company={company}
        eventTypes={['share_transfer', 'share_allotment']}
        label="股份交易記錄"
      />
    </div>
  );
};
