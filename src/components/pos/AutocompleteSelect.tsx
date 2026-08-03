import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';

export interface AutocompleteOption {
  id: string;
  label: string;
  sublabel?: string;
  keywords?: string;
}

interface AutocompleteSelectProps {
  options: AutocompleteOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  required?: boolean;
  allowClear?: boolean;
  emptyText?: string;
  disabled?: boolean;
}

export default function AutocompleteSelect({
  options,
  value,
  onChange,
  placeholder = 'Rechercher...',
  required = false,
  allowClear = true,
  emptyText = 'Aucun résultat',
  disabled = false,
}: AutocompleteSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => options.find(o => o.id === value), [options, value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase().trim();
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      (o.sublabel?.toLowerCase().includes(q) ?? false) ||
      (o.keywords?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  useEffect(() => {
    if (highlighted >= filtered.length) setHighlighted(0);
  }, [filtered.length, highlighted]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (selected) setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selected]);

  if (disabled) return null;

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) handleSelect(filtered[highlighted].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className="w-full flex items-center gap-2 px-3 py-3 rounded-xl border-2 text-base outline-none transition-colors"
        style={{ borderColor: open ? 'var(--primary)' : 'var(--border)', backgroundColor: 'var(--surface)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1 }}
        onClick={() => { if (!disabled) { setOpen(true); inputRef.current?.focus(); } }}
      >
        {open ? (
          <>
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); setHighlighted(0); }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1 bg-transparent outline-none text-base"
              style={{ color: 'var(--text-primary)' }}
              autoFocus
            />
          </>
        ) : (
          <>
            <span
              className="flex-1 truncate"
              style={{ color: selected ? 'var(--text-primary)' : 'var(--text-muted)' }}
            >
              {selected ? selected.label : placeholder}
            </span>
            {allowClear && selected && !disabled && (
              <button
                type="button"
                onClick={handleClear}
                className="p-0.5 rounded-lg flex-shrink-0"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          </>
        )}
      </div>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-xl border-2 max-h-64 overflow-y-auto shadow-xl"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              {emptyText}
            </div>
          ) : (
            filtered.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                onMouseEnter={() => setHighlighted(idx)}
                onClick={() => handleSelect(opt.id)}
                className="w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors"
                style={{
                  backgroundColor: idx === highlighted ? 'var(--primary-light)' : 'transparent',
                }}
              >
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: opt.id === value ? 'var(--primary)' : 'var(--text-primary)' }}
                >
                  {opt.label}
                </span>
                {opt.sublabel && (
                  <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {opt.sublabel}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
      {required && <input type="hidden" value={value} required />}
    </div>
  );
}
