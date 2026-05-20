import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Edit, Trash2, Save, X, Download, Loader2, FileText, ArrowRight } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Company } from '@/types';
import {
  useShareTransactions, useUpsertShareTransaction, useDeleteShareTransaction,
  type ShareTransaction,
} from '@/hooks/useShareTransactions';

type EditTx = Partial<ShareTransaction>;

const empty = (companyId: string): EditTx => ({
  company_id: companyId,
  transaction_date: '',
  transaction_type: 'transfer',
  from_name: '',
  to_name: '',
  shares: 0,
  share_type: '',
  currency: 'HKD',
  price_per_share: '',
  total_consideration: '',
  instrument_number: '',
  notes: '',
});

async function downloadRegister(fnName: string, companyId: string, brNumber: string, companyName: string, label: string) {
  try {
    const token = localStorage.getItem("secretary_jwt") || "";
    const url = `/api/${fnName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ companyId }),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${label}_${brNumber || ''}_${companyName}.pdf`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.open(blobUrl, '_blank');
  } catch (e: any) {
    toast({ title: 'PDF 生成失敗', description: e.message, variant: 'destructive' });
  }
}

export function RegistersTab({ company }: { company: Company }) {
  const { data: txs = [], isLoading } = useShareTransactions(company.id);
  const upsert = useUpsertShareTransaction();
  const del = useDeleteShareTransaction();
  const [editing, setEditing] = useState<EditTx | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (fn: string, label: string) => {
    setDownloading(fn);
    try {
      await downloadRegister(fn, company.id, company.brNumber, company.name, label);
    } finally {
      setDownloading(null);
    }
  };

  const handleSave = () => {
    if (!editing) return;
    if (!editing.transaction_date) {
      toast({ title: '請填寫交易日期', variant: 'destructive' });
      return;
    }
    upsert.mutate(editing, {
      onSuccess: () => { toast({ title: '已儲存' }); setEditing(null); },
      onError: (e: any) => toast({ title: '儲存失敗', description: e.message, variant: 'destructive' }),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" /> 法定登記冊 PDF 匯出
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm"
            onClick={() => handleDownload('generate-directors-register-pdf', 'DirectorsRegister')}
            disabled={downloading !== null}>
            {downloading === 'generate-directors-register-pdf'
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1" />}
            董事登記冊
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => handleDownload('generate-shareholders-register-pdf', 'MembersRegister')}
            disabled={downloading !== null}>
            {downloading === 'generate-shareholders-register-pdf'
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1" />}
            股東登記冊
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => handleDownload('generate-scr-pdf', 'SCR')}
            disabled={downloading !== null}>
            {downloading === 'generate-scr-pdf'
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1" />}
            重要控制人
          </Button>
        </div>
      </div>

      <Separator />

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" /> 股份轉讓記錄
            <Badge variant="secondary" className="text-xs">{txs.length}</Badge>
          </h3>
          <Button variant="ghost" size="sm" onClick={() => setEditing(empty(company.id))}>
            <Plus className="h-3.5 w-3.5 mr-1" /> 新增轉讓
          </Button>
        </div>

        {editing && (
          <div className="rounded-md border border-primary/50 bg-primary/5 p-3 mb-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">交易日期</Label>
                <Input type="date" value={editing.transaction_date || ''}
                  onChange={e => setEditing({ ...editing, transaction_date: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">交易類型</Label>
                <Select value={editing.transaction_type || 'transfer'}
                  onValueChange={v => setEditing({ ...editing, transaction_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transfer">轉讓 Transfer</SelectItem>
                    <SelectItem value="allotment">配發 Allotment</SelectItem>
                    <SelectItem value="repurchase">購回 Repurchase</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">轉讓人 From</Label>
                <Input value={editing.from_name || ''}
                  onChange={e => setEditing({ ...editing, from_name: e.target.value })}
                  placeholder="若為新發行可留空" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">受讓人 To</Label>
                <Input value={editing.to_name || ''}
                  onChange={e => setEditing({ ...editing, to_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">股數</Label>
                <Input type="number" value={editing.shares ?? 0}
                  onChange={e => setEditing({ ...editing, shares: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">股份類別</Label>
                <Input value={editing.share_type || ''}
                  onChange={e => setEditing({ ...editing, share_type: e.target.value })} placeholder="Ordinary" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">幣別</Label>
                <Input value={editing.currency || 'HKD'}
                  onChange={e => setEditing({ ...editing, currency: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">每股價格</Label>
                <Input value={editing.price_per_share || ''}
                  onChange={e => setEditing({ ...editing, price_per_share: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">總代價 Consideration</Label>
                <Input value={editing.total_consideration || ''}
                  onChange={e => setEditing({ ...editing, total_consideration: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">文件編號 Instrument</Label>
                <Input value={editing.instrument_number || ''}
                  onChange={e => setEditing({ ...editing, instrument_number: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">備註 Notes</Label>
                <Textarea rows={2} value={editing.notes || ''}
                  onChange={e => setEditing({ ...editing, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                <X className="h-3.5 w-3.5 mr-1" /> 取消
              </Button>
              <Button size="sm" onClick={handleSave} disabled={upsert.isPending}
                className="bg-primary text-primary-foreground">
                {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                儲存
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-muted-foreground text-sm">載入中...</p>
        ) : txs.length === 0 && !editing ? (
          <p className="text-muted-foreground text-sm">尚無股份轉讓記錄</p>
        ) : (
          <div className="grid gap-2">
            {txs.map(t => (
              <div key={t.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.transaction_date}</span>
                    <Badge variant="outline" className="text-xs">{t.transaction_type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {t.from_name || '(新發行)'} → {t.to_name || '(未指定)'}
                    </span>
                  </div>
                  <div className="hidden group-hover:flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-1.5"
                      onClick={() => setEditing(t)}>
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive"
                      onClick={() => del.mutate({ id: t.id, companyId: company.id })}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div>股數: {t.shares}</div>
                  <div>類別: {t.share_type || '-'}</div>
                  <div>每股: {t.currency} {t.price_per_share || '-'}</div>
                  <div>總代價: {t.total_consideration || '-'}</div>
                  <div>文件: {t.instrument_number || '-'}</div>
                  {t.notes && <div className="col-span-3">備註: {t.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
