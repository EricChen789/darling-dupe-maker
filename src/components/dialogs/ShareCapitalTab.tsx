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
import { Coins, ArrowRight, Plus, Pencil, Trash2, Save, X, Briefcase } from 'lucide-react';

type EditTx = Partial<ShareTransaction>;
const emptyTx = (companyId: string): EditTx => ({
  company_id: companyId, transaction_date: '', transaction_type: 'transfer',
  from_name: '', to_name: '', shares: 0, share_type: 'Ordinary', currency: 'HKD',
  price_per_share: '', total_consideration: '', instrument_number: '', notes: '',
});

const TX_TYPE_LABEL: Record<string, string> = {
  transfer: '轉讓', allotment: '配發', repurchase: '購回',
};
const num = (v: any) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;

interface ShEdit {
  shares: number; shareType: string; currency: string;
  issuePrice: string; paidUp: string; unpaid: string;
}

export const ShareCapitalTab = ({ company }: { company: Company }) => {
  // 僅統計當前股東（排除已退出者，避免污染當前股本合計）；已退出股東見「股東」標籤的歷史記錄
  const shareholders = (company.shareholders || []).filter(sh => !(sh.dateCeased && sh.dateCeased.trim()));
  const updateShareholder = useUpdateShareholder();

  const { data: txs = [], isLoading: txsLoading } = useShareTransactions(company.id);
  const upsertTx = useUpsertShareTransaction();
  const delTx = useDeleteShareTransaction();
  const [editingTx, setEditingTx] = useState<EditTx | null>(null);

  const [editingShId, setEditingShId] = useState<string | null>(null);
  const [shEdit, setShEdit] = useState<ShEdit | null>(null);

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

  const startEditSh = (shId: string) => {
    const sh = shareholders.find(s => s.id === shId);
    if (!sh) return;
    setEditingShId(shId);
    setShEdit({
      shares: sh.shares || 0, shareType: sh.shareType || '', currency: sh.currency || 'HKD',
      issuePrice: sh.issuePrice || '', paidUp: sh.paidUp || '', unpaid: sh.unpaid || '',
    });
  };

  const saveSh = (shId: string) => {
    if (!shEdit) return;
    updateShareholder.mutate(
      {
        id: shId,
        data: {
          shares: Number(shEdit.shares) || 0,
          share_type: shEdit.shareType,
          currency: shEdit.currency,
          issue_price: shEdit.issuePrice,
          paid_up: shEdit.paidUp,
          unpaid: shEdit.unpaid,
        },
      },
      {
        onSuccess: () => { toast({ title: '股份資料已更新' }); setEditingShId(null); setShEdit(null); },
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
          <StatCard label="已繳股本" value={`${summary.currency} ${summary.paidTotal.toLocaleString()}`} valueClassName="text-green-700 text-xl" />
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
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => startEditSh(sh.id)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> 編輯股份
                    </Button>
                  )}
                </div>

                {editingShId === sh.id && shEdit ? (
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                    <div className="space-y-1"><Label className="text-xs">持股數量</Label>
                      <Input type="number" value={shEdit.shares}
                        onChange={e => setShEdit({ ...shEdit, shares: Number(e.target.value) || 0 })} /></div>
                    <div className="space-y-1"><Label className="text-xs">股份類別</Label>
                      <Input value={shEdit.shareType} placeholder="Ordinary"
                        onChange={e => setShEdit({ ...shEdit, shareType: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">貨幣</Label>
                      <Input value={shEdit.currency}
                        onChange={e => setShEdit({ ...shEdit, currency: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">每股發行價</Label>
                      <Input value={shEdit.issuePrice}
                        onChange={e => setShEdit({ ...shEdit, issuePrice: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">已繳股本</Label>
                      <Input value={shEdit.paidUp}
                        onChange={e => setShEdit({ ...shEdit, paidUp: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">未繳股本</Label>
                      <Input value={shEdit.unpaid}
                        onChange={e => setShEdit({ ...shEdit, unpaid: e.target.value })} /></div>
                    <div className="col-span-2 md:col-span-3 flex gap-2 justify-end mt-1">
                      <Button variant="ghost" size="sm" onClick={() => { setEditingShId(null); setShEdit(null); }}>
                        <X className="h-3.5 w-3.5 mr-1" /> 取消
                      </Button>
                      <Button size="sm" onClick={() => saveSh(sh.id)} disabled={updateShareholder.isPending}>
                        <Save className="h-3.5 w-3.5 mr-1" /> 儲存
                      </Button>
                    </div>
                  </div>
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
          <div className="rounded-md border border-primary/50 bg-primary/5 p-3 mb-3 grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs">交易日期</Label>
              <Input type="date" value={editingTx.transaction_date || ''}
                onChange={e => setEditingTx({ ...editingTx, transaction_date: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">交易類型</Label>
              <Select value={editingTx.transaction_type || 'transfer'}
                onValueChange={v => setEditingTx({ ...editingTx, transaction_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transfer">轉讓 Transfer</SelectItem>
                  <SelectItem value="allotment">配發 Allotment</SelectItem>
                  <SelectItem value="repurchase">購回 Repurchase</SelectItem>
                </SelectContent>
              </Select></div>
            <div className="space-y-1"><Label className="text-xs">轉讓人 From</Label>
              <Input value={editingTx.from_name || ''} placeholder="若為新發行可留空"
                onChange={e => setEditingTx({ ...editingTx, from_name: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">受讓人 To</Label>
              <Input value={editingTx.to_name || ''}
                onChange={e => setEditingTx({ ...editingTx, to_name: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">股數</Label>
              <Input type="number" value={editingTx.shares ?? 0}
                onChange={e => setEditingTx({ ...editingTx, shares: Number(e.target.value) || 0 })} /></div>
            <div className="space-y-1"><Label className="text-xs">股份類別</Label>
              <Input value={editingTx.share_type || ''} placeholder="Ordinary"
                onChange={e => setEditingTx({ ...editingTx, share_type: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">每股價格</Label>
              <Input value={editingTx.price_per_share || ''}
                onChange={e => setEditingTx({ ...editingTx, price_per_share: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">總代價</Label>
              <Input value={editingTx.total_consideration || ''}
                onChange={e => setEditingTx({ ...editingTx, total_consideration: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">文件編號</Label>
              <Input value={editingTx.instrument_number || ''}
                onChange={e => setEditingTx({ ...editingTx, instrument_number: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">貨幣</Label>
              <Input value={editingTx.currency || 'HKD'}
                onChange={e => setEditingTx({ ...editingTx, currency: e.target.value })} /></div>
            <div className="col-span-2 space-y-1"><Label className="text-xs">備註</Label>
              <Textarea rows={2} value={editingTx.notes || ''}
                onChange={e => setEditingTx({ ...editingTx, notes: e.target.value })} /></div>
            <div className="col-span-2 flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setEditingTx(null)}>
                <X className="h-3.5 w-3.5 mr-1" /> 取消
              </Button>
              <Button size="sm" onClick={saveTx} disabled={upsertTx.isPending}>
                <Save className="h-3.5 w-3.5 mr-1" /> 儲存
              </Button>
            </div>
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
                    <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setEditingTx(tx)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive"
                      onClick={() => { if (confirm('確定刪除此交易記錄？')) delTx.mutate(tx.id); }}>
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
      </div>
    </div>
  );
};
