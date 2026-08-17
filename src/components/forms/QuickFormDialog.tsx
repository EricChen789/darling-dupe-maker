// QuickFormDialog — "Generate Form" button from Company Chronicle events
// Takes event data and company info, pre-fills and generates the appropriate CR form PDF.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { downloadBase64Pdf } from '@/lib/downloadPdf';
import { postJson, parseEnglishName, parseDateParts, normalizeDate, safeFileName } from '@/lib/formGen';
import { Loader2, FileText, Download } from 'lucide-react';

export interface QuickFormEvent {
  type: string;
  title: string;
  raw: any;
}

interface QuickFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: {
    id: string;
    name: string;
    chineseName?: string;
    brNumber?: string;
    ciNumber?: string;
    incorporationDate?: string;
    jurisdiction?: string;
  };
  /** 同一天的人事事件（委任＋辭任多於一人時會一併生成）或單一非人事事件 */
  events: QuickFormEvent[];
}

// Form type → API endpoint mapping
const FORM_CONFIGS: Record<string, { label: string; endpoint: string; icon: string }> = {
  nd2a_appoint: { label: 'ND2A 委任／停任通知書', endpoint: '/api/generate-nd2a-pdf', icon: '📋' },
  nd4_cease: { label: 'ND4 辭任通知書', endpoint: '/api/generate-nd4-pdf', icon: '📋' },
  bought_sold_note: { label: '買賣票據', endpoint: '/api/generate-share-transfer-rtf', icon: '💰' },
  instrument_of_transfer: { label: '轉讓文書', endpoint: '/api/generate-share-transfer-rtf', icon: '📄' },
  share_certificate: { label: '股票證書', endpoint: '/api/generate-share-transfer-rtf', icon: '🏷️' },
  nsc1: { label: 'NSC1 配發申報書', endpoint: '/api/generate-nsc1-pdf', icon: '📋' },
  nd2b_change: { label: 'ND2B 更改詳情通知書', endpoint: '/api/generate-nd2b-pdf', icon: '📋' },
};

