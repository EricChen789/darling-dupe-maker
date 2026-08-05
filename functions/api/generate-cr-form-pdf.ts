// POST /api/generate-cr-form-pdf
// Auto-fill CR form PDF from company data (production — Cloudflare Functions)
// body: { company_id, form_code }
// resp: { success: true, pdf: '<base64>', filename }
//
// Strategy: Try R2 AcroForm template first, fall back to from-scratch builder.

import { PDFDocument, rgb } from 'pdf-lib';
import {
  corsHeaders, jsonResp, uint8ToBase64, rget, fmtDate,
  drawMixed, segmentText, widthOfText, personLabel,
  fetchAndEmbedFont, buildAddress, DEFAULT_PRESENTER
} from './_pdf-utils';
import { enableNeedAppearances } from './_acroform';
import { verifyAuthRequest, type User, type Env } from './_auth';

// ─── Template mapping ───
const TEMPLATE_MAP: Record<string, string> = {
  nnc1: 'NNC1-template.pdf',
  nnc2: 'NNC2-template.pdf',
  nn1:  'NN1-template.pdf',
  nn3:  'NN3-template.pdf',
  nn6:  'NN6-template.pdf',
  nn7:  'NN7-template.pdf',
  nn9:  'NN9-template.pdf',
};

const CR_FORM_META: Record<string, { code: string; title: string; title_en: string }> = {
  nar1:  { code: 'NAR1',  title: '周年申報表',           title_en: 'Annual Return' },
  nd2a:  { code: 'ND2A',  title: '更改公司秘書及董事通知書（委任／停任）', title_en: 'Notice of Change of Company Secretary and Director (Appointment/Cessation)' },
  nd2b:  { code: 'ND2B',  title: '更改公司秘書及董事詳情通知書',       title_en: 'Notice of Change in Particulars of Company Secretary and Director' },
  nd4:   { code: 'ND4',   title: '公司秘書及董事辭任通知書',           title_en: 'Notice of Resignation of Company Secretary and Director' },
  ndr1:  { code: 'NDR1',  title: '撤銷註冊申請書',                    title_en: 'Application for Deregistration' },
  nr1:   { code: 'NR1',   title: '註冊辦事處地址變更通知書',           title_en: 'Notice of Change of Registered Office Address' },
  nsc1:  { code: 'NSC1',  title: '股份配發申報書',                    title_en: 'Return of Allotment' },
  nnc1:  { code: 'NNC1',  title: '法團成立表格（股份有限公司）',        title_en: 'Incorporation Form (Company Limited by Shares)' },
  nnc2:  { code: 'NNC2',  title: '更改公司名稱通知書',                 title_en: 'Notice of Change of Company Name' },
  nn1:   { code: 'NN1',   title: '註冊非香港公司註冊申請書',            title_en: 'Application for Registration as Registered Non-Hong Kong Company' },
  nn3:   { code: 'NN3',   title: '註冊非香港公司周年申報表',            title_en: 'Annual Return of Registered Non-Hong Kong Company' },
  nn6:   { code: 'NN6',   title: '非香港公司更改秘書及董事（委任／停任）', title_en: 'Change of Company Secretary and Director of Non-Hong Kong Company' },
  nn7:   { code: 'NN7',   title: '非香港公司更改秘書及董事詳情',         title_en: 'Change in Particulars of Company Secretary and Director of Non-Hong Kong Company' },
  nn9:   { code: 'NN9',   title: '非香港公司更改地址申報表',            title_en: 'Notice of Change of Address of Non-Hong Kong Company' },
};

// ─── D1 query ───
async function fetchCompanyBundle(db: D1Database, companyId: string) {
  const row = await db.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first();
  if (!row) return null;

  const { results: members } = await db.prepare(
    `SELECT pcr.role, pcr.shares, pcr.share_type, pcr.currency, pcr.paid_up,
            pcr.date_appointed, pcr.date_ceased, pcr.is_reserve,
            p.name_english, p.name_chinese, p.id_number, p.passport_number,
            p.address, p.service_address, p.email, p.phone, p.identity, p.tcsp_number,
            p.addr_flat, p.addr_building, p.addr_street, p.addr_district, p.addr_region
     FROM person_company_roles pcr JOIN persons p ON p.id = pcr.person_id
     WHERE pcr.company_id = ? AND (pcr.date_ceased IS NULL OR pcr.date_ceased = '')
     ORDER BY pcr.role, p.name_english`
  ).bind(companyId).all();

  const directors = members.filter((m: any) => m.role === 'director');
  const secretaries = members.filter((m: any) => m.role === 'secretary');
  const shareholders = members.filter((m: any) => m.role === 'shareholder');
  const totalShares = shareholders.reduce((sum: number, m: any) => sum + (Number(m.shares) || 0), 0);

  const c = row as any;
  const address = buildAddress(c);

  return { c, address, directors, secretaries, shareholders, totalShares };
}

