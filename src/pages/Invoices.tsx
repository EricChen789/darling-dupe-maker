import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Search, RefreshCw, Plus, Eye, Edit, Trash2 } from 'lucide-react';
import { mockInvoices } from '@/data/mockData';

const Invoices = () => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredInvoices = mockInvoices.filter(invoice =>
    invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    invoice.companyName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: mockInvoices.length,
    displayed: filteredInvoices.length,
    pending: mockInvoices.filter(i => i.status === 'pending').length,
    paid: mockInvoices.filter(i => i.status === 'paid').length,
    overdue: mockInvoices.filter(i => i.status === 'overdue').length,
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return '已付款';
      case 'pending': return '待付款';
      case 'overdue': return '逾期未付';
      default: return status;
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return `${currency}$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div>
      <PageHeader
        title="發票管理"
        description="管理您的發票並追蹤付款狀態"
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
              新增發票
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <StatCard label="總發票數" value={stats.total} />
        <StatCard label="目前顯示" value={stats.displayed} />
        <StatCard label="待付款" value={stats.pending} valueClassName="text-warning" />
        <StatCard label="已付款" value={stats.paid} valueClassName="text-primary" />
        <StatCard label="逾期未付" value={stats.overdue} valueClassName="text-destructive" />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-medium">發票號碼</TableHead>
              <TableHead className="font-medium">公司</TableHead>
              <TableHead className="font-medium">金額</TableHead>
              <TableHead className="font-medium">狀態</TableHead>
              <TableHead className="font-medium">開立日期</TableHead>
              <TableHead className="font-medium">到期日</TableHead>
              <TableHead className="font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvoices.map((invoice) => (
              <TableRow key={invoice.id} className="hover:bg-muted/30">
                <TableCell>
                  <div>
                    <div className="font-medium">{invoice.invoiceNumber}</div>
                    <div className="text-xs text-muted-foreground">{invoice.description}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <div className="font-medium">{invoice.companyName}</div>
                    <div className="text-xs text-muted-foreground">
                      商業登記號碼：{invoice.companyBrNumber}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  {formatCurrency(invoice.amount, invoice.currency)}
                </TableCell>
                <TableCell>
                  <StatusBadge variant={invoice.status}>
                    {getStatusLabel(invoice.status)}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-sm">{invoice.issueDate}</TableCell>
                <TableCell className="text-sm">{invoice.dueDate}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
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

export default Invoices;
