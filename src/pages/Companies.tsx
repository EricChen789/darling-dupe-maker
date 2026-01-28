import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Search, RefreshCw, Plus, Edit, Trash2 } from 'lucide-react';
import { mockCompanies as initialCompanies } from '@/data/mockData';
import { Company } from '@/types';
import { CompanyDialog, DeleteConfirmDialog } from '@/components/dialogs/CompanyDialogs';
import { toast } from '@/hooks/use-toast';

const Companies = () => {
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  
  // Dialog states
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);
  
  const filteredCompanies = companies.filter(company =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    company.brNumber.includes(searchTerm) ||
    company.tradingName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleRefresh = () => {
    setCompanies([...initialCompanies]);
    setSearchTerm('');
    toast({
      title: '已重新整理',
      description: '公司列表已更新',
    });
  };

  const handleAddCompany = () => {
    setSelectedCompany(null);
    setCompanyDialogOpen(true);
  };

  const handleEditCompany = (company: Company) => {
    setSelectedCompany(company);
    setCompanyDialogOpen(true);
  };

  const handleDeleteClick = (company: Company) => {
    setCompanyToDelete(company);
    setDeleteDialogOpen(true);
  };

  const handleSaveCompany = (companyData: Partial<Company>) => {
    if (selectedCompany) {
      // Edit existing
      setCompanies(companies.map(c =>
        c.id === selectedCompany.id
          ? { ...c, ...companyData, updatedAt: new Date().toLocaleDateString('zh-TW').replace(/\//g, '/') }
          : c
      ));
    } else {
      // Add new
      const newCompany: Company = {
        id: `${Date.now()}`,
        name: companyData.name || '',
        brNumber: companyData.brNumber || '',
        tradingName: companyData.tradingName || '',
        businessNature: companyData.businessNature || '',
        directors: [],
        secretaries: [],
        shareholders: [],
        companyType: companyData.companyType || '私人公司 Private company',
        businessCode: companyData.businessCode || '',
        updatedAt: new Date().toLocaleDateString('zh-TW').replace(/\//g, '/'),
      };
      setCompanies([...companies, newCompany]);
    }
  };

  const handleConfirmDelete = () => {
    if (companyToDelete) {
      setCompanies(companies.filter(c => c.id !== companyToDelete.id));
      toast({
        title: '公司已刪除',
        description: `${companyToDelete.name} 已成功刪除`,
      });
      setDeleteDialogOpen(false);
      setCompanyToDelete(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="公司管理"
        description="管理客戶公司資料及註冊資訊"
        actions={
          <div className="flex items-center gap-2">
            <Button 
              variant={showSearch ? "default" : "outline"} 
              size="sm"
              onClick={() => setShowSearch(!showSearch)}
              className={showSearch ? "bg-primary text-primary-foreground" : ""}
            >
              <Search className="h-4 w-4 mr-2" />
              搜尋
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              重新整理
            </Button>
            <Button 
              size="sm" 
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleAddCompany}
            >
              <Plus className="h-4 w-4 mr-2" />
              新增公司
            </Button>
          </div>
        }
      />

      {/* Search Bar */}
      {showSearch && (
        <div className="bg-card border border-border rounded-lg p-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                placeholder="搜尋公司名稱、商業登記號碼或商業名稱..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => setSearchTerm('')}>
              清除
            </Button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard label="總公司數" value={companies.length} />
        <StatCard label="目前顯示" value={filteredCompanies.length} valueClassName="text-primary" />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-medium">公司名稱</TableHead>
              <TableHead className="font-medium">商業登記號碼</TableHead>
              <TableHead className="font-medium">商業名稱</TableHead>
              <TableHead className="font-medium">業務性質</TableHead>
              <TableHead className="font-medium">董事</TableHead>
              <TableHead className="font-medium">秘書</TableHead>
              <TableHead className="font-medium">股東</TableHead>
              <TableHead className="font-medium">公司類型</TableHead>
              <TableHead className="font-medium">業務代碼</TableHead>
              <TableHead className="font-medium">更新日期</TableHead>
              <TableHead className="font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCompanies.map((company) => (
              <TableRow key={company.id} className="hover:bg-muted/30">
                <TableCell className="font-medium max-w-[200px]">
                  <div className="truncate">{company.name}</div>
                </TableCell>
                <TableCell>{company.brNumber}</TableCell>
                <TableCell className="max-w-[150px]">
                  <div className="truncate">{company.tradingName}</div>
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="truncate">{company.businessNature}</div>
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="text-xs space-y-0.5">
                    {company.directors.length > 0 ? (
                      company.directors.slice(0, 3).map((d, i) => (
                        <div key={i} className="truncate">
                          {d.nameChinese} {d.nameEnglish}
                        </div>
                      ))
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                    {company.directors.length > 3 && (
                      <div className="text-muted-foreground">+{company.directors.length - 3} 更多</div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <div className="text-xs space-y-0.5">
                    {company.secretaries.length > 0 ? (
                      company.secretaries.slice(0, 2).map((s, i) => (
                        <div key={i} className="truncate">
                          {s.nameChinese} {s.nameEnglish}
                        </div>
                      ))
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[150px]">
                  <div className="text-xs space-y-0.5">
                    {company.shareholders.length > 0 ? (
                      company.shareholders.slice(0, 2).map((sh, i) => (
                        <div key={i} className="truncate">
                          {sh.name}
                          <br />
                          <span className="text-muted-foreground">{sh.shares} 股</span>
                        </div>
                      ))
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs">{company.companyType}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                    {company.businessCode}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{company.updatedAt}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 px-2"
                      onClick={() => handleEditCompany(company)}
                    >
                      <Edit className="h-4 w-4" />
                      <span className="ml-1">編輯</span>
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 px-2 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteClick(company)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="ml-1">刪除</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="text-sm text-muted-foreground">
            共 {companies.length} 間公司
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">每頁:</span>
            <Select defaultValue="20">
              <SelectTrigger className="w-20 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 筆</SelectItem>
                <SelectItem value="20">20 筆</SelectItem>
                <SelectItem value="50">50 筆</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground ml-2">
              顯示 1 到 {filteredCompanies.length} 筆，共 {filteredCompanies.length} 筆資料
            </span>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <CompanyDialog
        open={companyDialogOpen}
        onOpenChange={setCompanyDialogOpen}
        company={selectedCompany}
        onSave={handleSaveCompany}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="確認刪除公司"
        description={`您確定要刪除「${companyToDelete?.name}」嗎？此操作無法復原。`}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};

export default Companies;
