import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import type { Presenter } from '@/hooks/usePresenters';
import PersonQuickPick from './PersonQuickPick';
import AddressQuickPick from './AddressQuickPick';
import { ArrowLeft, Download, Loader2, Building2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { postJson } from '@/lib/formGen';
import ConfirmWritebackDialog from './ConfirmWritebackDialog';
import { resolveCompanyId, buildNN6Summary, writebackNN6, errText, type WritebackSummaryItem } from '@/lib/formWriteback';

// ── 香港 18 區（繁體，用於下拉選單） ──
const HK_DISTRICTS = [
  '中西區', '灣仔', '東區', '南區',
  '油尖旺', '深水埗', '九龍城', '黃大仙',
  '觀塘', '葵青', '荃灣', '屯門',
  '元朗', '北區', '大埔', '沙田',
  '西貢', '離島',
];

// ── Officer 類型（扁平結構，與 ND2A 一致：每人一條 委任/停任 記錄） ──
// 頁面分配（與後端 generate-nn6-pdf.ts 同步）：
//   停任第1名 → P.1 第2項；第2名 → P.4 續頁A；第3名及以後 → 動態續頁A
//   委任自然人第1名 → P.2 第3項；第2名 → P.5 續頁B；第3名及以後 → 動態續頁B
//   委任法人第1個 → P.3 第4項；第2個 → P.6 續頁C；第3個及以後 → 動態續頁C
//   每名委任自然人自動附加一頁 PI-NN6 受保護資料（置於最後）
interface OfficerEntry {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director' | 'alternate';
  identity: 'natural' | 'corporate';
  alternateTo: string;          // 代替誰（候補董事時）
  // 姓名
  nameChinese: string;
  nameSurname: string;           // 英文姓氏
  nameOtherNames: string;        // 英文名字
  nameEnglish: string;           // 組合後的全名 (fallback)
  // 前用姓名
  hasFormerName: boolean;
  formerNameChinese: string;
  formerNameEnglish: string;
  // 別名
  hasAlias: boolean;
  aliasChinese: string;
  aliasEnglish: string;
  // 通訊地址
  addrFlatBlock: string;         // 室/樓/座
  addrBuilding: string;          // 大廈
  addrStreetEstate: string;      // 街道/屋苑/地段/村
  addrDistrict: string;          // 區（18區下拉）
  addrRegion: string;            // 國家/地區
  address: string;               // 舊單行地址（兼容）
  // 聯絡
  email: string;
  // 證件
  idNumber: string;              // 香港身份證
  passportCountry: string;       // 護照簽發國家
  passportNumber: string;        // 護照號碼
  // 日期
  dateAppointed: string;         // 委任日期
  dateCeased: string;            // 停任日期
  // 委任時是否已是現任董事（是/否）
  alreadyDirector: 'yes' | 'no' | '';
  // 停任後是否仍然擔任（公司秘書免填；是/否）
  stillHoldsOffice: 'yes' | 'no' | '';
  // 法人專用
  companyName: string;
  companyNumber: string;         // 商業登記號碼
}

const emptyOfficer = (): OfficerEntry => ({
  type: 'appointment',
  role: 'director',
  identity: 'natural',
  alternateTo: '',
  nameChinese: '',
  nameSurname: '',
  nameOtherNames: '',
  nameEnglish: '',
  hasFormerName: false,
  formerNameChinese: '',
  formerNameEnglish: '',
  hasAlias: false,
  aliasChinese: '',
  aliasEnglish: '',
  addrFlatBlock: '',
  addrBuilding: '',
  addrStreetEstate: '',
  addrDistrict: '',
  addrRegion: '',
  address: '',
  email: '',
  idNumber: '',
  passportCountry: '',
  passportNumber: '',
  dateAppointed: '',
  dateCeased: '',
  alreadyDirector: '',
  stillHoldsOffice: 'no',
  companyName: '',
  companyNumber: '',
});

interface NN6GeneratorFormProps {
  onBack: () => void;
  initialCompanyId?: string;
}

export default function NN6GeneratorForm({ onBack, initialCompanyId }: NN6GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const { mutate: saveFormHistory } = useSaveFormHistory();
  const queryClient = useQueryClient();

  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  // 寫回確認框：生成前彈出（含公司解析結果與摘要）
  const [pendingWriteback, setPendingWriteback] = useState<{ title: string; summary: WritebackSummaryItem[]; companyId: string | null } | null>(null);

  // 公司基本資料
  const [brNumber, setBrNumber] = useState('');
  const [companyName, setCompanyName] = useState('');

  // 人員列表（扁平：委任/停任各一條）
  const [officers, setOfficers] = useState<OfficerEntry[]>([emptyOfficer()]);

  // 簽署人
  const [signerId, setSignerId] = useState('');  // '' = 自動（首個秘書→首個董事）, officer id, '__manual__' = 手動輸入
  const [signerName, setSignerName] = useState('');
  const [signDate, setSignDate] = useState('');
  const [signerCapacity, setSignerCapacity] = useState<'director' | 'secretary' | 'manager' | 'authorizedRep' | ''>('director');

  // 提交人
  const [presentorName, setPresentorName] = useState('');
  const [presentorAddress, setPresentorAddress] = useState('');
  const [presentorPhone, setPresentorPhone] = useState('');
  const [presentorFax, setPresentorFax] = useState('');
  const [presentorEmail, setPresentorEmail] = useState('');
  const [presentorReference, setPresentorReference] = useState('');

  // ── 選中的公司 ──
  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  // ── 公司內的人員（用於簽署人下拉） ──
  const companyOfficers = selectedCompany
    ? [...selectedCompany.directors.map(d => ({ ...d, _role: 'director' as const })),
       ...selectedCompany.secretaries.map(s => ({ ...s, _role: 'secretary' as const }))]
    : [];

  // ── 選公司 ──
  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setBrNumber(company.brNumber || '');
      setCompanyName(company.name || '');
      setPresentorName(company.name || '');
      const regAddress = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
        .filter(Boolean).join(', ');
      setPresentorAddress(regAddress);
      // 簽署人自動選首個秘書/董事
      setSignerId('');
      const autoSigner = company.secretaries[0] || company.directors[0];
      setSignerName(autoSigner ? (autoSigner.nameEnglish || autoSigner.nameChinese || '') : '');
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  // ── 更新 officer 欄位 ──
  const updateOfficer = (idx: number, field: string, value: any) => {
    setOfficers(prev => prev.map((o, i) => i === idx ? { ...o, [field]: value } : o));
  };

  const addOfficer = () => setOfficers(prev => [...prev, emptyOfficer()]);
  const removeOfficer = (idx: number) => setOfficers(prev => prev.filter((_, i) => i !== idx));

  // ── 頁面提示：按每人所在分組的次序顯示實際落頁 ──
  const pageHintFor = (officer: OfficerEntry): string => {
    if (officer.type === 'cessation') {
      const idx = officers.filter(o => o.type === 'cessation').indexOf(officer);
      if (idx === 0) return '停任 → P.1 第2項';
      if (idx === 1) return '停任 → P.4 續頁A';
      return '停任 → 動態續頁A（自動加頁）';
    }
    if (officer.identity === 'natural') {
      const idx = officers.filter(o => o.type === 'appointment' && o.identity === 'natural').indexOf(officer);
      if (idx === 0) return '委任 → P.2 第3項 ＋ PI-NN6 受保護資料頁';
      if (idx === 1) return '委任 → P.5 續頁B ＋ PI-NN6 頁';
      return '委任 → 動態續頁B ＋ PI-NN6 頁（自動加頁）';
    }
    const idx = officers.filter(o => o.type === 'appointment' && o.identity === 'corporate').indexOf(officer);
    if (idx === 0) return '委任 → P.3 第4項';
    if (idx === 1) return '委任 → P.6 續頁C';
    return '委任 → 動態續頁C（自動加頁）';
  };

  // ── 載入歷史（含舊版「法人委任嵌套停任」→ 扁平化遷移） ──
  const handleLoadHistory = (data: any) => {
    if (data.brNumber) setBrNumber(data.brNumber);
    if (data.companyName) setCompanyName(data.companyName);
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
    if (data.officers) {
      const flat: OfficerEntry[] = [];
      for (const raw of data.officers) {
        const o: OfficerEntry = { ...emptyOfficer(), ...raw };
        // backward compat: split old nameEnglish if no surname/otherNames
        if (!o.nameSurname && !o.nameOtherNames && o.nameEnglish) {
          const parts = o.nameEnglish.trim().split(/\s+/);
          o.nameSurname = parts[0] || '';
          o.nameOtherNames = parts.slice(1).join(' ');
        }
        // backward compat: old single address → addrFlatBlock
        if (!o.addrFlatBlock && !o.addrBuilding && !o.addrStreetEstate && o.address) {
          o.addrFlatBlock = o.address;
        }
        o.hasFormerName = !!(o.hasFormerName || o.formerNameChinese || o.formerNameEnglish);
        o.hasAlias = !!(o.hasAlias || o.aliasChinese || o.aliasEnglish);
        // ── 舊版嵌套停任 → 拆成獨立停任條目 ──
        if (o.hasCessation) {
          const hasApptData = !!(o.nameChinese || o.nameSurname || o.nameOtherNames || o.companyName || o.idNumber);
          if (hasApptData) flat.push({ ...o, hasCessation: false });
          flat.push({
            ...emptyOfficer(),
            type: 'cessation',
            role: raw.cessationRole || 'director',
            identity: raw.cessationIdentity || 'natural',
            alternateTo: raw.cessationAlternateTo || '',
            nameChinese: raw.cessationNameChinese || '',
            nameSurname: raw.cessationNameSurname || '',
            nameOtherNames: raw.cessationNameOtherNames || '',
            nameEnglish: raw.cessationNameEnglish || '',
            idNumber: raw.cessationIdNumber || '',
            passportNumber: raw.cessationPassportNumber || '',
            dateCeased: o.dateCeased || '',
            stillHoldsOffice: raw.cessationAlreadyDirector === 'yes' ? 'yes' : 'no',
          });
        } else {
          flat.push(o);
        }
      }
      setOfficers(flat.length ? flat : [emptyOfficer()]);
    }
    if (data.signerName !== undefined) setSignerName(data.signerName);
    if (data.signerId !== undefined) setSignerId(data.signerId);
    if (data.signDate !== undefined) setSignDate(data.signDate);
    if (data.signerCapacity !== undefined) setSignerCapacity(data.signerCapacity);
    if (data.presentorName !== undefined) setPresentorName(data.presentorName);
    if (data.presentorAddress !== undefined) setPresentorAddress(data.presentorAddress);
    if (data.presentorPhone !== undefined) setPresentorPhone(data.presentorPhone);
    if (data.presentorFax !== undefined) setPresentorFax(data.presentorFax);
    if (data.presentorEmail !== undefined) setPresentorEmail(data.presentorEmail);
    if (data.presentorReference !== undefined) setPresentorReference(data.presentorReference);
    // backward compat
    if (data.presentorContact !== undefined && !data.presentorPhone && !data.presentorEmail) {
      setPresentorPhone(data.presentorContact);
    }
  };

  const buildPayload = (list: OfficerEntry[], debug = false) => ({
    brNumber, companyName, officers: list, signerName, signerCapacity, signDate,
    presentorName, presentorAddress, presentorPhone, presentorFax, presentorEmail, presentorReference, debug,
  });

  // ── PDF 成功後寫回資料庫 + 刷新查詢 + 結果 toast ──
  const runWriteback = async (companyId: string, list: OfficerEntry[]) => {
    try {
      const labels = await writebackNN6(companyId, list as any);
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      const warns = labels.filter(l => l.startsWith('⚠'));
      if (labels.length > 0) toast({ title: '已同步資料庫', description: labels.join('；') });
      if (warns.length > 0) toast({ title: '部分寫回未完成', description: warns.join('；'), variant: 'destructive' });
    } catch (e: any) {
      toast({ title: '資料庫寫回失敗', description: errText(e), variant: 'destructive' });
    }
  };

  // ── 生成主體：postJson 成功下載後才寫回資料庫 ──
  const doGenerate = async (debug = false, writebackCompanyId?: string | null) => {
    if (!brNumber || !companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const result = await postJson('/api/generate-nn6-pdf', buildPayload(officers, debug));
      if (!result.pdf) throw new Error('No data in response');

      downloadBase64Pdf(result.pdf, `NN6_${brNumber}_${companyName.replace(/\s+/g, '_')}.pdf`);
      saveFormHistory({ formType: 'NN6', formData: { brNumber, companyName, selectedCompanyId, officers, signerId, signerName, signerCapacity, signDate, presentorName, presentorAddress, presentorPhone, presentorFax, presentorEmail, presentorReference } });
      toast({ title: '生成成功', description: 'NN6 表格已下載' });

      // 寫回資料庫（PDF 成功才寫，避免半寫狀態）
      if (writebackCompanyId) {
        await runWriteback(writebackCompanyId, officers);
      }
    } catch (err: any) {
      toast({ title: '生成失敗', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  // ── 生成入口：先彈寫回確認框，確認後 doGenerate；debug 模式直出（不寫回） ──
  const handleGenerate = async (debug = false) => {
    if (debug) {
      await doGenerate(true, null);
      return;
    }
    if (!brNumber || !companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    const companyId = await resolveCompanyId(brNumber, selectedCompanyId || undefined);
    setPendingWriteback({
      title: 'NN6 生成確認',
      summary: buildNN6Summary(officers),
      companyId,
    });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div>
          <h1 className="text-2xl font-bold">NN6 — 註冊非香港公司更改公司秘書及董事申報表 (委任╱停任)</h1>
          <p className="text-sm text-muted-foreground">Return of Change of Company Secretary and Director of Registered Non-Hong Kong Company (Appointment╱Cessation)</p>
        </div>
      </div>

      <FormHistorySelector formType="NN6" onSelect={handleLoadHistory} />

      {/* ── 公司選擇器 ── */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="h-4 w-4 text-primary" />
          <Label className="font-medium">選擇公司自動填入</Label>
        </div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
          <SelectContent>
            {companies.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name} ({c.brNumber})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── 主表單 ── */}
      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* 公司資料 */}
        <div>
          <h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={brNumber} onChange={e => setBrNumber(e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={companyName} onChange={e => setCompanyName(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── 人員列表 ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">董事/秘書出任或停任</h3>
            <Button variant="outline" size="sm" onClick={addOfficer}><Plus className="h-4 w-4 mr-1" />新增人員</Button>
          </div>
          <p className="text-xs text-muted-foreground -mt-2 mb-3">多於兩名同類人士時，表格會自動加附續頁；每名委任自然人自動附加一頁 PI-NN6 受保護資料。</p>

          {officers.map((officer, idx) => (
            <div key={idx} className="border border-border rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">
                  人員 #{idx + 1}
                  <span className="ml-2 text-xs text-muted-foreground">{pageHintFor(officer)}</span>
                </span>
                {officers.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeOfficer(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 基本選項 */}
                <div>
                  <Label>變更類型</Label>
                  <Select value={officer.type} onValueChange={v => updateOfficer(idx, 'type', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="appointment">委任 Appointment</SelectItem>
                      <SelectItem value="cessation">停任 Cessation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>職位</Label>
                  <Select value={officer.role} onValueChange={v => updateOfficer(idx, 'role', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="director">董事 Director</SelectItem>
                      <SelectItem value="alternate">候補董事 Alternate Director</SelectItem>
                      <SelectItem value="secretary">公司秘書 Secretary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>身分</Label>
                  <Select value={officer.identity} onValueChange={v => updateOfficer(idx, 'identity', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="natural">自然人 Natural Person</SelectItem>
                      <SelectItem value="corporate">法人團體 Body Corporate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{officer.type === 'appointment' ? '委任日期' : '停任日期'}</Label>
                  <Input
                    type="date"
                    value={officer.type === 'appointment' ? officer.dateAppointed : officer.dateCeased}
                    onChange={e => updateOfficer(idx, officer.type === 'appointment' ? 'dateAppointed' : 'dateCeased', e.target.value)}
                    className="mt-1"
                  />
                </div>

                {/* ══════ 自然人 ══════ */}
                {officer.identity === 'natural' ? (
                  <>
                    {selectedCompany && (
                      <div className="col-span-2">
                        <PersonQuickPick companyId={selectedCompanyId}
                          onPick={(d) => {
                            updateOfficer(idx, 'nameChinese', d.nameChinese || '');
                            updateOfficer(idx, 'nameSurname', d.surname || '');
                            updateOfficer(idx, 'nameOtherNames', d.otherNames || '');
                            updateOfficer(idx, 'nameEnglish', [d.surname, d.otherNames].filter(Boolean).join(' '));
                            if (d.idNumber) updateOfficer(idx, 'idNumber', d.idNumber);
                            if (d.addrFlat) updateOfficer(idx, 'addrFlatBlock', d.addrFlat);
                            if (d.addrBuilding) updateOfficer(idx, 'addrBuilding', d.addrBuilding);
                            if (d.addrStreet) updateOfficer(idx, 'addrStreetEstate', d.addrStreet);
                            if (d.addrDistrict) updateOfficer(idx, 'addrDistrict', d.addrDistrict);
                            if (d.addrRegion) updateOfficer(idx, 'addrRegion', d.addrRegion);
                          }}
                        />
                      </div>
                    )}
                    <div><Label>中文姓名</Label><Input value={officer.nameChinese} onChange={e => updateOfficer(idx, 'nameChinese', e.target.value)} className="mt-1" /></div>
                    <div>
                      <Label>英文姓名</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                        <Input placeholder="姓氏 Surname" value={officer.nameSurname} onChange={e => updateOfficer(idx, 'nameSurname', e.target.value)} />
                        <Input placeholder="名字 Other Names" value={officer.nameOtherNames} onChange={e => updateOfficer(idx, 'nameOtherNames', e.target.value)} />
                      </div>
                    </div>
                    {officer.role === 'alternate' && (
                      <div><Label>代替人</Label><Input placeholder="代替哪位董事 Alternate to" value={officer.alternateTo} onChange={e => updateOfficer(idx, 'alternateTo', e.target.value)} className="mt-1" /></div>
                    )}

                    {/* 委任自然人：前用姓名 / 別名（P.2/P.5 獨有欄位） */}
                    {officer.type === 'appointment' && (
                      <>
                        <div className="col-span-2">
                          <label className="flex items-center gap-2 cursor-pointer mb-2">
                            <input
                              type="checkbox"
                              checked={officer.hasFormerName}
                              onChange={e => updateOfficer(idx, 'hasFormerName', e.target.checked)}
                            />
                            <Label className="cursor-pointer">有前用姓名 Previous Names</Label>
                          </label>
                          {officer.hasFormerName && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ml-6 pl-4 border-l-2 border-border">
                              <div>
                                <Label className="text-xs text-muted-foreground">前用姓名 中文</Label>
                                <Input value={officer.formerNameChinese} onChange={e => updateOfficer(idx, 'formerNameChinese', e.target.value)} className="mt-1" />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">前用姓名 英文</Label>
                                <Input value={officer.formerNameEnglish} onChange={e => updateOfficer(idx, 'formerNameEnglish', e.target.value)} className="mt-1" />
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="col-span-2">
                          <label className="flex items-center gap-2 cursor-pointer mb-2">
                            <input
                              type="checkbox"
                              checked={officer.hasAlias}
                              onChange={e => updateOfficer(idx, 'hasAlias', e.target.checked)}
                            />
                            <Label className="cursor-pointer">有別名 Alias</Label>
                          </label>
                          {officer.hasAlias && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ml-6 pl-4 border-l-2 border-border">
                              <div>
                                <Label className="text-xs text-muted-foreground">別名 中文</Label>
                                <Input value={officer.aliasChinese} onChange={e => updateOfficer(idx, 'aliasChinese', e.target.value)} className="mt-1" />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">別名 英文</Label>
                                <Input value={officer.aliasEnglish} onChange={e => updateOfficer(idx, 'aliasEnglish', e.target.value)} className="mt-1" />
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* 證件 */}
                    <div><Label>香港身份證號碼 HKID</Label><Input value={officer.idNumber} onChange={e => updateOfficer(idx, 'idNumber', e.target.value)} className="mt-1" placeholder="A123456" /></div>
                    {officer.type === 'appointment' && (
                      <div><Label>護照簽發國家／地區</Label><Input value={officer.passportCountry} onChange={e => updateOfficer(idx, 'passportCountry', e.target.value)} className="mt-1" placeholder="如：HKSAR" /></div>
                    )}
                    <div><Label>護照號碼 Passport Number</Label><Input value={officer.passportNumber} onChange={e => updateOfficer(idx, 'passportNumber', e.target.value)} className="mt-1" /></div>

                    {/* 委任自然人：通訊地址 + 電郵（P.2/P.5） */}
                    {officer.type === 'appointment' && (
                      <>
                        <div className="col-span-2">
                          <Label className="font-medium mb-2 block">通訊地址 Correspondence Address</Label>
                          {selectedCompanyId && (
                            <div className="mb-3">
                              <AddressQuickPick companyId={selectedCompanyId}
                                onPick={(d) => {
                                  updateOfficer(idx, 'addrFlatBlock', d.flat || '');
                                  updateOfficer(idx, 'addrBuilding', d.building || '');
                                  updateOfficer(idx, 'addrStreetEstate', d.street || '');
                                  updateOfficer(idx, 'addrDistrict', d.district || '');
                                  updateOfficer(idx, 'addrRegion', d.country || d.region || '');
                                }}
                              />
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs text-muted-foreground">室／樓／座 Flat／Floor／Block</Label>
                              <Input value={officer.addrFlatBlock} onChange={e => updateOfficer(idx, 'addrFlatBlock', e.target.value)} className="mt-1" placeholder="Flat / Floor / Block" />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">大廈 Building</Label>
                              <Input value={officer.addrBuilding} onChange={e => updateOfficer(idx, 'addrBuilding', e.target.value)} className="mt-1" placeholder="Building" />
                            </div>
                            <div className="col-span-2">
                              <Label className="text-xs text-muted-foreground">街道／屋苑／地段／村 Street／Estate／Lot／Village</Label>
                              <Input value={officer.addrStreetEstate} onChange={e => updateOfficer(idx, 'addrStreetEstate', e.target.value)} className="mt-1" placeholder="Street / Estate / Lot / Village" />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">區 District</Label>
                              <Select value={officer.addrDistrict} onValueChange={v => updateOfficer(idx, 'addrDistrict', v)}>
                                <SelectTrigger className="mt-1"><SelectValue placeholder="選擇地區..." /></SelectTrigger>
                                <SelectContent>
                                  {HK_DISTRICTS.map(d => (
                                    <SelectItem key={d} value={d}>{d}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">國家／地區 Country／Region</Label>
                              <Input value={officer.addrRegion} onChange={e => updateOfficer(idx, 'addrRegion', e.target.value)} className="mt-1" placeholder="e.g. 香港" list="nn6-region-suggestions" />
                              <datalist id="nn6-region-suggestions">
                                <option value="Hong Kong 香港" />
                                <option value="Kowloon 九龍" />
                                <option value="New Territories 新界" />
                                <option value="Mainland China 中國內地" />
                                <option value="Macau 澳門" />
                                <option value="Taiwan 台灣" />
                                <option value="BVI" />
                                <option value="Cayman Islands" />
                                <option value="Bermuda" />
                                <option value="Singapore 新加坡" />
                                <option value="United Kingdom 英國" />
                                <option value="United States 美國" />
                                <option value="Other 其他" />
                              </datalist>
                            </div>
                          </div>
                        </div>
                        <div className="col-span-2">
                          <Label>電郵地址 Email Address</Label>
                          <Input value={officer.email} onChange={e => updateOfficer(idx, 'email', e.target.value)} className="mt-1" type="email" placeholder="email@example.com" />
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  /* ══════ 法人 ══════ */
                  <>
                    <div><Label>中文名稱</Label><Input value={officer.nameChinese} onChange={e => updateOfficer(idx, 'nameChinese', e.target.value)} className="mt-1" /></div>
                    <div><Label>英文名稱</Label><Input value={officer.companyName || officer.nameEnglish} onChange={e => updateOfficer(idx, 'companyName', e.target.value)} className="mt-1" /></div>
                    {officer.role === 'alternate' && (
                      <div><Label>代替人</Label><Input placeholder="代替哪位董事 Alternate to" value={officer.alternateTo} onChange={e => updateOfficer(idx, 'alternateTo', e.target.value)} className="mt-1" /></div>
                    )}

                    {/* 委任法人：通訊地址 + 電郵 + 商業登記號碼（P.3/P.6） */}
                    {officer.type === 'appointment' && (
                      <>
                        <div className="col-span-2">
                          <Label className="font-medium mb-2 block">通訊地址 Correspondence Address</Label>
                          {selectedCompanyId && (
                            <div className="mb-3">
                              <AddressQuickPick companyId={selectedCompanyId}
                                onPick={(d) => {
                                  updateOfficer(idx, 'addrFlatBlock', d.flat || '');
                                  updateOfficer(idx, 'addrBuilding', d.building || '');
                                  updateOfficer(idx, 'addrStreetEstate', d.street || '');
                                  updateOfficer(idx, 'addrDistrict', d.district || '');
                                  updateOfficer(idx, 'addrRegion', d.country || d.region || '');
                                }}
                              />
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs text-muted-foreground">室／樓／座 Flat／Floor／Block</Label>
                              <Input value={officer.addrFlatBlock} onChange={e => updateOfficer(idx, 'addrFlatBlock', e.target.value)} className="mt-1" placeholder="Flat / Floor / Block" />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">大廈 Building</Label>
                              <Input value={officer.addrBuilding} onChange={e => updateOfficer(idx, 'addrBuilding', e.target.value)} className="mt-1" placeholder="Building" />
                            </div>
                            <div className="col-span-2">
                              <Label className="text-xs text-muted-foreground">街道／屋苑／地段／村 Street／Estate／Lot／Village</Label>
                              <Input value={officer.addrStreetEstate} onChange={e => updateOfficer(idx, 'addrStreetEstate', e.target.value)} className="mt-1" placeholder="Street / Estate / Lot / Village" />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">區 District</Label>
                              <Select value={officer.addrDistrict} onValueChange={v => updateOfficer(idx, 'addrDistrict', v)}>
                                <SelectTrigger className="mt-1"><SelectValue placeholder="選擇地區..." /></SelectTrigger>
                                <SelectContent>
                                  {HK_DISTRICTS.map(d => (
                                    <SelectItem key={d} value={d}>{d}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">國家／地區 Country／Region</Label>
                              <Input value={officer.addrRegion} onChange={e => updateOfficer(idx, 'addrRegion', e.target.value)} className="mt-1" placeholder="e.g. 香港" list="nn6-region-suggestions" />
                            </div>
                          </div>
                        </div>
                        <div>
                          <Label>電郵地址 Email Address</Label>
                          <Input value={officer.email} onChange={e => updateOfficer(idx, 'email', e.target.value)} className="mt-1" type="email" placeholder="email@example.com" />
                        </div>
                        <div>
                          <Label>商業登記號碼 Business Registration Number</Label>
                          <Input value={officer.companyNumber} onChange={e => updateOfficer(idx, 'companyNumber', e.target.value)} className="mt-1" placeholder="e.g. 12345678" />
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* 委任：是否已是現任董事 */}
                {officer.type === 'appointment' && (
                  <div className="col-span-2">
                    <Label className="mb-2 block">
                      上述董事或候補董事在獲得這次委任時，是否已經是這公司的現任候補董事或董事？
                      <br />
                      <span className="text-xs text-muted-foreground">
                        Is this director or alternate director already an existing alternate director or director in this company at the time of this appointment?
                      </span>
                    </Label>
                    <div className="flex gap-6">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`alreadyDirector-${idx}`}
                          checked={officer.alreadyDirector === 'yes'}
                          onChange={() => updateOfficer(idx, 'alreadyDirector', 'yes')}
                        />
                        <span>是 Yes</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`alreadyDirector-${idx}`}
                          checked={officer.alreadyDirector === 'no'}
                          onChange={() => updateOfficer(idx, 'alreadyDirector', 'no')}
                        />
                        <span>否 No</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* 停任：停任後是否仍然擔任（公司秘書免填） */}
                {officer.type === 'cessation' && officer.role !== 'secretary' && (
                  <div className="col-span-2">
                    <Label className="mb-2 block">
                      上述董事或候補董事在停任日期後，是否仍然擔任這公司的候補董事或董事職位？
                      <br />
                      <span className="text-xs text-muted-foreground">
                        Will this director or alternate director continue to hold office as alternate director or director in this company after the date of cessation?
                      </span>
                    </Label>
                    <div className="flex gap-6">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`stillHoldsOffice-${idx}`}
                          checked={officer.stillHoldsOffice === 'yes'}
                          onChange={() => updateOfficer(idx, 'stillHoldsOffice', 'yes')}
                        />
                        <span>是 Yes</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`stillHoldsOffice-${idx}`}
                          checked={officer.stillHoldsOffice !== 'yes'}
                          onChange={() => updateOfficer(idx, 'stillHoldsOffice', 'no')}
                        />
                        <span>否 No</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── 簽署及提交人 ── */}
        <div>
          <h3 className="font-semibold mb-3">簽署及提交人（P.3 第6項）</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>簽署人</Label>
              {selectedCompany && companyOfficers.length > 0 ? (
                <div className="space-y-2 mt-1">
                  <Select
                    value={signerId || '__auto__'}
                    onValueChange={v => {
                      if (v === '__auto__') { setSignerId(''); const s = selectedCompany.secretaries[0] || selectedCompany.directors[0]; setSignerName(s ? (s.nameEnglish || s.nameChinese || '') : ''); }
                      else if (v === '__manual__') { setSignerId('__manual__'); setSignerName(''); }
                      else {
                        setSignerId(v);
                        const o = companyOfficers.find(x => x.id === v);
                        setSignerName(o ? (o.nameEnglish || o.nameChinese || '') : '');
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="自動選擇（首個秘書 → 首個董事）" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">自動選擇（首個秘書 → 首個董事）</SelectItem>
                      {selectedCompany.directors.map(d => (
                        <SelectItem key={d.id} value={d.id}>🧑‍💼 董事：{d.nameEnglish || d.nameChinese}</SelectItem>
                      ))}
                      {selectedCompany.secretaries.map(s => (
                        <SelectItem key={s.id} value={s.id}>📋 秘書：{s.nameEnglish || s.nameChinese}</SelectItem>
                      ))}
                      <SelectItem value="__manual__">✏️ 手動輸入...</SelectItem>
                    </SelectContent>
                  </Select>
                  {signerId !== '__manual__' && (
                    <Input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="簽署人姓名（可手動修改）" />
                  )}
                </div>
              ) : (
                <Input value={signerName} onChange={e => setSignerName(e.target.value)} className="mt-1" placeholder="簽署人姓名" />
              )}
              {!selectedCompany && (
                <p className="text-xs text-muted-foreground mt-1">請先選擇公司，即可從其董事/秘書中選取簽署人</p>
              )}
            </div>
            <div><Label>簽署日期</Label><Input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} className="mt-1" /></div>
            <div className="col-span-2">
              <Label className="text-xs font-medium mb-1 block">簽署人身份 Capacity of Signatory <span className="text-muted-foreground">（點擊選擇一個身份，其他畫橫線刪去）</span></Label>
              <div className="flex flex-wrap gap-2">
                {([
                  { key: 'director', label: '董事 Director' },
                  { key: 'secretary', label: '公司秘書 Company Secretary' },
                  { key: 'manager', label: '經理 Manager' },
                  { key: 'authorizedRep', label: '獲授權代表 Authorized Representative' },
                ] as const).map(cap => {
                  const isSelected = signerCapacity === cap.key;
                  const isStrikethrough = signerCapacity && signerCapacity !== cap.key;
                  return (
                    <button key={cap.key} type="button"
                      className={`px-3 py-1.5 rounded-md text-xs border transition-all ${
                        isSelected ? 'bg-blue-600 text-white border-blue-600 font-semibold' :
                        isStrikethrough ? 'bg-muted text-muted-foreground border-border line-through' :
                        'bg-background border-border hover:bg-accent'
                      }`}
                      onClick={() => setSignerCapacity(isSelected ? '' : cap.key)}
                    >
                      {cap.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── 提交人 ── */}
        <div>
          <h3 className="font-semibold mb-3">提交人資料（P.1 第4項）</h3>
          <div className="mb-4">
            <PresenterSelector companyId={selectedCompanyId}
              currentData={{ name: presentorName, address: presentorAddress, phone: presentorPhone, fax: presentorFax, email: presentorEmail, reference: presentorReference }}
              onSelect={(p: Presenter) => {
                setPresentorName(p.name);
                setPresentorAddress(p.address);
                setPresentorPhone(p.phone);
                setPresentorFax(p.fax);
                setPresentorEmail(p.email);
                setPresentorReference(p.reference);
              }}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>提交人名稱</Label><Input value={presentorName} onChange={e => setPresentorName(e.target.value)} className="mt-1" /></div>
            <div><Label>提交人地址</Label><Input value={presentorAddress} onChange={e => setPresentorAddress(e.target.value)} className="mt-1" /></div>
            <div><Label>電話 Tel</Label><Input value={presentorPhone} onChange={e => setPresentorPhone(e.target.value)} className="mt-1" /></div>
            <div><Label>傳真 Fax</Label><Input value={presentorFax} onChange={e => setPresentorFax(e.target.value)} className="mt-1" /></div>
            <div><Label>電郵 Email</Label><Input value={presentorEmail} onChange={e => setPresentorEmail(e.target.value)} className="mt-1" /></div>
            <div><Label>參考編號 Ref</Label><Input value={presentorReference} onChange={e => setPresentorReference(e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── 生成按鈕 ── */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={() => handleGenerate(false)} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN6 PDF</>}
          </Button>
          <Button variant="outline" onClick={() => handleGenerate(true)} disabled={generating}>生成測試 PDF（Debug）</Button>
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
          if (p) doGenerate(false, p.companyId);
        }}
      />
    </div>
  );
}
