export interface Company {
  id: string;
  name: string;
  chineseName?: string;
  brNumber: string;
  ciNumber?: string;
  tradingName: string;
  businessNature: string;
  directors: Person[];
  secretaries: Person[];
  shareholders: Shareholder[];
  companyType: string;
  businessCode: string;
  updatedAt: string;
  regFlat: string;
  regBuilding: string;
  regStreet: string;
  regDistrict: string;
  regRegion: string;
  incorporationDate?: string;
  jurisdiction?: string;
  ciFilePath?: string;
  brFilePath?: string;
  preferredPresenterId?: string;
  presenterReference?: string;
  status?: 'active' | 'inactive' | 'deregistered';
  email?: string;
  phone?: string;
  /**
   * NAR1 簽署人 — 儲存所選秘書或董事的 person_company_roles.id（即 Person.id）。
   * 為空時系統自動 fallback：第一個秘書 → 第一個董事。
   */
  signerRoleId?: string;
}

export interface Person {
  id: string;
  nameChinese: string;
  nameEnglish: string;
  email: string;
  identity: 'natural' | 'corporate';
  role: 'director' | 'secretary' | 'shareholder';
  brNumber?: string;
  address?: string;
  serviceAddress?: string;
  idNumber?: string;
  passportNumber?: string;
  passportExpiry?: string;
  whatsapp?: string;
  passportFilePath?: string;
  idCardFilePath?: string;
  addressProofFilePath?: string;
  dateAppointed?: string;
  dateCeased?: string;
  placeIncorporated?: string;
  companyNumberRef?: string;
  tcspNumber?: string;
  previousNameChinese?: string;
  previousNameEnglish?: string;
  aliasChinese?: string;
  aliasEnglish?: string;
  isReserve?: boolean;
  companies: { id: string; name: string; brNumber: string; incorporationDate?: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Shareholder {
  id: string;
  name: string;
  nameEnglish: string;
  nameChinese: string;
  shares: number;
  identity: 'natural' | 'corporate';
  idNumber: string;
  address: string;
  serviceAddress?: string;
  email: string;
  shareType?: string;
  issuePrice?: string;
  currency?: string;
  paidUp?: string;
  unpaid?: string;
}

export interface SignificantController {
  id: string;
  companyId: string;
  identity: 'natural' | 'corporate';
  nameEnglish: string;
  nameChinese: string;
  idNumber: string;
  address: string;
  serviceAddress: string;
  dateBecame: string;
  dateCeased: string;
  natureShares: boolean;
  natureVoting: boolean;
  natureAppoint: boolean;
  natureInfluence: boolean;
  natureTrust: boolean;
  natureOther: string;
  isDesignatedRep: boolean;
  designatedRepName: string;
  designatedRepContact: string;
}

export interface Form {
  id: string;
  name: string;
  description: string;
  year: number;
  version: number;
  isHelper: boolean;
}

export interface FormSubmission {
  id: string;
  formId: string;
  companyId: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  currentStep: number;
  totalSteps: number;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  description: string;
  companyId: string;
  companyName: string;
  companyBrNumber: string;
  amount: number;
  currency: string;
  status: 'paid' | 'pending' | 'overdue';
  issueDate: string;
  dueDate: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  entityType: 'company' | 'person' | 'form' | 'invoice';
  entityId: string;
  entityName: string;
  userId: string;
  userName: string;
  timestamp: string;
  details?: string;
}
