import type { CompanyWithHierarchy } from '@/utils/companyGroups'

interface Props {
  companies: CompanyWithHierarchy[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  groupLabel?: string
  className?: string
  style?: React.CSSProperties
}

export function CompanyGroupSelect({
  companies,
  value,
  onChange,
  placeholder = 'Toutes les sociétés',
  groupLabel = (g) => `${g.name} (groupe + sous-groupes)`,
  className,
  style,
}: Props) {
  const groups = companies.filter(c => c.is_group)
  const groupIds = new Set(groups.map(g => g.id))
  const standalone = companies.filter(c => !c.is_group && !c.parent_id && !groupIds.has(c.id))

  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className} style={style}>
      <option value="">{placeholder}</option>
      {groups.map(g => {
        const subs = companies.filter(c => c.parent_id === g.id).sort((a, b) => a.code.localeCompare(b.code))
        return (
          <optgroup key={g.id} label={g.name}>
            <option value={g.id}>{groupLabel(g)}</option>
            {subs.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </optgroup>
        )
      })}
      {standalone.map(c => (
        <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
      ))}
    </select>
  )
}
