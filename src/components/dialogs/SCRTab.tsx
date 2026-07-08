import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Edit, Trash2, Save, X, Download, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

import { Company, SignificantController } from '@/types';
import { useSCRByCompany, useUpsertSCR, useDeleteSCR } from '@/hooks/useSCR';

const empty = (companyId: string, regAddr: string): Partial<SignificantController> => ({
  companyId,
  identity: 'natural',
  nameEnglish: '', nameChinese: '', idNumber: '',
  address: '', serviceAddress: regAddr,
  dateBecame: '', dateCeased: '',
  natureShares: false, natureVoting: false, natureAppoint: false,
  natureInfluence: false, natureTrust: false, natureOther: '',
  isDesignatedRep: false, designatedRepName: '', designatedRepContact: '',
});

export function SCRTab({ company }: { company: Company }) {
  const { data: scrs = [], isLoading } = useSCRByCompany(company.id);
  const upsert = useUpsertSCR();
  const del = useDeleteSCR();
  const [editing, setEditing] = useState<Partial<SignificantController> | null>(null);
  const [downloading, setDownloading] = useState(false);

  const regAddr = [company.regFlat, company.regBuilding, company.regStreet, company.regDistrict, company.regRegion]
    .filter(Boolean).join(', ');

  const handleSave = () => {
    if (!editing) return;
    if (!editing.nameEnglish && !editing.nameChinese) {
      toast({ title: '請至少填寫姓名', variant: 'destructive' }); return;
    }
    upsert.mutate(editing as any, {
      onSuccess: () => { toast({ title: '已儲存' }); setEditing(null); },
      onError: (e: any) => toast({ title: '儲存失敗', description: e.message, variant: 'destructive' }),
    });
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem("secretary_jwt") || "";
      const url = `/api/generate-scr-pdf`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ companyId: company.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      const byteChars = atob(result.pdf);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (e: any) {
      toast({ title: 'PDF 生成失敗', description: e.message, variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 font-semibold text-sm">
          <ShieldCheck className="h-4 w-4 text-primary" />
          重要控制人登記冊 (SCR)
          <Badge variant="secondary" className="text-xs">{scrs.length}</Badge>
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading || scrs.length === 0}>
            {downloading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
            下載登記冊 PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(empty(company.id, regAddr))}>
            <Plus className="h-3.5 w-3.5 mr-1" /> 新增
          </Button>
        </div>
      </div>

      {editing && (
        <SCREditor value={editing} setValue={setEditing} regAddr={regAddr}
          onSave={handleSave} onCancel={() => setEditing(null)} saving={upsert.isPending} />
      )}

      {isLoading ? (
        <p className="text-muted-foreground text-sm">載入中...</p>
      ) : scrs.length === 0 && !editing ? (
        <p className="text-muted-foreground text-sm">尚無重要控制人記錄</p>
      ) : (
        <div className="grid gap-2">
          {scrs.map((s) => (
            <div key={s.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm group">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{s.nameEnglish || s.nameChinese}</span>
                  {s.nameEnglish && s.nameChinese && <span className="ml-2 text-muted-foreground">{s.nameChinese}</span>}
                  {s.isDesignatedRep && <Badge variant="default" className="ml-2 text-xs">指定代表</Badge>}
                  <Badge variant="outline" className="ml-2 text-xs">{s.identity === 'natural' ? '自然人' : '法人'}</Badge>
                </div>
                <div className="hidden group-hover:flex gap-1">
                  <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setEditing(s)}>
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive"
                    onClick={() => del.mutate({ id: s.id, companyId: company.id })}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <div>身份證/編號: {s.idNumber || '-'}</div>
                <div>成為控制人: {s.dateBecame || '-'}</div>
                <div className="col-span-2">居住/註冊地址: {s.address || '-'}</div>
                <div className="col-span-2">控制性質: {[
                  s.natureShares && '持股>25%',
                  s.natureVoting && '表決權>25%',
                  s.natureAppoint && '任命董事權',
                  s.natureInfluence && '重大影響',
                  s.natureTrust && '信託',
                  s.natureOther,
                ].filter(Boolean).join('、') || '-'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SCREditor({ value, setValue, regAddr, onSave, onCancel, saving }: {
  value: Partial<SignificantController>;
  setValue: (v: Partial<SignificantController>) => void;
  regAddr: string;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const set = (k: keyof SignificantController, v: any) => setValue({ ...value, [k]: v });
  return (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 mb-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">身份類型</Label>
          <Select value={value.identity || 'natural'} onValueChange={(v) => set('identity', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="natural">自然人</SelectItem>
              <SelectItem value="corporate">法人</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">身份證/護照/公司編號</Label><Input value={value.idNumber || ''} onChange={e => set('idNumber', e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">英文名稱</Label><Input value={value.nameEnglish || ''} onChange={e => set('nameEnglish', e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">中文名稱</Label><Input value={value.nameChinese || ''} onChange={e => set('nameChinese', e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">成為控制人日期</Label><Input value={value.dateBecame || ''} onChange={e => set('dateBecame', e.target.value)} placeholder="DD/MM/YYYY" /></div>
        <div className="space-y-1"><Label className="text-xs">停止日期</Label><Input value={value.dateCeased || ''} onChange={e => set('dateCeased', e.target.value)} placeholder="DD/MM/YYYY" /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">居住/註冊地址</Label><Textarea value={value.address || ''} onChange={e => set('address', e.target.value)} rows={2} /></div>
        <div className="col-span-2 space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">服務地址 (Service Address)</Label>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
              onClick={() => set('serviceAddress', regAddr)}>同註冊辦事處</Button>
          </div>
          <Textarea value={value.serviceAddress || ''} onChange={e => set('serviceAddress', e.target.value)} rows={2} />
        </div>
      </div>

      <Separator />

      <div>
        <Label className="text-xs font-medium">控制性質 (可複選)</Label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <CB id="ns" label="持有 >25% 已發行股份" checked={!!value.natureShares} onChange={(v) => set('natureShares', v)} />
          <CB id="nv" label="持有 >25% 表決權" checked={!!value.natureVoting} onChange={(v) => set('natureVoting', v)} />
          <CB id="na" label="可任命/罷免董事多數" checked={!!value.natureAppoint} onChange={(v) => set('natureAppoint', v)} />
          <CB id="ni" label="行使重大影響或控制" checked={!!value.natureInfluence} onChange={(v) => set('natureInfluence', v)} />
          <CB id="nt" label="信託/商號的控制" checked={!!value.natureTrust} onChange={(v) => set('natureTrust', v)} />
        </div>
        <div className="mt-2 space-y-1">
          <Label className="text-xs">其他補充</Label>
          <Input value={value.natureOther || ''} onChange={e => set('natureOther', e.target.value)} placeholder="其他控制性質補充說明" />
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <CB id="dr" label="此人為公司的指定代表 (Designated Representative)" checked={!!value.isDesignatedRep} onChange={(v) => set('isDesignatedRep', v)} />
        {value.isDesignatedRep && (
          <div className="grid grid-cols-2 gap-2 pl-6">
            <div className="space-y-1"><Label className="text-xs">指定代表姓名</Label><Input value={value.designatedRepName || ''} onChange={e => set('designatedRepName', e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">聯絡資訊</Label><Input value={value.designatedRepContact || ''} onChange={e => set('designatedRepContact', e.target.value)} placeholder="電話 / 電郵" /></div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="h-3.5 w-3.5 mr-1" /> 取消</Button>
        <Button size="sm" onClick={onSave} disabled={saving} className="bg-primary text-primary-foreground">
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />} 儲存
        </Button>
      </div>
    </div>
  );
}

function CB({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs cursor-pointer">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <span>{label}</span>
    </label>
  );
}
