import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, X, ArrowRight, UserPlus } from 'lucide-react';
import PersonQuickPick, { type PersonQuickPickData } from '@/components/forms/PersonQuickPick';
import type { ShareTransaction } from '@/hooks/useShareTransactions';

export interface ShareholderInfo {
  id: string;
  nameEnglish?: string;
  nameChinese?: string;
  shares?: number;
  shareType?: string;
  currency?: string;
}

interface ShareTransactionFormProps {
  tx: Partial<ShareTransaction>;
  onChange: (tx: Partial<ShareTransaction>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  companyId: string;
  shareholders: ShareholderInfo[];
}

const TX_TYPE_LABELS: Record<string, { label: string; fromHint: string; toHint: string }> = {
  transfer: { label: '轉讓 Transfer', fromHint: '賣方／轉讓人', toHint: '買方／受讓人' },
  allotment: { label: '配發 Allotment', fromHint: '公司／發行人（可留空）', toHint: '獲配人' },
  repurchase: { label: '購回 Repurchase', fromHint: '賣回方／股東', toHint: '公司（可留空）' },
  capital_increase: { label: '增資 Capital Increase', fromHint: '公司（可留空）', toHint: '獲配人／新股東' },
};

export function ShareTransactionForm({ tx, onChange, onSave, onCancel, saving, companyId, shareholders }: ShareTransactionFormProps) {
  const [fromManual, setFromManual] = useState(false);
  const [toManual, setToManual] = useState(false);

  const txType = tx.transaction_type || 'transfer';
  const typeInfo = TX_TYPE_LABELS[txType] || TX_TYPE_LABELS.transfer;

  // Find shareholder info by name match
  const findShareholder = (data: PersonQuickPickData): ShareholderInfo | undefined => {
    const nameEn = (data.nameEnglish || '').trim().toLowerCase();
    const nameCn = (data.nameChinese || '').trim();
    return shareholders.find(sh => {
      const shEn = (sh.nameEnglish || '').trim().toLowerCase();
      const shCn = (sh.nameChinese || '').trim();
      return (nameEn && shEn && (shEn === nameEn || shEn.includes(nameEn) || nameEn.includes(shEn)))
        || (nameCn && shCn && (shCn === nameCn || shCn.includes(nameCn) || nameCn.includes(shCn)));
    });
  };

  const handleFromPick = (data: PersonQuickPickData) => {
    const name = [data.surname, data.otherNames].filter(Boolean).join(' ') || data.nameEnglish || data.nameChinese || '';
    const updates: Partial<ShareTransaction> = {
      ...tx,
      from_name: name,
      from_person_id: '', // Will be set by the picker data
    };

    // Auto-fill from matched shareholder
    const sh = findShareholder(data);
    if (sh) {
      updates.shares = sh.shares ?? tx.shares;
      updates.share_type = sh.shareType || tx.share_type;
      updates.currency = sh.currency || tx.currency;
    }

    onChange(updates);
    setFromManual(false);
  };

  const handleToPick = (data: PersonQuickPickData) => {
    const name = [data.surname, data.otherNames].filter(Boolean).join(' ') || data.nameEnglish || data.nameChinese || '';
    const updates: Partial<ShareTransaction> = { ...tx, to_name: name, to_person_id: '' };

    // Auto-fill from matched shareholder
    const sh = findShareholder(data);
    if (sh && !tx.shares) {
      updates.shares = sh.shares ?? tx.shares;
      updates.share_type = sh.shareType || tx.share_type;
      updates.currency = sh.currency || tx.currency;
    }

    onChange(updates);
    setToManual(false);
  };

  // Find matched shareholder for current from/to name display
  const fromSh = shareholders.find(sh =>
    (sh.nameEnglish || '').trim().toLowerCase() === (tx.from_name || '').trim().toLowerCase()
    || (sh.nameChinese || '').trim() === (tx.from_name || '').trim()
  );
  const toSh = shareholders.find(sh =>
    (sh.nameEnglish || '').trim().toLowerCase() === (tx.to_name || '').trim().toLowerCase()
    || (sh.nameChinese || '').trim() === (tx.to_name || '').trim()
  );

  return (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-4 space-y-3">
      {/* ── Row 1: Date + Type ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">交易日期</Label>
          <Input type="date" value={tx.transaction_date || ''}
            onChange={e => onChange({ ...tx, transaction_date: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">交易類型</Label>
          <Select value={txType} onValueChange={v => onChange({ ...tx, transaction_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TX_TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Flow: From → To ── */}
      <div className="flex items-center gap-2 py-1">
        <div className="flex-1">
          <Label className="text-xs font-medium text-muted-foreground">{typeInfo.fromHint}</Label>
          {fromManual ? (
            <div className="flex gap-1 mt-1">
              <Input value={tx.from_name || ''} placeholder="輸入轉讓人名稱"
                onChange={e => onChange({ ...tx, from_name: e.target.value, from_person_id: '' })} />
              <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => setFromManual(false)}>
                <UserPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : tx.from_name ? (
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="secondary" className="text-sm font-normal py-1 px-2 max-w-[200px] truncate">
                {tx.from_name}
              </Badge>
              {fromSh && (
                <Badge variant="outline" className="text-xs">
                  {(fromSh.shares || 0).toLocaleString()} 股 {fromSh.shareType || ''}
                </Badge>
              )}
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setFromManual(true)}>
                ✏️ 改
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => { onChange({ ...tx, from_name: '', from_person_id: '' }); setFromManual(false); }}>
                ✕ 清除
              </Button>
            </div>
          ) : (
            <div className="mt-1">
              <PersonQuickPick
                companyId={companyId}
                includeAllCompanies
                includeAllPersons
                label=""
                placeholder={txType === 'allotment' || txType === 'capital_increase' ? '公司配發（或手動輸入）' : '選擇轉讓人（股東）'}
                onPick={handleFromPick}
              />
              <Button variant="link" size="sm" className="h-6 text-xs mt-0.5 px-0" onClick={() => setFromManual(true)}>
                或手動輸入名稱…
              </Button>
            </div>
          )}
        </div>

