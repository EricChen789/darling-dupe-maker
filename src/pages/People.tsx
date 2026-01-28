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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, RefreshCw, Plus, Edit, Trash2, X } from 'lucide-react';
import { mockPeople as initialPeople } from '@/data/mockData';
import { Person } from '@/types';
import { PersonDialog } from '@/components/dialogs/PersonDialogs';
import { DeleteConfirmDialog } from '@/components/dialogs/CompanyDialogs';
import { toast } from '@/hooks/use-toast';

const People = () => {
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Dialog states
  const [personDialogOpen, setPersonDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [personToDelete, setPersonToDelete] = useState<Person | null>(null);
  
  const filteredPeople = people.filter(person =>
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

  const handleRefresh = () => {
    setPeople([...initialPeople]);
    setSearchTerm('');
    toast({
      title: '已重新整理',
      description: '人員列表已更新',
    });
  };

  const handleAddPerson = () => {
    setSelectedPerson(null);
    setPersonDialogOpen(true);
  };

  const handleEditPerson = (person: Person) => {
    setSelectedPerson(person);
    setPersonDialogOpen(true);
  };

  const handleDeleteClick = (person: Person) => {
    setPersonToDelete(person);
    setDeleteDialogOpen(true);
  };

  const handleSavePerson = (personData: Partial<Person>) => {
    const now = new Date().toLocaleDateString('zh-TW').replace(/\//g, '/');
    if (selectedPerson) {
      // Edit existing
      setPeople(people.map(p =>
        p.id === selectedPerson.id
          ? { ...p, ...personData, updatedAt: now }
          : p
      ));
    } else {
      // Add new
      const newPerson: Person = {
        id: `p${Date.now()}`,
        nameChinese: personData.nameChinese || '',
        nameEnglish: personData.nameEnglish || '',
        email: personData.email || '',
        identity: personData.identity || 'natural',
        role: personData.role || 'director',
        brNumber: personData.brNumber,
        companies: [],
        createdAt: now,
        updatedAt: now,
      };
      setPeople([...people, newPerson]);
    }
  };

  const handleConfirmDelete = () => {
    if (personToDelete) {
      setPeople(people.filter(p => p.id !== personToDelete.id));
      toast({
        title: '人員已刪除',
        description: `${personToDelete.nameChinese || personToDelete.nameEnglish} 已成功刪除`,
      });
      setDeleteDialogOpen(false);
      setPersonToDelete(null);
    }
  };

  const handleClearSearch = () => {
    setSearchTerm('');
  };

  const handleSearch = () => {
    toast({
      title: '搜尋完成',
      description: `找到 ${filteredPeople.length} 筆結果`,
    });
  };

  return (
    <div>
      <PageHeader
        title="人員管理"
        description="管理公司人員資料"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSearch}>
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
              onClick={handleAddPerson}
            >
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
          <Button variant="outline" size="sm" onClick={handleClearSearch}>
            <X className="h-4 w-4 mr-1" />
            清除
          </Button>
          <Button 
            size="sm" 
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleSearch}
          >
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
                    {person.companies.length > 0 ? (
                      person.companies.map((c, i) => (
                        <div key={i} className="truncate">
                          {c.name} ({c.brNumber})
                        </div>
                      ))
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{person.createdAt}</TableCell>
                <TableCell className="text-sm">{person.updatedAt}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 px-2"
                      onClick={() => handleEditPerson(person)}
                    >
                      <Edit className="h-4 w-4" />
                      <span className="ml-1">編輯</span>
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 px-2 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteClick(person)}
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
            共 {people.length} 位人員
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
              顯示 1 到 {filteredPeople.length} 筆，共 {filteredPeople.length} 筆資料
            </span>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <PersonDialog
        open={personDialogOpen}
        onOpenChange={setPersonDialogOpen}
        person={selectedPerson}
        onSave={handleSavePerson}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="確認刪除人員"
        description={`您確定要刪除「${personToDelete?.nameChinese || personToDelete?.nameEnglish}」嗎？此操作無法復原。`}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};

export default People;
