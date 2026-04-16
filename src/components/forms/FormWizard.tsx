import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ArrowRight, Sparkles, Download, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCompanies } from '@/hooks/useCompanies';
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
  const base = createEmptyFormData();
  base.companyName = company.name;
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

  base.secretaries = company.secretaries.map(s => ({
    identity: s.identity,
    nameChinese: s.nameChinese || '',
    nameEnglish: s.nameEnglish || '',
    formerNameChinese: '',
    formerNameEnglish: '',
    idNumber: s.idNumber || '',
    address: s.address || '',
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
    address: d.address || '',
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
    address: sh.address || '',
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

  const { data: companies = [] } = useCompanies();

  const filteredCompanies = useMemo(() => {
    if (!searchTerm) return companies.slice(0, 20);
    const q = searchTerm.toLowerCase();
    return companies.filter(c =>
      c.name.toLowerCase().includes(q) || c.brNumber?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [companies, searchTerm]);

  const handleSelectCompany = (company: Company) => {
    setSelectedCompanyId(company.id);
    setFormData(companyToFormData(company));
    toast({ title: '已載入公司資料', description: `${company.name} 的資料已自動填入表格` });
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const payload = {
        name: formData.companyName,
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
      };

      const { data, error } = await supabase.functions.invoke('generate-nar1-pdf', { body: payload });
      if (error) throw error;

      const blob = new Blob([data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `NAR1_${formData.brNumber}_${Date.now()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({ title: 'PDF 已生成', description: 'NAR1 表格已成功生成並下載' });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({ title: '生成失敗', description: error instanceof Error ? error.message : '無法生成 PDF', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
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

            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full bg-primary text-primary-foreground"
              size="lg"
            >
              {isGenerating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 生成中...</>
              ) : (
                <><Download className="h-4 w-4 mr-2" /> 生成並下載 NAR1 PDF</>
              )}
            </Button>
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