// ─── Helpers ───
function parseEnglishName(en: string): { surname: string; otherNames: string } {
  const parts = (en || '').trim().split(/\s+/);
  return { surname: parts[0] || '', otherNames: parts.slice(1).join(' ') };
}

function parseAddress5(addr: string): string[] {
  // Split address into up to 5 parts for CR 5-field address layout
  const parts = (addr || '').split(',').map(s => s.trim()).filter(Boolean);
  while (parts.length < 5) parts.push('');
  return parts.slice(0, 5);
}

function br8(c: any): string {
  return (c.company_number || c.brNumber || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
}

// ─── Template-based filling ───

/** Try to generate PDF using R2 AcroForm template. Returns null if template not found. */
async function tryBuildFromTemplate(
  formCode: string, bundle: any, env: Env
): Promise<Uint8Array | null> {
  const templateName = TEMPLATE_MAP[formCode];
  if (!templateName) return null;

  const r2Bucket = (env as any).PDF_TEMPLATES || (env as any).R2;
  if (!r2Bucket) return null;

  const templateObj = await r2Bucket.get(templateName);
  if (!templateObj) return null; // Template not in R2 — fall back to from-scratch

  const templateBytes = new Uint8Array(await templateObj.arrayBuffer());
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  // Fill template fields based on form type
  switch (formCode) {
    case 'nnc1': fillNNC1Template(form, bundle); break;
    case 'nnc2': fillNNC2Template(form, bundle); break;
    case 'nn1':  fillNN1Template(form, bundle); break;
    case 'nn7':  fillNN7Template(form, bundle); break;
    case 'nn9':  fillNN9Template(form, bundle); break;
    case 'nn3':  fillNN3Template(form, bundle); break;
    case 'nn6':  fillNN6Template(form, bundle); break;
    default: return null; // No template filler for this form
  }

  enableNeedAppearances(pdfDoc);
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return new Uint8Array(pdfBytes);
}

// ─── Per-form template fillers ───

function setF(form: any, name: string, value: string | null | undefined) {
  if (!value) return;
  try {
    const tf = form.getTextField(name);
    tf.setText(String(value));
  } catch { /* field not in template */ }
}

function checkF(form: any, name: string, cond?: boolean) {
  if (cond === false) return;
  try { form.getCheckBox(name).check(); } catch { /* skip */ }
}

function fillNNC1Template(form: any, bundle: any) {
  const c = bundle.c;
  const br = br8(c);

  // ── P.1: Company Name ──
  setF(form, 'fill_1_P.1', c.name || c.name_english);
  setF(form, 'fill_2_P.1', c.chinese_name || c.name_chinese);

  // Company type checkbox
  const ct = (c.company_type || '').toLowerCase();
  checkF(form, 'cb_1_P.1', ct.includes('私人') || ct.includes('private'));
  checkF(form, 'cb_2_P.1', ct.includes('公眾') || ct.includes('public'));

  // Business nature
  setF(form, 'fill_3_P.1', c.business_code);
  setF(form, 'fill_4_P.1', c.business_nature);

  // Registered address (fill_5-8)
  setF(form, 'fill_5_P.1', c.reg_flat);
  setF(form, 'fill_6_P.1', c.reg_building);
  setF(form, 'fill_7_P.1', c.reg_street);
  setF(form, 'fill_8_P.1', c.reg_district);

  // Presenter (fill_9-15) — use default Twinsail
  setF(form, 'fill_9_P.1', DEFAULT_PRESENTER.name);
  setF(form, 'fill_10_P.1', DEFAULT_PRESENTER.name);
  setF(form, 'fill_11_P.1', DEFAULT_PRESENTER.address);
  setF(form, 'fill_12_P.1', DEFAULT_PRESENTER.contact);
  setF(form, 'fill_13_P.1', DEFAULT_PRESENTER.contact);
  setF(form, 'fill_14_P.1', DEFAULT_PRESENTER.contact);
  setF(form, 'fill_15_P.1', '');

  // ── P.2: Contact + Share Capital ──
  setF(form, 'fill_1_P.2', c.email);
  setF(form, 'fill_2_P.2', c.phone);

  // Share capital from shareholders
  const shareholders = bundle.shareholders;
  if (shareholders.length > 0) {
    const sh0 = shareholders[0];
    setF(form, 'fill_3_P.2', sh0.share_type || 'Ordinary');
    setF(form, 'fill_4_P.2', String(sh0.shares || ''));
    setF(form, 'fill_5_P.2', sh0.currency || 'HKD');
    setF(form, 'fill_6_P.2', sh0.paid_up || '');
    setF(form, 'fill_7_P.2', sh0.paid_up || '');
    setF(form, 'fill_8_P.2', '');
    if (shareholders.length > 1) {
      const sh1 = shareholders[1];
      setF(form, 'fill_9_P.2', sh1.share_type || 'Ordinary');
      setF(form, 'fill_10_P.2', String(sh1.shares || ''));
      setF(form, 'fill_11_P.2', sh1.currency || 'HKD');
      setF(form, 'fill_12_P.2', sh1.paid_up || '');
      setF(form, 'fill_13_P.2', sh1.paid_up || '');
      setF(form, 'fill_14_P.2', '');
    }
    // Totals
    setF(form, 'fill_16_P.2', shareholders[0].currency || 'HKD');
    setF(form, 'fill_17_P.2', String(bundle.totalShares));
  }

  // ── P.3: Founder Member (first shareholder) ──
  if (shareholders.length > 0) {
    const sh = shareholders[0];
    setF(form, 'fill_1_P.3', sh.name_chinese);
    const en = parseEnglishName(sh.name_english);
    setF(form, 'fill_2_P.3', en.surname);
    setF(form, 'fill_3_P.3', en.otherNames);
    // Address (5-field: fill_5-9)
    const personAddr = sh.addr_flat || sh.service_address || sh.address || '';
    const addr = parseAddress5(personAddr);
    setF(form, 'fill_5_P.3', addr[0]);  // flat
    setF(form, 'fill_6_P.3', addr[1]);  // building
    setF(form, 'fill_7_P.3', addr[2]);  // street
    setF(form, 'fill_8_P.3', addr[3]);  // district
    setF(form, 'fill_9_P.3', addr[4]);  // region/country
    // Shares
    setF(form, 'fill_10_P.3', sh.share_type || 'Ordinary');
    setF(form, 'fill_11_P.3', String(sh.shares || ''));
    setF(form, 'fill_12_P.3', sh.currency || 'HKD');
    setF(form, 'fill_13_P.3', sh.paid_up || '');
    // Total shares
    setF(form, 'fill_18_P.3', String(bundle.totalShares));
  }

  // ── P.4: Secretary (natural person) ──
  const secNat = bundle.secretaries.find((s: any) => (s.identity || 'natural') !== 'corporate');
  if (secNat) {
    setF(form, 'fill_1_P.4', secNat.name_chinese);
    const en = parseEnglishName(secNat.name_english);
    setF(form, 'fill_2_P.4', en.surname);
    setF(form, 'fill_3_P.4', en.otherNames);
    const addr = parseAddress5(secNat.service_address || secNat.address || '');
    setF(form, 'fill_8_P.4', addr[0]);
    setF(form, 'fill_9_P.4', addr[1]);
    setF(form, 'fill_10_P.4', addr[2]);
    setF(form, 'fill_11_P.4', addr[3]);
    setF(form, 'fill_12_P.4', secNat.email);
    setF(form, 'fill_13_P.4', (secNat.id_number || '').slice(0, 4));
    // TCSP licence
    const tcspNat = secNat.tcsp_number || '';
    setF(form, 'fill_16_P.4', tcspNat);
    // TCSP checkbox — only check "not required" if no licence
    if (!tcspNat) {
      checkF(form, 'cb_1_P.4', true);  // 無須領有 TCSP 牌照
    }
  }

  // ── P.5: Secretary (body corporate) ──
  const secCorp = bundle.secretaries.find((s: any) => s.identity === 'corporate');
  if (secCorp) {
    setF(form, 'fill_1_P.5', secCorp.name_chinese);
    setF(form, 'fill_2_P.5', secCorp.name_english);
    const addr = parseAddress5(secCorp.service_address || secCorp.address || '');
    setF(form, 'fill_3_P.5', addr[0]);
    setF(form, 'fill_4_P.5', addr[1]);
    setF(form, 'fill_5_P.5', addr[2]);
    setF(form, 'fill_6_P.5', addr[3]);
    setF(form, 'fill_7_P.5', secCorp.email);
    setF(form, 'fill_8_P.5', secCorp.company_number_ref || secCorp.id_number || '');  // BR 號碼
    const tcspCorp = secCorp.tcsp_number || '';
    setF(form, 'fill_9_P.5', tcspCorp);  // TCSP 牌照號碼
    // TCSP checkbox — only check "not required" if no licence
    if (!tcspCorp) {
      checkF(form, 'cb_1_P.5', true);  // 無須領有 TCSP 牌照
    }
  }

  // ── P.6: Director (natural person) ──
  const dirNat = bundle.directors.find((d: any) => (d.identity || 'natural') !== 'corporate');
  if (dirNat) {
    setF(form, 'fill_1_P.6', dirNat.name_chinese);
    const en = parseEnglishName(dirNat.name_english);
    setF(form, 'fill_2_P.6', en.surname);
    setF(form, 'fill_3_P.6', en.otherNames);
    const addr = parseAddress5(dirNat.service_address || dirNat.address || '');
    setF(form, 'fill_8_P.6', addr[0]);
    setF(form, 'fill_9_P.6', addr[1]);
    setF(form, 'fill_10_P.6', addr[2]);
    setF(form, 'fill_11_P.6', addr[3]);
    setF(form, 'fill_12_P.6', addr[4]);
    setF(form, 'fill_13_P.6', dirNat.email);
    setF(form, 'fill_14_P.6', (dirNat.id_number || '').slice(0, 4));
    checkF(form, 'cb_1_P.6', true);
  }

  // ── P.7: Director (body corporate) ──
  const dirCorp = bundle.directors.find((d: any) => d.identity === 'corporate');
  if (dirCorp) {
    setF(form, 'fill_1_P.7', dirCorp.name_chinese);
    setF(form, 'fill_2_P.7', dirCorp.name_english);
    const addr = parseAddress5(dirCorp.service_address || dirCorp.address || '');
    setF(form, 'fill_3_P.7', addr[0]);
    setF(form, 'fill_4_P.7', addr[1]);
    setF(form, 'fill_5_P.7', addr[2]);
    setF(form, 'fill_6_P.7', addr[3]);
    setF(form, 'fill_7_P.7', addr[4]);
    setF(form, 'fill_8_P.7', dirCorp.email);
    setF(form, 'fill_9_P.7', dirCorp.id_number);
    checkF(form, 'cb_1_P.7', true);
    // Signer for body corporate director
    const sh0 = bundle.shareholders[0];
    if (sh0) {
      setF(form, 'fill_10_P.7', [sh0.name_english, sh0.name_chinese].filter(Boolean).join(' '));
    }
  }

  // ── P.8: Founder member statement ──
  // Page counts for continuation sheets
  const secNatCount = bundle.secretaries.filter((s: any) => (s.identity || 'natural') !== 'corporate').length;
  const secCorpCount = bundle.secretaries.filter((s: any) => s.identity === 'corporate').length;
  const dirNatCount = bundle.directors.filter((d: any) => (d.identity || 'natural') !== 'corporate').length;
  const dirCorpCount = bundle.directors.filter((d: any) => d.identity === 'corporate').length;

  setF(form, 'fill_1_P.8', secNatCount > 1 ? String(secNatCount - 1) : '');
  setF(form, 'fill_2_P.8', secCorpCount > 1 ? String(secCorpCount - 1) : '');
  setF(form, 'fill_3_P.8', dirNatCount > 1 ? String(dirNatCount - 1) : '');
  setF(form, 'fill_4_P.8', dirCorpCount > 1 ? String(dirCorpCount - 1) : '');
  setF(form, 'fill_5_P.8', '');

  // PI-NNC1 page count = ALL natural persons (not just first)
  const piCount = secNatCount + dirNatCount;
  setF(form, 'fill_6_P.8', piCount > 0 ? String(piCount) : '');

  // ── PI-NNC1 (P.14): 首任公司秘書／董事(自然人) 受保護資料 ──
  // ⚠️ 每頁只填報一名自然人！cb_1/cb_2=身份（秘書/董事），非HKID/護照
  // 字段順序：fill_2-4=姓名 → fill_5-6=HKID → fill_7-8=護照 → fill_9-13=住址5欄
  const piNat = secNat || dirNat;
  if (piNat) {
    const piIsSec = !!secNat;
    const piEn = parseEnglishName(piNat.name_english || '');
    const piAddr = parseAddress5(piNat.addr_flat
      ? [piNat.addr_flat, piNat.addr_building, piNat.addr_street, piNat.addr_district, piNat.addr_region].filter(Boolean).join(', ')
      : (piNat.service_address || piNat.address || ''));
    const piId = (piNat.id_number || '').trim();
    const piHkidMatch = piId.match(/^([A-Z]?\d+)\s*\(?(\d)\)?$/);
    const piMainId = piHkidMatch ? piHkidMatch[1] : piId;
    const piCheckDigit = piHkidMatch ? piHkidMatch[2] : '';
    const piIsHkid = /^[A-Z]?\d/.test(piId);

    setF(form, 'fill_1_P.14', c.name || c.name_english);
    // 姓名 (fill_2-4)
    setF(form, 'fill_2_P.14', piNat.name_chinese || '');
    setF(form, 'fill_3_P.14', piEn.surname);
    setF(form, 'fill_4_P.14', piEn.otherNames);
    // HKID (fill_5-6) — only if HKID
    setF(form, 'fill_5_P.14', piIsHkid ? piMainId : '');
    setF(form, 'fill_6_P.14', piIsHkid ? piCheckDigit : '');
    // 護照 (fill_7-8) — only if passport
    setF(form, 'fill_7_P.14', !piIsHkid && piId ? (piNat.passport_country || '') : '');
    setF(form, 'fill_8_P.14', !piIsHkid && piId ? piId : '');
    // 住址 (fill_9-13) — 5欄
    setF(form, 'fill_9_P.14', piAddr[0]);   // 室/樓/座
    setF(form, 'fill_10_P.14', piAddr[1]);  // 大廈
    setF(form, 'fill_11_P.14', piAddr[2]);  // 街道/屋苑/地段/村
    setF(form, 'fill_12_P.14', piAddr[3]);  // 區/市/省/州/郵遞區號
    setF(form, 'fill_13_P.14', piAddr[4]);  // 國家/地區

    // 身份 checkbox: cb_1=公司秘書, cb_2=董事
    checkF(form, 'cb_1_P.14', piIsSec);
    checkF(form, 'cb_2_P.14', !piIsSec);
  }

  // Signer (first shareholder/founder)
  const sh0 = bundle.shareholders[0];
  if (sh0) {
    const signerName = parseEnglishName(sh0.name_english);
    setF(form, 'fill_7_P.8', [signerName.surname, signerName.otherNames].filter(Boolean).join(' '));
  }
  // Sign date defaults to today
  const today = new Date();
  setF(form, 'fill_8_P.8', `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`);

  // ── BR on P.1 ──
  setF(form, 'br_P.1', br);
  setF(form, 'fill_br_P.1', br);
}

function fillNNC2Template(form: any, bundle: any) {
  const c = bundle.c;
  const br = br8(c);

  setF(form, 'fill_1_P.1', br);
  setF(form, 'fill_2_P.1', c.name || c.name_english);
  setF(form, 'fill_3_P.1', c.chinese_name || c.name_chinese);

  // Presenter
  setF(form, 'fill_9_P.1', DEFAULT_PRESENTER.name);
  setF(form, 'fill_10_P.1', DEFAULT_PRESENTER.address);
  setF(form, 'fill_11_P.1', DEFAULT_PRESENTER.contact);

  // BR on all pages
  for (let i = 1; i <= 8; i++) {
    setF(form, `br_P.${i}`, br);
  }
}

function fillNN1Template(form: any, bundle: any) {
  const c = bundle.c;
  const br = br8(c);

  // P.1: Company info
  setF(form, 'fill_1_P.1', br);
  setF(form, 'fill_2_P.1', c.name || c.name_english);
  setF(form, 'fill_3_P.1', c.chinese_name || c.name_chinese);
  setF(form, 'fill_4_P.1', c.place_of_incorporation || '');

  // Registered address
  setF(form, 'fill_5_P.1', c.reg_flat);
  setF(form, 'fill_6_P.1', c.reg_building);
  setF(form, 'fill_7_P.1', c.reg_street);
  setF(form, 'fill_8_P.1', c.reg_district);
  setF(form, 'fill_9_P.1', c.reg_region || '');

  // Presenter
  setF(form, 'fill_13_P.1', DEFAULT_PRESENTER.name);
  setF(form, 'fill_14_P.1', DEFAULT_PRESENTER.address);
  setF(form, 'fill_15_P.1', DEFAULT_PRESENTER.contact);

  // Directors
  const dirNat = bundle.directors.find((d: any) => (d.identity || 'natural') !== 'corporate');
  if (dirNat) {
    setF(form, 'fill_1_P.3', dirNat.name_english || '');
    setF(form, 'fill_2_P.3', dirNat.name_chinese || '');
    setF(form, 'fill_5_P.3', dirNat.service_address || dirNat.address || '');
    setF(form, 'fill_6_P.3', dirNat.id_number || '');
  }

  // Secretary
  const secNat = bundle.secretaries.find((s: any) => (s.identity || 'natural') !== 'corporate');
  if (secNat) {
    setF(form, 'fill_1_P.4', secNat.name_english || '');
    setF(form, 'fill_2_P.4', secNat.name_chinese || '');
    setF(form, 'fill_5_P.4', secNat.service_address || secNat.address || '');
  }
}

function fillNN7Template(form: any, bundle: any) {
  const c = bundle.c;
  const br = br8(c);

  setF(form, 'fill_1_P.1', br);
  setF(form, 'fill_2_P.1', c.name || c.name_english);

  // First director for change of particulars
  const dir = bundle.directors[0];
  if (dir) {
    setF(form, 'fill_3_P.1', dir.name_english || '');
    setF(form, 'fill_4_P.1', dir.name_chinese || '');
    setF(form, 'fill_5_P.1', dir.id_number || '');
  }

  // Presenter
  setF(form, 'fill_12_P.1', DEFAULT_PRESENTER.name);
  setF(form, 'fill_13_P.1', DEFAULT_PRESENTER.contact);
  setF(form, 'fill_14_P.1', DEFAULT_PRESENTER.address);
}

function fillNN9Template(form: any, bundle: any) {
  const c = bundle.c;
  const br = br8(c);

  setF(form, 'fill_1_P.1', br);
  setF(form, 'fill_2_P.1', c.name || c.name_english);
  setF(form, 'fill_3_P.1', c.chinese_name || c.name_chinese);

  // Current address
  setF(form, 'fill_5_P.1', c.reg_flat);
  setF(form, 'fill_6_P.1', c.reg_building);
  setF(form, 'fill_7_P.1', c.reg_street);
  setF(form, 'fill_8_P.1', c.reg_district);
  setF(form, 'fill_9_P.1', c.reg_region || '');

  // Presenter
  setF(form, 'fill_13_P.1', DEFAULT_PRESENTER.name);
  setF(form, 'fill_14_P.1', DEFAULT_PRESENTER.address);
  setF(form, 'fill_15_P.1', DEFAULT_PRESENTER.contact);
}

function fillNN3Template(form: any, bundle: any) {
  const c = bundle.c;
  const br = br8(c);

  setF(form, 'fill_1_P.1', br);
  setF(form, 'fill_2_P.1', c.name || c.name_english);
  setF(form, 'fill_3_P.1', c.chinese_name || c.name_chinese);
  setF(form, 'fill_4_P.1', c.place_of_incorporation || '');

  // Registered address
  setF(form, 'fill_5_P.1', c.reg_flat);
  setF(form, 'fill_6_P.1', c.reg_building);
  setF(form, 'fill_7_P.1', c.reg_street);
  setF(form, 'fill_8_P.1', c.reg_district);
  setF(form, 'fill_9_P.1', c.reg_region || '');

  // Presenter
  setF(form, 'fill_13_P.1', DEFAULT_PRESENTER.name);
  setF(form, 'fill_14_P.1', DEFAULT_PRESENTER.address);
  setF(form, 'fill_15_P.1', DEFAULT_PRESENTER.contact);
}

function fillNN6Template(form: any, bundle: any) {
  const c = bundle.c;
  const br = br8(c);

  setF(form, 'fill_1_P.1', br);
  setF(form, 'fill_2_P.1', c.name || c.name_english);

  // First director for appointment/cessation
  const dir = bundle.directors[0];
  if (dir) {
    const isNatural = (dir.identity || 'natural') !== 'corporate';
    if (isNatural) {
      setF(form, 'fill_3_P.2', dir.name_english || '');
      setF(form, 'fill_4_P.2', dir.name_chinese || '');
      setF(form, 'fill_7_P.2', dir.id_number || '');
      setF(form, 'fill_8_P.2', dir.service_address || dir.address || '');
    } else {
      setF(form, 'fill_3_P.3', dir.name_chinese || '');
      setF(form, 'fill_4_P.3', dir.name_english || '');
      setF(form, 'fill_11_P.3', dir.id_number || '');
    }
    checkF(form, 'cb_2_P.2', true); // director role
    checkF(form, 'cb_3_P.2', true); // appointment type
  }

  // Presenter
  setF(form, 'fill_13_P.1', DEFAULT_PRESENTER.name);
  setF(form, 'fill_14_P.1', DEFAULT_PRESENTER.contact);
  setF(form, 'fill_15_P.1', DEFAULT_PRESENTER.address);
}

// ─── From-scratch builder (fallback) ───
async function buildPdf(
  bundle: any,
  meta: { code: string; title: string; title_en: string },
  formCode: string,
  env: Env
) {
  const doc = await PDFDocument.create();
  const { cjk, ascii, cjkMissing } = await fetchAndEmbedFont(doc, env as any);

  const MARGIN = 50;
  const PAGE_W = 595, PAGE_H = 842; // A4
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = 800;
  const lineH = 14;

  const drawLine = (text: string, size = 10, bold = false, color?: any) => {
    if (y < 60) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = 800;
    }
    drawMixed(page, text, {
      x: MARGIN, y, size,
      cjk: bold ? cjk : (cjkMissing ? ascii : cjk),
      ascii,
      color,
    });
    y -= lineH;
  };

  const drawTitle = (text: string, size = 14, color?: any) => {
    const w = widthOfText(text, cjk, ascii, size);
    const x = (PAGE_W - w) / 2;
    drawMixed(page, text, { x, y, size, cjk, ascii, color });
    y -= lineH + 4;
  };

  const c = bundle.c;
  const nameEn = rget(c, 'name');
  const nameCn = rget(c, 'chinese_name');
  const br = rget(c, 'company_number');
  const cr = rget(c, 'ci_number');

  const BLUE = rgb(0, 0.2, 0.6);

  drawTitle(`${meta.title}  ${meta.code}`, 16, BLUE);
  drawTitle(meta.title_en, 10, BLUE);
  y -= 4;
  drawLine(`公司註冊處表格 ${meta.code} · 由系統自動填入生成草稿`, 8);
  y -= 6;

  // Company info
  drawLine('公司基本資料', 11, true);
  const info: [string, string][] = [
    ['英文名稱', nameEn], ['中文名稱', nameCn],
    ['商業登記號碼 (BR)', br], ['公司註冊編號 (CR)', cr],
    ['公司類型', rget(c, 'company_type')], ['成立日期', fmtDate(rget(c, 'incorporation_date'))],
    ['狀態', rget(c, 'status')], ['註冊辦事處地址', bundle.address],
    ['電郵', rget(c, 'email')], ['電話', rget(c, 'phone')],
  ];
  for (const [label, val] of info) {
    if (val) drawLine(`${label}：${val}`, 9);
  }
  y -= 4;

  // Directors & Secretaries
  const hasOfficers = ['nar1','nd2a','nd2b','nd4','nnc1','nn1','nn3','nn6','nn7'].includes(formCode);
  if (hasOfficers) {
    drawLine(`董事（${bundle.directors.length} 人）`, 10, true);
    for (const d of bundle.directors) {
      const parts = [personLabel(d), rget(d, 'id_number') || rget(d, 'passport_number') || '', `委任: ${fmtDate(rget(d, 'date_appointed'))}`];
      drawLine(`  ${parts.filter(Boolean).join('  |  ')}`, 8);
    }
    if (!bundle.directors.length) drawLine('  （無董事記錄）', 8);
    y -= 2;

    drawLine(`公司秘書（${bundle.secretaries.length} 人）`, 10, true);
    for (const s of bundle.secretaries) {
      const parts = [personLabel(s), `TCSP: ${rget(s, 'tcsp_number')}`, `委任: ${fmtDate(rget(s, 'date_appointed'))}`];
      drawLine(`  ${parts.filter(Boolean).join('  |  ')}`, 8);
    }
    if (!bundle.secretaries.length) drawLine('  （無秘書記錄）', 8);
    y -= 4;
  }

  // Shareholders
  const hasShares = ['nar1','nsc1','nnc1','nn1','nn3'].includes(formCode);
  if (hasShares) {
    drawLine(`股東／股本結構（總發行股數：${bundle.totalShares}）`, 10, true);
    for (const sh of bundle.shareholders) {
      const pct = bundle.totalShares ? `${(Number(sh.shares || 0) * 100 / bundle.totalShares).toFixed(2)}%` : '—';
      drawLine(`  ${personLabel(sh)}  |  ${sh.shares || 0} 股  |  ${sh.share_type || '普通股'}  |  ${pct}`, 8);
    }
    if (!bundle.shareholders.length) drawLine('  （無股東記錄）', 8);
    y -= 4;
  }

  // Form-specific
  if (formCode === 'nar1') {
    drawLine('重要控制人登記冊 (SCR) 是否備存於公司註冊辦事處？  是 □  否 □', 9);
  }
  if (['nr1','ndr1','nn9'].includes(formCode)) {
    drawLine(`現有註冊地址：${bundle.address || '（未填）'}`, 9);
    drawLine('變更後註冊地址（請手動填寫）：＿＿＿＿＿＿＿＿＿＿＿＿', 9);
  }
  if (formCode === 'nsc1') {
    for (const line of ['配發日期：＿＿＿＿', '配發股份類別：＿＿＿＿', '每股發行價：＿＿＿＿', '配發總額：＿＿＿＿']) {
      drawLine(line, 9);
    }
  }

  // Signature block
  y -= 10;
  if (y < 120) { page = doc.addPage([PAGE_W, PAGE_H]); y = 800; }
  drawLine('簽署 / SIGNED:', 10, true);
  y -= 8;
  drawLine('_______________________________', 10);
  drawLine('董事 / Director       日期 Date：＿＿＿＿', 9);
  y -= 4;
  drawLine('_______________________________', 10);
  drawLine('公司秘書 / Company Secretary       日期 Date：＿＿＿＿', 9);

  // Footer
  y -= 10;
  if (y < 50) { page = doc.addPage([PAGE_W, PAGE_H]); y = 800; }
  const today = new Date().toISOString().slice(0, 10);
  drawLine(`本文件由公司秘書管理系統自動生成 · ${today}`, 7);

  const pdfBytes = await doc.save();
  return new Uint8Array(pdfBytes);
}

