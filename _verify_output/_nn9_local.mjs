// 本地跑真实 generate-nn9-pdf 端点：esbuild 打包 + mock R2（读本地模板）+ HMAC JWT。
// 输出 PDF 到 _nn9_out/，由 _nn9_assert.py 做 pymupdf 逐 widget 值断言。
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import fs from 'fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, '_nn9_out');
fs.mkdirSync(outDir, { recursive: true });

const out = await build({
  entryPoints: [join(root, 'functions/api/generate-nn9-pdf.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node', target: 'node18',
});
const { onRequest } = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const templateBytes = fs.readFileSync(join(root, 'public/templates/NN9-template.pdf'));
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
        if (key === 'NN9-template.pdf') return { arrayBuffer: async () => templateBuf };
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
    request: new Request('http://localhost/api/generate-nn9-pdf', {
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

// ═══ 基础数据 ═══
const BASE = {
  brNumber: '60535184',
  companyName: 'APEX GLOBAL TRADING LIMITED',
  signerName: 'Chan Tai Man, David',
  signerCapacity: 'director',
  signDateDay: '21', signDateMonth: '08', signDateYear: '2026',
  presentorName: 'Twinsail Consultants Limited',
  presentorAddress: 'Room 1203, 12/F, Wing On Centre, 111 Connaught Road Central, Hong Kong',
  presentorPhone: '+852 2521 3888',
  presentorFax: '+852 2521 3999',
  presentorEmail: 'info@twinsail.com',
  presentorReference: 'TS-2026-001',
};

// 全量：P.1 2(a)(b)(c) + P.2 3(a)(b)(c) + 簽署 director
const FULL = {
  flat: 'Flat 8', building: 'Block D', street: "Queen's Road", district: '中西區', region: 'Hong Kong',
  addressDay: '01', addressMonth: '08', addressYear: '2026',
  newEmail: 'hk@apex.com', emailDay: '02', emailMonth: '08', emailYear: '2026',
  newPhone: '+852 9123 4567', phoneDay: '03', phoneMonth: '08', phoneYear: '2026',
  regFlat: 'Room 501', regBuilding: 'Shinjuku Building', regStreet: '1-2-3 Nishi-Shinjuku', regDistrict: 'Shinjuku-ku', regCountry: 'Japan',
  regDay: '05', regMonth: '08', regYear: '2026',
  bizFlat: 'Floor 12', bizBuilding: 'Marunouchi Tower', bizStreet: '2-4-1 Marunouchi', bizDistrict: 'Chiyoda-ku', bizCountry: 'Japan',
  bizDay: '06', bizMonth: '08', bizYear: '2026',
  ovEmail: 'overseas@apex.com', ovDay: '07', ovMonth: '08', ovYear: '2026',
};

// 僅香港 2(a)
const HK_ONLY = {
  flat: 'Suite 2001', building: 'Wing On Centre', street: '111 Connaught Road', district: '中西區', region: 'Hong Kong',
  addressDay: '10', addressMonth: '08', addressYear: '2026',
};

// 僅成立地 3(a)+3(b)
const OVERS = {
  regFlat: 'Level 8', regBuilding: 'Ginza Plaza', regStreet: '5-6-7 Ginza', regDistrict: 'Chuo-ku', regCountry: 'Japan',
  regDay: '11', regMonth: '08', regYear: '2026',
  bizFlat: 'Unit 3', bizBuilding: 'Osaka Tower', bizStreet: '1-1 Umeda', bizDistrict: 'Kita-ku', bizCountry: 'Japan',
  bizDay: '12', bizMonth: '08', bizYear: '2026',
};

// 舊版字段兼容（newFlat/changeDay/resolutionDay/signDate 字串）
const LEGACY = {
  newFlat: 'Flat 8', newBuilding: 'Block D', newStreet: "Queen's Road", newDistrict: '中西區', newRegion: 'Hong Kong',
  changeDay: '01', changeMonth: '08', changeYear: '2026',
  newEmail: 'hk@apex.com', resolutionDay: '02', resolutionMonth: '08', resolutionYear: '2026',
  newPhone: '+852 9123 4567',
  signDate: '21/08/2026',
};

const scenarios = [
  // [name, payload, expectedPages]
  ['s01_full', { ...BASE, ...FULL }, 2],
  ['s02_hk_only', { ...BASE, ...HK_ONLY }, 2],
  ['s03_overseas_only', { ...BASE, ...OVERS }, 2],
  ['s04_cap_authorizedRep', { ...BASE, ...FULL, signerCapacity: 'authorizedRep' }, 2],
  ['s05_no_sig', { ...BASE, ...FULL, signerName: '', signerCapacity: '' }, 2],
  ['s06_legacy', { ...BASE, ...LEGACY, signDateDay: '', signDateMonth: '', signDateYear: '' }, 2],
  ['s07_debug', { ...BASE, ...FULL, debug: true }, 4],
];

let pass = 0, fail = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}  ${detail}`); fail++; }
};

const expected = {};
for (const [name, payload, pages] of scenarios) {
  const { status, j } = await gen(name, payload);
  chk(`${name}: status 200`, status === 200, `got ${status} ${JSON.stringify(j).slice(0, 300)}`);
  if (status === 200) {
    const buf = Buffer.from(j.pdf, 'base64');
    chk(`${name}: pdf header`, buf.slice(0, 5).toString() === '%PDF-', '');
    expected[name] = { pages };
  }
}
fs.writeFileSync(join(outDir, 'expectations.json'), JSON.stringify(expected, null, 2));

// ═══ 401 ═══
{
  const { status } = await gen('s08_no_auth', { ...BASE, ...FULL }, false);
  chk('s08_no_auth: status 401', status === 401, `got ${status}`);
}

console.log(`\nTOTAL: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
