// 本地跑真实 generate-nn3-pdf 端点：esbuild 打包 + mock R2（读本地模板）+ HMAC JWT。
// 输出 PDF 到 _nn3_out/，由 _nn3_assert.py 做 pymupdf 逐 widget 值断言。
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import fs from 'fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, '_nn3_out');
fs.mkdirSync(outDir, { recursive: true });

const out = await build({
  entryPoints: [join(root, 'functions/api/generate-nn3-pdf.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node', target: 'node18',
});
const { onRequest } = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const templateBytes = fs.readFileSync(join(root, 'public/templates/NN3-template.pdf'));
const templateBuf = templateBytes.buffer.slice(
  templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength);

function makeEnv() {
  const prepare = (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      bind: () => ({
        first: async () => null,
        all: async () => {
          if (s.startsWith('SELECT role FROM user_roles')) return { results: [] };
          return { results: [] };
        },
      }),
    };
  };
  return {
    JWT_SECRET: 'test',
    DB: { prepare },
    PDF_TEMPLATES: {
      get: async (key) => {
        if (key === 'NN3-template.pdf') return { arrayBuffer: async () => templateBuf };
        return null;
      },
    },
  };
}

const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const p = b64url(JSON.stringify({ sub: 'x', email: 'admin@localhost', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }));
const token = `${h}.${p}.${b64url(crypto.createHmac('sha256', 'test').update(`${h}.${p}`).digest())}`;

async function gen(name, body, withAuth = true) {
  const resp = await onRequest({
    request: new Request('http://localhost/api/generate-nn3-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(withAuth ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body) }),
    env: makeEnv() });
  const j = await resp.json();
  if (resp.status === 200 && j.pdf) {
    fs.writeFileSync(join(outDir, `${name}.pdf`), Buffer.from(j.pdf, 'base64'));
  }
  return { status: resp.status, j };
}

// ═══ 人员/基础数据 ═══
const BASE = {
  brNumber: 'F0012345',
  companyNameEnglish: 'APEX GLOBAL TRADING LIMITED',
  companyNameChinese: '頂峰環球貿易有限公司',
  returnDate: '2026-06-01',
  registrationDate: '2021-06-01',
  placeOfIncorporation: 'British Virgin Islands',
  principalPlaceOfBusiness: { flat: 'Flat 7', building: 'Wing On Centre', street: '111 Connaught Road Central', districtCityProvince: 'Hong Kong', region: 'Hong Kong' },
  email: 'info@apex.com',
  phone: '2521 3888',
  officeInPlaceOfIncorporation: { flat: 'Room 1', building: 'BVI House', street: 'Main Street', districtCityProvince: 'Road Town', country: 'British Virgin Islands' },
  emailInPlaceOfIncorporation: 'bvi@apex.com',
  presenter: { name: 'Twinsail Consultants Limited', address: 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong', phone: '+852 2521 3888', fax: '+852 2521 3999', email: 'info@twinsail.com', reference: 'TS-2026-001' },
};

const NAT_DIR1 = { identity: 'natural', nameEnglish: 'Chan Tai Man, David', nameChinese: '陳大文', email: 'david@x.com', address: 'Flat 1, Block A, Main Street, Central, Hong Kong', idNumber: 'A123456(7)' };
const NAT_DIR2 = { identity: 'natural', nameEnglish: 'Wong Siu Mei', nameChinese: '黃小美', address: 'Flat 2, Block B, Queens Road, Wan Chai, Hong Kong', idNumber: 'B234567(8)' };
const NAT_DIR3 = { identity: 'natural', nameEnglish: 'Lee Ka Ho', nameChinese: '李嘉豪', address: 'Flat 3, Block C, Nathan Road, Mong Kok, Hong Kong', idNumber: 'C345678(9)' };
const ALT_DIR = { identity: 'natural', nameEnglish: 'Ng Man Fai', nameChinese: '吳文輝', isAlternate: true, alternateTo: 'Chan Tai Man, David', address: 'Flat 9, Block D, Tai Po Road, Tai Po, Hong Kong' };
const CORP_DIR1 = { identity: 'corporate', nameEnglish: 'GLOBAL HOLDINGS LIMITED', nameChinese: '環球控股有限公司', brNumber: 'BR1234567', address: 'Room 1, Tower A, Harbour Road, Wan Chai, Hong Kong', email: 'corp@x.com' };
const CORP_DIR2 = { identity: 'corporate', nameEnglish: 'SINO INVEST LIMITED', nameChinese: '華投有限公司', brNumber: 'BR7654321', address: 'Room 2, Tower B, Harbour Road, Wan Chai, Hong Kong' };
const CORP_DIR3 = { identity: 'corporate', nameEnglish: 'MEGA CAPITAL LIMITED', nameChinese: '巨資有限公司', brNumber: 'BR9999999', address: 'Room 3, Tower C, Harbour Road, Wan Chai, Hong Kong' };
const NAT_SEC1 = { identity: 'natural', nameEnglish: 'Lam Mei Ling', nameChinese: '林美玲', email: 'lam@x.com', address: 'Flat 5, Block E, Electric Road, North Point, Hong Kong', idNumber: 'D456789(0)' };
const NAT_SEC2 = { identity: 'natural', nameEnglish: 'Ho Ka Wai', nameChinese: '何家慧', address: 'Flat 6, Block F, Java Road, North Point, Hong Kong' };
const CORP_SEC1 = { identity: 'corporate', nameEnglish: 'TWINSAIL CONSULTANTS LIMITED', nameChinese: '雙帆顧問有限公司', brNumber: 'BR5566778', address: 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong', email: 'sec@twinsail.com' };
const NAT_REP1 = { identity: 'natural', nameEnglish: 'Cheung Kwok Wing', nameChinese: '張國榮', address: 'Flat 8, Block G, Lockhart Road, Wan Chai, Hong Kong', idNumber: 'E567890(1)', email: 'rep@x.com' };
const NAT_REP2 = { identity: 'natural', nameEnglish: 'Ip Man', nameChinese: '葉問', address: 'Flat 9, Block H, Hennessy Road, Wan Chai, Hong Kong' };
const CORP_REP1 = { identity: 'corporate', nameEnglish: 'LEGAL ADVISORS LLP', nameChinese: '法律顧問行', isLawFirm: true, address: 'Room 10, Tower D, Queensway, Central, Hong Kong', email: 'law@x.com' };

const SIGNER = { name: 'Chan Tai Man, David', capacity: 'director' };
const SC = { shareCapital: { authorizedCurrency: 'HKD', authorizedNominal: '100,000', issuedCurrency: 'HKD', issuedNominal: '50,000' }, mortgageAmount: '20,000' };
const ACC_A = { accounts: { mode: 'delivered', periodFrom: '2025-06-02', periodTo: '2026-06-01' } };

const scenarios = [
  // [name, payload, expectedPages]
  ['s01_basic', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], ...ACC_A, ...SC, signer: SIGNER }, 7],
  ['s02_rep_corp', { ...BASE, authorizedReps: [NAT_REP1, CORP_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: SIGNER }, 7],
  ['s03_rep_3', { ...BASE, authorizedReps: [NAT_REP1, NAT_REP2, CORP_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: SIGNER }, 8],
  ['s04_sec_3', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1, NAT_SEC2, CORP_SEC1], directors: [NAT_DIR1], signer: SIGNER }, 8],
  ['s05_dirs_0', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [], signer: SIGNER }, 7],
  ['s06_dirs_1', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: SIGNER }, 7],
  ['s07_dirs_2', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1, NAT_DIR2], signer: SIGNER }, 8],
  ['s08_dirs_3', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1, NAT_DIR2, NAT_DIR3], signer: SIGNER }, 9],
  ['s09_alt_dir', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1, ALT_DIR], signer: SIGNER }, 8],
  ['s10_corpdirs_0', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: SIGNER }, 7],
  ['s11_corpdir_1', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1, NAT_DIR2, CORP_DIR1], signer: SIGNER }, 8],
  ['s12_corpdir_3', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1, NAT_DIR2, CORP_DIR1, CORP_DIR2, CORP_DIR3], signer: SIGNER }, 9],
  ['s13_accounts_a', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], accounts: { mode: 'delivered', periodFrom: '2025-06-02', periodTo: '2026-06-01' }, signer: SIGNER }, 7],
  ['s14_accounts_b', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], accounts: { mode: 'notDelivered', notDeliveredReason: 2 }, signer: SIGNER }, 7],
  ['s15_cjk', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: { name: '陳大文', capacity: 'director' } }, 7],
  ['s16_capital', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], ...SC, signer: SIGNER }, 7],
  ['s17_signer_director', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: { name: 'Chan Tai Man, David', capacity: 'director' } }, 7],
  ['s17_signer_secretary', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: { name: 'Lam Mei Ling', capacity: 'secretary' } }, 7],
  ['s17_signer_manager', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: { name: 'A Manager', capacity: 'manager' } }, 7],
  ['s17_signer_rep', { ...BASE, authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: { name: 'Cheung Kwok Wing', capacity: 'authorizedRep' } }, 7],
  ['s18_compute_returndate', { ...BASE, returnDate: undefined, registrationDate: '2021-06-01', authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: SIGNER }, 7],
  ['s18_future_anniversary', { ...BASE, returnDate: undefined, registrationDate: '2021-12-31', authorizedReps: [NAT_REP1], secretaries: [NAT_SEC1], directors: [NAT_DIR1], signer: SIGNER }, 7],
];

