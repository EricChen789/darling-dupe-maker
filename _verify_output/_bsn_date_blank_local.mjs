// 本地跑真实 generate-share-transfer-rtf 端点：買賣票據日期不預填（留空由用家自填），
// 轉讓文書（模板本来无日期占位符）与股票證書（SIGN_DATE）不受影响。
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import crypto from 'crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const out = await build({
  entryPoints: [join(root, 'functions/api/generate-share-transfer-rtf.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node', target: 'node18',
});
const { onRequest } = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const company = {
  id: 'c1', name: 'TestCo Ltd', company_number: '99999999',
  incorporation_date: '2026-01-15',
};
const seller = {
  id: 'p-seller', name_english: 'Chan Tai Man', id_number: 'A123456(7)',
  addr_flat: 'FLAT 1', addr_building: 'BLOCK A', addr_street: 'MAIN ST',
  addr_district: 'CENTRAL', addr_region: 'HONG KONG',
};
const buyer = {
  id: 'p-buyer', name_english: 'Wong Siu Ming', id_number: 'B987654(3)',
  addr_flat: 'ROOM 2', addr_building: 'TOWER B', addr_street: '2ND ST',
  addr_district: 'WAN CHAI', addr_region: 'HONG KONG',
};

const templates = {
  'bought-sold-note-template.rtf': readFileSync(join(root, 'bought-sold-note-template.rtf'), 'utf8'),
  'instrument-of-transfer-template.rtf': readFileSync(join(root, 'instrument-of-transfer-template.rtf'), 'utf8'),
  'share-certificate-template.rtf': readFileSync(join(root, 'share-certificate-template.rtf'), 'utf8'),
};

function makeEnv() {
  const db = {
    prepare: (sql) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      return {
        bind: (...args) => ({
          first: async () => {
            if (s.startsWith('SELECT * FROM companies')) return company;
            if (s.startsWith('SELECT * FROM persons')) {
              const id = String(args[0]);
              if (id === seller.id) return seller;
              if (id === buyer.id) return buyer;
              return null;
            }
            return null;
          },
          all: async () => {
            if (s.startsWith('SELECT id FROM share_transactions')) return { results: [{ id: 'tx1' }] };
            if (s.startsWith('SELECT person_id, date_appointed')) {
              // 股票證書 certNo 查詢：買方已成為股東（date_appointed 2026-08-01）
              return {
                results: [{ person_id: buyer.id, date_appointed: '2026-08-01', created_at: '2026-08-01 09:00:00', certificate_number: null }],
              };
            }
            return { results: [] };
          },
        }),
      };
    },
  };
  return {
    JWT_SECRET: 'test',
    DB: db,
    PDF_TEMPLATES: {
      get: (key) => {
        if (!(key in templates)) throw new Error('missing template ' + key);
        return { text: async () => templates[key] };
      },
    },
  };
}

const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const p = b64url(JSON.stringify({ sub: 'x', email: 'admin@localhost', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }));
const token = `${h}.${p}.${b64url(crypto.createHmac('sha256', 'test').update(`${h}.${p}`).digest())}`;

async function gen(body) {
  const resp = await onRequest({
    request: new Request('http://localhost/api/generate-share-transfer-rtf', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body) }),
    env: makeEnv() });
  const j = await resp.json();
  if (!j.rtf) throw new Error('no rtf: ' + JSON.stringify(j).slice(0, 300));
  return Buffer.from(j.rtf, 'base64').toString('utf8');
}

const txData = {
  from_person_id: seller.id, from_name: seller.name_english,
  to_person_id: buyer.id, to_name: buyer.name_english,
  shares: 100, share_type: 'Ordinary', price_per_share: '10.00',
  total_consideration: '1000.00',
  transaction_date: '15/08/2026',
  instrument_number: '2', currency: 'HKD',
};

let pass = 0, fail = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}  ${detail}`); fail++; }
};

// ── A. 買賣票據：日期留空 ──
console.log('=== A. bought_sold_note：日期不預填 ===');
{
  const rtf = await gen({ companyId: 'c1', documentType: 'bought_sold_note', transaction: txData });
  chk('无 {{TX_DATE}} 占位符残留', !rtf.includes('{{TX_DATE}}'));
  chk('全文无未填充占位符 {{', !rtf.includes('{{'));
  chk('日期未填入（Dated 后直接 \\par）', rtf.includes('Dated \r\n\\par'), 'expected "Dated \\r\\n\\\\par"');
  chk('没有预填日期 15/08/2026', !rtf.includes('Dated 15/08/2026'));
  chk('两处 Dated 均为空', (rtf.match(/Dated \r\n\\par/g) || []).length === 2, 'count=' + (rtf.match(/Dated \r\n\\par/g) || []).length);
  chk('卖方姓名已填', rtf.includes('Chan Tai Man'));
  chk('买方姓名已填', rtf.includes('Wong Siu Ming'));
  chk('股数已填', rtf.includes('100'));
}

// ── B. 轉讓文書：模板本无日期占位符，不受影响 ──
console.log('\n=== B. instrument_of_transfer：无日期占位符 ===');
{
  const rtf = await gen({ companyId: 'c1', documentType: 'instrument_of_transfer', transaction: txData });
  chk('全文无未填充占位符 {{', !rtf.includes('{{'));
  chk('卖方姓名已填', rtf.includes('Chan Tai Man'));
  chk('代价已填 HK$1,000.00', rtf.includes('HK$1,000.00'));
}

// ── C. 股票證書：SIGN_DATE 仍填 ──
console.log('\n=== C. share_certificate：日期不受影响 ===');
{
  const rtf = await gen({ companyId: 'c1', documentType: 'share_certificate', transaction: txData });
  chk('全文无未填充占位符 {{', !rtf.includes('{{'));
  chk('SIGN_DATE 仍填 15/08/2026', rtf.includes('on 15/08/2026'));
  chk('INCORP_DATE 已填 15/01/2026', rtf.includes('15/01/2026'));
  chk('持有人姓名已填', rtf.includes('Wong Siu Ming'));
}

// ── D. 買賣票據：交易日期为空也不炸 ──
console.log('\n=== D. bought_sold_note + 空日期 ===');
{
  const rtf = await gen({
    companyId: 'c1', documentType: 'bought_sold_note',
    transaction: { ...txData, transaction_date: '' },
  });
  chk('空日期生成成功且无占位符', rtf.includes('Dated \r\n\\par') && !rtf.includes('{{'));
}

console.log(`\nTOTAL: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
