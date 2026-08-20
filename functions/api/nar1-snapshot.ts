// nar1-snapshot.ts — NAR1 週年申報資訊自動化：按結算日期（returnDate）重建公司快照。
//
// 規則（2026-08-20 用戶定案）：
//   - 人員 as-of：委任 ≤ 截止日 且（未辭任 或 辭任 > 截止日）才列入；截止日後的
//     變動歸下一年申報，不影響本年表單。
//   - 持股 as-of：以每人×股類的「當前結餘」為錨，反向扣除截止日後的交易增量
//     （沿用 ROM 的「初始認購 = 當前 − 交易增量」思路，generate-rom-docx.ts）。
//   - 公司資訊：取當前最新值（用戶原話「取最新的信息」）。
//   - 變動清單：change_events 落在 [periodStart, returnDate] 閉區間（日粒度），
//     按日期倒序。SQL 側按日期過濾不可靠（三種格式混存）→ TS 解析。
//
// 純只讀，不寫任何表。PDF 填充不動（generate-nar1-pdf.ts 只按數組算續頁數，
// 過濾後的數組自動產生正確頁數）。
import { verifyAuthRequest, type Env as AuthEnv } from './_auth';
import { corsHeaders, jsonResp, rget } from './_pdf-utils';
import { dateSortKey, sortRolesByAppointment } from './_shareholder-seq';

type Env = AuthEnv & { DB: D1Database };

// ── 響應形狀：camelCase，與前端 Person/Shareholder 同形，NAR1Generator 的
//    applyPeopleAutoFill 映射可直接復用 ──
interface PersonSnap {
  id: string;
  nameChinese: string;
  nameEnglish: string;
  email: string;
  identity: string;
  brNumber: string;
  companyNumberRef: string;
  tcspNumber: string;
  previousNameChinese: string;
  previousNameEnglish: string;
  aliasChinese: string;
  aliasEnglish: string;
  addrFlat: string;
  addrBuilding: string;
  addrStreet: string;
  addrDistrict: string;
  addrRegion: string;
  address: string;
  serviceAddress: string;
  idNumber: string;
  passportNumber: string;
  passportCountry: string;
  placeIncorporated: string;
  dateAppointed: string;
  dateCeased: string;
  isReserve: boolean;
}

interface ShareholderSnap {
  id: string;
  name: string;
  nameEnglish: string;
  nameChinese: string;
  shares: number;
  identity: string;
  idNumber: string;
  address: string;
  email: string;
  shareType: string;
  currency: string;
  issuePrice: string;
  paidUp: string;
  unpaid: string;
  addrFlat: string;
  addrBuilding: string;
  addrStreet: string;
  addrDistrict: string;
  addrRegion: string;
  placeIncorporated: string;
  companyNumberRef: string;
  tcspNumber: string;
  dateAppointed: string;
  dateCeased: string;
}

