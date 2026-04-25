import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, ArrowRight, Sparkles, Download, Loader2, Search, Bug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCompanies } from '@/hooks/useCompanies';
import { usePresenters } from '@/hooks/usePresenters';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Company } from '@/types';
import { NAR1FormData, createEmptyFormData } from './nar1/types';
import { Page1Company } from './nar1/Page1Company';
import { Page2ShareCapital } from './nar1/Page2ShareCapital';
import { OfficerForm } from './nar1/OfficerForm';
import { ShareholderForm } from './nar1/ShareholderForm';

interface FormWizardProps {
  formId: string;
  onBack: () => void;
}

const steps = [
  { id: 1, label: '選擇公司', short: '公司' },
  { id: 2, label: '公司基本資料', short: 'P1' },
  { id: 3, label: '股本資料', short: 'P2' },
  { id: 4, label: '公司秘書', short: '秘書' },
  { id: 5, label: '董事', short: '董事' },
  { id: 6, label: '股東', short: '股東' },
  { id: 7, label: '確認及生成', short: '生成' },
];

function companyToFormData(company: Company): NAR1FormData {
  const base = createEmptyFormData(company.incorporationDate);
  base.companyName = company.name;
  base.chineseName = company.chineseName || '';
  base.brNumber = company.brNumber;
  base.tradingName = company.tradingName;
  base.businessCode = company.businessCode;
  base.businessNature = company.businessNature;
  base.regFlat = company.regFlat || '';
  base.regBuilding = company.regBuilding || '';
  base.regStreet = company.regStreet || '';
  base.regDistrict = company.regDistrict || '';
  base.regRegion = company.regRegion || '香港 Hong Kong';

  if (company.companyType?.includes('私人') || company.companyType?.includes('Private')) {
    base.companyType = 'private';
  } else if (company.companyType?.includes('公眾') || company.companyType?.includes('Public')) {
    base.companyType = 'public';
  } else if (company.companyType?.includes('擔保') || company.companyType?.includes('Guarantee')) {
    base.companyType = 'guarantee';
  }

  const regAddress = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion].filter(Boolean).join(', ');

  base.secretaries = company.secretaries.map(s => ({
    identity: s.identity,
    nameChinese: s.nameChinese || '',
    nameEnglish: s.nameEnglish || '',
    formerNameChinese: '',
    formerNameEnglish: '',
    idNumber: s.idNumber || '',
    address: s.address || regAddress,
    dateAppointed: s.dateAppointed || '',
    dateCeased: s.dateCeased || '',
    placeIncorporated: s.placeIncorporated || '',
    companyNumberRef: s.companyNumberRef || '',
  }));
  if (base.secretaries.length === 0) base.secretaries = [createEmptyFormData().secretaries[0]];

  base.directors = company.directors.map(d => ({
    identity: d.identity,
    nameChinese: d.nameChinese || '',
    nameEnglish: d.nameEnglish || '',
    formerNameChinese: '',
    formerNameEnglish: '',
    idNumber: d.idNumber || '',
    address: d.address || regAddress,
    dateAppointed: d.dateAppointed || '',
    dateCeased: d.dateCeased || '',
    placeIncorporated: d.placeIncorporated || '',
    companyNumberRef: d.companyNumberRef || '',
  }));
  if (base.directors.length === 0) base.directors = [createEmptyFormData().directors[0]];

  base.shareholders = company.shareholders.map(sh => ({
    identity: sh.identity,
    nameChinese: sh.nameChinese || '',
    nameEnglish: sh.nameEnglish || '',
    idNumber: sh.idNumber || '',
    address: sh.address || regAddress,
    shares: String(sh.shares || ''),
    shareClass: sh.shareType || 'Ordinary 普通股',
    currency: 'HKD',
    paidUp: String(sh.shares || ''),
  }));
  if (base.shareholders.length === 0) base.shareholders = [createEmptyFormData().shareholders[0]];

  // Aggregate share capital from shareholders
  const shareMap = new Map<string, number>();
  company.shareholders.forEach(sh => {
    const cls = sh.shareType || 'Ordinary 普通股';
    shareMap.set(cls, (shareMap.get(cls) || 0) + sh.shares);
  });
  if (shareMap.size > 0) {
    base.shareCapital = Array.from(shareMap.entries()).map(([cls, total]) => ({
      shareClass: cls,
      currency: 'HKD',
      shares: String(total),
      paidUp: String(total),
    }));
  }

  return base;
}

