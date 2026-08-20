// 本地跑真实 generate-rom-docx 端点 + dawda 真实数据，解开 DOCX 断言每格文字。
// 不用部署就能验证：股东时序、证书编号、转让行日期、结余回推。
import { build } from 'esbuild';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// ── 打包端点 ──
const out = await build({
  entryPoints: [join(root, 'functions/api/generate-rom-docx.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node', target: 'node18',
});
const { onRequest } = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

// ── dawda 生产真实数据（顺序照抄 API 返回的乱序，用来验排序）──
const persons = [
  { id: 'chan', name_english: 'Chan Ho Yin', name_chinese: '', occupation: '',
    addr_flat: 'FLAT A', addr_building: 'TEST TOWER', addr_street: '1 QUEEN ROAD',
    addr_district: 'CENTRAL', addr_region: 'HONG KONG' },
  { id: 'zhao', name_english: 'Zhao Tong', name_chinese: '', occupation: '',
    addr_street: '2 NATHAN ROAD', addr_district: 'KOWLOON', addr_region: 'HONG KONG' },
  { id: 'peak', name_english: 'PEAK CONNECT INTERNATIONAL LIMITED', name_chinese: '', occupation: '',
    addr_street: '3 HARBOUR ROAD', addr_district: 'WAN CHAI', addr_region: 'HONG KONG' },
  { id: 'shea', name_english: 'Shea Kam Fai', name_chinese: '', occupation: '',
    addr_street: '4 DES VOEUX ROAD', addr_district: 'SHEUNG WAN', addr_region: 'HONG KONG' },
];
const roles = [
  { id: 'r1', person_id: 'chan', role: 'shareholder', date_appointed: '2026-08-16',
    date_ceased: '', shares: 100,  certificate_number: '', currency: 'HKD', issue_price: '1.00',
    created_at: '2026-08-17 06:18:22' },
  { id: 'r2', person_id: 'zhao', role: 'shareholder', date_appointed: '2026-06-30',
    date_ceased: '', shares: 2000, certificate_number: '', currency: 'HKD', issue_price: '1.00',
    created_at: '2026-08-11 05:51:20' },
  { id: 'r3', person_id: 'peak', role: 'shareholder', date_appointed: '2026-07-05',
    date_ceased: '', shares: 1800, certificate_number: '', currency: 'HKD', issue_price: '',
    created_at: '2026-08-11 05:51:20' },
  { id: 'r4', person_id: 'shea', role: 'shareholder', date_appointed: '16/06/2026',
    date_ceased: '', shares: 900,  certificate_number: '', currency: 'HKD', issue_price: '2.00',
    created_at: '2026-08-11 05:51:09' },
];
const txs = [
  { id: 'df412827', transaction_date: '2026-08-16', transaction_type: 'transfer',
    from_name: 'Shea Kam Fai', to_name: 'Chan Ho Yin', shares: 100, currency: 'HKD',
    // 转让价应取转出方单价 2.00，忽略交易表里的 4.50（用户规则）
    price_per_share: '4.50', total_consideration: '450.00', instrument_number: '',
    created_at: '2026-08-16 14:29:01' },
];
const company = { id: 'c1', name: 'dawda HK Limited', chinese_name: '', company_number: '12112121' };

const env = {
  JWT_SECRET: 'test',
  DB: {
    prepare: (sql) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      return { bind: () => ({
        first: async () => s.startsWith('SELECT * FROM companies') ? company : null,
        all: async () => {
          if (s.startsWith('SELECT * FROM person_company_roles')) return { results: roles };
          if (s.startsWith('SELECT * FROM share_transactions')) return { results: txs };
          if (s.startsWith('SELECT * FROM persons')) return { results: persons };
          return { results: [] };
        },
      })};
    },
  },
};

const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const h = b64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
const p = b64url(JSON.stringify({ sub:'x', email:'admin@localhost', role:'admin',
                                  exp: Math.floor(Date.now()/1000)+3600 }));
const token = `${h}.${p}.${b64url(crypto.createHmac('sha256','test').update(`${h}.${p}`).digest())}`;

const resp = await onRequest({
  request: new Request('http://localhost/api/generate-rom-docx', {
    method: 'POST', headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
    body: JSON.stringify({ companyId: 'c1' }) }),
  env });
const body = await resp.json();
if (!body.docx) { console.log('ERROR', JSON.stringify(body).slice(0,500)); process.exit(1); }
const zip = Buffer.from(body.docx, 'base64');
writeFileSync(join(here, 'rom_docx_local.docx'), zip);

// ── 读 STORED zip 里的 word/document.xml ──
function readStored(buf, want) {
  let off = 0;
  while (off < buf.length - 4) {
    if (buf.readUInt32LE(off) !== 0x04034b50) { off++; continue; }
    const method = buf.readUInt16LE(off + 8);
    const size = buf.readUInt32LE(off + 18);
    const nLen = buf.readUInt16LE(off + 26), eLen = buf.readUInt16LE(off + 28);
    const name = buf.slice(off + 30, off + 30 + nLen).toString('utf8');
    const dataStart = off + 30 + nLen + eLen;
    if (name === want) {
      if (method !== 0) throw new Error('entry is compressed, expected STORED');
      return buf.slice(dataStart, dataStart + size).toString('utf8');
    }
    off = dataStart + size;
  }
  throw new Error('entry not found: ' + want);
}
const xml = readStored(zip, 'word/document.xml');

// ── 解析成 行 × 格 文本 ──
const rows = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(m =>
  [...m[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(c =>
    [...c[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map(t => t[1]).join('')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
      .trim()));

console.log('rows:', rows.length);
const HDR = ['Date','Cert','From','To','Shares','Consid','Deed','Cert2','From2','To2','Shares2','Consid2','Total','Remarks','By'];
// 交易行 = 15 格
const txRows = rows.filter(r => r.length === 15);
// 姓名行：含股东名字的行
const nameRows = rows.filter(r => r.some(c => /Shea|Zhao|PEAK|Chan/i.test(c)));

console.log('\n=== 股东出场顺序 ===');
const order = [];
for (const r of nameRows) {
  const n = r.find(c => /Shea|Zhao|PEAK|Chan/i.test(c));
  if (n && !order.includes(n)) order.push(n);
}
order.forEach((n, i) => console.log(`  ${i+1}. ${n}`));

console.log('\n=== 非空交易行 ===');
const nonEmpty = txRows.filter(r => r.some(c => c !== ''));
for (const r of nonEmpty) {
  console.log('  ' + HDR.map((h, i) => r[i] ? `${h}=${r[i]}` : null).filter(Boolean).join(' | '));
}

// ── 断言 ──
let pass = 0, fail = 0;
const chk = (name, cond, detail='') => {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}  ${detail}`); fail++; }
};
console.log('\n=== 断言 ===');
chk('股东按成立时序 Shea,Zhao,PEAK,Chan',
    order.join('|').includes('Shea') && order[0].includes('Shea') &&
    order[1].includes('Zhao') && order[2].includes('PEAK') && order[3].includes('Chan'),
    'got=' + order.join(','));

const shea0 = nonEmpty.find(r => r[13] === 'Subscription' && r[4] === '1000');
chk('Shea 认购行回推成 1000 股（不是当前结余 900）', !!shea0,
    'got subs rows=' + JSON.stringify(nonEmpty.filter(r=>r[13]==='Subscription').map(r=>r[4])));
chk('Shea 认购行编号=1', !!shea0 && shea0[1] === '1', 'got=' + (shea0 && shea0[1]));

const out_ = nonEmpty.find(r => r[13] === 'Transfer Out');
chk('转让行存在', !!out_);
chk('转让行有日期 16/08/2026', !!out_ && out_[0] === '16/08/2026', 'got=' + (out_ && JSON.stringify(out_[0])));
chk('转让行编号=4（受让人的号）', !!out_ && out_[7] === '4', 'got=' + (out_ && out_[7]));
chk('转让行股数=100', !!out_ && out_[10] === '100', 'got=' + (out_ && out_[10]));
chk('转让后结余=900（不是 800）', !!out_ && out_[12] === '900', 'got=' + (out_ && out_[12]));

const in_ = nonEmpty.find(r => r[13] === 'Transfer In');
chk('Chan 有 Transfer In 行（不再误记成 Subscription）', !!in_);
chk('Transfer In 编号=4', !!in_ && in_[1] === '4', 'got=' + (in_ && in_[1]));
chk('Transfer In 日期 16/08/2026', !!in_ && in_[0] === '16/08/2026', 'got=' + (in_ && in_[0]));
chk('Transfer In 结余=100', !!in_ && in_[12] === '100', 'got=' + (in_ && in_[12]));

const zhao = nonEmpty.find(r => r[4] === '2000');
const peak = nonEmpty.find(r => r[4] === '1800');
chk('Zhao 编号=2', !!zhao && zhao[1] === '2', 'got=' + (zhao && zhao[1]));
chk('PEAK 编号=3', !!peak && peak[1] === '3', 'got=' + (peak && peak[1]));
chk('全表再无 "-" 编号', !nonEmpty.some(r => r[1] === '-' || r[7] === '-'));

// ── 新规则断言（2026-08-20）：Distinctive Nos 区间 + 默认全额缴费 + 转让价=转出方单价 ──
// 预期时间线：Shea Sub(16/06) [0,1000] → Zhao Sub(30/06) [1001,3001] → PEAK Sub(05/07) [3002,4802]
// → 转让 16/08 Shea→Chan 100：FIFO 划出 [0,100]，Chan In 同段，Shea 剩 [101,1000]
chk('Shea 认购 From=0 To=1000', !!shea0 && shea0[2] === '0' && shea0[3] === '1000',
    'got=' + (shea0 && `${shea0[2]}~${shea0[3]}`));
chk('Shea 认购 Consid=HKD 2000.00（1000×单价2）', !!shea0 && shea0[5] === 'HKD 2000.00',
    'got=' + (shea0 && shea0[5]));
chk('Zhao 认购 From=1001 To=3001', !!zhao && zhao[2] === '1001' && zhao[3] === '3001',
    'got=' + (zhao && `${zhao[2]}~${zhao[3]}`));
chk('Zhao 认购 Consid=HKD 2000.00（2000×单价1）', !!zhao && zhao[5] === 'HKD 2000.00',
    'got=' + (zhao && zhao[5]));
chk('PEAK 认购 From=3002 To=4802', !!peak && peak[2] === '3002' && peak[3] === '4802',
    'got=' + (peak && `${peak[2]}~${peak[3]}`));
chk('PEAK 无价默认 HKD 1 全额 = HKD 1800.00', !!peak && peak[5] === 'HKD 1800.00',
    'got=' + (peak && peak[5]));
chk('转让行 From2=0 To2=100（FIFO 划出）', !!out_ && out_[8] === '0' && out_[9] === '100',
    'got=' + (out_ && `${out_[8]}~${out_[9]}`));
chk('转让行 Consid2=HKD 200.00（转出方单价2×100，忽略 tx 4.50）',
    !!out_ && out_[11] === 'HKD 200.00', 'got=' + (out_ && out_[11]));
chk('Transfer In From=0 To=100（与转出同段，编号跟股份走）',
    !!in_ && in_[2] === '0' && in_[3] === '100', 'got=' + (in_ && `${in_[2]}~${in_[3]}`));
chk('Transfer In Consid=HKD 200.00（同笔价值）', !!in_ && in_[5] === 'HKD 200.00',
    'got=' + (in_ && in_[5]));

// ── 字体断言（2026-08-19）：填入值 run 必须带 run 级 rPr（Arial 小五 sz=18）──
// 旧 bug：模板转让半边占位 run 只有段落级 rPr，Word 不回退到 run → Times New Roman 小四
const VALUE_RE = /^(HKD \d+\.\d{2}|\d{1,6}(\.\d{2})?|-)$/;
const bareRuns = [];
for (const m of xml.matchAll(/<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g)) {
  const run = m[0];
  if (run.includes('<w:rPr')) continue;
  const texts = [...run.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t => t[1]);
  for (const t of texts) if (VALUE_RE.test(t.trim())) bareRuns.push(t.trim());
}
chk('所有纯数字/HKD 填入值 run 都带 rPr（旧 bug 会有 4,4,4,100,HKD 100.00 共 5 个裸 run）',
    bareRuns.length === 0, 'bare=' + JSON.stringify(bareRuns));
const rprFonts = [...xml.matchAll(/<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="PMingLiU"[\s\S]*?<\/w:rPr>/g)];
chk('注入的 rPr 用的是 Arial+PMingLiU', rprFonts.length > 0, 'count=' + rprFonts.length);
const rpr18 = [...xml.matchAll(/<w:rPr><w:rFonts[^>]*\/>\s*<w:sz w:val="18"\/>/g)];
chk('注入的 rPr sz=18（小五）', rpr18.length > 0, 'count=' + rpr18.length);

console.log(`\nTOTAL: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
