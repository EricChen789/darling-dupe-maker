import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { NAR1Shareholder, createEmptyShareholder } from './types';

interface Props {
  shareholders: NAR1Shareholder[];
  onChange: (shareholders: NAR1Shareholder[]) => void;
}

export const ShareholderForm = ({ shareholders, onChange }: Props) => {
  const add = () => onChange([...shareholders, createEmptyShareholder()]);
  const remove = (i: number) => onChange(shareholders.filter((_, idx) => idx !== i));
  const update = (i: number, key: keyof NAR1Shareholder, value: string) => {
    const list = [...shareholders];
    list[i] = { ...list[i], [key]: value };
    onChange(list);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">股東 / 成員資料 Shareholders / Members</h2>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4 mr-1" /> 新增
        </Button>
      </div>

      {shareholders.map((s, i) => (
        <div key={i} className="border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">股東 #{i + 1}</span>
            <div className="flex items-center gap-2">
              <Select value={s.identity} onValueChange={v => update(i, 'identity', v)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">自然人</SelectItem>
                  <SelectItem value="corporate">法人團體</SelectItem>
                </SelectContent>
              </Select>
              {shareholders.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => remove(i)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">中文姓名 Chinese Name</Label>
              <Input value={s.nameChinese} onChange={e => update(i, 'nameChinese', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">英文姓名 English Name</Label>
              <Input value={s.nameEnglish} onChange={e => update(i, 'nameEnglish', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {s.identity === 'natural' ? '身份證/護照號碼' : '公司編號'}
              </Label>
              <Input value={s.idNumber} onChange={e => update(i, 'idNumber', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">股份類別 Share Class</Label>
              <Input value={s.shareClass} onChange={e => update(i, 'shareClass', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">股份數目 No. of Shares</Label>
              <Input value={s.shares} onChange={e => update(i, 'shares', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">貨幣 Currency</Label>
              <Input value={s.currency} onChange={e => update(i, 'currency', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">繳足款額 Amount Paid Up</Label>
              <Input value={s.paidUp} onChange={e => update(i, 'paidUp', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">地址 Address</Label>
            <Textarea value={s.address} onChange={e => update(i, 'address', e.target.value)} rows={2} />
          </div>
        </div>
      ))}
    </div>
  );
};
