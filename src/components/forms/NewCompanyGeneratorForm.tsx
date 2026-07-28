import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useSaveFormHistory } from '@/hooks/useFormHistory';
import FormHistorySelector from './FormHistorySelector';
import PresenterSelector from './PresenterSelector';
import { ArrowLeft, Download, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { downloadGenericFormPdf, type GenericFormSection } from '@/lib/genericFormPdf';
import { downloadBase64Pdf } from '@/lib/downloadPdf';

interface Props { onBack: () => void; }

interface OfficerEntry {
  role: 'director' | 'secretary';
  identity: 'natural' | 'corporate';
  nameEnglish: string;
  nameChinese: string;
  idNumber: string;
  address: string;
  dateOfBirth?: string;
  placeIncorporated?: string;
  companyNumberRef?: string;
}

interface ShareEntry {
  name: string;       // 中文姓名
  surname: string;    // 英文姓氏
  otherNames: string; // 英文名字
  shares: number;
  shareType: string;
  amountPaid: string;
}

const emptyOfficer = (role: 'director' | 'secretary' = 'director'): OfficerEntry => ({
  role, identity: 'natural', nameEnglish: '', nameChinese: '', idNumber: '', address: '', dateOfBirth: '',
});

const emptyShare = (): ShareEntry => ({ name: '', surname: '', otherNames: '', shares: 0, shareType: 'Ordinary', amountPaid: '' });

const HK_DISTRICTS = [
  '中西區', '灣仔', '東區', '南區',
  '油尖旺', '深水埗', '九龍城', '黃大仙', '觀塘',
  '葵青', '荃灣', '屯門', '元朗',
  '北區', '大埔', '沙田', '西貢', '離島',
];

export default function NewCompanyGeneratorForm({ onBack }: Props) {
  const { mutate: saveFormHistory } = useSaveFormHistory();
  const [jurisdiction, setJurisdiction] = useState<'HK' | 'BVI'>('HK');
  const [generating, setGenerating] = useState(false);

  // Common
  const [companyName, setCompanyName] = useState('');
  const [companyChinese, setCompanyChinese] = useState('');
  const [companyType, setCompanyType] = useState('Private company limited by shares');
  const [businessNature, setBusinessNature] = useState('');
  // 註冊地址拆分
  const [addrFlat, setAddrFlat] = useState('');
  const [addrBuilding, setAddrBuilding] = useState('');
  const [addrStreet, setAddrStreet] = useState('');
  const [addrDistrict, setAddrDistrict] = useState('');
  const [addrRegion, setAddrRegion] = useState('');
  // 公司聯絡
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');

  // HK NNC1 specific
  const [shareCapital, setShareCapital] = useState('HKD 10,000');
  const [totalShares, setTotalShares] = useState('10000');

  // 提交人資料 (P.1 fill_9-15)
  const [submitterNameCn, setSubmitterNameCn] = useState('');
  const [submitterNameEn, setSubmitterNameEn] = useState('');
  const [submitterAddress, setSubmitterAddress] = useState('');
  const [submitterPhone, setSubmitterPhone] = useState('');
  const [submitterFax, setSubmitterFax] = useState('');
  const [submitterEmail, setSubmitterEmail] = useState('');
  const [submitterRef, setSubmitterRef] = useState('');

  // 簽署日期
  const [signerDate, setSignerDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });

  // BVI specific
  const [authorisedShares, setAuthorisedShares] = useState('50000');
  const [registeredAgent, setRegisteredAgent] = useState('');

  const [officers, setOfficers] = useState<OfficerEntry[]>([emptyOfficer('director'), emptyOfficer('secretary')]);
  const [shareholders, setShareholders] = useState<ShareEntry[]>([emptyShare()]);

  // 簽署人選擇：必須是創辦股東（founder member），從 shareholders 中選擇
  const [signerShareholderIndex, setSignerShareholderIndex] = useState<number>(0); // 默認第一位股東

  const updateOfficer = (i: number, patch: Partial<OfficerEntry>) =>
    setOfficers(arr => arr.map((o, idx) => idx === i ? { ...o, ...patch } : o));
  const removeOfficer = (i: number) => setOfficers(arr => arr.filter((_, idx) => idx !== i));
  const updateShare = (i: number, patch: Partial<ShareEntry>) =>
    setShareholders(arr => arr.map((s, idx) => idx === i ? { ...s, ...patch } : s));

  const handleLoadHistory = (data: any) => {
    if (data.jurisdiction) setJurisdiction(data.jurisdiction);
    if (data.companyName) setCompanyName(data.companyName);
    if (data.companyChinese) setCompanyChinese(data.companyChinese);
    if (data.companyType) setCompanyType(data.companyType);
    if (data.regAddress) {
      // 兼容旧格式：整段地址 → 拆分
      const parts = data.regAddress.split(/[,，]\s*/);
      setAddrFlat(parts[0] || '');
      setAddrBuilding(parts[1] || '');
      setAddrStreet(parts[2] || '');
      setAddrDistrict(parts[3] || '');
      setAddrRegion(parts[4] || '');
    }
    if (data.addrFlat !== undefined) setAddrFlat(data.addrFlat);
    if (data.addrBuilding !== undefined) setAddrBuilding(data.addrBuilding);
    if (data.addrStreet !== undefined) setAddrStreet(data.addrStreet);
    if (data.addrDistrict !== undefined) setAddrDistrict(data.addrDistrict);
    if (data.addrRegion !== undefined) setAddrRegion(data.addrRegion);
    if (data.companyEmail !== undefined) setCompanyEmail(data.companyEmail);
    if (data.companyPhone !== undefined) setCompanyPhone(data.companyPhone);
    if (data.businessNature) setBusinessNature(data.businessNature);
    if (data.shareCapital) setShareCapital(data.shareCapital);
    if (data.totalShares) setTotalShares(data.totalShares);
    if (data.submitterNameCn !== undefined) setSubmitterNameCn(data.submitterNameCn);
    if (data.submitterNameEn !== undefined) setSubmitterNameEn(data.submitterNameEn);
    if (data.submitterAddress !== undefined) setSubmitterAddress(data.submitterAddress);
    if (data.submitterPhone !== undefined) setSubmitterPhone(data.submitterPhone);
    if (data.submitterFax !== undefined) setSubmitterFax(data.submitterFax);
    if (data.submitterEmail !== undefined) setSubmitterEmail(data.submitterEmail);
    if (data.submitterRef !== undefined) setSubmitterRef(data.submitterRef);
    if (data.signerDate) setSignerDate(data.signerDate);
    if (data.authorisedShares) setAuthorisedShares(data.authorisedShares);
    if (data.registeredAgent) setRegisteredAgent(data.registeredAgent);
    if (data.officers) setOfficers(data.officers);
    if (data.shareholders) setShareholders(data.shareholders);
    if (data.signerShareholderIndex !== undefined) setSignerShareholderIndex(data.signerShareholderIndex);
    // 兼容旧历史记录（旧版用 signerRole + signerIndex 从 officers 选）
    if (data.signerShareholderIndex === undefined && data.signerRole !== undefined) {
      setSignerShareholderIndex(0); // 旧记录回退到第一位股东
    }
  };

  const handleGenerate = async () => {
    if (!companyName.trim()) {
      toast({ title: '請填寫公司名稱', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      // ── Common data (used by both HK and BVI) ──
      const regAddressJoined = [addrFlat, addrBuilding, addrStreet, addrDistrict, addrRegion].filter(Boolean).join(', ');

      if (jurisdiction === 'HK') {
        // Use official NNC1 template for HK incorporation
        const token = localStorage.getItem("secretary_jwt") || "";

        // ── Number formatting helper ──
        const fmtNum = (n: number | string) => {
          const num = typeof n === 'string' ? parseFloat(n.replace(/[^0-9.]/g, '')) : n;
          if (isNaN(num)) return '0';
          return num.toLocaleString('en-US');
        };

        // ── Pre-calc totals ──
        const totalSharesNum = shareholders.reduce((sum, sh) => sum + (sh.shares || 0), 0) || Number(totalShares) || 0;
        const totalPaidNum = shareholders.reduce((sum, sh) => {
          const v = parseFloat(String(sh.amountPaid || '').replace(/[^0-9.]/g, ''));
          return sum + (isNaN(v) ? 0 : v);
        }, 0);

        // ── Find first of each officer type ──
        const firstDirNatural = officers.find(o => o.role === 'director' && o.identity === 'natural');
        const firstDirCorporate = officers.find(o => o.role === 'director' && o.identity === 'corporate');
        const firstSecNatural = officers.find(o => o.role === 'secretary' && o.identity === 'natural');
        const firstSecCorporate = officers.find(o => o.role === 'secretary' && o.identity === 'corporate');
        const firstShareholder = shareholders[0];

        // ── Parse English name into surname + otherNames ──
        const parseEnName = (en: string) => {
          const parts = (en || '').trim().split(/\s+/);
          if (parts.length === 0) return { surname: '', otherNames: '' };
          return { surname: parts[0], otherNames: parts.slice(1).join(' ') };
        };

        // ── Parse officer address into components ──
        const parseAddr = (addr: string) => {
          // ⚠️ 固定位置不filter — 空字段保留空位，后面不跳上来
          const parts = (addr || '').split(/[,，]\s*/);
          return {
            flat: parts[0] || '', building: parts[1] || '',
            street: parts[2] || '', district: parts[3] || '', region: parts[4] || '',
          };
        };

        // ── ID helpers: HKID→前4位, Passport→前一半 ──
        const fmtHkid = (id: string) => (id || '').slice(0, 4);
        const fmtPassport = (pp: string) => {
          const s = (pp || '').replace(/\s/g, '');
          return s.slice(0, Math.ceil(s.length / 2));
        };

        // ── Resolve signer (must be a shareholder / founder member) ──
        const chosenSigner = shareholders[signerShareholderIndex] || shareholders[0];
        const signerFullNameEn = chosenSigner
          ? [chosenSigner.surname, chosenSigner.otherNames].filter(Boolean).join(' ')
          : '';
        // Convert YYYY-MM-DD → DD/MM/YYYY for P.8
        const sdParts = signerDate.split('-');
        const signerDateStr = sdParts.length === 3 ? `${sdParts[2]}/${sdParts[1]}/${sdParts[0]}` : signerDate;

        // ── P.1: Company Info + Submitter ──
        const fields: Record<string, string> = {
          // Section 1 — 公司名稱
          'fill_1_P.1': companyName,                          // 英文公司名稱
          'fill_2_P.1': companyChinese || '',                  // 中文公司名稱
          // Section 2 — 公司類別 (checkboxes below)
          // Section 3 — 業務性質
          'fill_3_P.1': '',                                    // 業務性質編碼 Code (narrow 48px)
          'fill_4_P.1': businessNature || '',                  // 業務性質描述 Description (wide 420px)
          // Section 4 — 註冊辦事處地址 (split into 4 fields)
          'fill_5_P.1': addrFlat,                              // 室/樓/座 Flat/Floor/Block
          'fill_6_P.1': addrBuilding,                          // 大廈 Building
          'fill_7_P.1': addrStreet,                            // 街道/屋苑 Street/Estate
          'fill_8_P.1': addrDistrict,                          // 區 District
          // 提交人資料 (fill_9-15)
          'fill_9_P.1': submitterNameCn || '',               // 提交人中文姓名
          'fill_10_P.1': submitterNameEn || '',               // 提交人英文姓名
          'fill_11_P.1': submitterAddress || '',              // 提交人地址
          'fill_12_P.1': submitterPhone || '',                // 提交人電話
          'fill_13_P.1': submitterFax || '',                  // 提交人傳真
          'fill_14_P.1': submitterEmail || '',                // 提交人電郵
          'fill_15_P.1': submitterRef || '',                  // 提交人檔號

          // ── P.2: Contact + Share Capital ──
          'fill_1_P.2': companyEmail || '',                    // 電郵地址
          'fill_2_P.2': companyPhone ? `+852 ${companyPhone}` : '', // 香港聯絡電話
          // ── Share Capital Table (Row 1: fill_3-8) ──
          'fill_3_P.2': 'Ordinary',                            // ① 股份類別
          'fill_4_P.2': fmtNum(totalSharesNum),                // ② 股份數目
          'fill_5_P.2': 'HKD',                                 // ③ 貨幣單位
          'fill_6_P.2': `HKD ${fmtNum(shareCapital)}`,         // ④ 股本總額
          'fill_7_P.2': `HKD ${fmtNum(totalPaidNum)}`,         // ⑤ 已繳付
          'fill_8_P.2': `HKD ${fmtNum((parseFloat(shareCapital.replace(/[^0-9.]/g,''))||0) - totalPaidNum)}`, // ⑥ 尚未繳付
          // ── P.2 Total row (fill_16~19 = 貨幣/股本總額/已繳付/尚未繳付 合計) ──
          'fill_16_P.2': 'HKD',                                   // 貨幣
          'fill_17_P.2': `HKD ${fmtNum(shareCapital)}`,           // 股本總額 Total
          'fill_18_P.2': `HKD ${fmtNum(totalPaidNum)}`,           // 已繳付 Total Paid
          'fill_19_P.2': `HKD ${fmtNum((parseFloat(shareCapital.replace(/[^0-9.]/g,''))||0) - totalPaidNum)}`, // 尚未繳付 Total Unpaid

          // ── P.8: Statement of Founder Member (signer = shareholder) ──
          'fill_7_P.8': signerFullNameEn,                       // 創辦成員英文姓名（左欄）
          'fill_8_P.8': signerDateStr,                           // 日期 Date DD/MM/YYYY（右欄）
          // P.8 continuation sheet page counts (A/B/C/D/E + PI-NNC1)
          'fill_1_P.8': officers.filter(o => o.role === 'secretary' && o.identity === 'natural').length > 1 ? '1' : '',
          'fill_2_P.8': officers.filter(o => o.role === 'secretary' && o.identity === 'corporate').length > 1 ? '1' : '',
          'fill_3_P.8': officers.filter(o => o.role === 'director' && o.identity === 'natural').length > 1 ? '1' : '',
          'fill_4_P.8': officers.filter(o => o.role === 'director' && o.identity === 'corporate').length > 1 ? '1' : '',
          'fill_5_P.8': '',                                    // E (additional body corporate directors)
          'fill_6_P.8': (firstSecNatural ? 1 : 0) + (firstDirNatural ? 1 : 0) > 0 ? String((firstSecNatural ? 1 : 0) + (firstDirNatural ? 1 : 0)) : '',
        };

        // ── Checkboxes ──
        const checkboxes: string[] = [];
        // P.1: Company type
        if (companyType.toLowerCase().includes('private')) checkboxes.push('cb_1_P.1');
        if (companyType.toLowerCase().includes('public')) checkboxes.push('cb_2_P.1');

        // ── Overlays (signer capacity on P.8) ──
        const overlays: Array<{page: number; text: string; x: number; y: number; fontsize: number}> = [];
        // Signer role description below the name on P.8 — must be a founder member (shareholder)
        if (chosenSigner) {
          overlays.push({ page: 8, text: '創辦成員 Founder Member', x: 127, y: 705, fontsize: 8 });
        }

        // ── P.3: First Founder Member (shareholder) ──
        if (firstShareholder && (firstShareholder.name || firstShareholder.surname || firstShareholder.otherNames)) {
          Object.assign(fields, {
            'fill_1_P.3': firstShareholder.name,               // 中文姓名/名稱
            'fill_2_P.3': firstShareholder.surname,             // 英文姓氏 Surname
            'fill_3_P.3': firstShareholder.otherNames,          // 英文名字 Other Names
            // fill_4_P.3 is "OR" body-corporate alternative, leave empty
            'fill_10_P.3': firstShareholder.shareType || 'Ordinary', // 股份類別
            'fill_11_P.3': fmtNum(firstShareholder.shares || 0),     // 股份數目
            'fill_12_P.3': 'HKD',                                    // 貨幣
            'fill_13_P.3': `HKD ${fmtNum(firstShareholder.amountPaid || '0')}`, // 總款額
            // ── P.3 Total row ──
            'fill_18_P.3': fmtNum(totalSharesNum),                   // 總股數 Total Shares
          });
        }

        // ── P.4: First Secretary (Natural Person) ──
        if (firstSecNatural) {
          const snEn = parseEnName(firstSecNatural.nameEnglish);
          const snAddr = parseAddr(firstSecNatural.address);
          Object.assign(fields, {
            'fill_1_P.4': firstSecNatural.nameChinese || '',   // 中文姓名
            'fill_2_P.4': snEn.surname,                        // 英文姓氏
            'fill_3_P.4': snEn.otherNames,                     // 英文名字
            'fill_8_P.4': snAddr.flat,                         // 室/樓/座
            'fill_9_P.4': snAddr.building,                     // 大廈
            'fill_10_P.4': snAddr.street,                      // 街道
            'fill_11_P.4': snAddr.district,                    // 區
            'fill_12_P.4': '',                                 // 電郵
            'fill_13_P.4': fmtHkid(firstSecNatural.idNumber || ''), // HKID 前4位
          });
          // TCSP licence — assume not required unless specified
          checkboxes.push('cb_1_P.4'); // 無須領有牌照
        }

        // ── P.6: First Director (Natural Person) ──
        if (firstDirNatural) {
          const dnEn = parseEnName(firstDirNatural.nameEnglish);
          const dnAddr = parseAddr(firstDirNatural.address);
          Object.assign(fields, {
            'fill_1_P.6': firstDirNatural.nameChinese || '',   // 中文姓名
            'fill_2_P.6': dnEn.surname,                        // 英文姓氏
            'fill_3_P.6': dnEn.otherNames,                     // 英文名字
            'fill_8_P.6': dnAddr.flat,                         // 室/樓/座
            'fill_9_P.6': dnAddr.building,                     // 大廈
            'fill_10_P.6': dnAddr.street,                      // 街道
            'fill_11_P.6': dnAddr.district,                    // 區/市
            'fill_12_P.6': dnAddr.region,                      // 國家/地區
            'fill_13_P.6': '',                                 // 電郵
            'fill_14_P.6': fmtHkid(firstDirNatural.idNumber || ''), // HKID 前4位
          });
          // Consent to act as director checkbox
          checkboxes.push('cb_1_P.6');
        }

        // ── P.5: First Secretary (Body Corporate) ──
        if (firstSecCorporate) {
          const scAddr = parseAddr(firstSecCorporate.address);
          Object.assign(fields, {
            'fill_1_P.5': firstSecCorporate.nameChinese || '',  // 中文名稱
            'fill_2_P.5': firstSecCorporate.nameEnglish || '',  // 英文名稱
            'fill_3_P.5': scAddr.flat,                          // 室/樓/座
            'fill_4_P.5': scAddr.building,                      // 大廈
            'fill_5_P.5': scAddr.street,                        // 街道
            'fill_6_P.5': scAddr.district,                      // 區
            'fill_7_P.5': '',                                   // 電郵
            'fill_8_P.5': firstSecCorporate.companyNumberRef || '', // BR 號碼
          });
          checkboxes.push('cb_1_P.5'); // 無須領有牌照
        }

        // ── P.7: First Director (Body Corporate) ──
        if (firstDirCorporate) {
          const dcAddr = parseAddr(firstDirCorporate.address);
          Object.assign(fields, {
            'fill_1_P.7': firstDirCorporate.nameChinese || '',  // 中文名稱
            'fill_2_P.7': firstDirCorporate.nameEnglish || '',  // 英文名稱
            'fill_3_P.7': dcAddr.flat,                          // 室/樓/座
            'fill_4_P.7': dcAddr.building,                      // 大廈
            'fill_5_P.7': dcAddr.street,                        // 街道
            'fill_6_P.7': dcAddr.district,                      // 區/市
            'fill_7_P.7': dcAddr.region,                        // 國家/地區
            'fill_8_P.7': '',                                   // 電郵
            'fill_9_P.7': firstDirCorporate.companyNumberRef || '', // BR 號碼
          });
          checkboxes.push('cb_1_P.7'); // 同意書
          // Signer for body corporate director (P.7 bottom) — use shareholder as signer
          if (chosenSigner && signerFullNameEn) {
            Object.assign(fields, {
              'fill_10_P.7': signerFullNameEn,                  // 簽署人姓名
            });
          }
        }

        const resp = await fetch(`/api/generate-nnc1-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            fields,
            checkboxes,
            overlays,
            keepWidgets: true,
            alignCenterFields: ['fill_1_P.1', 'fill_2_P.1', 'fill_4_P.1', 'fill_1_P.3', 'fill_1_P.4', 'fill_1_P.5', 'fill_1_P.6', 'fill_1_P.7'],  // 公司名+業務性質+股東/秘書/董事中文名 水平居中
            alignVCenterFields: ['fill_1_P.1', 'fill_2_P.1', 'fill_4_P.1', 'fill_1_P.3', 'fill_1_P.4', 'fill_1_P.5', 'fill_1_P.6', 'fill_1_P.7'],  // 上下居中
            forceWidgetAp: ['fill_1_P.1'],  // 純英文公司名也走 widget AP 才可居中
            fieldMinFontSize: { 'fill_11_P.1': 11 },  // 提交人地址字體大一點
          }),
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || 'Unknown error');
        downloadBase64Pdf(result.pdf, 'NNC1-form.pdf');
        saveFormHistory({ formType: 'NNC1', formData: { jurisdiction, companyName, companyChinese, companyType, regAddress: regAddressJoined, addrFlat, addrBuilding, addrStreet, addrDistrict, addrRegion, companyEmail, companyPhone, businessNature, shareCapital, totalShares, submitterNameCn, submitterNameEn, submitterAddress, submitterPhone, submitterFax, submitterEmail, submitterRef, signerDate, authorisedShares, registeredAgent, officers, shareholders, signerShareholderIndex } });
        toast({ title: 'PDF 已生成', description: 'NNC1 已使用官方模板下載' });
      } else {
        // BVI — keep generic generator
        const sections: GenericFormSection[] = [];
        sections.push({
          heading: 'A. Company Particulars (BVI)',
          rows: [
            ['Proposed company name (English)', companyName],
            ['Proposed Chinese name 公司中文名稱', companyChinese || '—'],
            ['Company type 公司類型', companyType],
            ['Nature of business 業務性質', businessNature || '—'],
            ['Registered office address 註冊辦事處地址', regAddressJoined || '—'],
            ['Registered agent 註冊代理', registeredAgent || '—'],
          ],
        });
        sections.push({
          heading: 'B. 股本 Share Capital',
          rows: [
            ['Maximum number of shares authorised', authorisedShares],
            ['Class of shares', 'Ordinary'],
          ],
        });

        const bviSigner = shareholders[signerShareholderIndex] || shareholders[0];
        const bviSignerNameLine = bviSigner
          ? [bviSigner.surname, bviSigner.otherNames, bviSigner.name ? `(${bviSigner.name})` : ''].filter(Boolean).join(' ').trim() || '____________________'
          : '____________________';

        const ok = await downloadGenericFormPdf({
          formCode: 'NNC1-BVI',
          title: 'BVI Incorporation Application — Memorandum & Articles Summary',
          subtitle: 'British Virgin Islands — BC Act 2004',
          companyName,
          brNumber: '(待簽發 To be issued)',
          sections,
          signatureLines: [
            `簽署人 Founder Member: ${bviSignerNameLine}`,
            `日期 Date: __________`,
          ],
        }, 'NNC1-BVI');
        if (ok) {
          saveFormHistory({ formType: 'NNC1', formData: { jurisdiction, companyName, companyChinese, companyType, regAddress: regAddressJoined, addrFlat, addrBuilding, addrStreet, addrDistrict, addrRegion, companyEmail, companyPhone, businessNature, shareCapital, totalShares, submitterNameCn, submitterNameEn, submitterAddress, submitterPhone, submitterFax, submitterEmail, submitterRef, signerDate, authorisedShares, registeredAgent, officers, shareholders, signerShareholderIndex } });
          toast({ title: 'PDF 已生成', description: 'BVI 表格已下載' });
        }
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> 返回</Button>
        <Button onClick={handleGenerate} disabled={generating} className="bg-primary text-primary-foreground">
          {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          生成 PDF
        </Button>
      </div>

      <h2 className="text-xl font-semibold">新公司成立表格</h2>

      <FormHistorySelector formType="NNC1" onSelect={handleLoadHistory} />

      <Tabs value={jurisdiction} onValueChange={(v) => setJurisdiction(v as 'HK' | 'BVI')}>
        <TabsList>
          <TabsTrigger value="HK">NNC1 法團成立表格(股份有限公司)</TabsTrigger>
          <TabsTrigger value="BVI">BVI 新公司</TabsTrigger>
        </TabsList>

        <TabsContent value="HK" className="space-y-4 pt-4">
          <CapitalFields capital={shareCapital} setCapital={setShareCapital} totalShares={totalShares} setTotalShares={setTotalShares} />
        </TabsContent>
        <TabsContent value="BVI" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Authorised number of shares</Label>
              <Input value={authorisedShares} onChange={e => setAuthorisedShares(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Registered Agent (BVI)</Label>
              <Input value={registeredAgent} onChange={e => setRegisteredAgent(e.target.value)} />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Separator />

      <h3 className="font-semibold text-sm">A. 公司資料</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label className="text-xs">英文公司名稱 *</Label><Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. ABC Limited" /></div>
        <div className="space-y-1"><Label className="text-xs">中文公司名稱</Label><Input value={companyChinese} onChange={e => setCompanyChinese(e.target.value)} placeholder="如 ABC 有限公司" /></div>
        <div className="space-y-1">
          <Label className="text-xs">公司類型</Label>
          <Select value={companyType} onValueChange={setCompanyType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Private company limited by shares">Private company limited by shares</SelectItem>
              <SelectItem value="Public company limited by shares">Public company limited by shares</SelectItem>
              <SelectItem value="Company limited by guarantee">Company limited by guarantee</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">業務性質</Label><Input value={businessNature} onChange={e => setBusinessNature(e.target.value)} /></div>
      </div>
      {/* 註冊辦事處地址 — 5 欄拆分 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1"><Label className="text-xs">室／樓／座 Flat/Floor</Label><Input className="h-8 text-xs" value={addrFlat} onChange={e => setAddrFlat(e.target.value)} placeholder="Flat/Room" /></div>
        <div className="space-y-1"><Label className="text-xs">大廈 Building</Label><Input className="h-8 text-xs" value={addrBuilding} onChange={e => setAddrBuilding(e.target.value)} placeholder="Building" /></div>
        <div className="space-y-1"><Label className="text-xs">街道／屋苑 Street/Estate</Label><Input className="h-8 text-xs" value={addrStreet} onChange={e => setAddrStreet(e.target.value)} placeholder="Street" /></div>
        <div className="space-y-1">
          <Label className="text-xs">區 District</Label>
          <Select value={addrDistrict} onValueChange={setAddrDistrict}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="選擇地區" /></SelectTrigger>
            <SelectContent>
              {HK_DISTRICTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">國家／地區 Country／Region</Label>
          <Input className="h-8 text-xs" value={addrRegion} onChange={e => setAddrRegion(e.target.value)} placeholder="e.g. 香港" />
        </div>
      </div>
      {/* 公司聯絡 */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="space-y-1"><Label className="text-xs">公司電郵 Email</Label><Input className="h-8 text-xs" value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} placeholder="info@company.com" /></div>
        <div className="space-y-1"><Label className="text-xs">公司電話 Phone (+852)</Label><Input className="h-8 text-xs" value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} placeholder="1234 5678" /></div>
      </div>

      <Separator />

      <PresenterSelector
        currentData={{ name: submitterNameEn, nameEnglish: submitterNameEn, nameChinese: submitterNameCn, address: submitterAddress, phone: submitterPhone, fax: submitterFax, email: submitterEmail, reference: submitterRef }}
        onSelect={(p) => {
          setSubmitterNameEn(p.name || '');
          setSubmitterAddress(p.address || '');
          setSubmitterPhone(p.phone || '');
          setSubmitterFax(p.fax || '');
          setSubmitterEmail(p.email || '');
          setSubmitterRef(p.reference || '');
        }}
      />

      <h3 className="font-semibold text-sm">提交人資料 Presentor</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label className="text-xs">中文姓名／名稱</Label><Input className="h-8 text-xs" value={submitterNameCn} onChange={e => setSubmitterNameCn(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">英文姓名／名稱</Label><Input className="h-8 text-xs" value={submitterNameEn} onChange={e => setSubmitterNameEn(e.target.value)} /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">地址 Address</Label><Input className="h-8 text-xs" value={submitterAddress} onChange={e => setSubmitterAddress(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">電話 Tel</Label><Input className="h-8 text-xs" value={submitterPhone} onChange={e => setSubmitterPhone(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">傳真 Fax</Label><Input className="h-8 text-xs" value={submitterFax} onChange={e => setSubmitterFax(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">電郵 Email</Label><Input className="h-8 text-xs" value={submitterEmail} onChange={e => setSubmitterEmail(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">檔號 Reference</Label><Input className="h-8 text-xs" value={submitterRef} onChange={e => setSubmitterRef(e.target.value)} /></div>
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">B. 首任董事及秘書</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setOfficers([...officers, emptyOfficer('director')])}>
            <Plus className="h-3 w-3 mr-1" /> 加董事
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOfficers([...officers, emptyOfficer('secretary')])}>
            <Plus className="h-3 w-3 mr-1" /> 加秘書
          </Button>
        </div>
      </div>

      {officers.map((o, i) => (
        <div key={i} className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Select value={o.role} onValueChange={v => updateOfficer(i, { role: v as any })}>
                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="director">董事 Director</SelectItem>
                  <SelectItem value="secretary">秘書 Secretary</SelectItem>
                </SelectContent>
              </Select>
              <Select value={o.identity} onValueChange={v => updateOfficer(i, { identity: v as any })}>
                <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">自然人</SelectItem>
                  <SelectItem value="corporate">法人</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => removeOfficer(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-8 text-xs" placeholder="英文姓名" value={o.nameEnglish} onChange={e => updateOfficer(i, { nameEnglish: e.target.value })} />
            <Input className="h-8 text-xs" placeholder="中文姓名" value={o.nameChinese} onChange={e => updateOfficer(i, { nameChinese: e.target.value })} />
            <Input className="h-8 text-xs" placeholder="身份證/編號" value={o.idNumber} onChange={e => updateOfficer(i, { idNumber: e.target.value })} />
            {o.identity === 'natural' ? (
              <Input className="h-8 text-xs" placeholder="出生日期 DOB" value={o.dateOfBirth || ''} onChange={e => updateOfficer(i, { dateOfBirth: e.target.value })} />
            ) : (
              <Input className="h-8 text-xs" placeholder="成立地點" value={o.placeIncorporated || ''} onChange={e => updateOfficer(i, { placeIncorporated: e.target.value })} />
            )}
            {/* 地址拆分为独立字段：Flat / Building / Street / District */}
            {(() => {
              // ⚠️ 不用 filter(Boolean) — 固定5个逗号位，删除前面字段后面的不跳上来
              const parts = (o.address || '').split(/[,，]\s*/);
              const flat = parts[0] || '', building = parts[1] || '', street = parts[2] || '', district = parts[3] || '', region = parts[4] || '';
              const joinAddr = (f: string, b: string, s: string, d: string, r: string) =>
                [f, b, s, d, r].join(', ');  // 保留空位，不filter
              const setPart = (idx: number, val: string) => {
                const arr = [flat, building, street, district, region];
                arr[idx] = val;
                updateOfficer(i, { address: joinAddr(arr[0], arr[1], arr[2], arr[3], arr[4]) });
              };
              return (
                <>
                  <Input className="h-8 text-xs" placeholder="室/樓/座 Flat/Floor" value={flat} onChange={e => setPart(0, e.target.value)} />
                  <Input className="h-8 text-xs" placeholder="大廈 Building" value={building} onChange={e => setPart(1, e.target.value)} />
                  <Input className="h-8 text-xs" placeholder="街道 Street" value={street} onChange={e => setPart(2, e.target.value)} />
                  <Input className="h-8 text-xs" placeholder="區 District" value={district} onChange={e => setPart(3, e.target.value)} />
                  <Input className="h-8 text-xs" placeholder="地區 Region（如 香港）" value={region} onChange={e => setPart(4, e.target.value)} />
                </>
              );
            })()}
          </div>
        </div>
      ))}

      <Separator />

      <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
        <h3 className="font-semibold text-sm">B-1. 簽署人選擇 Signer（P.8 創辦成員陳述書）</h3>
        <p className="text-xs text-muted-foreground">
          NNC1 的簽署人必須是公司創辦股東（Founder Member）。請從下方股東列表中選擇。
        </p>
        <div className="space-y-1">
          <Label className="text-xs">創辦股東（簽署人）*</Label>
          <Select
            value={String(signerShareholderIndex)}
            onValueChange={(v) => setSignerShareholderIndex(Number(v))}
          >
            <SelectTrigger className="h-8 text-xs w-72">
              <SelectValue placeholder="選擇股東" />
            </SelectTrigger>
            <SelectContent>
              {shareholders.map((s, idx) => {
                const displayName = [s.surname, s.otherNames, s.name ? `(${s.name})` : ''].filter(Boolean).join(' ').trim();
                return (
                  <SelectItem key={idx} value={String(idx)}>
                    {displayName || `股東 #${idx + 1}（未命名）`}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        {shareholders.length === 0 && (
          <p className="text-xs text-destructive">
            ⚠ 請先在下方 C 區加入至少一位創辦股東。
          </p>
        )}
        <div className="space-y-1 pt-2">
          <Label className="text-xs">簽署日期 Date</Label>
          <Input type="date" className="h-8 text-xs w-48" value={signerDate} onChange={e => setSignerDate(e.target.value)} />
        </div>
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">C. 創辦股東</h3>
        <Button variant="outline" size="sm" onClick={() => setShareholders([...shareholders, emptyShare()])}>
          <Plus className="h-3 w-3 mr-1" /> 加股東
        </Button>
      </div>
      {shareholders.map((s, i) => (
        <div key={i} className="grid grid-cols-6 gap-2 items-end">
          <Input className="h-8 text-xs" placeholder="中文姓名" value={s.name} onChange={e => updateShare(i, { name: e.target.value })} />
          <Input className="h-8 text-xs" placeholder="英文姓氏 Surname" value={s.surname} onChange={e => updateShare(i, { surname: e.target.value })} />
          <Input className="h-8 text-xs" placeholder="英文名字 Other Names" value={s.otherNames} onChange={e => updateShare(i, { otherNames: e.target.value })} />
          <Input className="h-8 text-xs" type="number" placeholder="股數" value={s.shares || ''} onChange={e => updateShare(i, { shares: Number(e.target.value) || 0 })} />
          <Input className="h-8 text-xs" placeholder="類別" value={s.shareType} onChange={e => updateShare(i, { shareType: e.target.value })} />
          <Input className="h-8 text-xs" placeholder="實繳 HKD" value={s.amountPaid} onChange={e => updateShare(i, { amountPaid: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

function CapitalFields({ capital, setCapital, totalShares, setTotalShares }: {
  capital: string; setCapital: (v: string) => void;
  totalShares: string; setTotalShares: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1"><Label className="text-xs">已發行股本 Issued capital</Label><Input value={capital} onChange={e => setCapital(e.target.value)} /></div>
      <div className="space-y-1"><Label className="text-xs">股份總數 Total shares</Label><Input value={totalShares} onChange={e => setTotalShares(e.target.value)} /></div>
    </div>
  );
}
