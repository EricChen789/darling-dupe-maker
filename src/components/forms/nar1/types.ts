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

  // Presenter
  presenterId?: string;
  presenterName?: string;
  presenterAddress?: string;
  presenterContact?: string;
  presenterReference?: string;

  // P.8 簽署人
  signerRole?: 'director' | 'secretary';
  signerIndex?: number;  // index within signerRole's array
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
  passportNumber?: string;
  passportCountry?: string;
  address: string;
  dateAppointed: string;
  dateCeased: string;
  placeIncorporated: string;
  companyNumberRef: string;
  brNumber?: string;
  tcspNumber?: string;
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

export function createEmptyFormData(incorporationDate?: string): NAR1FormData {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 結算日期 = 成立日期的月/日 + 今年；若今年已過則自動變為下一年。若沒成立日期則用今天
  let returnDay = String(today.getDate()).padStart(2, '0');
  let returnMonth = String(today.getMonth() + 1).padStart(2, '0');
  let returnYear = today.getFullYear();
  if (incorporationDate) {
    // Support both YYYY-MM-DD and DD/MM/YYYY formats
    let d: Date;
    if (incorporationDate.includes('/')) {
      const parts = incorporationDate.split('/');
      d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    } else {
      d = new Date(incorporationDate);
    }
    if (!isNaN(d.getTime())) {
      returnDay = String(d.getDate()).padStart(2, '0');
      returnMonth = String(d.getMonth() + 1).padStart(2, '0');
      // 今年年份 + 成立月日
      returnYear = today.getFullYear();
      const candidate = new Date(returnYear, d.getMonth(), d.getDate());
      // 若今年的周年日已過，自動變成下一年
      if (candidate < today) {
        returnYear = today.getFullYear() + 1;
      }
    }
  }
  return {
    companyName: '',
    chineseName: '',
    tradingName: '',
    companyType: 'private',
    businessCode: '',
    businessNature: '',
    returnDateDay: returnDay,
    returnDateMonth: returnMonth,
    returnDateYear: String(returnYear),
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
    regRegion: '',
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
    passportNumber: '',
    passportCountry: '',
    address: '',
    dateAppointed: '',
    dateCeased: '',
    placeIncorporated: '',
    companyNumberRef: '',
    brNumber: '',
    tcspNumber: '',
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
