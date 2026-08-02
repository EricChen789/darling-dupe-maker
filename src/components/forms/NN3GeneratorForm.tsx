import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import type { Presenter } from '@/hooks/usePresenters';

interface NN3GeneratorFormProps { onBack: () => void; }

export default function NN3GeneratorForm({ onBack }: NN3GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );

  const [formData, setFormData] = useState({
    companyNameEnglish: '', companyNameChinese: '',
    // Section 2: Date of this Return
    returnDay: '', returnMonth: '', returnYear: '',
    // Section 3: Date of Registration
    regDay: '', regMonth: '', regYear: '',
    // Section 4: Place of Incorporation
    placeOfIncorporation: '',
    // Section 5(a): Address of Principal Place of Business in HK
    flat: '', building: '', street: '', district: '', region: '',
    // Section 5(b)(c): Email & Phone
    email: '', phone: '',
    // Directors & Secretary & Shareholders (P.2-P.3)
    directors: '',
    secretary: '',
    shareholders: '',
    // Presentor (P.1 bottom)
    presentorName: '', presentorAddress: '',
    presentorPhone: '', presentorFax: '', presentorEmail: '', presentorReference: '',
    brNumber: '',
  });

  const update = (f: string, v: string) => setFormData(prev => ({ ...prev, [f]: v }));

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      const regAddress = [
        company.regFlat, company.regBuilding, company.regStreet,
        company.regDistrict, company.regRegion,
      ].filter(Boolean).join(', ');
      setFormData(prev => ({
        ...prev,
        brNumber: company.brNumber || prev.brNumber,
        companyNameEnglish: company.name || '',
        companyNameChinese: company.chineseName || '',
        presentorName: company.name || '',
        presentorAddress: regAddress || prev.presentorAddress,
        presentorPhone: company.phone || '',
        presentorEmail: company.email || '',
        presentorReference: company.presenterReference || '',
      }));
    }
  };

  const handleLoadHistory = (data: any) => {
    if (data.formData) setFormData((prev: any) => ({ ...prev, ...data.formData }));
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
  };

  const handleGenerate = async () => {
    if (!formData.companyNameEnglish) { toast({ title: '錯誤', description: '請填寫公司英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const regionFull = formData.region || '';

      const fields: Record<string, string> = {
        // P.1 — Company Name
        'fill_2_P.1': formData.companyNameEnglish,              // 公司名稱 (英文)
        // Section 2: Date of this Return D/M/Y
        'fill_3_P.1': formData.returnDay || '',
        'fill_4_P.1': formData.returnMonth || '',
        'fill_5_P.1': formData.returnYear || '',
        // Section 3: Date of Registration D/M/Y
        'fill_6_P.1': formData.regDay || '',
        'fill_7_P.1': formData.regMonth || '',
        'fill_8_P.1': formData.regYear || '',
        // Section 4: Place of Incorporation
        'fill_9_P.1': formData.placeOfIncorporation || '',
        // Section 5(a): Address
        'fill_10_P.1': formData.flat || '',
        'fill_11_P.1': formData.building || '',
        'fill_12_P.1': formData.street || '',
        'fill_13_P.1': (formData.district || '') + (formData.district && regionFull ? ', ' : '') + regionFull,
        // Section 5(b)(c): Email & Phone
        'fill_14_P.1': formData.email || '',
        'fill_15_P.1': formData.phone || '',
        // Presentor (except Name — handled via overlays for lower positioning)
        'fill_17_P.1': formData.presentorAddress || '',
        'fill_18_P.1': formData.presentorPhone || '',
        'fill_19_P.1': formData.presentorFax || '',
        'fill_20_P.1': formData.presentorEmail || '',
        'fill_21_P.1': formData.presentorReference || '',
      };

      // P.2 — Directors, Secretary, Shareholders
      if (formData.directors) {
        fields['fill_2_P.2'] = formData.directors;
      }
      if (formData.secretary) {
        fields['fill_3_P.2'] = formData.secretary;
      }
      if (formData.shareholders) {
        fields['fill_4_P.2'] = formData.shareholders;
      }

      // Overlays: presentor name drawn via page overlay for lower positioning
      // fill_16_P.1 widget bbox is y=708.8-723.1 (h≈14pt), w.update() puts
      // baseline at ~y=3.6 from bottom → text appears too high. Use overlay
      // at y=716 (page coords) to place name closer to the Address line.
      const overlays: Array<{page: number; text: string; x: number; y: number; fontsize: number}> = [];
      if (formData.presentorName) {
        overlays.push({
          page: 0,
          text: formData.presentorName,
          x: 156,
          y: 714,
          fontsize: 8,
        });
      }

      const resp = await fetch(`/api/generate-template-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          template: 'NN3-template.pdf',
          fields,
          overlays: overlays.length > 0 ? overlays : undefined,
          brNumber: formData.brNumber || undefined,
          // NN3 fill_1_P.{n} ARE real BR widgets (labeled "Business Registration Number")
          keepWidgets: true,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      if (result.warnings) {
        console.warn('NN3 field warnings:', result.warnings);
      }
      downloadBase64Pdf(result.pdf, 'NN3-form.pdf');
      toast({ title: '生成成功', description: 'NN3 表格已下載' });
      saveFormHistory({ formType: 'NN3', formData: { formData, selectedCompanyId } });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  // Helper: date string for <input type="date">
  const makeDateValue = (y: string, m: string, d: string) => {
    if (y && m && d) {
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return '';
  };

  const parseDate = (v: string, setter: (d: string, m: string, y: string) => void) => {
    if (v) {
      const [y, m, d] = v.split('-');
      setter(d, m, y);
    } else {
      setter('', '', '');
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NN3 — 註冊非香港公司周年申報表</h1><p className="text-sm text-muted-foreground">Annual Return of Registered Non-Hong Kong Company</p></div>
      </div>

      <FormHistorySelector formType="NN3" onSelect={handleLoadHistory} />

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* Company Selector */}
        <div className="bg-muted/30 border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">選擇現有公司（自動填充）</h3>
          </div>
          <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="— 選擇公司 —" />
            </SelectTrigger>
            <SelectContent>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}{c.chineseName ? ` (${c.chineseName})` : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Section 1: Company Name */}
        <div><h3 className="font-semibold mb-3">1. 公司名稱 Company Name</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>英文名稱 *</Label><Input value={formData.companyNameEnglish} onChange={e => update('companyNameEnglish', e.target.value)} placeholder="e.g. ABC Limited" className="mt-1" /></div>
            <div><Label>中文名稱</Label><Input value={formData.companyNameChinese} onChange={e => update('companyNameChinese', e.target.value)} placeholder="e.g. 甲乙丙有限公司" className="mt-1" /></div>
          </div>
        </div>

        {/* Section 2: Date of this Return */}
        <div><h3 className="font-semibold mb-3">2. 本申報表的日期 Date of this Return</h3>
          <p className="text-xs text-muted-foreground mb-3">最近周年日 The Most Recent Anniversary of the Date of Registration</p>
          <div>
            <Label>日期</Label>
            <Input
              type="date"
              value={makeDateValue(formData.returnYear, formData.returnMonth, formData.returnDay)}
              onChange={e => parseDate(e.target.value, (d, m, y) => {
                setFormData(prev => ({ ...prev, returnDay: d, returnMonth: m, returnYear: y }));
              })}
              className="mt-1 max-w-xs"
            />
          </div>
        </div>

        {/* Section 3: Date of Registration */}
        <div><h3 className="font-semibold mb-3">3. 註冊日期 Date of Registration</h3>
          <p className="text-xs text-muted-foreground mb-3">根據《公司條例》第16部或《前身條例》第XI部的註冊日期</p>
          <div>
            <Label>日期</Label>
            <Input
              type="date"
              value={makeDateValue(formData.regYear, formData.regMonth, formData.regDay)}
              onChange={e => parseDate(e.target.value, (d, m, y) => {
                setFormData(prev => ({ ...prev, regDay: d, regMonth: m, regYear: y }));
              })}
              className="mt-1 max-w-xs"
            />
          </div>
        </div>

        {/* Section 4: Place of Incorporation */}
        <div><h3 className="font-semibold mb-3">4. 成立為法團所在地方 Place of Incorporation</h3>
          <div className="max-w-md">
            <Input value={formData.placeOfIncorporation} onChange={e => update('placeOfIncorporation', e.target.value)} placeholder="e.g. British Virgin Islands / 英屬維爾京群島" className="mt-1" />
          </div>
        </div>

        {/* Section 5(a): Address */}
        <div><h3 className="font-semibold mb-3">5(a). 香港主要營業地點地址 Address of Principal Place of Business in HK</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>室／樓／座 Flat／Floor／Block</Label><Input value={formData.flat} onChange={e => update('flat', e.target.value)} className="mt-1" /></div>
            <div><Label>大廈 Building</Label><Input value={formData.building} onChange={e => update('building', e.target.value)} className="mt-1" /></div>
            <div><Label>街道／屋苑／地段 Street／Estate／Lot</Label><Input value={formData.street} onChange={e => update('street', e.target.value)} className="mt-1" /></div>
            <div><Label>區 District</Label><Input value={formData.district} onChange={e => update('district', e.target.value)} placeholder="e.g. 旺角 Mong Kok" className="mt-1" /></div>
            <div><Label>國家／地區 Country／Region</Label>
              <Input value={formData.region} onChange={e => update('region', e.target.value)} placeholder="e.g. 香港" className="mt-1" />
            </div>
          </div>
        </div>

        {/* Section 5(b)(c): Email & Phone */}
        <div><h3 className="font-semibold mb-3">5(b)(c). 聯絡資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>電郵地址 Email Address</Label><Input value={formData.email} onChange={e => update('email', e.target.value)} placeholder="e.g. info@company.com" className="mt-1" /></div>
            <div><Label>香港聯絡電話號碼 +852</Label><Input value={formData.phone} onChange={e => update('phone', e.target.value)} placeholder="e.g. 12345678" className="mt-1" /></div>
          </div>
        </div>

        {/* Directors & Secretary & Shareholders */}
        <div><h3 className="font-semibold mb-3">董事、公司秘書及股東</h3>
          <p className="text-xs text-muted-foreground mb-3">填入 P.2-P.3 續頁（如需詳細逐人填報，可後續擴充）</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Label>董事 Directors（以逗號分隔）</Label><Input value={formData.directors} onChange={e => update('directors', e.target.value)} placeholder="e.g. CHAN Tai Man, LEE Siu Wa" className="mt-1" /></div>
            <div className="col-span-2"><Label>公司秘書 Company Secretary（以逗號分隔）</Label><Input value={formData.secretary} onChange={e => update('secretary', e.target.value)} placeholder="e.g. WONG Mei Ling" className="mt-1" /></div>
            <div className="col-span-2"><Label>股東／創辦成員 Shareholders（以逗號分隔）</Label><Input value={formData.shareholders} onChange={e => update('shareholders', e.target.value)} placeholder="e.g. ABC Holdings Ltd (100股)" className="mt-1" /></div>
          </div>
        </div>

        {/* Presentor */}
        <div><h3 className="font-semibold mb-3">提交人資料 Presentor's Reference</h3>
          {selectedCompany && <p className="text-xs text-primary mb-3">已從 {selectedCompany.name} 自動填入，可修改</p>}
          <PresenterSelector companyId={selectedCompanyId}
            currentData={{ name: formData.presentorName, address: formData.presentorAddress, phone: formData.presentorPhone, fax: formData.presentorFax, email: formData.presentorEmail, reference: formData.presentorReference }}
            onSelect={(p: Presenter) => {
              update('presentorName', p.name);
              update('presentorAddress', p.address);
              update('presentorPhone', p.phone);
              update('presentorFax', p.fax);
              update('presentorEmail', p.email);
              update('presentorReference', p.reference);
            }}
          />
          <div className="grid grid-cols-2 gap-4">
            <div><Label>姓名／名稱 Name</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>地址 Address</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div><Label>電話 Tel</Label><Input value={formData.presentorPhone} onChange={e => update('presentorPhone', e.target.value)} className="mt-1" /></div>
            <div><Label>傳真 Fax</Label><Input value={formData.presentorFax} onChange={e => update('presentorFax', e.target.value)} className="mt-1" /></div>
            <div><Label>電郵 Email</Label><Input value={formData.presentorEmail} onChange={e => update('presentorEmail', e.target.value)} className="mt-1" /></div>
            <div><Label>檔號 Reference</Label><Input value={formData.presentorReference} onChange={e => update('presentorReference', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* BR Number */}
        <div><h3 className="font-semibold mb-3">商業登記號碼</h3>
          <div className="max-w-xs"><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} placeholder="e.g. 07281051" className="mt-1" /></div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN3 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
