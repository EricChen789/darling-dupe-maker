import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
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
import { Search, RefreshCw, Plus, Edit, Trash2, X } from 'lucide-react';
import { mockPeople } from '@/data/mockData';

const People = () => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredPeople = mockPeople.filter(person =>
    person.nameChinese.toLowerCase().includes(searchTerm.toLowerCase()) ||
    person.nameEnglish.toLowerCase().includes(searchTerm.toLowerCase()) ||
    person.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (person.brNumber && person.brNumber.includes(searchTerm))
  );

  const getIdentityLabel = (identity: string) => {
    return identity === 'natural' ? '自然人' : '法人';
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'director': return '董事';
      case 'secretary': return '秘書';
      case 'shareholder': return '股東';
      default: return role;
    }
  };

  return (
    <div>
      <PageHeader
        title="人員管理"
        description="管理公司人員資料"
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
              新增人員
            </Button>
          </div>
        }
      />

      {/* Search Box */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">搜尋人員</span>
        </div>
        <div className="mb-3">
          <div className="text-sm text-muted-foreground mb-2">
            搜尋關鍵字 <span className="text-xs">姓名、電郵、身份證號碼等</span>
          </div>
          <Input
            placeholder="輸入關鍵字搜尋人員"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-xl"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setSearchTerm('')}>
            <X className="h-4 w-4 mr-1" />
            清除
          </Button>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Search className="h-4 w-4 mr-1" />
            搜尋
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-medium">姓名</TableHead>
              <TableHead className="font-medium">電郵</TableHead>
              <TableHead className="font-medium">身分</TableHead>
              <TableHead className="font-medium">類型</TableHead>
              <TableHead className="font-medium">商業登記號碼</TableHead>
              <TableHead className="font-medium">關聯公司</TableHead>
              <TableHead className="font-medium">建立日期</TableHead>
              <TableHead className="font-medium">更新日期</TableHead>
              <TableHead className="font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPeople.map((person) => (
              <TableRow key={person.id} className="hover:bg-muted/30">
                <TableCell className="font-medium">
                  <div>
                    <div>{person.nameChinese}</div>
                    <div className="text-xs text-muted-foreground">({person.nameEnglish})</div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{person.email}</TableCell>
                <TableCell>
                  <StatusBadge variant={person.identity}>
                    {getIdentityLabel(person.identity)}
                  </StatusBadge>
                </TableCell>
                <TableCell>
                  <StatusBadge variant={person.role}>
                    {getRoleLabel(person.role)}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-sm">
                  {person.brNumber || <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell className="max-w-[300px]">
                  <div className="text-xs space-y-0.5">
                    {person.companies.map((c, i) => (
                      <div key={i} className="truncate">
                        {c.name} ({c.brNumber})
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{person.createdAt}</TableCell>
                <TableCell className="text-sm">{person.updatedAt}</TableCell>
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
      </div>
    </div>
  );
};

export default People;
