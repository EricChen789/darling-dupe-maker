#!/usr/bin/env node
/**
 * 测试云端 NAR1 PDF 生成 — 通过 wrangler dev + 自签 JWT
 *
 * 用法:
 *   1. 先启动 wrangler dev: npx wrangler pages dev dist --port 8787
 *   2. 再运行本脚本: node _test_cloud_nar1.mjs [standard|multi|corpdir]
 *
 * 依赖: wrangler dev 在 http://127.0.0.1:8787 运行
 */

import { createHmac } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Read JWT secret from .dev.vars ──
function readJwtSecret() {
  const varsPath = resolve(__dirname, '.dev.vars');
  const content = readFileSync(varsPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('JWT_SECRET=')) {
      return trimmed.split('=')[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  throw new Error('JWT_SECRET not found in .dev.vars');
}

// ── Generate JWT token ──
function generateJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerEnc = enc(header);
  const payloadEnc = enc(payload);
  const signature = createHmac('sha256', secret)
    .update(`${headerEnc}.${payloadEnc}`)
    .digest('base64url');
  return `${headerEnc}.${payloadEnc}.${signature}`;
}

// ── Test Data (same 3 scenarios) ──
const office = {
  flat: 'Room 1501', building: 'Tower A, Regent Centre',
  street: '63 Wo Yi Hop Road', district: 'Kwai Chung', region: 'New Territories',
};

const testPresenter = {
  name: 'CHAN TAI MAN',
  address: 'Room 1501, Tower A, Regent Centre, 63 Wo Yi Hop Road, Kwai Chung, N.T.',
  phone: '21234567', fax: '21234568', email: 'info@test.com', reference: 'REF-2026-001',
};

function natSec(name, eng, email, hkid) {
  return { nameChinese: name, nameEnglish: eng, email, identity: 'natural',
    idNumber: hkid, address: 'Room 101, Block 1, City One, Shatin, N.T.' };
}
function corpSec(name, eng, brn, tcsp) {
  return { nameChinese: name, nameEnglish: eng, identity: 'corporate',
    email: 'corpsec@test.com', brNumber: brn, tcspNumber: tcsp,
    address: "Room 301, Tower B, 10 Queen's Road Central, Hong Kong" };
}
function natDir(name, eng, email, hkid) {
  return { nameChinese: name, nameEnglish: eng, email, identity: 'natural',
    idNumber: hkid, address: 'Flat A, 5/F, Block 2, Taikoo Shing, Hong Kong' };
}
function corpDir(name, eng, brn) {
  return { nameChinese: name, nameEnglish: eng, identity: 'corporate',
    email: 'corpdir@test.com', brNumber: brn,
    address: 'Suite 2001, Two IFC, 8 Finance Street, Central, Hong Kong' };
}
function shareholder(name, eng, shares) {
  return { name, nameEnglish: eng, nameChinese: '', shares, shareType: 'ORDINARY',
    currency: 'HKD', identity: 'natural',
    address: 'Flat 1, 3/F, Block A, Mei Foo Sun Chuen, Kowloon' };
}

const scenarios = {
  standard: {
    name: 'PAUL TANG AND COMPANY LIMITED', chineseName: '保羅鄧氏有限公司',
    brNumber: '07281051', tradingName: 'Paul Tang & Co',
    businessNature: 'Secretarial Services', businessCode: '82110',
    companyType: '私人公司 Private company',
    companyEmail: 'info@paultang.com', companyPhone: '21234567',
    registeredOffice: office, presenter: testPresenter,
    signer: { name: 'CHAN TAI MAN', role: 'director' },
    directors: [natDir('陳大明', 'CHAN TAI MAN', 'chan@paultang.com', 'A123456(7)')],
    secretaries: [natSec('鄧小芬', 'TANG SIU FAN', 'tang@paultang.com', 'B234567(8)')],
    shareholders: [
      shareholder('CHAN TAI MAN', 'CHAN TAI MAN', 5000),
      shareholder('TANG SIU FAN', 'TANG SIU FAN', 5000),
    ],
  },
  multi: {
    name: 'BIG CORP HOLDINGS LIMITED', chineseName: '大集團控股有限公司',
    brNumber: '12345678', tradingName: 'Big Corp',
    businessNature: 'Investment Holding', businessCode: '64200',
    companyType: '私人公司 Private company',
    companyEmail: 'info@bigcorp.com', companyPhone: '29876543',
    registeredOffice: office, presenter: testPresenter,
    signer: { name: 'WONG SIU MING', role: 'secretary' },
    directors: [
      natDir('黃小明', 'WONG SIU MING', 'wong@bigcorp.com', 'C345678(9)'),
      natDir('李小華', 'LEE SIU WA', 'lee@bigcorp.com', 'D456789(0)'),
      natDir('張大偉', 'CHEUNG TAI WAI', 'cheung@bigcorp.com', 'E567890(1)'),
    ],
    secretaries: [
      corpSec('秘書有限公司', 'SECRETARY LTD', 'BR12345678', 'TCSP00123'),
      natSec('何小玲', 'HO SIU LING', 'ho@bigcorp.com', 'F678901(2)'),
    ],
    shareholders: [
      shareholder('WONG SIU MING', 'WONG SIU MING', 10000),
      shareholder('LEE SIU WA', 'LEE SIU WA', 8000),
      shareholder('CHEUNG TAI WAI', 'CHEUNG TAI WAI', 6000),
      shareholder('HO SIU LING', 'HO SIU LING', 4000),
      shareholder('LAM KA FAI', 'LAM KA FAI', 2000),
    ],
  },
  corpdir: {
    name: 'CORPORATE DIRECTORS LIMITED', chineseName: '法人董事有限公司',
    brNumber: '87654321', tradingName: 'CorpDir Co',
    businessNature: 'Corporate Services', businessCode: '82110',
    companyType: '私人公司 Private company',
    companyEmail: 'info@corpdir.com', companyPhone: '25432109',
    registeredOffice: office, presenter: testPresenter,
    signer: { name: 'LAM SIU LING', role: 'director' },
    directors: [
      corpDir('控股有限公司', 'HOLDING CORP LTD', 'BR98765432'),
      corpDir('投資有限公司', 'INVESTMENT CORP LTD', 'BR87654321'),
    ],
    secretaries: [natSec('林小玲', 'LAM SIU LING', 'lam@corpdir.com', 'G789012(3)')],
    shareholders: [
      shareholder('HOLDING CORP LTD', 'HOLDING CORP LTD', 7500),
      shareholder('INVESTMENT CORP LTD', 'INVESTMENT CORP LTD', 2500),
    ],
  },
};

// ── Main ──
async function main() {
  const scenarioName = process.argv[2] || 'standard';
  const data = scenarios[scenarioName];
  if (!data) {
    console.error(`Unknown scenario: ${scenarioName}. Use: standard | multi | corpdir`);
    process.exit(1);
  }

  // Generate JWT
  const secret = readJwtSecret();
  const token = generateJWT({
    sub: 'admin@localhost',
    email: 'admin@localhost',
    display_name: 'Admin',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, secret);

  console.log(`Testing scenario: ${scenarioName}`);
  console.log(`  JWT token: ${token.slice(0, 30)}...`);
  console.log(`  Company: ${data.name}`);
  console.log(`  Directors: ${data.directors.length}, Secretaries: ${data.secretaries.length}, Shareholders: ${data.shareholders.length}`);

  // Call the API
  const resp = await fetch('http://127.0.0.1:8787/api/generate-nar1-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  console.log(`  Status: ${resp.status} ${resp.statusText}`);

  if (resp.ok) {
    const result = await resp.json();
    if (result.pdf) {
      const outPath = resolve(__dirname, `_test_nar1_cloud_${scenarioName}.pdf`);
      writeFileSync(outPath, Buffer.from(result.pdf, 'base64'));
      console.log(`  PDF saved: ${outPath} (${(result.pdf.length * 0.75 / 1024).toFixed(1)} KB)`);
    } else {
      console.log('  Response:', JSON.stringify(result).slice(0, 200));
    }
  } else {
    const text = await resp.text();
    console.log(`  Error: ${text.slice(0, 300)}`);
  }
}

main().catch(console.error);
