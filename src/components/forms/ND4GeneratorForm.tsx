import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { postJson, sleep, safeFileName, parseEnglishName } from '@/lib/formGen';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import type { Presenter } from '@/hooks/usePresenters';
import PersonQuickPick from './PersonQuickPick';
import AddressQuickPick from './AddressQuickPick';

interface ND4GeneratorFormProps {
  onBack: () => void;
  initialCompanyId?: string;
  /** 頂部互鏈：切換到對方表單（帶當前公司 id 保留選擇） */
  onNavigate?: (formKey: string, companyId?: string) => void;
}

export default function ND4GeneratorForm({ onBack, initialCompanyId, onNavigate }: ND4GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '', companyName: '',
    officerType: 'director' as 'director' | 'secretary' | 'alternate',
    officerNameChinese: '', officerNameEnglish: '',
    identity: 'natural' as 'natural' | 'corporate',
    hkidPartial: '', passportCountry: '', passportPartial: '',
    resignationDay: '', resignationMonth: '', resignationYear: '',
    signerName: '', signerCapacity: '',
    signDateDay: dd, signDateMonth: mm, signDateYear: yyyy,
    presentorName: '', presentorAddress: '', presentorPhone: '', presentorFax: '', presentorEmail: '', presentorReference: '',
  });

  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      const regAddress = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
        .filter(Boolean).join(', ');
      setFormData(prev => ({
        ...prev,
        brNumber: company.brNumber,
        companyName: company.name,
        presentorName: company.name,
        presentorAddress: regAddress,
      }));
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  const handleOfficerSelect = (type: 'director' | 'secretary' | 'alternate', index: number) => {
    const officers = type === 'director' ? selectedCompany?.directors : selectedCompany?.secretaries;
    const officer = officers?.[index];
    if (officer) {
      setFormData(prev => ({
        ...prev, officerType: type,
        officerNameChinese: officer.nameChinese || '',
        officerNameEnglish: officer.nameEnglish || '',
        identity: officer.identity || 'natural',
        hkidPartial: officer.hkidPartial || '',
        passportCountry: officer.passportCountry || '',
        passportPartial: officer.passportPartial || '',
      }));
    }
  };

  const update = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleLoadHistory = (data: any) => {
    if (data.formData) setFormData((prev: any) => ({ ...prev, ...data.formData }));
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
  };

  // ── 現有 ND4 生成（模板路徑 /api/generate-template-pdf），抽出供單獨/一併複用 ──
  const generateNd4Once = async (): Promise<void> => {
    // Parse English name into surname + other names (matching _parse_english_name logic)
    const engName = (formData.officerNameEnglish || '').replace(/\s+/g, ' ').trim();
    const { surname, otherNames } = parseEnglishName(engName);

    // ND4 template AcroForm field mapping (verified against template labels 2026-07-30):
    //   fill_3="代替 Alternate to"  fill_4=中文姓名  fill_5=英文姓氏  fill_6=英文名字
    //   fill_7=HKID號碼  fill_8=護照簽發國  fill_9=法人公司名  fill_10=法人公司編號
    //   fill_11/12/13=辭職日期D/M/Y  fill_14=提交人姓名  fill_15=提交人地址
    //   fill_16=電話  fill_17=傳真  fill_18=電郵  fill_19=參考編號
    const fields: Record<string, string> = {
      'fill_1_P.1': formData.brNumber,
      'fill_2_P.1': formData.companyName,
      // Officer details: fill_4=中文姓名, fill_5=英文姓氏, fill_6=英文名字
      'fill_4_P.1': formData.officerNameChinese || '',
      'fill_5_P.1': surname,
      'fill_6_P.1': otherNames,
      // Identity documents
      'fill_7_P.1': formData.hkidPartial || '',
      'fill_8_P.1': formData.passportCountry || '',
      'fill_8b_P.1': formData.passportPartial || '',
      // Resignation effective date (fill_11/12/13 = 辭職日期 D/M/Y)
      'fill_11_P.1': formData.resignationDay,
      'fill_12_P.1': formData.resignationMonth,
      'fill_13_P.1': formData.resignationYear,
      // Signer
      'fill_9_P.1': formData.signerName || '',
      'fill_10_P.1': formData.signerCapacity || '',
      // Presentor section
      'fill_14_P.1': formData.presentorName || '',
      'fill_15_P.1': formData.presentorAddress || '',
      'fill_16_P.1': formData.presentorPhone || '',
      'fill_17_P.1': formData.presentorFax || '',
      'fill_18_P.1': formData.presentorEmail || '',
      'fill_19_P.1': formData.presentorReference || '',
      // P.2: BR + Signing section (fill_2=Name, fill_3=Date DD/MM/YYYY)
      'fill_1_P.2': formData.brNumber || '',
      'fill_2_P.2': formData.signerName || formData.presentorName || '',
      'fill_3_P.2': `${formData.signDateDay}/${formData.signDateMonth}/${formData.signDateYear}`,
    };
    // fill_3 = "代替 Alternate to" — only fill when alternate director selected
    if (formData.officerType === 'alternate') {
      fields['fill_3_P.1'] = formData.officerNameEnglish || '';
    }
    const checkboxes: string[] = [];
    // P.1: "是否仍然擔任" — 辭任必然是「否」(toggle_5_P.1 = No)
    checkboxes.push('toggle_5_P.1');
    // P.2: Officer role checkboxes
    if (formData.officerType === 'director') checkboxes.push('cb_1_P.2');
    else if (formData.officerType === 'alternate') checkboxes.push('cb_2_P.2');
    else if (formData.officerType === 'secretary') checkboxes.push('cb_3_P.2');

    const result = await postJson('/api/generate-template-pdf', {
      template: 'ND4-template.pdf', fields, checkboxes, brNumber: formData.brNumber,
      keepWidgets: true, removePages: [5, 4, 3, 2],
      alignCenterFields: ['fill_4_P.1'], fieldMinFontSize: { 'fill_15_P.1': 10 },
    });
    if (!result.pdf) throw new Error('No data in response');
    downloadBase64Pdf(result.pdf, 'ND4-form.pdf');
  };

  // ── 由 ND4 表單資料構建 ND2A payload（單一辭任人，專用端點） ──
  const buildNd2aPayloadFromForm = () => {
    const engFull = (formData.officerNameEnglish || '').replace(/\s+/g, ' ').trim();
    const { surname, otherNames } = parseEnglishName(engFull);
    const hasResignDate = formData.resignationDay && formData.resignationMonth && formData.resignationYear;
    const officer: any = {
      type: 'cessation',
      role: formData.officerType,
      identity: formData.identity,
      nameEnglish: engFull,
      nameSurname: surname,
      nameOtherNames: otherNames,
      nameChinese: formData.officerNameChinese,
      idNumber: formData.hkidPartial,
      dateCeased: hasResignDate
        ? `${formData.resignationYear}-${String(formData.resignationMonth).padStart(2, '0')}-${String(formData.resignationDay).padStart(2, '0')}`
        : '',
      cessationReason: 'resignation',
      stillHoldsOffice: 'no',
    };
    if (formData.identity === 'natural') {
      officer.passportCountry = formData.passportCountry;
      officer.passportNumber = formData.passportPartial;
      if (formData.officerType === 'alternate') officer.alternateTo = engFull;
    } else {
      officer.companyName = engFull;
      officer.companyNumber = formData.hkidPartial;
      officer.placeIncorporated = 'Hong Kong';
    }
    const signDate = `${formData.signDateYear}-${String(formData.signDateMonth).padStart(2, '0')}-${String(formData.signDateDay).padStart(2, '0')}`;
    return {
      brNumber: formData.brNumber,
      companyName: formData.companyName,
      officers: [officer],
      signerName: formData.signerName || formData.presentorName,
      signerCapacity: formData.signerCapacity || 'director',
      signDate,
      presentorName: formData.presentorName,
      presentorAddress: formData.presentorAddress,
      presentorPhone: formData.presentorPhone,
      presentorFax: formData.presentorFax,
      presentorEmail: formData.presentorEmail,
      presentorReference: formData.presentorReference,
    };
  };

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    if (!formData.officerNameEnglish) { toast({ title: '錯誤', description: '請填寫辭任人英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      await generateNd4Once();
      toast({ title: '生成成功', description: 'ND4 表格已下載' });
      saveFormHistory({ formType: 'ND4', formData: { formData, selectedCompanyId } });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  // ── 一併生成：ND4（模板路徑）→ 間隔 2.5s → ND2A（單一辭任人） ──
  const handleGenerateBoth = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    if (!formData.officerNameEnglish) { toast({ title: '錯誤', description: '請填寫辭任人英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      await generateNd4Once();
      saveFormHistory({ formType: 'ND4', formData: { formData, selectedCompanyId } });

      const safeName = safeFileName(formData.companyName);
      await sleep(2500);
      let result;
      try {
        result = await postJson('/api/generate-nd2a-pdf', buildNd2aPayloadFromForm());
      } catch (err: any) {
        throw new Error(`ND2A 生成失敗（${err.message}）`);
      }
      if (!result.pdf) throw new Error('No data in response');
      downloadBase64Pdf(result.pdf, `ND2A_${formData.brNumber}_${safeName}.pdf`);

      toast({ title: '✅ PDF 已生成', description: 'ND4 ＋ ND2A（辭任通知）下載完成' });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  const directors = selectedCompany?.directors || [];
  const secretaries = selectedCompany?.secretaries || [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">ND4 — 公司秘書及董事辭任通知書</h1><p className="text-sm text-muted-foreground">Notice of Change in Particulars of Company Secretary and Director</p></div>
        {/* 頂部互鏈：前往 ND2A ＋ 一併生成 */}
        {onNavigate && (
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <button type="button" className="text-xs text-primary hover:underline"
              onClick={() => onNavigate('nd2a', selectedCompanyId || undefined)}>
              ↗ 前往 ND2A 委任╱停任通知書
            </button>
            <Button size="sm" onClick={handleGenerateBoth} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : '📦 '}
              一併生成 ND4 ＋ ND2A
            </Button>
          </div>
        )}
      </div>

      <FormHistorySelector formType="ND4" onSelect={handleLoadHistory} />

      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><Building2 className="h-4 w-4 text-primary" /><Label className="font-medium">選擇公司自動填入</Label></div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
          <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.brNumber})</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <div><h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">辭任人</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>身份類別</Label>
              <Select value={formData.officerType} onValueChange={v => update('officerType', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="director">董事 Director</SelectItem>
                  <SelectItem value="secretary">公司秘書 Company Secretary</SelectItem>
                  <SelectItem value="alternate">候補董事 Alternate Director</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>自然人/法人</Label>
              <Select value={formData.identity} onValueChange={v => update('identity', v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="natural">自然人 Natural Person</SelectItem><SelectItem value="corporate">法人 Corporate</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          {selectedCompany && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {formData.officerType === 'director' && directors.length > 0 && (
                <div><Label>從公司董事列表選擇</Label>
                  <Select onValueChange={v => handleOfficerSelect('director', parseInt(v))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="選擇董事..." /></SelectTrigger>
                    <SelectContent>{directors.map((d, i) => <SelectItem key={i} value={String(i)}>{d.nameEnglish || d.nameChinese}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {formData.officerType === 'secretary' && secretaries.length > 0 && (
                <div><Label>從公司秘書列表選擇</Label>
                  <Select onValueChange={v => handleOfficerSelect('secretary', parseInt(v))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="選擇秘書..." /></SelectTrigger>
                    <SelectContent>{secretaries.map((s, i) => <SelectItem key={i} value={String(i)}>{s.nameEnglish || s.nameChinese}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          {selectedCompany && (
            <div className="mt-3">
              <PersonQuickPick companyId={selectedCompanyId}
                onPick={(d) => {
                  if (d.nameChinese) update('officerNameChinese', d.nameChinese);
                  if (d.surname || d.otherNames) update('officerNameEnglish', [d.surname, d.otherNames].filter(Boolean).join(', '));
                  if (d.idNumber) update('hkidPartial', d.idNumber);
                }}
              />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <div><Label>中文名稱</Label><Input value={formData.officerNameChinese} onChange={e => update('officerNameChinese', e.target.value)} className="mt-1" /></div>
            <div><Label>英文名稱 *（姓氏, 名字）</Label><Input value={formData.officerNameEnglish} onChange={e => update('officerNameEnglish', e.target.value)} className="mt-1" placeholder="CHAN, Tai Man" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <div><Label>香港身份證部分號碼</Label><Input value={formData.hkidPartial} onChange={e => update('hkidPartial', e.target.value)} className="mt-1" placeholder="A123" /></div>
            <div><Label>護照簽發國家/地區</Label><Input value={formData.passportCountry} onChange={e => update('passportCountry', e.target.value)} className="mt-1" placeholder="e.g. China" /></div>
            <div><Label>護照部分號碼</Label><Input value={formData.passportPartial} onChange={e => update('passportPartial', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">辭任生效日期</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>日 (DD)</Label><Input value={formData.resignationDay} onChange={e => update('resignationDay', e.target.value)} className="mt-1" /></div>
            <div><Label>月 (MM)</Label><Input value={formData.resignationMonth} onChange={e => update('resignationMonth', e.target.value)} className="mt-1" /></div>
            <div><Label>年 (YYYY)</Label><Input value={formData.resignationYear} onChange={e => update('resignationYear', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">簽署</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>簽署人姓名</Label><Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1" /></div>
            <div><Label>身份</Label><Input value={formData.signerCapacity} onChange={e => update('signerCapacity', e.target.value)} className="mt-1" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <div><Label>日 (DD)</Label><Input value={formData.signDateDay} onChange={e => update('signDateDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月 (MM)</Label><Input value={formData.signDateMonth} onChange={e => update('signDateMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年 (YYYY)</Label><Input value={formData.signDateYear} onChange={e => update('signDateYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">提交人資料</h3>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>姓名／名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div className="col-span-2">
              {selectedCompanyId && (
                <AddressQuickPick companyId={selectedCompanyId}
                  onPick={(d) => {
                    const parts = [d.flat, d.building, d.street, d.district, d.country || d.region].filter(Boolean);
                    if (parts.length > 0) update('presentorAddress', parts.join(', '));
                  }}
                />
              )}
              <Label>地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" />
            </div>
            <div><Label>電話 Tel</Label><Input value={formData.presentorPhone} onChange={e => update('presentorPhone', e.target.value)} className="mt-1" /></div>
            <div><Label>傳真 Fax</Label><Input value={formData.presentorFax} onChange={e => update('presentorFax', e.target.value)} className="mt-1" /></div>
            <div><Label>電郵 Email</Label><Input value={formData.presentorEmail} onChange={e => update('presentorEmail', e.target.value)} className="mt-1" /></div>
            <div><Label>參考編號 Ref</Label><Input value={formData.presentorReference} onChange={e => update('presentorReference', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 ND4 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
