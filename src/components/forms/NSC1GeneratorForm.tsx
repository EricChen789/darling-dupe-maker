import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Download, Loader2, Building2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useCompanies } from '@/hooks/useCompanies';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import { useQueryClient } from '@tanstack/react-query';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import ConfirmWritebackDialog from './ConfirmWritebackDialog';
import type { Presenter } from '@/hooks/usePresenters';
import { usePresenterList } from '@/hooks/usePresenters';
import {
  resolveCompanyId, buildNSC1Summary, writebackNSC1, errText,
  dmyToDDMMYYYY, type Nsc1AllotteeInput, type WritebackSummaryItem,
} from '@/lib/formWriteback';

interface NSC1GeneratorFormProps { onBack: () => void; initialCompanyId?: string; }

interface ShareAllotment {
  class: string; currency: string; numberOfShares: string;
  amountPaid: string; amountUnpaid: string;
  // Allottee details (P.7 Schedule 2)
  allotteeName: string;
  allotteeNameZh: string;
  allotteeSurname: string;
  allotteeOtherNames: string;
  // Structured address (5 fields)
  allotteeFlat: string;
  allotteeBuilding: string;
  allotteeStreet: string;
  allotteeDistrict: string;
  allotteeCountry: string;
  // Other Schedule 2 fields
  allotteeJointlyHeld: boolean;
  allotteeRemarks: string;
}

