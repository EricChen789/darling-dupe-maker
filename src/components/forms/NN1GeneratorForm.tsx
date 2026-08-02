import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Plus, Trash2, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import type { Presenter } from '@/hooks/usePresenters';

interface NN1GeneratorFormProps { onBack: () => void; }
interface OfficerEntry { role: string; nameChinese: string; nameEnglish: string; identity: string; address: string; }
interface ShareholderEntry { name: string; shares: string; class: string; }

export default function NN1GeneratorForm({ onBack }: NN1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );

  const [formData, setFormData] = useState({
    proposedNameEnglish: '', proposedNameChinese: '',
    estDay: '', estMonth: '', estYear: '',
    flat: '', building: '', street: '', district: '',
    companyEmail: '', companyPhone: '',
    placeOfIncorporation: '',
    presentorNameChinese: '', presentorNameEnglish: '',
    presentorAddress: '', presentorPhone: '',
    presentorFax: '', presentorEmail: '', presentorReference: '',
    brNumber: '',
  });

  const [officers, setOfficers] = useState<OfficerEntry[]>([
    { role: 'director', nameChinese: '', nameEnglish: '', identity: 'natural', address: '' },
    { role: 'secretary', nameChinese: '', nameEnglish: '', identity: 'natural', address: '' },
  ]);
  const [shareholders, setShareholders] = useState<ShareholderEntry[]>([{ name: '', shares: '', class: '普通股 Ordinary' }]);

  const { mutate: saveFormHistory } = useSaveFormHistory();

  const handleLoadHistory = (data: any) => {
    // data = { formData: {...}, officers: [...], shareholders: [...] }
    if (data.formData) setFormData(prev => ({ ...prev, ...data.formData }));
    if (data.officers && Array.isArray(data.officers)) setOfficers(data.officers);
    if (data.shareholders && Array.isArray(data.shareholders)) setShareholders(data.shareholders);
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
  };

  const update = (f: string, v: string) => setFormData(prev => ({ ...prev, [f]: v }));
  const updateOfficer = (i: number, f: keyof OfficerEntry, v: string) => setOfficers(prev => prev.map((o, idx) => idx === i ? { ...o, [f]: v } : o));
  const addOfficer = () => setOfficers(prev => [...prev, { role: 'director', nameChinese: '', nameEnglish: '', identity: 'natural', address: '' }]);
  const removeOfficer = (i: number) => setOfficers(prev => prev.filter((_, idx) => idx !== i));
  const updateShareholder = (i: number, f: keyof ShareholderEntry, v: string) => setShareholders(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const addShareholder = () => setShareholders(prev => [...prev, { name: '', shares: '', class: '普通股 Ordinary' }]);
  const removeShareholder = (i: number) => setShareholders(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

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
        presentorNameChinese: company.chineseName || '',
        presentorNameEnglish: company.name || '',
        presentorAddress: regAddress || prev.presentorAddress,
        presentorPhone: company.phone || '',
        presentorFax: prev.presentorFax,
        presentorEmail: company.email || '',
        presentorReference: company.presenterReference || '',
        companyEmail: company.email || '',
        companyPhone: company.phone || '',
      }));
    }
  };

  const handleGenerate = async () => {
    if (!formData.proposedNameEnglish) { toast({ title: '錯誤', description: '請填寫擬用公司英文名稱', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      // Helper: parse English name "CHAN Tai Man" → {surname: "CHAN", otherNames: "Tai Man"}
      const parseEnglishName = (en: string) => {
        const parts = (en || '').trim().split(/\s+/);
        return { surname: parts[0] || '', otherNames: parts.slice(1).join(' ') || '' };
      };
      // Helper: split address by comma into components
      const parseAddress = (addr: string) => {
        const parts = (addr || '').split(',').map(s => s.trim());
        return { flat: parts[0] || '', building: parts[1] || '', street: parts[2] || '', district: parts[3] || '', country: parts[4] || '' };
      };

      const fields: Record<string, string> = {
        // P.1 — Company Name, Place of Incorporation, Establishment Date, Address, Presentor
        // fill_1: tall field (h=98px) holds both English + Chinese company name
        'fill_1_P.1': formData.proposedNameEnglish + (formData.proposedNameChinese ? '\n' + formData.proposedNameChinese : ''),
        'fill_2_P.1': formData.placeOfIncorporation || '',
        'fill_3_P.1': formData.estDay || '',
        'fill_4_P.1': formData.estMonth || '',
        'fill_5_P.1': formData.estYear || '',
        'fill_6_P.1': formData.flat || '',
        'fill_7_P.1': formData.building || '',
        'fill_8_P.1': formData.street || '',
        'fill_9_P.1': formData.district || '',
        'fill_10_P.1': formData.presentorNameChinese || '',
        'fill_11_P.1': formData.presentorNameEnglish || '',
        'fill_12_P.1': formData.presentorAddress || '',
        'fill_13_P.1': formData.presentorPhone || '',
        'fill_14_P.1': formData.presentorFax || '',
        'fill_15_P.1': formData.presentorEmail || '',
        'fill_16_P.1': formData.presentorReference || '',
        // P.2 — Section 3(c) 電郵地址, 3(d) 香港聯絡電話號碼
        'fill_1_P.2': formData.companyEmail || '',
        'fill_2_P.2': formData.companyPhone ? '+852 ' + formData.companyPhone : '',
      };

      const checkboxes: string[] = [];

      // --- Secretary (Natural Person) → P.5 ---
      const secretary = officers.find(o => o.role === 'secretary' && o.identity === 'natural');
      if (secretary) {
        const { surname, otherNames } = parseEnglishName(secretary.nameEnglish);
        const addr = parseAddress(secretary.address);
        Object.assign(fields, {
          'fill_1_P.5': secretary.nameChinese || '',       // 中文姓名
          'fill_2_P.5': surname,                             // 英文姓氏
          'fill_3_P.5': otherNames,                          // 英文名字
          'fill_8_P.5': addr.flat,                           // 通訊地址 — 室/樓/座
          'fill_9_P.5': addr.building,                       // 大廈
          'fill_10_P.5': addr.street,                        // 街道
          'fill_11_P.5': addr.district,                      // 區
          'fill_12_P.5': addr.country,                       // 國家/地區
        });
      }

      // --- Secretary (Body Corporate) → P.6 ---
      const secCorporate = officers.find(o => o.role === 'secretary' && o.identity === 'corporate');
      if (secCorporate) {
        const addr = parseAddress(secCorporate.address);
        Object.assign(fields, {
          'fill_1_P.6': secCorporate.nameChinese || '',      // 中文名稱
          'fill_2_P.6': secCorporate.nameEnglish || '',      // 英文名稱
          'fill_3_P.6': addr.flat,                           // 註冊辦事處地址
          'fill_4_P.6': addr.building,
          'fill_5_P.6': addr.street,
          'fill_6_P.6': addr.district,
          'fill_7_P.6': addr.country,
        });
      }

      // --- Directors (Natural Person) → P.7 (#1), P.8 (#2) ---
      const natDirectors = officers.filter(o => o.role === 'director' && o.identity === 'natural');
      const dirPages = [
        { page: 7, cbDirector: 'cb_1_P.7', cbAlternate: 'cb_2_P.7' },
        { page: 8, cbDirector: 'cb_1_P.8', cbAlternate: 'cb_2_P.8' },
      ];
      for (let di = 0; di < Math.min(natDirectors.length, dirPages.length); di++) {
        const d = natDirectors[di];
        const pg = dirPages[di];
        const { surname, otherNames } = parseEnglishName(d.nameEnglish);
        const addr = parseAddress(d.address);
        Object.assign(fields, {
          [`fill_2_P.${pg.page}`]: d.nameChinese || '',       // 中文姓名
          [`fill_3_P.${pg.page}`]: surname,                    // 英文姓氏
          [`fill_4_P.${pg.page}`]: otherNames,                 // 英文名字
          [`fill_10_P.${pg.page}`]: addr.building,             // 大廈 (通訊地址在 PI-NN1)
          [`fill_11_P.${pg.page}`]: addr.street,               // 街道
          [`fill_12_P.${pg.page}`]: addr.district,             // 區
          [`fill_13_P.${pg.page}`]: addr.country,              // 國家/地區
        });
        checkboxes.push(pg.cbDirector);  // 勾選「董事」
      }

      // --- Directors (Body Corporate) → P.9 (#1) ---
      const corpDirectors = officers.filter(o => o.role === 'director' && o.identity === 'corporate');
      // P.9 can hold 1 body corporate director; continuation sheets for more
      if (corpDirectors.length > 0) {
        const d = corpDirectors[0];
        const addr = parseAddress(d.address);
        Object.assign(fields, {
          'fill_1_P.9': d.nameChinese || '',                  // 中文名稱
          'fill_2_P.9': d.nameEnglish || '',                  // 英文名稱
          'fill_3_P.9': addr.flat,                            // 註冊辦事處地址
          'fill_4_P.9': addr.building,
          'fill_5_P.9': addr.street,
          'fill_6_P.9': addr.district,
          'fill_7_P.9': addr.country,
        });
        checkboxes.push('cb_1_P.9');  // 勾選「董事」
      }

      const resp = await fetch(`/api/generate-nn1-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fields,
          checkboxes: checkboxes.length > 0 ? checkboxes : undefined,
          brNumber: formData.brNumber || undefined,
          brFields: [],  // NN1 has no BR widget — fill_1_P.{n} are content fields, not BR
          keepWidgets: true,
          alignCenterFields: ['fill_1_P.1', 'fill_2_P.1'],
          alignVCenterFields: ['fill_1_P.1', 'fill_2_P.1'],
          forceWidgetAp: ['fill_9_P.1'],
          fieldMinFontSize: { 'fill_10_P.1': 12, 'fill_11_P.1': 12, 'fill_12_P.1': 13 },
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      if (result.warnings) {
        console.warn('NN1 field warnings:', result.warnings);
      }
      downloadBase64Pdf(result.pdf, 'NN1-form.pdf');
      toast({ title: '生成成功', description: 'NN1 表格已下載' });
      // Auto-save to form history
      saveFormHistory({
        formType: 'NN1',
        formData: { formData, officers, shareholders, selectedCompanyId },
      });
    } catch (err: any) { toast({ title: '生成失敗', description: err.message, variant: 'destructive' }); }
    finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div><h1 className="text-2xl font-bold">NN1 — 註冊非香港公司的註冊申請書</h1><p className="text-sm text-muted-foreground">Application for Registration as Registered Non-Hong Kong Company</p></div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* Company Selector */}
        <div className="bg-muted/30 border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">選擇現有公司（自動填充提交人資料）</h3>
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
          {selectedCompany && (
            <p className="text-xs text-muted-foreground mt-2">
              已選擇：<strong>{selectedCompany.name}</strong> — BR: {selectedCompany.brNumber} — 提交人資料已自動填入
            </p>
          )}
        </div>

        {/* Form History */}
        <FormHistorySelector formType="NN1" onSelect={handleLoadHistory} />

        {/* Section 1: Company Name */}
        <div><h3 className="font-semibold mb-3">擬用公司名稱</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>英文名稱 *</Label><Input value={formData.proposedNameEnglish} onChange={e => update('proposedNameEnglish', e.target.value)} placeholder="e.g. ABC Limited" className="mt-1" /></div>
            <div><Label>中文名稱</Label><Input value={formData.proposedNameChinese} onChange={e => update('proposedNameChinese', e.target.value)} placeholder="e.g. 甲乙丙有限公司" className="mt-1" /></div>
          </div>
        </div>

        {/* Section 2: Place of Incorporation */}
        <div><h3 className="font-semibold mb-3">成立為法團所在地方</h3>
          <p className="text-xs text-muted-foreground mb-3">Place of Incorporation</p>
          <div className="max-w-md">
            <Input value={formData.placeOfIncorporation} onChange={e => update('placeOfIncorporation', e.target.value)} placeholder="e.g. 中國上海 Shanghai, China" className="mt-1" />
          </div>
        </div>

        {/* Section 3(a): Date of Establishment */}
        <div><h3 className="font-semibold mb-3">香港營業地點的開設日期</h3>
          <p className="text-xs text-muted-foreground mb-3">Date of Establishment of the Place of Business in Hong Kong</p>
          <div>
            <Label>日期</Label>
            <Input
              type="date"
              value={[formData.estYear, formData.estMonth.padStart(2, '0'), formData.estDay.padStart(2, '0')].filter(Boolean).length === 3
                ? `${formData.estYear}-${formData.estMonth.padStart(2, '0')}-${formData.estDay.padStart(2, '0')}`
                : ''}
              onChange={e => {
                const v = e.target.value; // YYYY-MM-DD
                if (v) {
                  const [y, m, d] = v.split('-');
                  setFormData(prev => ({ ...prev, estYear: y, estMonth: m, estDay: d }));
                } else {
                  setFormData(prev => ({ ...prev, estYear: '', estMonth: '', estDay: '' }));
                }
              }}
              className="mt-1 max-w-xs"
            />
          </div>
        </div>

        {/* Section 3(b): Address */}
        <div><h3 className="font-semibold mb-3">香港主要營業地點的地址</h3>
          <p className="text-xs text-muted-foreground mb-3">Address of the Principal Place of Business in Hong Kong</p>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>室／樓／座 Flat／Floor／Block</Label><Input value={formData.flat} onChange={e => update('flat', e.target.value)} className="mt-1" /></div>
            <div><Label>大廈 Building</Label><Input value={formData.building} onChange={e => update('building', e.target.value)} className="mt-1" /></div>
            <div><Label>街道／屋苑／地段 Street／Estate／Lot</Label><Input value={formData.street} onChange={e => update('street', e.target.value)} className="mt-1" /></div>
            <div><Label>區 District</Label>
              <Select value={formData.district} onValueChange={v => update('district', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="— 選擇地區 —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="中西區 Central and Western">中西區 Central and Western</SelectItem>
                  <SelectItem value="灣仔 Wan Chai">灣仔 Wan Chai</SelectItem>
                  <SelectItem value="東區 Eastern">東區 Eastern</SelectItem>
                  <SelectItem value="南區 Southern">南區 Southern</SelectItem>
                  <SelectItem value="油尖旺 Yau Tsim Mong">油尖旺 Yau Tsim Mong</SelectItem>
                  <SelectItem value="深水埗 Sham Shui Po">深水埗 Sham Shui Po</SelectItem>
                  <SelectItem value="九龍城 Kowloon City">九龍城 Kowloon City</SelectItem>
                  <SelectItem value="黃大仙 Wong Tai Sin">黃大仙 Wong Tai Sin</SelectItem>
                  <SelectItem value="觀塘 Kwun Tong">觀塘 Kwun Tong</SelectItem>
                  <SelectItem value="葵青 Kwai Tsing">葵青 Kwai Tsing</SelectItem>
                  <SelectItem value="荃灣 Tsuen Wan">荃灣 Tsuen Wan</SelectItem>
                  <SelectItem value="屯門 Tuen Mun">屯門 Tuen Mun</SelectItem>
                  <SelectItem value="元朗 Yuen Long">元朗 Yuen Long</SelectItem>
                  <SelectItem value="北區 North">北區 North</SelectItem>
                  <SelectItem value="大埔 Tai Po">大埔 Tai Po</SelectItem>
                  <SelectItem value="沙田 Sha Tin">沙田 Sha Tin</SelectItem>
                  <SelectItem value="西貢 Sai Kung">西貢 Sai Kung</SelectItem>
                  <SelectItem value="離島 Islands">離島 Islands</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>電郵 Email</Label><Input value={formData.companyEmail} onChange={e => update('companyEmail', e.target.value)} className="mt-1" placeholder="info@company.com" /></div>
            <div><Label>電話 Phone</Label><Input value={formData.companyPhone} onChange={e => update('companyPhone', e.target.value)} className="mt-1" placeholder="+852 1234 5678" /></div>
          </div>
        </div>

        {/* Officers */}
        <div>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">首任董事及公司秘書</h3>
            <Button variant="outline" size="sm" onClick={addOfficer}><Plus className="h-4 w-4 mr-1" />新增</Button>
          </div>
          {officers.map((o, i) => (
            <div key={i} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3"><span className="font-medium text-sm">人員 #{i + 1}</span>
                {officers.length > 2 && <Button variant="ghost" size="sm" onClick={() => removeOfficer(i)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>角色</Label>
                  <Select value={o.role} onValueChange={v => updateOfficer(i, 'role', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="director">董事 Director</SelectItem><SelectItem value="secretary">公司秘書 Company Secretary</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>身份</Label>
                  <Select value={o.identity} onValueChange={v => updateOfficer(i, 'identity', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="natural">自然人 Natural Person</SelectItem><SelectItem value="corporate">法人 Corporate</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>中文名稱</Label><Input value={o.nameChinese} onChange={e => updateOfficer(i, 'nameChinese', e.target.value)} className="mt-1" /></div>
                <div><Label>英文名稱</Label><Input value={o.nameEnglish} onChange={e => updateOfficer(i, 'nameEnglish', e.target.value)} className="mt-1" /></div>
                <div className="col-span-2"><Label>地址</Label><Input value={o.address} onChange={e => updateOfficer(i, 'address', e.target.value)} className="mt-1" /></div>
              </div>
            </div>
          ))}
        </div>

        {/* Shareholders */}
        <div>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">股東／創辦成員</h3>
            <Button variant="outline" size="sm" onClick={addShareholder}><Plus className="h-4 w-4 mr-1" />新增</Button>
          </div>
          {shareholders.map((s, i) => (
            <div key={i} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3"><span className="font-medium text-sm">股東 #{i + 1}</span>
                {shareholders.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeShareholder(i)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>姓名／名稱</Label><Input value={s.name} onChange={e => updateShareholder(i, 'name', e.target.value)} className="mt-1" /></div>
                <div><Label>股份類別</Label>
                  <Select value={s.class} onValueChange={v => updateShareholder(i, 'class', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="普通股 Ordinary">普通股 Ordinary</SelectItem><SelectItem value="優先股 Preference">優先股 Preference</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>股份數目</Label><Input value={s.shares} onChange={e => updateShareholder(i, 'shares', e.target.value)} className="mt-1" /></div>
              </div>
            </div>
          ))}
        </div>

        {/* Presentor Data */}
        <div><h3 className="font-semibold mb-3">提交人資料</h3>
          <p className="text-xs text-muted-foreground mb-3">Presentor's Reference{selectedCompany && <span className="ml-2 text-primary">（已從 {selectedCompany.name} 自動填入，可修改）</span>}</p>
          <PresenterSelector companyId={selectedCompanyId}
            currentData={{ nameChinese: formData.presentorNameChinese, nameEnglish: formData.presentorNameEnglish, address: formData.presentorAddress, phone: formData.presentorPhone, fax: formData.presentorFax, email: formData.presentorEmail, reference: formData.presentorReference }}
            onSelect={(p: Presenter) => {
              update('presentorNameChinese', p.name);
              update('presentorNameEnglish', p.name);
              update('presentorAddress', p.address);
              update('presentorPhone', p.phone);
              update('presentorFax', p.fax);
              update('presentorEmail', p.email);
              update('presentorReference', p.reference);
            }}
          />
          <div className="grid grid-cols-2 gap-4">
            <div><Label>中文名稱 Name in Chinese</Label><Input value={formData.presentorNameChinese} onChange={e => update('presentorNameChinese', e.target.value)} className="mt-1" /></div>
            <div><Label>英文名稱 Name in English</Label><Input value={formData.presentorNameEnglish} onChange={e => update('presentorNameEnglish', e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>地址 Address</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
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
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NN1 PDF</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