const FormWizard = ({ formId, onBack }: FormWizardProps) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<NAR1FormData>(createEmptyFormData());
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);

  const { data: companies = [] } = useCompanies();
  const { data: presenters = [] } = usePresenters();

  const filteredCompanies = useMemo(() => {
    if (!searchTerm) return companies.slice(0, 20);
    const q = searchTerm.toLowerCase();
    return companies.filter(c =>
      c.name.toLowerCase().includes(q) || c.brNumber?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [companies, searchTerm]);

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

  const handleSelectCompany = (company: Company) => {
    setSelectedCompanyId(company.id);
    const next = companyToFormData(company);
    // Auto-pick the company's preferred presenter, if any
    const preferred = company.preferredPresenterId
      ? presenters.find(p => p.id === company.preferredPresenterId)
      : undefined;
    if (preferred) {
      const refOverride = company.presenterReference || '';
      next.presenterId = preferred.id;
      next.presenterName = preferred.name;
      next.presenterAddress = preferred.address || '';
      next.presenterReference = refOverride || preferred.reference || '';
      next.presenterContact = composePresenterContact(preferred, refOverride);
    }
    setFormData(next);
    toast({ title: '已載入公司資料', description: `${company.name} 的資料已自動填入表格` });
  };

  const handlePickPresenter = (id: string) => {
    const p = presenters.find(x => x.id === id);
    if (!p) return;
    setFormData({
      ...formData,
      presenterId: p.id,
      presenterName: p.name,
      presenterAddress: p.address || '',
      presenterReference: p.reference || '',
      presenterContact: composePresenterContact(p),
    });
  };

  const handleReferenceChange = (value: string) => {
    const p = presenters.find(x => x.id === formData.presenterId);
    setFormData({
      ...formData,
      presenterReference: value,
      presenterContact: p ? composePresenterContact(p, value) : formData.presenterContact,
    });
  };

  const buildPayload = (debugMode = false) => ({
    debugMode,
    name: formData.companyName,
    chineseName: formData.chineseName,
    brNumber: formData.brNumber,
    tradingName: formData.tradingName,
    businessNature: formData.businessNature,
    businessCode: formData.businessCode,
    companyType: formData.companyType === 'private' ? '私人公司 Private company'
      : formData.companyType === 'public' ? '公眾公司 Public company'
      : '擔保有限公司 Company limited by guarantee',
    registeredOffice: {
      flat: formData.regFlat,
      building: formData.regBuilding,
      street: formData.regStreet,
      district: formData.regDistrict,
      region: formData.regRegion,
    },
    directors: formData.directors.map(d => ({
      nameChinese: d.nameChinese,
      nameEnglish: d.nameEnglish,
      identity: d.identity,
      address: d.address,
      idNumber: d.idNumber,
      dateAppointed: d.dateAppointed,
      placeIncorporated: d.placeIncorporated,
      companyNumberRef: d.companyNumberRef,
      email: '',
      brNumber: '',
    })),
    secretaries: formData.secretaries.map(s => ({
      nameChinese: s.nameChinese,
      nameEnglish: s.nameEnglish,
      identity: s.identity,
      address: s.address,
      idNumber: s.idNumber,
      dateAppointed: s.dateAppointed,
      placeIncorporated: s.placeIncorporated,
      companyNumberRef: s.companyNumberRef,
      email: '',
      brNumber: '',
    })),
    shareholders: formData.shareholders.map(sh => ({
      name: sh.nameEnglish || sh.nameChinese,
      nameEnglish: sh.nameEnglish,
      nameChinese: sh.nameChinese,
      shares: parseInt(sh.shares) || 0,
      identity: sh.identity,
      idNumber: sh.idNumber,
      address: sh.address,
      shareType: sh.shareClass,
    })),
    returnDate: `${formData.returnDateYear}-${formData.returnDateMonth}-${formData.returnDateDay}`,
    presenter: {
      name: formData.presenterName || '',
      address: formData.presenterAddress || '',
      contact: formData.presenterContact || '',
      phone: formData.presenterPhone || '',
      fax: formData.presenterFax || '',
      email: formData.presenterEmail || '',
      reference: formData.presenterReference || '',
    },
  });

  const downloadPdfFromInvoke = async (data: any, filename: string) => {
    let blob: Blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data instanceof ArrayBuffer) {
      blob = new Blob([data], { type: 'application/pdf' });
    } else if (data && typeof data === 'object' && data.pdf) {
      const bin = atob(data.pdf);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: 'application/pdf' });
    } else {
      blob = new Blob([data], { type: 'application/pdf' });
    }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const handleGenerate = async (debugMode = false) => {
    const setLoading = debugMode ? setIsDebugging : setIsGenerating;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-nar1-pdf', { body: buildPayload(debugMode) });
      if (error) throw error;
      const filename = debugMode
        ? `NAR1_DEBUG_${formData.brNumber || 'preview'}.pdf`
        : `NAR1_${formData.brNumber}_${formData.companyName}.pdf`;
      await downloadPdfFromInvoke(data, filename);
      toast({ title: debugMode ? 'Debug PDF 已生成' : 'PDF 已生成', description: debugMode ? '請查看每個欄位的編號並回報需修正的位置' : 'NAR1 表格已成功生成' });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({ title: '生成失敗', description: error instanceof Error ? error.message : '無法生成 PDF', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const totalSteps = steps.length;
  const progress = (currentStep / totalSteps) * 100;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">建立 NAR1 周年申報表</h1>
        <p className="text-sm text-muted-foreground">填寫完整 NAR1 表格資料並生成 PDF</p>
      </div>

      {/* Navigation */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-2 mb-4">
          {steps.map(step => (
            <Button
              key={step.id}
              variant={currentStep === step.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCurrentStep(step.id)}
              className={cn(currentStep === step.id && 'bg-primary text-primary-foreground')}
            >
              {step.short}
            </Button>
          ))}
        </div>
        <div className="flex items-center justify-between text-sm mb-1">
          <span>{steps[currentStep - 1]?.label}</span>
          <span>{currentStep} / {totalSteps}</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Form Content */}
      <div className="bg-card border border-border rounded-lg p-6">
        {currentStep === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">選擇公司以自動填入資料</h2>
            <p className="text-sm text-muted-foreground">選擇現有公司將自動填入所有已知資料，您也可以跳過此步驟手動填寫。</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋公司名稱或編號..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-80 overflow-y-auto space-y-1">
              {filteredCompanies.map(c => (
                <div
                  key={c.id}
                  onClick={() => handleSelectCompany(c)}
                  className={cn(
                    'p-3 rounded-lg cursor-pointer transition-colors border',
                    selectedCompanyId === c.id
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:bg-muted/50'
                  )}
                >
                  <div className="font-medium text-sm">{c.name}</div>
                  <div className="text-xs text-muted-foreground flex gap-3">
                    <span>編號：{c.brNumber}</span>
                    <span>董事：{c.directors.length}</span>
                    <span>秘書：{c.secretaries.length}</span>
                    <span>股東：{c.shareholders.length}</span>
                  </div>
                </div>
              ))}
              {filteredCompanies.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">找不到公司</p>
              )}
            </div>
            <Button variant="outline" onClick={() => setCurrentStep(2)}>
              跳過，手動填寫 →
            </Button>
          </div>
        )}

        {currentStep === 2 && <Page1Company data={formData} onChange={setFormData} />}
        {currentStep === 3 && <Page2ShareCapital data={formData} onChange={setFormData} />}
        {currentStep === 4 && (
          <OfficerForm
            title="公司秘書"
            pageLabel="第 3-4 頁"
            officers={formData.secretaries}
            onChange={secs => setFormData({ ...formData, secretaries: secs })}
          />
        )}
        {currentStep === 5 && (
          <OfficerForm
            title="董事"
            pageLabel="第 5-6 頁"
            officers={formData.directors}
            onChange={dirs => setFormData({ ...formData, directors: dirs })}
          />
        )}
        {currentStep === 6 && (
          <ShareholderForm
            shareholders={formData.shareholders}
            onChange={shs => setFormData({ ...formData, shareholders: shs })}
          />
        )}
        {currentStep === 7 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">確認並生成 PDF</h2>
            <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">公司名稱：</span>{formData.companyName}</div>
                <div><span className="text-muted-foreground">編號：</span>{formData.brNumber}</div>
                <div><span className="text-muted-foreground">結算日期：</span>{formData.returnDateDay}/{formData.returnDateMonth}/{formData.returnDateYear}</div>
                <div><span className="text-muted-foreground">業務性質：</span>{formData.businessNature}</div>
              </div>

              <div className="border-t border-border pt-2">
                <div className="font-medium mb-1">秘書 ({formData.secretaries.length})</div>
                {formData.secretaries.map((s, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    {i + 1}. {s.nameEnglish || s.nameChinese} ({s.identity === 'natural' ? '自然人' : '法人'})
                    {s.idNumber && ` — ${s.idNumber}`}
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-2">
                <div className="font-medium mb-1">董事 ({formData.directors.length})</div>
                {formData.directors.map((d, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    {i + 1}. {d.nameEnglish || d.nameChinese} ({d.identity === 'natural' ? '自然人' : '法人'})
                    {d.idNumber && ` — ${d.idNumber}`}
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-2">
                <div className="font-medium mb-1">股東 ({formData.shareholders.length})</div>
                {formData.shareholders.map((sh, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    {i + 1}. {sh.nameEnglish || sh.nameChinese} — {sh.shares} 股 ({sh.shareClass})
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-2">
                <div className="font-medium mb-1">股本 ({formData.shareCapital.length} 類)</div>
                {formData.shareCapital.map((sc, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    {sc.shareClass}: {sc.shares} 股, {sc.currency} {sc.paidUp}
                  </div>
                ))}
              </div>

              {formData.regStreet && (
                <div className="border-t border-border pt-2">
                  <div className="font-medium mb-1">註冊地址</div>
                  <div className="text-xs text-muted-foreground">
                    {[formData.regFlat, formData.regBuilding, formData.regStreet, formData.regDistrict, formData.regRegion].filter(Boolean).join(', ')}
                  </div>
                </div>
              )}
            </div>

            {/* Presenter section */}
            <div className="space-y-3 border border-border rounded-lg p-4">
              <h3 className="text-sm font-semibold">提交人 Presenter</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">選擇預設提交人</Label>
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
                  <Input value={formData.presenterName || ''} onChange={e => setFormData({ ...formData, presenterName: e.target.value })} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">地址</Label>
                  <Textarea rows={2} value={formData.presenterAddress || ''} onChange={e => setFormData({ ...formData, presenterAddress: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">參考編號 Reference（可即時編輯覆寫）</Label>
                  <Input
                    value={formData.presenterReference || ''}
                    onChange={e => handleReferenceChange(e.target.value)}
                    placeholder="例如 TS-2026-001"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">聯絡資訊（自動由電話／傳真／電郵／參考編號組成）</Label>
                  <Textarea rows={2} value={formData.presenterContact || ''} onChange={e => setFormData({ ...formData, presenterContact: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">在「設定」頁面可管理提交人列表</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => handleGenerate(true)}
                disabled={isDebugging || isGenerating}
                variant="outline"
                size="lg"
              >
                {isDebugging ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Debug 中...</>
                ) : (
                  <><Bug className="h-4 w-4 mr-2" /> Debug：印出欄位編號</>
                )}
              </Button>
              <Button
                onClick={() => handleGenerate(false)}
                disabled={isGenerating || isDebugging}
                className="bg-primary text-primary-foreground"
                size="lg"
              >
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 生成中...</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" /> 生成 NAR1 PDF</>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentStep(prev => Math.max(prev - 1, 1))}
          disabled={currentStep === 1}
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> 上一步
        </Button>
        {currentStep < totalSteps && (
          <Button
            className="bg-primary text-primary-foreground"
            onClick={() => setCurrentStep(prev => Math.min(prev + 1, totalSteps))}
          >
            下一步 <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default FormWizard;
