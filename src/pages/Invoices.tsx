import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
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
import { Search, RefreshCw, Plus, Eye, Edit, Trash2 } from 'lucide-react';
import { mockInvoices as initialInvoices } from '@/data/mockData';
import { Invoice } from '@/types';
import { InvoiceDialog, InvoiceViewDialog } from '@/components/dialogs/InvoiceDialogs';
import { DeleteConfirmDialog } from '@/components/dialogs/CompanyDialogs';
import { toast } from '@/hooks/use-toast';

const Invoices = () => {
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  
  // Dialog states
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  
  const filteredInvoices = invoices.filter(invoice =>
    invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    invoice.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    invoice.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: invoices.length,
    displayed: filteredInvoices.length,
    pending: invoices.filter(i => i.status === 'pending').length,
    paid: invoices.filter(i => i.status === 'paid').length,
    overdue: invoices.filter(i => i.status === 'overdue').length,
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

  const handleRefresh = () => {
    setInvoices([...initialInvoices]);
    setSearchTerm('');
    toast({
      title: '已重新整理',
      description: '發票列表已更新',
    });
  };

  const handleAddInvoice = () => {
    setSelectedInvoice(null);
    setInvoiceDialogOpen(true);
  };

  const handleViewInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setViewDialogOpen(true);
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setInvoiceDialogOpen(true);
  };

  const handleDeleteClick = (invoice: Invoice) => {
    setInvoiceToDelete(invoice);
    setDeleteDialogOpen(true);
  };

  const handleSaveInvoice = (invoiceData: Partial<Invoice>) => {
    if (selectedInvoice) {
      // Edit existing
      setInvoices(invoices.map(inv =>
        inv.id === selectedInvoice.id
          ? { ...inv, ...invoiceData }
          : inv
      ));
    } else {
      // Add new
      const newInvoice: Invoice = {
        id: `inv${Date.now()}`,
        invoiceNumber: invoiceData.invoiceNumber || '',
        description: invoiceData.description || '',
        companyId: invoiceData.companyId || '',
        companyName: invoiceData.companyName || '',
        companyBrNumber: invoiceData.companyBrNumber || '',
        amount: invoiceData.amount || 0,
        currency: invoiceData.currency || 'HKD',
        status: invoiceData.status || 'pending',
        issueDate: invoiceData.issueDate || '',
        dueDate: invoiceData.dueDate || '',
      };
      setInvoices([...invoices, newInvoice]);
    }
  };

  const handleConfirmDelete = () => {
    if (invoiceToDelete) {
      setInvoices(invoices.filter(inv => inv.id !== invoiceToDelete.id));
      toast({
        title: '發票已刪除',
        description: `${invoiceToDelete.invoiceNumber} 已成功刪除`,
      });
      setDeleteDialogOpen(false);
      setInvoiceToDelete(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="發票管理"
        description="管理您的發票並追蹤付款狀態"
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
              onClick={handleAddInvoice}
            >
              <Plus className="h-4 w-4 mr-2" />
              新增發票
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
                placeholder="搜尋發票號碼、公司名稱或描述..."
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
                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {invoice.description}
                    </div>
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
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0"
                      onClick={() => handleViewInvoice(invoice)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0"
                      onClick={() => handleEditInvoice(invoice)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteClick(invoice)}
                    >
                      <Trash2 className="h-4 w-4" />
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
            共 {invoices.length} 張發票
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
              顯示 1 到 {filteredInvoices.length} 筆，共 {filteredInvoices.length} 筆資料
            </span>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        invoice={selectedInvoice}
        onSave={handleSaveInvoice}
      />

      <InvoiceViewDialog
        open={viewDialogOpen}
        onOpenChange={setViewDialogOpen}
        invoice={selectedInvoice}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="確認刪除發票"
        description={`您確定要刪除「${invoiceToDelete?.invoiceNumber}」嗎？此操作無法復原。`}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};

export default Invoices;
