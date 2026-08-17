import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, DollarSign, Fuel, Wrench, Clock, Package, Bus, Award, Users, TrendingUp, PackagePlus, UserCheck, PackageCheck } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: any;
  path: string;
  color: string;
}

const reports: ReportCard[] = [
  {
    id: 'sales',
    title: 'Rapport Ventes',
    description: 'Billets vendus, revenus, taux occupation par route/bus/classe',
    icon: DollarSign,
    path: '/reports/sales',
    color: '#0B7439'
  },
  {
    id: 'financial',
    title: 'Rapport Financier Consolidé',
    description: 'Vue globale revenus/charges/bénéfice par société',
    icon: TrendingUp,
    path: '/reports/financial',
    color: '#2563eb'
  },
  {
    id: 'fuel',
    title: 'Rapport Ravitaillement',
    description: 'Carburant consommé, coûts, anomalies détectées',
    icon: Fuel,
    path: '/reports/fuel',
    color: '#dc2626'
  },
  {
    id: 'maintenance',
    title: 'Rapport Maintenance',
    description: 'Interventions, coûts, immobilisations, pannes fréquentes',
    icon: Wrench,
    path: '/reports/maintenance',
    color: '#f59e0b'
  },
  {
    id: 'driver-hours',
    title: 'Rapport Heures Chauffeurs',
    description: 'Suivi temps de travail, alertes dépassements réglementaires',
    icon: Clock,
    path: '/reports/driver-hours',
    color: '#8b5cf6'
  },
  {
    id: 'stock',
    title: 'Rapport Stock Pièces',
    description: 'Valeur stock, ruptures, consommations, mouvements',
    icon: Package,
    path: '/reports/stock',
    color: '#ec4899'
  },
  {
    id: 'bus-activity',
    title: 'Rapport Activité Bus',
    description: 'Km parcourus, voyages, occupation, consommation par bus',
    icon: Bus,
    path: '/reports/bus-activity',
    color: '#14b8a6'
  },
  {
    id: 'driver-performance',
    title: 'Rapport Performance Chauffeurs',
    description: 'Évaluations, notes moyennes, incidents, ponctualité',
    icon: Award,
    path: '/reports/driver-performance',
    color: '#f97316'
  },
  {
    id: 'loyalty',
    title: 'Rapport Fidélité Client',
    description: 'Membres, points, échanges, coût programme, engagement',
    icon: Users,
    path: '/reports/loyalty',
    color: '#6366f1'
  }
];

const DAF_REPORTS: ReportCard[] = [
  {
    id: 'garage-reports',
    title: 'Rapports Pièces',
    description: 'Sorties de pièces de rechange par groupe : pièces sorties, pneus Michelin / Long-March, nouvelles commandes',
    icon: PackageCheck,
    path: '/daf/garage-reports',
    color: '#16a34a'
  },
  {
    id: 'parcel-report',
    title: 'Rapport Courrier',
    description: 'Activité courrier par agence : enregistrés, expédiés, arrivés, retirés et CA par période',
    icon: PackagePlus,
    path: '/daf/parcel-report',
    color: '#0891b2'
  },
  {
    id: 'rh-reports',
    title: 'Rapports RH',
    description: 'Exports et analyses — données en temps réel : masse salariale, effectifs, chauffeurs, permis expirants',
    icon: UserCheck,
    path: '/rh/reports',
    color: '#0B7439'
  }
];

function ReportCardItem({ report, onClick }: { report: ReportCard; onClick: () => void }) {
  const Icon = report.icon;
  return (
    <div
      onClick={onClick}
      className="rounded-xl border p-6 cursor-pointer transition-all hover:shadow-xl hover:scale-105"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div
        className="w-16 h-16 rounded-xl flex items-center justify-center mb-4"
        style={{ backgroundColor: `${report.color}15` }}
      >
        <Icon className="w-8 h-8" style={{ color: report.color }} />
      </div>
      <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{report.title}</h3>
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        {report.description}
      </p>
      <button
        className="px-4 py-2 rounded-lg font-semibold text-sm"
        style={{ backgroundColor: report.color, color: 'white' }}
      >
        Consulter →
      </button>
    </div>
  );
}

export default function Reports() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isDaf = user?.role === 'daf';

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
          <BarChart3 className="w-8 h-8" style={{ color: 'var(--primary)' }} />
          Rapports & Analyses
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Tableaux de bord et rapports détaillés pour le pilotage de l'activité
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reports
          .filter(r => !isDaf || !['maintenance', 'driver-hours', 'stock', 'sales', 'financial', 'fuel', 'bus-activity', 'driver-performance', 'loyalty'].includes(r.id))
          .map((report) => (
            <ReportCardItem key={report.id} report={report} onClick={() => navigate(report.path)} />
          ))}
        {isDaf && DAF_REPORTS.map((report) => (
          <ReportCardItem key={report.id} report={report} onClick={() => navigate(report.path)} />
        ))}
      </div>
    </div>
  );
}
