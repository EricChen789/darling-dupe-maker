import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, RefreshCw, Plus, Edit, Trash2, FileText, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Company } from '@/types';
import { CompanyDialog, DeleteConfirmDialog } from '@/components/dialogs/CompanyDialogs';
import { CompanyDetailDialog } from '@/components/dialogs/CompanyDetailDialog';
import { NAR1Generator } from '@/components/nar1/NAR1Generator';
import { toast } from '@/hooks/use-toast';
import { useCompanies, useDeleteCompany, useAddCompany, useUpdateCompany } from '@/hooks/useCompanies';
import { usePresenters } from '@/hooks/usePresenters';

const Companies = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [nar1DialogOpen, setNar1DialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);
  const [companyForNar1, setCompanyForNar1] = useState<Company | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [companyForDetail, setCompanyForDetail] = useState<Company | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  const { data: companies = [], isLoading, refetch } = useCompanies();
  const { data: presenters = [] } = usePresenters();
  const defaultPresenterId = presenters.find(p => p.name === 'Twinsail Consultants Limited')?.id || '';
  const deleteCompany = useDeleteCompany();
  const addCompany = useAddCompany();
  const updateCompany = useUpdateCompany();

  const handleQuickPresenterChange = (company: Company, presenterId: string) => {
    updateCompany.mutate(
      { id: company.id, data: { preferredPresenterId: presenterId } },
      {
        onSuccess: () => {
          const p = presenters.find(x => x.id === presenterId);
          toast({ title: '已更新提交人', description: `${company.name} → ${p?.name || '(無)'}` });
        },
        onError: (e: any) => toast({ title: '更新失敗', description: e.message, variant: 'destructive' }),
      }
    );
  };

  const filteredCompanies = companies.filter(company =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    company.brNumber.includes(searchTerm) ||
    company.tradingName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(filteredCompanies.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedCompanies = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredCompanies.slice(start, start + pageSize);
  }, [filteredCompanies, safeCurrentPage, pageSize]);

  const handleRefresh = () => {
    refetch();
    setSearchTerm('');
    toast({ title: '已重新整理', description: '公司列表已更新' });
  };

  const handleSaveCompany = (companyData: Partial<Company>) => {
    if (selectedCompany) {
      updateCompany.mutate({ id: selectedCompany.id, data: companyData }, {
        onSuccess: () => toast({ title: '公司已更新', description: `${companyData.name} 已成功更新` }),
      });
    } else {
      addCompany.mutate(companyData, {
        onSuccess: () => toast({ title: '公司已新增', description: `${companyData.name} 已成功新增` }),
      });
    }
  };

  const handleConfirmDelete = () => {
    if (companyToDelete) {
      deleteCompany.mutate(companyToDelete.id, {
        onSuccess: () => {
          toast({ title: '公司已刪除', description: `${companyToDelete.name} 已成功刪除` });
          setDeleteDialogOpen(false);
          setCompanyToDelete(null);
        },
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">載入公司資料中...</span>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="公司管理"
        description={`管理客戶公司資料及註冊資訊（共 ${companies.length} 間）`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant={showSearch ? "default" : "outline"} size="sm" onClick={() => setShowSearch(!showSearch)}
              className={showSearch ? "bg-primary text-primary-foreground" : ""}>
              <Search className="h-4 w-4 mr-2" />搜尋
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />重新整理
            </Button>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => { setSelectedCompany(null); setCompanyDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />新增公司
            </Button>
          </div>
        }
      />

      {showSearch && (
        <div className="bg-card border border-border rounded-lg p-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input placeholder="搜尋公司名稱、商業登記號碼或商業名稱..." value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} />
            </div>
            <Button variant="outline" size="sm" onClick={() => setSearchTerm('')}>清除</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard label="總公司數" value={companies.length} />
        <StatCard label="目前顯示" value={filteredCompanies.length} valueClassName="text-primary" />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-medium">公司名稱</TableHead>
              <TableHead className="font-medium">商業登記號碼</TableHead>
              <TableHead className="font-medium">CI Number</TableHead>
              <TableHead className="font-medium">司法管轄區</TableHead>
              <TableHead className="font-medium">成立日期</TableHead>
              <TableHead className="font-medium">商業名稱</TableHead>
              <TableHead className="font-medium">董事</TableHead>
              <TableHead className="font-medium">秘書</TableHead>
              <TableHead className="font-medium">股東</TableHead>
              <TableHead className="font-medium">提交人 Presenter</TableHead>
              <TableHead className="font-medium">狀態</TableHead>
              <TableHead className="font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedCompanies.map((company) => (
              <TableRow key={company.id} className="hover:bg-muted/30 cursor-pointer"
                onClick={() => { setCompanyForDetail(company); setDetailDialogOpen(true); }}>
                <TableCell className="font-medium max-w-[200px]">
                  <div className="truncate">{company.name}</div>
                  {company.tradingName && (
                    <div className="text-xs text-muted-foreground truncate">{company.tradingName}</div>
                  )}
                </TableCell>
                <TableCell>{company.brNumber}</TableCell>
                <TableCell className="text-xs">
                  {company.jurisdiction ? (
                    <span className={company.jurisdiction !== 'Hong Kong' ? 'font-medium text-primary' : ''}>{company.jurisdiction}</span>
                  ) : <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {company.incorporationDate || <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell className="max-w-[150px]">
                  <div className="truncate">{company.tradingName}</div>
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="text-xs space-y-0.5">
                    {company.directors.length > 0 ? (
                      company.directors.map((d, i) => (
                        <div key={i} className="truncate">{d.nameEnglish || d.nameChinese}</div>
                      ))
                    ) : <span className="text-muted-foreground">-</span>}
                  </div>
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="text-xs space-y-0.5">
                    {company.secretaries.length > 0 ? (
                      company.secretaries.map((s, i) => (
                        <div key={i} className="truncate">{s.nameEnglish || s.nameChinese}</div>
                      ))
                    ) : <span className="text-muted-foreground">-</span>}
                  </div>
                </TableCell>
                <TableCell className="max-w-[150px]" onClick={(e) => e.stopPropagation()}>
                  {company.shareholders.length > 0 ? (
                    <HoverCard openDelay={150} closeDelay={100}>
                      <HoverCardTrigger asChild>
                        <div className="text-xs space-y-0.5 cursor-help">
                          {company.shareholders.map((sh, i) => (
                            <div key={i} className="truncate">
                              {sh.name} <span className="text-muted-foreground">({sh.shares.toLocaleString()} 股)</span>
                            </div>
                          ))}
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent side="left" align="start" className="w-96 max-h-[60vh] overflow-auto p-3">
                        <div className="text-sm font-semibold mb-2 pb-2 border-b">
                          {company.name} — 股東持股明細
                        </div>
                        {(() => {
                          const total = company.shareholders.reduce((s, x) => s + (x.shares || 0), 0);
                          return (
                            <div className="space-y-1.5 text-xs">
                              {company.shareholders.map((sh, i) => {
                                const pct = total > 0 ? ((sh.shares || 0) / total * 100) : 0;
                                return (
                                  <div key={i} className="flex justify-between gap-2">
                                    <span className="flex-1 break-words">{sh.name}</span>
                                    <span className="text-muted-foreground whitespace-nowrap tabular-nums">
                                      {(sh.shares || 0).toLocaleString()} 股 · {pct.toFixed(2)}%
                                    </span>
                                  </div>
                                );
                              })}
                              <div className="flex justify-between gap-2 pt-2 mt-2 border-t font-semibold">
                                <span>總計</span>
                                <span className="tabular-nums">{total.toLocaleString()} 股 · 100.00%</span>
                              </div>
                            </div>
                          );
                        })()}
                      </HoverCardContent>
                    </HoverCard>
                  ) : <span className="text-muted-foreground text-xs">-</span>}
                </TableCell>
                <TableCell className="min-w-[180px]">
                  {(() => {
                    const p = presenters.find(x => x.id === company.preferredPresenterId);
                    return p ? (
                      <span className="text-xs">{p.name}</span>
                    ) : (
                      <span className="text-xs text-destructive">未指定</span>
                    );
                  })()}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()} className="min-w-[110px]">
                  <Select
                    value={company.status || 'active'}
                    onValueChange={(v) => {
                      updateCompany.mutate(
                        { id: company.id, data: { status: v as 'active' | 'inactive' | 'deregistered' } },
                        {
                          onSuccess: () => toast({ title: '狀態已更新', description: `${company.name}` }),
                          onError: (e: any) => toast({ title: '更新失敗', description: e.message, variant: 'destructive' }),
                        }
                      );
                    }}
                  >
                    <SelectTrigger className={`h-8 text-xs ${
                      company.status === 'inactive' ? 'border-yellow-500/50 text-yellow-600' :
                      company.status === 'deregistered' ? 'border-destructive/50 text-destructive' : ''
                    }`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">有效</SelectItem>
                      <SelectItem value="inactive">失效</SelectItem>
                      <SelectItem value="deregistered">註銷</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-8 px-2"
                      onClick={() => { setCompanyForNar1(company); setNar1DialogOpen(true); }} title="生成 NAR1">
                      <FileText className="h-4 w-4" /><span className="ml-1">NAR1</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 px-2"
                      onClick={() => { setSelectedCompany(company); setCompanyDialogOpen(true); }}>
                      <Edit className="h-4 w-4" /><span className="ml-1">編輯</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive"
                      onClick={() => { setCompanyToDelete(company); setDeleteDialogOpen(true); }}>
                      <Trash2 className="h-4 w-4" /><span className="ml-1">刪除</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">每頁顯示</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
              <SelectTrigger className="w-[80px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              顯示第 {(safeCurrentPage - 1) * pageSize + 1} - {Math.min(safeCurrentPage * pageSize, filteredCompanies.length)} 筆，共 {filteredCompanies.length} 筆
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 px-2" disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let page: number;
              if (totalPages <= 5) {
                page = i + 1;
              } else if (safeCurrentPage <= 3) {
                page = i + 1;
              } else if (safeCurrentPage >= totalPages - 2) {
                page = totalPages - 4 + i;
              } else {
                page = safeCurrentPage - 2 + i;
              }
              return (
                <Button key={page} variant={page === safeCurrentPage ? "default" : "outline"} size="sm"
                  className="h-8 w-8 px-0" onClick={() => setCurrentPage(page)}>
                  {page}
                </Button>
              );
            })}
            <Button variant="outline" size="sm" className="h-8 px-2" disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <CompanyDialog open={companyDialogOpen} onOpenChange={setCompanyDialogOpen}
        company={selectedCompany} onSave={handleSaveCompany} />
      <DeleteConfirmDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}
        title="確認刪除公司" description={`您確定要刪除「${companyToDelete?.name}」嗎？此操作無法復原。`}
        onConfirm={handleConfirmDelete} />
      <NAR1Generator open={nar1DialogOpen} onOpenChange={setNar1DialogOpen} company={companyForNar1} />
      <CompanyDetailDialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen} company={companyForDetail} />
    </div>
  );
};

export default Companies;
