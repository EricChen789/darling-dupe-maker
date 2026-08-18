import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
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
import ConfirmWritebackDialog from './ConfirmWritebackDialog';
import { resolveCompanyId, buildND4Summary, writebackND4, errText, type WritebackSummaryItem } from '@/lib/formWriteback';

interface ND4GeneratorFormProps {
  onBack: () => void;
  initialCompanyId?: string;
  /** 頂部互鏈：切換到對方表單（帶當前公司 id 保留選擇） */
  onNavigate?: (formKey: string, companyId?: string) => void;
}

export default function ND4GeneratorForm({ onBack, initialCompanyId, onNavigate }: ND4GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const queryClient = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  // 寫回確認框：生成前彈出（含公司解析結果與摘要）
  const [pendingWriteback, setPendingWriteback] = useState<{ title: string; summary: WritebackSummaryItem[]; companyId: string | null } | null>(null);
  // 頂部勾選：生成 ND4 時是否一併生成 ND2A 委任╱停任通知書（默認勾選）
  const [generateNd2aTogether, setGenerateNd2aTogether] = useState(true);
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

  // ── ND4 生成走專用端點 /api/generate-nd4-pdf（藍框可編輯恢復版） ──
  // ⚠ 舊模板路徑 /api/generate-template-pdf 會 form.flatten() → 全部字段
  // 壓成白色不可修改框；專用端點做兩遍式 detach + rebuildAcroFormFields，
  // 保留 62/62 藍色可編輯框（含 32 個 P.2 下拉選項），已生產驗證。
  const generateNd4Once = async (): Promise<void> => {
    // Parse English name into surname + other names (matching _parse_english_name logic)
    const engName = (formData.officerNameEnglish || '').replace(/\s+/g, ' ').trim();
    const { surname, otherNames } = parseEnglishName(engName);

    // 專用端點字段（generate-nd4-pdf.ts，與模板標籤對照驗證 2026-07-30）：
    //   自然人格 fill_4=中文姓名 fill_5=姓氏 fill_6=名字 fill_7=HKID fill_8=護照國 fill_8b=護照號
    //   法人 fill_9=公司名 fill_10=公司編號；候補董事另填 fill_3=代替 Alternate to
    //   fill_11/12/13=辭職日期；P.2 fill_2=簽署人 fill_3=簽署日期；提交人 fill_14~19
    const payload: Record<string, any> = {
      brNumber: formData.brNumber,
      companyName: formData.companyName,
      officerType: formData.officerType,
      identity: formData.identity,
      officerNameChinese: formData.officerNameChinese,
      surname,
      otherNames,
      hkidPartial: formData.hkidPartial,
      passportCountry: formData.passportCountry,
      passportPartial: formData.passportPartial,
      corporateName: engName,
      corporateNumber: formData.hkidPartial,
      resignationDay: formData.resignationDay,
      resignationMonth: formData.resignationMonth,
      resignationYear: formData.resignationYear,
      signerName: formData.signerName || formData.presentorName || '',
      signDateDay: formData.signDateDay,
      signDateMonth: formData.signDateMonth,
      signDateYear: formData.signDateYear,
      presentorName: formData.presentorName,
      presentorAddress: formData.presentorAddress,
      presentorPhone: formData.presentorPhone,
      presentorFax: formData.presentorFax,
      presentorEmail: formData.presentorEmail,
      presentorReference: formData.presentorReference,
    };
    if (formData.officerType === 'alternate') payload.alternateTo = engName;

    const result = await postJson('/api/generate-nd4-pdf', payload);
    if (!result.pdf) throw new Error('No data in response');
    downloadBase64Pdf(result.pdf, `ND4_${formData.brNumber || 'form'}.pdf`);
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

  // ── 寫回輸入（與 payload 同源） ──
  const wbOfficer = () => ({
    officerType: formData.officerType,
    identity: formData.identity,
    officerNameEnglish: formData.officerNameEnglish,
    officerNameChinese: formData.officerNameChinese,
    hkidPartial: formData.hkidPartial,
    passportCountry: formData.passportCountry,
    passportPartial: formData.passportPartial,
    resignationDay: formData.resignationDay,
    resignationMonth: formData.resignationMonth,
    resignationYear: formData.resignationYear,
    corporateName: formData.identity === 'corporate' ? formData.officerNameEnglish : '',
    corporateNumber: formData.identity === 'corporate' ? formData.hkidPartial : '',
  });

  // ── PDF 成功後寫回資料庫 + 刷新查詢 + 結果 toast ──
  const runWriteback = async (companyId: string) => {
    try {
      const labels = await writebackND4(companyId, wbOfficer());
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      const warns = labels.filter(l => l.startsWith('⚠'));
      if (labels.length > 0) toast({ title: '已同步資料庫', description: labels.join('；') });
      if (warns.length > 0) toast({ title: '部分寫回未完成', description: warns.join('；'), variant: 'destructive' });
    } catch (e: any) {
      toast({ title: '資料庫寫回失敗', description: errText(e), variant: 'destructive' });
    }
  };

  const doGenerateSingle = async (writebackCompanyId?: string | null) => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    if (!formData.officerNameEnglish) { toast({ title: '錯誤', description: '請填寫辭任人英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      await generateNd4Once();
      toast({ title: '生成成功', description: 'ND4 表格已下載' });
      saveFormHistory({ formType: 'ND4', formData: { formData, selectedCompanyId } });
      // 寫回資料庫（PDF 成功才寫，避免半寫狀態）
      if (writebackCompanyId) await runWriteback(writebackCompanyId);
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  // ── 生成入口：先彈寫回確認框，確認後按頂部勾選走單一/一併生成 ──
  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    if (!formData.officerNameEnglish) { toast({ title: '錯誤', description: '請填寫辭任人英文名稱', variant: 'destructive' }); return; }
    const companyId = await resolveCompanyId(formData.brNumber, selectedCompanyId || undefined);
    setPendingWriteback({
      title: generateNd2aTogether ? 'ND4 ＋ ND2A 生成確認' : 'ND4 生成確認',
      summary: buildND4Summary(wbOfficer()),
      companyId,
    });
  };

  // ── 一併生成：ND4（模板路徑）→ 間隔 2.5s → ND2A（單一辭任人） ──
  const doGenerateBoth = async (writebackCompanyId?: string | null) => {
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

      // 寫回資料庫（同一辭任人：ND4 停任寫回即覆蓋 ND2A 停任效果，不重複記事件）
      if (writebackCompanyId) await runWriteback(writebackCompanyId);
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
        {/* 頂部互鏈：前往 ND2A ＋ 勾選同時生成 ND2A */}
        {onNavigate && (
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <button type="button" className="text-xs text-primary hover:underline"
              onClick={() => onNavigate('nd2a', selectedCompanyId || undefined)}>
              ↗ 前往 ND2A 委任╱停任通知書
            </button>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <Checkbox checked={generateNd2aTogether} onCheckedChange={v => setGenerateNd2aTogether(v === true)} disabled={generating} />
              <span>同時生成 ND2A 委任╱停任通知書</span>
            </label>
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

      <ConfirmWritebackDialog
        open={pendingWriteback !== null}
        title={pendingWriteback?.title || ''}
        summary={pendingWriteback?.summary || []}
        canWrite={!!pendingWriteback?.companyId}
        onCancel={() => setPendingWriteback(null)}
        onConfirm={() => {
          const p = pendingWriteback;
          setPendingWriteback(null);
          if (!p) return;
          if (generateNd2aTogether) doGenerateBoth(p.companyId);
          else doGenerateSingle(p.companyId);
        }}
      />
    </div>
  );
}
