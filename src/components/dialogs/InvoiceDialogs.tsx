import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Invoice } from '@/types';
import { toast } from '@/hooks/use-toast';
import { mockCompanies } from '@/data/mockData';

interface InvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice?: Invoice | null;
  onSave: (invoice: Partial<Invoice>) => void;
}

export const InvoiceDialog = ({ open, onOpenChange, invoice, onSave }: InvoiceDialogProps) => {
  const [formData, setFormData] = useState({
    invoiceNumber: '',
    description: '',
    companyId: '',
    amount: '',
    currency: 'HKD',
    status: 'pending' as 'paid' | 'pending' | 'overdue',
    issueDate: '',
    dueDate: '',
  });

  useEffect(() => {
    if (invoice) {
      setFormData({
        invoiceNumber: invoice.invoiceNumber,
        description: invoice.description,
        companyId: invoice.companyId,
        amount: invoice.amount.toString(),
        currency: invoice.currency,
        status: invoice.status,
        issueDate: invoice.issueDate.replace(/\//g, '-'),
        dueDate: invoice.dueDate.replace(/\//g, '-'),
      });
    } else {
      const now = new Date();
      const dueDate = new Date(now);
      dueDate.setMonth(dueDate.getMonth() + 1);
      setFormData({
        invoiceNumber: `INV-${Math.floor(Math.random() * 900000) + 100000}`,
        description: '',
        companyId: '',
        amount: '',
        currency: 'HKD',
        status: 'pending',
        issueDate: now.toISOString().split('T')[0],
        dueDate: dueDate.toISOString().split('T')[0],
      });
    }
  }, [invoice, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.companyId || !formData.amount) {
      toast({
        title: '錯誤',
        description: '請填寫必填欄位',
        variant: 'destructive',
      });
      return;
    }
    const selectedCompany = mockCompanies.find(c => c.id === formData.companyId);
    onSave({
      ...formData,
      amount: parseFloat(formData.amount),
      companyName: selectedCompany?.name || '',
      companyBrNumber: selectedCompany?.brNumber || '',
      issueDate: formData.issueDate.replace(/-/g, '/'),
      dueDate: formData.dueDate.replace(/-/g, '/'),
    });
    onOpenChange(false);
    toast({
      title: invoice ? '發票已更新' : '發票已新增',
      description: `${formData.invoiceNumber} 已成功${invoice ? '更新' : '新增'}`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{invoice ? '編輯發票' : '新增發票'}</DialogTitle>
          <DialogDescription>
            {invoice ? '修改發票資料' : '輸入新發票的資料'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invoiceNumber">發票號碼</Label>
              <Input
                id="invoiceNumber"
                value={formData.invoiceNumber}
                onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                placeholder="發票號碼"
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyId">
                公司 <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.companyId}
                onValueChange={(value) => setFormData({ ...formData, companyId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="選擇公司" />
                </SelectTrigger>
                <SelectContent>
                  {mockCompanies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="輸入發票描述"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">
                金額 <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Select
                  value={formData.currency}
                  onValueChange={(value) => setFormData({ ...formData, currency: value })}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HKD">HKD</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CNY">CNY</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="輸入金額"
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">狀態</Label>
              <Select
                value={formData.status}
                onValueChange={(value: 'paid' | 'pending' | 'overdue') =>
                  setFormData({ ...formData, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="選擇狀態" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">待付款</SelectItem>
                  <SelectItem value="paid">已付款</SelectItem>
                  <SelectItem value="overdue">逾期未付</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="issueDate">開立日期</Label>
              <Input
                id="issueDate"
                type="date"
                value={formData.issueDate}
                onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">到期日</Label>
              <Input
                id="dueDate"
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" className="bg-primary text-primary-foreground">
              {invoice ? '儲存變更' : '新增發票'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

interface InvoiceViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}

export const InvoiceViewDialog = ({ open, onOpenChange, invoice }: InvoiceViewDialogProps) => {
  if (!invoice) return null;

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return '已付款';
      case 'pending': return '待付款';
      case 'overdue': return '逾期未付';
      default: return status;
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return `${currency}$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>發票詳情</DialogTitle>
          <DialogDescription>{invoice.invoiceNumber}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground text-sm">公司</Label>
              <p className="font-medium">{invoice.companyName}</p>
              <p className="text-sm text-muted-foreground">BR: {invoice.companyBrNumber}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">金額</Label>
              <p className="font-medium text-lg">{formatCurrency(invoice.amount, invoice.currency)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">狀態</Label>
              <p className="font-medium">{getStatusLabel(invoice.status)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">開立日期</Label>
              <p className="font-medium">{invoice.issueDate}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">到期日</Label>
              <p className="font-medium">{invoice.dueDate}</p>
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground text-sm">描述</Label>
            <p className="font-medium">{invoice.description}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            關閉
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