function getFormOptions(events: QuickFormEvent[]): { key: string; config: typeof FORM_CONFIGS[string] }[] {
  const opts: { key: string; config: typeof FORM_CONFIGS[string] }[] = [];

  // ── 人事事件（委任＋辭任）— 同一天多位人士一併處理 ──
  const personnel = events.filter(e => e.type === 'appoint' || e.type === 'cease');
  if (personnel.length > 0) {
    // ND2A 一份可含委任＋停任（模板容量 2 停任 + 2 自然人 + 2 法人，超出自動分多份）
    opts.push({ key: 'nd2a_appoint', config: FORM_CONFIGS.nd2a_appoint });
    if (personnel.some(e => e.type === 'cease')) {
      // ND4 是辭任人本人遞交的通知書 — 按需生成（每位辭任人一份），
      // 默認「一起生成」只出 1 份 ND2A（辭任已併入其停任區塊）
      opts.push({ key: 'nd4_cease', config: FORM_CONFIGS.nd4_cease });
    }
  }

  const eventType = events[0]?.type || '';
  if (eventType === 'transfer') {
    opts.push({ key: 'bought_sold_note', config: FORM_CONFIGS.bought_sold_note });
    opts.push({ key: 'instrument_of_transfer', config: FORM_CONFIGS.instrument_of_transfer });
    opts.push({ key: 'share_certificate', config: FORM_CONFIGS.share_certificate });
  } else if (eventType === 'allotment' || eventType === 'shareholder_add' || eventType === 'capital_increase') {
    opts.push({ key: 'nsc1', config: FORM_CONFIGS.nsc1 });
    opts.push({ key: 'share_certificate', config: FORM_CONFIGS.share_certificate });
  } else if (eventType === 'shareholder_remove') {
    opts.push({ key: 'bought_sold_note', config: FORM_CONFIGS.bought_sold_note });
  } else if (eventType === 'repurchase') {
    opts.push({ key: 'bought_sold_note', config: FORM_CONFIGS.bought_sold_note });
    opts.push({ key: 'share_certificate', config: FORM_CONFIGS.share_certificate });
  } else if (eventType === 'nd2b_change') {
    opts.push({ key: 'nd2b_change', config: FORM_CONFIGS.nd2b_change });
  }

  return opts;
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

// ── Helper: build one ND2A officer from a personnel QuickFormEvent ──
// Handles both appointment (委任) and cessation (停任) — backend accepts mixed officers[].
function buildNd2aOfficer(pe: QuickFormEvent): any {
  const raw = pe.raw || {};
  const rawRole = raw.role || 'director';
  let role = mapRole(rawRole);
  // If the person is an alternate director (候補董事), use 'alternate'
  if (raw.isReserve) role = 'alternate';
  const isAppoint = pe.type === 'appoint';
  const today = new Date().toLocaleDateString('en-GB');

  // Parse names once
  const engFull = rget(raw, 'nameEnglish', 'name_english');
  const { surname, otherNames } = parseEnglishName(engFull);
  const nameChinese = rget(raw, 'nameChinese', 'name_chinese') || raw?.chinese_name || '';
  const idNumber = rget(raw, 'idNumber', 'id_number');
  const passportNumber = rget(raw, 'passportNumber', 'passport_number');
  const isCorporate = (raw.identity || 'natural') === 'corporate';

  // ── Address: residential first, fall back to service address ──
  let addrFlatBlock = rget(raw, 'addrFlat', 'addr_flat') || rget(raw, 'addrFlatBlock', 'addr_flat_block');
  let addrBuilding = rget(raw, 'addrBuilding', 'addr_building');
  let addrStreetEstate = rget(raw, 'addrStreet', 'addr_street') || rget(raw, 'addrStreetEstate', 'addr_street_estate');
  let addrDistrict = rget(raw, 'addrDistrict', 'addr_district');
  let addrRegion = rget(raw, 'addrRegion', 'addr_region');
  let address = raw?.address || '';
  const svcAddrFlat = rget(raw, 'svcAddrFlat', 'svc_addr_flat');
  const svcAddrBuilding = rget(raw, 'svcAddrBuilding', 'svc_addr_building');
  const svcAddrStreet = rget(raw, 'svcAddrStreet', 'svc_addr_street');
  const svcAddrDistrict = rget(raw, 'svcAddrDistrict', 'svc_addr_district');
  const svcAddrRegion = rget(raw, 'svcAddrRegion', 'svc_addr_region');
  const serviceAddress = raw?.serviceAddress || raw?.person_service_address || '';
  const hasResAddr = addrFlatBlock || addrBuilding || addrStreetEstate || addrDistrict || addrRegion || address;
  if (!hasResAddr) {
    addrFlatBlock = svcAddrFlat;
    addrBuilding = svcAddrBuilding;
    addrStreetEstate = svcAddrStreet;
    addrDistrict = svcAddrDistrict;
    addrRegion = svcAddrRegion;
    address = serviceAddress;
  }

  const officer: any = {
    type: isAppoint ? 'appointment' : 'cessation',
    role,
    identity: raw.identity || 'natural',
    nameEnglish: engFull,
    nameSurname: surname,
    nameOtherNames: otherNames,
    nameChinese,
    idNumber,
    address,
  };

  if (isAppoint) {
    // Appointment date — fall back to today if missing
    officer.dateAppointed = normalizeDate(rget(raw, 'dateAppointed', 'date_appointed') || today);
    if (!isCorporate) {
      const alreadyDir = rget(raw, 'alreadyDirector', 'already_director');
      officer.alreadyDirector = (alreadyDir === 'yes' || alreadyDir === 'no') ? alreadyDir : 'no';
    }
  } else {
    // Cessation date — use actual date, DON'T fall back to today
    const dateCeasedRaw = rget(raw, 'dateCeased', 'date_ceased');
    officer.dateCeased = dateCeasedRaw ? normalizeDate(dateCeasedRaw) : '';
    officer.cessationReason = 'resignation';
    officer.stillHoldsOffice = 'no';
  }

  if (isCorporate) {
    // Corporate-specific fields (P.3/P.6 法人團體)
    officer.companyName = engFull;  // 公司英文名稱 → fill_4
    const corpBR = rget(raw, 'companyNumberRef', 'company_number_ref') || idNumber || '';
    officer.companyNumber = corpBR;  // 商業登記號碼 → fill_11
    officer.placeIncorporated = rget(raw, 'placeIncorporated', 'place_incorporated') || raw?.addrRegion || raw?.addr_region || 'Hong Kong';
    const tcspLicence = rget(raw, 'tcspNumber', 'tcsp_number') || (raw as any)?.tcsp_number || (raw as any)?.tcspLicence || '';
    if (tcspLicence) officer.tcspLicence = tcspLicence;
  }

  // Passport
  if (raw?.passportCountry || raw?.passport_country) officer.passportCountry = rget(raw, 'passportCountry', 'passport_country');
  if (passportNumber) officer.passportNumber = passportNumber;
  // Structured address (preferred by backend for P.2 fill_10~14 / P.7 fill_9~13)
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

  return officer;
}

// ── Helper: ND2A payload for a list of officers ──
function buildNd2aPayload(company: QuickFormDialogProps['company'], officers: any[]): any {
  const today = new Date().toLocaleDateString('en-GB');
  const DEFAULT_PRESENTER = {
    name: 'Twinsail Consultants Limited',
    address: 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong',
    phone: '+852 2521 3888',
    fax: '+852 2521 3999',
    email: 'info@twinsail.com',
    reference: 'TS-2026-001',
  };
  const firstOfficerName = officers[0]?.nameEnglish || '';
  return {
    company_id: company.id,
    companyId: company.id,
    companyName: company.name,
    chineseCompanyName: company.chineseName || '',
    brNumber: company.brNumber || '',
    ciNumber: company.ciNumber || '',
    officers,
    signerName: firstOfficerName,
    signDate: today.split('/').reverse().join('-'),  // DD/MM/YYYY → YYYY-MM-DD
    presentorName: DEFAULT_PRESENTER.name,
    presentorAddress: DEFAULT_PRESENTER.address,
    presentorPhone: DEFAULT_PRESENTER.phone,
    presentorFax: DEFAULT_PRESENTER.fax,
    presentorEmail: DEFAULT_PRESENTER.email,
    presentorReference: DEFAULT_PRESENTER.reference,
  };
}

function buildFormPayload(
  formKey: string, company: QuickFormDialogProps['company'], events: QuickFormEvent[]
): any {
  const event = events[0];
  const { raw } = event;
  const rawRole = raw?.role || 'director';
  let role = mapRole(rawRole);
  // If the person is an alternate director (候補董事), use 'alternate'
  if (raw?.isReserve) role = 'alternate';
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
  const DEFAULT_PRESENTER = {
    name: 'Twinsail Consultants Limited',
    address: 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong',
    contact: 'Tel: +852 2521 3888  Fax: +852 2521 3999  Email: info@twinsail.com',
    phone: '+852 2521 3888',
    fax: '+852 2521 3999',
    email: 'info@twinsail.com',
    reference: 'TS-2026-001',
  };

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
    chineseCompanyName: company.chineseName || '',
    brNumber: company.brNumber || '',
    ciNumber: company.ciNumber || '',
  };

  switch (formKey) {
    case 'nd2a_appoint': {
      // 同一天全部人事事件（委任＋辭任）一併生成 ND2A
      const officers = events
        .filter(e => e.type === 'appoint' || e.type === 'cease')
        .map(e => buildNd2aOfficer(e));
      return buildNd2aPayload(company, officers);
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
        // Presenter — default Twinsail Consultants Limited (full info)
        presentorName: DEFAULT_PRESENTER.name,
        presentorAddress: DEFAULT_PRESENTER.address,
        presentorPhone: DEFAULT_PRESENTER.phone,
        presentorFax: DEFAULT_PRESENTER.fax,
        presentorEmail: DEFAULT_PRESENTER.email,
        presentorReference: DEFAULT_PRESENTER.reference,
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
        from_person_id: raw?.from_person_id || raw?.fromPersonId || '',
        from_name: fromName,
        to_person_id: raw?.to_person_id || raw?.toPersonId || '',
        to_name: toName,
        shares: raw?.shares || 0,
        price_per_share: raw?.price_per_share || raw?.pricePerShare || '',
        total_consideration: raw?.total_consideration || raw?.totalConsideration || '',
        // 日期留空：轉讓文件日期稍後再填（不自動填今天）
        transaction_date: raw?.transaction_date || raw?.transactionDate || '',
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
        from_person_id: raw?.from_person_id || raw?.fromPersonId || '',
        from_name: fromName,
        to_person_id: raw?.to_person_id || raw?.toPersonId || '',
        to_name: toName,
        shares: raw?.shares || 0,
        price_per_share: raw?.price_per_share || raw?.pricePerShare || '',
        // 日期留空：轉讓文件日期稍後再填（不自動填今天）
        transaction_date: raw?.transaction_date || raw?.transactionDate || '',
      };
    }
    case 'nsc1': {
      // NSC1 P.1 layout (verified by Qwen VL 2026-08-04):
      //   y=242  Allotment Date FROM/TO: fill_3-5=D/M/Y(FROM)  fill_6-8=D/M/Y(TO)
      //   y=376  Section B (Total Consideration): fill_9=Currency fill_10=Amount (3 rows)
      //   y=594  Section D (New Allotment): 3rows×5cols Class|Currency|Number|Paid|Unpaid
      //   y=678  Presenter: fill_30=Name fill_31=Address fill_32=Phone fill_33=Fax fill_34=Email fill_35=Ref
      // P.3: Share Capital table (TOTAL post-allotment) — filled by backend from DB
      // P.7: Schedule 2 — Allottee personal details (name, address, shares)
      const shares = raw?.shares || 0;
      const shareType = raw?.share_type || raw?.shareType || 'Ordinary';
      const pricePerShare = parseFloat(raw?.price_per_share || raw?.pricePerShare || raw?.issuePrice || '1.00');
      const totalConsideration = shares * pricePerShare;
      const currency = raw?.currency || 'HKD';
      const txDate = raw?.transaction_date || raw?.transactionDate || raw?.dateAppointed || today;
      const allotParts = parseDateParts(txDate);
      const br8 = (company.brNumber || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
      // Allottee data for Schedule 2 (P.7)
      const allotteeName = raw?.to_name || raw?.toName || '';
      const allotteeNameZh = raw?.to_name_zh || raw?.toNameZh || '';
      return {
        company_id: company.id,
        brNumber: br8,
        // Top-level data for backend processing
        allotteeName,
        allotteeNameZh,
        allotteeShares: shares,
        allotteeClass: shareType,
        shares,
        shareClass: shareType,
        pricePerShare: pricePerShare.toFixed(2),
        currency,
        totalConsideration: totalConsideration.toFixed(2),
        allotmentDate: `${allotParts.day}/${allotParts.month}/${allotParts.year}`,
        // Task 1: Non-cash consideration (default: cash-only)
        nonCashConsideration: false,
        nonCashTypes: [],
        nonCashDetails: '',
        // Task 2: Structured allottees list for P.7 Schedule 2
        allottees: (allotteeName || allotteeNameZh) ? [{
          nameEn: allotteeName,
          nameZh: allotteeNameZh,
          shares: String(shares),
          country: 'Hong Kong',
        }] : [],
        fields: {
          // ── P.1 Header ──
          'fill_1_P.1': br8,
          'fill_2_P.1': company.name,
          // ── Allotment Date FROM (D/M/Y) ──
          'fill_3_P.1': allotParts.day,
          'fill_4_P.1': allotParts.month,
          'fill_5_P.1': allotParts.year,
          // ── Allotment Date TO (D/M/Y) — same as FROM for single-date allotment ──
          'fill_6_P.1': allotParts.day,
          'fill_7_P.1': allotParts.month,
          'fill_8_P.1': allotParts.year,
          // ── Section B: Total Consideration (Currency | Amount) ──
          'fill_9_P.1': currency,
          'fill_10_P.1': totalConsideration.toFixed(2),
          // ── Section D: New Allotment (Class|Currency|Number|Paid|Unpaid) ──
          'fill_15_P.1': shareType,
          'fill_16_P.1': currency,
          'fill_17_P.1': String(shares),
          'fill_18_P.1': pricePerShare.toFixed(2),
          'fill_19_P.1': '0.00',
        },
        checkboxes: ['cb_1_P.1'],
      };
    }
    case 'nd2b_change': {
      // Determine change type from original event type (stored in raw._event_type)
      const origEventType: string = raw?._event_type || event.type;
      const changeTypes: string[] = [];
      const nd2bPayload: any = {
        ...base,
        companyId: company.id,
        role,
        identity: raw?.identity || 'natural',
        nameSurname: surname,
        nameOtherNames: otherNames,
        nameEnglish: engFull,
        nameChinese,
        idNumber,
        passportNumber: passportNumber,
        effectiveDate: today.split('/').reverse().join('-'),
        signerName: engFull,
        signDate: today.split('/').reverse().join('-'),
        presentorName: raw?.presentorName || DEFAULT_PRESENTER.name,
        presentorAddress: raw?.presentorAddress || DEFAULT_PRESENTER.address,
        presentorPhone: raw?.presentorPhone || DEFAULT_PRESENTER.phone,
        presentorFax: raw?.presentorFax || DEFAULT_PRESENTER.fax,
        presentorEmail: raw?.presentorEmail || DEFAULT_PRESENTER.email,
        presentorReference: raw?.presentorReference || DEFAULT_PRESENTER.reference,
      };
      // Map snake_case change values to ND2B new* fields
      if (origEventType === 'person_address_change') {
        changeTypes.push('address');
        if (raw?.addr_flat) nd2bPayload.newFlat = raw.addr_flat;
        if (raw?.addr_building) nd2bPayload.newBuilding = raw.addr_building;
        if (raw?.addr_street) nd2bPayload.newStreet = raw.addr_street;
        if (raw?.addr_district) nd2bPayload.newDistrict = raw.addr_district;
        if (raw?.addr_region) nd2bPayload.newRegion = raw.addr_region;
        if (raw?.address) nd2bPayload.newAddress = raw.address;
      } else if (origEventType === 'person_name_change') {
        changeTypes.push('name');
        const newEng = raw?.name_english || '';
        const { surname: ns, otherNames: no } = parseEnglishName(newEng);
        nd2bPayload.newNameSurname = ns;
        nd2bPayload.newNameOtherNames = no;
        if (raw?.name_chinese) nd2bPayload.newNameChinese = raw.name_chinese;
      } else if (origEventType === 'person_id_change') {
        changeTypes.push('id');
        if (raw?.id_number) nd2bPayload.newIdNumber = raw.id_number;
        if (raw?.passport_number) nd2bPayload.passportNumber = raw.passport_number;
      } else if (origEventType === 'person_contact_change') {
        changeTypes.push('contact');
        if (raw?.email) nd2bPayload.newEmail = raw.email;
      }
      nd2bPayload.changeTypes = changeTypes;
      return nd2bPayload;
    }
    case 'share_certificate': {
      // 日期留空：轉讓文件日期稍後再填（不自動填今天）
      const txDate = raw?.transaction_date || raw?.transactionDate || '';
      return {
        ...base,
        companyId: company.id,
        documentType: 'share_certificate',
        from_person_id: raw?.from_person_id || raw?.fromPersonId || '',
        from_name: raw?.from_name || raw?.fromName || '',
        to_person_id: raw?.to_person_id || raw?.toPersonId || '',
        to_name: raw?.to_name || raw?.toName || '',
        shares: raw?.shares || 0,
        share_type: raw?.share_type || raw?.shareType || 'Ordinary',
        price_per_share: raw?.price_per_share || raw?.pricePerShare || '',
        total_consideration: raw?.total_consideration || raw?.totalConsideration || '',
        transaction_date: txDate,
        instrument_number: raw?.instrument_number || raw?.instrumentNumber || '',
        currency: raw?.currency || 'HKD',
      };
    }
    default:
      return base;
  }
}