// ── period start = returnDate − 1 年（2/29 在非閏年 clamp 到 2/28）──
function periodStartOf(returnDate: string): string {
  const [y, m, d] = returnDate.split('-').map(Number);
  const targetYear = y - 1;
  let dd = d;
  if (m === 2 && d === 29 && !(targetYear % 4 === 0 && (targetYear % 100 !== 0 || targetYear % 400 === 0))) {
    dd = 28;
  }
  return `${targetYear}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// ── 股類歸一：'' → 'ordinary'，匹配時同歸一再比（role 行與交易行寫法可能不同）──
function normalizeShareType(s: unknown): string {
  const t = String(s ?? '').trim().toLowerCase();
  return t || 'ordinary';
}
const DEFAULT_SHARE_TYPE_LABEL = 'Ordinary 普通股';

// ── 人員 as-of 選行 ──
// 按 (person_id, role) 分組：候選 = appointed ≤ cutoff（空日期寬容視為符合）且
// （ceased 空 或 ceased > cutoff）；多行取 appointed 最大者。
function pickActiveRow(group: any[], cutoff: string): any | null {
  const cands = group.filter((r) => {
    const ap = dateSortKey(r.date_appointed);
    const ce = dateSortKey(r.date_ceased);
    return (ap === '' || ap <= cutoff) && (ce === '' || ce > cutoff);
  });
  if (cands.length === 0) return null;
  // appointed 最大者（空日期沉底）；同日再按 created_at
  return [...cands].sort((a, b) => {
    const ka = dateSortKey(a.date_appointed);
    const kb = dateSortKey(b.date_appointed);
    if (ka !== kb) return ka < kb ? 1 : -1;
    const ca = String(a.created_at ?? '');
    const cb = String(b.created_at ?? '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    return 0;
  })[0];
}

function toPersonSnap(pcr: any, p: any): PersonSnap {
  // is_reserve 存在 '0'/'1' 字串：'0' 是 truthy，必須 Number 強制轉
  const isReserve = Number(rget(pcr, 'is_reserve', 0)) !== 0;
  return {
    // id = 人員 UUID（不是 role 行 id——前端按 person id 找卡片）
    id: String(rget(p, 'id', '') || rget(pcr, 'person_id', '')),
    nameChinese: rget(p, 'name_chinese'),
    nameEnglish: rget(p, 'name_english'),
    email: rget(p, 'email'),
    identity: rget(p, 'identity', 'natural'),
    brNumber: rget(p, 'company_number_ref'),
    companyNumberRef: rget(p, 'company_number_ref'),
    tcspNumber: rget(p, 'tcsp_number'),
    previousNameChinese: rget(p, 'previous_name_chinese'),
    previousNameEnglish: rget(p, 'previous_name_english'),
    aliasChinese: rget(p, 'alias_chinese'),
    aliasEnglish: rget(p, 'alias_english'),
    addrFlat: rget(p, 'addr_flat'),
    addrBuilding: rget(p, 'addr_building'),
    addrStreet: rget(p, 'addr_street'),
    addrDistrict: rget(p, 'addr_district'),
    addrRegion: rget(p, 'addr_region'),
    address: rget(p, 'address'),
    serviceAddress: rget(p, 'service_address'),
    idNumber: rget(p, 'id_number'),
    passportNumber: rget(p, 'passport_number'),
    passportCountry: rget(p, 'passport_country'),
    placeIncorporated: rget(p, 'place_incorporated'),
    dateAppointed: rget(pcr, 'date_appointed'),
    dateCeased: rget(pcr, 'date_ceased'),
    isReserve,
  };
}

// ── 持股反向回放 ──
// 錨 = 每人×股類的當前結餘；截止日後的交易反向還原：
//   asOf = 錨 − Δ（to 方 +N → asOf−N；from 方 −N → asOf+N；allotment/repurchase 同理）。
// asOf ≤ 0 剔除（對齊 generate-nar1-pdf.ts 的 validMembers 過濾）。
// 截止日後的新買家（role 行 date_appointed=交易日 > cutoff）自然被還原為 0 剔除。
function replayShareholders(
  rows: any[],
  txs: any[],
  personMap: Map<string, any>,
  cutoff: string,
): ShareholderSnap[] {
  const shRows = rows.filter((r) => r.role === 'shareholder');

  // 姓名索引：舊交易只有姓名沒有 person_id 時兜底（ROM 先例）
  const nameIndex = new Map<string, string>();
  for (const p of personMap.values()) {
    for (const raw of [p.name_english, p.name_chinese]) {
      const k = String(raw ?? '').trim().toUpperCase();
      if (k && !nameIndex.has(k)) nameIndex.set(k, p.id);
    }
  }

  const postTx = txs
    .map((t) => ({
      key: dateSortKey(t.transaction_date),
      type: String(rget(t, 'transaction_type', '')).toLowerCase(),
      n: parseInt(String(rget(t, 'shares', '0')), 10) || 0,
      toId: String(rget(t, 'to_person_id', '') || nameIndex.get(String(rget(t, 'to_name', '')).trim().toUpperCase()) || ''),
      fromId: String(rget(t, 'from_person_id', '') || nameIndex.get(String(rget(t, 'from_name', '')).trim().toUpperCase()) || ''),
      shareType: normalizeShareType(rget(t, 'share_type', '')),
      shareTypeEmpty: !String(rget(t, 'share_type', '')).trim(),
    }))
    .filter((x) => x.key !== '' && x.key > cutoff && x.n > 0);

  // 每人：as-of 行（appointed ≤ cutoff 取最大，供日期/財務欄位）+ 按股類結算
  const out: ShareholderSnap[] = [];
  const byPerson = new Map<string, any[]>();
  for (const r of shRows) {
    if (!r.person_id) continue;
    const arr = byPerson.get(r.person_id) || [];
    arr.push(r);
    byPerson.set(r.person_id, arr);
  }

  for (const [personId, group] of byPerson) {
    const person = personMap.get(personId);
    if (!person) continue;

    const asOfRows = group.filter((r) => {
      const ap = dateSortKey(r.date_appointed);
      const ce = dateSortKey(r.date_ceased);
      // 截止日時仍在任：appointed ≤ cutoff 且（未辭任 或 辭任 > cutoff）
      return (ap === '' || ap <= cutoff) && (ce === '' || ce > cutoff);
    });
    // as-of 行 = appointed 最大者；全數 ceased ≤ 截止日 → 此人已非股東，剔除
    // （生產實例：Lam Wai Keung 24/06/2026 辭任，as-of 2027-05-29 不應再列出）
    const asOfRow = [...asOfRows].sort((a, b) => {
      const ka = dateSortKey(a.date_appointed);
      const kb = dateSortKey(b.date_appointed);
      if (ka !== kb) return ka < kb ? 1 : -1;
      return String(a.created_at ?? '') < String(b.created_at ?? '') ? 1 : -1;
    })[0];
    if (!asOfRow) continue;

    // 錨：活躍行優先（當前結餘）；全數 ceased 用 asOfRow 的已清零結餘
    const live = group.filter((r) => dateSortKey(r.date_ceased) === '');
    const anchorRows = live.length ? live : [asOfRow];

    // 按股類分組算 as-of
    const byShareType = new Map<string, number>();
    const displayShareType = new Map<string, string>();
    for (const r of anchorRows) {
      const k = normalizeShareType(r.share_type);
      byShareType.set(k, (byShareType.get(k) || 0) + (parseInt(String(r.shares || '0'), 10) || 0));
      if (!displayShareType.has(k)) displayShareType.set(k, String(rget(r, 'share_type', '') || DEFAULT_SHARE_TYPE_LABEL));
    }
    // asOfRow 的股類也要有錨（可能與 anchorRows 不同行）
    {
      const k = normalizeShareType(asOfRow.share_type);
      if (!byShareType.has(k)) {
        byShareType.set(k, parseInt(String(asOfRow.shares || '0'), 10) || 0);
        displayShareType.set(k, String(rget(asOfRow, 'share_type', '') || DEFAULT_SHARE_TYPE_LABEL));
      }
    }

    for (const [stKey, anchor] of byShareType) {
      let asOf = anchor;
      for (const x of postTx) {
        // 交易未標股類 → 對該人所有股類生效；有標 → 只對同股類生效
        const match = x.shareTypeEmpty || x.shareType === stKey;
        if (match && x.toId === personId && ['transfer', 'allotment', 'capital_increase'].includes(x.type)) {
          asOf -= x.n; // 截止日後買入/獲配 → 截止日當時沒有這部分
        }
        if (match && x.fromId === personId && ['transfer', 'repurchase'].includes(x.type)) {
          asOf += x.n; // 截止日後賣出/回購 → 截止日當時還持有這部分
        }
      }
      if (asOf <= 0) continue; // 截止日後才入場 → 還原為 0 剔除

      out.push({
        id: personId,
        name: rget(person, 'name_english') || rget(person, 'name_chinese'),
        nameEnglish: rget(person, 'name_english'),
        nameChinese: rget(person, 'name_chinese'),
        shares: asOf,
        identity: rget(person, 'identity', 'natural'),
        idNumber: rget(person, 'id_number'),
        address: rget(person, 'address'),
        email: rget(person, 'email'),
        shareType: displayShareType.get(stKey) || DEFAULT_SHARE_TYPE_LABEL,
        currency: rget(asOfRow, 'currency', 'HKD'),
        issuePrice: rget(asOfRow, 'issue_price'),
        paidUp: rget(asOfRow, 'paid_up'),
        unpaid: rget(asOfRow, 'unpaid'),
        addrFlat: rget(person, 'addr_flat'),
        addrBuilding: rget(person, 'addr_building'),
        addrStreet: rget(person, 'addr_street'),
        addrDistrict: rget(person, 'addr_district'),
        addrRegion: rget(person, 'addr_region'),
        placeIncorporated: rget(person, 'place_incorporated'),
        companyNumberRef: rget(person, 'company_number_ref'),
        tcspNumber: rget(person, 'tcsp_number'),
        dateAppointed: rget(asOfRow, 'date_appointed'),
        dateCeased: rget(asOfRow, 'date_ceased'),
      });
    }
  }

  // 按成為股東時序排序（空日期沉底）
  out.sort((a, b) => {
    const ka = dateSortKey(a.dateAppointed);
    const kb = dateSortKey(b.dateAppointed);
    if (!ka !== !kb) return ka ? -1 : 1;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return 0;
  });
  return out;
}

// ── 變動窗口：[periodStart, returnDate] 閉區間（日粒度），日期倒序 ──
function windowChanges(events: any[], periodStart: string, returnDate: string): any[] {
  const startKey = dateSortKey(periodStart);
  const endKey = dateSortKey(returnDate);
  return events
    .filter((e) => {
      const k = dateSortKey(e.change_date);
      return k !== '' && k >= startKey && k <= endKey;
    })
    .sort((a, b) => {
      const ka = dateSortKey(a.change_date);
      const kb = dateSortKey(b.change_date);
      if (ka !== kb) return ka < kb ? 1 : -1;
      return String(b.created_at ?? '') < String(a.created_at ?? '') ? -1 : 1;
    });
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const { errorResponse } = await verifyAuthRequest(request, env);
  if (errorResponse) return errorResponse;

  try {
    const body = await request.json() as any;
    const companyId = String(body?.companyId ?? '').trim();
    const returnDate = String(body?.returnDate ?? '').trim();
    if (!companyId) return jsonResp({ error: 'companyId required' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) return jsonResp({ error: 'returnDate must be YYYY-MM-DD' }, 400);
    const cutoff = dateSortKey(returnDate);
    if (!cutoff) return jsonResp({ error: 'returnDate must be YYYY-MM-DD' }, 400);

    const company = await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(companyId).first();
    if (!company) return jsonResp({ error: 'Company not found' }, 404);

    const [rolesRes, txsRes, eventsRes] = await Promise.all([
      env.DB.prepare('SELECT * FROM person_company_roles WHERE company_id = ?').bind(companyId).all(),
      env.DB.prepare('SELECT * FROM share_transactions WHERE company_id = ?').bind(companyId).all(),
      env.DB.prepare('SELECT * FROM change_events WHERE company_id = ?').bind(companyId).all(),
    ]);
    const rows = (rolesRes.results || []) as any[];
    const txs = (txsRes.results || []) as any[];

    // persons：role 行 + 交易雙方引用的人
    const personIds = [...new Set([
      ...rows.map((r) => r.person_id).filter(Boolean),
      ...txs.flatMap((t) => [t.to_person_id, t.from_person_id]).filter(Boolean),
    ]) as unknown as string[]];
    const personsRes = personIds.length
      ? await env.DB.prepare(`SELECT * FROM persons WHERE id IN (${personIds.map(() => '?').join(',')})`)
        .bind(...personIds).all()
      : { results: [] };
    const personMap = new Map<string, any>((personsRes.results || []).map((p: any) => [p.id, p]));

    // ── 人員 as-of ──
    const directors: PersonSnap[] = [];
    const reserveDirectors: PersonSnap[] = [];
    const secretaries: PersonSnap[] = [];
    for (const role of ['director', 'secretary']) {
      const roleRows = rows.filter((r) => r.role === role);
      const byPerson = new Map<string, any[]>();
      for (const r of roleRows) {
        if (!r.person_id) continue;
        const arr = byPerson.get(r.person_id) || [];
        arr.push(r);
        byPerson.set(r.person_id, arr);
      }
      for (const [personId, group] of byPerson) {
        const chosen = pickActiveRow(group, cutoff);
        if (!chosen) continue;
        const person = personMap.get(personId);
        if (!person) continue;
        const snap = toPersonSnap(chosen, person);
        if (role === 'director') {
          (snap.isReserve ? reserveDirectors : directors).push(snap);
        } else {
          secretaries.push(snap);
        }
      }
    }

    // sortRolesByAppointment 讀 snake_case 欄位 → 臨時掛上再剝掉
    const sortByAppt = (arr: PersonSnap[]): PersonSnap[] => {
      const tagged = arr.map((s) => ({ ...s, date_appointed: s.dateAppointed, created_at: '' }));
      return sortRolesByAppointment(tagged as any).map((t: any) => {
        const { date_appointed, created_at, ...snap } = t;
        return snap;
      });
    };

    const shareholders = replayShareholders(rows, txs, personMap, cutoff);

    const periodStart = periodStartOf(returnDate);
    const changes = windowChanges((eventsRes.results || []) as any[], periodStart, returnDate);

    return jsonResp({
      success: true,
      period: { start: periodStart, end: returnDate },
      company: {
        id: rget(company, 'id'),
        name: rget(company, 'name'),
        chineseName: rget(company, 'chinese_name'),
        companyNumber: rget(company, 'company_number'),
        tradingName: rget(company, 'trading_name'),
        businessNature: rget(company, 'business_nature'),
        businessCode: rget(company, 'business_code'),
        companyType: rget(company, 'company_type'),
        regFlat: rget(company, 'reg_flat'),
        regBuilding: rget(company, 'reg_building'),
        regStreet: rget(company, 'reg_street'),
        regDistrict: rget(company, 'reg_district'),
        regRegion: rget(company, 'reg_region'),
        email: rget(company, 'email'),
        phone: rget(company, 'phone'),
        incorporationDate: rget(company, 'incorporation_date'),
      },
      officers: {
        secretaries: sortByAppt(secretaries),
        directors: sortByAppt(directors),
        reserveDirectors: sortByAppt(reserveDirectors),
      },
      shareholders,
      changes,
    });
  } catch (error) {
    console.error('Error building NAR1 snapshot:', error);
    return jsonResp({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
}
