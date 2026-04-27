import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, AlertTriangle, Search, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

type CompanyRow = {
  id: string;
  name: string;
  chinese_name: string | null;
  company_number: string | null;
  ci_number: string | null;
  status: string | null;
  incorporation_date: string | null;
  jurisdiction: string | null;
};

type OfficerRow = {
  company_id: string;
  role: string;
  date_ceased: string | null;
};

type MissingFilter = 'all' | 'director' | 'secretary' | 'both';

const MissingOfficers = () => {
  const [search, setSearch] = useState('');
  const [missingFilter, setMissingFilter] = useState<MissingFilter>('all');

  const fetchAll = async <T,>(
    table: 'companies' | 'officers',
    columns: string,
  ): Promise<T[]> => {
    const pageSize = 1000;
    let from = 0;
    const all: T[] = [];
    // Loop until a page returns less than pageSize
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const batch = (data || []) as T[];
      all.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
      if (from > 100000) break; // safety
    }
    return all;
  };

  const { data: companies, isLoading: loadingCompanies } = useQuery({
    queryKey: ['missing-officers-companies-v2'],
    queryFn: () => fetchAll<CompanyRow>('companies', 'id, name, chinese_name, company_number, ci_number, status, incorporation_date, jurisdiction'),
  });

  const { data: officers, isLoading: loadingOfficers } = useQuery({
    queryKey: ['missing-officers-officers-v2'],
    queryFn: () => fetchAll<OfficerRow>('officers', 'company_id, role, date_ceased'),
  });

  const rows = useMemo(() => {
    if (!companies || !officers) return [];

    const directorByCompany = new Set<string>();
    const secretaryByCompany = new Set<string>();
    for (const o of officers) {
      if (o.date_ceased && o.date_ceased.trim() !== '') continue;
      const role = (o.role || '').toLowerCase();
      if (role.includes('director')) directorByCompany.add(o.company_id);
      if (role.includes('secretary')) secretaryByCompany.add(o.company_id);
    }

    const enriched = companies.map((c) => ({
      ...c,
      missingDirector: !directorByCompany.has(c.id),
      missingSecretary: !secretaryByCompany.has(c.id),
    }));

    // Only keep ones missing at least one AND still active AND not BVI
    return enriched.filter((c) => {
      if (!(c.missingDirector || c.missingSecretary)) return false;
      if (c.status !== 'active') return false;
      const j = (c.jurisdiction || '').toLowerCase();
      if (j.includes('bvi') || j.includes('british virgin')) return false;
      return true;
    });
  }, [companies, officers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (missingFilter === 'director' && !r.missingDirector) return false;
        if (missingFilter === 'secretary' && !r.missingSecretary) return false;
        if (missingFilter === 'both' && !(r.missingDirector && r.missingSecretary)) return false;
        if (!q) return true;
        return (
          (r.name || '').toLowerCase().includes(q) ||
          (r.chinese_name || '').toLowerCase().includes(q) ||
          (r.company_number || '').toLowerCase().includes(q) ||
          (r.ci_number || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rows, search, missingFilter]);

  const stats = useMemo(() => {
    const activeRows = rows.filter((r) => r.status === 'active');
    return {
      missingDirector: activeRows.filter((r) => r.missingDirector).length,
      missingSecretary: activeRows.filter((r) => r.missingSecretary).length,
      missingBoth: activeRows.filter((r) => r.missingDirector && r.missingSecretary).length,
      total: activeRows.length,
    };
  }, [rows]);

  const isLoading = loadingCompanies || loadingOfficers;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            仍缺董事/秘書清單
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            列出沒有有效（未離任）董事或秘書的公司，方便補齊。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="總缺失，依然有效的公司" value={stats.total} />
        <StatCard label="缺董事" value={stats.missingDirector} tone="amber" />
        <StatCard label="缺秘書" value={stats.missingSecretary} tone="amber" />
        <StatCard label="兩者皆缺" value={stats.missingBoth} tone="red" />
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋公司名稱 / 中文名 / BR 號碼 / CI 號碼"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={missingFilter} onValueChange={(v) => setMissingFilter(v as MissingFilter)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部缺失類型</SelectItem>
            <SelectItem value="director">只缺董事</SelectItem>
            <SelectItem value="secretary">只缺秘書</SelectItem>
            <SelectItem value="both">兩者皆缺</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>公司名稱</TableHead>
                <TableHead>中文名稱</TableHead>
                <TableHead>司法管轄區</TableHead>
                <TableHead>BR 號碼</TableHead>
                <TableHead>CI 號碼</TableHead>
                <TableHead>成立日期</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>缺失欄位</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    沒有符合條件的記錄
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.chinese_name || '-'}</TableCell>
                    <TableCell className="text-xs">{r.jurisdiction || <span className="text-muted-foreground italic">未填寫</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{r.company_number || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{r.ci_number || '-'}</TableCell>
                    <TableCell className="text-xs">{r.incorporation_date || <span className="text-muted-foreground italic">未填寫</span>}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'active' || !r.status ? 'default' : 'secondary'}>
                        {r.status === 'inactive' ? '失效' : r.status === 'cancelled' ? '註銷' : '有效'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {r.missingDirector && (
                          <Badge variant="destructive" className="text-xs">
                            缺董事
                          </Badge>
                        )}
                        {r.missingSecretary && (
                          <Badge variant="destructive" className="text-xs">
                            缺秘書
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/companies?open=${r.id}`}>
                          開啟 <ExternalLink className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        顯示 {filtered.length} / {rows.length} 間缺失公司
      </p>
    </div>
  );
};

const StatCard = ({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'amber' | 'red';
}) => {
  const toneClass =
    tone === 'red'
      ? 'text-destructive'
      : tone === 'amber'
      ? 'text-amber-600'
      : 'text-foreground';
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
    </div>
  );
};

export default MissingOfficers;
