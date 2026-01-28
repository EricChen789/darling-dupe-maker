import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { Company } from '@/types';
import { toast } from '@/hooks/use-toast';

interface CompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Company | null;
  onSave: (company: Partial<Company>) => void;
}

export const CompanyDialog = ({ open, onOpenChange, company, onSave }: CompanyDialogProps) => {
  const [formData, setFormData] = useState({
    name: company?.name || '',
    brNumber: company?.brNumber || '',
    tradingName: company?.tradingName || '',
    businessNature: company?.businessNature || '',
    companyType: company?.companyType || '私人公司 Private company',
    businessCode: company?.businessCode || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.brNumber) {
      toast({
        title: '錯誤',
        description: '請填寫必填欄位',
        variant: 'destructive',
      });
      return;
    }
    onSave(formData);
    onOpenChange(false);
    toast({
      title: company ? '公司已更新' : '公司已新增',
      description: `${formData.name} 已成功${company ? '更新' : '新增'}`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{company ? '編輯公司' : '新增公司'}</DialogTitle>
          <DialogDescription>
            {company ? '修改公司資料' : '輸入新公司的資料'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                公司名稱 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="輸入公司名稱"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brNumber">
                商業登記號碼 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="brNumber"
                value={formData.brNumber}
                onChange={(e) => setFormData({ ...formData, brNumber: e.target.value })}
                placeholder="輸入商業登記號碼"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tradingName">商業名稱</Label>
              <Input
                id="tradingName"
                value={formData.tradingName}
                onChange={(e) => setFormData({ ...formData, tradingName: e.target.value })}
                placeholder="輸入商業名稱"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessNature">業務性質</Label>
              <Input
                id="businessNature"
                value={formData.businessNature}
                onChange={(e) => setFormData({ ...formData, businessNature: e.target.value })}
                placeholder="輸入業務性質"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyType">公司類型</Label>
              <Select
                value={formData.companyType}
                onValueChange={(value) => setFormData({ ...formData, companyType: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="選擇公司類型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="私人公司 Private company">私人公司 Private company</SelectItem>
                  <SelectItem value="公眾公司 Public company">公眾公司 Public company</SelectItem>
                  <SelectItem value="擔保有限公司 Company limited by guarantee">擔保有限公司</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessCode">業務代碼</Label>
              <Input
                id="businessCode"
                value={formData.businessCode}
                onChange={(e) => setFormData({ ...formData, businessCode: e.target.value })}
                placeholder="輸入業務代碼"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" className="bg-primary text-primary-foreground">
              {company ? '儲存變更' : '新增公司'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
}

export const DeleteConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: DeleteConfirmDialogProps) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            確認刪除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
