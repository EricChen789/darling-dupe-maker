export interface Company {
  id: string;
  name: string;
  brNumber: string;
  tradingName: string;
  businessNature: string;
  directors: Person[];
  secretaries: Person[];
  shareholders: Shareholder[];
  companyType: string;
  businessCode: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  nameChinese: string;
  nameEnglish: string;
  email: string;
  identity: 'natural' | 'corporate';
  role: 'director' | 'secretary' | 'shareholder';
  brNumber?: string;
  companies: { id: string; name: string; brNumber: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Shareholder {
  id: string;
  name: string;
  shares: number;
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
