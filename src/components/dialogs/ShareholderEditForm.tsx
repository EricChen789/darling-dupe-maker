import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Save, X } from 'lucide-react';
import PersonQuickPick, { type PersonQuickPickData } from '@/components/forms/PersonQuickPick';
import AddressQuickPick, { type AddressQuickPickData } from '@/components/forms/AddressQuickPick';
import { useShareTypeOptions, useCurrencyOptions } from '@/hooks/useShareCapitalOptions';

// ── Types ──
export type ShFormType = {
  name: string; nameEnglish: string; nameChinese: string;
  shares: number; identity: string; idNumber: string;
  address: string; serviceAddress: string; email: string;
  shareType: string; issuePrice: string; currency: string;
  paidUp: string; unpaid: string;
  placeIncorporated: string; companyNumberRef: string; tcspNumber: string;
};

// ── Helpers ──
const composeAddr5 = (flat?: string, building?: string, street?: string, district?: string, region?: string) =>
  [flat, building, street, district, region].map((s: string) => (s || '').trim()).filter(Boolean).join(', ');

const fmtMoney2 = (v: string) => { const n = parseFloat(v); return isNaN(n) ? v : n.toFixed(2); };

export const calcUnpaid = (shares: number, issuePrice: string, paidUp: string) => {
  const price = parseFloat(issuePrice) || 0;
  const paid = parseFloat(paidUp) || 0;
  const unpaid = price * shares - paid;
  return unpaid > 0 ? unpaid.toFixed(2) : '0.00';
};

// 已繳默認全額繳清 = 每股發行價 × 股數（paidUp 為空或 0 時）
const defaultPaidUp = (shares: number, issuePrice: string, paidUp: string) => {
  if (parseFloat(paidUp)) return paidUp; // 有實數（部分繳付）→ 保留
  const price = parseFloat(issuePrice) || 0;
  const total = price * (shares || 0);
  return total > 0 ? total.toFixed(2) : '';
};

const computeShMoney = <T extends { shares: number; issuePrice: string; paidUp: string; unpaid: string }>(f: T) => ({
  issuePrice: f.issuePrice ? fmtMoney2(f.issuePrice) : f.issuePrice,
  unpaid: calcUnpaid(f.shares, f.issuePrice, f.paidUp),
});

export const emptyShForm = (): ShFormType => ({
  name: '', nameEnglish: '', nameChinese: '',
  shares: 0, identity: 'natural', idNumber: '',
  address: '', serviceAddress: '', email: '',
  shareType: '', issuePrice: '', currency: 'HKD',
  paidUp: '', unpaid: '',
  placeIncorporated: '', companyNumberRef: '', tcspNumber: '',
});

export const shFormFromSh = (sh: {
  name?: string; nameEnglish?: string; nameChinese?: string;
  shares?: number; identity?: string; idNumber?: string;
  address?: string; serviceAddress?: string; email?: string;
  shareType?: string; issuePrice?: string; currency?: string;
  paidUp?: string; unpaid?: string;
  placeIncorporated?: string; companyNumberRef?: string; tcspNumber?: string;
}): ShFormType => ({
  name: sh.name || '', nameEnglish: sh.nameEnglish || '', nameChinese: sh.nameChinese || '',
  shares: sh.shares || 0, identity: sh.identity || 'natural', idNumber: sh.idNumber || '',
  address: sh.address || '', serviceAddress: sh.serviceAddress || '',
  email: sh.email || '', shareType: sh.shareType || '', issuePrice: sh.issuePrice || '',
  currency: sh.currency || 'HKD', paidUp: sh.paidUp || '', unpaid: sh.unpaid || '',
  placeIncorporated: sh.placeIncorporated || '', companyNumberRef: sh.companyNumberRef || '', tcspNumber: sh.tcspNumber || '',
});

