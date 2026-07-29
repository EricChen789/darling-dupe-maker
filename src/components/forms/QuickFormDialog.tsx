// QuickFormDialog — "Generate Form" button from Company Chronicle events
// Takes event data and company info, pre-fills and generates the appropriate CR form PDF.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Loader2, FileText, Download } from 'lucide-react';

interface QuickFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: {
    id: string;
    name: string;
    chinese_name?: string;
    company_number?: string;
    ci_number?: string;
    incorporation_date?: string;
    jurisdiction?: string;
  };
  event: {
    type: string;
    title: string;
    raw: any;
  } | null;
}

// Form type → API endpoint mapping
const FORM_CONFIGS: Record<string, { label: string; endpoint: string; icon: string }> = {
  nd2a_appoint: { label: 'ND2A 委任通知書', endpoint: '/api/generate-nd2a-pdf', icon: '📋' },
  nd4_cease: { label: 'ND4 辭任通知書', endpoint: '/api/generate-nd4-pdf', icon: '📋' },
  bought_sold_note: { label: '買賣票據', endpoint: '/api/generate-share-transfer-pdf', icon: '💰' },
  instrument_of_transfer: { label: '轉讓文書', endpoint: '/api/generate-share-transfer-pdf', icon: '📄' },
  nsc1: { label: 'NSC1 配發申報書', endpoint: '/api/generate-nsc1-pdf', icon: '📋' },
};

function getFormOptions(eventType: string, raw: any): { key: string; config: typeof FORM_CONFIGS[string] }[] {
  const opts: { key: string; config: typeof FORM_CONFIGS[string] }[] = [];

  if (eventType === 'appoint') {
    opts.push({ key: 'nd2a_appoint', config: FORM_CONFIGS.nd2a_appoint });
  } else if (eventType === 'cease') {
    opts.push({ key: 'nd4_cease', config: FORM_CONFIGS.nd4_cease });
  } else if (eventType === 'transfer') {
    opts.push({ key: 'bought_sold_note', config: FORM_CONFIGS.bought_sold_note });
    opts.push({ key: 'instrument_of_transfer', config: FORM_CONFIGS.instrument_of_transfer });
  } else if (eventType === 'allotment' || eventType === 'shareholder_add') {
    opts.push({ key: 'nsc1', config: FORM_CONFIGS.nsc1 });
  } else if (eventType === 'shareholder_remove') {
    opts.push({ key: 'bought_sold_note', config: FORM_CONFIGS.bought_sold_note });
  }

  // Also allow for personnel roles
  if (raw?.role && (eventType === 'appoint' || eventType === 'cease')) {
    // Already covered above
  }

  return opts;
}

// ── Helper: parse English full name into surname + otherNames ──
// Matches Flask `_parse_english_name`: comma → "SURNAME, Other Names";
// otherwise Chinese/HK convention → first word = surname, rest = otherNames.
function parseEnglishName(fullName: string): { surname: string; otherNames: string } {
  if (!fullName) return { surname: '', otherNames: '' };
  const cleaned = fullName.trim();
  // Comma-separated: "SMITH, John" or "CHAN, Tai Man"
  if (cleaned.includes(',')) {
    const segs = cleaned.split(',').map(s => s.trim()).filter(Boolean);
    if (segs.length >= 2) return { surname: segs[0], otherNames: segs.slice(1).join(' ') };
    return { surname: segs[0] || '', otherNames: '' };
  }
  // Chinese/HK convention: first word = surname
  const parts = cleaned.split(/\s+/);
  if (parts.length <= 1) return { surname: parts[0] || '', otherNames: '' };
  return { surname: parts[0], otherNames: parts.slice(1).join(' ') };
}

