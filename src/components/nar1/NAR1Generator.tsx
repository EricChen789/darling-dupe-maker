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

const composePresenterContact = (p: any, referenceOverride?: string) => {
  if (!p) return '';
  const ref = (referenceOverride && referenceOverride.trim()) || p.reference || '';
  const parts: string[] = [];
  if (p.phone) parts.push(p.phone);
  if (p.fax) parts.push(`傳真: ${p.fax}`);
  if (p.email) parts.push(`電郵: ${p.email}`);
  if (ref) parts.push(`參考編號: ${ref}`);
  if (parts.length) return parts.join('  ');
  return p.contact || '';
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
    presenterContact: '',
  });

  // 當 company 變更（開啟對話框時），重新計算結算日期、帶入註冊地址 + Presenter
  useEffect(() => {
    if (company) {
      const preferred = company.preferredPresenterId
        ? presenters.find(p => p.id === company.preferredPresenterId)
        : undefined;
      const refOverride = company.presenterReference || '';
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
        presenterReference: refOverride || preferred?.reference || '',
        presenterContact: preferred ? composePresenterContact(preferred, refOverride) : '',
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
      presenterContact: composePresenterContact(p),
    }));
  };

  const handleReferenceChange = (value: string) => {
    const p = presenters.find(x => x.id === formData.presenterId);
    setFormData(prev => ({
      ...prev,
      presenterReference: value,
      presenterContact: p ? composePresenterContact(p, value) : prev.presenterContact,
    }));
  };

  const handleGenerate = async () => {
    if (!company) return;

    setIsGenerating(true);

    try {
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
        })),
        secretaries: company.secretaries.map(s => ({
          nameChinese: s.nameChinese,
          nameEnglish: s.nameEnglish,
          email: s.email,
          identity: s.identity,
          brNumber: s.brNumber,
          address: s.address || '',
          idNumber: s.idNumber || '',
          dateAppointed: s.dateAppointed || '',
          placeIncorporated: s.placeIncorporated || '',
          companyNumberRef: s.companyNumberRef || '',
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
        })),
        returnDate: formData.returnDate,
        presenter: {
          name: formData.presenterName || '',
          address: formData.presenterAddress || '',
          contact: formData.presenterContact || '',
          reference: formData.presenterReference || '',
        },
      };

      const { data, error } = await supabase.functions.invoke('generate-nar1-pdf', {
        body: payload,
      });

      if (error) throw error;

      // Handle the PDF download
      const blob = new Blob([data], { type: 'application/pdf' });
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                    </div>
                    <div className="ml-8 text-xs text-muted-foreground space-y-0.5">
                      {sh.address && <div>地址：{sh.address}</div>}
                      {sh.shareType && <div>股份類別：{sh.shareType}</div>}
                      {sh.idNumber && <div>證件號碼：{sh.idNumber}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                  <Label className="text-xs">聯絡資訊（自動組成）</Label>
                  <Textarea rows={2} value={formData.presenterContact} onChange={e => setFormData({ ...formData, presenterContact: e.target.value })} />
                </div>
              </div>
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
