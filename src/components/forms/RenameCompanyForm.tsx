import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Download, Loader2, FileText, CheckCircle2, Lightbulb } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { useSaveResolution } from '@/hooks/useResolutions';
import { downloadGenericFormPdf } from '@/lib/genericFormPdf';
import { downloadBase64Pdf, downloadBase64File } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import AddressQuickPick from './AddressQuickPick';

type ResolutionType = 'sole_director' | 'members';

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
  // 決議書類型
  const [resolutionType, setResolutionType] = useState<ResolutionType | 'auto'>('auto');
  const [includeConsent, setIncludeConsent] = useState(false);

  const company = companies.find(c => c.id === companyId);

  // Auto-detect resolution type based on company structure
  const detectedType = useMemo<ResolutionType>(() => {
    if (!company) return 'members';
    const dirs = company.directors || [];
    return dirs.length === 1 ? 'sole_director' : 'members';
  }, [company]);

  const effectiveType: ResolutionType = resolutionType === 'auto' ? detectedType : resolutionType;

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

  // ─── Resolution content builders ───
  // Template 3: Sole Director Resolution
  const soleDirContentEn = `WRITTEN RESOLUTIONS OF THE SOLE DIRECTOR OF THE COMPANY

Pursuant to the Company's Articles of Association, I, the undersigned, being the sole Director of the Company for the time being, hereby confirm that the following resolution was duly passed on ${resolutionDate}:

Change of Company Name

It was resolved by Special Resolution:

That the name of the Company be changed from ${oldNameFull} to ${newNameFull}, with effect from the date of issue of the Certificate of Change of Name by the Registrar of Companies, and that Form NNC2 be filed with the Companies Registry pursuant to s.108 of the Companies Ordinance (Cap.622) within 15 days.

Preparation of Documents:
The secretary was requested to complete the documents required to change the name of the company.`;

  const soleDirContentCn = `單獨董事書面決議

根據公司章程，本人（以下簽署人）作為本公司現時唯一董事，茲確認以下決議已於${resolutionDate}正式通過：

更改公司名稱

通過特別決議：

本公司名稱由「${oldNameFull}」更改為「${newNameFull}」，於公司註冊處處長簽發更改公司名稱證書當日起生效，並依《公司條例》（第622章）第108條於15日內提交NNC2表格。

文件準備：
已要求公司秘書完成更改公司名稱所需之文件。`;

  // Template 2: Members Written Resolution
  const membersContentEn = `WRITTEN RESOLUTIONS OF THE MEMBERS OF THE COMPANY

Change of Name

At an Extraordinary General Meeting of the Company duly convened and held on ${resolutionDate}, the following Special Resolution was duly passed:

That the name of the Company be changed to ${newNameFull}, with effect from the date of issue of the Certificate of Change of Name by the Registrar of Companies, and that Form NNC2 be filed with the Companies Registry pursuant to s.108 of the Companies Ordinance (Cap.622) within 15 days.`;

  const membersContentCn = `股東書面決議

更改公司名稱

於${resolutionDate}正式召開及舉行之公司股東特別大會上，已正式通過以下特別決議：

本公司名稱更改為「${newNameFull}」，於公司註冊處處長簽發更改公司名稱證書當日起生效，並依《公司條例》（第622章）第108條於15日內提交NNC2表格。`;

  // Template 1: Members Consent to Short Notice (supplementary)
  const consentContentEn = `MEMBERS' CONSENT TO SHORT NOTICE

We, being all the Members of the Company entitled to attend and vote at the General Meeting, hereby consent to such Meeting being held on ${resolutionDate} notwithstanding that less than 21 clear days' notice has been given to us.`;

  const consentContentCn = `股東同意短通知

吾等為本公司全體有權出席股東大會並表決之股東，茲同意上述會議於${resolutionDate}舉行，即使該會議通知期少於21整天。`;

  // Active content based on selected type
  const resolutionContentEn = effectiveType === 'sole_director' ? soleDirContentEn : membersContentEn;
  const resolutionContentCn = effectiveType === 'sole_director' ? soleDirContentCn : membersContentCn;

  // Build with consent if checked
  const fullEn = includeConsent
    ? `${consentContentEn}\n\n${resolutionContentEn}`
    : resolutionContentEn;
  const fullCn = includeConsent
    ? `${consentContentCn}\n\n${resolutionContentCn}`
    : resolutionContentCn;

  // Combined for display preview and storage
  const resolutionContent = `${fullEn}\n\n${fullCn}`;

  const resolutionTitle = effectiveType === 'sole_director'
    ? '更改公司名稱 — 單獨董事書面決議 / Written Resolutions of the Sole Director'
    : '更改公司名稱 — 股東書面決議 / Written Resolutions of the Members';

  const resolutionSubtitle = effectiveType === 'sole_director'
    ? '單獨董事書面決議 / Written Resolutions of the Sole Director'
    : '股東書面決議 / Written Resolutions of the Members';

  const signatureLines = effectiveType === 'sole_director'
    ? [
        'Sole Director / 唯一董事：____________________   Date 日期：____________________',
        'Company Secretary / 公司秘書：____________________   Date 日期：____________________',
      ]
    : [
        'Signed by all the members of the company / 全體股東簽署：',
        '____________________________   Date 日期：____________________',
        '____________________________   Date 日期：____________________',
        'Company Secretary / 公司秘書：____________________   Date 日期：____________________',
      ];

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
      if (d.resolutionType !== undefined) setResolutionType(d.resolutionType);
      if (d.includeConsent !== undefined) setIncludeConsent(d.includeConsent);
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
      const token = localStorage.getItem("secretary_jwt") || "";
      const signerNames = signers ? signers.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];

      // Generate main resolution DOCX
      const payload: Record<string, any> = {
        resolutionType: effectiveType,
        includeConsent,
        companyName: oldName || company.name,
        oldName: oldName || company.name,
        oldChineseName,
        newName,
        newChineseName,
        ciNumber: company.ciNumber || '',
        resolutionDate,
        meetingTime: '10:00AM',
        signer1Name: signerNames[0] || '',
        signer2Name: signerNames[1] || '',
      };

      const resp = await fetch(`/api/generate-resolution-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');

      const companyTag = (oldName || company.name).replace(/[^a-zA-Z0-9]/g, '_');
      downloadBase64File(result.docx, `${result.filename || `Resolution_${effectiveType}_${companyTag}.docx`}`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

      // If consent is also checked, generate consent DOCX as well
      if (includeConsent) {
        const consentPayload = { ...payload, resolutionType: 'members_consent' };
        const cResp = await fetch(`/api/generate-resolution-docx`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(consentPayload),
        });
        const cResult = await cResp.json();
        if (cResp.ok && cResult.docx) {
          downloadBase64File(cResult.docx, `Consent_ShortNotice_${companyTag}.docx`,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        }
      }

      save.mutate({
        company_id: company.id,
        resolution_type: 'rename',
        title: resolutionTitle,
        resolution_date: resolutionDate,
        content: resolutionContent,
        signers,
        is_ai_generated: false,
      }, {
        onSuccess: () => {
          setResolutionDone(true);
          toast({ title: '決議書 DOCX 已生成並儲存', description: '可用 Word 開啟後另存為 PDF' });
        },
      });
    } catch (err: any) {
      toast({ title: '生成失敗', description: err.message, variant: 'destructive' });
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
      saveFormHistory({ formType: 'NNC2', formData: { formData: { oldName, newName, oldChineseName, newChineseName, resolutionDate, effectiveDate, signers, presNameCn, presNameEn, presAddress, presPhone, presFax, presEmail, presRef, step, resolutionType, includeConsent }, selectedCompanyId: companyId } });
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

      {/* ─── 決議書類型選擇 ─── */}
      <div className="rounded-md border border-border p-4 space-y-3 bg-muted/20">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">決議書類型 Resolution Type</Label>
          {resolutionType === 'auto' && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lightbulb className="h-3 w-3" />
              已為你自動偵測
            </span>
          )}
        </div>
        <Select value={resolutionType} onValueChange={(v) => setResolutionType(v as ResolutionType | 'auto')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="選擇決議書類型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              自動偵測（{detectedType === 'sole_director' ? '單獨董事' : '全體股東'}）
            </SelectItem>
            <SelectItem value="sole_director">
              單獨董事書面決議 — Written Resolutions of the Sole Director
            </SelectItem>
            <SelectItem value="members">
              股東書面決議 — Written Resolutions of the Members
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {effectiveType === 'sole_director'
            ? '適用於唯一董事同時為唯一股東的公司，由該董事單獨簽署即可。'
            : '適用於有多位股東的公司，需由全體股東簽署。'}
        </p>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="includeConsent"
            checked={includeConsent}
            onChange={(e) => setIncludeConsent(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-primary"
          />
          <Label htmlFor="includeConsent" className="text-xs cursor-pointer">
            附加「股東同意短通知」Members' Consent to Short Notice（會議通知不足 21 天時使用）
          </Label>
        </div>
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
            <FileText className="h-4 w-4" /> 步驟 1：決議書
            {resolutionDone && <CheckCircle2 className="h-4 w-4 text-primary" />}
          </h3>
          <p className="text-xs text-muted-foreground">
            {effectiveType === 'sole_director'
              ? '生成單獨董事書面決議，由唯一董事簽署。'
              : '生成股東書面決議，由全體股東簽署。'}
            {includeConsent && ' 包含短通知同意書。'}
          </p>
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
