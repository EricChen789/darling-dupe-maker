import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileText, Download, Loader2 } from 'lucide-react';
import { Company } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface NAR1GeneratorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
}

export const NAR1Generator = ({ open, onOpenChange, company }: NAR1GeneratorProps) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [formData, setFormData] = useState({
    returnDate: new Date().toISOString().split('T')[0],
    flat: '',
    building: '',
    street: '',
    district: '',
    region: '香港 Hong Kong',
  });

  const handleGenerate = async () => {
    if (!company) return;

    setIsGenerating(true);

    try {
      const payload = {
        name: company.name,
        brNumber: company.brNumber,
        tradingName: company.tradingName,
        businessNature: company.businessNature,
        businessCode: company.businessCode,
        companyType: company.companyType,
        registeredOffice: {
          flat: formData.flat,
          building: formData.building,
          street: formData.street,
          district: formData.district,
          region: formData.region,
        },
        directors: company.directors.map(d => ({
          nameChinese: d.nameChinese,
          nameEnglish: d.nameEnglish,
          email: d.email,
          identity: d.identity,
          brNumber: d.brNumber,
        })),
        secretaries: company.secretaries.map(s => ({
          nameChinese: s.nameChinese,
          nameEnglish: s.nameEnglish,
          email: s.email,
          identity: s.identity,
          brNumber: s.brNumber,
        })),
        shareholders: company.shareholders.map(sh => ({
          name: sh.name,
          shares: sh.shares,
        })),
        returnDate: formData.returnDate,
      };

      const { data, error } = await supabase.functions.invoke('generate-nar1-pdf', {
        body: payload,
      });

      if (error) throw error;

      // Handle the PDF download
      const blob = new Blob([data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `NAR1_${company.brNumber}_${Date.now()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'PDF 已生成',
        description: `NAR1 表格已成功生成並下載`,
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: '生成失敗',
        description: error instanceof Error ? error.message : '無法生成 PDF，請稍後再試',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (!company) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            生成 NAR1 周年申報表
          </DialogTitle>
          <DialogDescription>
            為「{company.name}」生成 NAR1 周年申報表 PDF
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Company Info Summary */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <h4 className="font-medium text-sm">公司資料摘要</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">公司名稱：</span>
                <span className="font-medium">{company.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">商業登記號碼：</span>
                <span className="font-medium">{company.brNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground">董事人數：</span>
                <span className="font-medium">{company.directors.length} 人</span>
              </div>
              <div>
                <span className="text-muted-foreground">秘書人數：</span>
                <span className="font-medium">{company.secretaries.length} 人</span>
              </div>
            </div>
          </div>

          {/* Directors Preview */}
          {company.directors.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">董事資料</h4>
              <div className="bg-muted/30 rounded-lg p-3 space-y-2 text-sm">
                {company.directors.map((dir, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-muted-foreground w-6">{i + 1}.</span>
                    <span className="font-medium">{dir.nameChinese}</span>
                    <span className="text-muted-foreground">{dir.nameEnglish}</span>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {dir.identity === 'natural' ? '自然人' : '法人'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Secretaries Preview */}
          {company.secretaries.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">秘書資料</h4>
              <div className="bg-muted/30 rounded-lg p-3 space-y-2 text-sm">
                {company.secretaries.map((sec, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-muted-foreground w-6">{i + 1}.</span>
                    <span className="font-medium">{sec.nameChinese}</span>
                    <span className="text-muted-foreground">{sec.nameEnglish}</span>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {sec.identity === 'natural' ? '自然人' : '法人'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Additional Form Fields */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm">申報表資料</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="returnDate">申報表結算日期</Label>
                <Input
                  id="returnDate"
                  type="date"
                  value={formData.returnDate}
                  onChange={(e) => setFormData({ ...formData, returnDate: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>註冊辦事處地址</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="室／樓／座等"
                  value={formData.flat}
                  onChange={(e) => setFormData({ ...formData, flat: e.target.value })}
                />
                <Input
                  placeholder="大廈"
                  value={formData.building}
                  onChange={(e) => setFormData({ ...formData, building: e.target.value })}
                />
                <Input
                  placeholder="街道／屋苑／地段／村等"
                  value={formData.street}
                  onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                  className="col-span-2"
                />
                <Input
                  placeholder="區"
                  value={formData.district}
                  onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                />
                <Select
                  value={formData.region}
                  onValueChange={(value) => setFormData({ ...formData, region: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="地區" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="香港 Hong Kong">香港 Hong Kong</SelectItem>
                    <SelectItem value="九龍 Kowloon">九龍 Kowloon</SelectItem>
                    <SelectItem value="新界 New Territories">新界 New Territories</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="bg-primary text-primary-foreground"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                生成並下載 PDF
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NAR1Generator;
