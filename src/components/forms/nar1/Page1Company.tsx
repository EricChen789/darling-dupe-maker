import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { NAR1FormData } from './types';

interface Props {
  data: NAR1FormData;
  onChange: (data: NAR1FormData) => void;
}

/** Build a Date from separate D/M/Y strings, returning null if invalid. */
function toDate(day: string, month: string, year: string): Date | null {
  if (!day || !month || !year) return null;
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  if (isNaN(d.getTime())) return null;
  return d;
}

export const Page1Company = ({ data, onChange }: Props) => {
  const set = (key: keyof NAR1FormData, value: string) => onChange({ ...data, [key]: value });

  const [finStartOpen, setFinStartOpen] = useState(false);
  const [finEndOpen, setFinEndOpen] = useState(false);

  const finStartDate = toDate(data.financialStartDay, data.financialStartMonth, data.financialStartYear);
  const finEndDate = toDate(data.financialEndDay, data.financialEndMonth, data.financialEndYear);

  const handleFinStartSelect = (date: Date | undefined) => {
    if (date) {
      onChange({
        ...data,
        financialStartDay: String(date.getDate()).padStart(2, '0'),
        financialStartMonth: String(date.getMonth() + 1).padStart(2, '0'),
        financialStartYear: String(date.getFullYear()),
      });
    }
    setFinStartOpen(false);
  };

  const handleFinEndSelect = (date: Date | undefined) => {
    if (date) {
      onChange({
        ...data,
        financialEndDay: String(date.getDate()).padStart(2, '0'),
        financialEndMonth: String(date.getMonth() + 1).padStart(2, '0'),
        financialEndYear: String(date.getFullYear()),
      });
    }
    setFinEndOpen(false);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">第 1 頁 — 公司基本資料</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="col-span-2 space-y-2">
          <Label>商業登記號碼 CI No.</Label>
          <Input value={data.brNumber} onChange={e => set('brNumber', e.target.value)} placeholder="例：12345678" />
        </div>
        <div className="col-span-2 space-y-2">
          <Label>1. 公司名稱 (英文) Company Name (English)</Label>
          <Input value={data.companyName} onChange={e => set('companyName', e.target.value)} />
        </div>
        <div className="col-span-2 space-y-2">
          <Label>1. 公司名稱 (中文) Company Name (Chinese)</Label>
          <Input value={data.chineseName} onChange={e => set('chineseName', e.target.value)} />
        </div>
        <div className="col-span-2 space-y-2">
          <Label>2. 商業名稱 Trading Name（如有）</Label>
          <Input value={data.tradingName} onChange={e => set('tradingName', e.target.value)} />
        </div>
        <div className="col-span-2 space-y-2">
          <Label>3. 公司類別 Type of Company</Label>
          <Select value={data.companyType} onValueChange={v => set('companyType', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="private">私人公司 Private Company</SelectItem>
              <SelectItem value="public">公眾公司 Public Company</SelectItem>
              <SelectItem value="guarantee">擔保有限公司 Company Limited by Guarantee</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-4">
        <h3 className="text-sm font-medium">4. 結算日期 Date of Return</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">日 DD</Label>
            <Input value={data.returnDateDay} disabled className="bg-muted cursor-not-allowed" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">月 MM</Label>
            <Input value={data.returnDateMonth} disabled className="bg-muted cursor-not-allowed" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">年 YYYY</Label>
            <Input value={data.returnDateYear} disabled className="bg-muted cursor-not-allowed" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          此日期固定為公司成立周年日（{data.returnDateDay}/{data.returnDateMonth}/{data.returnDateYear}），不可更改。
          如需要更改，請先修改公司的成立日期。
        </p>
      </div>

      <div className="border-t border-border pt-4 space-y-4">
        <h3 className="text-sm font-medium">5. 財務報表期間 Financial Statement Period（公眾公司適用）</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Start date */}
          <div className="space-y-2">
            <Label className="text-xs">開始日期 Start Date</Label>
            <Popover open={finStartOpen} onOpenChange={setFinStartOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !finStartDate && 'text-muted-foreground',
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {finStartDate ? format(finStartDate, 'yyyy-MM-dd') : <span>點擊選擇日期</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={finStartDate || undefined}
                  onSelect={handleFinStartSelect}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          {/* End date */}
          <div className="space-y-2">
            <Label className="text-xs">結束日期 End Date</Label>
            <Popover open={finEndOpen} onOpenChange={setFinEndOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !finEndDate && 'text-muted-foreground',
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {finEndDate ? format(finEndDate, 'yyyy-MM-dd') : <span>點擊選擇日期</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={finEndDate || undefined}
                  onSelect={handleFinEndSelect}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-4">
        <h3 className="text-sm font-medium">6. 註冊辦事處地址 Registered Office Address</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">室／樓／座 Flat/Floor/Block</Label>
            <Input value={data.regFlat} onChange={e => set('regFlat', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">大廈 Building</Label>
            <Input value={data.regBuilding} onChange={e => set('regBuilding', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">街道 Street</Label>
            <Input value={data.regStreet} onChange={e => set('regStreet', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">區 District</Label>
            <Input value={data.regDistrict} onChange={e => set('regDistrict', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">國家／地區 Country／Region</Label>
            <Input value={data.regRegion} onChange={e => set('regRegion', e.target.value)} placeholder="e.g. 香港" />
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>7. 電郵地址 Email</Label>
          <Input value={data.email} onChange={e => set('email', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>8. 電話號碼 Phone Number</Label>
          <Input value={data.website} onChange={e => set('website', e.target.value)} placeholder="例：+852 1234 5678" />
        </div>
        <div className="space-y-2">
          <Label>9. 業務性質編碼 Business Code</Label>
          <Input value={data.businessCode} onChange={e => set('businessCode', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>9. 業務性質描述 Nature of Business</Label>
          <Input value={data.businessNature} onChange={e => set('businessNature', e.target.value)} />
        </div>
      </div>
    </div>
  );
};
