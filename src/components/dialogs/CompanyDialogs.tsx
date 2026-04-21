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
import { Company, Person, Shareholder } from '@/types';
import { toast } from '@/hooks/use-toast';
import { Upload, FileText, Loader2, Sparkles, X } from 'lucide-react';

interface CompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Company | null;
  onSave: (company: Partial<Company>) => void;
}

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

type ExtractKind = 'br' | 'ci' | 'other1' | 'other2';

const mergeArr = <T extends Record<string, any>>(existing: T[], incoming: any[] = [], keyFn: (x: any) => string): T[] => {
  const map = new Map<string, T>();
  for (const e of existing) map.set(keyFn(e).toLowerCase().trim(), e);
  for (const i of incoming) {
    const k = keyFn(i).toLowerCase().trim();
    if (!k) continue;
    if (!map.has(k)) map.set(k, i as T);
  }
  return Array.from(map.values());
};

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
    regFlat: '',
    regBuilding: '',
    regStreet: '',
    regDistrict: '',
    regRegion: '香港 Hong Kong',
  });
  const [directors, setDirectors] = useState<Partial<Person>[]>([]);
  const [secretaries, setSecretaries] = useState<Partial<Person>[]>([]);
  const [shareholders, setShareholders] = useState<Partial<Shareholder>[]>([]);

  const [extracting, setExtracting] = useState<Record<ExtractKind, boolean>>({
    br: false, ci: false, other1: false, other2: false,
  });
  const [fileNames, setFileNames] = useState<Record<ExtractKind, string>>({
    br: '', ci: '', other1: '', other2: '',
  });
  const refs: Record<ExtractKind, React.RefObject<HTMLInputElement>> = {
    br: useRef<HTMLInputElement>(null),
    ci: useRef<HTMLInputElement>(null),
    other1: useRef<HTMLInputElement>(null),
    other2: useRef<HTMLInputElement>(null),
  };

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
        regFlat: company?.regFlat || '',
        regBuilding: company?.regBuilding || '',
        regStreet: company?.regStreet || '',
        regDistrict: company?.regDistrict || '',
        regRegion: company?.regRegion || '香港 Hong Kong',
      });
      setDirectors([]);
      setSecretaries([]);
      setShareholders([]);
      setFileNames({ br: '', ci: '', other1: '', other2: '' });
    }
  }, [open, company]);

  const extract = async (file: File, kind: ExtractKind) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ title: '不支援的檔案格式', description: '請上傳 PDF 或圖片檔案（PNG、JPG）', variant: 'destructive' });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: '檔案太大', description: '檔案大小不能超過 20MB', variant: 'destructive' });
      return;
    }

    const fnName = kind === 'br' ? 'extract-br-info'
      : kind === 'ci' ? 'extract-ci-info'
      : 'extract-resolution-info';

    setExtracting(p => ({ ...p, [kind]: true }));
    setFileNames(p => ({ ...p, [kind]: file.name }));

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

      const data = result.data || {};

      // Merge basic company fields (only fill if currently empty, or always overwrite for BR/CI)
      setFormData(prev => ({
        ...prev,
        name: prev.name || data.companyName || '',
        chineseName: prev.chineseName || data.chineseName || '',
        brNumber: prev.brNumber || data.brNumber || '',
        tradingName: prev.tradingName || data.tradingName || '',
        businessNature: prev.businessNature || data.businessNature || '',
        businessCode: prev.businessCode || data.businessCode || '',
        companyType: data.companyType || prev.companyType,
        incorporationDate: prev.incorporationDate || data.incorporationDate || '',
        jurisdiction: data.jurisdiction || prev.jurisdiction,
        regFlat: prev.regFlat || data.regFlat || '',
        regBuilding: prev.regBuilding || data.regBuilding || '',
        regStreet: prev.regStreet || data.regStreet || '',
        regDistrict: prev.regDistrict || data.regDistrict || '',
        regRegion: prev.regRegion && prev.regRegion !== '香港 Hong Kong'
          ? prev.regRegion : (data.regRegion || prev.regRegion),
      }));

      // Merge people from "other" / resolution documents
      if (Array.isArray(data.directors) && data.directors.length) {
        setDirectors(prev => mergeArr(prev, data.directors, (x) => `${x.nameEnglish || ''}|${x.nameChinese || ''}`));
      }
      if (Array.isArray(data.secretaries) && data.secretaries.length) {
        setSecretaries(prev => mergeArr(prev, data.secretaries, (x) => `${x.nameEnglish || ''}|${x.nameChinese || ''}`));
      }
      if (Array.isArray(data.shareholders) && data.shareholders.length) {
        setShareholders(prev => mergeArr(prev, data.shareholders, (x) => `${x.nameEnglish || ''}|${x.nameChinese || ''}|${x.idNumber || ''}`));
      }

      const extractedCounts = [
        Array.isArray(data.directors) && data.directors.length ? `董事 ${data.directors.length}` : '',
        Array.isArray(data.secretaries) && data.secretaries.length ? `秘書 ${data.secretaries.length}` : '',
        Array.isArray(data.shareholders) && data.shareholders.length ? `股東 ${data.shareholders.length}` : '',
      ].filter(Boolean).join('、');

      toast({
        title: 'AI 辨識完成',
        description: kind === 'br' ? '已填入商業登記證資料。'
          : kind === 'ci' ? '已填入公司註冊證書資料。'
          : `已從文件提取資料${extractedCounts ? `（${extractedCounts}）` : ''}，請檢查並確認。`,
      });
    } catch (err: any) {
      console.error(`${kind} extraction error:`, err);
      toast({ title: 'AI 辨識失敗', description: err.message || '請重試或手動輸入資料', variant: 'destructive' });
    } finally {
      setExtracting(p => ({ ...p, [kind]: false }));
      const ref = refs[kind];
      if (ref.current) ref.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.brNumber) {
      toast({ title: '錯誤', description: '請填寫必填欄位', variant: 'destructive' });
      return;
    }
    const payload: Partial<Company> = {
      ...formData,
      directors: directors as Person[],
      secretaries: secretaries as Person[],
      shareholders: shareholders as Shareholder[],
    };
    onSave(payload);
    onOpenChange(false);
  };

  const renderUploadCard = (kind: ExtractKind, title: string, hint: string) => (
    <div className="p-3 border-2 border-dashed border-primary/30 rounded-lg bg-primary/5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{hint}</p>
      {fileNames[kind] && (
        <div className="flex items-center gap-1 mb-2 text-xs text-primary truncate">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">{fileNames[kind]}</span>
        </div>
      )}
      <input
        ref={refs[kind]}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) extract(f, kind); }}
        className="hidden"
      />
      <Button
        type="button" variant="outline" size="sm" disabled={extracting[kind]}
        onClick={() => refs[kind].current?.click()} className="gap-2 w-full"
      >
        {extracting[kind]
          ? <><Loader2 className="h-4 w-4 animate-spin" />辨識中...</>
          : <><Upload className="h-4 w-4" />上傳</>}
      </Button>
    </div>
  );

  const removeFromArray = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, idx: number) => {
    setter(prev => prev.filter((_, i) => i !== idx));
  };

  const renderPeopleSection = (
    title: string,
    items: Partial<Person>[] | Partial<Shareholder>[],
    setter: any,
  ) => {
    if (!items.length) return null;
    return (
      <div className="col-span-2 mt-2">
        <div className="text-sm font-medium mb-2">{title}（AI 提取，{items.length}）</div>
        <div className="space-y-1 max-h-40 overflow-y-auto rounded border p-2 bg-muted/20">
          {items.map((p: any, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 border-b last:border-0">
              <div className="flex-1 truncate">
                <span className="font-medium">{p.nameEnglish || p.nameChinese || p.name || '(未命名)'}</span>
                {p.nameChinese && p.nameEnglish && <span className="text-muted-foreground"> · {p.nameChinese}</span>}
                {p.idNumber && <span className="text-muted-foreground"> · {p.idNumber}</span>}
                {typeof p.shares === 'number' && p.shares > 0 && <span className="text-muted-foreground"> · {p.shares} 股</span>}
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0"
                onClick={() => removeFromArray(setter, i)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{company ? '編輯公司' : '新增公司'}</DialogTitle>
          <DialogDescription>
            {company ? '修改公司資料' : '上傳 BR / CI / 會議紀錄等文件，AI 自動辨識並填入'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          {/* AI Upload Section - 4 slots */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {renderUploadCard('br', '商業登記證 (BR)', 'AI 自動辨識')}
            {renderUploadCard('ci', '公司註冊證書 (CI)', 'AI 自動辨識')}
            {renderUploadCard('other1', '其他文件 1', '會議紀錄/決議等')}
            {renderUploadCard('other2', '其他文件 2', '會議紀錄/決議等')}
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

            {/* Registered office address */}
            <div className="col-span-2 mt-2 text-sm font-medium">註冊辦事處地址</div>
            <div className="space-y-2">
              <Label htmlFor="regFlat">室/樓</Label>
              <Input id="regFlat" value={formData.regFlat}
                onChange={(e) => setFormData({ ...formData, regFlat: e.target.value })}
                placeholder="例如 Flat A, 12/F" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="regBuilding">大廈</Label>
              <Input id="regBuilding" value={formData.regBuilding}
                onChange={(e) => setFormData({ ...formData, regBuilding: e.target.value })}
                placeholder="大廈名稱" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="regStreet">街道</Label>
              <Input id="regStreet" value={formData.regStreet}
                onChange={(e) => setFormData({ ...formData, regStreet: e.target.value })}
                placeholder="街道及門牌" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="regDistrict">地區</Label>
              <Input id="regDistrict" value={formData.regDistrict}
                onChange={(e) => setFormData({ ...formData, regDistrict: e.target.value })}
                placeholder="例如 中環、觀塘" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="regRegion">區域</Label>
              <Select value={formData.regRegion}
                onValueChange={(value) => setFormData({ ...formData, regRegion: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="香港 Hong Kong">香港 Hong Kong</SelectItem>
                  <SelectItem value="九龍 Kowloon">九龍 Kowloon</SelectItem>
                  <SelectItem value="新界 New Territories">新界 New Territories</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {renderPeopleSection('董事', directors, setDirectors)}
            {renderPeopleSection('秘書', secretaries, setSecretaries)}
            {renderPeopleSection('股東', shareholders, setShareholders)}
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
