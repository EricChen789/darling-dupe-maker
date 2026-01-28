import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Search, RefreshCw, X, Calendar, ArrowUpDown } from 'lucide-react';

interface LogEntry {
  id: string;
  timestamp: string;
  operation: string;
  type: string;
  content: string;
  companyId?: string;
  companyName?: string;
}

const mockLogs: LogEntry[] = [
  { id: '1', timestamp: '2025/11/18 14:30:00', operation: '新增公司', type: '公司', content: '新增公司 TEST COMPANY – OBVIOUS TEST NAME', companyId: '1', companyName: 'TEST COMPANY' },
  { id: '2', timestamp: '2025/11/18 14:25:00', operation: '更新人員', type: '人員', content: '更新董事資料：測試董事', companyId: '1', companyName: 'TEST COMPANY' },
  { id: '3', timestamp: '2025/11/18 14:20:00', operation: '建立發票', type: '發票', content: '建立發票 INV-710585，金額 HK$94,596.11', companyId: '1', companyName: 'TEST COMPANY' },
  { id: '4', timestamp: '2025/11/18 14:15:00', operation: '提交表格', type: '表格', content: '提交 NAR1 周年申報表', companyId: '1', companyName: 'TEST COMPANY' },
  { id: '5', timestamp: '2025/11/17 16:45:00', operation: '新增人員', type: '人員', content: '新增秘書：李美玲 LEE Mei Ling', companyId: '1', companyName: 'TEST COMPANY' },
  { id: '6', timestamp: '2025/11/17 15:30:00', operation: '更新公司', type: '公司', content: '更新公司業務性質', companyId: '2', companyName: 'TEST COMPANY 2' },
];

const operationTypes = [
  { value: 'all', label: '所有操作' },
  { value: 'company', label: '公司操作' },
  { value: 'person', label: '人員操作' },
  { value: 'invoice', label: '發票操作' },
  { value: 'form', label: '表格操作' },
];

const Logs = () => {
  const [searchCompany, setSearchCompany] = useState('');
  const [operationType, setOperationType] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = () => {
    let results = [...mockLogs];
    
    if (searchCompany) {
      results = results.filter(log => 
        log.companyName?.toLowerCase().includes(searchCompany.toLowerCase())
      );
    }
    
    if (operationType !== 'all') {
      const typeMap: Record<string, string> = {
        'company': '公司',
        'person': '人員',
        'invoice': '發票',
        'form': '表格',
      };
      results = results.filter(log => log.type === typeMap[operationType]);
    }
    
    setFilteredLogs(results);
    setHasSearched(true);
  };

  const handleClear = () => {
    setSearchCompany('');
    setOperationType('all');
    setStartDate('');
    setEndDate('');
    setFilteredLogs([]);
    setHasSearched(false);
  };

  const displayLogs = hasSearched ? filteredLogs : [];

  // Calculate stats based on selected company
  const currentCompany = searchCompany || '-';
  const directorsCount = hasSearched && filteredLogs.length > 0 ? '有' : '無';
  const secretariesCount = hasSearched && filteredLogs.length > 0 ? '有' : '無';

  return (
    <div>
      <PageHeader
        title="公司日誌"
        description="查看所有公司相關操作記錄和系統活動"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Search className="h-4 w-4 mr-2" />
              搜尋
            </Button>
            <Button variant="outline" size="sm">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              最新優先
            </Button>
            <Button variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              重新整理
            </Button>
          </div>
        }
      />

      {/* Search Panel */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">搜尋日誌</span>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">搜尋公司</Label>
            <Input
              placeholder="搜尋公司名稱或商業登記號碼..."
              value={searchCompany}
              onChange={(e) => setSearchCompany(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">操作類型</Label>
            <Select value={operationType} onValueChange={setOperationType}>
              <SelectTrigger>
                <SelectValue placeholder="所有操作" />
              </SelectTrigger>
              <SelectContent>
                {operationTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">開始日期</Label>
            <div className="relative">
              <Input
                type="date"
                placeholder="年 / 月 / 日"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="pr-10"
              />
              <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">結束日期</Label>
            <div className="relative">
              <Input
                type="date"
                placeholder="年 / 月 / 日"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="pr-10"
              />
              <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleClear}>
            <X className="h-4 w-4 mr-1" />
            清除
          </Button>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleSearch}>
            <Search className="h-4 w-4 mr-1" />
            搜尋
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <StatCard label="當前公司" value={currentCompany} />
        <StatCard label="總記錄數" value={displayLogs.length} />
        <StatCard label="目前顯示" value={displayLogs.length} valueClassName="text-primary" />
        <StatCard label="董事" value={directorsCount} />
        <StatCard label="秘書" value={secretariesCount} />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-medium w-[180px]">時間</TableHead>
              <TableHead className="font-medium w-[150px]">操作</TableHead>
              <TableHead className="font-medium w-[100px]">類型</TableHead>
              <TableHead className="font-medium">內容</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayLogs.length > 0 ? (
              displayLogs.map((log) => (
                <TableRow key={log.id} className="hover:bg-muted/30">
                  <TableCell className="text-sm">{log.timestamp}</TableCell>
                  <TableCell className="text-sm font-medium">{log.operation}</TableCell>
                  <TableCell className="text-sm">{log.type}</TableCell>
                  <TableCell className="text-sm">{log.content}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                  沒有找到符合條件的記錄
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="text-sm text-muted-foreground">
            顯示 1 到 {displayLogs.length} 筆，共 {displayLogs.length} 筆資料
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
                <SelectItem value="100">100 筆</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 ml-2">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled>
                {'<'}
              </Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled>
                {'|<'}
              </Button>
              <span className="px-2 text-sm">1</span>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled>
                {'>|'}
              </Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled>
                {'>'}
              </Button>
              <span className="text-sm text-muted-foreground ml-2">頁，共 1 頁</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Logs;
