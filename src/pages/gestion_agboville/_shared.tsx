import React from 'react'
import { Construction } from 'lucide-react'

interface PlaceholderProps {
  title: string
  subtitle?: string
  icon?: React.ReactNode
}

export function ModulePlaceholder({ title, subtitle, icon }: PlaceholderProps) {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h1>
        {subtitle && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>
        )}
      </div>
      <div
        className="rounded-2xl border p-12 flex flex-col items-center justify-center text-center"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', minHeight: '50vh' }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ backgroundColor: 'var(--primary)', color: '#fff', opacity: 0.15 }}
        >
          {icon ?? <Construction className="w-8 h-8" />}
        </div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Module en préparation
        </h2>
        <p className="text-sm mt-2 max-w-md" style={{ color: 'var(--text-muted)' }}>
          Cet écran sera alimenté dans les lots suivants. Les fondations et référentiels sont en place.
        </p>
      </div>
    </div>
  )
}
