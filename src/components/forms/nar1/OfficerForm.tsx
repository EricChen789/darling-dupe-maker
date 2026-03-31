import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { NAR1Officer, createEmptyOfficer } from './types';

interface Props {
  title: string;
  pageLabel: string;
  officers: NAR1Officer[];
  onChange: (officers: NAR1Officer[]) => void;
}

export const OfficerForm = ({ title, pageLabel, officers, onChange }: Props) => {
  const add = () => onChange([...officers, createEmptyOfficer()]);
  const remove = (i: number) => onChange(officers.filter((_, idx) => idx !== i));
  const update = (i: number, key: keyof NAR1Officer, value: string) => {
    const list = [...officers];
    list[i] = { ...list[i], [key]: value };
    onChange(list);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{pageLabel} — {title}</h2>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4 mr-1" /> 新增
        </Button>
      </div>

      {officers.map((o, i) => (
        <div key={i} className="border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{title} #{i + 1}</span>
            <div className="flex items-center gap-2">
              <Select value={o.identity} onValueChange={v => update(i, 'identity', v)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">自然人</SelectItem>
                  <SelectItem value="corporate">法人團體</SelectItem>
                </SelectContent>
              </Select>
              {officers.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => remove(i)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">中文姓名 Chinese Name</Label>
              <Input value={o.nameChinese} onChange={e => update(i, 'nameChinese', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">英文姓名 English Name</Label>
              <Input value={o.nameEnglish} onChange={e => update(i, 'nameEnglish', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">前用中文姓名 Former Chinese Name</Label>
              <Input value={o.formerNameChinese} onChange={e => update(i, 'formerNameChinese', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">前用英文姓名 Former English Name</Label>
              <Input value={o.formerNameEnglish} onChange={e => update(i, 'formerNameEnglish', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {o.identity === 'natural' ? '身份證/護照號碼 ID/Passport No.' : '公司編號 Company No.'}
              </Label>
              <Input value={o.idNumber} onChange={e => update(i, 'idNumber', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">委任日期 Date Appointed</Label>
              <Input value={o.dateAppointed} onChange={e => update(i, 'dateAppointed', e.target.value)} placeholder="DD/MM/YYYY" />
            </div>
            {o.identity === 'corporate' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">成立地點 Place of Incorporation</Label>
                  <Input value={o.placeIncorporated} onChange={e => update(i, 'placeIncorporated', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">公司編號 Company Number Ref</Label>
                  <Input value={o.companyNumberRef} onChange={e => update(i, 'companyNumberRef', e.target.value)} />
                </div>
              </>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">地址 Address</Label>
            <Textarea value={o.address} onChange={e => update(i, 'address', e.target.value)} rows={2} />
          </div>
        </div>
      ))}
    </div>
  );
};
