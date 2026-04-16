import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, AlertTriangle, Loader2, Trash2, Edit, Save, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

// ---- Bad name detection (ported from Python script) ----

const BAD_NAMES = new Set([
  'CHINESE','HONG KONG','BRITISH','SINGAPORE','MALAYSIAN','AMERICAN',
  'INDIAN','KONG','DIRECTOR','SECRETARY','MERCHANT','CHINA','MALAYSIA',
  'TAIWAN','JAPAN','KOREA','THAILAND','PHILIPPINES','INDONESIA',
  'AUSTRALIA','CANADA','UK','USA','MACAU','MACAO','VIETNAM',
  'FOREIGN AFFAIRS ON','BRITISH VIRGIN ISLANDS','SEYCHELLES',
  'OTHER','RESIGNED','TAIWANESE','PRESIDENT','CORPORATION',
  'KINGDOM','B.V.I','REPUBLIC OF CHINA','ACCOUNTANT','ENGINEER',
  'LAWYER','RETIRED','BUSINESSMAN','TRADER','MANAGER','CONSULTANT',
  'EXECUTIVE','CLERK','TEACHER','DOCTOR','PROFESSIONAL','HOUSEWIFE',
  'STUDENT','ADMINISTRATOR','ANALYST','BANKER','BROKER','CHAIRMAN',
]);

const ADDRESS_KEYWORDS = /\b(ROAD|STREET|BUILDING|FLOOR|TOWER|ROOM|FLAT|BLOCK|HOUSE|AVE|WORKSHOP|DISTRICT|CITY|PROVINCE|COUNTY|AVENUE|DRIVE|BOULEVARD|LANE|CRESCENT|COURT|PLACE|TERRACE|GARDEN)\b/i;
const LOCATION_KEYWORDS = /\b(HONG KONG|KOWLOON|NEW TERRITORIES|SHANGHAI|SHENZHEN|BEIJING|SHATIN|TSIM SHA TSUI|MONG KOK|WAN CHAI|CAUSEWAY BAY|CENTRAL|ADMIRALTY)\b/i;
const HK_ID_PATTERN = /^[A-Z]{1,2}\d{5,8}\(\d\)$/;
const SG_ID_PATTERN = /^[A-Z]\d{7}[A-Z]$/;
const DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/;

function isBadName(name: string | null | undefined): boolean {
  if (!name || name.trim().length < 3) return true;
  const n = name.trim().toUpperCase();
  if (BAD_NAMES.has(n)) return true;
  if (n.startsWith('PASSPORT NUMBER') || n.startsWith('PASSPORT NO')) return true;
  if (n.startsWith('ID NUMBER') || n.startsWith('ID NO')) return true;
  if (n.startsWith('PREVIOUS APPOINTMENTS')) return true;
  if (n.startsWith('ON ') && /\d{2}\/\d{2}\/\d{4}/.test(n)) return true;
  if (HK_ID_PATTERN.test(n) || SG_ID_PATTERN.test(n)) return true;
  if (DATE_PATTERN.test(n)) return true;
  if (/^\d/.test(n)) return true;
  if (ADDRESS_KEYWORDS.test(n)) return true;
  if (LOCATION_KEYWORDS.test(n) && !/[\u4e00-\u9fff]/.test(name)) return true;
  if (/,\s*(CHINA|TAIWAN|SAMOA|BVI|VIRGIN)\s*$/i.test(n)) return true;
  if (/\b(ZONE|AREA|NEW TOWN|INDUSTRIAL)\b/i.test(n)) return true;
  return false;
}

type IssueType = 'bad_name' | 'no_address' | 'all';

interface OfficerRecord {
  id: string;
  company_id: string;
  name_english: string;
  name_chinese: string | null;
  role: string;
  address: string | null;
  identity: string;
  id_number: string | null;
  date_appointed: string | null;
  date_ceased: string | null;
  company_name?: string;
  company_number?: string;
}