        <ArrowRight className="h-5 w-5 text-primary shrink-0 mt-5" />

        <div className="flex-1">
          <Label className="text-xs font-medium text-muted-foreground">{typeInfo.toHint}</Label>
          {toManual ? (
            <div className="flex gap-1 mt-1">
              <Input value={tx.to_name || ''} placeholder="輸入受讓人名稱"
                onChange={e => onChange({ ...tx, to_name: e.target.value, to_person_id: '' })} />
              <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => setToManual(false)}>
                <UserPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : tx.to_name ? (
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="secondary" className="text-sm font-normal py-1 px-2 max-w-[200px] truncate">
                {tx.to_name}
              </Badge>
              {toSh && (
                <Badge variant="outline" className="text-xs">
                  {(toSh.shares || 0).toLocaleString()} 股 {toSh.shareType || ''}
                </Badge>
              )}
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setToManual(true)}>
                ✏️ 改
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => { onChange({ ...tx, to_name: '', to_person_id: '' }); setToManual(false); }}>
                ✕ 清除
              </Button>
            </div>
          ) : (
            <div className="mt-1">
              <PersonQuickPick
                companyId={companyId}
                includeAllCompanies
                includeAllPersons
                label=""
                placeholder={txType === 'repurchase' ? '公司購回（或手動輸入）' : '選擇受讓人'}
                onPick={handleToPick}
              />
              <Button variant="link" size="sm" className="h-6 text-xs mt-0.5 px-0" onClick={() => setToManual(true)}>
                或手動輸入名稱…
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 3: Shares + Type + Currency ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">股數</Label>
          <Input type="number" value={tx.shares ?? 0}
            onChange={e => onChange({ ...tx, shares: Number(e.target.value) || 0 })} />
          {fromSh && tx.shares === fromSh.shares && (
            <p className="text-xs text-green-600">✓ 已自動填入 {fromSh.nameEnglish || fromSh.nameChinese} 的持股數</p>
          )}
          {toSh && !fromSh && tx.shares === toSh.shares && (
            <p className="text-xs text-green-600">✓ 已自動填入 {toSh.nameEnglish || toSh.nameChinese} 的持股數</p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">股份類別</Label>
          <Input value={tx.share_type || ''} placeholder="Ordinary"
            onChange={e => onChange({ ...tx, share_type: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">貨幣</Label>
          <Input value={tx.currency || 'HKD'}
            onChange={e => onChange({ ...tx, currency: e.target.value })} />
        </div>
      </div>

      {/* ── Row 4: Price + Consideration + Instrument ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">每股價格</Label>
          <Input value={tx.price_per_share || ''}
            onChange={e => onChange({ ...tx, price_per_share: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">總代價</Label>
          <Input value={tx.total_consideration || ''}
            onChange={e => onChange({ ...tx, total_consideration: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">文件編號</Label>
          <Input value={tx.instrument_number || ''}
            onChange={e => onChange({ ...tx, instrument_number: e.target.value })} />
        </div>
      </div>

      {/* ── Row 5: Notes ── */}
      <div className="space-y-1">
        <Label className="text-xs">備註</Label>
        <Textarea rows={2} value={tx.notes || ''}
          onChange={e => onChange({ ...tx, notes: e.target.value })} />
      </div>

      {/* ── Buttons ── */}
      <div className="flex gap-2 justify-end pt-1">
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
