import { useState } from 'react';
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
import RelatedFormsPrompt from './RelatedFormsPrompt';
import type { Presenter } from '@/hooks/usePresenters';

interface NN9GeneratorFormProps { onBack: () => void; }

const HK_DISTRICTS = [
  '中西區', '灣仔', '東區', '南區',
  '油尖旺', '深水埗', '九龍城', '黃大仙', '觀塘',
  '葵青', '荃灣', '屯門', '元朗',
  '北區', '大埔', '沙田', '西貢', '離島',
];

export default function NN9GeneratorForm({ onBack }: NN9GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showRelatedPrompt, setShowRelatedPrompt] = useState(false);
  const [relatedLinkages, setRelatedLinkages] = useState<any[]>([]);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '', companyName: '',
    // 新地址
    flat: '', building: '', street: '', district: '', region: '',
    // 新電話 / 新電郵
    newPhone: '', newEmail: '',
    // 更改生效日期
    changeDay: dd, changeMonth: mm, changeYear: yyyy,
    // 決議日期
    resolutionDay: dd, resolutionMonth: mm, resolutionYear: yyyy,
    // 簽署
    signerName: '', signerCapacity: 'Director',
    signDateDay: dd, signDateMonth: mm, signDateYear: yyyy,
    // 提交人
    presentorName: '', presentorAddress: '',
    presentorPhone: '', presentorFax: '', presentorEmail: '', presentorReference: '',
  });

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      const regAddress = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
        .filter(Boolean).join(', ');
      setFormData(prev => ({
        ...prev, brNumber: company.brNumber, companyName: company.name,
        presentorName: company.name, presentorAddress: regAddress,
      }));
    }
  };

  const update = (f: string, v: string) => setFormData(prev => ({ ...prev, [f]: v }));

  const handleLoadHistory = (data: any) => {
    if (data.formData) setFormData((prev: any) => ({ ...prev, ...data.formData }));
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
  };

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    if (!formData.flat && !formData.building && !formData.street) { toast({ title: '錯誤', description: '請填寫新地址', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const fields: Record<string, string> = {
        'fill_1_P.1': formData.brNumber,
        'fill_2_P.1': formData.companyName,
        // 新地址 (P.1)
        'fill_3_P.1': formData.flat || '',
        'fill_4_P.1': formData.building || '',
        'fill_5_P.1': formData.street || '',
        'fill_6_P.1': formData.district || '',
        // 更改生效日期 (P.1, fill_7/8/9 at y=458.8)
        'fill_7_P.1': formData.changeDay,
        'fill_8_P.1': formData.changeMonth,
        'fill_9_P.1': formData.changeYear,
        // (b) 新電郵地址 (P.1, fill_10 at y=504)
        'fill_10_P.1': formData.newEmail || '',
        // 電郵生效日期 (P.1, fill_11/12/13 at y=539.5)
        'fill_11_P.1': formData.resolutionDay,
        'fill_12_P.1': formData.resolutionMonth,
        'fill_13_P.1': formData.resolutionYear,
        // (c) 新香港聯絡電話號碼 (P.1, fill_14 at y=591, 旁有 +852)
        'fill_14_P.1': formData.newPhone || '',
        // 電話生效日期 (P.1, fill_15/16/17 at y=633)
        'fill_15_P.1': formData.signDateDay,
        'fill_16_P.1': formData.signDateMonth,
        'fill_17_P.1': formData.signDateYear,
        // 提交人 (P.1 bottom, y=685~795)
        'fill_18_P.1': formData.presentorName || '',
        'fill_19_P.1': formData.presentorAddress || '',
        'fill_20_P.1': formData.presentorPhone || '',
        'fill_21_P.1': formData.presentorFax || '',
        'fill_22_P.1': formData.presentorEmail || '',
        'fill_23_P.1': formData.presentorReference || '',
        // 簽署人 (P.2, y=646: fill_22=Name, fill_23=Date)
        'fill_22_P.2': formData.signerName || '',
        'fill_23_P.2': formData.signerName ? `${formData.signDateDay}/${formData.signDateMonth}/${formData.signDateYear}` : '',
      };
      // signerCapacity goes as overlay on P.2 (near signer name)
      const overlays: Array<{page: number; text: string; x: number; y: number; fontsize: number}> = [];
      if (formData.signerCapacity) {
        overlays.push({ page: 2, text: formData.signerCapacity, x: 395, y: 635, fontsize: 9 });
      }
      // Debug: log submitter field mapping
      console.log('NN9 submitter fields:', {
        'fill_18': formData.presentorName,
        'fill_19': formData.presentorAddress,
        'fill_20': formData.presentorPhone,
        'fill_21': formData.presentorFax,
        'fill_22': formData.presentorEmail || formData.newEmail,
        'fill_23': formData.presentorReference,
      });
      const resp = await fetch(`/api/generate-template-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          template: 'NN9-template.pdf',
          fields,
          brNumber: formData.brNumber,
          brFields: ['fill_1_P.1', 'fill_1_P.2'],
          keepWidgets: true,
          alignCenterFields: ['fill_10_P.1'],
          alignVCenterFields: ['fill_10_P.1'],
          fieldMinFontSize: { 'fill_19_P.1': 10 },
          forceWidgetAp: ['fill_4_P.1', 'fill_5_P.1', 'fill_10_P.1'],
          overlays,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NN9-form.pdf');
      toast({ title: '生成成功', description: 'NN9 表格已下載' });
      saveFormHistory({ formType: 'NN9', formData: { formData, selectedCompanyId } });

      // Phase 5: Check for related forms
      try {
        const linkResp = await fetch(`/api/form-linkages?primary=NN9`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const linkData = await linkResp.json();
        if (linkData.linkages && linkData.linkages.length > 0) {
          setRelatedLinkages(linkData.linkages);
          setShowRelatedPrompt(true);
        }
      } catch (_) { /* linkage check is non-critical */ }
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NN9 — 註冊非香港公司更改地址申報表</h1><p className="text-sm text-muted-foreground">Return of Change of Address of Registered Non-Hong Kong Company</p></div>
      </div>

      <FormHistorySelector formType="NN9" onSelect={handleLoadHistory} />

      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><Building2 className="h-4 w-4 text-primary" /><Label className="font-medium">選擇公司自動填入</Label></div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
          <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.brNumber})</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <div><h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">新地址</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs text-muted-foreground">室／樓／座 Flat/Block</Label><Input value={formData.flat} onChange={e => update('flat', e.target.value)} placeholder="Room 1001, 10/F" className="mt-1" /></div>
            <div><Label className="text-xs text-muted-foreground">大廈／屋苑 Building/Estate</Label><Input value={formData.building} onChange={e => update('building', e.target.value)} placeholder="ABC Building" className="mt-1" /></div>
            <div className="col-span-2"><Label className="text-xs text-muted-foreground">街道／地段 Street</Label><Input value={formData.street} onChange={e => update('street', e.target.value)} placeholder="1 Queensway" className="mt-1" /></div>
            <div><Label className="text-xs text-muted-foreground">區 District</Label>
              <Select value={formData.district} onValueChange={v => update('district', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="選擇地區" /></SelectTrigger>
                <SelectContent>
                  {HK_DISTRICTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs text-muted-foreground">國家／地區 Country／Region</Label>
              <Input value={formData.region} onChange={e => update('region', e.target.value)} placeholder="e.g. 香港" className="mt-1" />
            </div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">新聯絡資料</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>新香港電話 New HK Tel</Label><Input value={formData.newPhone} onChange={e => update('newPhone', e.target.value)} placeholder="+852 1234 5678" className="mt-1" /></div>
            <div><Label>新電郵地址 New Email</Label><Input value={formData.newEmail} onChange={e => update('newEmail', e.target.value)} placeholder="info@company.com" className="mt-1" /></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div><h3 className="font-semibold mb-3">更改生效日期</h3>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">日 DD</Label><Input value={formData.changeDay} onChange={e => update('changeDay', e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">月 MM</Label><Input value={formData.changeMonth} onChange={e => update('changeMonth', e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">年 YYYY</Label><Input value={formData.changeYear} onChange={e => update('changeYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
          <div><h3 className="font-semibold mb-3">決議日期</h3>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">日 DD</Label><Input value={formData.resolutionDay} onChange={e => update('resolutionDay', e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">月 MM</Label><Input value={formData.resolutionMonth} onChange={e => update('resolutionMonth', e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">年 YYYY</Label><Input value={formData.resolutionYear} onChange={e => update('resolutionYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">簽署</h3>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>簽署人姓名</Label><Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1" /></div>
            <div><Label>身份</Label><Input value={formData.signerCapacity} onChange={e => update('signerCapacity', e.target.value)} className="mt-1" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">日 DD</Label><Input value={formData.signDateDay} onChange={e => update('signDateDay', e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">月 MM</Label><Input value={formData.signDateMonth} onChange={e => update('signDateMonth', e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">年 YYYY</Label><Input value={formData.signDateYear} onChange={e => update('signDateYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">提交人資料</h3>
          <PresenterSelector
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
            <div><Label>姓名／名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div><Label>電話 Tel</Label><Input value={formData.presentorPhone} onChange={e => update('presentorPhone', e.target.value)} className="mt-1" /></div>
            <div><Label>傳真 Fax</Label><Input value={formData.presentorFax} onChange={e => update('presentorFax', e.target.value)} className="mt-1" /></div>
            <div><Label>電郵 Email</Label><Input value={formData.presentorEmail} onChange={e => update('presentorEmail', e.target.value)} className="mt-1" /></div>
            <div><Label>參考編號 Ref</Label><Input value={formData.presentorReference} onChange={e => update('presentorReference', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN9 PDF</>}
          </Button>
        </div>
      </div>

      <RelatedFormsPrompt
        open={showRelatedPrompt}
        onOpenChange={setShowRelatedPrompt}
        primaryFormCode="NN9"
        primaryFormName="NN9 — 非香港公司更改地址申報表"
        primaryFormData={{ ...formData, company_id: selectedCompanyId }}
        companyId={selectedCompanyId}
        companyName={formData.companyName}
        linkages={relatedLinkages}
      />
    </div>
  );
}
