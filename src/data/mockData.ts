import { Company, Person, Form, Invoice } from '@/types';

export const mockCompanies: Company[] = [
  {
    id: '1',
    name: 'TEST COMPANY – OBVIOUS TEST NAME',
    brNumber: '51241231',
    tradingName: 'asdasdadasdasdasd',
    businessNature: '總管理層經營服務',
    directors: [
      { id: 'd1', nameChinese: '測試董事', nameEnglish: 'TEST DIRECTOR', email: 'test.director@test.com', identity: 'natural', role: 'director', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
      { id: 'd2', nameChinese: '測試法人公司', nameEnglish: 'TEST CORPORATE DIRECTOR', email: 'test.corporate@test.com', identity: 'corporate', role: 'director', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
      { id: 'd3', nameChinese: '第三董事', nameEnglish: 'THIRD DIRECTOR', email: 'third.director@test.com', identity: 'natural', role: 'director', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
    ],
    secretaries: [
      { id: 's1', nameChinese: '測試秘書', nameEnglish: 'TEST SECRETARY', email: 'test.secretary@test.com', identity: 'natural', role: 'secretary', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
      { id: 's2', nameChinese: '測試法人秘書公司', nameEnglish: 'TEST CORPORATE SECRETARY LIMITED', email: 'test.corp.sec@test.com', identity: 'corporate', role: 'secretary', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
      { id: 's3', nameChinese: '李美玲', nameEnglish: 'LEE Mei Ling', email: 'lee.meiling@random.com', identity: 'natural', role: 'secretary', companies: [], createdAt: '2025/11/18', updatedAt: '2025/11/18' },
    ],
    shareholders: [
      { id: 'sh1', name: '測試股東 TEST SHAREHOLDER', nameEnglish: '', nameChinese: '', shares: 1000, identity: 'natural' as const, idNumber: '', address: '', email: '' },
    ],
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '香港 Hong Kong',
    companyType: '私人公司 Private company',
    businessCode: '70100',
    updatedAt: '2025/11/18',
  },
  {
    id: '2',
    name: 'TEST COMPANY 2 – not FULLY FILLED',
    brNumber: '00000002',
    tradingName: 'Test Company 2 Trading Name',
    businessNature: '其他工商服務 asdasdasd',
    directors: [],
    secretaries: [],
    shareholders: [],
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '香港 Hong Kong',
    companyType: '私人公司 Private company',
    businessCode: '82990',
    updatedAt: '2025/11/18',
  },
  {
    id: '3',
    name: '3 company',
    brNumber: '00000003',
    tradingName: '3 Company Business',
    businessNature: 'General management and administrative services',
    directors: [
      { id: 'd4', nameChinese: '陳偉明', nameEnglish: 'CHAN Wai Ming', email: 'chan.waiming@random.com', identity: 'natural', role: 'director', companies: [], createdAt: '2025/11/18', updatedAt: '2025/11/18' },
    ],
    secretaries: [],
    shareholders: [],
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '香港 Hong Kong',
    companyType: '私人公司 Private company',
    businessCode: '70100',
    updatedAt: '2025/11/18',
  },
  {
    id: '4',
    name: 'AAA Co Limited',
    brNumber: '12345854',
    tradingName: 'Trading',
    businessNature: '其他專門批發',
    directors: [
      { id: 'd5', nameChinese: '測試法人公司', nameEnglish: 'TEST CORPORATE DIRECTOR', email: 'test.corporate@test.com', identity: 'corporate', role: 'director', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
      { id: 'd6', nameChinese: '鍾浩仁', nameEnglish: 'CHUNG HO YAN', email: 'ac@vinco.com.hk', identity: 'natural', role: 'director', companies: [], createdAt: '2025/11/21', updatedAt: '2025/11/21' },
    ],
    secretaries: [
      { id: 's4', nameChinese: '測試法人秘書公司', nameEnglish: 'TEST CORPORATE SECRETARY LIMITED', email: 'test.corp.sec@test.com', identity: 'corporate', role: 'secretary', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
    ],
    shareholders: [],
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '香港 Hong Kong',
    companyType: '私人公司 Private company',
    businessCode: '46900',
    updatedAt: '2025/11/18',
  },
  {
    id: '5',
    name: 'Test Company Continue Test',
    brNumber: '87654321',
    tradingName: 'Test Business Continue',
    businessNature: 'Test business description continue',
    directors: [
      { id: 'd7', nameChinese: '測試董事三', nameEnglish: 'TEST DIRECTOR THREE', email: 'test_director_three@example.com', identity: 'natural', role: 'director', companies: [], createdAt: '2025/11/23', updatedAt: '2025/11/23' },
      { id: 'd8', nameChinese: '測試董事四', nameEnglish: 'TEST DIRECTOR FOUR', email: 'fourth.director@test.com', identity: 'natural', role: 'director', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
      { id: 'd9', nameChinese: '測試法人公司', nameEnglish: 'TEST CORPORATE DIRECTOR', email: 'test.corporate@test.com', identity: 'corporate', role: 'director', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
    ],
    secretaries: [
      { id: 's5', nameChinese: '測試秘書三', nameEnglish: 'TEST SECRETARY THREE', email: 'third.secretary@test.com', identity: 'natural', role: 'secretary', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
      { id: 's6', nameChinese: '測試秘書四', nameEnglish: 'TEST SECRETARY FOUR', email: 'fourth.secretary@test.com', identity: 'natural', role: 'secretary', companies: [], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
    ],
    shareholders: [
      { id: 'sh2', name: '測試股東三 TEST SHAREHOLDER THREE', nameEnglish: '', nameChinese: '', shares: 1000, identity: 'natural' as const, idNumber: '', address: '', email: '' },
      { id: 'sh3', name: '測試股東 TEST SHAREHOLDER FOUR', nameEnglish: '', nameChinese: '', shares: 2000, identity: 'natural' as const, idNumber: '', address: '', email: '' },
    ],
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '香港 Hong Kong',
    companyType: '私人公司 Private company',
    businessCode: '70100',
    updatedAt: '2025/11/23',
  },
  {
    id: '6',
    name: 'ABLELAND INVESTMENT LIMITED',
    brNumber: '00667527',
    tradingName: 'ABLELAND INVESTMENT LIMITED',
    businessNature: 'Investment holding',
    directors: [
      { id: 'd10', nameChinese: '', nameEnglish: 'WORLDSHINE LIMITED 環昇有限公司', email: '', identity: 'corporate', role: 'director', companies: [], createdAt: '2024/03/22', updatedAt: '2024/03/22' },
    ],
    secretaries: [
      { id: 's7', nameChinese: '環球創業網絡有限公司', nameEnglish: 'WORLDWIDE INCORPORATION NETWORK LIMITED', email: '', identity: 'corporate', role: 'secretary', companies: [], createdAt: '2024/03/22', updatedAt: '2024/03/22' },
    ],
    shareholders: [
      { id: 'sh4', name: 'TWINSAIL LIMITED (Company No: 83154)', nameEnglish: '', nameChinese: '', shares: 50000, identity: 'natural' as const, idNumber: '', address: '', email: '' },
    ],
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '香港 Hong Kong',
    companyType: '私人公司 Private company',
    businessCode: '64200',
    updatedAt: '2024/03/22',
  },
  {
    id: '7',
    name: 'AGF LIMITED',
    brNumber: '02030762',
    tradingName: 'AGF LIMITED',
    businessNature: 'Investment holding',
    directors: [
      { id: 'd11', nameChinese: '', nameEnglish: 'HASAN AZIZ, SHAHRIL ANAS', email: '', identity: 'natural', role: 'director', companies: [], createdAt: '2024/03/22', updatedAt: '2024/03/22' },
      { id: 'd12', nameChinese: '雷志強', nameEnglish: 'LUI, CHI KEUNG', email: '', identity: 'natural', role: 'director', companies: [], createdAt: '2024/03/22', updatedAt: '2024/03/22' },
      { id: 'd13', nameChinese: '魏明德', nameEnglish: 'NGAI, MING TAK', email: '', identity: 'natural', role: 'director', companies: [], createdAt: '2024/03/22', updatedAt: '2024/03/22' },
      { id: 'd14', nameChinese: '朱張金', nameEnglish: 'ZHU, ZHANGJIN', email: '', identity: 'natural', role: 'director', companies: [], createdAt: '2024/03/22', updatedAt: '2024/03/22' },
    ],
    secretaries: [],
    shareholders: [
      { id: 'sh5', name: 'CARDINA INTERNATIONAL COMPANY LIMITED 凯迪纳国际有限公司', nameEnglish: '', nameChinese: '', shares: 30, identity: 'natural' as const, idNumber: '', address: '', email: '' },
      { id: 'sh6', name: 'MALAYSIA VENTURE CAPITAL MANAGEMENT BERHAD', nameEnglish: '', nameChinese: '', shares: 30, identity: 'natural' as const, idNumber: '', address: '', email: '' },
      { id: 'sh7', name: 'RP PARTNERS LIMITED', nameEnglish: '', nameChinese: '', shares: 40, identity: 'natural' as const, idNumber: '', address: '', email: '' },
    ],
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '香港 Hong Kong',
    companyType: '私人公司 Private company',
    businessCode: '64200',
    updatedAt: '2024/03/22',
  },
  {
    id: '8',
    name: 'ALPHA BLOOM LIMITED 德瑞投資集團有限公司',
    brNumber: '01792490',
    tradingName: 'ALPHA BLOOM LIMITED',
    businessNature: 'Investment holding',
    directors: [
      { id: 'd15', nameChinese: '朱世恩', nameEnglish: 'CHU, SAI YAN', email: '', identity: 'natural', role: 'director', companies: [], createdAt: '2024/03/22', updatedAt: '2024/03/22' },
    ],
    secretaries: [],
    shareholders: [
      { id: 'sh8', name: '朱世恩 CHU, SAI YAN', nameEnglish: '', nameChinese: '', shares: 1, identity: 'natural' as const, idNumber: '', address: '', email: '' },
    ],
    regFlat: '', regBuilding: '', regStreet: '', regDistrict: '', regRegion: '香港 Hong Kong',
    companyType: '私人公司 Private company',
    businessCode: '64200',
    updatedAt: '2024/03/22',
  },
];

export const mockPeople: Person[] = [
  { id: 'p1', nameChinese: '測試董事', nameEnglish: 'TEST DIRECTOR', email: 'test.director@test.com', identity: 'natural', role: 'director', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
  { id: 'p2', nameChinese: '測試秘書', nameEnglish: 'TEST SECRETARY', email: 'test.secretary@test.com', identity: 'natural', role: 'secretary', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
  { id: 'p3', nameChinese: '測試法人公司', nameEnglish: 'TEST CORPORATE DIRECTOR', email: 'test.corporate@test.com', identity: 'corporate', role: 'director', brNumber: '87654321', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }, { id: '4', name: 'AAA Co Limited', brNumber: '12345854' }, { id: '5', name: 'Test Company Continue Test', brNumber: '87654321' }], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
  { id: 'p4', nameChinese: '測試法人秘書公司', nameEnglish: 'TEST CORPORATE SECRETARY LIMITED', email: 'test.corp.sec@test.com', identity: 'corporate', role: 'secretary', brNumber: '11223344', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }, { id: '4', name: 'AAA Co Limited', brNumber: '12345854' }], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
  { id: 'p5', nameChinese: '第三董事', nameEnglish: 'THIRD DIRECTOR', email: 'third.director@test.com', identity: 'natural', role: 'director', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
  { id: 'p6', nameChinese: '第四董事', nameEnglish: 'FOURTH DIRECTOR', email: 'fourth.director@test.com', identity: 'natural', role: 'director', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
  { id: 'p7', nameChinese: '第一董事', nameEnglish: 'FIRST DIRECTOR', email: 'first.director@test.com', identity: 'natural', role: 'director', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
  { id: 'p8', nameChinese: '第五董事', nameEnglish: 'FIFTH DIRECTOR', email: 'fifth.director@test.com', identity: 'natural', role: 'director', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }], createdAt: '2025/11/17', updatedAt: '2025/11/17' },
  { id: 'p9', nameChinese: '陳偉明', nameEnglish: 'CHAN Wai Ming', email: 'chan.waiming@random.com', identity: 'natural', role: 'director', companies: [{ id: '3', name: '3 company', brNumber: '00000003' }], createdAt: '2025/11/18', updatedAt: '2025/11/18' },
  { id: 'p10', nameChinese: '李美玲', nameEnglish: 'LEE Mei Ling', email: 'lee.meiling@random.com', identity: 'natural', role: 'secretary', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }], createdAt: '2025/11/18', updatedAt: '2025/11/18' },
  { id: 'p11', nameChinese: '測試股東', nameEnglish: 'TEST SHAREHOLDER', email: 'test.shareholder@test.com', identity: 'natural', role: 'shareholder', companies: [{ id: '1', name: 'TEST COMPANY – OBVIOUS TEST NAME', brNumber: '51241231' }], createdAt: '2025/11/20', updatedAt: '2025/11/20' },
  { id: 'p12', nameChinese: '鍾浩仁', nameEnglish: 'CHUNG HO YAN', email: 'ac@vinco.com.hk', identity: 'natural', role: 'director', companies: [{ id: '4', name: 'AAA Co Limited', brNumber: '12345854' }], createdAt: '2025/11/21', updatedAt: '2025/11/21' },
  { id: 'p13', nameChinese: '測試董事三', nameEnglish: 'TEST DIRECTOR THREE', email: 'test_director_three@example.com', identity: 'natural', role: 'director', companies: [{ id: '5', name: 'Test Company Continue Test', brNumber: '87654321' }], createdAt: '2025/11/23', updatedAt: '2025/11/23' },
];

export const mockForms: Form[] = [
  // === 公司註冊處表格（14 種） ===
  { id: 'nar1',  name: 'NAR1',  description: '周年申報表 — Annual Return',                                                                          year: 2025, version: 2, isHelper: true },
  { id: 'nd2a',  name: 'ND2A',  description: '更改公司秘書及董事通知書 (委任╱停任) — Notice of Change of Company Secretary and Director (Appointment／Cessation)', year: 2025, version: 1, isHelper: true },
  { id: 'nd2b',  name: 'ND2B',  description: '更改公司秘書及董事詳情通知書 — Notice of Change in Particulars of Company Secretary and Director',              year: 2025, version: 1, isHelper: true },
  { id: 'nd4',   name: 'ND4',   description: '公司秘書及董事辭任通知書 — Notice of Change in Particulars of Company Secretary and Director',                 year: 2025, version: 1, isHelper: true },
  { id: 'ndr1',  name: 'NDR1',  description: '私人公司或擔保有限公司撤銷註冊申請書 — Application for Deregistration of Private Company or Company Limited by Guarantee', year: 2025, version: 1, isHelper: true },
  { id: 'nr1',   name: 'NR1',   description: '註冊辦事處地址變更通知書 — Notice of Change of Address of Registered Office',                                year: 2025, version: 1, isHelper: true },
  { id: 'nsc1',  name: 'NSC1',  description: '股份配發申報書 — Return of Allotment',                                                                    year: 2025, version: 1, isHelper: true },
  { id: 'nn1',   name: 'NN1',   description: '註冊非香港公司的註冊申請書 — Application for Registration as Registered Non-Hong Kong Company',                 year: 2025, version: 1, isHelper: true },
  { id: 'nn3',   name: 'NN3',   description: '註冊非香港公司周年申報表 — Annual Return of Registered Non-Hong Kong Company',                             year: 2025, version: 1, isHelper: true },
  { id: 'nn6',   name: 'NN6',   description: '註冊非香港公司更改公司秘書及董事申報表 (委任╱停任) — Return of Change of Company Secretary and Director of Registered Non-Hong Kong Company (Appointment╱Cessation)', year: 2025, version: 1, isHelper: true },
  { id: 'nn7',   name: 'NN7',   description: '註冊非香港公司更改公司秘書及董事詳情申報表 — Return of Change in Particulars of Company Secretary and Director of Registered Non-Hong Kong Company', year: 2025, version: 1, isHelper: true },
  { id: 'nn9',   name: 'NN9',   description: '註冊非香港公司更改地址申報表 — Return of Change of Address of Registered Non-Hong Kong Company',                 year: 2025, version: 1, isHelper: true },
  { id: 'nnc1',  name: 'NNC1',  description: '法團成立表格 (股份有限公司) — Incorporation Form (Company Limited by Shares)',                              year: 2025, version: 1, isHelper: true },
  { id: 'nnc2',  name: 'NNC2',  description: '更改公司名稱通知書 — Notice of Change of Company Name',                                                     year: 2025, version: 1, isHelper: true },

  // === 其他常用文件 ===
  { id: 'resolution', name: '決議書', description: '通用範本或 AI 生成的董事/股東決議書', year: 2025, version: 1, isHelper: true },

  // === 稅務局表格 ===
  { id: 'irc3111a', name: 'IRC 3111A', description: '通知更改業務地址（稅務局）', year: 2025, version: 1, isHelper: false },
];

export const mockInvoices: Invoice[] = [];
