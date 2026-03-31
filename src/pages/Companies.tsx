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
import { Search, RefreshCw, Plus, Edit, Trash2, FileText, Loader2 } from 'lucide-react';
import { Company } from '@/types';
import { CompanyDialog, DeleteConfirmDialog } from '@/components/dialogs/CompanyDialogs';
import { CompanyDetailDialog } from '@/components/dialogs/CompanyDetailDialog';
import { NAR1Generator } from '@/components/nar1/NAR1Generator';
import { toast } from '@/hooks/use-toast';
import { useCompanies, useDeleteCompany, useAddCompany, useUpdateCompany } from '@/hooks/useCompanies';

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

  const { data: companies = [], isLoading, refetch } = useCompanies();
  const deleteCompany = useDeleteCompany();
  const addCompany = useAddCompany();
  const updateCompany = useUpdateCompany();

  const filteredCompanies = companies.filter(company =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    company.brNumber.includes(searchTerm) ||
    company.tradingName.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
                onChange={(e) => setSearchTerm(e.target.value)} />
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
              <TableHead className="font-medium">商業名稱</TableHead>
              <TableHead className="font-medium">董事</TableHead>
              <TableHead className="font-medium">秘書</TableHead>
              <TableHead className="font-medium">股東</TableHead>
              <TableHead className="font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCompanies.map((company) => (
              <TableRow key={company.id} className="hover:bg-muted/30 cursor-pointer"
                onClick={() => { setCompanyForDetail(company); setDetailDialogOpen(true); }}>
                <TableCell className="font-medium max-w-[200px]">
                  <div className="truncate">{company.name}</div>
                  {company.tradingName && (
                    <div className="text-xs text-muted-foreground truncate">{company.tradingName}</div>
                  )}
                </TableCell>
                <TableCell>{company.brNumber}</TableCell>
                <TableCell className="max-w-[150px]">
                  <div className="truncate">{company.tradingName}</div>
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="text-xs space-y-0.5">
                    {company.directors.length > 0 ? (
                      company.directors.slice(0, 2).map((d, i) => (
                        <div key={i} className="truncate">{d.nameEnglish || d.nameChinese}</div>
                      ))
                    ) : <span className="text-muted-foreground">-</span>}
                    {company.directors.length > 2 && (
                      <div className="text-muted-foreground">+{company.directors.length - 2} 更多</div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="text-xs space-y-0.5">
                    {company.secretaries.length > 0 ? (
                      company.secretaries.slice(0, 2).map((s, i) => (
                        <div key={i} className="truncate">{s.nameEnglish || s.nameChinese}</div>
                      ))
                    ) : <span className="text-muted-foreground">-</span>}
                  </div>
                </TableCell>
                <TableCell className="max-w-[150px]">
                  <div className="text-xs space-y-0.5">
                    {company.shareholders.length > 0 ? (
                      company.shareholders.slice(0, 2).map((sh, i) => (
                        <div key={i} className="truncate">
                          {sh.name} <span className="text-muted-foreground">({sh.shares} 股)</span>
                        </div>
                      ))
                    ) : <span className="text-muted-foreground">-</span>}
                    {company.shareholders.length > 2 && (
                      <div className="text-muted-foreground">+{company.shareholders.length - 2} 更多</div>
                    )}
                  </div>
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
          <div className="text-sm text-muted-foreground">共 {companies.length} 間公司</div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              顯示 1 到 {filteredCompanies.length} 筆，共 {filteredCompanies.length} 筆資料
            </span>
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
