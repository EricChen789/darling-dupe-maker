import { useState, useRef, useEffect } from 'react';
import { Check, ChevronsUpDown, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export interface MultiSelectOption {
  id: string;
  label: string;
  sub?: string;
  meta?: string;
}

interface SearchableMultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onToggle: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}

export function SearchableMultiSelect({
  options,
  selected,
  onToggle,
  placeholder = '選擇...',
  searchPlaceholder = '搜尋...',
  emptyText = '無結果',
  className,
  disabled,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus search input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSearch('');
    }
  }, [open]);

  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          (o.sub || '').toLowerCase().includes(search.toLowerCase()) ||
          (o.meta || '').toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const selectedOptions = options.filter((o) => selected.includes(o.id));

  const handleToggle = (id: string) => {
    onToggle(id);
    // Don't close popover on toggle
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between h-auto min-h-10',
            selected.length === 0 && 'text-muted-foreground',
            className
          )}
        >
          <div className="flex flex-wrap gap-1 items-center flex-1 min-w-0">
            {selectedOptions.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                {selectedOptions.slice(0, 3).map((o) => (
                  <Badge
                    key={o.id}
                    variant="secondary"
                    className="text-xs max-w-[150px] truncate"
                  >
                    {o.label}
                  </Badge>
                ))}
                {selectedOptions.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{selectedOptions.length - 3}
                  </Badge>
                )}
              </>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            className="flex h-8 w-full rounded-md bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          ) : (
            filtered.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <div
                  key={option.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleToggle(option.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-sm px-2 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground',
                    isSelected && 'bg-primary/10'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-primary',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'opacity-50'
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{option.label}</div>
                    {option.sub && (
                      <div className="text-xs text-muted-foreground truncate">
                        {option.sub}
                      </div>
                    )}
                  </div>
                  {option.meta && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {option.meta}
                    </Badge>
                  )}
                </div>
              );
            })
          )}
        </div>
        {selected.length > 0 && (
          <div className="flex items-center gap-2 border-t px-3 py-2">
            <span className="text-xs text-muted-foreground">
              已選 {selected.length} 項
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                selected.forEach((id) => onToggle(id));
              }}
            >
              <X className="h-3 w-3 mr-1" />
              清除全部
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Single-select variant — uses the same UI, but replaces one selection at a time */
interface SearchableSelectProps {
  options: MultiSelectOption[];
  selected: string;
  onSelect: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  options,
  selected,
  onSelect,
  placeholder = '選擇...',
  searchPlaceholder = '搜尋...',
  emptyText = '無結果',
  className,
  disabled,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSearch('');
    }
  }, [open]);

  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          (o.sub || '').toLowerCase().includes(search.toLowerCase()) ||
          (o.meta || '').toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const selectedOption = options.find((o) => o.id === selected);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between',
            !selected && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            className="flex h-8 w-full rounded-md bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          ) : (
            filtered.map((option) => {
              const isSelected = option.id === selected;
              return (
                <div
                  key={option.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelect(option.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-sm px-2 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground',
                    isSelected && 'bg-primary/10'
                  )}
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.sub && (
                    <span className="text-xs text-muted-foreground truncate">
                      {option.sub}
                    </span>
                  )}
                  {option.meta && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {option.meta}
                    </Badge>
                  )}
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
