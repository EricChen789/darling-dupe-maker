import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, X } from 'lucide-react';
import type { ShareTransaction } from '@/hooks/useShareTransactions';

interface ShareTransactionFormProps {
  tx: Partial<ShareTransaction>;
  onChange: (tx: Partial<ShareTransaction>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}

export function ShareTransactionForm({ tx, onChange, onSave, onCancel, saving }: ShareTransactionFormProps) {
  return (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 grid grid-cols-2 gap-2">
      <div className="space-y-1"><Label className="text-xs">交易日期</Label>
        <Input type="date" value={tx.transaction_date || ''}
          onChange={e => onChange({ ...tx, transaction_date: e.target.value })} /></div>
      <div className="space-y-1"><Label className="text-xs">交易類型</Label>
        <Select value={tx.transaction_type || 'transfer'}
          onValueChange={v => onChange({ ...tx, transaction_type: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="transfer">轉讓 Transfer</SelectItem>
            <SelectItem value="allotment">配發 Allotment</SelectItem>
            <SelectItem value="repurchase">購回 Repurchase</SelectItem>
            <SelectItem value="capital_increase">增資 Capital Increase</SelectItem>
          </SelectContent>
        </Select></div>
      <div className="space-y-1"><Label className="text-xs">轉讓人 From</Label>
        <Input value={tx.from_name || ''} placeholder="若為新發行可留空"
          onChange={e => onChange({ ...tx, from_name: e.target.value })} /></div>
      <div className="space-y-1"><Label className="text-xs">受讓人 To</Label>
        <Input value={tx.to_name || ''}
          onChange={e => onChange({ ...tx, to_name: e.target.value })} /></div>
      <div className="space-y-1"><Label className="text-xs">股數</Label>
        <Input type="number" value={tx.shares ?? 0}
          onChange={e => onChange({ ...tx, shares: Number(e.target.value) || 0 })} /></div>
      <div className="space-y-1"><Label className="text-xs">股份類別</Label>
        <Input value={tx.share_type || ''} placeholder="Ordinary"
          onChange={e => onChange({ ...tx, share_type: e.target.value })} /></div>
      <div className="space-y-1"><Label className="text-xs">每股價格</Label>
        <Input value={tx.price_per_share || ''}
          onChange={e => onChange({ ...tx, price_per_share: e.target.value })} /></div>
      <div className="space-y-1"><Label className="text-xs">總代價</Label>
        <Input value={tx.total_consideration || ''}
          onChange={e => onChange({ ...tx, total_consideration: e.target.value })} /></div>
      <div className="space-y-1"><Label className="text-xs">文件編號</Label>
        <Input value={tx.instrument_number || ''}
          onChange={e => onChange({ ...tx, instrument_number: e.target.value })} /></div>
      <div className="space-y-1"><Label className="text-xs">貨幣</Label>
        <Input value={tx.currency || 'HKD'}
          onChange={e => onChange({ ...tx, currency: e.target.value })} /></div>
      <div className="col-span-2 space-y-1"><Label className="text-xs">備註</Label>
        <Textarea rows={2} value={tx.notes || ''}
          onChange={e => onChange({ ...tx, notes: e.target.value })} /></div>
      <div className="col-span-2 flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1" /> 取消
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          <Save className="h-3.5 w-3.5 mr-1" /> 儲存
        </Button>
      </div>
    </div>
  );
}
