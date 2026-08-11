#!/usr/bin/env tsx
/**
 * NAR1 云端代码本地测试 — 直接调用 buildNAR1Pdf
 *
 * 用法: npx tsx _test_nar1_cloud.ts [scenario]
 * scenario: standard | multi | corpdir (默认: standard)
 *
 * 输出: _test_nar1_cloud_{scenario}.pdf
 */

import * as fs from 'fs';
import * as path from 'path';

// Read the NAR1 template from local filesystem
const TEMPLATE_PATH = path.join(__dirname, 'public', 'templates', 'NAR1-template.pdf');
const templateBytes = fs.readFileSync(TEMPLATE_PATH);

// ── Mock Env ──
const mockEnv = {
  PDF_TEMPLATES: {
    get: async (key: string) => {
      if (key === 'NAR1-template.pdf') {
        return {
          arrayBuffer: async () => templateBytes.buffer.slice(
            templateBytes.byteOffset,
            templateBytes.byteOffset + templateBytes.byteLength
          ),
        };
      }
      return null;
    },
  },
  R2: {
    get: async (key: string) => {
      if (key === 'NAR1-template.pdf') {
        return {
          arrayBuffer: async () => templateBytes.buffer.slice(
            templateBytes.byteOffset,
            templateBytes.byteOffset + templateBytes.byteLength
          ),
        };
      }
      return null;
    },
  },
  DB: undefined,
  JWT_SECRET: 'test-secret',
};

// ── Test Data ──

// Common registered office
const office = {
  flat: 'Room 1501',
  building: 'Tower A, Regent Centre',
  street: '63 Wo Yi Hop Road',
  district: 'Kwai Chung',
  region: 'New Territories',
};

const testPresenter = {
  name: 'CHAN TAI MAN',
  address: 'Room 1501, Tower A, Regent Centre, 63 Wo Yi Hop Road, Kwai Chung, N.T.',
  phone: '21234567',
  fax: '21234568',
  email: 'info@test.com',
  reference: 'REF-2026-001',
};

function natSec(name: string, eng: string, email: string, hkid: string) {
  return {
    nameChinese: name, nameEnglish: eng, email,
    identity: 'natural' as const,
    idNumber: hkid,
    address: 'Room 101, Block 1, City One, Shatin, N.T.',
  };
}

function corpSec(name: string, eng: string, brn: string, tcsp: string) {
  return {
    nameChinese: name, nameEnglish: eng,
    identity: 'corporate' as const,
    email: 'corpsec@test.com',
    brNumber: brn, tcspNumber: tcsp,
    address: 'Room 301, Tower B, 10 Queen\'s Road Central, Hong Kong',
  };
}

function natDir(name: string, eng: string, email: string, hkid: string) {
  return {
    nameChinese: name, nameEnglish: eng, email,
    identity: 'natural' as const,
    idNumber: hkid,
    address: 'Flat A, 5/F, Block 2, Taikoo Shing, Hong Kong',
  };
}

function corpDir(name: string, eng: string, brn: string) {
  return {
    nameChinese: name, nameEnglish: eng,
    identity: 'corporate' as const,
    email: 'corpdir@test.com',
    brNumber: brn,
    address: 'Suite 2001, Two IFC, 8 Finance Street, Central, Hong Kong',
  };
}

function shareholder(name: string, eng: string, shares: number, chinese?: string) {
  return {
    name,
    nameEnglish: eng,
    nameChinese: chinese || '',
    shares,
    shareType: 'ORDINARY',
    currency: 'HKD',
    identity: 'natural',
    address: 'Flat 1, 3/F, Block A, Mei Foo Sun Chuen, Kowloon',
  };
}

// ── Scenarios ──

