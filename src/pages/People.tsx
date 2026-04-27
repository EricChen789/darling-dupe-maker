import { useEffect, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';
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
import { Search, RefreshCw, Plus, Edit, Trash2, X, Loader2 } from 'lucide-react';
import { Person } from '@/types';
import { PersonDialog } from '@/components/dialogs/PersonDialogs';
import { DeleteConfirmDialog } from '@/components/dialogs/CompanyDialogs';
import ND2BGeneratorForm from '@/components/forms/ND2BGeneratorForm';
import { toast } from '@/hooks/use-toast';
import { useOfficers } from '@/hooks/useOfficers';

const People = () => {
  const { officers, isLoading, refetch, deleteOfficer, upsertOfficer } = useOfficers();
  const [searchTerm, setSearchTerm] = useState('');
  
  // Dialog states
  const [personDialogOpen, setPersonDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [personToDelete, setPersonToDelete] = useState<Person | null>(null);

  // ND2B generation state
  const [nd2bPerson, setNd2bPerson] = useState<Person | null>(null);
  const [nd2bNewAddress, setNd2bNewAddress] = useState('');
  
  // Pagination
  const [pageSize, setPageSize] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);

  const filteredPeople = officers.filter(person =>
    person.nameChinese.toLowerCase().includes(searchTerm.toLowerCase()) ||
    person.nameEnglish.toLowerCase().includes(searchTerm.toLowerCase()) ||
    person.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (person.brNumber && person.brNumber.includes(searchTerm))
  );

  const totalPages = Math.max(1, Math.ceil(filteredPeople.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pagePeople = filteredPeople.slice(startIdx, startIdx + pageSize);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, pageSize]);

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
    refetch();
    setSearchTerm('');
    toast({ title: '已重新整理', description: '人員列表已更新' });
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

  const handleSavePerson = async (personData: Partial<Person>) => {
    try {
      await upsertOfficer({ personData, existingPerson: selectedPerson });
      toast({
        title: selectedPerson ? '人員已更新' : '人員已新增',
        description: `${personData.nameChinese || personData.nameEnglish} 已成功${selectedPerson ? '更新' : '新增'}`,
      });
    } catch (err) {
      // Error toast already shown in hook for new person case
    }
  };

  const handleGenerateND2B = (person: Person, newAddress: string) => {
    setNd2bPerson(person);
    setNd2bNewAddress(newAddress);
  };

  const handleConfirmDelete = async () => {
    if (personToDelete) {
      try {
        await deleteOfficer(personToDelete.id);
        toast({
          title: '人員已刪除',
          description: `${personToDelete.nameChinese || personToDelete.nameEnglish} 已成功刪除`,
        });
      } catch (err) {
        toast({ title: '刪除失敗', description: '無法刪除人員，請稍後再試', variant: 'destructive' });
      }
      setDeleteDialogOpen(false);
      setPersonToDelete(null);
    }
  };

  const handleClearSearch = () => {
    setSearchTerm('');
  };

  const handleSearch = () => {
    toast({ title: '搜尋完成', description: `找到 ${filteredPeople.length} 筆結果` });
  };

  // Show ND2B form if triggered
  if (nd2bPerson) {
    return (
      <ND2BGeneratorForm
        onBack={() => { setNd2bPerson(null); setNd2bNewAddress(''); }}
        prefillPerson={nd2bPerson}
        prefillNewAddress={nd2bNewAddress}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="人員管理"
        description="管理公司人員資料"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSearch}>
              <Search className="h-4 w-4 mr-2" />搜尋
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />重新整理
            </Button>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleAddPerson}>
              <Plus className="h-4 w-4 mr-2" />新增人員
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
            <X className="h-4 w-4 mr-1" />清除
          </Button>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleSearch}>
            <Search className="h-4 w-4 mr-1" />搜尋
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">載入中...</span>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-medium">姓名</TableHead>
                <TableHead className="font-medium">身分</TableHead>
                <TableHead className="font-medium">類型</TableHead>
                <TableHead className="font-medium">住址</TableHead>
                <TableHead className="font-medium">商業登記號碼</TableHead>
                <TableHead className="font-medium">TCSP 號碼</TableHead>
                <TableHead className="font-medium">關聯公司</TableHead>
                <TableHead className="font-medium">建立日期</TableHead>
                <TableHead className="font-medium">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagePeople.map((person) => (
                <TableRow key={person.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">
                    <div>
                      <div>{person.nameChinese}</div>
                      <div className="text-xs text-muted-foreground">({person.nameEnglish})</div>
                    </div>
                  </TableCell>
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
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {person.address || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {person.brNumber || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {person.tcspNumber || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    {person.companies.length > 0 ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-auto py-1 px-2 text-xs font-normal">
                            <span className="truncate max-w-[200px]">{person.companies[0].name}</span>
                            {person.companies.length > 1 && (
                              <span className="ml-1 text-muted-foreground">共 {person.companies.length} 間</span>
                            )}
                            <ChevronDown className="h-3 w-3 ml-1 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-2" align="start">
                          <div className="text-xs font-medium text-muted-foreground mb-2">關聯公司 ({person.companies.length})</div>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {person.companies.map((c, i) => (
                              <div key={i} className="rounded-md border border-border p-2 text-xs">
                                <div className="font-medium">{c.name}</div>
                                {c.brNumber && <div className="text-muted-foreground">BR: {c.brNumber}</div>}
                                <div className="text-muted-foreground">
                                  成立日期: {c.incorporationDate || <span className="italic">未填寫</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{person.createdAt}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleEditPerson(person)}>
                        <Edit className="h-4 w-4" />
                        <span className="ml-1">編輯</span>
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive" onClick={() => handleDeleteClick(person)}>
                        <Trash2 className="h-4 w-4" />
                        <span className="ml-1">刪除</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border flex-wrap gap-2">
          <div className="text-sm text-muted-foreground">共 {officers.length} 位人員（篩選後 {filteredPeople.length}）</div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">每頁:</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="w-24 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50 筆</SelectItem>
                <SelectItem value="100">100 筆</SelectItem>
                <SelectItem value="200">200 筆</SelectItem>
                <SelectItem value="500">500 筆</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground ml-2">
              {filteredPeople.length === 0 ? '無資料' : `顯示 ${startIdx + 1} 到 ${Math.min(startIdx + pageSize, filteredPeople.length)} 筆`}
            </span>
            <Button variant="outline" size="sm" className="h-8" disabled={safePage <= 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
              上一頁
            </Button>
            <span className="text-sm text-muted-foreground">第 {safePage} / {totalPages} 頁</span>
            <Button variant="outline" size="sm" className="h-8" disabled={safePage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
              下一頁
            </Button>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <PersonDialog
        open={personDialogOpen}
        onOpenChange={setPersonDialogOpen}
        person={selectedPerson}
        onSave={handleSavePerson}
        onGenerateND2B={handleGenerateND2B}
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
