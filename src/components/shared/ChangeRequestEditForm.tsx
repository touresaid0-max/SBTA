import { useEffect, useState } from 'react';
import { supabase } from '@/services/supabase';
import PhoneInputCI from '@/components/shared/PhoneInputCI';
import { EXPENSE_TYPES, readableValue as readable, type EditField } from '@/services/changeRequestForms';
import { normalizePhoneCI, toStoredPhoneCI } from '@/utils/phoneCI';

interface Choice { id: string; label: string }

interface Props {
  fields: EditField[];
  snapshot: Record<string, unknown>;
  edited: Record<string, unknown>;
  /** Sets one or more values of the copy (a choice also sets its readable value) */
  onChange: (values: Record<string, unknown>) => void;
}

/** Lines, buses and drivers to choose from: the same lists as the guichet's Nouveau départ. */
async function loadChoices(kinds: Set<string>): Promise<Record<'route' | 'bus' | 'driver', Choice[]>> {
  const [routes, buses, drivers] = await Promise.all([
    kinds.has('route') ? supabase.from('routes').select('id, name').eq('is_active', true).order('name') : null,
    kinds.has('bus') ? supabase.from('buses').select('id, registration_number').is('archived_at', null).order('registration_number') : null,
    kinds.has('driver') ? supabase.from('users').select('id, full_name').eq('role', 'chauffeur').eq('status', 'active').order('full_name') : null,
  ]);
  return {
    route: ((routes?.data ?? []) as { id: string; name: string }[]).map(r => ({ id: r.id, label: r.name })),
    bus: ((buses?.data ?? []) as { id: string; registration_number: string }[]).map(b => ({ id: b.id, label: b.registration_number })),
    driver: ((drivers?.data ?? []) as { id: string; full_name: string }[]).map(d => ({ id: d.id, label: d.full_name })),
  };
}

const inputClass = 'w-full px-2 py-1.5 text-xs rounded border outline-none';
const inputStyle = { borderColor: '#D1D5DB', background: '#F9FAFB', color: '#111827' };

/**
 * The fields the guichetier entered when recording the operation, as on the guichet's forms:
 * dates and times, lists for the line, bus and driver, phone numbers checked like at the counter.
 */
export default function ChangeRequestEditForm({ fields, snapshot, edited, onChange }: Props) {
  const [choices, setChoices] = useState<Record<'route' | 'bus' | 'driver', Choice[]>>({ route: [], bus: [], driver: [] });

  useEffect(() => {
    const kinds = new Set(fields.map(f => f.kind).filter(k => k === 'route' || k === 'bus' || k === 'driver'));
    if (kinds.size === 0) return;
    let cancelled = false;
    void loadChoices(kinds).then(c => { if (!cancelled) setChoices(c); });
    return () => { cancelled = true; };
  }, [fields]);

  const input = (field: EditField) => {
    const value = edited[field.key];
    switch (field.kind) {
      case 'route':
      case 'bus':
      case 'driver': {
        const list = choices[field.kind];
        const current = String(value ?? '');
        const known = list.some(c => c.id === current);
        return (
          <select
            value={current}
            onChange={e => {
              const choice = list.find(c => c.id === e.target.value);
              onChange({ [field.key]: e.target.value, ...(field.display ? { [field.display]: choice?.label ?? '' } : {}) });
            }}
            className={inputClass}
            style={inputStyle}
          >
            {!known && <option value={current}>{readable(field, edited)}</option>}
            {list.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        );
      }
      case 'expense_type':
        return (
          <select value={String(value ?? '')} onChange={e => onChange({ [field.key]: e.target.value })} className={inputClass} style={inputStyle}>
            {!EXPENSE_TYPES.includes(String(value ?? '')) && <option value={String(value ?? '')}>{String(value ?? '—')}</option>}
            {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        );
      case 'phone':
        return (
          <PhoneInputCI
            value={normalizePhoneCI(String(value ?? ''))}
            onChange={national => onChange({ [field.key]: toStoredPhoneCI(national) })}
            className={inputClass}
            style={inputStyle}
          />
        );
      case 'number':
        return (
          <input
            type="number"
            min={0}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={e => onChange({ [field.key]: e.target.value === '' ? null : Number(e.target.value) })}
            className={inputClass}
            style={inputStyle}
          />
        );
      case 'date':
        return (
          <input type="date" value={String(value ?? '').slice(0, 10)} onChange={e => onChange({ [field.key]: e.target.value })} className={inputClass} style={inputStyle} />
        );
      case 'time':
        return (
          <input type="time" value={String(value ?? '').slice(0, 5)} onChange={e => onChange({ [field.key]: e.target.value })} className={inputClass} style={inputStyle} />
        );
      default:
        return (
          <input type="text" value={String(value ?? '')} onChange={e => onChange({ [field.key]: e.target.value })} className={inputClass} style={inputStyle} />
        );
    }
  };

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#E5E7EB' }}>
      <div className="grid grid-cols-3 divide-x" style={{ borderColor: '#E5E7EB' }}>
        <div className="px-3 py-2 text-xs font-bold uppercase" style={{ background: '#F9FAFB', color: '#6B7280' }}>Champ</div>
        <div className="px-3 py-2 text-xs font-bold uppercase" style={{ background: '#F9FAFB', color: '#6B7280' }}>Saisi par le guichetier</div>
        <div className="px-3 py-2 text-xs font-bold uppercase" style={{ background: '#F9FAFB', color: '#6B7280' }}>Nouvelle valeur</div>
      </div>
      {fields.map(field => (
        <div key={field.key} className="grid grid-cols-3 divide-x border-t items-center" style={{ borderColor: '#E5E7EB' }}>
          <div className="px-3 py-2 text-xs font-medium" style={{ color: '#374151', background: '#F9FAFB' }}>{field.label}</div>
          <div className="px-3 py-2 text-xs" style={{ color: '#6B7280', wordBreak: 'break-word' }}>{readable(field, snapshot)}</div>
          <div className="px-3 py-2">{input(field)}</div>
        </div>
      ))}
    </div>
  );
}
