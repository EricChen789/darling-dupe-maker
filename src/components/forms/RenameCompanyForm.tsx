import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Download, Loader2, FileText, CheckCircle2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { useSaveResolution } from '@/hooks/useResolutions';
import { downloadGenericFormPdf } from '@/lib/genericFormPdf';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import AddressQuickPick from './AddressQuickPick';

interface Props { onBack: () => void; initialCompanyId?: string; }

export default function RenameCompanyForm({ onBack, initialCompanyId }: Props) {
  const { data: companies = [] } = useCompanies();
  const save = useSaveResolution();
  const [companyId, setCompanyId] = useState('');
  const [oldName, setOldName] = useState('');
  const [newName, setNewName] = useState('');
  const [oldChineseName, setOldChineseName] = useState('');
  const [newChineseName, setNewChineseName] = useState('');
  const [resolutionDate, setResolutionDate] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [signers, setSigners] = useState('');
  // 提交人資料
  const [presNameCn, setPresNameCn] = useState('');
  const [presNameEn, setPresNameEn] = useState('');
  const [presAddress, setPresAddress] = useState('');
  const [presPhone, setPresPhone] = useState('');
  const [presFax, setPresFax] = useState('');
  const [presEmail, setPresEmail] = useState('');
  const [presRef, setPresRef] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [resolutionDone, setResolutionDone] = useState(false);
  const [resolutionId, setResolutionId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const { mutate: saveFormHistory } = useSaveFormHistory();

  const company = companies.find(c => c.id === companyId);

  useEffect(() => {
    if (initialCompanyId && companies.length && !companyId) setCompanyId(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  useEffect(() => {
    if (company) {
      setOldName(company.name);
      setOldChineseName(company.chineseName || '');
      // Auto-fill presenter from company
      setPresNameCn(company.chineseName || '');
      setPresNameEn(company.name || '');
      const addr = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
        .filter(Boolean).join(', ');
      setPresAddress(addr);
    }
  }, [company]);

  const oldNameFull = `${oldName || '[old name]'}${oldChineseName ? ` (${oldChineseName})` : ''}`;
  const newNameFull = `${newName || '[new name]'}${newChineseName ? ` (${newChineseName})` : ''}`;

  const resolutionContentEn = `SPECIAL RESOLUTION
PASSED on ${resolutionDate}

RESOLVED THAT the name of the Company be changed:
  From: ${oldNameFull}
  To:   ${newNameFull}

with effect from the date of issue of the Certificate of Change of Name by the Registrar of Companies, and that Form NNC2 be filed with the Companies Registry pursuant to s.108 of the Companies Ordinance (Cap.622) within 15 days.`;

  const resolutionContentCn = `特別決議
於 ${resolutionDate} 通過

茲決議：本公司名稱變更：
  由：${oldNameFull}
  改為：${newNameFull}

於公司註冊處長簽發更改公司名稱證書當日起生效，並依《公司條例》（第622章）第108條於 15 日內提交 NNC2 表格。`;

  // Combined for display preview and storage
  const resolutionContent = `${resolutionContentEn}\n\n${resolutionContentCn}`;

  const handleLoadHistory = (data: any) => {
    if (data.formData) {
      const d = data.formData;
      if (d.oldName !== undefined) setOldName(d.oldName);
      if (d.newName !== undefined) setNewName(d.newName);
      if (d.oldChineseName !== undefined) setOldChineseName(d.oldChineseName);
      if (d.newChineseName !== undefined) setNewChineseName(d.newChineseName);
      if (d.resolutionDate !== undefined) setResolutionDate(d.resolutionDate);
      if (d.effectiveDate !== undefined) setEffectiveDate(d.effectiveDate);
      if (d.signers !== undefined) setSigners(d.signers);
      if (d.presNameCn !== undefined) setPresNameCn(d.presNameCn);
      if (d.presNameEn !== undefined) setPresNameEn(d.presNameEn);
      if (d.presAddress !== undefined) setPresAddress(d.presAddress);
      if (d.presPhone !== undefined) setPresPhone(d.presPhone);
      if (d.presFax !== undefined) setPresFax(d.presFax);
      if (d.presEmail !== undefined) setPresEmail(d.presEmail);
      if (d.presRef !== undefined) setPresRef(d.presRef);
      if (d.step !== undefined) setStep(d.step);
    }
    if (data.selectedCompanyId) setCompanyId(data.selectedCompanyId);
  };

  const handleGenerateResolution = async () => {
    if (!company || !newName.trim()) {
      toast({ title: '請選擇公司並填寫新公司名稱', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const ok = await downloadGenericFormPdf({
        formCode: 'Resolution-Rename',
        title: '更改公司名稱特別決議書 / Special Resolution — Change of Name',
        subtitle: '股東書面特別決議 / Written Resolution of Members',
        companyName: oldName || company.name,
        brNumber: company.brNumber,
        sections: [
          { rows: [['Resolution Date 決議日期', resolutionDate], ['Effective Date 生效日期', effectiveDate]] },
          { heading: 'Special Resolution', paragraph: resolutionContentEn },
          { heading: '特別決議', paragraph: resolutionContentCn },
        ],
        signatureLines: [
          'Director / 董事：____________________   Date 日期：____________________',
          'Company Secretary / 公司秘書：____________________   Date 日期：____________________',
        ],
      }, 'Resolution_Rename');
      if (ok) {
        save.mutate({
          company_id: company.id,
          resolution_type: 'rename',
          title: '更改公司名稱特別決議書',
          resolution_date: resolutionDate,
          content: resolutionContent,
          signers,
          is_ai_generated: false,
        }, {
          onSuccess: () => {
            setResolutionDone(true);
            toast({ title: '決議書 PDF 已生成並儲存', description: '可以繼續產生 NNC2 表格' });
          },
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateNNC2 = async () => {
    if (!company || !newName.trim()) {
      toast({ title: '請選擇公司並填寫新公司名稱', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const rd = resolutionDate.split('-');  // YYYY-MM-DD
      const fields: Record<string, string> = {
        'fill_1_P.1': company.brNumber || '',
        'fill_2_P.1': oldName || company.name || '',
        // New fillable template: fill_3 = 現有公司中文名稱 (Existing Chinese)
        'fill_3_P.1': oldChineseName || '',
        // fill_4-6: 特別決議日期 (resolution date, not effective date)
        'fill_4_P.1': rd.length >= 3 ? rd[2] : '',
        'fill_5_P.1': rd.length >= 2 ? rd[1] : '',
        'fill_6_P.1': rd.length >= 1 ? rd[0] : '',
        // New fillable template: fill_7 = 擬用的公司英文名稱 (Intended English)
        'fill_7_P.1': newName || '',
        'fill_8_P.1': newChineseName || '',
        // fill_9-10: signer + resolution date (y=554)
        'fill_9_P.1': signers ? signers.split(',')[0].trim() : '',
        'fill_10_P.1': rd.length >= 3 ? `${rd[2]}/${rd[1]}/${rd[0]}` : resolutionDate,
        // ── Presentor (提交人) fields ──
        'fill_11_P.1': presNameCn,
        'fill_12_P.1': presNameEn,
        'fill_13_P.1': presAddress,
        'fill_14_P.1': presPhone,
        'fill_15_P.1': presFax,
        'fill_16_P.1': presEmail,
        'fill_17_P.1': presRef,
      };
      const resp = await fetch(`/api/generate-nnc2-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, 'NNC2-form.pdf');
      toast({ title: 'NNC2 表格已生成', description: '使用官方模板填寫' });
      saveFormHistory({ formType: 'NNC2', formData: { formData: { oldName, newName, oldChineseName, newChineseName, resolutionDate, effectiveDate, signers, presNameCn, presNameEn, presAddress, presPhone, presFax, presEmail, presRef, step }, selectedCompanyId: companyId } });
    } catch (err: any) {
      toast({ title: '生成失敗', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> 返回</Button>
      <h2 className="text-xl font-semibold">公司更名 — NNC2 + 特別決議書</h2>
      <p className="text-sm text-muted-foreground">
        建議流程：先生成股東特別決議書 → 簽署 → 再生成 NNC2 並於 15 日內提交公司註冊處。
      </p>

      <FormHistorySelector formType="NNC2" onSelect={handleLoadHistory} />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">選擇公司 *</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="選擇公司" /></SelectTrigger>
            <SelectContent>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">商業登記號碼</Label><Input value={company?.brNumber || ''} disabled /></div>
        <div className="space-y-1"><Label className="text-xs">現有英文名稱</Label><Input value={oldName} onChange={e => setOldName(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">現有中文名稱</Label><Input value={oldChineseName} onChange={e => setOldChineseName(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">新英文名稱 *</Label><Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="必須以 Limited 結尾" /></div>
        <div className="space-y-1"><Label className="text-xs">新中文名稱</Label><Input value={newChineseName} onChange={e => setNewChineseName(e.target.value)} placeholder="必須以「有限公司」結尾" /></div>
        <div className="space-y-1"><Label className="text-xs">決議日期</Label><Input type="date" value={resolutionDate} onChange={e => setResolutionDate(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">預期生效日期</Label><Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /></div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">簽署人（逗號分隔）</Label>
        <Input value={signers} onChange={e => setSigners(e.target.value)} placeholder="例如：Mr. Chan, Ms. Wong" />
      </div>

      <Separator />

      <h3 className="font-semibold text-sm">提交人資料 Presentor</h3>
      {/* 從系統選擇提交人 */}
      <PresenterSelector
        currentData={{ name: presNameEn, nameEnglish: presNameEn, nameChinese: presNameCn, address: presAddress, phone: presPhone, fax: presFax, email: presEmail, reference: presRef }}
        companyId={initialCompanyId}
        onSelect={(p) => {
          setPresNameEn(p.name || '');
          setPresNameCn((p as any).nameChinese || '');
          setPresAddress(p.address || '');
          setPresPhone(p.phone || '');
          setPresFax(p.fax || '');
          setPresEmail(p.email || '');
          setPresRef(p.reference || '');
        }}
      />
      {initialCompanyId && (
        <AddressQuickPick
          companyId={initialCompanyId}
          onPick={(d) => {
            const parts = presAddress.split(/[,，]\s*/);
            const flat = d.flat || parts[0] || '';
            const building = d.building || parts[1] || '';
            const street = d.street || parts[2] || '';
            const district = d.district || parts[3] || '';
            const region = d.country || d.region || parts[4] || '';
            setPresAddress([flat, building, street, district, region].filter(Boolean).join(', '));
          }}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label className="text-xs">中文姓名／名稱</Label><Input className="h-8 text-xs" value={presNameCn} onChange={e => setPresNameCn(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">英文姓名／名稱</Label><Input className="h-8 text-xs" value={presNameEn} onChange={e => setPresNameEn(e.target.value)} /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">地址 Address</Label><Input className="h-8 text-xs" value={presAddress} onChange={e => setPresAddress(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">電話 Tel</Label><Input className="h-8 text-xs" value={presPhone} onChange={e => setPresPhone(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">傳真 Fax</Label><Input className="h-8 text-xs" value={presFax} onChange={e => setPresFax(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">電郵 Email</Label><Input className="h-8 text-xs" value={presEmail} onChange={e => setPresEmail(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">檔號 Reference</Label><Input className="h-8 text-xs" value={presRef} onChange={e => setPresRef(e.target.value)} /></div>
      </div>

      <Separator />

      <div className="space-y-1">
        <Label className="text-xs">特別決議書內容預覽（可由 PDF 上看到）</Label>
        <Textarea rows={10} value={resolutionContent} readOnly className="font-mono text-xs bg-muted/30" />
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border p-4 space-y-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" /> 步驟 1：股東特別決議書
            {resolutionDone && <CheckCircle2 className="h-4 w-4 text-primary" />}
          </h3>
          <p className="text-xs text-muted-foreground">先生成決議書，由全體股東簽署。</p>
          <Button size="sm" onClick={handleGenerateResolution} disabled={generating} className="w-full bg-primary text-primary-foreground">
            {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            生成決議書 PDF
          </Button>
        </div>
        <div className="rounded-md border border-border p-4 space-y-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" /> 步驟 2：NNC2 表格
          </h3>
          <p className="text-xs text-muted-foreground">決議通過後 15 日內向公司註冊處提交。</p>
          <Button size="sm" onClick={handleGenerateNNC2} disabled={generating} className="w-full bg-primary text-primary-foreground">
            {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            生成 NNC2 PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