let pass = 0, fail = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}  ${detail}`); fail++; }
};

const expected = {};
for (const [name, payload, pages] of scenarios) {
  const { status, j } = await gen(name, payload);
  chk(`${name}: status 200`, status === 200, `got ${status} ${JSON.stringify(j)}`);
  const br8 = 'F0012345';
  chk(`${name}: filename`, status === 200 && j.filename === `NN3_${br8}.pdf`, JSON.stringify(j.filename));
  if (status === 200) {
    const buf = Buffer.from(j.pdf, 'base64');
    chk(`${name}: pdf header`, buf.slice(0, 5).toString() === '%PDF-', '');
    expected[name] = { pages };
  }
}
fs.writeFileSync(join(outDir, 'expectations.json'), JSON.stringify(expected, null, 2));

// ═══ 400 校驗 ═══
const badCases = [
  ['v1_no_dates', { ...BASE, returnDate: undefined, registrationDate: undefined }, 'returnDate or registrationDate required'],
  ['v2_bad_return', { ...BASE, returnDate: '01-06-2026' }, 'returnDate must be YYYY-MM-DD'],
  ['v3_bad_reg', { ...BASE, returnDate: undefined, registrationDate: '2021/06/01' }, 'registrationDate must be YYYY-MM-DD'],
  ['v4_bad_mode', { ...BASE, accounts: { mode: 'wat' } }, "accounts.mode"],
  ['v5_bad_reason', { ...BASE, accounts: { mode: 'notDelivered', notDeliveredReason: 9 } }, 'notDeliveredReason'],
  ['v6_dirs_not_array', { ...BASE, directors: 'Chan' }, 'directors must be an array'],
  ['v7_no_auth', { ...BASE }, 'Not authenticated'],
];
for (const [name, payload, errContains] of badCases) {
  const { status, j } = await gen(name, payload, name !== 'v7_no_auth');
  chk(`${name}: status 400/401`, status === 400 || status === 401, `got ${status}`);
  if (j && j.error) chk(`${name}: error mentions "${errContains}"`, String(j.error).includes(errContains), JSON.stringify(j.error));
}

console.log(`\nTOTAL: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
