import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Edit, Trash2, Save, X, Download, Loader2, FileText, ArrowRight,
  Users, UserCheck, Briefcase, Clock, MapPin, Hash, Mail, Phone,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { downloadAndOpenBase64Pdf } from '@/lib/downloadPdf';
import { Company, Person, Shareholder } from '@/types';
import {
  useShareTransactions, useUpsertShareTransaction, useDeleteShareTransaction,
  type ShareTransaction,
} from '@/hooks/useShareTransactions';

type EditTx = Partial<ShareTransaction>;

const emptyTx = (companyId: string): EditTx => ({
  company_id: companyId,
  transaction_date: '',
  transaction_type: 'transfer',
  from_name: '',
  to_name: '',
  shares: 0,
  share_type: '',
  currency: 'HKD',
  price_per_share: '',
  total_consideration: '',
  instrument_number: '',
  notes: '',
});

async function downloadRegister(fnName: string, companyId: string, brNumber: string, companyName: string, label: string) {
  try {
    const token = localStorage.getItem("secretary_jwt") || "";
    const url = `/api/${fnName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ companyId }),
    });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    const filename = `${label}_${brNumber || ''}_${companyName}.pdf`;
    downloadAndOpenBase64Pdf(result.pdf, filename);
  } catch (e: any) {
    toast({ title: 'PDF 生成失敗', description: e.message, variant: 'destructive' });
  }
}

// ── Person Card (for directors & secretaries) ──
function PersonCard({ person, showRole }: { person: Person; showRole?: boolean }) {
  const name = person.nameEnglish || person.nameChinese || '(未命名)';
  const sub = person.nameChinese && person.nameEnglish ? person.nameChinese : '';
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{name}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
        <div className="flex gap-1.5">
          {showRole && (
            <Badge variant={person.role === 'director' ? 'default' : 'secondary'} className="text-xs">
              {person.role === 'director' ? '董事' : '秘書'}
            </Badge>
          )}
          {person.isReserve && <Badge variant="outline" className="text-xs">後備</Badge>}
          {person.identity === 'corporate' && <Badge variant="outline" className="text-xs">法人</Badge>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {person.idNumber && <div><Hash className="h-3 w-3 inline mr-1" />{person.idNumber}</div>}
        {person.passportNumber && <div>護照: {person.passportNumber}</div>}
        {person.dateAppointed && <div><Clock className="h-3 w-3 inline mr-1" />委任: {person.dateAppointed}</div>}
        {person.dateCeased && <div className="text-destructive"><Clock className="h-3 w-3 inline mr-1" />離任: {person.dateCeased}</div>}
        {person.address && <div className="col-span-2"><MapPin className="h-3 w-3 inline mr-1" />{person.address}</div>}
        {person.serviceAddress && person.serviceAddress !== person.address && (
          <div className="col-span-2"><MapPin className="h-3 w-3 inline mr-1 text-primary" />送達地址: {person.serviceAddress}</div>
        )}
        {person.tcspNumber && <div>TCSP: {person.tcspNumber}</div>}
        {person.email && <div><Mail className="h-3 w-3 inline mr-1" />{person.email}</div>}
        {person.whatsapp && <div><Phone className="h-3 w-3 inline mr-1" />{person.whatsapp}</div>}
      </div>
    </div>
  );
}

export function RegistersTab({ company }: { company: Company }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState('directors');

  // ── Share transactions ──
  const { data: txs = [], isLoading: txsLoading } = useShareTransactions(company.id);
  const upsertTx = useUpsertShareTransaction();
  const delTx = useDeleteShareTransaction();
  const [editingTx, setEditingTx] = useState<EditTx | null>(null);

  const handleDownload = async (fn: string, label: string) => {
    setDownloading(fn);
    try {
      await downloadRegister(fn, company.id, company.brNumber, company.name, label);
    } finally {
      setDownloading(null);
    }
  };

  // ── Share tx save ──
  const handleSaveTx = () => {
    if (!editingTx) return;
    if (!editingTx.transaction_date) {
      toast({ title: '請填寫交易日期', variant: 'destructive' }); return;
    }
    upsertTx.mutate(editingTx, {
      onSuccess: () => { toast({ title: '已儲存' }); setEditingTx(null); },
      onError: (e: any) => toast({ title: '儲存失敗', description: e.message, variant: 'destructive' }),
    });
  };

  const directors = company.directors || [];
  const secretaries = company.secretaries || [];
  const shareholders = company.shareholders || [];

  return (
    <div className="space-y-4">
      {/* ── Register sub-tabs ── */}
      <Tabs value={activeSub} onValueChange={setActiveSub}>
        <TabsList>
          <TabsTrigger value="directors" className="gap-1.5">
            <Users className="h-3.5 w-3.5" /> 董事登記冊
            <Badge variant="secondary" className="text-xs">{directors.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="secretaries" className="gap-1.5">
            <UserCheck className="h-3.5 w-3.5" /> 秘書登記冊
            <Badge variant="secondary" className="text-xs">{secretaries.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="shareholders" className="gap-1.5">
            <Briefcase className="h-3.5 w-3.5" /> 股東登記冊
            <Badge variant="secondary" className="text-xs">{shareholders.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── 董事登記冊 ── */}
        <TabsContent value="directors" className="mt-4 space-y-3">
          {directors.length === 0 ? (
            <p className="text-muted-foreground text-sm">尚無董事記錄</p>
          ) : (
            directors.map(d => <PersonCard key={d.id} person={d} showRole />)
          )}
        </TabsContent>

        {/* ── 秘書登記冊 ── */}
        <TabsContent value="secretaries" className="mt-4 space-y-3">
          {secretaries.length === 0 ? (
            <p className="text-muted-foreground text-sm">尚無公司秘書記錄</p>
          ) : (
            secretaries.map(s => <PersonCard key={s.id} person={s} showRole />)
          )}
        </TabsContent>

        {/* ── 股東登記冊 ── */}
        <TabsContent value="shareholders" className="mt-4 space-y-4">
          {/* 股東名單 */}
          <div>
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" /> 股東名單
              <Badge variant="secondary" className="text-xs">{shareholders.length}</Badge>
            </h3>
            {shareholders.length === 0 ? (
              <p className="text-muted-foreground text-sm">尚無股東記錄</p>
            ) : (
              <div className="space-y-2">
                {shareholders.map(sh => (
                  <div key={sh.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{sh.nameEnglish || sh.nameChinese || sh.name || '(未命名)'}</div>
                        {sh.nameChinese && sh.nameEnglish && (
                          <div className="text-xs text-muted-foreground">{sh.nameChinese}</div>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        {sh.identity === 'corporate' && <Badge variant="outline" className="text-xs">法人</Badge>}
                        <Badge variant="default" className="text-xs">{sh.shares || 0} 股</Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {sh.idNumber && <div><Hash className="h-3 w-3 inline mr-1" />{sh.idNumber}</div>}
                      <div>類別: {sh.shareType || '-'}</div>
                      <div>幣別: {sh.currency || 'HKD'}</div>
                      <div>每股價: {sh.issuePrice || '-'}</div>
                      <div>實繳: {sh.paidUp || '-'}</div>
                      <div>未繳: {sh.unpaid || '-'}</div>
                      {sh.address && <div className="col-span-2"><MapPin className="h-3 w-3 inline mr-1" />{sh.address}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* 股份轉讓 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-primary" /> 股份轉讓記錄
                <Badge variant="secondary" className="text-xs">{txs.length}</Badge>
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setEditingTx(emptyTx(company.id))}>
                <Plus className="h-3.5 w-3.5 mr-1" /> 新增轉讓
              </Button>
            </div>

            {editingTx && (
              <div className="rounded-md border border-primary/50 bg-primary/5 p-3 mb-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">交易日期</Label>
                    <Input type="date" value={editingTx.transaction_date || ''}
                      onChange={e => setEditingTx({ ...editingTx, transaction_date: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">交易類型</Label>
                    <Select value={editingTx.transaction_type || 'transfer'}
                      onValueChange={v => setEditingTx({ ...editingTx, transaction_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="transfer">轉讓 Transfer</SelectItem>
                        <SelectItem value="allotment">配發 Allotment</SelectItem>
                        <SelectItem value="repurchase">購回 Repurchase</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">轉讓人 From</Label>
                    <Input value={editingTx.from_name || ''}
                      onChange={e => setEditingTx({ ...editingTx, from_name: e.target.value })}
                      placeholder="若為新發行可留空" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">受讓人 To</Label>
                    <Input value={editingTx.to_name || ''}
                      onChange={e => setEditingTx({ ...editingTx, to_name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">股數</Label>
                    <Input type="number" value={editingTx.shares ?? 0}
                      onChange={e => setEditingTx({ ...editingTx, shares: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">股份類別</Label>
                    <Input value={editingTx.share_type || ''}
                      onChange={e => setEditingTx({ ...editingTx, share_type: e.target.value })} placeholder="Ordinary" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">幣別</Label>
                    <Input value={editingTx.currency || 'HKD'}
                      onChange={e => setEditingTx({ ...editingTx, currency: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">每股價格</Label>
                    <Input value={editingTx.price_per_share || ''}
                      onChange={e => setEditingTx({ ...editingTx, price_per_share: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">總代價 Consideration</Label>
                    <Input value={editingTx.total_consideration || ''}
                      onChange={e => setEditingTx({ ...editingTx, total_consideration: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">文件編號 Instrument</Label>
                    <Input value={editingTx.instrument_number || ''}
                      onChange={e => setEditingTx({ ...editingTx, instrument_number: e.target.value })} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">備註 Notes</Label>
                    <Textarea rows={2} value={editingTx.notes || ''}
                      onChange={e => setEditingTx({ ...editingTx, notes: e.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditingTx(null)}>
                    <X className="h-3.5 w-3.5 mr-1" /> 取消
                  </Button>
                  <Button size="sm" onClick={handleSaveTx} disabled={upsertTx.isPending}
                    className="bg-primary text-primary-foreground">
                    {upsertTx.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                    儲存
                  </Button>
                </div>
              </div>
            )}

            {txsLoading ? (
              <p className="text-muted-foreground text-sm">載入中...</p>
            ) : txs.length === 0 && !editingTx ? (
              <p className="text-muted-foreground text-sm">尚無股份轉讓記錄</p>
            ) : (
              <div className="grid gap-2">
                {txs.map(t => (
                  <div key={t.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm group">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t.transaction_date}</span>
                        <Badge variant="outline" className="text-xs">{t.transaction_type}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {t.from_name || '(新發行)'} → {t.to_name || '(未指定)'}
                        </span>
                      </div>
                      <div className="hidden group-hover:flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 px-1.5"
                          onClick={() => setEditingTx(t)}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive"
                          onClick={() => delTx.mutate({ id: t.id, companyId: company.id })}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div>股數: {t.shares}</div>
                      <div>類別: {t.share_type || '-'}</div>
                      <div>每股: {t.currency} {t.price_per_share || '-'}</div>
                      <div>總代價: {t.total_consideration || '-'}</div>
                      <div>文件: {t.instrument_number || '-'}</div>
                      {t.notes && <div className="col-span-3">備註: {t.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

      </Tabs>

      <Separator />

      {/* ── PDF download buttons ── */}
      <div>
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" /> 匯出法定登記冊 PDF
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm"
            onClick={() => handleDownload('generate-directors-register-pdf', 'DirectorsRegister')}
            disabled={downloading !== null}>
            {downloading === 'generate-directors-register-pdf'
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1" />}
            董事登記冊
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => handleDownload('generate-secretaries-register-pdf', 'SecretariesRegister')}
            disabled={downloading !== null}>
            {downloading === 'generate-secretaries-register-pdf'
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1" />}
            秘書登記冊
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => handleDownload('generate-shareholders-register-pdf', 'MembersRegister')}
            disabled={downloading !== null}>
            {downloading === 'generate-shareholders-register-pdf'
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1" />}
            股東登記冊
          </Button>
        </div>
      </div>
    </div>
  );
}
