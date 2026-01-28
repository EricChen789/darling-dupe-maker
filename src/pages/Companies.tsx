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
import { Search, RefreshCw, Plus, Edit, Trash2 } from 'lucide-react';
import { mockCompanies } from '@/data/mockData';

const Companies = () => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredCompanies = mockCompanies.filter(company =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    company.brNumber.includes(searchTerm)
  );

  return (
    <div>
      <PageHeader
        title="公司管理"
        description="管理客戶公司資料及註冊資訊"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Search className="h-4 w-4 mr-2" />
              搜尋
            </Button>
            <Button variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              重新整理
            </Button>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-2" />
              新增公司
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard label="總公司數" value={mockCompanies.length} />
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
                    <Button variant="ghost" size="sm" className="h-8 px-2">
                      <Edit className="h-4 w-4" />
                      <span className="ml-1">編輯</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive">
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
            共 {mockCompanies.length} 間公司
          </div>
          <div className="text-sm text-muted-foreground">
            顯示 1 到 {filteredCompanies.length} 筆，共 {filteredCompanies.length} 筆資料
          </div>
        </div>
      </div>
    </div>
  );
};

export default Companies;
