import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Copy, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Company } from '@/types';
import { useCompanies, useCopyFromCompany } from '@/hooks/useCompanies';
import { useSCRByCompany } from '@/hooks/useSCR';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetCompany: Company;
  roleOverride?: { role: string; isReserve?: boolean } | null;
}

export function CopyFromCompanyDialog({ open, onOpenChange, targetCompany, roleOverride }: Props) {
  const { data: companies = [], isLoading } = useCompanies();
  const queryClient = useQueryClient();
  const copy = useCopyFromCompany();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedOfficers, setSelectedOfficers] = useState<Set<string>>(new Set());
  const [selectedShs, setSelectedShs] = useState<Set<string>>(new Set());
  const [selectedSCRs, setSelectedSCRs] = useState<Set<string>>(new Set());

  const { data: sourceSCRs = [] } = useSCRByCompany(sourceId || undefined);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return companies
      .filter(c => !q || c.name.toLowerCase().includes(q) || (c.chineseName || '').includes(q) || c.brNumber.includes(q));
  }, [companies, search, targetCompany.id]);

  const source = companies.find(c => c.id === sourceId);

  const reset = () => {
    setSourceId(null); setSearch(''); setSelectedOfficers(new Set()); setSelectedShs(new Set()); setSelectedSCRs(new Set());
  };

  const handleClose = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const ns = new Set(set);
    if (ns.has(id)) ns.delete(id); else ns.add(id);
    setSet(ns);
  };

  const handleCopy = async () => {
    if (!sourceId) return;
    if (selectedOfficers.size === 0 && selectedShs.size === 0 && selectedSCRs.size === 0) {
      toast({ title: '請至少選擇一位人員', variant: 'destructive' }); return;
    }

    let scrError: any = null;
    let scrInsertedIds: string[] = [];

    // Copy SCR records (significant_controllers table)
    if (selectedSCRs.size > 0) {
      const scrToCopy = sourceSCRs.filter(s => selectedSCRs.has(s.id));
      const scrInserts = scrToCopy.map(s => ({
        company_id: targetCompany.id,
        identity: s.identity,
        name_english: s.nameEnglish,
        name_chinese: s.nameChinese,
        id_number: s.idNumber,
        address: s.address,
        service_address: s.serviceAddress,
        date_became: s.dateBecame || new Date().toLocaleDateString('en-GB'),
        date_ceased: '',
        nature_shares: s.natureShares,
        nature_voting: s.natureVoting,
        nature_appoint: s.natureAppoint,
        nature_influence: s.natureInfluence,
        nature_trust: s.natureTrust,
        nature_other: s.natureOther,
        is_designated_rep: s.isDesignatedRep,
        designated_rep_name: s.designatedRepName,
        designated_rep_contact: s.designatedRepContact,
      }));

      if (scrInserts.length > 0) {
        const { data: insertResult, error } = await supabase.from('significant_controllers' as any).insert(scrInserts);
        scrError = error;
        if (!error && insertResult?.ids) {
          scrInsertedIds = insertResult.ids;
          // Direct cache update for instant UI response
          const insertedSCRs = scrToCopy.map((s, i) => ({
            ...s,
            id: insertResult.ids[i] || s.id,
            companyId: targetCompany.id,
          }));
          queryClient.setQueryData(['scr', targetCompany.id], (old: any[] | undefined) => {
            return [...(old || []), ...insertedSCRs];
          });
        }
      }
    }

    // Copy officers & shareholders (person_company_roles table)
    if (selectedOfficers.size > 0 || selectedShs.size > 0) {
      try {
        await copy.mutateAsync({
          sourceCompanyId: sourceId,
          targetCompanyId: targetCompany.id,
          officerIds: Array.from(selectedOfficers),
          shareholderIds: Array.from(selectedShs),
          roleOverride: roleOverride || undefined,
        });
        const parts: string[] = [];
        const officerLabel = roleOverride
          ? (roleOverride.isReserve ? '備選董事' : '授權代表')
          : '董事/秘書/授權代表';
        if (selectedOfficers.size > 0) parts.push(`${selectedOfficers.size} 位${officerLabel}`);
        if (selectedShs.size > 0) parts.push(`${selectedShs.size} 位股東`);
        if (selectedSCRs.size > 0 && !scrError) parts.push(`${selectedSCRs.size} 位重要控制人`);
        if (scrError) {
          toast({ title: '部份複製成功', description: `${parts.join('、')}已複製，但重要控制人複製失敗：${scrError.message}`, variant: 'destructive' });
        } else {
          toast({ title: '複製成功', description: `已複製 ${parts.join('、')}` });
        }
        // Force immediate refetch to ensure UI updates instantly
        await queryClient.refetchQueries({ queryKey: ['companies'] });
        if (selectedSCRs.size > 0 && !scrError) {
          queryClient.invalidateQueries({ queryKey: ['scr', targetCompany.id] });
        }
        handleClose(false);
      } catch (e: any) {
        toast({ title: '複製失敗', description: e.message, variant: 'destructive' });
      }
    } else {
      // Only SCRs were selected
      if (scrError) {
        toast({ title: '複製失敗', description: scrError.message, variant: 'destructive' });
      } else {
        toast({ title: '複製成功', description: `已複製 ${selectedSCRs.size} 位重要控制人` });
        await queryClient.refetchQueries({ queryKey: ['scr', targetCompany.id] });
        handleClose(false);
      }
    }
  };

  const officers = source ? [
    ...source.directors.map(d => ({ ...d, label: '董事' })),
    ...source.secretaries.map(s => ({ ...s, label: '秘書' })),
    ...(source.authorizedReps || []).map(a => ({ ...a, label: '授權代表' })),
  ] : [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" /> 從所有公司複製人員至「{targetCompany.name}」
          </DialogTitle>
          <DialogDescription>
            {roleOverride
              ? <>選擇來源公司的人員，複製後將自動設為<Badge variant="default" className="mx-1 text-xs">{roleOverride.isReserve ? '備選董事' : roleOverride.role === 'authorized_representative' ? '授權代表' : roleOverride.role}</Badge>角色</>
              : '選擇任何公司作為來源，將其董事、秘書、授權代表及股東資料複製到目標公司'
            }
          </DialogDescription>
        </DialogHeader>

        {!sourceId ? (
          <div>
            <div className="relative mb-3">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="搜尋公司名稱或商業登記號碼..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <ScrollArea className="h-[400px] border rounded-md">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground">載入中...</div>
              ) : (
                <div className="divide-y">
                  {filtered.map(c => (
                    <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors"
                      onClick={() => setSourceId(c.id)}>
                      <div className="font-medium text-sm">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.chineseName && <span>{c.chineseName} · </span>}
                        BR: {c.brNumber} · {c.directors.length}董/{c.secretaries.length}秘/{(c.authorizedReps || []).length}代/{c.shareholders.length}股
                      </div>
                    </button>
                  ))}
                  {filtered.length === 0 && <div className="p-4 text-center text-muted-foreground text-sm">無符合結果</div>}
                </div>
              )}
            </ScrollArea>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3 px-3 py-2 bg-muted/30 rounded">
              <div className="text-sm">
                <span className="text-muted-foreground">來源：</span>
                <span className="font-medium">{source?.name}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSourceId(null)}>變更</Button>
            </div>

            <ScrollArea className="h-[400px] border rounded-md p-3 space-y-4">
              <div>
                <h4 className="text-sm font-semibold mb-2">
                  {roleOverride
                    ? <>可選人員 ({officers.length})</>
                    : <>董事 / 秘書 / 授權代表 ({officers.length})</>
                  }
                </h4>
                {officers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">無</p>
                ) : (
                  <div className="space-y-1">
                    {officers.map(o => (
                      <label key={o.id} className="flex items-center gap-2 px-2 py-1 hover:bg-muted/40 rounded cursor-pointer">
                        <Checkbox checked={selectedOfficers.has(o.id)} onCheckedChange={() => toggle(selectedOfficers, setSelectedOfficers, o.id)} />
                        <span className="text-sm flex-1">{o.nameEnglish || o.nameChinese}</span>
                        <Badge variant="outline" className="text-xs">{o.label}</Badge>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {!roleOverride && (
                <>
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold mb-2">股東 ({source?.shareholders.length || 0})</h4>
                    {(source?.shareholders.length || 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">無</p>
                    ) : (
                      <div className="space-y-1">
                        {source!.shareholders.map(s => (
                          <label key={s.id} className="flex items-center gap-2 px-2 py-1 hover:bg-muted/40 rounded cursor-pointer">
                            <Checkbox checked={selectedShs.has(s.id)} onCheckedChange={() => toggle(selectedShs, setSelectedShs, s.id)} />
                            <span className="text-sm flex-1">{s.nameEnglish || s.nameChinese || s.name}</span>
                            <Badge variant="secondary" className="text-xs">{s.shares.toLocaleString()} 股</Badge>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-4">
                    <h4 className="text-sm font-semibold mb-2">重要控制人 SCR ({sourceSCRs.length})</h4>
                    {sourceSCRs.length === 0 ? (
                      <p className="text-xs text-muted-foreground">無</p>
                    ) : (
                      <div className="space-y-1">
                        {sourceSCRs.map(s => (
                          <label key={s.id} className="flex items-center gap-2 px-2 py-1 hover:bg-muted/40 rounded cursor-pointer">
                            <Checkbox checked={selectedSCRs.has(s.id)} onCheckedChange={() => toggle(selectedSCRs, setSelectedSCRs, s.id)} />
                            <span className="text-sm flex-1">{s.nameEnglish || s.nameChinese}</span>
                            {s.nameEnglish && s.nameChinese && <span className="text-xs text-muted-foreground">{s.nameChinese}</span>}
                            <Badge variant="outline" className="text-xs">{s.identity === 'natural' ? '自然人' : '法人'}</Badge>
                            {s.isDesignatedRep && <Badge variant="default" className="text-xs">指定代表</Badge>}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </ScrollArea>

            <p className="text-xs text-muted-foreground mt-2">
              {roleOverride
                ? <>已選擇：{selectedOfficers.size} 位人員 → 將設為{roleOverride.isReserve ? '備選董事' : '授權代表'}</>
                : <>已選擇：{selectedOfficers.size} 位董事/秘書/授權代表、{selectedShs.size} 位股東、{selectedSCRs.size} 位重要控制人</>
              }
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>取消</Button>
          <Button onClick={handleCopy} disabled={!sourceId || copy.isPending} className="bg-primary text-primary-foreground">
            {copy.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Copy className="h-4 w-4 mr-1" />}
            複製到此公司
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
