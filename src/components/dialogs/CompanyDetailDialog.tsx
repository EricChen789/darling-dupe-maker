import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Company, Person } from '@/types';
import { Building2, Users, UserCheck, Briefcase, ArrowLeft, User } from 'lucide-react';

interface CompanyDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

export const CompanyDetailDialog = ({ open, onOpenChange, company }: CompanyDetailDialogProps) => {
  const [selectedPerson, setSelectedPerson] = useState<(Person & { roleLabel: string }) | null>(null);

  if (!company) return null;

  const handleOpenChange = (v: boolean) => {
    if (!v) setSelectedPerson(null);
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="!grid-none flex flex-col w-[98vw] max-w-[98vw] h-[98vh] max-h-[98vh] overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Building2 className="h-5 w-5 text-primary" />
            {company.name}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex">
          {/* Main company info area */}
          <div className={`overflow-y-auto p-6 pt-2 transition-all ${selectedPerson ? 'w-1/2 border-r border-border' : 'w-full'}`}>
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4 text-sm mb-4">
              <InfoItem label="商業登記號碼" value={company.brNumber} />
              <InfoItem label="商業名稱" value={company.tradingName} />
              <InfoItem label="公司類型" value={company.companyType} />
              <InfoItem label="業務性質" value={company.businessNature} />
              <InfoItem label="業務代碼" value={company.businessCode} />
              <InfoItem label="最後更新" value={company.updatedAt} />
            </div>

            <Separator className="my-4" />

            {/* Directors */}
            <Section icon={<Users className="h-4 w-4 text-primary" />} title="董事" count={company.directors.length}>
              {company.directors.length > 0 ? (
                <div className="grid gap-2">
                  {company.directors.map((d, i) => (
                    <PersonRow
                      key={i}
                      person={d}
                      isSelected={selectedPerson?.id === d.id}
                      onClick={() => setSelectedPerson({ ...d, roleLabel: '董事' })}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">無董事記錄</p>
              )}
            </Section>

            <Separator className="my-4" />

            {/* Secretaries */}
            <Section icon={<UserCheck className="h-4 w-4 text-primary" />} title="秘書" count={company.secretaries.length}>
              {company.secretaries.length > 0 ? (
                <div className="grid gap-2">
                  {company.secretaries.map((s, i) => (
                    <PersonRow
                      key={i}
                      person={s}
                      isSelected={selectedPerson?.id === s.id}
                      onClick={() => setSelectedPerson({ ...s, roleLabel: '秘書' })}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">無秘書記錄</p>
              )}
            </Section>

            <Separator className="my-4" />

            {/* Shareholders */}
            <Section icon={<Briefcase className="h-4 w-4 text-primary" />} title="股東" count={company.shareholders.length}>
              {company.shareholders.length > 0 ? (
                <div className="grid gap-2">
                  {company.shareholders.map((sh, i) => (
                    <div key={i} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                      <span className="font-medium">{sh.name}</span>
                      <Badge variant="secondary">{sh.shares.toLocaleString()} 股</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">無股東記錄</p>
              )}
            </Section>
          </div>

          {/* Person detail panel */}
          {selectedPerson && (
            <div className="w-1/2 overflow-y-auto p-6 pt-2 bg-muted/10">
              <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => setSelectedPerson(null)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> 返回
              </Button>

              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{selectedPerson.nameEnglish || selectedPerson.nameChinese}</h2>
                  {selectedPerson.nameEnglish && selectedPerson.nameChinese && (
                    <p className="text-sm text-muted-foreground">{selectedPerson.nameChinese}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <InfoItem label="角色" value={selectedPerson.roleLabel} />
                <InfoItem label="身份類型" value={selectedPerson.identity === 'natural' ? '自然人' : '法人'} />
                <InfoItem label="英文名稱" value={selectedPerson.nameEnglish} />
                <InfoItem label="中文名稱" value={selectedPerson.nameChinese} />
                <InfoItem label="電郵" value={selectedPerson.email} />
                <InfoItem label="商業登記號碼" value={selectedPerson.brNumber || ''} />
              </div>

              {selectedPerson.companies && selectedPerson.companies.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <Section icon={<Building2 className="h-4 w-4 text-primary" />} title="關聯公司" count={selectedPerson.companies.length}>
                    <div className="grid gap-2">
                      {selectedPerson.companies.map((c, i) => (
                        <div key={i} className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                          <span className="font-medium">{c.name}</span>
                          <span className="ml-2 text-muted-foreground">{c.brNumber}</span>
                        </div>
                      ))}
                    </div>
                  </Section>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

function PersonRow({ person, isSelected, onClick }: { person: Person; isSelected: boolean; onClick: () => void }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
        isSelected ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/60'
      }`}
      onClick={onClick}
    >
      <div>
        <span className="font-medium">{person.nameEnglish || person.nameChinese}</span>
        {person.nameEnglish && person.nameChinese && (
          <span className="ml-2 text-muted-foreground">{person.nameChinese}</span>
        )}
      </div>
      <Badge variant="outline" className="text-xs">
        {person.identity === 'natural' ? '自然人' : '法人'}
      </Badge>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="font-medium mt-0.5">{value || '-'}</p>
    </div>
  );
}

function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 font-semibold text-sm">
        {icon} {title}
        <Badge variant="secondary" className="text-xs">{count}</Badge>
      </h3>
      {children}
    </div>
  );
}
