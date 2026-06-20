interface SeatLegendProps {
  bookableCount: number
  aisleCount: number
}

const LEGEND_ITEMS = [
  {
    label: 'Disponible',
    boxClass: 'bg-white border-slate-300',
    textClass: '',
  },
  {
    label: 'Vendu',
    boxClass: 'bg-red-500 border-red-600',
    textClass: 'text-white',
    icon: '×',
  },
  {
    label: 'Réservé en ligne',
    boxClass: 'bg-[#FCD34D] border-[#D97706]',
    textClass: 'text-[#78350F]',
    icon: '@',
  },
  {
    label: 'VIP',
    boxClass: 'bg-[#FFFBEB] border-[#FCD34D]',
    textClass: 'text-amber-700',
    icon: '★',
  },
  {
    label: 'PMR',
    boxClass: 'bg-[#F0FDF4] border-[#86EFAC]',
    textClass: 'text-green-700',
    icon: '♿',
  },
  {
    label: 'H.S.',
    boxClass: 'bg-[#FFF0F0] border-[#FECACA]',
    textClass: 'text-red-400',
  },
  {
    label: 'Allée',
    boxClass: 'bg-slate-100 border-slate-200',
    textClass: 'text-slate-400',
  },
]

export function SeatLegend({ bookableCount, aisleCount }: SeatLegendProps) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-y-2 px-1">
      <div className="flex items-center gap-4 flex-wrap">
        {LEGEND_ITEMS.map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${item.boxClass}`}>
              {item.icon && <span className={`text-[9px] font-bold ${item.textClass}`}>{item.icon}</span>}
            </div>
            <span className="text-xs text-slate-500">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="text-xs text-slate-500 font-medium">
        Réservables : <span className="text-slate-700 font-bold">{bookableCount}</span>
        {' | '}
        Allées : <span className="text-slate-700 font-bold">{aisleCount}</span>
      </div>
    </div>
  )
}
