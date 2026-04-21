import { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Company } from '@/types';
import { toast } from '@/hooks/use-toast';
import { Upload, FileText, Loader2, Sparkles } from 'lucide-react';

interface CompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Company | null;
  onSave: (company: Partial<Company>) => void;
}

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

export const CompanyDialog = ({ open, onOpenChange, company, onSave }: CompanyDialogProps) => {
  const [formData, setFormData] = useState({
    name: '',
    chineseName: '',
    brNumber: '',
    tradingName: '',
    businessNature: '',
    companyType: '私人公司 Private company',
    businessCode: '',
    incorporationDate: '',
    jurisdiction: 'Hong Kong',
  });
  const [extractingBr, setExtractingBr] = useState(false);
  const [extractingCi, setExtractingCi] = useState(false);
  const [brFileName, setBrFileName] = useState('');
  const [ciFileName, setCiFileName] = useState('');
  const brInputRef = useRef<HTMLInputElement>(null);
  const ciInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFormData({
        name: company?.name || '',
        chineseName: company?.chineseName || '',
        brNumber: company?.brNumber || '',
        tradingName: company?.tradingName || '',
        businessNature: company?.businessNature || '',
        companyType: company?.companyType || '私人公司 Private company',
        businessCode: company?.businessCode || '',
        incorporationDate: company?.incorporationDate || '',
        jurisdiction: company?.jurisdiction || 'Hong Kong',
      });
      setBrFileName('');
      setCiFileName('');
    }
  }, [open, company]);

  const extract = async (file: File, kind: 'br' | 'ci') => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ title: '不支援的檔案格式', description: '請上傳 PDF 或圖片檔案（PNG、JPG）', variant: 'destructive' });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: '檔案太大', description: '檔案大小不能超過 20MB', variant: 'destructive' });
      return;
    }

    const setExtracting = kind === 'br' ? setExtractingBr : setExtractingCi;
    const setName = kind === 'br' ? setBrFileName : setCiFileName;
    const fnName = kind === 'br' ? 'extract-br-info' : 'extract-ci-info';
    setExtracting(true);
    setName(file.name);

    try {
      const body = new FormData();
      body.append('file', file);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${anonKey}` },
        body,
      });

      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'AI 辨識失敗');

      const data = result.data;
      setFormData(prev => ({
        ...prev,
        name: data.companyName || prev.name,
        chineseName: data.chineseName || prev.chineseName,
        brNumber: data.brNumber || prev.brNumber,
        tradingName: data.tradingName || prev.tradingName,
        businessNature: data.businessNature || prev.businessNature,
        businessCode: data.businessCode || prev.businessCode,
        companyType: data.companyType || prev.companyType,
        incorporationDate: data.incorporationDate || prev.incorporationDate,
        jurisdiction: data.jurisdiction || prev.jurisdiction,
      }));

      toast({
        title: 'AI 辨識完成',
        description: kind === 'br'
          ? '已自動填入商業登記證資料，請檢查並確認。'
          : '已自動填入公司註冊證書資料，請檢查並確認。',
      });
    } catch (err: any) {
      console.error(`${kind} extraction error:`, err);
      toast({ title: 'AI 辨識失敗', description: err.message || '請重試或手動輸入資料', variant: 'destructive' });
    } finally {
      setExtracting(false);
      if (kind === 'br' && brInputRef.current) brInputRef.current.value = '';
      if (kind === 'ci' && ciInputRef.current) ciInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.brNumber) {
      toast({ title: '錯誤', description: '請填寫必填欄位', variant: 'destructive' });
      return;
    }
    onSave(formData);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{company ? '編輯公司' : '新增公司'}</DialogTitle>
          <DialogDescription>
            {company ? '修改公司資料' : '上傳商業登記證 (BR) 或公司註冊證書 (CI) 自動填寫，或手動輸入'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          {/* AI Upload Section */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* BR Upload */}
            <div className="p-3 border-2 border-dashed border-primary/30 rounded-lg bg-primary/5">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">商業登記證 (BR)</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">AI 自動辨識並填入</p>
              {brFileName && (
                <div className="flex items-center gap-1 mb-2 text-xs text-primary truncate">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{brFileName}</span>
                </div>
              )}
              <input
                ref={brInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) extract(f, 'br'); }}
                className="hidden"
              />
              <Button
                type="button" variant="outline" size="sm" disabled={extractingBr}
                onClick={() => brInputRef.current?.click()} className="gap-2 w-full"
              >
                {extractingBr ? <><Loader2 className="h-4 w-4 animate-spin" />辨識中...</> : <><Upload className="h-4 w-4" />上傳 BR</>}
              </Button>
            </div>

            {/* CI Upload */}
            <div className="p-3 border-2 border-dashed border-primary/30 rounded-lg bg-primary/5">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">公司註冊證書 (CI)</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">AI 自動辨識並填入</p>
              {ciFileName && (
                <div className="flex items-center gap-1 mb-2 text-xs text-primary truncate">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{ciFileName}</span>
                </div>
              )}
              <input
                ref={ciInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) extract(f, 'ci'); }}
                className="hidden"
              />
              <Button
                type="button" variant="outline" size="sm" disabled={extractingCi}
                onClick={() => ciInputRef.current?.click()} className="gap-2 w-full"
              >
                {extractingCi ? <><Loader2 className="h-4 w-4 animate-spin" />辨識中...</> : <><Upload className="h-4 w-4" />上傳 CI</>}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">公司名稱 <span className="text-destructive">*</span></Label>
              <Input id="name" value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="輸入公司名稱" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chineseName">中文名稱</Label>
              <Input id="chineseName" value={formData.chineseName}
                onChange={(e) => setFormData({ ...formData, chineseName: e.target.value })}
                placeholder="輸入中文名稱" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brNumber">商業登記號碼 <span className="text-destructive">*</span></Label>
              <Input id="brNumber" value={formData.brNumber}
                onChange={(e) => setFormData({ ...formData, brNumber: e.target.value })}
                placeholder="輸入商業登記號碼" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incorporationDate">成立日期</Label>
              <Input id="incorporationDate" value={formData.incorporationDate}
                onChange={(e) => setFormData({ ...formData, incorporationDate: e.target.value })}
                placeholder="DD/MM/YYYY" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tradingName">商業名稱</Label>
              <Input id="tradingName" value={formData.tradingName}
                onChange={(e) => setFormData({ ...formData, tradingName: e.target.value })}
                placeholder="輸入商業名稱" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jurisdiction">司法管轄區</Label>
              <Input id="jurisdiction" value={formData.jurisdiction}
                onChange={(e) => setFormData({ ...formData, jurisdiction: e.target.value })}
                placeholder="Hong Kong" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessNature">業務性質</Label>
              <Input id="businessNature" value={formData.businessNature}
                onChange={(e) => setFormData({ ...formData, businessNature: e.target.value })}
                placeholder="輸入業務性質" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyType">公司類型</Label>
              <Select value={formData.companyType}
                onValueChange={(value) => setFormData({ ...formData, companyType: value })}>
                <SelectTrigger><SelectValue placeholder="選擇公司類型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="私人公司 Private company">私人公司 Private company</SelectItem>
                  <SelectItem value="公眾公司 Public company">公眾公司 Public company</SelectItem>
                  <SelectItem value="擔保有限公司 Company limited by guarantee">擔保有限公司</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="businessCode">業務代碼</Label>
              <Input id="businessCode" value={formData.businessCode}
                onChange={(e) => setFormData({ ...formData, businessCode: e.target.value })}
                placeholder="輸入業務代碼" />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
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
  open, onOpenChange, title, description, onConfirm,
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
          <AlertDialogAction onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            確認刪除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