// ── Component ──
interface ShareholderEditFormProps {
  mode: 'full' | 'identity' | 'financial' | 'inline';
  initialData?: Partial<ShFormType>;
  onSave: (data: ShFormType) => void;
  onCancel: () => void;
  saving?: boolean;
  companyId?: string;
  defaultServiceAddress?: string;
  saveLabel?: string;
}

export function ShareholderEditForm({
  mode,
  initialData,
  onSave,
  onCancel,
  saving = false,
  companyId,
  defaultServiceAddress,
  saveLabel,
}: ShareholderEditFormProps) {
  // 已繳默認全額（= 每股發行價 × 股數）；用戶手動改過 paidUp 後不再自動跟隨
  const paidUpTouchedRef = useRef(false);

  const buildInitial = (init: Partial<ShFormType> | undefined) => {
    const merged = {
      ...emptyShForm(),
      ...init,
      serviceAddress: init?.serviceAddress || defaultServiceAddress || '',
      paidUp: defaultPaidUp(init?.shares || 0, init?.issuePrice || '', init?.paidUp || ''),
    };
    return { ...merged, unpaid: calcUnpaid(merged.shares, merged.issuePrice, merged.paidUp) };
  };

  const [form, setForm] = useState<ShFormType>(() => buildInitial(initialData));

  // 股份類別 / 貨幣下拉建議（默認 ∪ 歷史用過的值，仍可自由輸入）
  const shareTypeListId = useId();
  const currencyListId = useId();
  const shareTypeOptions = useShareTypeOptions();
  const currencyOptions = useCurrencyOptions();

  // Sync when initialData changes (e.g. selecting a different shareholder)
  useEffect(() => {
    if (initialData) {
      paidUpTouchedRef.current = false;
      setForm(buildInitial(initialData));
    }
  }, [initialData?.nameEnglish, initialData?.nameChinese, initialData?.shares, initialData?.identity,
      initialData?.idNumber, initialData?.address, initialData?.email, initialData?.shareType,
      initialData?.issuePrice, initialData?.paidUp, initialData?.placeIncorporated,
      initialData?.companyNumberRef, initialData?.tcspNumber, defaultServiceAddress]);

  // ── PersonQuickPick handler ──
  const handlePersonPick = useCallback((person: PersonQuickPickData) => {
    setForm(prev => {
      const nameEn = person.nameEnglish || '';
      const nameCn = person.nameChinese || '';
      const displayName = nameEn || nameCn || `${person.surname || ''} ${person.otherNames || ''}`.trim();
      // Compose address from structured fields, fallback to _raw
      const addr = person._raw || composeAddr5(
        (person as any).addrFlat, (person as any).addrBuilding,
        (person as any).addrStreet, (person as any).addrDistrict,
        (person as any).addrRegion
      );
      // Determine identity: 'corporate' if person has companyNumberRef or identity='corporate'
      const identity = (person as any).identity === 'corporate' || person.companyNumberRef ? 'corporate' : 'natural';
      return {
        ...prev,
        name: displayName,
        nameEnglish: nameEn,
        nameChinese: nameCn,
        identity,
        idNumber: person.idNumber || prev.idNumber,
        address: addr || prev.address,
        email: person.email || prev.email,
        tcspNumber: (person as any).tcspLicense || prev.tcspNumber,
        companyNumberRef: person.companyNumberRef || prev.companyNumberRef,
        placeIncorporated: identity === 'corporate' ? prev.placeIncorporated : prev.placeIncorporated,
      };
    });
  }, []);

  // ── AddressQuickPick handler ──
  const handleAddressPick = useCallback((addr: AddressQuickPickData) => {
    setForm(prev => ({
      ...prev,
      address: addr._raw || composeAddr5(addr.flat, addr.building, addr.street, addr.district, addr.region),
    }));
  }, []);

  // ── Financial auto-calc on blur ──
  const handleFinancialBlur = useCallback(() => {
    setForm(prev => ({ ...prev, ...computeShMoney(prev) }));
  }, []);

  // ── Submit ──
  const handleSubmit = () => {
    // Validate
    if (mode !== 'financial' && !form.name && !form.nameEnglish && !form.nameChinese) {
      return; // Let parent handle validation message
    }
    onSave({ ...form, ...computeShMoney(form) });
  };

  const showIdentity = mode === 'full' || mode === 'identity' || mode === 'inline';
  const showFinancial = mode === 'full' || mode === 'financial' || mode === 'inline';
  const showPersonPick = mode === 'full' || mode === 'identity';
  const showContact = mode === 'full' || mode === 'identity';
  const isFinancialOnly = mode === 'financial';
  const isCompact = mode === 'inline';
  const defaultSaveLabel = mode === 'full' ? '新增' : '儲存';

  return (
    <div className={`rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2 ${isCompact ? '' : ''}`}>
      {/* ── Person QuickPick (full / identity modes) ── */}
      {showPersonPick && (
        <div className="space-y-1">
          <Label className="text-xs">從系統選擇人員</Label>
          <PersonQuickPick
            companyId={companyId}
            includeAllPersons
            includeAllCompanies
            placeholder="搜尋系統人員或手動輸入…"
            onPick={handlePersonPick}
          />
        </div>
      )}

      <div className={isCompact ? 'grid grid-cols-1 sm:grid-cols-2 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-2'}>
        {/* ── Identity fields ── */}
        {showIdentity && !isFinancialOnly && (
          <>
            {isFinancialOnly ? null : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">英文名稱</Label>
                  <Input value={form.nameEnglish}
                    onChange={e => setForm({ ...form, nameEnglish: e.target.value, name: form.name || e.target.value })}
                    placeholder="English name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">中文名稱</Label>
                  <Input value={form.nameChinese}
                    onChange={e => setForm({ ...form, nameChinese: e.target.value, name: form.name || e.target.value })}
                    placeholder="中文名稱" />
                </div>
                {mode === 'full' && (
                  <div className="space-y-1">
                    <Label className="text-xs">顯示名稱</Label>
                    <Input value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="Display name" />
                  </div>
                )}
                {mode !== 'inline' && (
                  <div className="space-y-1">
                    <Label className="text-xs">身份類型</Label>
                    <Select value={form.identity} onValueChange={v => setForm({ ...form, identity: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="natural">自然人</SelectItem>
                        <SelectItem value="corporate">法人</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">證件號碼</Label>
                  <Input value={form.idNumber}
                    onChange={e => setForm({ ...form, idNumber: e.target.value })}
                    placeholder="ID / Passport No." />
                </div>
                {/* Corporate fields */}
                {form.identity === 'corporate' && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs">成立地點</Label>
                      <Input value={form.placeIncorporated}
                        onChange={e => setForm({ ...form, placeIncorporated: e.target.value })}
                        placeholder="e.g. Hong Kong / BVI" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">公司編號</Label>
                      <Input value={form.companyNumberRef}
                        onChange={e => setForm({ ...form, companyNumberRef: e.target.value })}
                        placeholder="Company No." />
                    </div>
                    <div className={mode === 'inline' ? 'col-span-2 space-y-1' : 'space-y-1'}>
                      <Label className="text-xs">TCSP 牌照號碼</Label>
                      <Input value={form.tcspNumber}
                        onChange={e => setForm({ ...form, tcspNumber: e.target.value })}
                        placeholder="TC No.（如適用）" />
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── Financial fields ── */}
        {showFinancial && (
          <>
            {/* In financial-only mode, show person name as read-only display */}
            {isFinancialOnly && (
              <div className="col-span-2 flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">
                  {form.nameEnglish || form.nameChinese || form.name || '(未命名)'}
                </span>
                {form.nameEnglish && form.nameChinese && (
                  <span className="text-xs text-muted-foreground">{form.nameChinese}</span>
                )}
                {form.identity === 'corporate' && (
                  <Badge variant="outline" className="text-xs">法人</Badge>
                )}
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">持股數量</Label>
              <Input type="number" value={form.shares}
                onChange={e => {
                  const s = parseInt(e.target.value) || 0;
                  setForm(prev => {
                    // 未手動改過已繳 → 已繳自動跟隨為全額（股價 × 股數）
                    const paidUp = paidUpTouchedRef.current ? prev.paidUp : defaultPaidUp(s, prev.issuePrice, '');
                    return { ...prev, shares: s, paidUp, unpaid: calcUnpaid(s, prev.issuePrice, paidUp) };
                  });
                }}
                onBlur={handleFinancialBlur} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">股份類別</Label>
              <Input value={form.shareType} list={shareTypeListId}
                onChange={e => setForm({ ...form, shareType: e.target.value })}
                placeholder="輸入或選擇股份類別" />
              <datalist id={shareTypeListId}>
                {shareTypeOptions.map(o => <option key={o} value={o} />)}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">貨幣</Label>
              <Input value={form.currency} list={currencyListId}
                onChange={e => setForm({ ...form, currency: e.target.value })}
                placeholder="輸入或選擇貨幣" />
              <datalist id={currencyListId}>
                {currencyOptions.map(o => <option key={o} value={o} />)}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">每股發行價</Label>
              <Input value={form.issuePrice}
                onChange={e => setForm(prev => {
                  // 未手動改過已繳 → 已繳自動跟隨為全額（股價 × 股數）
                  const paidUp = paidUpTouchedRef.current ? prev.paidUp : defaultPaidUp(prev.shares, e.target.value, '');
                  return { ...prev, issuePrice: e.target.value, paidUp, unpaid: calcUnpaid(prev.shares, e.target.value, paidUp) };
                })}
                onBlur={handleFinancialBlur}
                placeholder="e.g. 1.00" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">已繳或視作已繳的總款額</Label>
              <Input value={form.paidUp}
                onChange={e => {
                  paidUpTouchedRef.current = true; // 手動改過 → 之後股價/股數不再自動跟隨
                  setForm(prev => ({ ...prev, paidUp: e.target.value, unpaid: calcUnpaid(prev.shares, prev.issuePrice, e.target.value) }));
                }}
                onBlur={handleFinancialBlur}
                placeholder="Amount paid up" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">未繳付股本</Label>
              <Input value={form.unpaid}
                onChange={e => setForm({ ...form, unpaid: e.target.value })}
                placeholder="自動計算" />
            </div>
          </>
        )}

        {/* ── Contact fields (full / identity modes) ── */}
        {showContact && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">電郵</Label>
              <Input value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="Email" />
            </div>
            {/* Spacer for grid alignment when not corporate */}
            {form.identity !== 'corporate' && <div />}
            <div className="col-span-2 space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">居住地址</Label>
              </div>
              <AddressQuickPick
                companyId={companyId}
                includeAllCompanies
                onPick={handleAddressPick}
                label="從系統選擇地址"
                placeholder="選擇已知地址…"
              />
              <Textarea value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
                rows={2} placeholder="或手動輸入地址 Address" />
            </div>
            <div className="col-span-2 space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">服務地址 (Service Address)</Label>
                {defaultServiceAddress && (
                  <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
                    onClick={() => setForm({ ...form, serviceAddress: defaultServiceAddress })}>
                    同註冊辦事處
                  </Button>
                )}
              </div>
              <Textarea value={form.serviceAddress}
                onChange={e => setForm({ ...form, serviceAddress: e.target.value })}
                rows={2} placeholder="留空則自動使用註冊辦事處地址" />
            </div>
          </>
        )}

        {/* ── Address field for inline mode ── */}
        {mode === 'inline' && (
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">地址</Label>
            <Input value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
              placeholder="地址" />
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="flex gap-1 justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5 mr-1" /> 取消
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={saving} className="bg-primary text-primary-foreground">
          <Save className="h-3.5 w-3.5 mr-1" /> {saveLabel || defaultSaveLabel}
        </Button>
      </div>
    </div>
  );
}
