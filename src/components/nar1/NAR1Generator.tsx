import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileText, Download, Loader2 } from 'lucide-react';
import { Company } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { usePresenters } from '@/hooks/usePresenters';

interface NAR1GeneratorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

// 結算日期 = 成立日期的月/日 + 今年。如沒成立日期，就用今天。
const computeReturnDate = (incorporationDate?: string): string => {
  const today = new Date();
  const currentYear = today.getFullYear();
  if (incorporationDate) {
    const d = new Date(incorporationDate);
    if (!isNaN(d.getTime())) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${currentYear}-${mm}-${dd}`;
    }
  }
  return today.toISOString().split('T')[0];
};

const composePresenterContact = (
  opts: { phone?: string; fax?: string; email?: string; reference?: string; fallback?: string }
) => {
  const parts: string[] = [];
  if (opts.phone) parts.push(`電話: ${opts.phone}`);
  if (opts.fax) parts.push(`傳真: ${opts.fax}`);
  if (opts.email) parts.push(`電郵: ${opts.email}`);
  if (opts.reference) parts.push(`參考編號: ${opts.reference}`);
  if (parts.length) return parts.join('  ');
  return opts.fallback || '';
};

export const NAR1Generator = ({ open, onOpenChange, company }: NAR1GeneratorProps) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const { data: presenters = [] } = usePresenters();
  const [formData, setFormData] = useState({
    returnDate: computeReturnDate(company?.incorporationDate),
    flat: '',
    building: '',
    street: '',
    district: '',
    region: '香港 Hong Kong',
    presenterId: '',
    presenterName: '',
    presenterAddress: '',
    presenterReference: '',
    presenterPhone: '',
    presenterFax: '',
    presenterEmail: '',
    presenterContact: '',
  });

  // 附表 E (P.15) 公司紀錄保存地點 — 留空則不附加 P.15
  const [companyRecords, setCompanyRecords] = useState<Array<{ records: string; address: string }>>([]);
  const addRecord = () => setCompanyRecords(prev => [...prev, { records: '', address: '' }]);
  const removeRecord = (i: number) => setCompanyRecords(prev => prev.filter((_, idx) => idx !== i));
  const updateRecord = (i: number, key: 'records' | 'address', val: string) =>
    setCompanyRecords(prev => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));

  // 當 company 變更（開啟對話框時），重新計算結算日期、帶入註冊地址 + Presenter
  useEffect(() => {
    if (company) {
      const preferred = company.preferredPresenterId
        ? presenters.find(p => p.id === company.preferredPresenterId)
        : undefined;
      const refOverride = company.presenterReference || '';
      const ref = refOverride || preferred?.reference || '';
      setFormData(prev => ({
        ...prev,
        returnDate: computeReturnDate(company.incorporationDate),
        flat: company.regFlat || prev.flat,
        building: company.regBuilding || prev.building,
        street: company.regStreet || prev.street,
        district: company.regDistrict || prev.district,
        region: company.regRegion || prev.region,
        presenterId: preferred?.id || '',
        presenterName: preferred?.name || '',
        presenterAddress: preferred?.address || '',
        presenterReference: ref,
        presenterPhone: preferred?.phone || '',
        presenterFax: preferred?.fax || '',
        presenterEmail: preferred?.email || '',
        presenterContact: preferred
          ? composePresenterContact({
              phone: preferred.phone,
              fax: preferred.fax,
              email: preferred.email,
              reference: ref,
              fallback: preferred.contact,
            })
          : '',
      }));
    }
  }, [company, presenters]);

  const handlePickPresenter = (id: string) => {
    const p = presenters.find(x => x.id === id);
    if (!p) return;
    setFormData(prev => ({
      ...prev,
      presenterId: p.id,
      presenterName: p.name,
      presenterAddress: p.address || '',
      presenterReference: p.reference || '',
      presenterPhone: p.phone || '',
      presenterFax: p.fax || '',
      presenterEmail: p.email || '',
      presenterContact: composePresenterContact({
        phone: p.phone,
        fax: p.fax,
        email: p.email,
        reference: p.reference,
        fallback: p.contact,
      }),
    }));
  };

  const recomposeContact = (overrides: Partial<{ phone: string; fax: string; email: string; reference: string }>) => {
    setFormData(prev => {
      const next = { ...prev, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [`presenter${k.charAt(0).toUpperCase()}${k.slice(1)}`, v])) } as typeof prev;
      next.presenterContact = composePresenterContact({
        phone: next.presenterPhone,
        fax: next.presenterFax,
        email: next.presenterEmail,
        reference: next.presenterReference,
      });
      return next;
    });
  };

  const handleReferenceChange = (value: string) => recomposeContact({ reference: value });
  const handlePhoneChange = (value: string) => recomposeContact({ phone: value });
  const handleFaxChange = (value: string) => recomposeContact({ fax: value });
  const handleEmailChange = (value: string) => recomposeContact({ email: value });

  const handleGenerate = async () => {
    if (!company) return;

    setIsGenerating(true);

    try {
      // 解析簽署人：明確選擇 → 第一個秘書 → 第一個董事
      const explicitId = company.signerRoleId || '';
      const allOfficers = [...company.secretaries, ...company.directors];
      const explicitOfficer = explicitId ? allOfficers.find(o => o.id === explicitId) : null;
      const fallback = company.secretaries[0] || company.directors[0] || null;
      const signer = explicitOfficer || fallback;
      const signerRole: 'director' | 'secretary' | null = signer
        ? (company.secretaries.some(s => s.id === signer.id) ? 'secretary' : 'director')
        : null;
      const signerName = signer
        ? (signer.nameEnglish || signer.nameChinese || '')
        : (formData.presenterName || '');

      const payload = {
        name: company.name,
        chineseName: company.chineseName || '',
        brNumber: company.brNumber,
        tradingName: company.tradingName,
        businessNature: company.businessNature,
        businessCode: company.businessCode,
        companyType: company.companyType,
        registeredOffice: {
          flat: formData.flat,
          building: formData.building,
          street: formData.street,
          district: formData.district,
          region: formData.region,
        },
        directors: company.directors.map(d => ({
          nameChinese: d.nameChinese,
          nameEnglish: d.nameEnglish,
          email: d.email,
          identity: d.identity,
          brNumber: d.brNumber,
          address: d.address || '',
          idNumber: d.idNumber || '',
          dateAppointed: d.dateAppointed || '',
          placeIncorporated: d.placeIncorporated || '',
          companyNumberRef: d.companyNumberRef || '',
          passportNumber: d.passportNumber || '',
          nationality: (d as any).nationality || d.placeIncorporated || '',
        })),
        secretaries: company.secretaries.map(s => ({
          nameChinese: s.nameChinese,
          nameEnglish: s.nameEnglish,
          email: s.email,
          identity: s.identity,
          brNumber: s.brNumber,
          address: s.address || '',
          serviceAddress: (s as any).serviceAddress || (s as any).service_address || '',
          idNumber: s.idNumber || '',
          dateAppointed: s.dateAppointed || '',
          placeIncorporated: s.placeIncorporated || '',
          companyNumberRef: s.companyNumberRef || '',
          tcspNumber: s.tcspNumber || '',
        })),
        shareholders: company.shareholders.map(sh => ({
          name: sh.name,
          nameEnglish: sh.nameEnglish,
          nameChinese: sh.nameChinese,
          shares: sh.shares,
          identity: sh.identity,
          idNumber: sh.idNumber || '',
          address: sh.address || '',
          shareType: sh.shareType || '',
          currency: sh.currency || 'HKD',
          issuePrice: sh.issuePrice || '',
          paidUp: sh.paidUp || '',
          unpaid: sh.unpaid || '',
        })),
        returnDate: formData.returnDate,
        presenter: {
          name: formData.presenterName || '',
          address: formData.presenterAddress || '',
          contact: formData.presenterContact || '',
          reference: formData.presenterReference || '',
          phone: formData.presenterPhone || '',
          fax: formData.presenterFax || '',
          email: formData.presenterEmail || '',
        },
        companyRecords: companyRecords
          .filter(r => r.records.trim() || r.address.trim())
          .map(r => ({ records: r.records, address: r.address })),
        signer: signer ? { name: signerName, role: signerRole } : null,
      };

      const token = localStorage.getItem("secretary_jwt") || "";
      const resp = await fetch('/api/generate-nar1-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      // Handle the PDF download
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `NAR1_${company.brNumber}_${Date.now()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'PDF 已生成',
        description: `NAR1 表格已成功生成並下載`,
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: '生成失敗',
        description: error instanceof Error ? error.message : '無法生成 PDF，請稍後再試',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (!company) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-none w-[95vw] h-[95vh] overflow-y-auto flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            生成 NAR1 周年申報表
          </DialogTitle>
          <DialogDescription>
            為「{company.name}」生成 NAR1 周年申報表 PDF
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Company Info Summary */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <h4 className="font-medium text-sm">公司資料摘要</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">公司名稱：</span>
                <span className="font-medium">{company.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">商業登記號碼：</span>
                <span className="font-medium">{company.brNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground">董事人數：</span>
                <span className="font-medium">{company.directors.length} 人</span>
              </div>
              <div>
                <span className="text-muted-foreground">秘書人數：</span>
                <span className="font-medium">{company.secretaries.length} 人</span>
              </div>
            </div>
          </div>

          {/* Directors Preview */}
          {company.directors.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">董事資料</h4>
              <div className="bg-muted/30 rounded-lg p-3 space-y-3 text-sm">
                {company.directors.map((dir, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-6">{i + 1}.</span>
                      <span className="font-medium">{dir.nameEnglish || dir.nameChinese}</span>
                      {dir.nameEnglish && dir.nameChinese && <span className="text-muted-foreground">{dir.nameChinese}</span>}
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        {dir.identity === 'natural' ? '自然人' : '法人'}
                      </span>
                    </div>
                    <div className="ml-8 text-xs text-muted-foreground space-y-0.5">
                      {dir.idNumber && <div>證件號碼：{dir.idNumber}</div>}
                      {dir.address && <div>地址：{dir.address}</div>}
                      {dir.dateAppointed && <div>委任日期：{dir.dateAppointed}</div>}
                      {dir.identity === 'corporate' && dir.placeIncorporated && <div>成立地點：{dir.placeIncorporated}</div>}
                      {dir.identity === 'corporate' && dir.companyNumberRef && <div>公司編號：{dir.companyNumberRef}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Secretaries Preview */}
          {company.secretaries.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">秘書資料</h4>
              <div className="bg-muted/30 rounded-lg p-3 space-y-3 text-sm">
                {company.secretaries.map((sec, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-6">{i + 1}.</span>
                      <span className="font-medium">{sec.nameEnglish || sec.nameChinese}</span>
                      {sec.nameEnglish && sec.nameChinese && <span className="text-muted-foreground">{sec.nameChinese}</span>}
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        {sec.identity === 'natural' ? '自然人' : '法人'}
                      </span>
                    </div>
                    <div className="ml-8 text-xs text-muted-foreground space-y-0.5">
                      {sec.idNumber && <div>證件號碼：{sec.idNumber}</div>}
                      {sec.address && <div>地址：{sec.address}</div>}
                      {sec.identity === 'corporate' && sec.companyNumberRef && <div>公司編號：{sec.companyNumberRef}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shareholders Preview */}
          {company.shareholders.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">股東資料</h4>
              <div className="bg-muted/30 rounded-lg p-3 space-y-3 text-sm">
                {company.shareholders.map((sh, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-6">{i + 1}.</span>
                      <span className="font-medium">{sh.nameEnglish || sh.nameChinese || sh.name}</span>
                      <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                        {sh.shares.toLocaleString()} 股
                      </span>
                      {sh.shareType && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{sh.shareType}</span>}
                      {sh.currency && <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{sh.currency}</span>}
                    </div>
                    <div className="ml-8 text-xs text-muted-foreground space-y-0.5">
                      {sh.address && <div>地址：{sh.address}</div>}
                      {sh.issuePrice && <div>每股發行價：{sh.currency || 'HKD'} {sh.issuePrice}</div>}
                      {sh.paidUp !== undefined && sh.paidUp !== '' && <div>已繳付：{sh.currency || 'HKD'} {sh.paidUp}</div>}
                      {sh.unpaid !== undefined && sh.unpaid !== '' && <div>未繳付：{sh.currency || 'HKD'} {sh.unpaid}</div>}
                      {sh.idNumber && <div>證件號碼：{sh.idNumber}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Share Capital Summary (Page 2 of NAR1) */}
          {company.shareholders.length > 0 && (() => {
            const normalizeShareClass = (raw?: string) => {
              const t = (raw || '').trim();
              if (!t) return 'Ordinary 普通股';
              const upper = t.toUpperCase().replace(/\s+/g, ' ');
              if (upper === 'ORD' || upper === 'ORD0' || upper === 'ORDINARY' || upper.startsWith('ORDINARY ') || upper === 'ORDINARY 普通股') {
                return 'Ordinary 普通股';
              }
              return t;
            };
            const map = new Map<string, { className: string; currency: string; shares: number; paidUp: number; unpaid: number; issuePrice: string }>();
            for (const sh of company.shareholders) {
              const className = normalizeShareClass(sh.shareType);
              const currency = sh.currency?.trim() || 'HKD';
              const issuePrice = sh.issuePrice?.trim() || '';
              const key = `${className}||${currency}||${issuePrice}`;
              const existing = map.get(key) || { className, currency, shares: 0, paidUp: 0, unpaid: 0, issuePrice };
              existing.shares += Number(sh.shares) || 0;
              existing.paidUp += parseFloat(sh.paidUp || '0') || 0;
              existing.unpaid += parseFloat(sh.unpaid || '0') || 0;
              map.set(key, existing);
            }
            const rows = Array.from(map.values());
            return (
              <div className="space-y-2">
                <h4 className="font-medium text-sm">股本表格 (NAR1 第 2 頁)</h4>
                <div className="bg-muted/30 rounded-lg p-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-1 pr-2">股份類別</th>
                        <th className="py-1 pr-2">貨幣</th>
                        <th className="py-1 pr-2 text-right">每股發行價</th>
                        <th className="py-1 pr-2 text-right">股份總數</th>
                        <th className="py-1 pr-2 text-right">已繳付</th>
                        <th className="py-1 text-right">未繳付</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-b border-border/40">
                          <td className="py-1 pr-2 font-medium">{r.className}</td>
                          <td className="py-1 pr-2">{r.currency}</td>
                          <td className="py-1 pr-2 text-right">{r.issuePrice || '-'}</td>
                          <td className="py-1 pr-2 text-right">{r.shares.toLocaleString()}</td>
                          <td className="py-1 pr-2 text-right">{r.paidUp.toLocaleString()}</td>
                          <td className="py-1 text-right">{r.unpaid.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">系統會按「股份類別 + 貨幣 + 每股發行價」自動分組，最多顯示 4 行於 NAR1 第 2 頁。</p>
                </div>
              </div>
            );
          })()}

          {/* Additional Form Fields */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm">申報表資料</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="returnDate">申報表結算日期</Label>
                <Input
                  id="returnDate"
                  type="date"
                  value={formData.returnDate}
                  onChange={(e) => setFormData({ ...formData, returnDate: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>註冊辦事處地址</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="室／樓／座等"
                  value={formData.flat}
                  onChange={(e) => setFormData({ ...formData, flat: e.target.value })}
                />
                <Input
                  placeholder="大廈"
                  value={formData.building}
                  onChange={(e) => setFormData({ ...formData, building: e.target.value })}
                />
                <Input
                  placeholder="街道／屋苑／地段／村等"
                  value={formData.street}
                  onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                  className="col-span-2"
                />
                <Input
                  placeholder="區"
                  value={formData.district}
                  onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                />
                <Select
                  value={formData.region}
                  onValueChange={(value) => setFormData({ ...formData, region: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="地區" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="香港 Hong Kong">香港 Hong Kong</SelectItem>
                    <SelectItem value="九龍 Kowloon">九龍 Kowloon</SelectItem>
                    <SelectItem value="新界 New Territories">新界 New Territories</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Presenter section */}
            <div className="space-y-3 border border-border rounded-lg p-3">
              <h4 className="font-medium text-sm">提交人 Presenter</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">選擇提交人</Label>
                  <Select value={formData.presenterId || ''} onValueChange={handlePickPresenter}>
                    <SelectTrigger><SelectValue placeholder="選擇..." /></SelectTrigger>
                    <SelectContent>
                      {presenters.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">提交人名稱</Label>
                  <Input value={formData.presenterName} onChange={e => setFormData({ ...formData, presenterName: e.target.value })} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">地址</Label>
                  <Textarea rows={2} value={formData.presenterAddress} onChange={e => setFormData({ ...formData, presenterAddress: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">參考編號 Reference</Label>
                  <Input value={formData.presenterReference} onChange={e => handleReferenceChange(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">電話 Phone</Label>
                  <Input value={formData.presenterPhone} onChange={e => handlePhoneChange(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">傳真 Fax</Label>
                  <Input value={formData.presenterFax} onChange={e => handleFaxChange(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">電郵 Email</Label>
                  <Input type="email" value={formData.presenterEmail} onChange={e => handleEmailChange(e.target.value)} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">聯絡資訊（自動組成，可手動覆蓋）</Label>
                  <Textarea rows={2} value={formData.presenterContact} onChange={e => setFormData({ ...formData, presenterContact: e.target.value })} />
                </div>
              </div>
            </div>

            {/* 附表 E (P.15) — 公司紀錄保存地點 */}
            <div className="space-y-3 border border-border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-sm">公司紀錄保存地點（附表 E / P.15）</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    如有公司紀錄並非保存於上述註冊辦事處，請列出。留空則不附加 P.15。
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={addRecord}>
                  + 新增一筆
                </Button>
              </div>
              {companyRecords.length === 0 && (
                <p className="text-xs text-muted-foreground italic">尚未新增任何紀錄。</p>
              )}
              {companyRecords.map((r, i) => (
                <div key={i} className="grid grid-cols-2 gap-3 items-start border-t border-border/40 pt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">公司紀錄 Company Records</Label>
                    <Textarea
                      rows={3}
                      placeholder="例如：Register of Members"
                      value={r.records}
                      onChange={e => updateRecord(i, 'records', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">地址 Address</Label>
                    <Textarea
                      rows={3}
                      placeholder="保存該紀錄的完整地址"
                      value={r.address}
                      onChange={e => updateRecord(i, 'address', e.target.value)}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeRecord(i)}>
                      移除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="bg-primary text-primary-foreground"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                生成並下載 PDF
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NAR1Generator;