export default function NSC1GeneratorForm({ onBack, initialCompanyId }: NSC1GeneratorFormProps) {
  const { data: companies = [] } = useCompanies();
  const { data: presenters = [] } = usePresenterList();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [pendingWriteback, setPendingWriteback] = useState<{ title: string; summary: WritebackSummaryItem[]; companyId: string | null } | null>(null);
  const { mutate: saveFormHistory } = useSaveFormHistory();
  const queryClient = useQueryClient();

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = String(today.getFullYear());

  const [formData, setFormData] = useState({
    brNumber: '', companyName: '',
    allotmentFromDay: dd, allotmentFromMonth: mm, allotmentFromYear: yyyy,
    allotmentToDay: dd, allotmentToMonth: mm, allotmentToYear: yyyy,
    // Default presenter = Twinsail (company secretary firm)
    presentorName: 'Twinsail Consultants Limited',
    presentorAddress: 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong',
    presentorTel: '+852 2521 3888',
    presentorFax: '+852 2521 3999',
    presentorEmail: 'info@twinsail.com',
    presentorReference: 'TS-2026-001',
    signDay: dd, signMonth: mm, signYear: yyyy,
    // Task 1: Non-cash consideration
    nonCashConsideration: false,
    nonCashDetails: '',
  });
  const [nonCashTypes, setNonCashTypes] = useState<string[]>([]);

  const [allotments, setAllotments] = useState<ShareAllotment[]>([
    { class: '普通股 Ordinary', currency: 'HKD', numberOfShares: '', amountPaid: '', amountUnpaid: '',
      allotteeName: '', allotteeNameZh: '', allotteeSurname: '', allotteeOtherNames: '',
      allotteeFlat: '', allotteeBuilding: '', allotteeStreet: '', allotteeDistrict: '',
      allotteeCountry: 'Hong Kong', allotteeJointlyHeld: false, allotteeRemarks: '' },
  ]);

  const handleCompanySelect = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({
        ...prev,
        brNumber: company.brNumber || '',
        companyName: company.name || '',
        // Presenter defaults to Twinsail (company secretary firm), not the company
        presentorName: 'Twinsail Consultants Limited',
        presentorAddress: 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong',
        presentorTel: '+852 2521 3888',
        presentorFax: '+852 2521 3999',
        presentorEmail: 'info@twinsail.com',
        presentorReference: 'TS-2026-001',
      }));
    }
  };

  useEffect(() => {
    if (initialCompanyId && companies.length && !selectedCompanyId) handleCompanySelect(initialCompanyId);
  }, [initialCompanyId, companies.length]);

  const update = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }));
  const updateAllotment = (i: number, f: keyof ShareAllotment, v: string) =>
    setAllotments(prev => prev.map((a, idx) => idx === i ? { ...a, [f]: v } : a));
  const addAllotment = () =>
    setAllotments(prev => [...prev, { class: '普通股 Ordinary', currency: 'HKD', numberOfShares: '', amountPaid: '', amountUnpaid: '',
      allotteeName: '', allotteeNameZh: '', allotteeSurname: '', allotteeOtherNames: '',
      allotteeFlat: '', allotteeBuilding: '', allotteeStreet: '', allotteeDistrict: '',
      allotteeCountry: 'Hong Kong', allotteeJointlyHeld: false, allotteeRemarks: '' }]);
  const removeAllotment = (i: number) =>
    setAllotments(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  // ── Person picker: options for name autofill (company persons + presenters) ──
  const personOptions = useMemo(() => {
    const opts: { group: string; items: { id: string; label: string; sublabel: string; data: any }[] }[] = [];
    if (selectedCompanyId) {
      const company = companies.find(c => c.id === selectedCompanyId);
      if (company) {
        const people: any[] = [];
        for (const d of company.directors || []) {
          people.push({
            id: `dir_${d.id}`,
            label: d.nameEnglish || d.nameChinese || '?',
            sublabel: `董事 Director${d.nameChinese ? ` · ${d.nameChinese}` : ''}`,
            data: {
              nameChinese: d.nameChinese || '',
              nameEnglish: d.nameEnglish || '',
            },
          });
        }
        for (const s of company.secretaries || []) {
          people.push({
            id: `sec_${s.id}`,
            label: s.nameEnglish || s.nameChinese || '?',
            sublabel: `公司秘書 Secretary${s.nameChinese ? ` · ${s.nameChinese}` : ''}`,
            data: {
              nameChinese: s.nameChinese || '',
              nameEnglish: s.nameEnglish || '',
            },
          });
        }
        if (people.length > 0) {
          opts.push({ group: `🏢 ${company.name} — 董事／秘書`, items: people });
        }
      }
    }
    if (presenters.length > 0) {
      opts.push({
        group: '👤 已儲存提交人',
        items: presenters.map(p => ({
          id: `pres_${p.id}`,
          label: p.name,
          sublabel: [p.phone, p.email].filter(Boolean).join(' · ') || '',
          data: {
            nameChinese: (p as any).nameChinese || '',
            nameEnglish: p.nameEnglish || p.name || '',
          },
        })),
      });
    }
    return opts;
  }, [selectedCompanyId, companies, presenters]);

  // ── Address picker: options from company + persons + presenters ──
  const addressOptions = useMemo(() => {
    const opts: { group: string; items: { id: string; label: string; sublabel: string; data: any }[] }[] = [];
    if (selectedCompanyId) {
      const company = companies.find(c => c.id === selectedCompanyId);
      if (company) {
        // Company registered address
        const regAddr = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
          .filter(Boolean).join(', ');
        if (regAddr) {
          opts.push({
            group: `🏢 ${company.name}`,
            items: [{
              id: 'company_reg',
              label: '公司註冊地址',
              sublabel: regAddr.slice(0, 50),
              data: {
                flat: company.regFlat || '',
                building: company.regBuilding || '',
                street: company.regStreet || '',
                district: company.regDistrict || '',
                country: company.regRegion || 'Hong Kong',
              },
            }],
          });
        }
        // Company persons' addresses
        const personAddrs: any[] = [];
        const seen = new Set<string>();
        for (const d of company.directors || []) {
          const addr = d.address || [d.addrFlat, d.addrBuilding, d.addrStreet, d.addrDistrict, d.addrRegion].filter(Boolean).join(', ');
          if (addr && !seen.has(addr)) {
            seen.add(addr);
            personAddrs.push({
              id: `addr_dir_${d.id}`,
              label: d.nameEnglish || d.nameChinese || '?',
              sublabel: addr.slice(0, 50),
              data: {
                flat: d.addrFlat || '', building: d.addrBuilding || '',
                street: d.addrStreet || '', district: d.addrDistrict || '',
                country: d.addrRegion || 'Hong Kong',
                _raw: addr, // fallback for D1 flat address
              },
            });
          }
        }
        for (const s of company.secretaries || []) {
          const addr = s.address || [s.addrFlat, s.addrBuilding, s.addrStreet, s.addrDistrict, s.addrRegion].filter(Boolean).join(', ');
          if (addr && !seen.has(addr)) {
            seen.add(addr);
            personAddrs.push({
              id: `addr_sec_${s.id}`,
              label: s.nameEnglish || s.nameChinese || '?',
              sublabel: addr.slice(0, 50),
              data: {
                flat: s.addrFlat || '', building: s.addrBuilding || '',
                street: s.addrStreet || '', district: s.addrDistrict || '',
                country: s.addrRegion || 'Hong Kong',
                _raw: addr,
              },
            });
          }
        }
        if (personAddrs.length > 0) {
          opts.push({ group: '👥 公司人員地址', items: personAddrs });
        }
      }
    }
    // Presenters' addresses
    if (presenters.length > 0) {
      const presAddrs = presenters.filter(p => p.address).map(p => ({
        id: `addr_pres_${p.id}`,
        label: p.name,
        sublabel: (p.address || '').slice(0, 50),
        data: {
          flat: '', building: '', street: '', district: '', country: 'Hong Kong',
          _raw: p.address || '',
        },
      }));
      if (presAddrs.length > 0) {
        opts.push({ group: '👤 已儲存提交人地址', items: presAddrs });
      }
    }
    return opts;
  }, [selectedCompanyId, companies, presenters]);

  /** Parse flat address string into 5 structured fields */
  const splitAddress = (addr: string) => {
    if (!addr) return { flat: '', building: '', street: '', district: '', country: 'Hong Kong' };
    const parts = addr.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
    return {
      flat: parts[0] || '',
      building: parts[1] || '',
      street: parts.slice(2).join(', ') || '',
      district: '',
      country: 'Hong Kong',
    };
  };

  /** Handle person pick → fill name fields only */
  const handlePersonPick = (i: number, personId: string) => {
    if (!personId) return;
    for (const grp of personOptions) {
      const found = grp.items.find(o => o.id === personId);
      if (found) {
        const d = found.data;
        // HK convention: surname comes FIRST in English name (e.g. "CHAN Tai Man" → surname=CHAN)
        const nameParts = (d.nameEnglish || '').trim().split(/\s+/);
        const surname = nameParts.length > 0 ? nameParts[0] : '';
        const otherNames = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
        setAllotments(prev => prev.map((a, idx) => idx === i ? {
          ...a,
          allotteeNameZh: d.nameChinese || '',
          allotteeName: d.nameEnglish || '',
          allotteeSurname: surname,
          allotteeOtherNames: otherNames,
        } : a));
        toast({ title: '已載入', description: `獲配人姓名從「${found.label}」自動填入` });
        return;
      }
    }
  };

  /** Handle address pick → fill address fields only */
  const handleAddressPick = (i: number, addrId: string) => {
    if (!addrId) return;
    for (const grp of addressOptions) {
      const found = grp.items.find(o => o.id === addrId);
      if (found) {
        const d = found.data;
        let flat = d.flat || '', building = d.building || '',
          street = d.street || '', district = d.district || '',
          country = d.country || 'Hong Kong';
        // If structured fields are all empty, parse from _raw (D1 flat address)
        if (!flat && !building && !street && !district && d._raw) {
          const split = splitAddress(d._raw);
          flat = split.flat; building = split.building;
          street = split.street; district = split.district;
        }
        setAllotments(prev => prev.map((a, idx) => idx === i ? {
          ...a,
          allotteeFlat: flat, allotteeBuilding: building,
          allotteeStreet: street, allotteeDistrict: district,
          allotteeCountry: country,
        } : a));
        toast({ title: '已載入', description: `地址從「${found.label}」自動填入` });
        return;
      }
    }
  };

  // Auto-calculate totals
  const totals = allotments.reduce((acc, a) => {
    const shares = parseFloat(a.numberOfShares) || 0;
    const paid = parseFloat(a.amountPaid) || 0;
    const unpaid = parseFloat(a.amountUnpaid) || 0;
    return {
      totalShares: acc.totalShares + shares,
      totalPaid: acc.totalPaid + paid * shares,
      totalUnpaid: acc.totalUnpaid + unpaid * shares,
      currency: a.currency || acc.currency,
    };
  }, { totalShares: 0, totalPaid: 0, totalUnpaid: 0, currency: 'HKD' });

  const handleLoadHistory = (data: any) => {
    if (data.formData) setFormData((prev: any) => ({ ...prev, ...data.formData }));
    if (data.selectedCompanyId) setSelectedCompanyId(data.selectedCompanyId);
  };

  // 寫回獲配人輸入（與 PDF allottees 同一過濾：有英文或中文姓名）
  const buildAllotteeInputs = (): Nsc1AllotteeInput[] =>
    allotments
      .filter(x => (x.allotteeName || '').trim() || (x.allotteeNameZh || '').trim())
      .map(x => ({
        nameEn: x.allotteeName || '',
        nameZh: x.allotteeNameZh || '',
        surname: x.allotteeSurname || '',
        otherNames: x.allotteeOtherNames || '',
        flat: x.allotteeFlat || '',
        building: x.allotteeBuilding || '',
        street: x.allotteeStreet || '',
        district: x.allotteeDistrict || '',
        country: x.allotteeCountry || 'Hong Kong',
        shares: x.numberOfShares || '',
        class: x.class || '',
        currency: x.currency || '',
        amountPaid: x.amountPaid || '',
        amountUnpaid: x.amountUnpaid || '',
        jointlyHeld: !!x.allotteeJointlyHeld,
        remarks: x.allotteeRemarks || '',
      }));

  // NSC1 確認框入口
  const handleGenerate = async () => {
    if (!formData.brNumber || !formData.companyName) {
      toast({ title: '錯誤', description: '請選擇公司', variant: 'destructive' }); return;
    }
    const companyId = await resolveCompanyId(formData.brNumber, selectedCompanyId || undefined);
    setPendingWriteback({
      title: 'NSC1 生成確認',
      summary: buildNSC1Summary(buildAllotteeInputs(), dmyToDDMMYYYY(formData.allotmentFromDay, formData.allotmentFromMonth, formData.allotmentFromYear)),
      companyId,
    });
  };

  const doGenerate = async (writebackCompanyId?: string | null) => {
    setGenerating(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const a = allotments; // shorthand

      const fields: Record<string, string> = {
        // ── P.1: Company info ──
        'fill_1_P.1': formData.brNumber,
        'fill_2_P.1': formData.companyName,

        // ── P.1: Allotment period "From" (fill_3/4/5 = D/M/Y) ──
        'fill_3_P.1': formData.allotmentFromDay,
        'fill_4_P.1': formData.allotmentFromMonth,
        'fill_5_P.1': formData.allotmentFromYear,

        // ── P.1: Allotment period "To" (fill_6/7/8 = D/M/Y) ──
        'fill_6_P.1': formData.allotmentToDay,
        'fill_7_P.1': formData.allotmentToMonth,
        'fill_8_P.1': formData.allotmentToYear,

        // ── P.1: Totals of this Allotment ──
        'fill_9_P.1': totals.currency,
        'fill_10_P.1': totals.totalPaid ? `$${totals.totalPaid.toLocaleString()}` : '',

        // ── P.1: Share detail table (Section A, 3 rows) ──
        // Row 1 (fill_15-19): Class, Currency, Number, Paid, Unpaid
        'fill_15_P.1': a[0]?.class || '',
        'fill_16_P.1': a[0]?.currency || '',
        'fill_17_P.1': a[0]?.numberOfShares || '',
        'fill_18_P.1': a[0]?.amountPaid || '',
        'fill_19_P.1': a[0]?.amountUnpaid || '',
        // Row 2 (fill_20-24)
        'fill_20_P.1': a[1]?.class || '',
        'fill_21_P.1': a[1]?.currency || '',
        'fill_22_P.1': a[1]?.numberOfShares || '',
        'fill_23_P.1': a[1]?.amountPaid || '',
        'fill_24_P.1': a[1]?.amountUnpaid || '',
        // Row 3 (fill_25-29)
        'fill_25_P.1': a[2]?.class || '',
        'fill_26_P.1': a[2]?.currency || '',
        'fill_27_P.1': a[2]?.numberOfShares || '',
        'fill_28_P.1': a[2]?.amountPaid || '',
        'fill_29_P.1': a[2]?.amountUnpaid || '',

        // ── P.2: Continuation sheet — BR only (rest mapped via P.1) ──
        'fill_1_P.2': formData.brNumber,

        // ── P.3-6: BR only ──
        'fill_1_P.3': formData.brNumber,
        'fill_1_P.4': formData.brNumber,
        'fill_1_P.5': formData.brNumber,
        'fill_1_P.6': formData.brNumber,

        // ── P.1 bottom: Presentor info ──
        'fill_30_P.1': formData.presentorName || '',
        'fill_31_P.1': formData.presentorAddress || '',
        'fill_32_P.1': formData.presentorTel || '',
        'fill_33_P.1': formData.presentorFax || '',
        'fill_34_P.1': formData.presentorEmail || '',
        'fill_35_P.1': formData.presentorReference || '',

        // ── P.3: Signature section ──
        'fill_27_P.3': formData.presentorName || '',

        // ── P.7-10: BR only (allottee details now sent via allottees array) ──
        'fill_1_P.7': formData.brNumber,
        'fill_1_P.8': formData.brNumber,
        'fill_1_P.9': formData.brNumber,
        'fill_1_P.10': formData.brNumber,
      };

      // Build allottees array for P.7 Schedule 2
      const allottees = allotments
        .filter(x => (x.allotteeName || '').trim() || (x.allotteeNameZh || '').trim())
        .map(x => ({
          nameEn: x.allotteeName || '',
          nameZh: x.allotteeNameZh || '',
          surname: x.allotteeSurname || '',
          otherNames: x.allotteeOtherNames || '',
          flat: x.allotteeFlat || '',
          building: x.allotteeBuilding || '',
          street: x.allotteeStreet || '',
          district: x.allotteeDistrict || '',
          country: x.allotteeCountry || 'Hong Kong',
          shares: x.numberOfShares || '',
          jointlyHeld: x.allotteeJointlyHeld || false,
          remarks: x.allotteeRemarks || '',
        }));

      const checkboxes: string[] = [
        'cb_1_P.1',   // Share capital IS increased
        'cb_1_P.7',   // Declaration checkbox
      ];
      // Allottee Schedule 2 indicators
      if (allottees.length > 0) {
        checkboxes.push('cb_4_P.3');  // P.2 bottom (template quirk: named _P.3)
        checkboxes.push('cb_1_P.3');  // P.3 Section 5
      }

      const overlays: Array<{page: number; text: string; x: number; y: number; fontsize: number}> = [
        // P.3 signature date (index 2) — no AcroForm widgets at "Date:" position (y≈771)
        { page: 2, text: `${formData.signDay} / ${formData.signMonth} / ${formData.signYear}`, x: 395, y: 768, fontsize: 10 },
      ];

      const resp = await fetch(`/api/generate-nsc1-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          brNumber: formData.brNumber,
          companyName: formData.companyName,
          signDate: `${formData.signDay}/${formData.signMonth}/${formData.signYear}`,
          allotmentFromDate: `${formData.allotmentFromDay}/${formData.allotmentFromMonth}/${formData.allotmentFromYear}`,
          allotmentToDate: `${formData.allotmentToDay}/${formData.allotmentToMonth}/${formData.allotmentToYear}`,
          fields,
          checkboxes,
          // Task 1: Non-cash consideration
          nonCashConsideration: formData.nonCashConsideration,
          nonCashTypes: nonCashTypes,
          nonCashDetails: formData.nonCashDetails,
          // Task 2: Allottee details (structured array for P.7)
          allottees,
          // Task 3: Share capital data for P.3 computation
          shares: totals.totalShares,
          currency: totals.currency,
          shareClass: a[0]?.class || '普通股 Ordinary',
          pricePerShare: a[0]?.amountPaid || '1.00',
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Unknown error');
      downloadBase64Pdf(result.pdf, `NSC1_股份配發申報書_${formData.companyName}.pdf`);
      toast({ title: '生成成功', description: 'NSC1 表格已下載' });
      saveFormHistory({ formType: 'NSC1', formData: { formData, selectedCompanyId } });

      // 寫回資料庫（PDF 成功才寫；放在「生成成功」toast 之後，TOAST_LIMIT=1 順序一致）
      if (writebackCompanyId) {
        try {
          const labels = await writebackNSC1(writebackCompanyId, buildAllotteeInputs(),
            dmyToDDMMYYYY(formData.allotmentFromDay, formData.allotmentFromMonth, formData.allotmentFromYear));
          queryClient.invalidateQueries({ queryKey: ['companies'] });
          const warns = labels.filter(l => l.startsWith('⚠'));
          if (labels.length > 0) toast({ title: '已同步資料庫', description: labels.join('；') });
          if (warns.length > 0) toast({ title: '部分寫回未完成', description: warns.join('；'), variant: 'destructive' });
        } catch (e: any) {
          toast({ title: '資料庫寫回失敗', description: errText(e), variant: 'destructive' });
        }
      }
    } catch (err: any) {
      toast({ title: '生成失敗', description: err.message, variant: 'destructive' });
    } finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />返回</Button>
        <div>
          <h1 className="text-2xl font-bold">NSC1 — 股份配發申報書</h1>
          <p className="text-sm text-muted-foreground">Return of Allotment</p>
        </div>
      </div>

      <FormHistorySelector formType="NSC1" onSelect={handleLoadHistory} />

      {/* ── Company Selector ── */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="h-4 w-4 text-primary" />
          <Label className="font-medium">選擇公司自動填入（BR、公司名、提交人資料）</Label>
        </div>
        <Select value={selectedCompanyId} onValueChange={handleCompanySelect}>
          <SelectTrigger><SelectValue placeholder="選擇公司..." /></SelectTrigger>
          <SelectContent>
            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.brNumber})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {/* ── Company Info ── */}
        <div>
          <h3 className="font-semibold mb-3">公司資料（P.1）</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>商業登記號碼 *</Label><Input value={formData.brNumber} onChange={e => update('brNumber', e.target.value)} className="mt-1" /></div>
            <div><Label>公司名稱 *</Label><Input value={formData.companyName} onChange={e => update('companyName', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── Allotment Period ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-3">分配期間 — 由 (From)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div><Label>日 (DD)</Label><Input value={formData.allotmentFromDay} onChange={e => update('allotmentFromDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月 (MM)</Label><Input value={formData.allotmentFromMonth} onChange={e => update('allotmentFromMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年 (YYYY)</Label><Input value={formData.allotmentFromYear} onChange={e => update('allotmentFromYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
          <div>
            <h3 className="font-semibold mb-3">分配期間 — 至 (To)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div><Label>日 (DD)</Label><Input value={formData.allotmentToDay} onChange={e => update('allotmentToDay', e.target.value)} className="mt-1" /></div>
              <div><Label>月 (MM)</Label><Input value={formData.allotmentToMonth} onChange={e => update('allotmentToMonth', e.target.value)} className="mt-1" /></div>
              <div><Label>年 (YYYY)</Label><Input value={formData.allotmentToYear} onChange={e => update('allotmentToYear', e.target.value)} className="mt-1" /></div>
            </div>
          </div>
        </div>

        {/* ── Totals (auto-calculated) ── */}
        <div>
          <h3 className="font-semibold mb-2">是次分配總額（自動計算）</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-muted/40 rounded-lg text-sm">
            <div><span className="text-muted-foreground">貨幣：</span><strong>{totals.currency}</strong></div>
            <div><span className="text-muted-foreground">總股數：</span><strong>{totals.totalShares.toLocaleString()}</strong></div>
            <div><span className="text-muted-foreground">已繳總額：</span><strong>${totals.totalPaid.toLocaleString()}</strong></div>
            <div><span className="text-muted-foreground">未繳總額：</span><strong>${totals.totalUnpaid.toLocaleString()}</strong></div>
          </div>
        </div>

        {/* ── Share Allotments ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">股份分配詳情（P.1 Section A + P.2 續頁）</h3>
            <Button variant="outline" size="sm" onClick={addAllotment}><Plus className="h-4 w-4 mr-1" />新增</Button>
          </div>
          {allotments.map((a, i) => (
            <div key={i} className="border border-border rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">
                  項目 #{i + 1}{i < 3 ? ` → P.1 Row ${i + 1} / P.2 Row ${i + 1}` : ` → P.2+ 續頁`}
                </span>
                {allotments.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeAllotment(i)} className="text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div><Label>股份類別</Label>
                  <Select value={a.class} onValueChange={v => updateAllotment(i, 'class', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="普通股 Ordinary">普通股 Ordinary</SelectItem>
                      <SelectItem value="優先股 Preference">優先股 Preference</SelectItem>
                      <SelectItem value="A股 Class A">A股 Class A</SelectItem>
                      <SelectItem value="B股 Class B">B股 Class B</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>貨幣</Label>
                  <Select value={a.currency} onValueChange={v => updateAllotment(i, 'currency', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HKD">HKD</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="CNY">CNY</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>股份數目</Label><Input placeholder="例如：10,000" value={a.numberOfShares} onChange={e => updateAllotment(i, 'numberOfShares', e.target.value)} className="mt-1" /></div>
                <div><Label>每股已繳金額</Label><Input placeholder="例如：1.00" value={a.amountPaid} onChange={e => updateAllotment(i, 'amountPaid', e.target.value)} className="mt-1" /></div>
                <div><Label>每股未繳金額</Label><Input placeholder="例如：0.00" value={a.amountUnpaid} onChange={e => updateAllotment(i, 'amountUnpaid', e.target.value)} className="mt-1" /></div>
                <div className="col-span-3 mt-2 pt-3 border-t border-border">
                  <span className="text-sm font-semibold">獲分配人資料（附表二 Schedule 2）</span>
                </div>
                {/* ── Person picker ── */}
                <div className="col-span-3 bg-blue-50/60 border border-blue-200 rounded-md p-3">
                  <Label className="text-xs font-semibold text-blue-700 flex items-center gap-1">
                    👤 從現有系統選擇人員（可選，選後自動填入姓名）
                  </Label>
                  <Select value="" onValueChange={(v) => handlePersonPick(i, v)} disabled={personOptions.length === 0}>
                    <SelectTrigger className="mt-1 h-8 text-sm bg-white">
                      <SelectValue placeholder={
                        personOptions.length === 0
                          ? (selectedCompanyId ? '— 該公司暫無董事／秘書，且無已儲存提交人 —' : '— 選擇公司後可從公司人員載入 —')
                          : '— 選擇人員自動填入姓名 —'
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {personOptions.map(grp => (
                        <div key={grp.group}>
                          <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium">{grp.group}</div>
                          {grp.items.map(opt => (
                            <SelectItem key={opt.id} value={opt.id}>
                              <div className="flex flex-col">
                                <span className="text-sm">{opt.label}</span>
                                {opt.sublabel ? <span className="text-xs text-muted-foreground">{opt.sublabel}</span> : null}
                              </div>
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* ── Address picker ── */}
                <div className="col-span-3 bg-green-50/60 border border-green-200 rounded-md p-3">
                  <Label className="text-xs font-semibold text-green-700 flex items-center gap-1">
                    📍 從現有系統選擇地址（可選，選後自動填入地址）
                  </Label>
                  <Select value="" onValueChange={(v) => handleAddressPick(i, v)} disabled={addressOptions.length === 0}>
                    <SelectTrigger className="mt-1 h-8 text-sm bg-white">
                      <SelectValue placeholder={
                        addressOptions.length === 0
                          ? (selectedCompanyId ? '— 暫無可用地址 —' : '— 選擇公司後可從公司地址載入 —')
                          : '— 選擇地址自動填入 —'
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {addressOptions.map(grp => (
                        <div key={grp.group}>
                          <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium">{grp.group}</div>
                          {grp.items.map(opt => (
                            <SelectItem key={opt.id} value={opt.id}>
                              <div className="flex flex-col">
                                <span className="text-sm">{opt.label}</span>
                                {opt.sublabel ? <span className="text-xs text-muted-foreground">{opt.sublabel}</span> : null}
                              </div>
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>中文姓名 Name in Chinese</Label><Input placeholder="例如：陳大文" value={a.allotteeNameZh} onChange={e => updateAllotment(i, 'allotteeNameZh', e.target.value)} className="mt-1" /></div>
                <div><Label>英文姓名 Name in English</Label><Input placeholder="例如：CHAN Tai Man" value={a.allotteeName} onChange={e => updateAllotment(i, 'allotteeName', e.target.value)} className="mt-1" /></div>
                <div></div>
                <div><Label>姓氏 Surname</Label><Input placeholder="CHAN" value={a.allotteeSurname} onChange={e => updateAllotment(i, 'allotteeSurname', e.target.value)} className="mt-1" /></div>
                <div><Label>名字 Other Names</Label><Input placeholder="Tai Man" value={a.allotteeOtherNames} onChange={e => updateAllotment(i, 'allotteeOtherNames', e.target.value)} className="mt-1" /></div>
                <div><Label>獲配股份數目 No. of Shares</Label><Input value={a.numberOfShares} disabled className="mt-1 bg-muted/50" /></div>
                {/* Structured Address */}
                <div className="col-span-3 mt-2">
                  <span className="text-xs text-muted-foreground font-medium">地址 Address</span>
                </div>
                <div><Label>室／樓／座 Flat/Floor/Block</Label><Input placeholder="Room 1203, 12/F" value={a.allotteeFlat} onChange={e => updateAllotment(i, 'allotteeFlat', e.target.value)} className="mt-1" /></div>
                <div><Label>大廈 Building</Label><Input placeholder="Wing On Centre" value={a.allotteeBuilding} onChange={e => updateAllotment(i, 'allotteeBuilding', e.target.value)} className="mt-1" /></div>
                <div></div>
                <div className="col-span-3"><Label>街道／屋苑 Street / Estate</Label><Input placeholder="111 Connaught Road Central" value={a.allotteeStreet} onChange={e => updateAllotment(i, 'allotteeStreet', e.target.value)} className="mt-1" /></div>
                <div><Label>地區 District</Label><Input placeholder="Central" value={a.allotteeDistrict} onChange={e => updateAllotment(i, 'allotteeDistrict', e.target.value)} className="mt-1" /></div>
                <div><Label>國家／地區 Country</Label><Input placeholder="Hong Kong" value={a.allotteeCountry} onChange={e => updateAllotment(i, 'allotteeCountry', e.target.value)} className="mt-1" /></div>
                <div></div>
                {/* Jointly Held + Remarks */}
                <div className="col-span-3 flex items-center gap-4 mt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={a.allotteeJointlyHeld}
                      onChange={e => updateAllotment(i, 'allotteeJointlyHeld', e.target.checked ? 'true' : '')}
                      className="w-4 h-4 rounded" />
                    <span className="text-sm">股份是聯名持有 Jointly Held</span>
                  </label>
                </div>
                <div className="col-span-3"><Label>備註 Remarks</Label><Input placeholder="例如：聯名持有股份的詳情" value={a.allotteeRemarks} onChange={e => updateAllotment(i, 'allotteeRemarks', e.target.value)} className="mt-1" /></div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Task 1: Non-Cash Consideration (P.2 Section C) ── */}
        <div className="border border-border rounded-lg p-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox"
              checked={formData.nonCashConsideration}
              onChange={e => update('nonCashConsideration', e.target.checked ? 'true' : '')}
              className="w-4 h-4 rounded" />
            <span className="font-semibold">公司有非金錢代價配發股份</span>
            <span className="text-xs text-muted-foreground">（P.1 cb_2 + P.2 Section C）</span>
          </label>
          {formData.nonCashConsideration && (
            <div className="mt-3 space-y-3 pl-6 border-l-2 border-primary/30">
              <p className="text-xs text-muted-foreground">C. 股份配發的非金錢代價的詳情 — 請選擇適用項：</p>
              {[
                { key: 'division2_part13', label: '公司以非金錢代價根據《公司條例》(第622章)第13部第2分部作出的安排進行股份配發' },
                { key: 'credited_fully_paid', label: '所配發股份已入帳列為已繳足股款（不論有否經過資本化）' },
                { key: 'written_contract_s142', label: '以非金錢代價配發，關乎第142(2)(d)(iii)條所述的書面合約' },
              ].map(opt => (
                <label key={opt.key} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox"
                    checked={nonCashTypes.includes(opt.key)}
                    onChange={e => {
                      if (e.target.checked) {
                        setNonCashTypes([...nonCashTypes, opt.key]);
                      } else {
                        setNonCashTypes(nonCashTypes.filter(k => k !== opt.key));
                      }
                    }}
                    className="w-4 h-4 rounded mt-0.5" />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
              <div>
                <Label>詳情 Particulars（將填入 P.2 詳情欄）</Label>
                <textarea value={formData.nonCashDetails}
                  onChange={e => update('nonCashDetails', e.target.value)}
                  placeholder="請輸入非金錢代價的詳情..." rows={4}
                  className="w-full mt-1 border border-border rounded-md p-2 text-sm" />
              </div>
            </div>
          )}
        </div>

        {/* ── Sign Date ── */}
        <div>
          <h3 className="font-semibold mb-3">簽署日期（P.3 + P.7）</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>日 (DD)</Label><Input value={formData.signDay} onChange={e => update('signDay', e.target.value)} className="mt-1" /></div>
            <div><Label>月 (MM)</Label><Input value={formData.signMonth} onChange={e => update('signMonth', e.target.value)} className="mt-1" /></div>
            <div><Label>年 (YYYY)</Label><Input value={formData.signYear} onChange={e => update('signYear', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── Presentor ── */}
        <div>
          <h3 className="font-semibold mb-3">提交人資料（P.1 底部 + P.3 簽署）</h3>
          <PresenterSelector companyId={selectedCompanyId}
            currentData={{ name: formData.presentorName, address: formData.presentorAddress, phone: formData.presentorTel, fax: formData.presentorFax, email: formData.presentorEmail, reference: formData.presentorReference }}
            onSelect={(p: Presenter) => {
              update('presentorName', p.name);
              update('presentorAddress', p.address);
              update('presentorTel', p.phone);
              update('presentorFax', p.fax);
              update('presentorEmail', p.email);
              update('presentorReference', p.reference);
            }}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>姓名／名稱 *</Label><Input value={formData.presentorName} onChange={e => update('presentorName', e.target.value)} className="mt-1" /></div>
            <div><Label>參考編號（檔號）</Label><Input value={formData.presentorReference} onChange={e => update('presentorReference', e.target.value)} className="mt-1" /></div>
            <div className="col-span-2"><Label>地址</Label><Input value={formData.presentorAddress} onChange={e => update('presentorAddress', e.target.value)} className="mt-1" /></div>
            <div><Label>電話</Label><Input value={formData.presentorTel} onChange={e => update('presentorTel', e.target.value)} className="mt-1" /></div>
            <div><Label>傳真</Label><Input value={formData.presentorFax} onChange={e => update('presentorFax', e.target.value)} className="mt-1" /></div>
            <div><Label>電郵</Label><Input value={formData.presentorEmail} onChange={e => update('presentorEmail', e.target.value)} className="mt-1" /></div>
          </div>
        </div>

        {/* ── Generate ── */}
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Download className="h-4 w-4 mr-2" />生成 NSC1 PDF</>}
          </Button>
          <span className="text-xs text-muted-foreground">
            涵蓋 P.1-P.14，自動填入公司、股份、獲分配人、提交人資料
          </span>
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
          doGenerate(companyId);
        }}
        onCancel={() => setPendingWriteback(null)}
      />
    </div>
  );
}
