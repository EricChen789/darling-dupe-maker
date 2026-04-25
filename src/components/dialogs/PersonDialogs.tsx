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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileText } from 'lucide-react';
import { Person } from '@/types';
import { toast } from '@/hooks/use-toast';

interface PersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person?: Person | null;
  onSave: (person: Partial<Person>) => void;
  onGenerateND2B?: (person: Person, newAddress: string) => void;
}

export const PersonDialog = ({ open, onOpenChange, person, onSave, onGenerateND2B }: PersonDialogProps) => {
  const [formData, setFormData] = useState({
    nameChinese: '',
    nameEnglish: '',
    email: '',
    identity: 'natural' as 'natural' | 'corporate',
    role: 'director' as 'director' | 'secretary' | 'shareholder',
    brNumber: '',
    address: '',
    serviceAddress: '',
    idNumber: '',
    passportNumber: '',
    passportExpiry: '',
    whatsapp: '',
  });

  const originalAddress = person?.address || '';

  useEffect(() => {
    if (person) {
      setFormData({
        nameChinese: person.nameChinese,
        nameEnglish: person.nameEnglish,
        email: person.email || '',
        identity: person.identity,
        role: person.role,
        brNumber: person.brNumber || '',
        address: person.address || '',
        serviceAddress: person.serviceAddress || '',
        idNumber: person.idNumber || '',
        passportNumber: person.passportNumber || '',
        passportExpiry: person.passportExpiry || '',
        whatsapp: person.whatsapp || '',
      });
    } else {
      setFormData({
        nameChinese: '',
        nameEnglish: '',
        email: '',
        identity: 'natural',
        role: 'director',
        brNumber: '',
        address: '',
        serviceAddress: '',
        idNumber: '',
        passportNumber: '',
        passportExpiry: '',
        whatsapp: '',
      });
    }
  }, [person, open]);

  const addressChanged = person && formData.address !== originalAddress && formData.address.trim() !== '';
  const isOfficer = formData.role === 'director' || formData.role === 'secretary';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nameChinese && !formData.nameEnglish) {
      toast({ title: '錯誤', description: '請填寫姓名', variant: 'destructive' });
      return;
    }
    onSave(formData);
    onOpenChange(false);
    toast({
      title: person ? '人員已更新' : '人員已新增',
      description: `${formData.nameChinese || formData.nameEnglish} 已成功${person ? '更新' : '新增'}`,
    });
  };

  const handleSaveAndGenerateND2B = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nameChinese && !formData.nameEnglish) {
      toast({ title: '錯誤', description: '請填寫姓名', variant: 'destructive' });
      return;
    }
    onSave(formData);
    onOpenChange(false);
    if (person && onGenerateND2B) {
      onGenerateND2B({ ...person, ...formData }, formData.address);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{person ? '編輯人員' : '新增人員'}</DialogTitle>
          <DialogDescription>
            {person ? '修改人員資料' : '輸入新人員的資料'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nameChinese">中文姓名</Label>
              <Input
                id="nameChinese"
                value={formData.nameChinese}
                onChange={(e) => setFormData({ ...formData, nameChinese: e.target.value })}
                placeholder="輸入中文姓名"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameEnglish">英文姓名</Label>
              <Input
                id="nameEnglish"
                value={formData.nameEnglish}
                onChange={(e) => setFormData({ ...formData, nameEnglish: e.target.value })}
                placeholder="輸入英文姓名"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">電郵地址</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="輸入電郵地址"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="identity">身份類型</Label>
              <Select
                value={formData.identity}
                onValueChange={(value: 'natural' | 'corporate') =>
                  setFormData({ ...formData, identity: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="選擇身份類型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">自然人</SelectItem>
                  <SelectItem value="corporate">法人</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">角色類型</Label>
              <Select
                value={formData.role}
                onValueChange={(value: 'director' | 'secretary' | 'shareholder') =>
                  setFormData({ ...formData, role: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="選擇角色類型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="director">董事</SelectItem>
                  <SelectItem value="secretary">秘書</SelectItem>
                  <SelectItem value="shareholder">股東</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="address">住址</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="輸入住址"
              />
              {addressChanged && isOfficer && (
                <p className="text-xs text-primary flex items-center gap-1 mt-1">
                  <FileText className="h-3 w-3" />
                  住址已變更，儲存後可自動生成 ND2B 表格
                </p>
              )}
            </div>
            {formData.identity === 'corporate' && (
              <div className="space-y-2">
                <Label htmlFor="brNumber">商業登記號碼</Label>
                <Input
                  id="brNumber"
                  value={formData.brNumber}
                  onChange={(e) => setFormData({ ...formData, brNumber: e.target.value })}
                  placeholder="輸入商業登記號碼"
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            {addressChanged && isOfficer && onGenerateND2B && (
              <Button
                type="button"
                variant="outline"
                className="text-primary border-primary hover:bg-primary/10"
                onClick={handleSaveAndGenerateND2B}
              >
                <FileText className="h-4 w-4 mr-1" />
                儲存並生成 ND2B
              </Button>
            )}
            <Button type="submit" className="bg-primary text-primary-foreground">
              {person ? '儲存變更' : '新增人員'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
