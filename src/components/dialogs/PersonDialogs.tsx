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
import { Person } from '@/types';
import { toast } from '@/hooks/use-toast';

interface PersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person?: Person | null;
  onSave: (person: Partial<Person>) => void;
}

export const PersonDialog = ({ open, onOpenChange, person, onSave }: PersonDialogProps) => {
  const [formData, setFormData] = useState({
    nameChinese: '',
    nameEnglish: '',
    email: '',
    identity: 'natural' as 'natural' | 'corporate',
    role: 'director' as 'director' | 'secretary' | 'shareholder',
    brNumber: '',
  });

  useEffect(() => {
    if (person) {
      setFormData({
        nameChinese: person.nameChinese,
        nameEnglish: person.nameEnglish,
        email: person.email,
        identity: person.identity,
        role: person.role,
        brNumber: person.brNumber || '',
      });
    } else {
      setFormData({
        nameChinese: '',
        nameEnglish: '',
        email: '',
        identity: 'natural',
        role: 'director',
        brNumber: '',
      });
    }
  }, [person, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nameChinese && !formData.nameEnglish) {
      toast({
        title: '錯誤',
        description: '請填寫姓名',
        variant: 'destructive',
      });
      return;
    }
    if (!formData.email) {
      toast({
        title: '錯誤',
        description: '請填寫電郵地址',
        variant: 'destructive',
      });
      return;
    }
    onSave(formData);
    onOpenChange(false);
    toast({
      title: person ? '人員已更新' : '人員已新增',
      description: `${formData.nameChinese || formData.nameEnglish} 已成功${person ? '更新' : '新增'}`,
    });
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
              <Label htmlFor="email">
                電郵地址 <span className="text-destructive">*</span>
              </Label>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" className="bg-primary text-primary-foreground">
              {person ? '儲存變更' : '新增人員'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
