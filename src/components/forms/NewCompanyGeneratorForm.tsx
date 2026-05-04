import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Download, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { downloadGenericFormPdf, type GenericFormSection } from '@/lib/genericFormPdf';

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
  name: string;
  shares: number;
  shareType: string;
  amountPaid: string;
}

const emptyOfficer = (role: 'director' | 'secretary' = 'director'): OfficerEntry => ({
  role, identity: 'natural', nameEnglish: '', nameChinese: '', idNumber: '', address: '', dateOfBirth: '',
});

const emptyShare = (): ShareEntry => ({ name: '', shares: 0, shareType: 'Ordinary', amountPaid: '' });

export default function NewCompanyGeneratorForm({ onBack }: Props) {
  const [jurisdiction, setJurisdiction] = useState<'HK' | 'BVI'>('HK');
  const [generating, setGenerating] = useState(false);

  // Common
  const [companyName, setCompanyName] = useState('');
  const [companyChinese, setCompanyChinese] = useState('');
  const [companyType, setCompanyType] = useState('Private company limited by shares');
  const [regAddress, setRegAddress] = useState('');
  const [businessNature, setBusinessNature] = useState('');

  // HK NNC1 specific
  const [shareCapital, setShareCapital] = useState('HKD 10,000');
  const [totalShares, setTotalShares] = useState('10000');

  // BVI specific
  const [authorisedShares, setAuthorisedShares] = useState('50000');
  const [registeredAgent, setRegisteredAgent] = useState('');

  const [officers, setOfficers] = useState<OfficerEntry[]>([emptyOfficer('director'), emptyOfficer('secretary')]);
  const [shareholders, setShareholders] = useState<ShareEntry[]>([emptyShare()]);

  // 簽署人選擇:選擇類型 + 具體人員索引
  const [signerRole, setSignerRole] = useState<'director' | 'secretary'>('director');
  const [signerIndex, setSignerIndex] = useState<number>(-1); // -1 = 未指定具體人

  // 依當前 signerRole 篩選候選人
  const signerCandidates = officers
    .map((o, idx) => ({ o, idx }))
    .filter(({ o }) => o.role === signerRole);

  const updateOfficer = (i: number, patch: Partial<OfficerEntry>) =>
    setOfficers(arr => arr.map((o, idx) => idx === i ? { ...o, ...patch } : o));
  const removeOfficer = (i: number) => setOfficers(arr => arr.filter((_, idx) => idx !== i));
  const updateShare = (i: number, patch: Partial<ShareEntry>) =>
    setShareholders(arr => arr.map((s, idx) => idx === i ? { ...s, ...patch } : s));

  const handleGenerate = async () => {
    if (!companyName.trim()) {
      toast({ title: '請填寫公司名稱', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const sections: GenericFormSection[] = [];

      // Section A — Company info
      const aRows: [string, string][] = [
        ['Proposed company name (English)', companyName],
        ['Proposed Chinese name 公司中文名稱', companyChinese || '—'],
        ['Company type 公司類型', companyType],
        ['Nature of business 業務性質', businessNature || '—'],
        ['Registered office address 註冊辦事處地址', regAddress || '—'],
      ];
      if (jurisdiction === 'BVI') {
        aRows.push(['Registered agent 註冊代理', registeredAgent || '—']);
      }
      sections.push({ heading: jurisdiction === 'HK' ? 'A. 公司資料 Company Particulars' : 'A. Company Particulars (BVI)', rows: aRows });

      // Section B — Capital
      sections.push({
        heading: 'B. 股本 Share Capital',
        rows: jurisdiction === 'HK'
          ? [
            ['Issued share capital 已發行股本', shareCapital],
            ['Total number of shares 股份總數', totalShares],
          ]
          : [
            ['Maximum number of shares authorised', authorisedShares],
            ['Class of shares', 'Ordinary'],
          ],
      });

      // Section C — Officers
      const officerRows: [string, string][] = [];
      officers.forEach((o, idx) => {
        officerRows.push([`#${idx + 1} 角色 Role`, `${o.role === 'director' ? '董事 Director' : '公司秘書 Secretary'} (${o.identity})`]);
        officerRows.push([`   英文姓名 Name (Eng)`, o.nameEnglish || '—']);
        officerRows.push([`   中文姓名 Name (中)`, o.nameChinese || '—']);
        officerRows.push([`   身份證/護照/編號`, o.idNumber || '—']);
        if (o.identity === 'natural') {
          officerRows.push([`   出生日期 DOB`, o.dateOfBirth || '—']);
        } else {
          officerRows.push([`   成立地點 Place Incorporated`, o.placeIncorporated || '—']);
          officerRows.push([`   公司編號 Company No.`, o.companyNumberRef || '—']);
        }
        officerRows.push([`   地址 Address`, o.address || '—']);
      });
      sections.push({ heading: 'C. 首任董事及秘書 First Directors & Secretary', rows: officerRows });

      // Section D — Founder shareholders
      const shRows: [string, string][] = [];
      shareholders.forEach((s, idx) => {
        shRows.push([`#${idx + 1} 股東 Member`, s.name || '—']);
        shRows.push([`   股數 Shares`, String(s.shares)]);
        shRows.push([`   類別 Class`, s.shareType]);
        shRows.push([`   實繳 Amount Paid`, s.amountPaid || '—']);
      });
      sections.push({ heading: 'D. 創辦股東 Founder Members', rows: shRows });

      // Declaration
      sections.push({
        heading: jurisdiction === 'HK' ? 'E. 法定聲明 Declaration (s.67 CO)' : 'E. Declaration of Incorporator (BVI BC Act)',
        paragraph: jurisdiction === 'HK'
          ? '本人聲明上述為新公司成立的真實情況，並符合《公司條例》（第 622 章）下的所有適用要求。'
          : 'I declare that the requirements of the BVI Business Companies Act 2004 in respect of the matters precedent to the registration of the Company have been complied with.',
      });

      const formCode = jurisdiction === 'HK' ? 'NNC1' : 'NNC1-BVI';
      const title = jurisdiction === 'HK'
        ? '法團成立表格 (公司股份有限公司) - NNC1'
        : 'BVI Incorporation Application — Memorandum & Articles Summary';

      const ok = await downloadGenericFormPdf({
        formCode,
        title,
        subtitle: jurisdiction === 'HK'
          ? '香港公司註冊處 — 第 622 章 公司條例'
          : 'British Virgin Islands — BC Act 2004',
        companyName,
        brNumber: '(待簽發 To be issued)',
        sections,
        signatureLines: [
          'Founder member / 創辦人 (1): ____________________   Date: __________',
          'Founder member / 創辦人 (2): ____________________   Date: __________',
        ],
      }, formCode);

      if (ok) toast({ title: 'PDF 已生成', description: `${formCode} 已下載` });
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

      <Tabs value={jurisdiction} onValueChange={(v) => setJurisdiction(v as 'HK' | 'BVI')}>
        <TabsList>
          <TabsTrigger value="HK">香港 NNC1</TabsTrigger>
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
        <div className="col-span-2 space-y-1"><Label className="text-xs">註冊辦事處地址</Label><Textarea rows={2} value={regAddress} onChange={e => setRegAddress(e.target.value)} /></div>
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
            <Textarea className="col-span-2 text-xs" rows={2} placeholder="地址 Address" value={o.address} onChange={e => updateOfficer(i, { address: e.target.value })} />
          </div>
        </div>
      ))}

      <Separator />

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">C. 創辦股東</h3>
        <Button variant="outline" size="sm" onClick={() => setShareholders([...shareholders, emptyShare()])}>
          <Plus className="h-3 w-3 mr-1" /> 加股東
        </Button>
      </div>
      {shareholders.map((s, i) => (
        <div key={i} className="grid grid-cols-4 gap-2 items-end">
          <Input className="h-8 text-xs" placeholder="股東姓名" value={s.name} onChange={e => updateShare(i, { name: e.target.value })} />
          <Input className="h-8 text-xs" type="number" placeholder="股數" value={s.shares} onChange={e => updateShare(i, { shares: Number(e.target.value) || 0 })} />
          <Input className="h-8 text-xs" placeholder="類別" value={s.shareType} onChange={e => updateShare(i, { shareType: e.target.value })} />
          <Input className="h-8 text-xs" placeholder="實繳" value={s.amountPaid} onChange={e => updateShare(i, { amountPaid: e.target.value })} />
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