const Repair = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [issueFilter, setIssueFilter] = useState<IssueType>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name_english: string; name_chinese: string; address: string }>({ name_english: '', name_chinese: '', address: '' });
  const [deleteTarget, setDeleteTarget] = useState<OfficerRecord | null>(null);

  // Fetch all officers + companies (paginated to bypass 1000-row default)
  const { data: officers = [], isLoading } = useQuery({
    queryKey: ['repair-officers'],
    queryFn: async () => {
      // Paginate officers
      const allOfficers: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('officers')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allOfficers.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // Paginate companies
      const allCompanies: any[] = [];
      from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('companies')
          .select('id, name, company_number')
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allCompanies.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      const companyMap = new Map(
        allCompanies.map(c => [c.id, { name: c.name, number: c.company_number }])
      );

      return allOfficers.map(o => {
        const company = companyMap.get(o.company_id);
        return {
          ...o,
          company_name: company?.name || '未知公司',
          company_number: company?.number || '',
        } as OfficerRecord;
      });
    },
  });

  // Stats
  const stats = useMemo(() => {
    const total = officers.length;
    const badName = officers.filter(o => isBadName(o.name_english)).length;
    const noAddress = officers.filter(o => !o.address || !o.address.trim()).length;
    const healthy = total - badName;
    return { total, badName, noAddress, healthy };
  }, [officers]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = officers;
    if (issueFilter === 'bad_name') {
      list = list.filter(o => isBadName(o.name_english));
    } else if (issueFilter === 'no_address') {
      list = list.filter(o => !o.address || !o.address.trim());
    } else {
      // Show all problematic records
      list = list.filter(o => isBadName(o.name_english) || !o.address || !o.address.trim());
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(o =>
        o.name_english.toLowerCase().includes(s) ||
        (o.name_chinese || '').toLowerCase().includes(s) ||
        (o.company_name || '').toLowerCase().includes(s) ||
        (o.company_number || '').includes(s)
      );
    }
    return list;
  }, [officers, issueFilter, search]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string | null> }) => {
      const { error } = await supabase.from('officers').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-officers'] });
      queryClient.invalidateQueries({ queryKey: ['officers-people'] });
      setEditingId(null);
      toast({ title: '已更新', description: '記錄已成功修復' });
    },
    onError: (err: Error) => {
      toast({ title: '更新失敗', description: err.message, variant: 'destructive' });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('officers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-officers'] });
      queryClient.invalidateQueries({ queryKey: ['officers-people'] });
      setDeleteTarget(null);
      toast({ title: '已刪除', description: '垃圾記錄已移除' });
    },
  });

  const startEdit = (o: OfficerRecord) => {
    setEditingId(o.id);
    setEditForm({
      name_english: o.name_english || '',
      name_chinese: o.name_chinese || '',
      address: o.address || '',
    });
  };

  const saveEdit = () => {
    if (!editingId) return;
    updateMutation.mutate({
      id: editingId,
      data: {
        name_english: editForm.name_english,
        name_chinese: editForm.name_chinese || null,
        address: editForm.address || null,
      },
    });
  };

  const getIssues = (o: OfficerRecord) => {
    const issues: { type: string; label: string; color: string }[] = [];
    if (isBadName(o.name_english)) {
      issues.push({ type: 'bad_name', label: '名字異常', color: 'destructive' });
    }
    if (!o.address || !o.address.trim()) {
      issues.push({ type: 'no_address', label: '缺少地址', color: 'secondary' });
    }
    return issues;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="數據修復"
        description="檢查並修復董事/秘書記錄中的異常數據（垃圾名字、缺少地址等）"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="總記錄數" value={stats.total} />
        <StatCard label="名字異常" value={stats.badName} valueClassName="text-destructive" />
        <StatCard label="缺少地址" value={stats.noAddress} valueClassName="text-orange-500" />
        <StatCard label="正常記錄" value={stats.healthy} valueClassName="text-primary" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋名字、公司..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={issueFilter} onValueChange={v => setIssueFilter(v as IssueType)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有異常</SelectItem>
            <SelectItem value="bad_name">名字異常</SelectItem>
            <SelectItem value="no_address">缺少地址</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>英文名</TableHead>
                <TableHead>中文名</TableHead>
                <TableHead>公司</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>地址</TableHead>
                <TableHead>問題</TableHead>
                <TableHead className="w-[100px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {issueFilter === 'all' ? '🎉 沒有發現異常記錄！' : '沒有符合條件的記錄'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.slice(0, 200).map((o, idx) => {
                  const issues = getIssues(o);
                  const isEditing = editingId === o.id;
                  return (
                    <TableRow key={o.id} className={isBadName(o.name_english) ? 'bg-destructive/5' : ''}>
                      <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                      <TableCell className="max-w-[200px]">
                        {isEditing ? (
                          <Input
                            value={editForm.name_english}
                            onChange={e => setEditForm(f => ({ ...f, name_english: e.target.value }))}
                            className="h-8 text-sm"
                          />
                        ) : (
                          <span className={isBadName(o.name_english) ? 'text-destructive font-medium' : ''}>
                            {o.name_english || '(空)'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editForm.name_chinese}
                            onChange={e => setEditForm(f => ({ ...f, name_chinese: e.target.value }))}
                            className="h-8 text-sm"
                          />
                        ) : (
                          o.name_chinese || '-'
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-sm">
                        <span title={o.company_name}>{o.company_name}</span>
                        {o.company_number && (
                          <span className="text-muted-foreground text-xs ml-1">({o.company_number})</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{o.role}</TableCell>
                      <TableCell className="max-w-[200px]">
                        {isEditing ? (
                          <Input
                            value={editForm.address}
                            onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                            className="h-8 text-sm"
                          />
                        ) : (
                          <span className={!o.address?.trim() ? 'text-muted-foreground italic' : 'text-sm truncate block max-w-[200px]'}>
                            {o.address?.trim() || '(無)'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {issues.map(issue => (
                            <Badge key={issue.type} variant={issue.color as any} className="text-xs whitespace-nowrap">
                              {issue.label}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveEdit} disabled={updateMutation.isPending}>
                              <Save className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(o)}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(o)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {filtered.length > 200 && (
            <div className="text-center py-3 text-sm text-muted-foreground border-t">
              顯示前 200 筆，共 {filtered.length} 筆異常記錄
            </div>
          )}
        </div>
      )}

      {/* Delete Confirm Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認刪除</AlertDialogTitle>
            <AlertDialogDescription>
              確定要刪除「{deleteTarget?.name_english}」嗎？此操作無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Repair;