const scenarios: Record<string, any> = {
  // 场景1: 标准公司 (1秘+1董+2股东)
  standard: {
    name: 'PAUL TANG AND COMPANY LIMITED',
    chineseName: '保羅鄧氏有限公司',
    brNumber: '07281051',
    tradingName: 'Paul Tang & Co',
    businessNature: 'Secretarial Services',
    businessCode: '82110',
    companyType: '私人公司 Private company',
    companyEmail: 'info@paultang.com',
    companyPhone: '21234567',
    registeredOffice: office,
    presenter: testPresenter,
    signer: { name: 'CHAN TAI MAN', role: 'director' as const },
    directors: [natDir('陳大明', 'CHAN TAI MAN', 'chan@paultang.com', 'A123456(7)')],
    secretaries: [natSec('鄧小芬', 'TANG SIU FAN', 'tang@paultang.com', 'B234567(8)')],
    shareholders: [
      shareholder('CHAN TAI MAN', 'CHAN TAI MAN', 5000, '陳大明'),
      shareholder('TANG SIU FAN', 'TANG SIU FAN', 5000, '鄧小芬'),
    ],
    continuationCounts: { sheetA: 0, sheetB: 0, sheetC: 0, sheetD: 0, sched1: 1 },
  },

  // 场景2: 多人公司 (3董+2秘+5股东)
  multi: {
    name: 'BIG CORP HOLDINGS LIMITED',
    chineseName: '大集團控股有限公司',
    brNumber: '12345678',
    tradingName: 'Big Corp',
    businessNature: 'Investment Holding',
    businessCode: '64200',
    companyType: '私人公司 Private company',
    companyEmail: 'info@bigcorp.com',
    companyPhone: '29876543',
    registeredOffice: office,
    presenter: testPresenter,
    signer: { name: 'WONG SIU MING', role: 'secretary' as const },
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
      shareholder('WONG SIU MING', 'WONG SIU MING', 10000, '黃小明'),
      shareholder('LEE SIU WA', 'LEE SIU WA', 8000, '李小華'),
      shareholder('CHEUNG TAI WAI', 'CHEUNG TAI WAI', 6000, '張大偉'),
      shareholder('HO SIU LING', 'HO SIU LING', 4000, '何小玲'),
      shareholder('LAM KA FAI', 'LAM KA FAI', 2000, '林家輝'),
    ],
    continuationCounts: { sheetA: 0, sheetB: 0, sheetC: 1, sheetD: 0, sched1: 3 },
  },

  // 场景3: 法人董事公司 (2个法人董事)
  corpdir: {
    name: 'CORPORATE DIRECTORS LIMITED',
    chineseName: '法人董事有限公司',
    brNumber: '87654321',
    tradingName: 'CorpDir Co',
    businessNature: 'Corporate Services',
    businessCode: '82110',
    companyType: '私人公司 Private company',
    companyEmail: 'info@corpdir.com',
    companyPhone: '25432109',
    registeredOffice: office,
    presenter: testPresenter,
    signer: { name: 'LAM SIU LING', role: 'director' as const },
    directors: [
      corpDir('控股有限公司', 'HOLDING CORP LTD', 'BR98765432'),
      corpDir('投資有限公司', 'INVESTMENT CORP LTD', 'BR87654321'),
    ],
    secretaries: [natSec('林小玲', 'LAM SIU LING', 'lam@corpdir.com', 'G789012(3)')],
    shareholders: [
      shareholder('HOLDING CORP LTD', 'HOLDING CORP LTD', 7500, '控股有限公司'),
      shareholder('INVESTMENT CORP LTD', 'INVESTMENT CORP LTD', 2500, '投資有限公司'),
    ],
    continuationCounts: { sheetA: 0, sheetB: 0, sheetC: 0, sheetD: 1, sched1: 1 },
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

  console.log(`Generating NAR1 PDF for scenario: ${scenarioName}`);
  console.log(`  Company: ${data.name}`);
  console.log(`  Directors: ${data.directors.length} (${data.directors.filter((d: any) => d.identity === 'natural').length} nat, ${data.directors.filter((d: any) => d.identity === 'corporate').length} corp)`);
  console.log(`  Secretaries: ${data.secretaries.length} (${data.secretaries.filter((s: any) => s.identity === 'natural').length} nat, ${data.secretaries.filter((s: any) => s.identity === 'corporate').length} corp)`);
  console.log(`  Shareholders: ${data.shareholders.length}`);

  // Dynamic import of the build function
  const { buildNAR1Pdf } = await import('./functions/api/generate-nar1-pdf');

  // But buildNAR1Pdf is not exported — it's internal. We need to call onRequest.
  // Actually, let's check...

  console.log('Module loaded. Checking exports...');

  const mod = await import('./functions/api/generate-nar1-pdf');
  console.log('Exports:', Object.keys(mod));
}

main().catch(console.error);
