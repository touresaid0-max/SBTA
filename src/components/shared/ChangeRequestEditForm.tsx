import { useEffect, useState } from 'react';
import { supabase } from '@/services/supabase';
import PhoneInputCI from '@/components/shared/PhoneInputCI';
import AutocompleteSelect, { type AutocompleteOption } from '@/components/pos/AutocompleteSelect';
import { EXPENSE_TYPES, readableValue as readable, type EditField } from '@/services/changeRequestForms';
import { normalizePhoneCI, toStoredPhoneCI } from '@/utils/phoneCI';


interface Props {
  fields: EditField[];
  snapshot: Record<string, unknown>;
  edited: Record<string, unknown>;
  /** Sets one or more values of the copy (a choice also sets its readable value) */
  onChange: (values: Record<string, unknown>) => void;
}

type Choices = Record<'route' | 'bus' | 'driver', AutocompleteOption[]>;

/**
 * Lines, buses and drivers to choose from, searchable like on the guichet's Nouveau départ
 * (registration, make and model of a bus; name, staff number and phone of a driver).
 */
async function loadChoices(kinds: Set<string>): Promise<Choices> {
  const [routes, buses, drivers] = await Promise.all([
    kinds.has('route') ? supabase.from('routes').select('id, name').eq('is_active', true).order('name') : null,
    kinds.has('bus') ? supabase.from('buses').select('id, registration_number, brand, model, capacity').is('archived_at', null).order('registration_number') : null,
    kinds.has('driver') ? supabase.from('users').select('id, full_name, employee_id, phone').eq('role', 'chauffeur').eq('status', 'active').order('full_name') : null,
  ]);
  type Bus = { id: string; registration_number: string; brand?: string | null; model?: string | null; capacity?: number | null };
  type Driver = { id: string; full_name: string; employee_id?: string | null; phone?: string | null };
  return {
    route: ((routes?.data ?? []) as { id: string; name: string }[]).map(r => ({ id: r.id, label: r.name })),
    bus: ((buses?.data ?? []) as Bus[]).map(b => ({
      id: b.id,
      label: b.registration_number,
      sublabel: [b.brand, b.model, b.capacity ? `${b.capacity} places` : null].filter(Boolean).join(' · ') || undefined,
      keywords: `${b.registration_number} ${b.brand ?? ''} ${b.model ?? ''}`,
    })),
    driver: ((drivers?.data ?? []) as Driver[]).map(d => ({
      id: d.id,
      label: d.full_name,
      sublabel: [d.employee_id, d.phone].filter(Boolean).join(' · ') || undefined,
      keywords: `${d.full_name} ${d.employee_id ?? ''} ${d.phone ?? ''}`,
    })),
  };
}

const SEARCH_PLACEHOLDER: Record<'route' | 'bus' | 'driver', string> = {
  route: 'Rechercher une ligne…',
  bus: 'Rechercher par immatriculation, marque, modèle…',
  driver: 'Rechercher par nom, matricule, téléphone…',
};

const inputClass = 'w-full px-2 py-1.5 text-xs rounded border outline-none';
const inputStyle = { borderColor: '#D1D5DB', background: '#F9FAFB', color: '#111827' };

/**
 * The fields the guichetier entered when recording the operation, as on the guichet's forms:
 * dates and times, lists for the line, bus and driver, phone numbers checked like at the counter.
 */
export default function ChangeRequestEditForm({ fields, snapshot, edited, onChange }: Props) {
  const [choices, setChoices] = useState<Choices>({ route: [], bus: [], driver: [] });

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
        const kind = field.kind;
        const current = String(value ?? '');
        // The current one stays shown even when it is no longer in the list (archived bus…)
        const list = current && !choices[kind].some(c => c.id === current)
          ? [{ id: current, label: readable(field, edited) }, ...choices[kind]]
          : choices[kind];
        return (
          <AutocompleteSelect
            compact
            options={list}
            value={current}
            allowClear={false}
            placeholder={SEARCH_PLACEHOLDER[kind]}
            emptyText="Aucun résultat"
            onChange={id => {
              const choice = list.find(c => c.id === id);
              onChange({ [field.key]: id, ...(field.display ? { [field.display]: choice?.label ?? '' } : {}) });
            }}
          />
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
    <div className="rounded-lg border" style={{ borderColor: '#E5E7EB' }}>
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
