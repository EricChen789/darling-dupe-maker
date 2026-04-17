export interface NAR1FormData {
  // Page 1 - Company info
  companyName: string;
  chineseName: string;
  tradingName: string;
  companyType: 'private' | 'public' | 'guarantee';
  businessCode: string;
  businessNature: string;
  returnDateDay: string;
  returnDateMonth: string;
  returnDateYear: string;
  financialStartDay: string;
  financialStartMonth: string;
  financialStartYear: string;
  financialEndDay: string;
  financialEndMonth: string;
  financialEndYear: string;
  regFlat: string;
  regBuilding: string;
  regStreet: string;
  regDistrict: string;
  regRegion: string;
  email: string;
  website: string;
  brNumber: string;

  // Page 2 - Share capital
  mortgageAmount: string;
  noShareMembers: string;
  shareCapital: ShareCapitalRow[];

  // Secretaries
  secretaries: NAR1Officer[];

  // Directors
  directors: NAR1Officer[];

  // Shareholders
  shareholders: NAR1Shareholder[];
}

export interface ShareCapitalRow {
  shareClass: string;
  currency: string;
  shares: string;
  paidUp: string;
}

export interface NAR1Officer {
  identity: 'natural' | 'corporate';
  nameChinese: string;
  nameEnglish: string;
  formerNameChinese: string;
  formerNameEnglish: string;
  idNumber: string;
  address: string;
  dateAppointed: string;
  dateCeased: string;
  placeIncorporated: string;
  companyNumberRef: string;
}

export interface NAR1Shareholder {
  identity: 'natural' | 'corporate';
  nameChinese: string;
  nameEnglish: string;
  idNumber: string;
  address: string;
  shares: string;
  shareClass: string;
  currency: string;
  paidUp: string;
}

export function createEmptyFormData(): NAR1FormData {
  const today = new Date();
  return {
    companyName: '',
    chineseName: '',
    tradingName: '',
    companyType: 'private',
    businessCode: '',
    businessNature: '',
    returnDateDay: String(today.getDate()).padStart(2, '0'),
    returnDateMonth: String(today.getMonth() + 1).padStart(2, '0'),
    returnDateYear: String(today.getFullYear()),
    financialStartDay: '',
    financialStartMonth: '',
    financialStartYear: '',
    financialEndDay: '',
    financialEndMonth: '',
    financialEndYear: '',
    regFlat: '',
    regBuilding: '',
    regStreet: '',
    regDistrict: '',
    regRegion: '香港 Hong Kong',
    email: '',
    website: '',
    brNumber: '',
    mortgageAmount: '',
    noShareMembers: '',
    shareCapital: [{ shareClass: 'Ordinary 普通股', currency: 'HKD', shares: '', paidUp: '' }],
    secretaries: [createEmptyOfficer()],
    directors: [createEmptyOfficer()],
    shareholders: [createEmptyShareholder()],
  };
}

export function createEmptyOfficer(): NAR1Officer {
  return {
    identity: 'natural',
    nameChinese: '',
    nameEnglish: '',
    formerNameChinese: '',
    formerNameEnglish: '',
    idNumber: '',
    address: '',
    dateAppointed: '',
    dateCeased: '',
    placeIncorporated: '',
    companyNumberRef: '',
  };
}

export function createEmptyShareholder(): NAR1Shareholder {
  return {
    identity: 'natural',
    nameChinese: '',
    nameEnglish: '',
    idNumber: '',
    address: '',
    shares: '',
    shareClass: 'Ordinary 普通股',
    currency: 'HKD',
    paidUp: '',
  };
}
