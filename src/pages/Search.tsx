import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search as SearchIcon, Building2, User, Loader2, History, ArrowRight } from 'lucide-react';
import { useCompanies } from '@/hooks/useCompanies';
import {
  useGlobalSearch, useCompanyRegisters,
  type SearchResult, type RegisterMember,
} from '@/hooks/useSearch';

function fmtDate(s?: string) {
  if (!s) return '—';
  const t = String(s).trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4, 8)}`;
  return t;
}
const identityLabel = (v?: string) => {
  const s = (v || '').toLowerCase();
  if (s.includes('corp') || s.includes('body') || s === 'legal') return '法人';
  if (s.includes('natural') || s === 'individual' || s === 'person') return '自然人';
  return v || '—';
};
const roleLabel = (r: string) =>
  r === 'director' ? '董事' : r === 'shareholder' ? '股東' : r === 'secretary' ? '秘書' : r;

function personName(m: { name_english?: string; name_chinese?: string }) {
  const en = (m.name_english || '').trim();
  const cn = (m.name_chinese || '').trim();
  return en && cn ? `${en}（${cn}）` : en || cn || '—';
}

// 董事表格（6.4 / 6.5）
function DirectorsTable({ rows, historical }: { rows: RegisterMember[]; historical?: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{historical ? '無歷史董事記錄' : '無當前董事'}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs">
          <tr>
            <th className="text-left p-2.5">姓名</th>
            <th className="text-left p-2.5">身份</th>
            <th className="text-left p-2.5">身份證／護照</th>
            <th className="text-left p-2.5">委任日期</th>
            {historical && <th className="text-left p-2.5">辭任日期</th>}
            <th className="text-left p-2.5">住址</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={m.person_id + i} className="border-t border-border hover:bg-muted/30">
              <td className="p-2.5 font-medium">{personName(m)}{m.is_reserve ? <Badge variant="outline" className="ml-1 text-[10px]">後備</Badge> : null}</td>
              <td className="p-2.5"><Badge variant="secondary" className="text-xs">{identityLabel(m.identity)}</Badge></td>
              <td className="p-2.5 text-xs">{m.id_number || m.passport_number || '—'}</td>
              <td className="p-2.5 text-xs font-mono">{fmtDate(m.date_appointed)}</td>
              {historical && <td className="p-2.5 text-xs font-mono text-destructive">{fmtDate(m.date_ceased)}</td>}
              <td className="p-2.5 text-xs text-muted-foreground max-w-xs truncate" title={m.address}>{m.address || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 股東表格（6.2 / 6.3）
function ShareholdersTable({ rows, historical }: { rows: RegisterMember[]; historical?: boolean }) {
  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.shares) || 0), 0), [rows]);
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{historical ? '無歷史股東記錄' : '無當前股東'}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs">
          <tr>
            <th className="text-left p-2.5">股東</th>
            <th className="text-right p-2.5">持股數</th>
            <th className="text-left p-2.5">股份類別</th>
            <th className="text-left p-2.5">貨幣</th>
            <th className="text-right p-2.5">已繳／未繳</th>
            <th className="text-right p-2.5">佔比</th>
            {historical && <th className="text-left p-2.5">辭任日期</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={m.person_id + i} className="border-t border-border hover:bg-muted/30">
              <td className="p-2.5 font-medium">{personName(m)}</td>
              <td className="p-2.5 text-right font-mono">{Number(m.shares || 0).toLocaleString()}</td>
              <td className="p-2.5 text-xs">{m.share_type || '普通股'}</td>
              <td className="p-2.5 text-xs">{m.currency || '—'}</td>
              <td className="p-2.5 text-right text-xs">{m.paid_up || '—'} / {m.unpaid || '—'}</td>
              <td className="p-2.5 text-right text-xs">{total ? `${((Number(m.shares) || 0) * 100 / total).toFixed(2)}%` : '—'}</td>
              {historical && <td className="p-2.5 text-xs font-mono text-destructive">{fmtDate(m.date_ceased)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!historical && <p className="text-xs text-muted-foreground p-2.5">總發行股數：{total.toLocaleString()}</p>}
    </div>
  );
}

const Search = () => {
  const { data: companies = [] } = useCompanies();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const { data: results = [], isFetching } = useGlobalSearch(query);
  const [companyId, setCompanyId] = useState('');
  const { data: reg, isLoading: regLoading } = useCompanyRegisters(companyId || undefined);

  // 從頂欄全域搜尋跳轉：?q= 預填搜尋框、?company= 直接載入該公司登記冊
  useEffect(() => {
    const q = searchParams.get('q');
    const cid = searchParams.get('company');
    if (q) setQuery(q);
    if (cid) {
      setCompanyId(cid);
      setTimeout(() => document.getElementById('registers-section')?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [searchParams]);

  const selectCompany = (id: string) => {
    setCompanyId(id);
    // 捲動到登記冊區
    setTimeout(() => document.getElementById('registers-section')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const natureBadges = (s: any) => {
    const items: [string, any][] = [
      ['持股', s.nature_shares], ['投票權', s.nature_voting], ['委任權', s.nature_appoint],
      ['影響力', s.nature_influence], ['信託', s.nature_trust], ['其他', s.nature_other],
    ];
    const active = items.filter(([, v]) => v && v !== '0' && v !== 0 && v !== '');
    if (active.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
    return <div className="flex flex-wrap gap-1">{active.map(([k]) => <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>)}</div>;
  };

  return (
    <div>
      <PageHeader
        title="歷史檢索"
        description="全域搜尋公司與自然人，並查閲公司當前／歷史董事、股東、股份轉讓及重要控制人登記冊"
      />

      {/* 6.1 全域搜尋 */}
      <div className="mb-6">
        <div className="relative max-w-xl">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="輸入公司名稱／編號、或人員姓名／證件號…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {query.trim() && (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {results.length === 0 && !isFetching && (
              <p className="text-sm text-muted-foreground">無符合「{query}」的結果。</p>
            )}
            {results.map((r: SearchResult) => r.type === 'company' ? (
              <button key={`c-${r.id}`} onClick={() => selectCompany(r.id)}
                className="flex items-center gap-3 p-3 rounded-md border border-border bg-card hover:border-primary/50 hover:bg-muted/30 text-left transition-colors">
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.chinese_name || '—'}　·　BR {r.company_number || '—'}
                  </div>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">公司</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ) : (
              <div key={`p-${r.id}`}
                className="flex items-center gap-3 p-3 rounded-md border border-border bg-card">
                <div className="h-8 w-8 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0">
                  <User className="h-4 w-4 text-blue-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{personName(r)}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {identityLabel(r.identity)}
                    {r.roles.length > 0 && '　·　' + r.roles.slice(0, 2).map(x => `${roleLabel(x.role)}@${x.company_name}`).join('、')}
                  </div>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">人員</Badge>
                {r.roles.length > 0 && (
                  <button onClick={() => selectCompany(r.roles[0].company_id)}
                    className="text-xs text-primary hover:underline shrink-0 flex items-center gap-0.5">
                    查登記冊 <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6.2–6.6 公司登記冊 */}
      <div id="registers-section" className="border-t border-border pt-6">
        <div className="flex items-center gap-3 mb-4 max-w-xl">
          <Label className="text-xs whitespace-nowrap">公司登記冊：</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="選擇公司查閲登記冊…" /></SelectTrigger>
            <SelectContent>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}{c.chineseName ? `（${c.chineseName}）` : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!companyId ? (
          <p className="text-sm text-muted-foreground">請選擇公司，或於上方搜尋後點擊結果。</p>
        ) : regLoading || !reg ? (
          <p className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-1" />載入中…</p>
        ) : (
          <Tabs defaultValue="cur-dir">
            <TabsList className="mb-4 flex-wrap h-auto">
              <TabsTrigger value="cur-dir">當前董事<Badge variant="secondary" className="ml-1 text-xs">{reg.current_directors.length}</Badge></TabsTrigger>
              <TabsTrigger value="his-dir" className="gap-1"><History className="h-3 w-3" />歷史董事<Badge variant="secondary" className="ml-1 text-xs">{reg.historical_directors.length}</Badge></TabsTrigger>
              <TabsTrigger value="cur-sh">當前股東<Badge variant="secondary" className="ml-1 text-xs">{reg.current_shareholders.length}</Badge></TabsTrigger>
              <TabsTrigger value="his-sh" className="gap-1"><History className="h-3 w-3" />歷史股東<Badge variant="secondary" className="ml-1 text-xs">{reg.historical_shareholders.length}</Badge></TabsTrigger>
              <TabsTrigger value="tx">股份轉讓<Badge variant="secondary" className="ml-1 text-xs">{reg.share_transactions.length}</Badge></TabsTrigger>
              <TabsTrigger value="scr">重要控制人<Badge variant="secondary" className="ml-1 text-xs">{reg.scr.length}</Badge></TabsTrigger>
            </TabsList>

            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <TabsContent value="cur-dir" className="m-0"><DirectorsTable rows={reg.current_directors} /></TabsContent>
              <TabsContent value="his-dir" className="m-0"><DirectorsTable rows={reg.historical_directors} historical /></TabsContent>
              <TabsContent value="cur-sh" className="m-0"><ShareholdersTable rows={reg.current_shareholders} /></TabsContent>
              <TabsContent value="his-sh" className="m-0"><ShareholdersTable rows={reg.historical_shareholders} historical /></TabsContent>

              <TabsContent value="tx" className="m-0">
                {reg.share_transactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">無股份轉讓記錄</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs">
                        <tr>
                          <th className="text-left p-2.5">日期</th>
                          <th className="text-left p-2.5">類型</th>
                          <th className="text-left p-2.5">轉讓方</th>
                          <th className="text-left p-2.5">承讓方</th>
                          <th className="text-right p-2.5">股數</th>
                          <th className="text-right p-2.5">對價</th>
                          <th className="text-left p-2.5">文書編號</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reg.share_transactions.map(t => (
                          <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                            <td className="p-2.5 text-xs font-mono">{fmtDate(t.transaction_date)}</td>
                            <td className="p-2.5"><Badge variant="outline" className="text-xs">{t.transaction_type || '轉讓'}</Badge></td>
                            <td className="p-2.5">{t.from_name || '—'}</td>
                            <td className="p-2.5">{t.to_name || '—'}</td>
                            <td className="p-2.5 text-right font-mono">{Number(t.shares || 0).toLocaleString()}</td>
                            <td className="p-2.5 text-right text-xs">{t.currency} {t.total_consideration || '—'}</td>
                            <td className="p-2.5 text-xs">{t.instrument_number || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="scr" className="m-0">
                {reg.scr.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">無重要控制人記錄</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs">
                        <tr>
                          <th className="text-left p-2.5">姓名</th>
                          <th className="text-left p-2.5">身份證明</th>
                          <th className="text-left p-2.5">控制性質</th>
                          <th className="text-left p-2.5">成為日期</th>
                          <th className="text-left p-2.5">指定代表</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reg.scr.map(s => (
                          <tr key={s.id} className="border-t border-border hover:bg-muted/30 align-top">
                            <td className="p-2.5 font-medium">{personName(s)}</td>
                            <td className="p-2.5 text-xs">{s.id_number || '—'}</td>
                            <td className="p-2.5">{natureBadges(s)}</td>
                            <td className="p-2.5 text-xs font-mono">{fmtDate(s.date_became)}</td>
                            <td className="p-2.5 text-xs">
                              {s.is_designated_rep || s.designated_rep_name
                                ? <>{s.designated_rep_name || '—'}{s.designated_rep_contact ? <div className="text-muted-foreground">{s.designated_rep_contact}</div> : null}</>
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        )}
      </div>
    </div>
  );
};

export default Search;
