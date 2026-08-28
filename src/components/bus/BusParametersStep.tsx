import React from 'react'

export type DriverPosition = 'gauche' | 'droite'
export type DeckType = 'simple' | 'imperial'
export type SleepingType = 'aucun' | 'couchettes' | 'mixte'

export interface BusParameters {
  driverPosition: DriverPosition
  deckType: DeckType
  sleepingType: SleepingType
  totalSeats: number
  maxCapacity: number
  seatsSoldFrom: number
}

export interface DeckParameters {
  rows: number
  cols: number
  aisleAfterCol: number
  hasBackRow: boolean
  backRowSeats: number
}

export const defaultDeckParameters = (): DeckParameters => ({
  rows: 10,
  cols: 4,
  aisleAfterCol: 2,
  hasBackRow: true,
  backRowSeats: 5,
})

interface RadioCardProps {
  value: string
  selected: boolean
  onClick: () => void
  label: string
  description: string
  icon: string
}

function RadioCard({ selected, onClick, label, description, icon }: RadioCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1.5 p-4 rounded-xl border-2 text-left transition-all ${
        selected
          ? 'border-[#0B7439] bg-[#F0FBF4]'
          : 'border-[#E2EAE5] bg-white hover:border-[#0B7439]/40'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <span className={`font-semibold text-sm ${selected ? 'text-[#0B7439]' : 'text-[#1A2E22]'}`}>
          {label}
        </span>
        {selected && (
          <span className="ml-auto w-4 h-4 rounded-full bg-[#0B7439] flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
      </div>
      <p className="text-xs text-[#4A6B55]">{description}</p>
    </button>
  )
}

const LAYOUT_PRESETS = [
  { label: '2+2 standard', cols: 4, aisleAfterCol: 2 },
  { label: '2+1 VIP', cols: 3, aisleAfterCol: 2 },
  { label: '1+1 executive', cols: 2, aisleAfterCol: 1 },
  { label: '2+3 capacité', cols: 6, aisleAfterCol: 2 },
]

interface BusParametersStepProps {
  params: BusParameters
  onChange: (params: BusParameters) => void
  deckParams: DeckParameters
  onDeckParamsChange: (p: DeckParameters) => void
}

export default function BusParametersStep({ params, onChange, deckParams, onDeckParamsChange }: BusParametersStepProps) {
  const updateParams = (partial: Partial<BusParameters>) => onChange({ ...params, ...partial })
  const updateDeck = (partial: Partial<DeckParameters>) => onDeckParamsChange({ ...deckParams, ...partial })

  const estimatedSeats = React.useMemo(() => {
    const seatCols = deckParams.cols - (deckParams.aisleAfterCol > 0 ? 1 : 0)
    return seatCols * deckParams.rows + (deckParams.hasBackRow ? deckParams.backRowSeats : 0)
  }, [deckParams])

  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="text-base font-bold text-[#1A2E22] mb-3">Position du conducteur</legend>
        <div className="grid grid-cols-2 gap-3">
          <RadioCard
            value="gauche"
            selected={params.driverPosition === 'gauche'}
            onClick={() => updateParams({ driverPosition: 'gauche' })}
            icon="🚌"
            label="Côté gauche"
            description="Standard (France, Côte d'Ivoire...)"
          />
          <RadioCard
            value="droite"
            selected={params.driverPosition === 'droite'}
            onClick={() => updateParams({ driverPosition: 'droite' })}
            icon="🚌"
            label="Côté droit"
            description="Conduite à gauche (UK, Inde...)"
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-base font-bold text-[#1A2E22] mb-3">Type de bus</legend>
        <div className="grid grid-cols-2 gap-3">
          <RadioCard
            value="simple"
            selected={params.deckType === 'simple'}
            onClick={() => updateParams({ deckType: 'simple' })}
            icon="🚌"
            label="Simple étage"
            description="Bus standard — un seul niveau"
          />
          <RadioCard
            value="imperial"
            selected={params.deckType === 'imperial'}
            onClick={() => updateParams({ deckType: 'imperial' })}
            icon="🚎"
            label="Bus impérial"
            description="Double étage — deux niveaux"
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-base font-bold text-[#1A2E22] mb-3">Type de couchage</legend>
        <div className="grid grid-cols-3 gap-3">
          <RadioCard
            value="aucun"
            selected={params.sleepingType === 'aucun'}
            onClick={() => updateParams({ sleepingType: 'aucun' })}
            icon="💺"
            label="Non"
            description="Sièges uniquement"
          />
          <RadioCard
            value="couchettes"
            selected={params.sleepingType === 'couchettes'}
            onClick={() => updateParams({ sleepingType: 'couchettes' })}
            icon="🛏️"
            label="Couchettes"
            description="Bus sleeping"
          />
          <RadioCard
            value="mixte"
            selected={params.sleepingType === 'mixte'}
            onClick={() => updateParams({ sleepingType: 'mixte' })}
            icon="💺"
            label="Mixte"
            description="Sièges + couchettes"
          />
        </div>
      </fieldset>

      <div>
        <legend className="text-base font-bold text-[#1A2E22] mb-3">Disposition des sièges</legend>

        <div className="flex flex-wrap gap-2 mb-4">
          {LAYOUT_PRESETS.map(preset => (
            <button
              key={preset.label}
              type="button"
              onClick={() => updateDeck({ cols: preset.cols, aisleAfterCol: preset.aisleAfterCol })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors ${
                deckParams.cols === preset.cols && deckParams.aisleAfterCol === preset.aisleAfterCol
                  ? 'bg-[#0B7439] border-[#0B7439] text-white'
                  : 'bg-white border-[#E2EAE5] text-[#4A6B55] hover:border-[#0B7439]'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Nombre de rangées *</label>
            <input
              type="number"
              min={1}
              max={30}
              value={deckParams.rows}
              onChange={e => updateDeck({ rows: Math.max(1, +e.target.value) })}
              className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl focus:outline-none focus:border-[#0B7439] transition-colors"
            />
            <p className="mt-1 text-xs text-[#4A6B55]">Rangées normales (hors rangée du fond)</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Nombre de colonnes *</label>
            <input
              type="number"
              min={2}
              max={8}
              value={deckParams.cols}
              onChange={e => updateDeck({ cols: Math.max(2, +e.target.value) })}
              className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl focus:outline-none focus:border-[#0B7439] transition-colors"
            />
            <p className="mt-1 text-xs text-[#4A6B55]">Total colonnes (hors allée)</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Allée après colonne n°</label>
            <input
              type="number"
              min={0}
              max={deckParams.cols - 1}
              value={deckParams.aisleAfterCol}
              onChange={e => updateDeck({ aisleAfterCol: Math.min(deckParams.cols - 1, Math.max(0, +e.target.value)) })}
              className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl focus:outline-none focus:border-[#0B7439] transition-colors"
            />
            <p className="mt-1 text-xs text-[#4A6B55]">0 = pas d'allée centrale</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Capacité maximale *</label>
            <input
              type="number"
              min={1}
              max={200}
              value={params.maxCapacity}
              onChange={e => updateParams({ maxCapacity: Math.max(1, +e.target.value) })}
              className="w-full px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl focus:outline-none focus:border-[#0B7439] transition-colors"
            />
            <p className="mt-1 text-xs text-[#4A6B55]">Peut être inférieure au total (normes sécurité)</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <input
            type="checkbox"
            id="hasBackRow"
            checked={deckParams.hasBackRow}
            onChange={e => updateDeck({ hasBackRow: e.target.checked })}
            className="w-4 h-4 accent-[#0B7439]"
          />
          <label htmlFor="hasBackRow" className="text-sm font-medium text-[#1A2E22]">
            Rangée du fond (banquette arrière)
          </label>
          {deckParams.hasBackRow && (
            <>
              <input
                type="number"
                min={1}
                max={8}
                value={deckParams.backRowSeats}
                onChange={e => updateDeck({ backRowSeats: +e.target.value })}
                className="w-16 px-2 py-1.5 border-2 border-[#E2EAE5] rounded-lg text-center text-sm focus:outline-none focus:border-[#0B7439]"
              />
              <span className="text-xs text-[#4A6B55]">sièges</span>
            </>
          )}
        </div>

        <div className="mt-4">
          <label className="block text-sm font-semibold text-[#1A2E22] mb-1.5">Siège vendu à partir de</label>
          <input
            type="number"
            min={1}
            max={200}
            value={params.seatsSoldFrom}
            onChange={e => updateParams({ seatsSoldFrom: Math.max(1, +e.target.value) })}
            className="w-32 px-4 py-2.5 border-2 border-[#E2EAE5] rounded-xl focus:outline-none focus:border-[#0B7439] transition-colors"
          />
          <p className="mt-1 text-xs text-[#4A6B55]">Numéro de siège à partir duquel la vente est autorisée au Guichet POS. Cette valeur est transmise automatiquement au Guichet et ne peut pas être modifiée par le Guichetier.</p>
        </div>
      </div>

      <div className="p-4 bg-[#F0FBF4] border border-[#C8E8D4] rounded-xl">
        <p className="text-sm font-semibold text-[#0B7439] mb-2">Estimation</p>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-[#4A6B55]">Disposition :</span>
            <span className="ml-1 font-bold text-[#1A2E22]">
              {deckParams.aisleAfterCol > 0
                ? `${deckParams.aisleAfterCol}+${deckParams.cols - deckParams.aisleAfterCol}`
                : `${deckParams.cols} col.`}
            </span>
          </div>
          <div>
            <span className="text-[#4A6B55]">Rangées :</span>
            <span className="ml-1 font-bold text-[#1A2E22]">
              {deckParams.rows}{deckParams.hasBackRow ? ` + fond` : ''}
            </span>
          </div>
          <div>
            <span className="text-[#4A6B55]">Sièges :</span>
            <span className="ml-1 font-bold text-[#0B7439]">~{estimatedSeats}</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-[#4A6B55]">
          Le plan sera généré automatiquement à l'étape suivante. Vous pourrez personnaliser chaque siège.
        </p>
      </div>
    </div>
  )
}
