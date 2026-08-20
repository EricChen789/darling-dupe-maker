// 本地跑真实 nar1-snapshot 端点：as-of 人员选行 / 持股反向回放 / 变动窗口 / 错误路径。
// 截止日 cutoff = 2026-06-01。
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const out = await build({
  entryPoints: [join(root, 'functions/api/nar1-snapshot.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node', target: 'node18',
});
const { onRequest } = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

// ═══ 数据 ═══
const COMPANY_ID = 'c1';
const company = {
  id: COMPANY_ID, name: 'TestCo Ltd', company_number: '12345678',
  incorporation_date: '2023-06-01', reg_flat: 'FLAT 1', reg_building: 'BLK A',
  reg_street: 'MAIN ST', reg_district: 'CENTRAL', reg_region: 'HK', email: 'a@b.c',
};

// persons: id → row
const persons = {
  p_d1: { id: 'p_d1', name_english: 'Dir Old', identity: 'natural', id_number: 'A111111(1)', addr_flat: 'F1' },
  p_d2: { id: 'p_d2', name_english: 'Dir New After', identity: 'natural', id_number: 'A222222(2)' },
  p_d3: { id: 'p_d3', name_english: 'Dir Ceased Early', identity: 'natural' },
  p_d4: { id: 'p_d4', name_english: 'Dir Ceased After', identity: 'natural' },
  p_res: { id: 'p_res', name_english: 'Reserve One', identity: 'natural' },
  p_sec: { id: 'p_sec', name_english: 'SecCo Ltd', identity: 'corporate', company_number_ref: 'BR-999' },
  p_s1: { id: 'p_s1', name_english: 'Share A', identity: 'natural' },
  p_s2: { id: 'p_s2', name_english: 'Share B', identity: 'natural' },
  p_s3: { id: 'p_s3', name_english: 'Share Allot C', identity: 'natural' },
  p_s4: { id: 'p_s4', name_english: 'Share Sold D', identity: 'natural' },
  p_s5: { id: 'p_s5', name_english: 'Multi Row E', identity: 'natural' },
  p_s6: { id: 'p_s6', name_english: 'Share Ceased Early', identity: 'natural' },
};

const roles = [
  // 董事
  { id: 'r_d1', person_id: 'p_d1', company_id: COMPANY_ID, role: 'director', date_appointed: '2024-01-01', date_ceased: '', is_reserve: 0 },
  { id: 'r_d2', person_id: 'p_d2', company_id: COMPANY_ID, role: 'director', date_appointed: '2026-07-01', date_ceased: '', is_reserve: 0 },   // 截止日后委任 → 排除
  { id: 'r_d3', person_id: 'p_d3', company_id: COMPANY_ID, role: 'director', date_appointed: '2024-01-01', date_ceased: '2025-12-31', is_reserve: 0 }, // 截止日前已辞 → 排除
  { id: 'r_d4', person_id: 'p_d4', company_id: COMPANY_ID, role: 'director', date_appointed: '2024-01-01', date_ceased: '2026-07-01', is_reserve: 0 }, // 截止日后辞 → 纳入
  { id: 'r_d5', person_id: 'p_d1', company_id: COMPANY_ID, role: 'director', date_appointed: '2025-01-01', date_ceased: '2026-09-01', is_reserve: 0 }, // 同一人多行（旧行），新行 active
  // 备任董事
  { id: 'r_res', person_id: 'p_res', company_id: COMPANY_ID, role: 'director', date_appointed: '2025-03-01', date_ceased: '', is_reserve: 1 },
  // 秘书（法人）
  { id: 'r_sec', person_id: 'p_sec', company_id: COMPANY_ID, role: 'secretary', date_appointed: '2024-02-01', date_ceased: '', is_reserve: 0 },
  // 股东
  { id: 'r_s1', person_id: 'p_s1', company_id: COMPANY_ID, role: 'shareholder', date_appointed: '2023-06-01', date_ceased: '', shares: 900, share_type: 'Ordinary', currency: 'HKD', issue_price: '1.00', paid_up: '900', unpaid: '' },      // 卖 100 给 p_s2（截止日后）→ as-of 1000
  { id: 'r_s2', person_id: 'p_s2', company_id: COMPANY_ID, role: 'shareholder', date_appointed: '2026-07-15', date_ceased: '', shares: 100, share_type: 'Ordinary', currency: 'HKD', issue_price: '1.00', paid_up: '', unpaid: '' },      // 截止日后买家 → 剔除
  { id: 'r_s3', person_id: 'p_s3', company_id: COMPANY_ID, role: 'shareholder', date_appointed: '2026-08-01', date_ceased: '', shares: 200, share_type: 'Ordinary', currency: 'HKD', issue_price: '2.00', paid_up: '', unpaid: '' },      // 截止日后获配 → 剔除
  { id: 'r_s4', person_id: 'p_s4', company_id: COMPANY_ID, role: 'shareholder', date_appointed: '2024-05-01', date_ceased: '2026-07-01', shares: 0, share_type: 'Ordinary', currency: 'HKD', issue_price: '1.00', paid_up: '', unpaid: '' }, // 截止日后全数转出 → 还原 500
  { id: 'r_s5a', person_id: 'p_s5', company_id: COMPANY_ID, role: 'shareholder', date_appointed: '2024-01-01', date_ceased: '', shares: 300, share_type: 'Ordinary', currency: 'HKD', issue_price: '1.00', paid_up: '', unpaid: '' },
  { id: 'r_s5b', person_id: 'p_s5', company_id: COMPANY_ID, role: 'shareholder', date_appointed: '2024-01-01', date_ceased: '', shares: 200, share_type: 'Preference', currency: 'HKD', issue_price: '1.00', paid_up: '', unpaid: '' },  // 多股类 → 两条
  { id: 'r_s6', person_id: 'p_s6', company_id: COMPANY_ID, role: 'shareholder', date_appointed: '2024-01-01', date_ceased: '2025-12-31', shares: 750, share_type: 'Ordinary', currency: 'HKD', issue_price: '1.00', paid_up: '', unpaid: '' }, // 截止日前已全数辞任 → 剔除（生产 Lam 案例）
];

const txs = [
  // 截止日后：p_s1 → p_s2 100 Ordinary
  { id: 't1', company_id: COMPANY_ID, transaction_date: '2026-07-15', transaction_type: 'transfer', from_person_id: 'p_s1', to_person_id: 'p_s2', shares: 100, share_type: 'Ordinary' },
  // 截止日后：p_s4 → p_s2 500 Ordinary（p_s4 清零）
  { id: 't2', company_id: COMPANY_ID, transaction_date: '15/07/2026', transaction_type: 'transfer', from_person_id: 'p_s4', to_person_id: 'p_s2', shares: 500, share_type: 'Ordinary' },
  // 截止日后：向 p_s3 配股 200
  { id: 't3', company_id: COMPANY_ID, transaction_date: '2026-08-01', transaction_type: 'allotment', to_person_id: 'p_s3', shares: 200, share_type: 'Ordinary' },
  // 截止日前：p_s1 → p_s4 100（不影响 as-of）
  { id: 't4', company_id: COMPANY_ID, transaction_date: '2026-03-01', transaction_type: 'transfer', from_person_id: 'p_s1', to_person_id: 'p_s4', shares: 100, share_type: 'Ordinary' },
];

const events = [
  { id: 'e1', company_id: COMPANY_ID, event_type: 'director_appoint', person_id: 'p_d1', change_date: '2026-06-01', created_at: '2026-06-01T00:00:00Z' }, // returnDate 当天 → 含（闭区间）
  { id: 'e2', company_id: COMPANY_ID, event_type: 'address_change', person_id: '', change_date: '01/06/2025', created_at: '' },  // periodStart 当天 → 含
  { id: 'e3', company_id: COMPANY_ID, event_type: 'director_cease', person_id: 'p_d3', change_date: '2025-05-31', created_at: '' }, // 窗口前 → 排除
  { id: 'e4', company_id: COMPANY_ID, event_type: 'name_change', person_id: '', change_date: '2026-06-02', created_at: '' },   // 窗口后 → 排除
  { id: 'e5', company_id: COMPANY_ID, event_type: 'share_transfer', person_id: 'p_s1', change_date: '15032026', created_at: '' },  // DDMMYYYY → 含
  { id: 'e6', company_id: COMPANY_ID, event_type: 'x', change_date: 'garbage', created_at: '' }, // 不可解析 → 排除
];

// mock DB：按归一化 SQL 前缀路由
function makeEnv() {
  const prepare = (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      bind: (...args) => ({
        first: async () => {
          if (s.startsWith('SELECT * FROM companies')) return company;
          return null;
        },
        all: async () => {
          if (s.startsWith('SELECT role FROM user_roles')) return { results: [] };
          if (s.startsWith('SELECT * FROM person_company_roles')) return { results: roles };
          if (s.startsWith('SELECT * FROM share_transactions')) return { results: txs };
          if (s.startsWith('SELECT * FROM change_events')) return { results: events };
          if (s.startsWith('SELECT * FROM persons')) {
            const ids = args;
            return { results: ids.map((id) => persons[id]).filter(Boolean) };
          }
          return { results: [] };
        },
      }),
    };
  };
  return { JWT_SECRET: 'test', DB: { prepare } };
}

const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const p = b64url(JSON.stringify({ sub: 'x', email: 'admin@localhost', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }));
const token = `${h}.${p}.${b64url(crypto.createHmac('sha256', 'test').update(`${h}.${p}`).digest())}`;

async function snap(body, withAuth = true) {
  const resp = await onRequest({
    request: new Request('http://localhost/api/nar1-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(withAuth ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body) }),
    env: makeEnv() });
  const j = await resp.json();
  return { status: resp.status, j };
}

let pass = 0, fail = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}  ${detail}`); fail++; }
};

const names = (arr) => (arr || []).map(x => x.nameEnglish).sort().join(',');

// ═══ A. 人员 as-of ═══
console.log('=== A. 人员 as-of ===');
{
  const { status, j } = await snap({ companyId: COMPANY_ID, returnDate: '2026-06-01' });
  chk('200 成功', status === 200 && j.success === true, JSON.stringify(j).slice(0, 200));
  const dirs = j.officers.directors, res = j.officers.reserveDirectors, secs = j.officers.secretaries;
  chk('董事：含截止日前委任且未辞（Dir Old）', names(dirs).includes('Dir Old'));
  chk('董事：排除截止日后委任（Dir New After）', !names(dirs).includes('Dir New After'));
  chk('董事：排除截止日前已辞（Dir Ceased Early）', !names(dirs).includes('Dir Ceased Early'));
  chk('董事：含截止日后才辞（Dir Ceased After）', names(dirs).includes('Dir Ceased After'));
  chk('董事：同一人多行只出一人（Dir Old 一次）', dirs.filter(d => d.nameEnglish === 'Dir Old').length === 1);
  chk('备任董事在 reserveDirectors（is_reserve 1）', names(res) === 'Reserve One');
  chk('备任不在 directors', !names(dirs).includes('Reserve One'));
  chk('秘书为法人且 brNumber=company_number_ref', secs.length === 1 && secs[0].identity === 'corporate' && secs[0].brNumber === 'BR-999');
  chk('秘书 isReserve=false', secs[0].isReserve === false);
  chk('按委任日期升序（Ceased After 2024 首，Dir Old 2025 次）', dirs[0] && dirs[0].nameEnglish === 'Dir Ceased After' && dirs[1] && dirs[1].nameEnglish === 'Dir Old', names(dirs));
  chk('董事 id 為 person UUID（非 role 行 id）', dirs.every(d => d.id.startsWith('p_') && !d.id.startsWith('r_')), JSON.stringify(dirs.map(d => d.id)));
}

// ═══ B. 持股反向回放 ═══
console.log('\n=== B. 持股反向回放 ===');
{
  const { j } = await snap({ companyId: COMPANY_ID, returnDate: '2026-06-01' });
  const sh = j.shareholders;
  const byName = Object.fromEntries(sh.map(s => [s.nameEnglish, s.shares]));
  chk('p_s1 还原出让前 1000（当前 900 + 截止日后卖 100）', byName['Share A'] === 1000, JSON.stringify(byName));
  chk('截止日后买家 p_s2 剔除', !('Share B' in byName));
  chk('截止日后获配 p_s3 剔除', !('Share Allot C' in byName));
  chk('p_s4 还原转出前 500（当前 0 + 500）', byName['Share Sold D'] === 500, JSON.stringify(byName));
  chk('p_s5 两股类各一条（300 Ordinary + 200 Preference）', sh.filter(s => s.nameEnglish === 'Multi Row E').length === 2);
  const s5 = sh.filter(s => s.nameEnglish === 'Multi Row E');
  chk('p_s5 股数正确', s5.some(s => s.shareType.includes('Ordinary') && s.shares === 300) && s5.some(s => s.shareType.includes('Preference') && s.shares === 200));
  chk('截止日前已全数辞任股东 p_s6 剔除', !('Share Ceased Early' in byName), JSON.stringify(byName));
  chk('股東 id 為 person UUID（非 role 行 id）', sh.every(s => s.id.startsWith('p_')), JSON.stringify(sh.map(s => s.id)));
  chk('as-of 股数不含截止日前交易 t4 影响（p_s1 仍 1000）', byName['Share A'] === 1000);
}

// ═══ C. 变动窗口 ═══
console.log('\n=== C. 变动窗口 ===');
{
  const { j } = await snap({ companyId: COMPANY_ID, returnDate: '2026-06-01' });
  chk('period = 2025-06-01 → 2026-06-01', j.period.start === '2025-06-01' && j.period.end === '2026-06-01', JSON.stringify(j.period));
  const ids = j.changes.map(e => e.id);
  chk('含 returnDate 当天 e1', ids.includes('e1'));
  chk('含 periodStart 当天 e2', ids.includes('e2'));
  chk('排除窗口前 e3', !ids.includes('e3'));
  chk('排除窗口后 e4', !ids.includes('e4'));
  chk('含 DDMMYYYY e5', ids.includes('e5'));
  chk('排除不可解析 e6', !ids.includes('e6'));
  chk('日期倒序（首为 e1 2026-06-01，次 e5 2026-03-15）', ids[0] === 'e1' && ids[1] === 'e5', ids.join(','));
  chk('公司信息为最新值', j.company.name === 'TestCo Ltd' && j.company.regFlat === 'FLAT 1');
}

// ═══ D. 闰年 clamp ═══
console.log('\n=== D. 2/29 clamp ===');
{
  const { j } = await snap({ companyId: COMPANY_ID, returnDate: '2024-02-29' });
  chk('2024-02-29 → period.start = 2023-02-28', j.period.start === '2023-02-28', j.period.start);
}

// ═══ E. 错误路径 ═══
console.log('\n=== E. 错误路径 ===');
{
  let r = await snap({ companyId: COMPANY_ID, returnDate: '2026-06-01' }, false);
  chk('无 token → 401', r.status === 401, String(r.status));
  r = await snap({ companyId: '', returnDate: '2026-06-01' });
  chk('缺 companyId → 400', r.status === 400);
  r = await snap({ companyId: COMPANY_ID, returnDate: '01/06/2026' });
  chk('returnDate 非 YYYY-MM-DD → 400', r.status === 400);
}

// mock 无匹配公司 → 404
{
  const env = makeEnv();
  env.DB.prepare = (sql) => ({
    bind: () => ({
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  });
  const resp = await onRequest({
    request: new Request('http://localhost/api/nar1-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ companyId: 'nope', returnDate: '2026-06-01' }) }),
    env });
  chk('未知公司 → 404', resp.status === 404, String(resp.status));
}

console.log(`\nTOTAL: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
