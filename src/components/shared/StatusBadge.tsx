import type { BusStatus, ReservationStatus, ScheduleStatus } from '../../types';

interface StatusBadgeProps {
  status: BusStatus | ReservationStatus | ScheduleStatus | string;
  type?: 'bus' | 'reservation' | 'schedule' | 'default';
}

const STATUS_STYLES: Record<string, { color: string; label: string; bg?: string }> = {
  active:               { color: '#0B7439', label: 'Actif' },
  inactive:             { color: '#6B7280', label: 'Inactif' },
  suspended:            { color: '#AF3029', label: 'Suspendu' },
  repos_obligatoire:    { color: '#D97706', label: 'En repos' },
  pending_confirmation: { color: '#1D6FA4', label: 'En attente' },
  pending_deletion:     { color: '#92400E', label: 'Suppression demandée' },

  disponible:       { color: '#0B7439', label: 'Disponible' },
  en_service:       { color: '#1D6FA4', label: 'En service' },
  panne_route:      { color: '#AF3029', label: 'Panne route' },
  reception_garage: { color: '#D97706', label: 'Réception garage' },
  diagnostic:       { color: '#D97706', label: 'Diagnostic' },
  attente_ot:       { color: '#92400E', label: 'Attente OT' },
  maintenance:      { color: '#1D6FA4', label: 'Maintenance' },
  controle_qualite: { color: '#7C3AED', label: 'Contrôle qualité' },
  hors_service:     { color: '#6B7280', label: 'Hors service' },

  en_attente:  { color: '#D97706', label: 'En attente' },
  confirmee:   { color: '#0B7439', label: 'Confirmée' },
  annulee:     { color: '#AF3029', label: 'Annulée' },
  terminee:    { color: '#6B7280', label: 'Terminée' },

  planifie: { color: '#1D6FA4', label: 'Planifié' },
  en_cours:  { color: '#D97706', label: 'En cours' },
  termine:   { color: '#0B7439', label: 'Terminé' },
  annule:    { color: '#AF3029', label: 'Annulé' },

  payee:     { color: '#0B7439', label: 'Payée' },
  remboursee:{ color: '#1D6FA4', label: 'Remboursée' },

  genere:           { color: '#1D6FA4', label: 'Généré' },
  valide_comptable: { color: '#0B7439', label: 'Validé' },
  utilise:          { color: '#6B7280', label: 'Utilisé' },

  validee: { color: '#0B7439', label: 'Validée' },
  rejetee: { color: '#AF3029', label: 'Rejetée' },

  valide: { color: '#0B7439', label: 'Validé' },
  refuse: { color: '#AF3029', label: 'Refusé' },
};

function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function StatusBadge({ status, type = 'default' }: StatusBadgeProps) {
  const config = STATUS_STYLES[status];

  if (!config) {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
        {status}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium"
      style={{
        color: config.color,
        backgroundColor: config.bg ?? hexToRgba(config.color, 0.12),
      }}
    >
      {config.label}
    </span>
  );
}

export { STATUS_STYLES };
