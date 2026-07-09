import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search as SearchIcon, Building2, User, Loader2, ArrowRight } from 'lucide-react';
import { useGlobalSearch, type SearchResult } from '@/hooks/useSearch';

const identityLabel = (v?: string) => {
  const s = (v || '').toLowerCase();
  if (s.includes('corp') || s.includes('body') || s === 'legal') return '法人';
  if (s.includes('natural') || s === 'individual' || s === 'person') return '自然人';
  return v || '';
};
const roleLabel = (r: string) =>
  r === 'director' ? '董事' : r === 'shareholder' ? '股東' : r === 'secretary' ? '秘書' : r;
function personName(m: { name_english?: string; name_chinese?: string }) {
  const en = (m.name_english || '').trim();
  const cn = (m.name_chinese || '').trim();
  return en && cn ? `${en}（${cn}）` : en || cn || '—';
}

/** 全域搜尋（func_spec 6.1）— 常駐頂欄，任何頁面可用。 */
const GlobalSearch = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { data: results = [], isFetching } = useGlobalSearch(query);
  const boxRef = useRef<HTMLDivElement>(null);

  // 點擊外部關閉下拉
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const goCompany = (id: string) => {
    setOpen(false);
    navigate(`/search?company=${id}`);
  };
  const goSearchPage = () => {
    if (!query.trim()) return;
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div ref={boxRef} className="relative w-72 max-w-[40vw]">
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        className="pl-9 h-8 text-sm"
        placeholder="全域搜尋公司／人員…"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Enter') goSearchPage(); if (e.key === 'Escape') setOpen(false); }}
      />
      {isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-96 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {results.length === 0 && !isFetching && (
            <p className="text-sm text-muted-foreground px-3 py-4">無符合「{query}」的結果。</p>
          )}
          {results.slice(0, 12).map((r: SearchResult) => r.type === 'company' ? (
            <button key={`c-${r.id}`} onClick={() => goCompany(r.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 text-left transition-colors">
              <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{r.name}</div>
                <div className="text-xs text-muted-foreground truncate">{r.chinese_name || '—'}　·　BR {r.company_number || '—'}</div>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">公司</Badge>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          ) : (
            <div key={`p-${r.id}`} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors">
              <div className="h-7 w-7 rounded bg-blue-500/10 flex items-center justify-center shrink-0">
                <User className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{personName(r)}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {identityLabel(r.identity)}
                  {r.roles.length > 0 && '　·　' + r.roles.slice(0, 2).map(x => `${roleLabel(x.role)}@${x.company_name}`).join('、')}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">人員</Badge>
              {r.roles.length > 0 && (
                <button onClick={() => goCompany(r.roles[0].company_id)}
                  className="text-xs text-primary hover:underline shrink-0 flex items-center gap-0.5">
                  查登記冊 <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {results.length > 0 && (
            <button onClick={goSearchPage}
              className="w-full text-center text-xs text-primary hover:bg-muted/50 py-2 border-t border-border">
              在「歷史檢索」查看全部結果 →
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
