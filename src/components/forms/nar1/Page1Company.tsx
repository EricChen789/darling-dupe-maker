import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NAR1FormData } from './types';

interface Props {
  data: NAR1FormData;
  onChange: (data: NAR1FormData) => void;
}

export const Page1Company = ({ data, onChange }: Props) => {
  const set = (key: keyof NAR1FormData, value: string) => onChange({ ...data, [key]: value });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">第 1 頁 — 公司基本資料</h2>

      <div className="grid grid-cols-2 gap-4">
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
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">日 DD</Label>
            <Input value={data.returnDateDay} onChange={e => set('returnDateDay', e.target.value)} maxLength={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">月 MM</Label>
            <Input value={data.returnDateMonth} onChange={e => set('returnDateMonth', e.target.value)} maxLength={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">年 YYYY</Label>
            <Input value={data.returnDateYear} onChange={e => set('returnDateYear', e.target.value)} maxLength={4} />
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-4">
        <h3 className="text-sm font-medium">5. 財務報表期間 Financial Statement Period（公眾公司適用）</h3>
        <div className="grid grid-cols-6 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">開始日</Label>
            <Input value={data.financialStartDay} onChange={e => set('financialStartDay', e.target.value)} maxLength={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">開始月</Label>
            <Input value={data.financialStartMonth} onChange={e => set('financialStartMonth', e.target.value)} maxLength={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">開始年</Label>
            <Input value={data.financialStartYear} onChange={e => set('financialStartYear', e.target.value)} maxLength={4} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">結束日</Label>
            <Input value={data.financialEndDay} onChange={e => set('financialEndDay', e.target.value)} maxLength={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">結束月</Label>
            <Input value={data.financialEndMonth} onChange={e => set('financialEndMonth', e.target.value)} maxLength={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">結束年</Label>
            <Input value={data.financialEndYear} onChange={e => set('financialEndYear', e.target.value)} maxLength={4} />
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-4">
        <h3 className="text-sm font-medium">6. 註冊辦事處地址 Registered Office Address</h3>
        <div className="grid grid-cols-2 gap-3">
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
            <Label className="text-xs">地區 Region</Label>
            <Select value={data.regRegion} onValueChange={v => set('regRegion', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="香港 Hong Kong">香港 Hong Kong</SelectItem>
                <SelectItem value="九龍 Kowloon">九龍 Kowloon</SelectItem>
                <SelectItem value="新界 New Territories">新界 New Territories</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4 grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>7. 電郵地址 Email</Label>
          <Input value={data.email} onChange={e => set('email', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>8. 網址 Website</Label>
          <Input value={data.website} onChange={e => set('website', e.target.value)} />
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
