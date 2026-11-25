import { useMemo, useRef, useState } from 'react';

/**
 * Bus registration typed directly (25/11/2026): the field is a plain text box, the buses known
 * that match what is typed show under it at once (those starting with it first). What is typed is
 * the value, even for a bus not in the list; a click or Enter on a proposal takes it.
 */
interface Props {
  value: string;
  onChange: (plate: string) => void;
  buses: string[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

const flat = (t: string) => t.toUpperCase().replace(/[\s-]/g, '');

export default function BusPlateInput({ value, onChange, buses, placeholder, className, style }: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  const proposals = useMemo(() => {
    const q = flat(value);
    if (!q) return [];
    const found = buses.filter(b => flat(b).includes(q) && flat(b) !== q);
    const rank = (b: string) => (flat(b).startsWith(q) ? 0 : 1);
    return found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 8);
  }, [value, buses]);

  const pick = (b: string) => { onChange(b); setOpen(false); setHi(-1); };

  return (
    <div ref={boxRef} className="relative"
      onBlur={e => { if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input
        type="text"
        value={value}
        autoComplete="off"
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value.toUpperCase()); setOpen(true); setHi(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (!open || proposals.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, proposals.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, -1)); }
          else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(proposals[hi]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        className={className}
        style={style}
      />
      {open && proposals.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border shadow-lg max-h-56 overflow-y-auto"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          {proposals.map((b, i) => (
            <li key={b}>
              <button type="button" tabIndex={-1}
                onMouseDown={e => { e.preventDefault(); pick(b); }}
                onMouseEnter={() => setHi(i)}
                className="w-full text-left px-3 py-2 text-sm font-medium"
                style={{ backgroundColor: i === hi ? 'var(--primary-light)' : 'transparent', color: 'var(--text-primary)' }}>
                {b}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
