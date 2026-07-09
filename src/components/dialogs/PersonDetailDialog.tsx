import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import {
  User, Building2, Mail, Phone, MapPin, CreditCard, Calendar,
  Briefcase, Edit, FileText, Globe,
} from 'lucide-react';
import { Person } from '@/types';

interface PersonDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Person | null;
  onEdit?: (person: Person) => void;
}

const identityLabel = (v?: string) => (v === 'corporate' ? '法人' : '自然人');
const roleLabel = (r?: string) => {
  switch (r) {
    case 'director': return '董事';
    case 'secretary': return '秘書';
    case 'shareholder': return '股東';
    case 'authorized_representative': return '授權代表';
    default: return r || '—';
  }
};

// 單一資訊列
function Field({ icon: Icon, label, value }: { icon?: any; label: string; value?: React.ReactNode }) {
  const empty = value === undefined || value === null || value === '' ;
  return (
    <div className="flex items-start gap-2 py-1.5">
      {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm break-words">{empty ? <span className="text-muted-foreground">—</span> : value}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1 pb-1 border-b border-border">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">{children}</div>
    </div>
  );
}

/** 自然人／法人只讀詳情視圖（NP：點擊自然人查看詳情）。 */
export function PersonDetailDialog({ open, onOpenChange, person, onEdit }: PersonDetailDialogProps) {
  if (!person) return null;
  const p = person;
  const isCorp = p.identity === 'corporate';
  const displayName = [p.nameChinese, p.nameEnglish].filter(Boolean).join('　') || '未命名';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCorp ? <Building2 className="h-5 w-5 text-primary" /> : <User className="h-5 w-5 text-primary" />}
            {displayName}
            <StatusBadge variant={p.identity}>{identityLabel(p.identity)}</StatusBadge>
            {p.role && <Badge variant="secondary">{roleLabel(p.role)}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* 基本資料 */}
          <Section title="基本資料">
            <Field icon={User} label="中文名稱" value={p.nameChinese} />
            <Field icon={User} label="英文名稱" value={p.nameEnglish} />
            {(p.aliasChinese || p.aliasEnglish) && (
              <Field label="別名" value={[p.aliasChinese, p.aliasEnglish].filter(Boolean).join(' / ')} />
            )}
            {(p.previousNameChinese || p.previousNameEnglish) && (
              <Field label="曾用名" value={[p.previousNameChinese, p.previousNameEnglish].filter(Boolean).join(' / ')} />
            )}
            <Field label="身份類別" value={identityLabel(p.identity)} />
            <Field label="角色" value={roleLabel(p.role)} />
            {!isCorp && <Field icon={Calendar} label="出生日期" value={p.dateOfBirth} />}
          </Section>

          {/* 證件資料 */}
          <Section title={isCorp ? '登記資料' : '證件資料'}>
            {isCorp ? (
              <>
                <Field icon={CreditCard} label="商業登記號碼 (BR)" value={p.brNumber} />
                <Field icon={FileText} label="TCSP 牌照號碼" value={p.tcspNumber} />
                <Field icon={Globe} label="成立地點" value={p.placeIncorporated} />
                <Field icon={FileText} label="公司註冊編號" value={p.companyNumberRef} />
              </>
            ) : (
              <>
                <Field icon={CreditCard} label="身份證號碼" value={p.idNumber} />
                <Field icon={CreditCard} label="護照號碼" value={p.passportNumber} />
                <Field icon={Calendar} label="護照到期日" value={p.passportExpiry} />
              </>
            )}
          </Section>

          {/* 聯絡方式 */}
          <Section title="聯絡方式">
            <Field icon={Mail} label="電郵" value={p.email} />
            <Field icon={Phone} label="WhatsApp" value={p.whatsapp} />
          </Section>

          {/* 地址 */}
          <Section title="地址">
            <Field icon={MapPin} label="通訊地址" value={p.address} />
            <Field icon={MapPin} label="送達地址" value={p.serviceAddress} />
          </Section>

          {/* 授權代表專屬 */}
          {p.role === 'authorized_representative' && p.authScope && (
            <Section title="授權範圍">
              <Field icon={Briefcase} label="授權範圍" value={p.authScope} />
            </Section>
          )}

          {/* 委任 / 辭任 */}
          {(p.dateAppointed || p.dateCeased || p.isReserve) && (
            <Section title="任職資料">
              <Field icon={Calendar} label="委任日期" value={p.dateAppointed} />
              <Field icon={Calendar} label="辭任日期" value={p.dateCeased} />
              {p.isReserve && <Field label="備選董事" value={<Badge variant="outline">是</Badge>} />}
            </Section>
          )}

          {/* 關聯公司 */}
          <div>
            <h3 className="text-sm font-semibold mb-2 pb-1 border-b border-border">
              關聯公司（{p.companies.length}）
            </h3>
            {p.companies.length === 0 ? (
              <p className="text-sm text-muted-foreground">無關聯公司</p>
            ) : (
              <div className="space-y-1.5">
                {p.companies.map((c, i) => (
                  <div key={i} className="rounded-md border border-border p-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium">{c.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 pl-5.5">
                      {c.brNumber && <span>BR: {c.brNumber}</span>}
                      {c.incorporationDate && <span className="ml-3">成立: {c.incorporationDate}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 系統資料 */}
          <Section title="系統資料">
            <Field label="建立日期" value={p.createdAt} />
            <Field label="更新日期" value={p.updatedAt} />
          </Section>
        </div>

        {onEdit && (
          <div className="flex justify-end pt-2 border-t border-border">
            <Button onClick={() => { onOpenChange(false); onEdit(p); }}>
              <Edit className="h-4 w-4 mr-1.5" /> 編輯資料
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