// ── Helper: parse date string into { day, month, year } ──
function parseDateParts(dateStr: string): { day: string; month: string; year: string } {
  if (!dateStr) return { day: '', month: '', year: '' };
  // DD/MM/YYYY
  let m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { day: m[1].padStart(2, '0'), month: m[2].padStart(2, '0'), year: m[3] };
  // YYYY-MM-DD
  m = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { day: m[3].padStart(2, '0'), month: m[2].padStart(2, '0'), year: m[1] };
  // DDMMYYYY (8 digits)
  m = dateStr.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) return { day: m[1], month: m[2], year: m[3] };
  return { day: '', month: '', year: '' };
}

// ── Helper: normalise date to YYYY-MM-DD ──
function normalizeDate(dateStr: string): string {
  const { day, month, year } = parseDateParts(dateStr);
  return day && month && year ? `${year}-${month}-${day}` : dateStr || '';
}

// ── Simple role mapper: Chinese/English role → canonical ──
function mapRole(rawRole: string): string {
  const r = (rawRole || '').trim();
  if (r === '秘書' || r === '公司秘書' || r === 'secretary') return 'secretary';
  if (r === '候補董事' || r === 'alternate' || r === 'reserve_director') return 'alternate';
  return 'director';
}

// ── Read a raw field, trying camelCase then snake_case ──
function rget(obj: any, camel: string, snake: string): string {
  if (!obj) return '';
  return (obj[camel] ?? obj[snake] ?? '').toString();
}