// ─── Route handler ───
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  // Auth
  const { user, errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const body: any = await request.json().catch(() => ({}));
    const companyId = body.company_id || body.companyId;
    const formCode = (body.form_code || body.formType || '').toLowerCase();
    if (!companyId || !formCode) return jsonResp({ error: '缺少 company_id 或 form_code' }, 400);

    const meta = CR_FORM_META[formCode];
    if (!meta) return jsonResp({ error: `不支援的表格代碼：${formCode}` }, 400);

    const bundle = await fetchCompanyBundle(env.DB as unknown as D1Database, companyId);
    if (!bundle) return jsonResp({ error: '找不到該公司' }, 404);

    // Try template-based generation first, fall back to from-scratch
    let pdfBytes: Uint8Array;
    const templateResult = await tryBuildFromTemplate(formCode, bundle, env);
    if (templateResult) {
      pdfBytes = templateResult;
    } else {
      // Fall back to from-scratch builder
      pdfBytes = await buildPdf(bundle, meta, formCode, env);
    }

    const base64 = uint8ToBase64(pdfBytes);

    const safeName = (bundle.c.name || bundle.c.chinese_name || 'company')
      .replace(/[^\w一-鿿-]/g, '_').slice(0, 30);
    const filename = `${meta.code}_${meta.title}_${safeName}.pdf`;

    return jsonResp({ success: true, pdf: base64, filename });
  } catch (e: any) {
    return jsonResp({ error: e.message || 'Internal error' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
