import { useState, useEffect, useCallback } from 'react'
import { Loader2, Save, Plus, Trash2, RotateCcw, Ticket, Package, Luggage } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getPrintCustomization,
  savePrintCustomization,
  invalidatePrintCustomizationCache,
  type PrintCustomization,
} from '../../services/printCustomization'

type SectionKey = 'bus_ticket_phones' | 'bus_ticket_notes' | 'parcel_notes' | 'baggage_notes'

interface SectionConfig {
  key: SectionKey
  label: string
  icon: React.ReactNode
  description: string
  placeholder: string
}

const SECTIONS: SectionConfig[] = [
  {
    key: 'bus_ticket_phones',
    label: 'Tickets de bus — Téléphones en entête',
    icon: <Ticket className="w-5 h-5" />,
    description: 'Numéros de téléphone affichés en entête des tickets de bus.',
    placeholder: 'Tel : 01 14 34 60 / 01 14 34 87',
  },
  {
    key: 'bus_ticket_notes',
    label: 'Tickets de bus — Textes personnalisés',
    icon: <Ticket className="w-5 h-5" />,
    description: 'Textes affichés sur le ticket de bus (notes, mentions légales, etc.).',
    placeholder: "NB : Tout ticket encaissé n'est plus remboursable.",
  },
  {
    key: 'parcel_notes',
    label: 'Reçu courrier — Textes personnalisés',
    icon: <Package className="w-5 h-5" />,
    description: 'Textes affichés sur le reçu courrier (mentions légales, conditions, etc.).',
    placeholder: "AUCUN REMBOURSEMENT N'EST POSSIBLE APRES ENCAISSEMENT.",
  },
  {
    key: 'baggage_notes',
    label: 'Reçu bagage — Textes personnalisés',
    icon: <Luggage className="w-5 h-5" />,
    description: 'Textes affichés sur le reçu bagage (mentions légales, conditions, etc.).',
    placeholder: "AUCUN REMBOURSEMENT N'EST POSSIBLE APRES ENCAISSEMENT.",
  },
]

const GROUPED_SECTIONS = [
  {
    title: 'Tickets de bus',
    icon: <Ticket className="w-6 h-6" />,
    sections: SECTIONS.filter(s => s.key.startsWith('bus_ticket')),
  },
  {
    title: 'Reçu courrier',
    icon: <Package className="w-6 h-6" />,
    sections: SECTIONS.filter(s => s.key === 'parcel_notes'),
  },
  {
    title: 'Reçu bagage',
    icon: <Luggage className="w-6 h-6" />,
    sections: SECTIONS.filter(s => s.key === 'baggage_notes'),
  },
]

export default function PrintCustomizationPage() {
  const [data, setData] = useState<PrintCustomization | null>(null)
  const [original, setOriginal] = useState<PrintCustomization | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await getPrintCustomization()
      setData(d)
      setOriginal(d)
    } catch {
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const hasChanges = data !== null && original !== null && (
    JSON.stringify(data.bus_ticket_phones) !== JSON.stringify(original.bus_ticket_phones) ||
    JSON.stringify(data.bus_ticket_notes) !== JSON.stringify(original.bus_ticket_notes) ||
    JSON.stringify(data.parcel_notes) !== JSON.stringify(original.parcel_notes) ||
    JSON.stringify(data.baggage_notes) !== JSON.stringify(original.baggage_notes)
  )

  const updateLine = (section: SectionKey, index: number, value: string) => {
    if (!data) return
    setData(prev => {
      if (!prev) return prev
      const arr = [...prev[section]]
      arr[index] = value
      return { ...prev, [section]: arr }
    })
  }

  const addLine = (section: SectionKey) => {
    if (!data) return
    setData(prev => prev ? { ...prev, [section]: [...prev[section], ''] } : prev)
  }

  const removeLine = (section: SectionKey, index: number) => {
    if (!data) return
    setData(prev => {
      if (!prev) return prev
      const arr = [...prev[section]]
      arr.splice(index, 1)
      return { ...prev, [section]: arr }
    })
  }

  const reset = () => {
    if (original) setData(original)
  }

  const save = async () => {
    if (!data) return
    setSaving(true)
    try {
      const cleaned: Partial<PrintCustomization> = {
        bus_ticket_phones: data.bus_ticket_phones.map(s => s.trim()).filter(Boolean),
        bus_ticket_notes: data.bus_ticket_notes.map(s => s.trim()).filter(Boolean),
        parcel_notes: data.parcel_notes.map(s => s.trim()).filter(Boolean),
        baggage_notes: data.baggage_notes.map(s => s.trim()).filter(Boolean),
      }
      const saved = await savePrintCustomization(cleaned)
      setData(saved)
      setOriginal(saved)
      invalidatePrintCustomizationCache()
      toast.success('Personnalisation enregistrée avec succès')
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Personnalisation
          </h1>
          <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
            Personnalisez les textes affichés sur les tickets de bus, reçus courrier et reçus bagage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={reset}
              className="px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              <RotateCcw className="w-4 h-4" />
              Annuler
            </button>
          )}
          <button
            onClick={save}
            disabled={!hasChanges || saving}
            className="px-4 py-2 rounded-lg flex items-center gap-2 font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-5 h-5" />}
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {GROUPED_SECTIONS.map(group => (
        <div key={group.title} className="rounded-xl p-6" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
              {group.icon}
            </div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {group.title}
            </h2>
          </div>

          <div className="space-y-6">
            {group.sections.map(section => (
              <div key={section.key}>
                <div className="mb-2">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {section.label}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {section.description}
                  </p>
                </div>

                <div className="space-y-2">
                  {data && data[section.key].length === 0 && (
                    <p className="text-xs italic py-2" style={{ color: 'var(--text-muted)' }}>
                      Aucun texte configuré. Cliquez sur « Ajouter » pour en ajouter un.
                    </p>
                  )}
                  {data && data[section.key].map((line, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-xs font-mono w-6 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {index + 1}.
                      </span>
                      <input
                        type="text"
                        value={line}
                        onChange={e => updateLine(section.key, index, e.target.value)}
                        placeholder={section.placeholder}
                        className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                          backgroundColor: 'var(--surface-raised)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                        }}
                      />
                      <button
                        onClick={() => removeLine(section.key, index)}
                        className="p-2 rounded-lg flex-shrink-0 hover:bg-red-50 transition-colors"
                        style={{ color: 'var(--error)' }}
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addLine(section.key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    style={{ color: 'var(--primary)' }}
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter un texte
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--info-light)' }}>
        <p className="text-sm" style={{ color: 'var(--info)' }}>
          <strong>Note :</strong> Les modifications sont automatiquement prises en compte lors de la prochaine impression d'un ticket ou reçu.
          Les textes vides sont automatiquement supprimés lors de l'enregistrement.
        </p>
      </div>
    </div>
  )
}