async function downloadRtf(base64: string, filename: string) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/rtf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function QuickFormDialog({ open, onOpenChange, company, events }: QuickFormDialogProps) {
  const [loading, setLoading] = useState<string | null>(null);

  if (!events.length) return null;
  const formOptions = getFormOptions(events);
  if (formOptions.length === 0) return null;

  const personnelEvents = events.filter(e => e.type === 'appoint' || e.type === 'cease');
  const resigners = personnelEvents.filter(e => e.type === 'cease');

  const handleGenerate = async (formKey: string) => {
    setLoading(formKey);
    try {
      const config = FORM_CONFIGS[formKey] || FORM_CONFIGS.nd2a_appoint;
      const safeName = safeFileName(company.name);

      // ── ND2A：同一天全部委任＋辭任人士 → 單一份表格（後端自動加頁） ──
      const generateNd2a = async (): Promise<number> => {
        const nd2aConfig = FORM_CONFIGS.nd2a_appoint;
        const officers = personnelEvents.map(e => buildNd2aOfficer(e));
        let result;
        try {
          result = await postJson(nd2aConfig.endpoint, buildNd2aPayload(company, officers));
        } catch (err: any) {
          throw new Error(`ND2A 生成失敗（${err.message}）`);
        }
        if (!result.pdf) throw new Error('No data in response');
        await downloadBase64Pdf(result.pdf, `${nd2aConfig.label.replace(/\s/g, '_')}_${safeName}.pdf`);
        return 1;
      };

      // ── ND4：辭任人本人遞交 — 每位辭任人各一份 ──
      const generateNd4 = async (): Promise<number> => {
        const nd4Config = FORM_CONFIGS.nd4_cease;
        let done = 0;
        for (let i = 0; i < resigners.length; i++) {
          const ev = resigners[i];
          const payload = buildFormPayload('nd4_cease', company, [ev]);
          let result;
          try {
            result = await postJson(nd4Config.endpoint, payload);
          } catch (err: any) {
            throw new Error(`ND4 第 ${done + 1} 份生成失敗（${err.message}），已下載 ${done} 份`);
          }
          if (!result.pdf) throw new Error('No data in response');
          const suffix = resigners.length > 1 ? `_第${done + 1}份` : '';
          await downloadBase64Pdf(result.pdf, `${nd4Config.label.replace(/\s/g, '_')}_${safeName}${suffix}.pdf`);
          done++;
          // 多份之间留间隔，避免连续请求复用同一 isolate 触发 1102
          if (i < resigners.length - 1) await new Promise(r => setTimeout(r, 2500));
        }
        return done;
      };

      // ── 一起生成：全部委任＋辭任 → 單一份 ND2A（官方表格一份可含多人委任＋停任，
      //    後端動態續頁；不再自動生成每人一份 ND4 — 用戶需要辭任人本人簽署的
      //    ND4 時可點下方 ND4 按鈕單獨生成）──
      if (formKey === 'both') {
        await generateNd2a();
        const nAppoint = personnelEvents.filter(e => e.type === 'appoint').length;
        const nCease = personnelEvents.filter(e => e.type === 'cease').length;
        toast({
          title: '✅ PDF 已生成',
          description: `ND2A 1 份（同日 ${nAppoint} 人委任 ＋ ${nCease} 人辭任，全部併入同一表格）下載完成`,
        });
        onOpenChange(false);
        return;
      }

      // ── 單獨 ND2A ──
      if (formKey === 'nd2a_appoint') {
        const n = await generateNd2a();
        toast({
          title: '✅ PDF 已生成',
          description: n > 1
            ? `ND2A 共 ${n} 份（同日 ${personnelEvents.length} 位人士）下載完成`
            : `ND2A（同日 ${personnelEvents.length} 位人士）下載完成`,
        });
        onOpenChange(false);
        return;
      }

      // ── 單獨 ND4 ──
      if (formKey === 'nd4_cease') {
        const n = await generateNd4();
        toast({
          title: '✅ PDF 已生成',
          description: n > 1 ? `ND4 共 ${n} 份（每位辭任人一份）下載完成` : 'ND4 下載完成',
        });
        onOpenChange(false);
        return;
      }

      // ── 其他表格（股份交易等）— 單事件 ──
      const payload = buildFormPayload(formKey, company, events);
      const result = await postJson(config.endpoint, payload);
      if (result.pdf) {
        const filename = `${config.label.replace(/\s/g, '_')}_${safeName}.pdf`;
        await downloadBase64Pdf(result.pdf, filename);
        toast({ title: '✅ PDF 已生成', description: `${config.label} 下載完成` });
        onOpenChange(false);
      } else if (result.rtf) {
        const filename = result.filename || `${config.label.replace(/\s/g, '_')}_${safeName}.rtf`;
        downloadRtf(result.rtf, filename);
        toast({ title: '✅ RTF 已生成', description: `${config.label} 下載完成` });
        onOpenChange(false);
      } else {
        throw new Error('No data in response');
      }
    } catch (err: any) {
      console.error('[QuickForm] Generation failed:', err);
      toast({ title: '❌ 生成失敗', description: err.message || '未知錯誤', variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  const eventTypeLabel = personnelEvents.length > 0
    ? (personnelEvents.some(e => e.type === 'appoint') && personnelEvents.some(e => e.type === 'cease')
      ? '委任＋辭任'
      : personnelEvents[0].type === 'appoint' ? '委任' : '辭任')
    : (events[0]?.type || '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            生成相關表格
          </DialogTitle>
          <DialogDescription>
            {personnelEvents.length > 1
              ? `同一天共有 ${personnelEvents.length} 位人士的委任／辭任記錄，可一併生成表格`
              : `基於公司誌事件「${events[0]?.title || ''}」自動生成對應的政府表格`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="text-sm text-muted-foreground">
            公司：<span className="font-medium text-foreground">{company.name}</span>
            {company.chineseName && <span className="text-foreground">（{company.chineseName}）</span>}
          </div>
          <div className="text-sm text-muted-foreground">
            事件類型：<Badge variant="secondary" className="ml-1">{eventTypeLabel}</Badge>
            {personnelEvents.length > 0 && (
              <span className="text-xs text-muted-foreground/70 ml-1">（同日 {personnelEvents.length} 人）</span>
            )}
          </div>

          {/* 同一天人士清單 */}
          {personnelEvents.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1 max-h-32 overflow-y-auto">
              {personnelEvents.map((e, i) => (
                <div key={i} className="text-xs flex items-center gap-2 min-w-0">
                  <Badge variant={e.type === 'appoint' ? 'default' : 'destructive'} className="h-4 px-1 text-[10px] shrink-0">
                    {e.type === 'appoint' ? '委任' : '辭任'}
                  </Badge>
                  <span className="truncate">{e.title}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 pt-2">
            <p className="text-sm font-medium">選擇要生成的表格：</p>
            {/* 一起生成：同日多位人士（委任＋辭任）→ 單一份 ND2A（一份表可含多人委任＋停任） */}
            {personnelEvents.length > 1 && (
              <Button
                variant="default"
                className="w-full"
                disabled={loading !== null}
                onClick={() => handleGenerate('both')}
              >
                {loading === 'both' ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <span className="mr-2">📦</span>
                )}
                一起生成：ND2A 1 份（含同日 {personnelEvents.length} 人：{personnelEvents.filter(e => e.type === 'appoint').length} 委任 ＋ {personnelEvents.filter(e => e.type === 'cease').length} 辭任）
              </Button>
            )}
            {formOptions.map(opt => {
              const isNd2a = opt.key === 'nd2a_appoint';
              const isNd4 = opt.key === 'nd4_cease';
              // 主按鈕已覆蓋多人的 ND2A 場景，outline 版只在單人時顯示
              if (isNd2a && personnelEvents.length > 1) return null;
              const label = isNd2a
                ? `${opt.config.label}（同日 ${personnelEvents.length} 人）`
                : isNd4 && resigners.length > 1
                  ? `${opt.config.label}（${resigners.length} 份，每位辭任人一份）`
                  : opt.config.label;
              return (
                <div key={opt.key} className="space-y-1">
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    disabled={loading !== null}
                    onClick={() => handleGenerate(opt.key)}
                  >
                    <span className="flex items-center gap-2">
                      <span>{opt.config.icon}</span>
                      <span>{label}</span>
                    </span>
                    {loading === opt.key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                  {/* ND2A 含辭任提示（辭任人停任區塊已併入 ND2A） */}
                  {isNd2a && resigners.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      💡 辭任人士已一併列入 ND2A 停任區塊（一份表可含多人委任＋停任）
                    </p>
                  )}
                  {/* ND4 提示：本人簽署遞交，按需逐人生成 */}
                  {isNd4 && (
                    <p className="text-xs text-muted-foreground">
                      💡 ND4 為辭任人本人遞交的通知書，每位辭任人一份，按需生成
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
