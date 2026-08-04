import { useMemo } from 'react';
import { Check } from 'lucide-react';

interface ManualSeatGridProps {
  available: number;
  selected: string[];
  onChange: (seats: string[]) => void;
}

export default function ManualSeatGrid({ available, selected, onChange }: ManualSeatGridProps) {
  const seats = useMemo(
    () => Array.from({ length: available }, (_, i) => String(i + 1)),
    [available]
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggleSeat = (seat: string) => {
    if (selectedSet.has(seat)) {
      onChange(selected.filter(s => s !== seat));
    } else {
      onChange([...selected, seat]);
    }
  };

  const selectAll = () => onChange(seats);
  const clearAll = () => onChange([]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {selected.length} / {available} sièges sélectionnés
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="text-xs font-bold px-2 py-1 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Tout sélectionner
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-bold px-2 py-1 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Effacer
          </button>
        </div>
      </div>
      <div
        className="grid gap-2 p-3 rounded-xl max-h-64 overflow-y-auto"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))',
          backgroundColor: 'var(--surface-raised)',
          border: '1px solid var(--border)',
        }}
      >
        {seats.map(seat => {
          const isSelected = selectedSet.has(seat);
          return (
            <button
              key={seat}
              type="button"
              onClick={() => toggleSeat(seat)}
              className="w-11 h-11 rounded-lg flex items-center justify-center text-sm font-bold transition-all relative"
              style={{
                backgroundColor: isSelected ? 'var(--primary)' : 'var(--surface)',
                color: isSelected ? '#fff' : 'var(--text-primary)',
                border: `2px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
              }}
            >
              {isSelected && (
                <Check className="w-3 h-3 absolute top-0.5 right-0.5" />
              )}
              {seat}
            </button>
          );
        })}
      </div>
    </div>
  );
}
