// 文件生成表單 → 資料庫寫回共用模組
// 生成 PDF 成功後，把表單內容同步到 persons / person_company_roles / companies / change_events。
// 純 async 函數（house pattern：與 useCompanies 內部的 findOrCreatePerson / applyShareChange 一致）。
// 冪等設計：upsertRole 活躍行守衛（重複生成不重複建角色行）、ensureCompany 精確匹配（不重複建公司行）；
// change_events 允許重複（日誌語義）。

import { supabase } from '@/integrations/supabase/client';
import { findOrCreatePerson } from '@/hooks/useCompanies';
import { resolvePersonId } from '@/hooks/useShareTransactions';
import { recordChangeEvent, EVENT_FORM_MAP } from './changeEvents';

// ══════════════════════════════ 日期工具 ══════════════════════════════

const pad2 = (n: string | number) => String(n).padStart(2, '0');

/** ISO (YYYY-MM-DD) → DD/MM/YYYY；非 ISO 輸入回空字串 */
export function isoToDDMMYYYY(iso?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** 日/月/年分欄 → DD/MM/YYYY；任一欄為空回空字串 */
export function dmyToDDMMYYYY(d?: string | number, m?: string | number, y?: string | number): string {
  if (!d || !m || !y) return '';
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

/** 今天 DD/MM/YYYY（en-GB，與 change_events.change_date 慣例一致） */
export function todayDDMMYYYY(): string {
  return new Date().toLocaleDateString('en-GB');
}

// ══════════════════════════════ 公司解析 ══════════════════════════════

/** selectedCompanyId 優先；否則按商業登記號碼（companies.company_number）匹配 */
export async function resolveCompanyId(brNumber: string, selectedCompanyId?: string): Promise<string | null> {
  if (selectedCompanyId) return selectedCompanyId;
  const br = String(brNumber || '').trim();
  if (!br) return null;
  try {
    const { data } = await supabase.from('companies').select('id').eq('company_number', br).limit(1);
    return (data as any[])?.length ? (data as any[])[0].id : null;
  } catch (e: any) {
    console.warn('[formWriteback] resolveCompanyId failed:', e?.message || e);
    return null;
  }
}

// ══════════════════════════════ 人員 upsert ══════════════════════════════

/** 完整香港身份證格式（部分號碼不參與去重，防誤串庫） */
export const HKID_FULL_RE = /^[A-Z]{1,2}\d{6,7}\(\d\)$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 錯誤 → 可讀字串（後端 throw 的物件只有 status/error，String(e) 會變 '[object Object]'） */
export function errText(e: any): string {
  if (!e) return '未知錯誤';
  if (typeof e === 'string') return e;
  return e.message || e.error || e.error_description || JSON.stringify(e);
}

/** 由證件號碼／姓名重新解析 persons.id（真 UUID）。findOrCreatePerson 新建路徑可能回 D1 rowid，這裡兜底。 */
async function resolveRealPersonId(nameEnglish: string, fullHkid: string): Promise<string | null> {
  try {
    if (fullHkid) {
      const byId = await supabase.from('persons').select('id').eq('id_number', fullHkid).limit(1);
      if ((byId.data as any[])?.length) return (byId.data as any[])[0].id;
    }
    const n = String(nameEnglish || '').trim();
    if (n) {
      const exact = await supabase.from('persons').select('id').eq('name_english', n).limit(5);
      if ((exact.data as any[])?.length) return (exact.data as any[])[0].id;
      const fuzzy = await supabase.from('persons').select('id').eq('name_english__like', `%${n}%`).limit(5);
      if ((fuzzy.data as any[])?.length) return (fuzzy.data as any[])[0].id;
    }
  } catch (e: any) {
    console.warn('[formWriteback] resolveRealPersonId failed:', e?.message || e);
  }
  return null;
}

export interface PersonFormInput {
  identity?: 'natural' | 'corporate';
  nameEnglish?: string;
  nameChinese?: string;
  idNumber?: string;
  address?: string;
  email?: string;
  passportCountry?: string;
  passportNumber?: string;
  placeIncorporated?: string;
  companyNumberRef?: string;
  addr_flat?: string;
  addr_building?: string;
  addr_street?: string;
  addr_district?: string;
  addr_region?: string;
  previousNameEnglish?: string;
  previousNameChinese?: string;
  aliasEnglish?: string;
  aliasChinese?: string;
  dateOfBirth?: string;
  tcspNumber?: string;
}

/**
 * 找人或建檔（含非空字段補丁），返回 persons.id。
 * 守衛：idNumber 僅當完整 HKID 格式 /^[A-Z]{1,2}\d{6,7}\(\d\)$/ 才參與去重，
 * 否則僅按姓名去重（防部分號碼誤串庫）。
 */
export async function upsertPersonFromForm(input: PersonFormInput): Promise<string> {
  const idRaw = (input.idNumber || '').trim();
  const fullHkid = idRaw.match(HKID_FULL_RE) ? idRaw : '';
  let personId = await findOrCreatePerson({
    identity: input.identity || 'natural',
    nameEnglish: input.nameEnglish || '',
    nameChinese: input.nameChinese || '',
    idNumber: fullHkid,
    address: input.address || '',
    email: input.email || '',
    passportNumber: input.passportNumber || '',
    placeIncorporated: input.placeIncorporated || '',
    companyNumberRef: input.companyNumberRef || '',
    addr_flat: input.addr_flat,
    addr_building: input.addr_building,
    addr_street: input.addr_street,
    addr_district: input.addr_district,
    addr_region: input.addr_region,
  });

  // findOrCreatePerson 新建路徑可能回 D1 rowid（非 UUID）——兜底重解析（useCompanies 已修，此為保險）
  if (!UUID_RE.test(personId)) {
    const real = await resolveRealPersonId(input.nameEnglish || '', fullHkid);
    if (real) personId = real;
  }

  // 非空字段才補丁，避免把既有資料洗空（姓名匹配路徑不會回寫這些字段）
  const patch: Record<string, any> = {};
  if (input.passportCountry) patch.passport_country = input.passportCountry;
  // 護照號碼 ≥5 位才回寫，防部分號碼覆蓋完整號碼
  if (input.passportNumber && (input.passportNumber || '').trim().length >= 5) patch.passport_number = input.passportNumber.trim();
  if (fullHkid) patch.id_number = fullHkid;
  if (input.email) patch.email = input.email;
  if (input.address) patch.address = input.address;
  if (input.addr_flat) patch.addr_flat = input.addr_flat;
  if (input.addr_building) patch.addr_building = input.addr_building;
  if (input.addr_street) patch.addr_street = input.addr_street;
  if (input.addr_district) patch.addr_district = input.addr_district;
  if (input.addr_region) patch.addr_region = input.addr_region;
  if (input.placeIncorporated) patch.place_incorporated = input.placeIncorporated;
  if (input.companyNumberRef) patch.company_number_ref = input.companyNumberRef;
  if (input.previousNameEnglish) patch.previous_name_english = input.previousNameEnglish;
  if (input.previousNameChinese) patch.previous_name_chinese = input.previousNameChinese;
  if (input.aliasEnglish) patch.alias_english = input.aliasEnglish;
  if (input.aliasChinese) patch.alias_chinese = input.aliasChinese;
  if (input.dateOfBirth) patch.date_of_birth = input.dateOfBirth;
  if (input.tcspNumber) patch.tcsp_number = input.tcspNumber;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('persons').update(patch as any).eq('id', personId);
    if (error) console.warn('[formWriteback] persons patch failed:', error);
  }
  return personId;
}

// ══════════════════════════════ 角色 upsert ══════════════════════════════

export interface UpsertRoleInput {
  personId: string;
  companyId: string;
  role: 'director' | 'secretary' | 'shareholder' | 'authorized_representative';
  dateAppointed?: string; // DD/MM/YYYY
  dateCeased?: string;    // DD/MM/YYYY
  isReserve?: boolean;
  notes?: string;
  shares?: number;
  shareType?: string;
  currency?: string;
  issuePrice?: string;
  paidUp?: string;
  unpaid?: string;
}

/** 冪等 upsert：person+company+role 有活躍行（date_ceased=''）→ UPDATE；否則 INSERT */
export async function upsertRole(input: UpsertRoleInput): Promise<{ created: boolean; rowId: string }> {
  const { data: rows } = await supabase.from('person_company_roles')
    .select('*').eq('person_id', input.personId).eq('company_id', input.companyId).eq('role', input.role);
  const active = (rows as any[])?.find(r => !r.date_ceased);
  const base: Record<string, any> = {
    date_appointed: input.dateAppointed || todayDDMMYYYY(),
    date_ceased: input.dateCeased || '',
    is_reserve: input.isReserve ? 1 : 0,
    notes: input.notes || '',
  };
  if (active) {
    const upd: Record<string, any> = { ...base };
    if (input.shares !== undefined) upd.shares = input.shares;
    if (input.shareType !== undefined) upd.share_type = input.shareType;
    if (input.currency !== undefined) upd.currency = input.currency;
    if (input.issuePrice !== undefined) upd.issue_price = input.issuePrice;
    if (input.paidUp !== undefined) upd.paid_up = input.paidUp;
    if (input.unpaid !== undefined) upd.unpaid = input.unpaid;
    const { error } = await supabase.from('person_company_roles').update(upd as any).eq('id', active.id);
    if (error) throw error;
    return { created: false, rowId: active.id };
  }
  const { data: created, error } = await supabase.from('person_company_roles')
    .insert({
      person_id: input.personId,
      company_id: input.companyId,
      role: input.role,
      ...base,
      shares: input.shares || 0,
      share_type: input.shareType || '',
      currency: input.currency || 'HKD',
      issue_price: input.issuePrice || '',
      paid_up: input.paidUp || '',
      unpaid: input.unpaid || '',
      service_address_override: '',
    } as any)
    .select('id').single();
  if (error) throw error;
  return { created: true, rowId: created.id };
}

/** 停任：首個活躍行置 date_ceased；無活躍行返回 false（不建新行） */
export async function ceaseRole(personId: string, companyId: string, role: string, dateCeased?: string): Promise<boolean> {
  const { data: rows } = await supabase.from('person_company_roles')
    .select('id, date_ceased').eq('person_id', personId).eq('company_id', companyId).eq('role', role);
  const active = (rows as any[])?.find(r => !r.date_ceased);
  if (!active) return false;
  const { error } = await supabase.from('person_company_roles')
    .update({ date_ceased: dateCeased || todayDDMMYYYY() }).eq('id', active.id);
  if (error) throw error;
  return true;
}

/** ND2B bug 修復用：person_company_roles 行 id → persons.id（舊碼把 role 行 id 當 persons.id 存） */
export async function roleRowByRoleId(roleId: string): Promise<{ person_id: string; company_id: string; role: string } | null> {
  if (!roleId) return null;
  const { data } = await supabase.from('person_company_roles')
    .select('person_id, company_id, role').eq('id', roleId).limit(1);
  return (data as any[])?.length ? (data as any[])[0] : null;
}

// ══════════════════════════════ 公司 upsert ══════════════════════════════

export interface EnsureCompanyInput {
  name?: string;
  chineseName?: string;
  jurisdiction?: string;
  brNumber?: string;
  companyType?: string;
  businessNature?: string;
  businessCode?: string;
  incorporationDate?: string;
  reg_flat?: string;
  reg_building?: string;
  reg_street?: string;
  reg_district?: string;
  reg_region?: string;
  email?: string;
  phone?: string;
}

/** 冪等：name+chinese_name+jurisdiction 精確匹配→返回 id；否則 INSERT（對齊 useCompanies.useAddCompany 列映射） */
export async function ensureCompany(input: EnsureCompanyInput): Promise<string> {
  const name = (input.name || '').trim();
  const zh = (input.chineseName || '').trim();
  const jurisdiction = input.jurisdiction || 'Hong Kong';
  if (name) {
    const { data } = await supabase.from('companies')
      .select('id').eq('name', name).eq('chinese_name', zh).eq('jurisdiction', jurisdiction).limit(1);
    if ((data as any[])?.length) return (data as any[])[0].id;
  }
  const { data: created, error } = await supabase.from('companies')
    .insert({
      name,
      chinese_name: zh,
      company_number: input.brNumber || '',
      company_type: input.companyType || '',
      business_nature: input.businessNature || '',
      business_code: input.businessCode || '',
      incorporation_date: input.incorporationDate || '',
      jurisdiction,
      reg_flat: input.reg_flat || '',
      reg_building: input.reg_building || '',
      reg_street: input.reg_street || '',
      reg_district: input.reg_district || '',
      reg_region: input.reg_region || '',
      email: input.email || '',
      phone: input.phone || '',
    } as any)
    .select('id').single();
  if (error) throw error;
  return created.id;
}

// ══════════════════════════════ 事件 ══════════════════════════════════

export interface FormEventInput {
  companyId: string;
  eventType: string;
  personId?: string;
  role?: string;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  changeDate?: string;   // ISO 或 DD/MM/YYYY，會歸一為 DD/MM/YYYY
  relatedFormType?: string;
}

/** 包 recordChangeEvent：change_date 歸一 DD/MM/YYYY，related_form_type 預設 EVENT_FORM_MAP */
export async function recordFormEvent(input: FormEventInput): Promise<void> {
  const changeDate = input.changeDate
    ? (isoToDDMMYYYY(input.changeDate) || input.changeDate)
    : todayDDMMYYYY();
  await recordChangeEvent({
    company_id: input.companyId,
    event_type: input.eventType,
    person_id: input.personId || '',
    role: input.role || '',
    old_value: input.oldValue,
    new_value: input.newValue,
    change_date: changeDate,
    related_form_type: input.relatedFormType || EVENT_FORM_MAP[input.eventType] || '',
  });
}

// ══════════════════════════════ 角色/事件映射 ══════════════════════════════

export const ROLE_EVENT_MAP: Record<string, { appoint: string; cease: string }> = {
  director: { appoint: 'director_appoint', cease: 'director_cease' },
  secretary: { appoint: 'secretary_appoint', cease: 'secretary_cease' },
  alternate: { appoint: 'reserve_director_appoint', cease: 'reserve_director_cease' },
};

export const ROLE_LABEL: Record<string, string> = {
  director: '董事', secretary: '公司秘書', alternate: '候補董事', shareholder: '股東', authorized_representative: '授權代表',
};

/** alternate → 存 director + is_reserve + notes=代替誰（role 欄位維持既有 enum） */
function storeRole(role: string): { role: 'director' | 'secretary'; isReserve: boolean } {
  return role === 'alternate'
    ? { role: 'director', isReserve: true }
    : { role: role === 'secretary' ? 'secretary' : 'director', isReserve: false };
}

// ══════════════════════════════ 確認框摘要 ══════════════════════════════

export interface WritebackSummaryItem {
  label: string;
  detail?: string;
}

export interface FormOfficer {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director' | 'alternate';
  identity?: 'natural' | 'corporate';
  alternateTo?: string;
  nameChinese?: string;
  nameSurname?: string;
  nameOtherNames?: string;
  nameEnglish?: string;
  idNumber?: string;
  passportCountry?: string;
  passportNumber?: string;
  addrFlatBlock?: string;
  addrBuilding?: string;
  addrStreetEstate?: string;
  addrDistrict?: string;
  addrRegion?: string;
  address?: string;
  dateAppointed?: string;  // ISO
  dateCeased?: string;     // ISO
  companyName?: string;
  companyNumber?: string;
  placeIncorporated?: string;
}

function officerFullName(o: { nameEnglish?: string; nameSurname?: string; nameOtherNames?: string }): string {
  return (o.nameEnglish || [o.nameSurname, o.nameOtherNames].filter(Boolean).join(' ') || '').replace(/\s+/g, ' ').trim();
}

/** 停任寫回（ND2A / ND4 / NN6 共用）：解析人員 → ceaseRole → *_cease 事件 */
async function writebackCessation(
  labels: string[],
  args: {
    companyId: string;
    name: string;
    nameChinese?: string;
    identity?: string;
    role: string;
    dateCeased: string;
    idNumber?: string;
    relatedForm?: string;
  },
): Promise<void> {
  const name = args.name.trim();
  let personId = await resolvePersonId(name, null);
  if (!personId && args.idNumber) {
    const hkid = (args.idNumber || '').trim().match(HKID_FULL_RE)?.[0] || '';
    if (hkid) {
      const { data } = await supabase.from('persons').select('id').eq('id_number', hkid).limit(1);
      personId = (data as any[])?.length ? (data as any[])[0].id : null;
    }
  }
  if (!personId) {
    labels.push(`⚠ 人員庫找不到「${name}」，已跳過停任`);
    return;
  }
  const { role } = storeRole(args.role);
  const ceased = await ceaseRole(personId, args.companyId, role, args.dateCeased);
  if (!ceased) {
    labels.push(`⚠「${name}」在 ${ROLE_LABEL[args.role] || args.role} 職位無活躍紀錄，未停任`);
    return;
  }
  const ev = ROLE_EVENT_MAP[args.role] || ROLE_EVENT_MAP.director;
  await recordFormEvent({
    companyId: args.companyId,
    eventType: ev.cease,
    personId,
    role: args.role,
    changeDate: args.dateCeased,
    relatedFormType: args.relatedForm,
    newValue: { date_ceased: args.dateCeased },
  });
  labels.push(`已停任${ROLE_LABEL[args.role] || args.role}：${name}（${args.dateCeased}）`);
}

// ══════════════════════════════ ND2A ══════════════════════════════

export function buildND2ASummary(officers: FormOfficer[]): WritebackSummaryItem[] {
  const items: WritebackSummaryItem[] = [];
  for (const o of officers) {
    const name = officerFullName(o) || o.nameChinese || '(未填姓名)';
    if (o.type === 'cessation') {
      items.push({ label: `停任${ROLE_LABEL[o.role]}：${name}`, detail: isoToDDMMYYYY(o.dateCeased) || '今天' });
    } else {
      items.push({ label: `委任${ROLE_LABEL[o.role]}：${name}`, detail: isoToDDMMYYYY(o.dateAppointed) || '今天' });
    }
  }
  return items;
}

/** ND2A 寫回：委任 → upsert 人員+活躍角色行；停任 → 解析人員+ceaseRole（不自動建檔） */
export async function writebackND2A(companyId: string, officers: FormOfficer[]): Promise<string[]> {
  const labels: string[] = [];
  for (const o of officers) {
    const fullName = officerFullName(o);
    if (o.type === 'cessation') {
      const dateCeased = isoToDDMMYYYY(o.dateCeased) || todayDDMMYYYY();
      await writebackCessation(labels, {
        companyId,
        name: fullName,
        nameChinese: o.nameChinese,
        identity: o.identity,
        role: o.role,
        dateCeased,
        idNumber: o.idNumber,
        relatedForm: undefined, // 走 EVENT_FORM_MAP（*_cease → ND4，既有慣例）
      });
      continue;
    }
    // 委任
    const name = o.identity === 'corporate' ? (o.companyName || fullName) : fullName;
    const personId = await upsertPersonFromForm({
      identity: o.identity || 'natural',
      nameEnglish: name,
      nameChinese: o.nameChinese || '',
      idNumber: o.idNumber || '',
      address: o.address || '',
      passportCountry: o.passportCountry || '',
      passportNumber: o.passportNumber || '',
      placeIncorporated: o.placeIncorporated || '',
      companyNumberRef: o.companyNumber || '',
      addr_flat: o.addrFlatBlock || '',
      addr_building: o.addrBuilding || '',
      addr_street: o.addrStreetEstate || '',
      addr_district: o.addrDistrict || '',
      addr_region: o.addrRegion || '',
    });
    const { role, isReserve } = storeRole(o.role);
    const appointed = isoToDDMMYYYY(o.dateAppointed) || todayDDMMYYYY();
    await upsertRole({
      personId, companyId, role, isReserve, dateAppointed: appointed,
      notes: o.role === 'alternate' && o.alternateTo ? `代替: ${o.alternateTo}` : '',
    });
    const ev = ROLE_EVENT_MAP[o.role] || ROLE_EVENT_MAP.director;
    await recordFormEvent({
      companyId, eventType: ev.appoint, personId, role: o.role,
      changeDate: o.dateAppointed, newValue: { name_english: name },
    });
    labels.push(`已委任${ROLE_LABEL[o.role]}：${name || o.nameChinese}（${appointed}）`);
  }
  return labels;
}

// ══════════════════════════════ ND4 ══════════════════════════════

export interface Nd4OfficerInput {
  officerType: 'director' | 'secretary' | 'alternate';
  identity?: 'natural' | 'corporate';
  officerNameEnglish?: string;  // "CHAN, Tai Man" 或全名
  officerNameChinese?: string;
  hkidPartial?: string;
  passportCountry?: string;
  passportPartial?: string;
  resignationDay?: string;
  resignationMonth?: string;
  resignationYear?: string;
  corporateName?: string;
  corporateNumber?: string;
}

export function buildND4Summary(o: Nd4OfficerInput): WritebackSummaryItem[] {
  const fullName = (o.officerNameEnglish || '').replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const name = o.identity === 'corporate' ? (o.corporateName || fullName) : fullName;
  const dateCeased = dmyToDDMMYYYY(o.resignationDay, o.resignationMonth, o.resignationYear);
  return [{ label: `停任${ROLE_LABEL[o.officerType]}：${name || o.officerNameChinese || '(未填姓名)'}`, detail: dateCeased || '今天' }];
}

/** ND4 寫回：upsert 人員（hkidPartial 僅完整格式才傳）→ ceaseRole；無活躍行 → 警告 */
export async function writebackND4(companyId: string, o: Nd4OfficerInput): Promise<string[]> {
  const labels: string[] = [];
  const fullName = (o.officerNameEnglish || '').replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const name = o.identity === 'corporate' ? (o.corporateName || fullName) : fullName;
  const dateCeased = dmyToDDMMYYYY(o.resignationDay, o.resignationMonth, o.resignationYear) || todayDDMMYYYY();
  const personId = await upsertPersonFromForm({
    identity: o.identity || 'natural',
    nameEnglish: name,
    nameChinese: o.officerNameChinese || '',
    idNumber: o.hkidPartial || '',
    passportCountry: o.passportCountry || '',
    passportNumber: o.passportPartial || '',
    placeIncorporated: 'Hong Kong',
    companyNumberRef: o.corporateNumber || '',
  });
  const { role } = storeRole(o.officerType);
  const ceased = await ceaseRole(personId, companyId, role, dateCeased);
  if (!ceased) {
    labels.push(`⚠「${name}」在 ${ROLE_LABEL[o.officerType]} 職位無活躍紀錄，未停任`);
    return labels;
  }
  const ev = ROLE_EVENT_MAP[o.officerType] || ROLE_EVENT_MAP.director;
  await recordFormEvent({
    companyId, eventType: ev.cease, personId, role: o.officerType,
    changeDate: dateCeased, newValue: { date_ceased: dateCeased },
  });
  labels.push(`已停任${ROLE_LABEL[o.officerType]}：${name || o.officerNameChinese}（${dateCeased}）`);
  return labels;
}

// ══════════════════════════════ ND2B ══════════════════════════════

export interface Nd2bChange {
  type: 'address' | 'name' | 'id' | 'contact';
  patch: Record<string, any>;      // persons 欄位
  newValue: Record<string, any>;   // 事件 new_value
}

export const ND2B_CHANGE_LABEL: Record<string, string> = {
  address: '地址', name: '姓名', id: '證件', contact: '聯絡資料',
};
const ND2B_CHANGE_EVENT: Record<string, string> = {
  address: 'person_address_change', name: 'person_name_change', id: 'person_id_change', contact: 'person_contact_change',
};

export function buildND2BSummary(personLabel: string, changes: Nd2bChange[]): WritebackSummaryItem[] {
  return changes.map(c => ({
    label: `更新人員${ND2B_CHANGE_LABEL[c.type] || c.type}：${personLabel}`,
    detail: undefined,
  }));
}

/** ND2B 寫回：按 changeTypes 更新 persons（含更新前快照 old_value）+ 對應 person_*_change 事件 */
export async function writebackND2B(input: {
  companyId: string;
  personId: string;   // persons.id（呼叫方用 roleRowByRoleId 解析）
  role?: string;
  changes: Nd2bChange[];
  changeDate?: string; // ISO
}): Promise<string[]> {
  const labels: string[] = [];
  if (!input.personId) {
    labels.push('⚠ 找不到對應人員（角色行不存在），已跳過寫回');
    return labels;
  }
  const changeDate = isoToDDMMYYYY(input.changeDate) || todayDDMMYYYY();
  const { data } = await supabase.from('persons').select('*').eq('id', input.personId).limit(1);
  const before = (data as any[])?.[0] || null;
  for (const c of input.changes) {
    const evt = ND2B_CHANGE_EVENT[c.type];
    if (!evt) continue;
    const { error } = await supabase.from('persons').update(c.patch as any).eq('id', input.personId);
    if (error) {
      labels.push(`⚠ 人員${ND2B_CHANGE_LABEL[c.type]}更新失敗：${error.message}`);
      continue;
    }
    const oldValue: Record<string, any> = {};
    for (const k of Object.keys(c.patch)) oldValue[k] = before?.[k] ?? '';
    await recordFormEvent({
      companyId: input.companyId, eventType: evt, personId: input.personId, role: input.role || '',
      changeDate, relatedFormType: 'ND2B', oldValue, newValue: c.newValue,
    });
    labels.push(`已更新人員${ND2B_CHANGE_LABEL[c.type] || c.type}`);
  }
  return labels;
}

// ══════════════════════════════ NN6 ══════════════════════════════

export interface Nn6OfficerInput {
  type: 'appointment' | 'cessation';
  role: 'secretary' | 'director' | 'alternate';
  identity?: 'natural' | 'corporate';
  alternateTo?: string;
  nameChinese?: string;
  nameSurname?: string;
  nameOtherNames?: string;
  nameEnglish?: string;
  hasFormerName?: boolean;
  formerNameChinese?: string;
  formerNameEnglish?: string;
  hasAlias?: boolean;
  aliasChinese?: string;
  aliasEnglish?: string;
  addrFlatBlock?: string;
  addrBuilding?: string;
  addrStreetEstate?: string;
  addrDistrict?: string;
  addrRegion?: string;
  address?: string;
  email?: string;
  idNumber?: string;
  passportCountry?: string;
  passportNumber?: string;
  dateAppointed?: string;  // ISO
  dateCeased?: string;     // ISO
  companyName?: string;
  companyNumber?: string;
  hasCessation?: boolean;
  cessationIdentity?: 'natural' | 'corporate';
  cessationRole?: 'secretary' | 'director' | 'alternate';
  cessationAlternateTo?: string;
  cessationNameChinese?: string;
  cessationNameSurname?: string;
  cessationNameOtherNames?: string;
  cessationNameEnglish?: string;
  cessationIdNumber?: string;
}

export function buildNN6Summary(officers: Nn6OfficerInput[]): WritebackSummaryItem[] {
  const items: WritebackSummaryItem[] = [];
  for (const o of officers) {
    const name = [o.nameSurname, o.nameOtherNames].filter(Boolean).join(' ') || o.nameEnglish || o.nameChinese || '(未填姓名)';
    if (o.type === 'cessation') {
      items.push({ label: `停任${ROLE_LABEL[o.role]}：${name}`, detail: isoToDDMMYYYY(o.dateCeased) || '今天' });
    } else {
      items.push({ label: `委任${ROLE_LABEL[o.role]}：${name}`, detail: isoToDDMMYYYY(o.dateAppointed) || '今天' });
      if (o.hasCessation) {
        const cName = [o.cessationNameSurname, o.cessationNameOtherNames].filter(Boolean).join(' ') || o.cessationNameEnglish || '(未填姓名)';
        items.push({ label: `（法人停任）${ROLE_LABEL[o.cessationRole || 'director']}：${cName}`, detail: isoToDDMMYYYY(o.dateCeased) || '今天' });
      }
    }
  }
  return items;
}

/** NN6 寫回：委任 → upsert 人員+角色；停任（含法人嵌套）→ 解析+ceaseRole；事件 related 顯式 'NN6' */
export async function writebackNN6(companyId: string, officers: Nn6OfficerInput[]): Promise<string[]> {
  const labels: string[] = [];
  for (const o of officers) {
    const fullName = [o.nameSurname, o.nameOtherNames].filter(Boolean).join(' ') || o.nameEnglish || '';
    if (o.type === 'cessation') {
      const dateCeased = isoToDDMMYYYY(o.dateCeased) || todayDDMMYYYY();
      await writebackCessation(labels, {
        companyId, name: fullName, nameChinese: o.nameChinese, identity: o.identity,
        role: o.role, dateCeased, idNumber: o.idNumber, relatedForm: 'NN6',
      });
      continue;
    }
    // 委任
    const name = o.identity === 'corporate' ? (o.companyName || o.nameEnglish || fullName) : fullName;
    const personId = await upsertPersonFromForm({
      identity: o.identity || 'natural',
      nameEnglish: name,
      nameChinese: o.nameChinese || '',
      idNumber: o.idNumber || '',
      address: o.address || '',
      email: o.email || '',
      passportCountry: o.passportCountry || '',
      passportNumber: o.passportNumber || '',
      companyNumberRef: o.companyNumber || '',
      addr_flat: o.addrFlatBlock || '',
      addr_building: o.addrBuilding || '',
      addr_street: o.addrStreetEstate || '',
      addr_district: o.addrDistrict || '',
      addr_region: o.addrRegion || '',
      previousNameEnglish: o.hasFormerName ? o.formerNameEnglish : '',
      previousNameChinese: o.hasFormerName ? o.formerNameChinese : '',
      aliasEnglish: o.hasAlias ? o.aliasEnglish : '',
      aliasChinese: o.hasAlias ? o.aliasChinese : '',
    });
    const { role, isReserve } = storeRole(o.role);
    const appointed = isoToDDMMYYYY(o.dateAppointed) || todayDDMMYYYY();
    await upsertRole({
      personId, companyId, role, isReserve, dateAppointed: appointed,
      notes: o.role === 'alternate' && o.alternateTo ? `代替: ${o.alternateTo}` : '',
    });
    const ev = ROLE_EVENT_MAP[o.role] || ROLE_EVENT_MAP.director;
    await recordFormEvent({
      companyId, eventType: ev.appoint, personId, role: o.role,
      changeDate: appointed, relatedFormType: 'NN6', newValue: { name_english: name },
    });
    labels.push(`已委任${ROLE_LABEL[o.role]}：${name || o.nameChinese}（${appointed}）`);
    if (o.hasFormerName || o.hasAlias) {
      await recordFormEvent({
        companyId, eventType: 'person_name_change', personId, role: o.role,
        changeDate: appointed, relatedFormType: 'NN6',
        newValue: { alias_english: o.aliasEnglish || '', alias_chinese: o.aliasChinese || '' },
      });
    }
    if (o.email) {
      await recordFormEvent({
        companyId, eventType: 'person_contact_change', personId, role: o.role,
        changeDate: appointed, relatedFormType: 'NN6', newValue: { email: o.email },
      });
    }
    // 法人委任嵌套停任
    if (o.hasCessation) {
      const cName = [o.cessationNameSurname, o.cessationNameOtherNames].filter(Boolean).join(' ') || o.cessationNameEnglish || '';
      const dateCeased = isoToDDMMYYYY(o.dateCeased) || todayDDMMYYYY();
      await writebackCessation(labels, {
        companyId, name: cName, nameChinese: o.cessationNameChinese, identity: o.cessationIdentity,
        role: o.cessationRole || 'director', dateCeased, idNumber: o.cessationIdNumber, relatedForm: 'NN6',
      });
    }
  }
  return labels;
}

// ══════════════════════════════ NN7 ══════════════════════════════

export interface Nn7FormInput {
  identity?: 'natural' | 'corporate';
  role?: 'secretary' | 'director';
  nameEnglish?: string;
  nameSurname?: string;
  nameOtherNames?: string;
  nameChinese?: string;
  idNumber?: string;
  passportNumber?: string;
  changeType: 'address' | 'name' | 'id' | 'other';
  newNameEnglish?: string;
  newNameChinese?: string;
  newIdNumber?: string;
  newFlat?: string;
  newBuilding?: string;
  newStreet?: string;
  newDistrict?: string;
  newRegion?: string;
  newEmail?: string;
  newPhone?: string;
  changeDescription?: string;
  effectiveDate?: string;  // ISO
}

export function buildNN7Summary(fd: Nn7FormInput): WritebackSummaryItem[] {
  const name = [fd.nameSurname, fd.nameOtherNames].filter(Boolean).join(' ') || fd.nameEnglish || fd.nameChinese || '(未填姓名)';
  const TYPE_LABEL: Record<string, string> = { address: '地址', name: '姓名', id: '證件號碼', other: '其他詳情' };
  return [{ label: `更新${fd.role === 'secretary' ? '公司秘書' : '董事'}${TYPE_LABEL[fd.changeType]}：${name}`, detail: isoToDDMMYYYY(fd.effectiveDate) || '今天' }];
}

/** NN7 寫回：按姓名/證件解析人員（找不到則建檔）→ 按 changeType 更新 persons → person_*_change 事件（related 'NN7'） */
export async function writebackNN7(companyId: string, fd: Nn7FormInput): Promise<string[]> {
  const labels: string[] = [];
  const fullName = [fd.nameSurname, fd.nameOtherNames].filter(Boolean).join(' ') || fd.nameEnglish || '';
  const changeDate = isoToDDMMYYYY(fd.effectiveDate) || todayDDMMYYYY();
  const personId = await upsertPersonFromForm({
    identity: fd.identity || 'natural',
    nameEnglish: fullName,
    nameChinese: fd.nameChinese || '',
    idNumber: fd.idNumber || '',
    passportNumber: fd.passportNumber || '',
  });
  const { data } = await supabase.from('persons').select('*').eq('id', personId).limit(1);
  const before = (data as any[])?.[0] || null;
  const patch: Record<string, any> = {};
  const newValue: Record<string, any> = {};
  if (fd.changeType === 'address') {
    if (fd.newFlat) { patch.addr_flat = fd.newFlat; newValue.addr_flat = fd.newFlat; }
    if (fd.newBuilding) { patch.addr_building = fd.newBuilding; newValue.addr_building = fd.newBuilding; }
    if (fd.newStreet) { patch.addr_street = fd.newStreet; newValue.addr_street = fd.newStreet; }
    if (fd.newDistrict) { patch.addr_district = fd.newDistrict; newValue.addr_district = fd.newDistrict; }
    if (fd.newRegion) { patch.addr_region = fd.newRegion; newValue.addr_region = fd.newRegion; }
    if (fd.newEmail) { patch.email = fd.newEmail; newValue.email = fd.newEmail; }
    if (fd.newPhone) { patch.phone = fd.newPhone; newValue.phone = fd.newPhone; }
  } else if (fd.changeType === 'name') {
    if (fd.newNameEnglish) { patch.name_english = fd.newNameEnglish; newValue.name_english = fd.newNameEnglish; }
    if (fd.newNameChinese) { patch.name_chinese = fd.newNameChinese; newValue.name_chinese = fd.newNameChinese; }
  } else if (fd.changeType === 'id') {
    if (fd.newIdNumber) { patch.id_number = fd.newIdNumber; newValue.id_number = fd.newIdNumber; }
  } else {
    const desc = (fd.changeDescription || '').trim();
    if (desc) {
      patch.notes = before?.notes ? `${before.notes}\n${desc}` : desc;
      newValue.notes = desc;
    }
  }
  if (Object.keys(patch).length === 0) {
    labels.push('⚠ 沒有可寫入的變更內容');
    return labels;
  }
  const { error } = await supabase.from('persons').update(patch as any).eq('id', personId);
  if (error) {
    labels.push(`⚠ 人員更新失敗：${error.message}`);
    return labels;
  }
  const oldValue: Record<string, any> = {};
  for (const k of Object.keys(patch)) oldValue[k] = before?.[k] ?? '';
  const EVT: Record<string, string> = {
    address: 'person_address_change', name: 'person_name_change', id: 'person_id_change', other: 'person_contact_change',
  };
  await recordFormEvent({
    companyId, eventType: EVT[fd.changeType], personId, role: fd.role || '',
    changeDate, relatedFormType: 'NN7', oldValue, newValue,
  });
  const TYPE_LABEL: Record<string, string> = { address: '地址', name: '姓名', id: '證件號碼', other: '其他詳情' };
  labels.push(`已更新人員${TYPE_LABEL[fd.changeType]}：${fullName || fd.nameChinese}`);
  return labels;
}

// ══════════════════════════════ 公司資料（NR1 / NN9 / NNC2）══════════════════════════════

export interface CompanyAddressFormInput {
  flat?: string; building?: string; street?: string; district?: string; region?: string;
  email?: string; phone?: string;
  addressDate?: string;   // DD/MM/YYYY 或 ''
  emailDate?: string;
  phoneDate?: string;
  relatedFormType: 'NR1' | 'NN9';
}

/** 共用：按變更寫回 companies 註冊地址/電郵/電話（僅非空且與現值不同才寫）+ 對應事件 */
async function writebackCompanyChanges(companyId: string, fd: CompanyAddressFormInput): Promise<string[]> {
  const labels: string[] = [];
  const { data } = await supabase.from('companies')
    .select('reg_flat, reg_building, reg_street, reg_district, reg_region, email, phone')
    .eq('id', companyId).limit(1);
  const row = (data as any[])?.[0] || null;
  if (!row) return ['⚠ 找不到公司，資料庫未更新'];

  const ADDR_KEYS: Array<[keyof CompanyAddressFormInput, string]> = [
    ['flat', 'reg_flat'], ['building', 'reg_building'], ['street', 'reg_street'],
    ['district', 'reg_district'], ['region', 'reg_region'],
  ];
  const addrPatch: Record<string, any> = {};
  for (const [fk, ck] of ADDR_KEYS) {
    const v = String(fd[fk] ?? '').trim();
    if (v && v !== String(row[ck] ?? '')) addrPatch[ck] = v;
  }
  if (Object.keys(addrPatch).length > 0) {
    const { error } = await supabase.from('companies').update(addrPatch).eq('id', companyId);
    if (error) {
      labels.push(`⚠ 地址更新失敗：${error.message}`);
    } else {
      await recordFormEvent({
        companyId, eventType: 'address_change', changeDate: fd.addressDate,
        relatedFormType: fd.relatedFormType,
        oldValue: {
          reg_flat: row.reg_flat, reg_building: row.reg_building, reg_street: row.reg_street,
          reg_district: row.reg_district, reg_region: row.reg_region,
        },
        newValue: {
          reg_flat: addrPatch.reg_flat ?? row.reg_flat, reg_building: addrPatch.reg_building ?? row.reg_building,
          reg_street: addrPatch.reg_street ?? row.reg_street, reg_district: addrPatch.reg_district ?? row.reg_district,
          reg_region: addrPatch.reg_region ?? row.reg_region,
        },
      });
      labels.push('已更新公司註冊地址');
    }
  }

  const email = String(fd.email ?? '').trim();
  if (email && email !== String(row.email ?? '')) {
    const { error } = await supabase.from('companies').update({ email }).eq('id', companyId);
    if (error) {
      labels.push(`⚠ 電郵更新失敗：${error.message}`);
    } else {
      await recordFormEvent({
        companyId, eventType: 'company_email_change', changeDate: fd.emailDate,
        relatedFormType: fd.relatedFormType,
        oldValue: { email: row.email ?? '' }, newValue: { email },
      });
      labels.push('已更新公司電郵');
    }
  }

  const phone = String(fd.phone ?? '').trim();
  if (phone && phone !== String(row.phone ?? '')) {
    const { error } = await supabase.from('companies').update({ phone }).eq('id', companyId);
    if (error) {
      labels.push(`⚠ 電話更新失敗：${error.message}`);
    } else {
      await recordFormEvent({
        companyId, eventType: 'company_phone_change', changeDate: fd.phoneDate,
        relatedFormType: fd.relatedFormType,
        oldValue: { phone: row.phone ?? '' }, newValue: { phone },
      });
      labels.push('已更新公司電話');
    }
  }

  if (labels.length === 0) labels.push('⚠ 沒有可寫入的變更內容');
  return labels;
}

// ── NR1 ──

export interface Nr1FormInput {
  flat?: string; building?: string; street?: string; district?: string; region?: string;
  email?: string; phone?: string;
  addressEffectiveDay?: string; addressEffectiveMonth?: string; addressEffectiveYear?: string;
  emailEffectiveDay?: string; emailEffectiveMonth?: string; emailEffectiveYear?: string;
  phoneEffectiveDay?: string; phoneEffectiveMonth?: string; phoneEffectiveYear?: string;
}

export function buildNR1Summary(fd: Nr1FormInput): WritebackSummaryItem[] {
  const items: WritebackSummaryItem[] = [];
  const addrFilled = [fd.flat, fd.building, fd.street, fd.district, fd.region].some(v => String(v ?? '').trim());
  if (addrFilled) {
    items.push({ label: '更新公司註冊地址', detail: dmyToDDMMYYYY(fd.addressEffectiveDay, fd.addressEffectiveMonth, fd.addressEffectiveYear) || '今天' });
  }
  const email = String(fd.email ?? '').trim();
  if (email) {
    items.push({ label: '更新公司電郵', detail: `${email} · ${dmyToDDMMYYYY(fd.emailEffectiveDay, fd.emailEffectiveMonth, fd.emailEffectiveYear) || '今天'}` });
  }
  const phone = String(fd.phone ?? '').trim();
  if (phone) {
    items.push({ label: '更新公司電話', detail: `${phone} · ${dmyToDDMMYYYY(fd.phoneEffectiveDay, fd.phoneEffectiveMonth, fd.phoneEffectiveYear) || '今天'}` });
  }
  if (items.length === 0) items.push({ label: '沒有可寫入的變更內容', detail: '僅生成 PDF' });
  return items;
}

/** NR1 寫回：companies reg_* 5 欄 + email/phone（僅非空且變化才寫）+ 對應事件（related 'NR1'） */
export async function writebackNR1(companyId: string, fd: Nr1FormInput): Promise<string[]> {
  return writebackCompanyChanges(companyId, {
    flat: fd.flat, building: fd.building, street: fd.street, district: fd.district, region: fd.region,
    email: fd.email, phone: fd.phone,
    addressDate: dmyToDDMMYYYY(fd.addressEffectiveDay, fd.addressEffectiveMonth, fd.addressEffectiveYear),
    emailDate: dmyToDDMMYYYY(fd.emailEffectiveDay, fd.emailEffectiveMonth, fd.emailEffectiveYear),
    phoneDate: dmyToDDMMYYYY(fd.phoneEffectiveDay, fd.phoneEffectiveMonth, fd.phoneEffectiveYear),
    relatedFormType: 'NR1',
  });
}

// ── NN9 ──

export interface Nn9FormInput {
  flat?: string; building?: string; street?: string; district?: string; region?: string;
  newEmail?: string; newPhone?: string;
  changeDay?: string; changeMonth?: string; changeYear?: string;
}

export function buildNN9Summary(fd: Nn9FormInput): WritebackSummaryItem[] {
  const items: WritebackSummaryItem[] = [];
  const d = dmyToDDMMYYYY(fd.changeDay, fd.changeMonth, fd.changeYear) || '今天';
  const addrFilled = [fd.flat, fd.building, fd.street, fd.district, fd.region].some(v => String(v ?? '').trim());
  if (addrFilled) items.push({ label: '更新公司註冊地址', detail: d });
  const email = String(fd.newEmail ?? '').trim();
  if (email) items.push({ label: '更新公司電郵', detail: `${email} · ${d}` });
  const phone = String(fd.newPhone ?? '').trim();
  if (phone) items.push({ label: '更新公司電話', detail: `${phone} · ${d}` });
  if (items.length === 0) items.push({ label: '沒有可寫入的變更內容', detail: '僅生成 PDF' });
  return items;
}

/** NN9 寫回：同 NR1 但生效日期共用 change D/M/Y、related 顯式 'NN9' */
export async function writebackNN9(companyId: string, fd: Nn9FormInput): Promise<string[]> {
  const d = dmyToDDMMYYYY(fd.changeDay, fd.changeMonth, fd.changeYear);
  return writebackCompanyChanges(companyId, {
    flat: fd.flat, building: fd.building, street: fd.street, district: fd.district, region: fd.region,
    email: fd.newEmail, phone: fd.newPhone,
    addressDate: d, emailDate: d, phoneDate: d,
    relatedFormType: 'NN9',
  });
}

// ── NNC2 ──

export interface Nnc2FormInput {
  newName?: string; newChineseName?: string;
  oldName?: string; oldChineseName?: string;   // 舊值快照（表單自動填）
}

export function buildNNC2Summary(fd: Nnc2FormInput): WritebackSummaryItem[] {
  const newName = String(fd.newName ?? '').trim();
  const newCn = String(fd.newChineseName ?? '').trim();
  if (!newName && !newCn) return [{ label: '沒有可寫入的變更內容', detail: '僅生成 PDF' }];
  const old = [fd.oldName, fd.oldChineseName].filter(Boolean).join(' / ') || '(未填)';
  const next = [newName, newCn].filter(Boolean).join(' / ');
  return [{ label: `更改公司名稱：${old} → ${next}`, detail: '今天' }];
}

/** NNC2 寫回：companies.name/chinese_name（僅非空且變化才寫）+ name_change 事件（related 'NNC2'，change_date=今天） */
export async function writebackNNC2(companyId: string, fd: Nnc2FormInput): Promise<string[]> {
  const { data } = await supabase.from('companies').select('name, chinese_name').eq('id', companyId).limit(1);
  const row = (data as any[])?.[0] || null;
  if (!row) return ['⚠ 找不到公司，資料庫未更新'];
  const newName = String(fd.newName ?? '').trim();
  const newCn = String(fd.newChineseName ?? '').trim();
  const patch: Record<string, any> = {};
  if (newName && newName !== row.name) patch.name = newName;
  if (newCn && newCn !== String(row.chinese_name ?? '')) patch.chinese_name = newCn;
  if (Object.keys(patch).length === 0) return ['⚠ 沒有可寫入的變更內容'];
  const { error } = await supabase.from('companies').update(patch).eq('id', companyId);
  if (error) return [`⚠ 公司名稱更新失敗：${error.message}`];
  await recordFormEvent({
    companyId, eventType: 'name_change', relatedFormType: 'NNC2',
    oldValue: { name: fd.oldName || row.name, chinese_name: fd.oldChineseName || row.chinese_name || '' },
    newValue: { name: patch.name ?? row.name, chinese_name: patch.chinese_name ?? row.chinese_name ?? '' },
  });
  return [`已更新公司名稱：${patch.name ?? patch.chinese_name}`];
}
