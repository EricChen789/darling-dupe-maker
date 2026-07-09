import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
  History, Loader2, GitCompare, Camera, ArrowRight, Check, X, FileClock,
} from 'lucide-react';
import { Company } from '@/types';
import {
  useCompanyVersions, useCreateVersionSnapshot, versionFieldLabel,
  type CompanyVersion,
} from '@/hooks/useCompanyVersions';

const fmtTime = (s?: string) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z') : s);
  return isNaN(d.getTime()) ? s : d.toLocaleString('zh-HK');
};

// VE-02 兩版本欄位差異
function diffSnapshots(a?: CompanyVersion, b?: CompanyVersion) {
  if (!a || !b) return [];
  const [older, newer] = a.version_no < b.version_no ? [a, b] : [b, a];
  const keys = new Set([...Object.keys(older.snapshot), ...Object.keys(newer.snapshot)]);
  const rows: { key: string; before: string; after: string }[] = [];
  keys.forEach((k) => {
    const before = older.snapshot[k] ?? '';
    const after = newer.snapshot[k] ?? '';
    if (String(before) !== String(after)) rows.push({ key: k, before: String(before), after: String(after) });
  });
  return rows;
}

export function CompanyVersionsTab({ company }: { company: Company }) {
  const { data: versions = [], isLoading } = useCompanyVersions(company.id);
  const createSnapshot = useCreateVersionSnapshot();

  const [selectedId, setSelectedId] = useState<string | null>(null);   // VE-03 詳情
  const [compareMode, setCompareMode] = useState(false);               // VE-02 對比模式
  const [compareIds, setCompareIds] = useState<string[]>([]);          // 選中的兩版本

  const selected = versions.find((v) => v.id === selectedId) || null;

  const [cmpA, cmpB] = useMemo(() => {
    const a = versions.find((v) => v.id === compareIds[0]);
    const b = versions.find((v) => v.id === compareIds[1]);
    return [a, b];
  }, [versions, compareIds]);

  const diffRows = useMemo(() => diffSnapshots(cmpA, cmpB), [cmpA, cmpB]);

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id]; // 保留最新選的兩個
      return [...prev, id];
    });
  };

  const handleSnapshot = () => {
    createSnapshot.mutate(company.id, {
      onSuccess: (r) => {
        toast({
          title: r.created ? `已建立版本 v${r.version_no}` : '資料無變化',
          description: r.created ? undefined : '與最新版本相同，未建立新版本',
        });
      },
      onError: () => toast({ title: '建立版本失敗', variant: 'destructive' }),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> 載入版本記錄中...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileClock className="h-4 w-4 text-primary" /> 版本記錄
          <Badge variant="secondary" className="text-xs">{versions.length}</Badge>
        </h3>
        <div className="flex gap-2">
          <Button
            variant={compareMode ? 'default' : 'outline'} size="sm"
            onClick={() => { setCompareMode((m) => !m); setCompareIds([]); setSelectedId(null); }}
            disabled={versions.length < 2}
          >
            <GitCompare className="h-3.5 w-3.5 mr-1" /> {compareMode ? '退出對比' : '版本對比'}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSnapshot} disabled={createSnapshot.isPending}>
            {createSnapshot.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Camera className="h-3.5 w-3.5 mr-1" />}
            建立快照
          </Button>
        </div>
      </div>

      {compareMode && (
        <p className="text-xs text-muted-foreground">
          {compareIds.length < 2 ? `請選擇兩個版本進行對比（已選 ${compareIds.length}/2）` : '對比結果如下：'}
        </p>
      )}

      {versions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <History className="h-8 w-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">尚無版本記錄</p>
          <p className="text-xs text-muted-foreground/70 mt-1">公司資料每次變更後將自動記錄一個版本</p>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* 左：版本列表 VE-01 */}
          <div className="w-1/2 shrink-0 space-y-2">
            {versions.map((v) => {
              const isSel = compareMode ? compareIds.includes(v.id) : selectedId === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => compareMode ? toggleCompare(v.id) : setSelectedId(v.id)}
                  className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                    isSel ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {compareMode && (
                        <span className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                          isSel ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'
                        }`}>
                          {isSel && <Check className="h-3 w-3" />}
                        </span>
                      )}
                      <Badge variant={v.version_no === versions[0].version_no ? 'default' : 'outline'} className="text-xs shrink-0">
                        v{v.version_no}
                      </Badge>
                      <span className="font-medium truncate">{v.change_summary || '更新'}</span>
                    </div>
                    {v.version_no === versions[0].version_no && (
                      <Badge variant="secondary" className="text-xs shrink-0">最新</Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">{fmtTime(v.created_at)}</div>
                  {v.changed_fields.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {v.changed_fields.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px] py-0">{versionFieldLabel(f)}</Badge>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* 右：詳情 VE-03 / 對比 VE-02 */}
          <div className="flex-1 min-w-0">
            {compareMode ? (
              compareIds.length < 2 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                  <GitCompare className="h-8 w-8 text-muted-foreground/40 mb-3" />
                  <p className="text-sm">從左側選擇兩個版本以比較差異</p>
                </div>
              ) : (
                <div className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2 text-sm font-medium mb-3">
                    <Badge variant="outline">v{(cmpA && cmpB && cmpA.version_no < cmpB.version_no ? cmpA : cmpB)?.version_no}</Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="default">v{(cmpA && cmpB && cmpA.version_no < cmpB.version_no ? cmpB : cmpA)?.version_no}</Badge>
                    <span className="text-muted-foreground font-normal ml-1">共 {diffRows.length} 項變更</span>
                  </div>
                  {diffRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">兩個版本之間沒有欄位差異</p>
                  ) : (
                    <div className="space-y-2">
                      {diffRows.map((r) => (
                        <div key={r.key} className="rounded border border-border bg-muted/20 p-2 text-xs">
                          <div className="font-medium mb-1">{versionFieldLabel(r.key)}</div>
                          <div className="flex items-center gap-2">
                            <span className="flex-1 rounded bg-destructive/10 text-destructive px-2 py-1 line-through break-words">
                              {r.before || '（空）'}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="flex-1 rounded bg-green-500/10 text-green-700 px-2 py-1 break-words">
                              {r.after || '（空）'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            ) : selected ? (
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2 text-sm font-medium mb-3">
                  <Badge variant="default">v{selected.version_no}</Badge>
                  <span>資料快照</span>
                  <span className="text-muted-foreground font-normal text-xs ml-auto">{fmtTime(selected.created_at)}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {Object.entries(selected.snapshot).map(([k, val]) => (
                    <div key={k}>
                      <span className="text-muted-foreground text-xs">{versionFieldLabel(k)}</span>
                      <p className={`font-medium mt-0.5 break-words ${selected.changed_fields.includes(k) ? 'text-primary' : ''}`}>
                        {val || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <X className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm">從左側選擇一個版本以查看完整資料快照</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
