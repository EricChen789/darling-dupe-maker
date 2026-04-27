import { useState, useEffect, useRef } from 'react';
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
import { FileText, AlertTriangle, CheckCircle2, XCircle, Upload, X, Image as ImageIcon } from 'lucide-react';
import { Person } from '@/types';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface FileUploadSlotProps {
  label: string;
  filePath: string;
  onChange: (path: string) => void;
  folder: string;
}

const FileUploadSlot = ({ label, filePath, onChange, folder }: FileUploadSlotProps) => {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    if (filePath) {
      supabase.storage.from('company-documents').createSignedUrl(filePath, 3600).then(({ data }) => {
        if (active && data?.signedUrl) setPreviewUrl(data.signedUrl);
      });
    } else {
      setPreviewUrl('');
    }
    return () => { active = false; };
  }, [filePath]);

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: '錯誤', description: '請上傳圖片檔', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;
      // Remove old
      if (filePath) {
        await supabase.storage.from('company-documents').remove([filePath]);
      }
      const { error } = await supabase.storage.from('company-documents').upload(path, file, { upsert: true });
      if (error) throw error;
      onChange(path);
      toast({ title: '上傳成功', description: label });
    } catch (e: any) {
      toast({ title: '上傳失敗', description: e.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (filePath) {
      await supabase.storage.from('company-documents').remove([filePath]);
    }
    onChange('');
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        className={`relative border-2 border-dashed rounded-md p-3 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
        }`}
        onClick={() => !filePath && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = '';
          }}
        />
        {previewUrl ? (
          <div className="relative">
            <img src={previewUrl} alt={label} className="max-h-32 mx-auto rounded" />
            <div className="flex justify-center gap-2 mt-2">
              <Button type="button" size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
                <Upload className="h-3 w-3 mr-1" />更換
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleRemove(); }}>
                <X className="h-3 w-3 mr-1" />刪除
              </Button>
            </div>
          </div>
        ) : uploading ? (
          <div className="py-4 text-sm text-muted-foreground">上傳中...</div>
        ) : (
          <div className="py-4 text-sm text-muted-foreground flex flex-col items-center gap-1">
            <ImageIcon className="h-6 w-6" />
            <span>{dragOver ? '放開以上傳' : '點擊或拖放圖片上傳'}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const PassportExpiryBadge = ({ expiry }: { expiry: string }) => {
  if (!expiry) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-muted text-muted-foreground text-xs whitespace-nowrap">
        <AlertTriangle className="h-3 w-3" />
        未設定護照失效日期
      </span>
    );
  }
  const expiryDate = new Date(expiry);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (isNaN(expiryDate.getTime())) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-muted text-muted-foreground text-xs whitespace-nowrap">
        <AlertTriangle className="h-3 w-3" />
        日期格式錯誤
      </span>
    );
  }
  if (diffDays < 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-destructive bg-destructive/10 text-destructive text-xs whitespace-nowrap">
        <XCircle className="h-3 w-3" />
        護照已失效（{Math.abs(diffDays)} 日前）
      </span>
    );
  }
  if (diffDays <= 180) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-xs whitespace-nowrap">
        <AlertTriangle className="h-3 w-3" />
        護照即將失效（剩 {diffDays} 日）
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-green-600 bg-green-600/10 text-green-700 dark:text-green-400 text-xs whitespace-nowrap">
      <CheckCircle2 className="h-3 w-3" />
      護照有效（剩 {diffDays} 日）
    </span>
  );
};

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
    passportFilePath: '',
    idCardFilePath: '',
    addressProofFilePath: '',
    tcspNumber: '',
    previousNameChinese: '',
    previousNameEnglish: '',
    aliasChinese: '',
    aliasEnglish: '',
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
        passportFilePath: person.passportFilePath || '',
        idCardFilePath: person.idCardFilePath || '',
        addressProofFilePath: person.addressProofFilePath || '',
        tcspNumber: person.tcspNumber || '',
        previousNameChinese: person.previousNameChinese || '',
        previousNameEnglish: person.previousNameEnglish || '',
        aliasChinese: person.aliasChinese || '',
        aliasEnglish: person.aliasEnglish || '',
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
        passportFilePath: '',
        idCardFilePath: '',
        addressProofFilePath: '',
        tcspNumber: '',
        previousNameChinese: '',
        previousNameEnglish: '',
        aliasChinese: '',
        aliasEnglish: '',
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
      <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] max-h-[95vh] overflow-y-auto sm:max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>{person ? '編輯人員' : '新增人員'}</DialogTitle>
          <DialogDescription>
            {person ? '修改人員資料' : '輸入新人員的資料'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4 py-4">
            {/* === 姓名 === */}
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
              <Label htmlFor="previousNameChinese">前用中文姓名</Label>
              <Input
                id="previousNameChinese"
                value={formData.previousNameChinese}
                onChange={(e) => setFormData({ ...formData, previousNameChinese: e.target.value })}
                placeholder="輸入前用中文姓名（如有）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="previousNameEnglish">前用英文姓名</Label>
              <Input
                id="previousNameEnglish"
                value={formData.previousNameEnglish}
                onChange={(e) => setFormData({ ...formData, previousNameEnglish: e.target.value })}
                placeholder="輸入前用英文姓名（如有）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aliasChinese">別名（中文）</Label>
              <Input
                id="aliasChinese"
                value={formData.aliasChinese}
                onChange={(e) => setFormData({ ...formData, aliasChinese: e.target.value })}
                placeholder="輸入中文別名（如有）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aliasEnglish">別名（英文）</Label>
              <Input
                id="aliasEnglish"
                value={formData.aliasEnglish}
                onChange={(e) => setFormData({ ...formData, aliasEnglish: e.target.value })}
                placeholder="輸入英文別名（如有）"
              />
            </div>
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

            {/* === 身份證件 === */}
            <div className="space-y-2">
              <Label htmlFor="idNumber">香港身份證號碼</Label>
              <Input
                id="idNumber"
                value={formData.idNumber}
                onChange={(e) => setFormData({ ...formData, idNumber: e.target.value })}
                placeholder="例如 A123456(7)"
              />
            </div>
            {formData.identity === 'corporate' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="brNumber">商業登記號碼</Label>
                  <Input
                    id="brNumber"
                    value={formData.brNumber}
                    onChange={(e) => setFormData({ ...formData, brNumber: e.target.value })}
                    placeholder="輸入商業登記號碼"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tcspNumber">TCSP 號碼（信託或公司服務提供者牌照）</Label>
                  <Input
                    id="tcspNumber"
                    value={formData.tcspNumber}
                    onChange={(e) => setFormData({ ...formData, tcspNumber: e.target.value })}
                    placeholder="例如 TC003576"
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="passportNumber">護照號碼</Label>
              <Input
                id="passportNumber"
                value={formData.passportNumber}
                onChange={(e) => setFormData({ ...formData, passportNumber: e.target.value })}
                placeholder="輸入護照號碼"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passportExpiry">護照失效日期</Label>
              <Input
                id="passportExpiry"
                type="date"
                value={formData.passportExpiry}
                onChange={(e) => setFormData({ ...formData, passportExpiry: e.target.value })}
              />
            </div>
            <FileUploadSlot
              label="護照圖片"
              filePath={formData.passportFilePath}
              onChange={(p) => setFormData({ ...formData, passportFilePath: p })}
              folder="officers/passport"
            />
            <FileUploadSlot
              label="身份證圖片"
              filePath={formData.idCardFilePath}
              onChange={(p) => setFormData({ ...formData, idCardFilePath: p })}
              folder="officers/id-card"
            />

            {/* === 聯絡 === */}
            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp 電話號碼</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="whatsapp"
                  value={formData.whatsapp}
                  onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                  placeholder="例如 +852 9123 4567"
                  className="flex-1"
                />
                <PassportExpiryBadge expiry={formData.passportExpiry} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">電郵地址</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="輸入電郵地址"
                  className="flex-1"
                />
                <PassportExpiryBadge expiry={formData.passportExpiry} />
              </div>
            </div>

            {/* === 地址 === */}
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
            <div className="space-y-2 col-span-2">
              <Label htmlFor="serviceAddress">服務地址</Label>
              <Input
                id="serviceAddress"
                value={formData.serviceAddress}
                onChange={(e) => setFormData({ ...formData, serviceAddress: e.target.value })}
                placeholder="輸入服務地址"
              />
            </div>
            <div className="col-span-2">
              <FileUploadSlot
                label="住址證明圖片"
                filePath={formData.addressProofFilePath}
                onChange={(p) => setFormData({ ...formData, addressProofFilePath: p })}
                folder="officers/address-proof"
              />
            </div>
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