function buildFormPayload(
  formKey: string, company: QuickFormDialogProps['company'], event: NonNullable<QuickFormDialogProps['event']>
): any {
  const { raw } = event;
  const rawRole = raw?.role || 'director';
  const role = mapRole(rawRole);
  const today = new Date().toLocaleDateString('en-GB');

  // Parse names once
  const engFull = rget(raw, 'nameEnglish', 'name_english');
  const { surname, otherNames } = parseEnglishName(engFull);
  const nameChinese = rget(raw, 'nameChinese', 'name_chinese') || raw?.chinese_name || '';
  const idNumber = rget(raw, 'idNumber', 'id_number');
  const passportNumber = rget(raw, 'passportNumber', 'passport_number');

  // Parse dates
  const dateAppointedRaw = rget(raw, 'dateAppointed', 'date_appointed') || today;
  const dateCeasedRaw = rget(raw, 'dateCeased', 'date_ceased');
  const dateAppointed = normalizeDate(dateAppointedRaw);
  const dateCeased = dateCeasedRaw ? normalizeDate(dateCeasedRaw) : '';
  // Use actual cessation date, DON'T fall back to today
  const ceasedParts = parseDateParts(dateCeasedRaw);

  // Default presenter (used across all forms unless overridden)
  const DEFAULT_PRESENTER = 'Twinsail Consultants Limited';

  // ── Address: residential first, fall back to service address ──
  // Structured residential
  let addrFlatBlock = rget(raw, 'addrFlat', 'addr_flat') || rget(raw, 'addrFlatBlock', 'addr_flat_block');
  let addrBuilding = rget(raw, 'addrBuilding', 'addr_building');
  let addrStreetEstate = rget(raw, 'addrStreet', 'addr_street') || rget(raw, 'addrStreetEstate', 'addr_street_estate');
  let addrDistrict = rget(raw, 'addrDistrict', 'addr_district');
  let addrRegion = rget(raw, 'addrRegion', 'addr_region');
  let address = raw?.address || '';
  // Service address (for fallback)
  const svcAddrFlat = rget(raw, 'svcAddrFlat', 'svc_addr_flat');
  const svcAddrBuilding = rget(raw, 'svcAddrBuilding', 'svc_addr_building');
  const svcAddrStreet = rget(raw, 'svcAddrStreet', 'svc_addr_street');
  const svcAddrDistrict = rget(raw, 'svcAddrDistrict', 'svc_addr_district');
  const svcAddrRegion = rget(raw, 'svcAddrRegion', 'svc_addr_region');
  const serviceAddress = raw?.serviceAddress || raw?.person_service_address || '';
  // Fallback: if no residential address at all, use service address
  const hasResAddr = addrFlatBlock || addrBuilding || addrStreetEstate || addrDistrict || addrRegion || address;
  if (!hasResAddr) {
    addrFlatBlock = svcAddrFlat;
    addrBuilding = svcAddrBuilding;
    addrStreetEstate = svcAddrStreet;
    addrDistrict = svcAddrDistrict;
    addrRegion = svcAddrRegion;
    address = serviceAddress;
  }

  const base: any = {
    company_id: company.id,
    companyId: company.id,
    companyName: company.name,
    chineseCompanyName: company.chinese_name || '',
    brNumber: company.company_number || '',
    ciNumber: company.ci_number || '',
  };

  switch (formKey) {
    case 'nd2a_appoint': {
      const officer: any = {
        nameEnglish: engFull,
        nameSurname: surname,
        nameOtherNames: otherNames,
        nameChinese,
        role,
        identity: raw?.identity || 'natural',
        idNumber,
        address,
        dateAppointed,
        type: 'appointment',
      };
      // Passport
      if (raw?.passportCountry || raw?.passport_country) officer.passportCountry = rget(raw, 'passportCountry', 'passport_country');
      if (passportNumber) officer.passportNumber = passportNumber;
      // Structured address (preferred by backend for P.2 fill_10~14)
      if (addrFlatBlock || addrBuilding || addrStreetEstate || addrDistrict || addrRegion) {
        officer.addrFlatBlock = addrFlatBlock;
        officer.addrBuilding = addrBuilding;
        officer.addrStreetEstate = addrStreetEstate;
        officer.addrDistrict = addrDistrict;
        officer.addrRegion = addrRegion;
      }
      // Alternate-to
      if (role === 'alternate') {
        officer.alternateTo = rget(raw, 'alternateTo', 'alternate_to');
      }
      return { ...base, officers: [officer] };
    }
    case 'nd4_cease': {
      // ND4 backend expects flat top-level keys (NOT officers[] array)
      const nd4Identity = raw?.identity || 'natural';
      const nd4Payload: any = {
        ...base,
        officerType: role,                       // director / secretary / alternate
        identity: nd4Identity,
        resignationDay: ceasedParts.day,
        resignationMonth: ceasedParts.month,
        resignationYear: ceasedParts.year,
        // Signer defaults to the officer themselves
        signerName: engFull,
        signDateDay: new Date().getDate().toString().padStart(2, '0'),
        signDateMonth: (new Date().getMonth() + 1).toString().padStart(2, '0'),
        signDateYear: new Date().getFullYear().toString(),
        // Presenter — default Twinsail Consultants Limited
        presentorName: DEFAULT_PRESENTER,
      };
      if (nd4Identity === 'natural') {
        nd4Payload.officerNameChinese = nameChinese;
        nd4Payload.surname = surname;
        nd4Payload.otherNames = otherNames;
        nd4Payload.hkidPartial = (idNumber || '').slice(0, 4);
        nd4Payload.passportCountry = rget(raw, 'passportCountry', 'passport_country');
        nd4Payload.passportPartial = passportNumber;
        if (role === 'alternate') {
          nd4Payload.alternateTo = rget(raw, 'alternateTo', 'alternate_to');
        }
      } else {
        // Body corporate: company name + registration number
        nd4Payload.corporateName = engFull;  // the "nameEnglish" IS the company name
        nd4Payload.corporateNumber = raw?.companyNumberRef || raw?.brNumber || idNumber;
      }
      return nd4Payload;
    }
    case 'bought_sold_note': {
      // Backend reads: companyId, documentType (camelCase)
      const fromName = raw?.from_name || raw?.fromName || '';
      const toName = raw?.to_name || raw?.toName || '';
      return {
        ...base,
        companyId: company.id,
        documentType: 'bought_sold_note',
        from_name: fromName,
        to_name: toName,
        shares: raw?.shares || 0,
        price_per_share: raw?.price_per_share || raw?.pricePerShare || '',
        total_consideration: raw?.total_consideration || raw?.totalConsideration || '',
        transaction_date: raw?.transaction_date || raw?.transactionDate || today,
        currency: raw?.currency || 'HKD',
      };
    }
    case 'instrument_of_transfer': {
      const fromName = raw?.from_name || raw?.fromName || '';
      const toName = raw?.to_name || raw?.toName || '';
      return {
        ...base,
        companyId: company.id,
        documentType: 'instrument_of_transfer',
        from_name: fromName,
        to_name: toName,
        shares: raw?.shares || 0,
        price_per_share: raw?.price_per_share || raw?.pricePerShare || '',
        transaction_date: raw?.transaction_date || raw?.transactionDate || today,
      };
    }
    case 'nsc1': {
      // NSC1 backend reads `fields` dict (widget_name → value) + `company_id` for auto-fill
      const shares = raw?.shares || 0;
      const shareType = raw?.share_type || raw?.shareType || 'Ordinary';
      const issuePrice = raw?.price_per_share || raw?.pricePerShare || raw?.issuePrice || '1.00';
      const totalPaid = shares * parseFloat(issuePrice || '1.00');
      const txDate = raw?.transaction_date || raw?.transactionDate || raw?.dateAppointed || today;
      const dateParts = parseDateParts(txDate);
      return {
        company_id: company.id,
        brNumber: company.company_number || '',
        fields: {
          'fill_1_P.1': (company.company_number || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8),
          'fill_2_P.1': company.name,
          'fill_3_P.1': txDate,
          'fill_4_P.1': dateParts.day,
          'fill_5_P.1': dateParts.month,
          'fill_6_P.1': dateParts.year,
          'fill_8_P.1': shareType,
          'fill_9_P.1': String(shares),
          'fill_17_P.1': totalPaid.toFixed(2),
          'fill_18_P.1': shares > 0 ? '0.00' : '',
        },
        checkboxes: ['cb_1_P.1'],
      };
    }
    default:
      return base;
  }
}

