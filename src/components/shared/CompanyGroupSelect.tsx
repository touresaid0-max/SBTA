import type { CompanyWithHierarchy } from '@/utils/companyGroups'

interface Props {
  companies: CompanyWithHierarchy[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  groupLabel?: (group: CompanyWithHierarchy, count: number) => string
  className?: string
  style?: React.CSSProperties
}

export function CompanyGroupSelect({
  companies,
  value,
  onChange,
  placeholder = '— Sélectionner une société —',
  groupLabel = (group, count) => `${group.name} — Groupe (${count} filiale${count > 1 ? 's' : ''})`,
  className,
  style,
}: Props) {
  const groups = companies.filter(c => c.is_group).sort((a, b) => a.name.localeCompare(b.name))
  const groupIds = new Set(groups.map(g => g.id))
  const standalone = companies
    .filter(c => !c.is_group && !c.parent_id && !groupIds.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className} style={style}>
      <option value="">{placeholder}</option>
      {groups.map(g => {
        const subs = companies.filter(c => c.parent_id === g.id).sort((a, b) => a.code.localeCompare(b.code))
        return (
          <optgroup key={g.id} label={groupLabel(g, subs.length)}>
            <option value={g.id}>{groupLabel(g, subs.length)}</option>
            {subs.map(s => (
              <option key={s.id} value={s.id}>↳ {s.name} ({s.code})</option>
            ))}
          </optgroup>
        )
      })}
      {standalone.length > 0 && (
        <optgroup label="Sociétés autonomes">
          {standalone.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
