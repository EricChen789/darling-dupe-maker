import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ArrowLeft, Download, Loader2, Building2, Bug } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import { useQueryClient } from '@tanstack/react-query';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import AddressQuickPick from './AddressQuickPick';
import RelatedFormsPrompt from './RelatedFormsPrompt';
import ConfirmWritebackDialog from './ConfirmWritebackDialog';
import type { Presenter } from '@/hooks/usePresenters';
import { resolveCompanyId, buildNN9Summary, writebackNN9, errText, type WritebackSummaryItem } from '@/lib/formWriteback';

interface NN9GeneratorFormProps { onBack: () => void; initialCompanyId?: string; }

const HK_DISTRICTS = [
  '中西區', '灣仔', '東區', '南區',
  '油尖旺', '深水埗', '九龍城', '黃大仙', '觀塘',
  '葵青', '荃灣', '屯門', '元朗',
  '北區', '大埔', '沙田', '西貢', '離島',
];

const todayStr = () => {
  const t = new Date();
  return {
    dd: String(t.getDate()).padStart(2, '0'),
    mm: String(t.getMonth() + 1).padStart(2, '0'),
    yyyy: String(t.getFullYear()),
  };
};

/** 日/月/年 三元组输入（NN9 日期均为 D/M/Y 分格） */
function DateTriple({ dayKey, monthKey, yearKey, values, onChange }: {
  dayKey: string; monthKey: string; yearKey: string;
  values: Record<string, string>; onChange: (f: string, v: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div><Label className="text-xs">日 DD</Label><Input value={values[dayKey] ?? ''} onChange={e => onChange(dayKey, e.target.value)} className="mt-1" /></div>
      <div><Label className="text-xs">月 MM</Label><Input value={values[monthKey] ?? ''} onChange={e => onChange(monthKey, e.target.value)} className="mt-1" /></div>
      <div><Label className="text-xs">年 YYYY</Label><Input value={values[yearKey] ?? ''} onChange={e => onChange(yearKey, e.target.value)} className="mt-1" /></div>
    </div>
  );
}

/** 5 行地址输入（室/大廈/街道/區/國家） */
function AddressRows({ prefix, values, onChange }: {
  prefix: string; values: Record<string, string>; onChange: (f: string, v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div><Label className="text-xs text-muted-foreground">室／樓／座 Flat/Block</Label><Input value={values[`${prefix}Flat`] ?? ''} onChange={e => onChange(`${prefix}Flat`, e.target.value)} placeholder="Room 1001, 10/F" className="mt-1" /></div>
      <div><Label className="text-xs text-muted-foreground">大廈／屋苑 Building/Estate</Label><Input value={values[`${prefix}Building`] ?? ''} onChange={e => onChange(`${prefix}Building`, e.target.value)} placeholder="ABC Building" className="mt-1" /></div>
      <div className="col-span-2"><Label className="text-xs text-muted-foreground">街道／地段 Street</Label><Input value={values[`${prefix}Street`] ?? ''} onChange={e => onChange(`${prefix}Street`, e.target.value)} placeholder="1 Queensway" className="mt-1" /></div>
      <div><Label className="text-xs text-muted-foreground">區 District</Label><Input value={values[`${prefix}District`] ?? ''} onChange={e => onChange(`${prefix}District`, e.target.value)} placeholder="e.g. Central" className="mt-1" /></div>
      <div><Label className="text-xs text-muted-foreground">國家／地區 Country</Label><Input value={values[`${prefix}Country`] ?? ''} onChange={e => onChange(`${prefix}Country`, e.target.value)} placeholder="e.g. Japan" className="mt-1" /></div>
    </div>
  );
}

export default function NN9GeneratorForm({ onBack, initialCompanyId }: NN9GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );
  const [generating, setGenerating] = useState(false);
  const [showRelatedPrompt, setShowRelatedPrompt] = useState(false);
  const [relatedLinkages, setRelatedLinkages] = useState<any[]>([]);
  const [pendingWriteback, setPendingWriteback] = useState<{ title: string; summary: WritebackSummaryItem[]; companyId: string | null } | null>(null);
  const { mutate: saveFormHistory } = useSaveFormHistory();
  const queryClient = useQueryClient();

  const t = todayStr();
  const [formData, setFormData] = useState<Record<string, string>>({
    brNumber: '', companyName: '',
    // P.1 2(a) 在香港的主要營業地點新地址
    flat: '', building: '', street: '', district: '', region: '',
    addressDay: t.dd, addressMonth: t.mm, addressYear: t.yyyy,
    // P.1 2(b) 新電郵
    newEmail: '', emailDay: '', emailMonth: '', emailYear: '',
    // P.1 2(c) 新香港電話
    newPhone: '', phoneDay: '', phoneMonth: '', phoneYear: '',
    // P.2 3(a) 成立地註冊辦事處新地址
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regCountry: '',
    regDay: '', regMonth: '', regYear: '',
    // P.2 3(b) 成立地主要營業地點新地址
    bizFlat: '', bizBuilding: '', bizStreet: '', bizDistrict: '', bizCountry: '',
    bizDay: '', bizMonth: '', bizYear: '',
    // P.2 3(c) 新電郵
    ovEmail: '', ovDay: '', ovMonth: '', ovYear: '',
    // 簽署
    signerName: '', signerCapacity: 'director',
    signDateDay: t.dd, signDateMonth: t.mm, signDateYear: t.yyyy,
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

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId, companies.length]);

  const update = (f: string, v: string) => setFormData(prev => ({ ...prev, [f]: v }));

  const handleLoadHistory = (data: any) => {
    if (data.formData) {
      // 舊版 history 兼容：changeDay→addressDay、resolutionDay→emailDay
      setFormData((prev: any) => ({
        ...prev, ...data.formData,
        addressDay: data.formData.addressDay ?? data.formData.changeDay ?? prev.addressDay,
        addressMonth: data.formData.addressMonth ?? data.formData.changeMonth ?? prev.addressMonth,
        addressYear: data.formData.addressYear ?? data.formData.changeYear ?? prev.addressYear,
        emailDay: data.formData.emailDay ?? data.formData.resolutionDay ?? prev.emailDay,
        emailMonth: data.formData.emailMonth ?? data.formData.resolutionMonth ?? prev.emailMonth,
        emailYear: data.formData.emailYear ?? data.formData.resolutionYear ?? prev.emailYear,
      }));
    }
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
  };

  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) { toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return; }
    const hkAddr = [formData.flat, formData.building, formData.street].some(v => String(v ?? '').trim());
    const regAddr = [formData.regFlat, formData.regBuilding, formData.regStreet].some(v => String(v ?? '').trim());
    const bizAddr = [formData.bizFlat, formData.bizBuilding, formData.bizStreet].some(v => String(v ?? '').trim());
    if (!hkAddr && !regAddr && !bizAddr) { toast({ title: '錯誤', description: '請填寫新地址（香港或成立地）', variant: 'destructive' }); return; }
    const companyId = await resolveCompanyId(formData.brNumber, selectedCompanyId || undefined);
    setPendingWriteback({
      title: 'NN9 生成確認',
      summary: buildNN9Summary(formData as any),
      companyId,
    });
  };

  const doGenerate = async (debug = false, writebackCompanyId?: string | null) => {
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const resp = await fetch(`/api/generate-nn9-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...formData, debug }),
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

      // 寫回資料庫（PDF 成功才寫；放在「生成成功」toast 之後，TOAST_LIMIT=1 順序與人事表單一致）
      if (writebackCompanyId) {
        try {
          const labels = await writebackNN9(writebackCompanyId, formData as any);
          queryClient.invalidateQueries({ queryKey: ['companies'] });
          const warns = labels.filter(l => l.startsWith('⚠'));
          if (labels.length > 0) toast({ title: '已同步資料庫', description: labels.join('；') });
          if (warns.length > 0) toast({ title: '部分寫回未完成', description: warns.join('；'), variant: 'destructive' });
        } catch (e: any) {
          toast({ title: '資料庫寫回失敗', description: errText(e), variant: 'destructive' });
        }
      }
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">2(a) 在香港的主要營業地點的新地址 New Address of Principal Place of Business in Hong Kong</h3>
          {selectedCompanyId && (
            <div className="mb-3">
              <AddressQuickPick companyId={selectedCompanyId}
                onPick={(d) => {
                  if (d.flat) update('flat', d.flat);
                  if (d.building) update('building', d.building);
                  if (d.street) update('street', d.street);
                  if (d.district) update('district', d.district);
                  if (d.country || d.region) update('region', d.country || d.region || '');
                }}
              />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div><Label className="text-xs text-muted-foreground">生效日期 Effective Date</Label>
              <DateTriple dayKey="addressDay" monthKey="addressMonth" yearKey="addressYear" values={formData} onChange={update} />
            </div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">2(b) 新電郵地址 New Email Address（如適用）</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>電郵地址</Label><Input value={formData.newEmail} onChange={e => update('newEmail', e.target.value)} placeholder="如無變更可留空" className="mt-1" /></div>
            {String(formData.newEmail ?? '').trim() && (
              <div><Label className="text-xs">生效日期 Effective Date</Label>
                <DateTriple dayKey="emailDay" monthKey="emailMonth" yearKey="emailYear" values={formData} onChange={update} />
              </div>
            )}
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">2(c) 新香港聯絡電話號碼 New Hong Kong Telephone Number（如適用）</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>電話號碼</Label><Input value={formData.newPhone} onChange={e => update('newPhone', e.target.value)} placeholder="如無變更可留空" className="mt-1" /></div>
            {String(formData.newPhone ?? '').trim() && (
              <div><Label className="text-xs">生效日期 Effective Date</Label>
                <DateTriple dayKey="phoneDay" monthKey="phoneMonth" yearKey="phoneYear" values={formData} onChange={update} />
              </div>
            )}
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">3(a) 在成立為法團的地方的註冊辦事處的新地址 New Address of Registered Office in Place of Incorporation</h3>
          <AddressRows prefix="reg" values={formData} onChange={update} />
          <div className="mt-3 sm:max-w-xs"><Label className="text-xs">生效日期 Effective Date</Label>
            <DateTriple dayKey="regDay" monthKey="regMonth" yearKey="regYear" values={formData} onChange={update} />
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">3(b) 在成立為法團的地方的主要營業地點的新地址 New Address of Principal Place of Business in Place of Incorporation</h3>
          <AddressRows prefix="biz" values={formData} onChange={update} />
          <div className="mt-3 sm:max-w-xs"><Label className="text-xs">生效日期 Effective Date</Label>
            <DateTriple dayKey="bizDay" monthKey="bizMonth" yearKey="bizYear" values={formData} onChange={update} />
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">3(c) 新電郵地址 New Email Address（成立地，如適用）</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>電郵地址</Label><Input value={formData.ovEmail} onChange={e => update('ovEmail', e.target.value)} placeholder="如無變更可留空" className="mt-1" /></div>
            {String(formData.ovEmail ?? '').trim() && (
              <div><Label className="text-xs">生效日期 Effective Date</Label>
                <DateTriple dayKey="ovDay" monthKey="ovMonth" yearKey="ovYear" values={formData} onChange={update} />
              </div>
            )}
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">簽署</h3>
          {selectedCompany && ((selectedCompany.directors?.length ?? 0) > 0 || (selectedCompany.secretaries?.length ?? 0) > 0) && (
            <div className="mb-3">
              <Select onValueChange={(id) => {
                const allPeople = [
                  ...(selectedCompany.directors || []).map(d => ({ ...d, _role: 'director' as const })),
                  ...(selectedCompany.secretaries || []).map(s => ({ ...s, _role: 'secretary' as const })),
                ];
                const person = allPeople.find(p => p.id === id);
                if (person) {
                  update('signerName', person.nameEnglish || person.nameChinese || '');
                  update('signerCapacity', person._role);
                }
              }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="從公司人員選擇簽署人..." /></SelectTrigger>
                <SelectContent>
                  {(selectedCompany.directors || []).map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.nameEnglish || d.nameChinese || '?'} — 董事</SelectItem>
                  ))}
                  {(selectedCompany.secretaries || []).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.nameEnglish || s.nameChinese || '?'} — 公司秘書</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>簽署人姓名</Label><Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">簽署日期 Date of Signature</Label>
              <DateTriple dayKey="signDateDay" monthKey="signDateMonth" yearKey="signDateYear" values={formData} onChange={update} />
            </div>
          </div>
        </div>

        <div><h3 className="font-semibold mb-3">簽署人身份（刪去不適用者）</h3>
          <RadioGroup
            value={formData.signerCapacity}
            onValueChange={(v) => update('signerCapacity', v)}
            className="flex flex-wrap gap-6"
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="director" />
              <span>董事 Director</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="secretary" />
              <span>公司秘書 Company Secretary</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="manager" />
              <span>經理 Manager</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="authorizedRep" />
              <span>獲授權代表 Authorized Representative</span>
            </label>
          </RadioGroup>
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
          <Button variant="outline" onClick={() => doGenerate(true)} disabled={generating}>
            <Bug className="h-4 w-4 mr-2" />生成測試 PDF（Debug）
          </Button>
        </div>
      </div>

      <ConfirmWritebackDialog
        open={!!pendingWriteback}
        title={pendingWriteback?.title || ''}
        summary={pendingWriteback?.summary || []}
        canWrite={!!pendingWriteback?.companyId}
        onConfirm={() => {
          const companyId = pendingWriteback?.companyId || null;
          setPendingWriteback(null);
          doGenerate(false, companyId);
        }}
        onCancel={() => setPendingWriteback(null)}
      />

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
