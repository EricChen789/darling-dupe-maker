import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import { ArrowLeft, Download, Loader2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { Person } from '@/types';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import PresenterSelector from './PresenterSelector';
import type { Presenter } from '@/hooks/usePresenters';
import AddressQuickPick from './AddressQuickPick';
import ConfirmWritebackDialog from './ConfirmWritebackDialog';
import { resolveCompanyId, buildNN7Summary, writebackNN7, type WritebackSummaryItem } from '@/lib/formWriteback';

// ── 香港 18 區（繁體，用於下拉選單） ──
const HK_DISTRICTS = [
  '中西區', '灣仔', '東區', '南區',
  '油尖旺', '深水埗', '九龍城', '黃大仙',
  '觀塘', '葵青', '荃灣', '屯門',
  '元朗', '北區', '大埔', '沙田',
  '西貢', '離島',
];

const HK_REGIONS = ['香港', '九龍', '新界'];

// ── 模組級別 AddressFields（memo 避免 re-render 失焦） ──
interface AddressValues {
  flat: string;
  building: string;
  street: string;
  district: string;
  region: string;
}

function AddressFields({
  label,
  values,
  onChange,
}: {
  label: string;
  values: AddressValues;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <div>
      <Label className="font-medium mb-2 block">{label}</Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">室／樓層 Flat／Room</Label>
          <Input
            value={values.flat}
            onChange={e => onChange('flat', e.target.value)}
            className="mt-1" placeholder="Flat / Room"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">座／大廈 Block／Building</Label>
          <Input
            value={values.building}
            onChange={e => onChange('building', e.target.value)}
            className="mt-1" placeholder="Block / Building"
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">街道／屋苑 Street／Estate</Label>
          <Input
            value={values.street}
            onChange={e => onChange('street', e.target.value)}
            className="mt-1" placeholder="Street / Estate"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">區 District</Label>
          <Select value={values.district} onValueChange={v => onChange('district', v)}>
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
          <Input
            value={values.region}
            onChange={e => onChange('region', e.target.value)}
            className="mt-1" placeholder="e.g. 香港"
          />
        </div>
      </div>
    </div>
  );
}

// ── NN7GeneratorForm ──
interface NN7GeneratorFormProps {
  onBack: () => void;
  prefillPerson?: Person | null;
  initialCompanyId?: string;
}

export default function NN7GeneratorForm({ onBack, prefillPerson, initialCompanyId }: NN7GeneratorFormProps) {
  const { data: allCompanies = [] } = useCompanies();
  const { mutate: saveFormHistory } = useSaveFormHistory();
  const queryClient = useQueryClient();

  const companies = prefillPerson?.companies?.length
    ? allCompanies.filter(c => prefillPerson.companies.some(pc => pc.id === c.id))
    : allCompanies;

  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  // 寫回確認框：生成前彈出（含公司解析結果與摘要）
  const [pendingWriteback, setPendingWriteback] = useState<{ title: string; summary: WritebackSummaryItem[]; companyId: string | null } | null>(null);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [formData, setFormData] = useState({
    brNumber: '',
    companyName: '',
    role: (prefillPerson?.role === 'secretary' ? 'secretary' : 'director') as 'secretary' | 'director',
    identity: (prefillPerson?.identity || 'natural') as 'natural' | 'corporate',
    nameEnglish: prefillPerson?.nameEnglish || '',
    nameSurname: '',
    nameOtherNames: prefillPerson?.nameEnglish || '',
    nameChinese: prefillPerson?.nameChinese || '',
    idNumber: prefillPerson?.idNumber || '',
    passportNumber: prefillPerson?.passportNumber || '',
    // 現有通訊地址
    addrFlat: prefillPerson?.addrFlat || '',
    addrBlock: '',
    addrBuilding: prefillPerson?.addrBuilding || '',
    addrStreet: prefillPerson?.addrStreet || '',
    addrDistrict: prefillPerson?.addrDistrict || '',
    addrRegion: prefillPerson?.addrRegion || '',
    // 變更類型
    changeType: 'address' as 'address' | 'name' | 'id' | 'other',
    // 新名稱
    newNameEnglish: '',
    newNameChinese: '',
    // 新證件
    newIdNumber: '',
    // 新通訊地址
    newFlat: '',
    newBlock: '',
    newBuilding: '',
    newStreet: '',
    newDistrict: '',
    newRegion: '',
    newEmail: '',
    newPhone: '',
    passportPlaceOfIssue: '',
    // 變更說明
    changeDescription: '',
    effectiveDate: todayStr,
    // 簽署及提交
    signerName: '',
    signDate: todayStr,
    presentorName: '',
    presentorAddress: '',
    presentorPhone: '',
    presentorFax: '',
    presentorEmail: '',
    presentorReference: '',
  });

  // Stable address values for AddressFields (prevents focus loss from inline component)
  const addrValues = useMemo<AddressValues>(() => ({
    flat: formData.addrFlat,
    building: formData.addrBuilding,
    street: formData.addrStreet,
    district: formData.addrDistrict,
    region: formData.addrRegion,
  }), [formData.addrFlat, formData.addrBuilding, formData.addrStreet, formData.addrDistrict, formData.addrRegion]);

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

  const update = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleLoadHistory = (data: any) => {
    if (data.formData) {
      const fd = { ...data.formData };
      // 如果有 nameEnglish 但没有 surname/otherNames，自动拆分
      if (fd.nameEnglish && !fd.nameSurname && !fd.nameOtherNames) {
        const parts = fd.nameEnglish.trim().split(/\s+/);
        fd.nameSurname = parts[0] || '';
        fd.nameOtherNames = parts.slice(1).join(' ');
      }
      setFormData(prev => ({ ...prev, ...fd }));
    }
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
  };

  // ── PDF 成功後寫回資料庫 + 刷新查詢 + 結果 toast ──
  const runWriteback = async (companyId: string) => {
    try {
      const labels = await writebackNN7(companyId, formData as any);
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['persons-list'] });
      const warns = labels.filter(l => l.startsWith('⚠'));
      if (labels.length > 0) toast({ title: '已同步資料庫', description: labels.join('；') });
      if (warns.length > 0) toast({ title: '部分寫回未完成', description: warns.join('；'), variant: 'destructive' });
    } catch (e: any) {
      toast({ title: '資料庫寫回失敗', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  // ── 生成主體：PDF 成功下載後才寫回資料庫 ──
  const doGenerate = async (writebackCompanyId?: string | null) => {
    if (!formData.brNumber || !formData.companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    if (!formData.nameEnglish && !formData.nameChinese && !formData.nameSurname && !formData.nameOtherNames) {
      toast({ title: '錯誤', description: '請填寫人員姓名', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      // 組合英文姓名: Surname + Other Names
      const nameEnglish = [formData.nameSurname, formData.nameOtherNames].filter(Boolean).join(' ') || formData.nameEnglish;
      const payload = { ...formData, nameEnglish };
      const resp = await fetch(`/api/generate-nn7-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);

      downloadBase64Pdf(result.pdf, `NN7-${formData.companyName || 'form'}.pdf`);
      saveFormHistory(
        { formType: 'NN7', formData: { formData, selectedCompanyId } },
        {
          onError: (err: any) => {
            toast({ title: '歷史儲存失敗', description: err.message, variant: 'destructive' });
          },
        }
      );
      toast({ title: '生成成功', description: 'NN7 表格已下載' });

      // 寫回資料庫（PDF 成功才寫，避免半寫狀態）
      if (writebackCompanyId) {
        await runWriteback(writebackCompanyId);
      }
    } catch (err: any) {
      toast({ title: '生成失敗', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  // ── 生成入口：先彈寫回確認框，確認後 doGenerate ──
  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) {
      toast({ title: '錯誤', description: '請填寫公司名稱和商業登記號碼', variant: 'destructive' });
      return;
    }
    if (!formData.nameEnglish && !formData.nameChinese && !formData.nameSurname && !formData.nameOtherNames) {
      toast({ title: '錯誤', description: '請填寫人員姓名', variant: 'destructive' });
      return;
    }
    const companyId = await resolveCompanyId(formData.brNumber, selectedCompanyId || undefined);
    setPendingWriteback({
      title: 'NN7 生成確認',
      summary: buildNN7Summary(formData as any),
      companyId,
    });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div>
          <h1 className="text-2xl font-bold">NN7 — 註冊非香港公司更改公司秘書及董事詳情申報表</h1>
          <p className="text-sm text-muted-foreground">Return of Change in Particulars of Company Secretary and Director of Registered Non-Hong Kong Company</p>
        </div>
      </div>

      <FormHistorySelector formType="NN7" onSelect={handleLoadHistory} />

      {/* Company selector */}
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

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* Company info */}
        <div>
          <h3 className="font-semibold mb-3">公司資料</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Person current info */}
        <div>
          <h3 className="font-semibold mb-3">董事/秘書現有資料</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>職位</Label>
              <Select value={formData.role} onValueChange={v => update('role', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="director">董事 Director</SelectItem>
                  <SelectItem value="secretary">公司秘書 Secretary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>身分</Label>
              <Select value={formData.identity} onValueChange={v => update('identity', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">自然人 Natural Person</SelectItem>
                  <SelectItem value="corporate">法人團體 Body Corporate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>英文姓氏 Surname</Label><Input value={formData.nameSurname} onChange={e => update('nameSurname', e.target.value)} placeholder="CHAN" className="mt-1" /></div>
            <div><Label>英文名字 Other Names</Label><Input value={formData.nameOtherNames} onChange={e => update('nameOtherNames', e.target.value)} placeholder="Tai Man" className="mt-1" /></div>
            <div><Label>中文姓名</Label><Input value={formData.nameChinese} onChange={e => update('nameChinese', e.target.value)} className="mt-1" /></div>
            <div><Label>身份證號碼</Label><Input value={formData.idNumber} onChange={e => update('idNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>護照號碼</Label><Input value={formData.passportNumber} onChange={e => update('passportNumber', e.target.value)} className="mt-1" /></div>
          </div>
          <div className="mt-4">
            <AddressFields
              label="現有通訊地址"
              values={addrValues}
              onChange={(field, value) => update(`addr${field.charAt(0).toUpperCase() + field.slice(1)}`, value)}
            />
          </div>
        </div>

        {/* Change details */}
        <div>
          <h3 className="font-semibold mb-3">變更詳情</h3>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label>變更類型</Label>
              <Select value={formData.changeType} onValueChange={v => update('changeType', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="address">住址更改 Change of Address</SelectItem>
                  <SelectItem value="name">姓名更改 Change of Name</SelectItem>
                  <SelectItem value="id">證件號碼更改 Change of ID Number</SelectItem>
                  <SelectItem value="other">其他詳情更改 Other Change of Particulars</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.changeType === 'address' && (
              <div>
                <Label className="font-medium mb-2 block">更改後的新通訊地址 *</Label>
                {selectedCompanyId && (
                  <div className="mb-3">
                    <AddressQuickPick companyId={selectedCompanyId}
                      onPick={(d) => {
                        if (d.flat) update('newFlat', d.flat);
                        if (d.building) update('newBuilding', d.building);
                        if (d.street) update('newStreet', d.street);
                        if (d.district) update('newDistrict', d.district);
                        if (d.country || d.region) update('newRegion', d.country || d.region || '');
                      }}
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* P.2: fill_19=Flat+Block合并, fill_20=Building, fill_21=Street, fill_22=District, fill_23=Region */}
                  <div>
                    <Label className="text-xs text-muted-foreground">① 室／樓層／座 Flat／Room／Block</Label>
                    <Input
                      value={formData.newFlat}
                      onChange={e => update('newFlat', e.target.value)}
                      className="mt-1" placeholder="Flat / Room / Block"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">② 大廈 Building</Label>
                    <Input
                      value={formData.newBuilding}
                      onChange={e => update('newBuilding', e.target.value)}
                      className="mt-1" placeholder="Building"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">③ 街道／屋苑 Street／Estate</Label>
                    <Input
                      value={formData.newStreet}
                      onChange={e => update('newStreet', e.target.value)}
                      className="mt-1" placeholder="Street / Estate"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">④ 區 District</Label>
                    <Select value={formData.newDistrict} onValueChange={v => update('newDistrict', v)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="選擇地區..." /></SelectTrigger>
                      <SelectContent>
                        {HK_DISTRICTS.map(d => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">⑤ 國家／地區 Country／Region</Label>
                    <Input
                      value={formData.newRegion}
                      onChange={e => update('newRegion', e.target.value)}
                      className="mt-1" placeholder="e.g. 香港"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">電郵地址 Email</Label>
                    <Input
                      value={formData.newEmail}
                      onChange={e => update('newEmail', e.target.value)}
                      className="mt-1" placeholder="new@example.com"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">電話號碼 Phone</Label>
                    <Input
                      value={formData.newPhone}
                      onChange={e => update('newPhone', e.target.value)}
                      className="mt-1" placeholder="+852 XXXX XXXX"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">護照簽發地區 Place of Issue</Label>
                    <Input
                      value={formData.passportPlaceOfIssue}
                      onChange={e => update('passportPlaceOfIssue', e.target.value)}
                      className="mt-1" placeholder="簽發地區"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">護照號碼 Passport No.</Label>
                    <Input
                      value={formData.passportNumber}
                      onChange={e => update('passportNumber', e.target.value)}
                      className="mt-1" placeholder="護照號碼"
                    />
                  </div>
                </div>
              </div>
            )}

            {formData.changeType === 'name' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><Label>新英文姓名 *</Label><Input value={formData.newNameEnglish} onChange={e => update('newNameEnglish', e.target.value)} className="mt-1" placeholder="更改後的英文姓名" /></div>
                <div><Label>新中文姓名</Label><Input value={formData.newNameChinese} onChange={e => update('newNameChinese', e.target.value)} className="mt-1" placeholder="更改後的中文姓名" /></div>
              </div>
            )}

            {formData.changeType === 'id' && (
              <div><Label>新證件號碼 *</Label><Input value={formData.newIdNumber} onChange={e => update('newIdNumber', e.target.value)} className="mt-1" placeholder="填入新證件號碼" /></div>
            )}

            {formData.changeType === 'other' && (
              <div><Label>變更說明 *</Label><Input value={formData.changeDescription} onChange={e => update('changeDescription', e.target.value)} className="mt-1" placeholder="描述需要更改的詳情內容" /></div>
            )}

            <div><Label>生效日期</Label><Input type="date" value={formData.effectiveDate} onChange={e => update('effectiveDate', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Signature & Presentor */}
        <div>
          <h3 className="font-semibold mb-3">簽署及提交人</h3>
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
            <div><Label>簽署人姓名</Label><Input value={formData.signerName} onChange={e => update('signerName', e.target.value)} className="mt-1" /></div>
            <div><Label>簽署日期</Label><Input type="date" value={formData.signDate} onChange={e => update('signDate', e.target.value)} className="mt-1" /></div>
            <div><Label>提交人名稱</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>提交人地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div><Label>電話</Label><Input value={formData.presentorPhone} onChange={e => update('presentorPhone', e.target.value)} className="mt-1" /></div>
            <div><Label>傳真</Label><Input value={formData.presentorFax} onChange={e => update('presentorFax', e.target.value)} className="mt-1" /></div>
            <div><Label>電郵</Label><Input value={formData.presentorEmail} onChange={e => update('presentorEmail', e.target.value)} className="mt-1" /></div>
            <div><Label>參考編號</Label><Input value={formData.presentorReference} onChange={e => update('presentorReference', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN7 PDF</>}
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
          if (p) doGenerate(p.companyId);
        }}
      />
    </div>
  );
}
