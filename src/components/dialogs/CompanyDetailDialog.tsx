import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Company } from '@/types';
import { Building2, Users, UserCheck, Briefcase } from 'lucide-react';

interface CompanyDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

export const CompanyDetailDialog = ({ open, onOpenChange, company }: CompanyDetailDialogProps) => {
  if (!company) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Building2 className="h-5 w-5 text-primary" />
            {company.name}
          </DialogTitle>
        </DialogHeader>

        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <InfoItem label="商業登記號碼" value={company.brNumber} />
          <InfoItem label="商業名稱" value={company.tradingName} />
          <InfoItem label="公司類型" value={company.companyType} />
          <InfoItem label="業務性質" value={company.businessNature} />
          <InfoItem label="業務代碼" value={company.businessCode} />
          <InfoItem label="最後更新" value={company.updatedAt} />
        </div>

        <Separator />

        {/* Directors */}
        <Section icon={<Users className="h-4 w-4 text-primary" />} title="董事" count={company.directors.length}>
          {company.directors.length > 0 ? (
            <div className="grid gap-2">
              {company.directors.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{d.nameEnglish || d.nameChinese}</span>
                    {d.nameEnglish && d.nameChinese && (
                      <span className="ml-2 text-muted-foreground">{d.nameChinese}</span>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {d.identity === 'natural' ? '自然人' : '法人'}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">無董事記錄</p>
          )}
        </Section>

        <Separator />

        {/* Secretaries */}
        <Section icon={<UserCheck className="h-4 w-4 text-primary" />} title="秘書" count={company.secretaries.length}>
          {company.secretaries.length > 0 ? (
            <div className="grid gap-2">
              {company.secretaries.map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{s.nameEnglish || s.nameChinese}</span>
                    {s.nameEnglish && s.nameChinese && (
                      <span className="ml-2 text-muted-foreground">{s.nameChinese}</span>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {s.identity === 'natural' ? '自然人' : '法人'}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">無秘書記錄</p>
          )}
        </Section>

        <Separator />

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
      </DialogContent>
    </Dialog>
  );
};

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