async function downloadPdf(base64: string, filename: string) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function QuickFormDialog({ open, onOpenChange, company, event }: QuickFormDialogProps) {
  const [loading, setLoading] = useState<string | null>(null);

  if (!event) return null;
  const formOptions = getFormOptions(event.type, event.raw);
  if (formOptions.length === 0) return null;

  const handleGenerate = async (formKey: string) => {
    setLoading(formKey);
    try {
      const config = FORM_CONFIGS[formKey];
      const payload = buildFormPayload(formKey, company, event);
      const token = localStorage.getItem('secretary_jwt') || '';

      const resp = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const result = await resp.json();
      if (result.pdf) {
        const safeName = (company.name || 'company').replace(/[^a-zA-Z0-9一-鿿]/g, '_');
        const filename = `${config.label.replace(/\s/g, '_')}_${safeName}.pdf`;
        await downloadPdf(result.pdf, filename);
        toast({ title: '✅ PDF 已生成', description: `${config.label} 下載完成` });
        onOpenChange(false);
      } else {
        throw new Error('No PDF data in response');
      }
    } catch (err: any) {
      console.error('[QuickForm] Generation failed:', err);
      toast({ title: '❌ 生成失敗', description: err.message || '未知錯誤', variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            生成相關表格
          </DialogTitle>
          <DialogDescription>
            基於公司誌事件「{event.title}」自動生成對應的政府表格
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="text-sm text-muted-foreground">
            公司：<span className="font-medium text-foreground">{company.name}</span>
            {company.chinese_name && <span className="text-foreground">（{company.chinese_name}）</span>}
          </div>
          <div className="text-sm text-muted-foreground">
            事件類型：<Badge variant="secondary" className="ml-1">{event.type}</Badge>
          </div>

          <div className="space-y-2 pt-2">
            <p className="text-sm font-medium">選擇要生成的表格：</p>
            {formOptions.map(opt => (
              <Button
                key={opt.key}
                variant="outline"
                className="w-full justify-between"
                disabled={loading !== null}
                onClick={() => handleGenerate(opt.key)}
              >
                <span className="flex items-center gap-2">
                  <span>{opt.config.icon}</span>
                  <span>{opt.config.label}</span>
                </span>
                {loading === opt.key ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
