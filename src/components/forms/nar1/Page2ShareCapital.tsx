import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { NAR1FormData, ShareCapitalRow } from './types';

interface Props {
  data: NAR1FormData;
  onChange: (data: NAR1FormData) => void;
}

export const Page2ShareCapital = ({ data, onChange }: Props) => {
  const addRow = () => {
    onChange({
      ...data,
      shareCapital: [...data.shareCapital, { shareClass: '', currency: 'HKD', shares: '', paidUp: '' }],
    });
  };

  const removeRow = (i: number) => {
    onChange({ ...data, shareCapital: data.shareCapital.filter((_, idx) => idx !== i) });
  };

  const updateRow = (i: number, key: keyof ShareCapitalRow, value: string) => {
    const rows = [...data.shareCapital];
    rows[i] = { ...rows[i], [key]: value };
    onChange({ ...data, shareCapital: rows });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">第 2 頁 — 股本資料</h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>9. 按揭及押記負債總額 Mortgages & Charges</Label>
          <Input value={data.mortgageAmount} onChange={e => onChange({ ...data, mortgageAmount: e.target.value })} placeholder="HKD" />
        </div>
        <div className="space-y-2">
          <Label>10. 無股本公司成員人數</Label>
          <Input value={data.noShareMembers} onChange={e => onChange({ ...data, noShareMembers: e.target.value })} placeholder="適用於無股本公司" />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">11. 股本 Share Capital</h3>
          <Button variant="outline" size="sm" onClick={addRow} disabled={data.shareCapital.length >= 6}>
            <Plus className="h-4 w-4 mr-1" /> 新增
          </Button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_80px_1fr_1fr_40px] gap-2 text-xs text-muted-foreground font-medium">
            <div>股份類別 Class</div>
            <div>貨幣</div>
            <div>股份數目 No. of Shares</div>
            <div>繳足款額 Total Amount Paid Up</div>
            <div></div>
          </div>
          {data.shareCapital.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_1fr_1fr_40px] gap-2">
              <Input value={row.shareClass} onChange={e => updateRow(i, 'shareClass', e.target.value)} placeholder="Ordinary 普通股" />
              <Input value={row.currency} onChange={e => updateRow(i, 'currency', e.target.value)} placeholder="HKD" />
              <Input value={row.shares} onChange={e => updateRow(i, 'shares', e.target.value)} placeholder="10000" />
              <Input value={row.paidUp} onChange={e => updateRow(i, 'paidUp', e.target.value)} placeholder="10000" />
              <Button variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={data.shareCapital.length <= 1}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
