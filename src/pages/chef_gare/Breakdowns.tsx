import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AlertTriangle, MapPin, Calendar, ChevronDown, ChevronUp,
  Bus, CheckCircle, Image, Clock, ArrowRight, RefreshCw
} from 'lucide-react';

interface BreakdownReport {
  id: string;
  title: string | null;
  breakdown_type: string;
  severity: string;
  description: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  reported_at: string;
  received_at: string | null;
  photo_urls: string[] | null;
  photos_urls: string[] | null;
  bus: { registration_number: string; manufacturer: string | null; model: string | null } | null;
  driver: { full_name: string | null } | null;
  reporter: { full_name: string | null } | null;
}

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  faible:   { label: 'Faible',   color: '#2563EB', bg: '#EFF6FF' },
  moyenne:  { label: 'Moyenne',  color: '#D97706', bg: '#FEF3C7' },
  critique: { label: 'Critique', color: '#DC2626', bg: '#FEF2F2' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  signale:       { label: 'Signalé',         color: '#DC2626', bg: '#FEF2F2', dot: '#DC2626' },
  recu_garage:   { label: 'Reçu au garage',  color: '#D97706', bg: '#FEF3C7', dot: '#D97706' },
  en_diagnostic: { label: 'En diagnostic',   color: '#2563EB', bg: '#EFF6FF', dot: '#2563EB' },
  resolu:        { label: 'Résolu',          color: '#059669', bg: '#ECFDF5', dot: '#059669' },
};

const TYPE_LABELS: Record<string, string> = {
  mecanique:   'Mécanique',
  electrique:  'Électrique',
  pneumatique: 'Pneumatique',
  carrosserie: 'Carrosserie',
  autres:      'Autre',
};

const STATUS_ORDER = ['signale', 'recu_garage', 'en_diagnostic', 'resolu'];

type FilterStatus = 'all' | 'signale' | 'recu_garage' | 'en_diagnostic' | 'resolu';

export default function ChefGareBreakdowns() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<BreakdownReport[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [receiving, setReceiving] = useState<string | null>(null);
  // The list could not be read (audit B4): an error, never « Aucun signalement »
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (user?.id) loadReports();
  }, [user]);

  const loadReports = async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const columns = (withReceivedAt: boolean) => `
          id, title, breakdown_type, severity, description,
          location, latitude, longitude, status, reported_at,
          ${withReceivedAt ? 'received_at, ' : ''}photo_urls, photos_urls,
          bus:bus_id (registration_number, manufacturer, model),
          driver:driver_id (full_name),
          reporter:reported_by (full_name)
        `;
      let { data, error } = await supabase
        .from('breakdown_reports')
        .select(columns(true))
        .order('reported_at', { ascending: false });
      // A database without the received_at column (migration 20261126150000 not run): the list
      // all the same, without the time of reception
      if (error && /received_at/.test(error.message ?? '')) {
        ({ data, error } = await supabase
          .from('breakdown_reports')
          .select(columns(false))
          .order('reported_at', { ascending: false }));
      }

      if (error) throw error;
      setReports((data as unknown as BreakdownReport[]) || []);
    } catch (err: any) {
      console.error(err);
      setReports([]);
      setLoadError(true);
      toast.error('Erreur lors du chargement des pannes');
    } finally {
      setLoading(false);
    }
  };

  const handleReceive = async (report: BreakdownReport) => {
    if (report.status !== 'signale') return;
    try {
      setReceiving(report.id);
      // Server function (the chef de gare may not modify a breakdown otherwise): only a
      // « signalée » breakdown of his station, with the time of reception
      const { data: receivedAt, error } = await supabase.rpc('mark_breakdown_received', { p_id: report.id });

      if (error) throw error;
      toast.success('Panne marquée comme reçue');
      setReports(prev =>
        prev.map(r =>
          r.id === report.id
            ? { ...r, status: 'recu_garage', received_at: (receivedAt as string | null) ?? new Date().toISOString() }
            : r
        )
      );
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ? `Réception impossible : ${err.message}` : 'Erreur lors de la mise à jour');
    } finally {
      setReceiving(null);
    }
  };

  const getPhotos = (report: BreakdownReport): string[] => {
    if (report.photo_urls && report.photo_urls.length > 0) return report.photo_urls;
    if (report.photos_urls && report.photos_urls.length > 0) return report.photos_urls;
    return [];
  };

  const filtered = filter === 'all' ? reports : reports.filter(r => r.status === filter);

  const counts = {
    all:           reports.length,
    signale:       reports.filter(r => r.status === 'signale').length,
    recu_garage:   reports.filter(r => r.status === 'recu_garage').length,
    en_diagnostic: reports.filter(r => r.status === 'en_diagnostic').length,
    resolu:        reports.filter(r => r.status === 'resolu').length,
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-10 h-10 border-4 rounded-full animate-spin"
             style={{ borderColor: '#DC2626', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Signalements de pannes
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Pannes signalées par les chauffeurs
            </p>
          </div>
          <button
            onClick={loadReports}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className="w-4 h-4" />
            Actualiser
          </button>
        </div>

        {/* Alert for new signalements */}
        {counts.signale > 0 && (
          <div className="rounded-2xl p-4 mb-5 flex items-center gap-3"
               style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                 style={{ backgroundColor: '#FEE2E2' }}>
              <AlertTriangle className="w-5 h-5" style={{ color: '#DC2626' }} />
            </div>
            <div>
              <p className="font-semibold text-sm" style={{ color: '#991B1B' }}>
                {counts.signale} nouvelle{counts.signale > 1 ? 's' : ''} panne{counts.signale > 1 ? 's' : ''} à réceptionner
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#B91C1C' }}>
                Confirmez la réception pour chaque panne signalée
              </p>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap mb-5">
          {([
            { key: 'all',           label: 'Toutes' },
            { key: 'signale',       label: 'Signalées' },
            { key: 'recu_garage',   label: 'Reçues' },
            { key: 'en_diagnostic', label: 'En diagnostic' },
            { key: 'resolu',        label: 'Résolues' },
          ] as { key: FilterStatus; label: string }[]).map(tab => {
            const count = counts[tab.key];
            const isActive = filter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: isActive ? 'var(--text-primary)' : 'var(--surface)',
                  color: isActive ? 'white' : 'var(--text-secondary)',
                  border: isActive ? 'none' : '1px solid var(--border)',
                }}
              >
                {tab.label}
                {count > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                        style={{
                          backgroundColor: isActive
                            ? 'rgba(255,255,255,0.2)'
                            : tab.key === 'signale' ? '#FEE2E2' : 'var(--surface-raised)',
                          color: isActive
                            ? 'white'
                            : tab.key === 'signale' ? '#DC2626' : 'var(--text-secondary)',
                        }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {loadError && (
          <div className="rounded-2xl border p-12 text-center"
               style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
            <AlertTriangle className="w-12 h-12 mx-auto mb-3" style={{ color: '#DC2626' }} />
            <p className="font-semibold" style={{ color: '#991B1B' }}>Pannes indisponibles</p>
            <p className="text-sm mt-1" style={{ color: '#B91C1C' }}>
              La liste n'a pas pu être chargée : ce n'est pas qu'il n'y a aucune panne.
            </p>
            <button onClick={loadReports}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: '#DC2626' }}>
              <RefreshCw className="w-4 h-4" /> Réessayer
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loadError && filtered.length === 0 && (
          <div className="rounded-2xl border p-12 text-center"
               style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Aucun signalement</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {filter === 'all'
                ? 'Aucune panne signalée pour le moment.'
                : `Aucun signalement avec le statut "${STATUS_CONFIG[filter]?.label}".`}
            </p>
          </div>
        )}

        {/* List */}
        <div className="space-y-3">
          {filtered.map((report) => {
            const severity = SEVERITY_CONFIG[report.severity] || { label: report.severity, color: '#6B7280', bg: '#F9FAFB' };
            const status = STATUS_CONFIG[report.status] || { label: report.status, color: '#6B7280', bg: '#F9FAFB', dot: '#6B7280' };
            const isExpanded = expandedId === report.id;
            const driverName = report.driver?.full_name || report.reporter?.full_name || null;
            const canReceive = report.status === 'signale';
            const photos = getPhotos(report);

            return (
              <div
                key={report.id}
                className="rounded-2xl border overflow-hidden transition-shadow hover:shadow-sm"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: canReceive ? '#FECACA' : 'var(--border)',
                }}
              >
                {/* Card header */}
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                         style={{ backgroundColor: severity.bg }}>
                      <AlertTriangle className="w-5 h-5" style={{ color: severity.color }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                          {report.title || TYPE_LABELS[report.breakdown_type] || report.breakdown_type}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                              style={{ backgroundColor: severity.bg, color: severity.color }}>
                          {severity.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1.5 text-xs font-medium"
                              style={{ color: status.color }}>
                          <span className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: status.dot }} />
                          {status.label}
                        </span>

                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>•</span>

                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <Calendar className="w-3 h-3" />
                          {format(new Date(report.reported_at), 'dd MMM yyyy, HH:mm', { locale: fr })}
                        </span>

                        {report.bus && (
                          <>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>•</span>
                            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                              <Bus className="w-3 h-3" />
                              {report.bus.registration_number}
                            </span>
                          </>
                        )}

                        {driverName && (
                          <>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>•</span>
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {driverName}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canReceive && (
                        <button
                          onClick={() => handleReceive(report)}
                          disabled={receiving === report.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity disabled:opacity-60"
                          style={{ backgroundColor: '#059669' }}
                        >
                          {receiving === report.id ? (
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <CheckCircle className="w-3.5 h-3.5" />
                          )}
                          Réceptionner
                        </button>
                      )}
                      <button
                        onClick={() => setExpandedId(prev => (prev === report.id ? null : report.id))}
                        className="p-1.5 rounded-lg"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t" style={{ borderColor: 'var(--border)' }}>
                    <div className="pt-4 space-y-4">

                      {/* Type + Bus + Driver */}
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide mb-1"
                             style={{ color: 'var(--text-muted)' }}>Type</p>
                          <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                            {TYPE_LABELS[report.breakdown_type] || report.breakdown_type}
                          </p>
                        </div>
                        {report.bus && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide mb-1"
                               style={{ color: 'var(--text-muted)' }}>Bus</p>
                            <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                              {report.bus.registration_number}
                            </p>
                            {(report.bus.manufacturer || report.bus.model) && (
                              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {[report.bus.manufacturer, report.bus.model].filter(Boolean).join(' ')}
                              </p>
                            )}
                          </div>
                        )}
                        {driverName && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide mb-1"
                               style={{ color: 'var(--text-muted)' }}>Chauffeur</p>
                            <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                              {driverName}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Description */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide mb-1"
                           style={{ color: 'var(--text-muted)' }}>Description</p>
                        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                          {report.description}
                        </p>
                      </div>

                      {/* Location */}
                      {report.location && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide mb-1"
                             style={{ color: 'var(--text-muted)' }}>Localisation</p>
                          <div className="flex items-start gap-1.5">
                            <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#DC2626' }} />
                            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{report.location}</p>
                          </div>
                          {report.latitude != null && report.longitude != null && (
                            <p className="text-xs mt-1 pl-5" style={{ color: 'var(--text-muted)' }}>
                              GPS: {Number(report.latitude).toFixed(6)}, {Number(report.longitude).toFixed(6)}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Timestamps */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide mb-1"
                             style={{ color: 'var(--text-muted)' }}>Signalé le</p>
                          <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                            <Clock className="w-3.5 h-3.5" />
                            {format(new Date(report.reported_at), 'dd MMM yyyy à HH:mm', { locale: fr })}
                          </div>
                        </div>
                        {report.received_at && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide mb-1"
                               style={{ color: 'var(--text-muted)' }}>Reçu le</p>
                            <div className="flex items-center gap-1.5 text-sm" style={{ color: '#059669' }}>
                              <CheckCircle className="w-3.5 h-3.5" />
                              {format(new Date(report.received_at), 'dd MMM yyyy à HH:mm', { locale: fr })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Photos */}
                      {photos.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5"
                             style={{ color: 'var(--text-muted)' }}>
                            <Image className="w-3.5 h-3.5" />
                            Photos ({photos.length})
                          </p>
                          <div className="grid grid-cols-4 gap-2">
                            {photos.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                <img
                                  src={url}
                                  alt={`Photo ${i + 1}`}
                                  className="w-full h-24 object-cover rounded-lg border hover:opacity-90 transition-opacity"
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Status timeline */}
                      <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                        <p className="text-xs font-semibold uppercase tracking-wide mb-3"
                           style={{ color: 'var(--text-muted)' }}>Progression</p>
                        <div className="flex items-center">
                          {STATUS_ORDER.map((step, idx) => {
                            const stepCfg = STATUS_CONFIG[step];
                            const currentIdx = STATUS_ORDER.indexOf(report.status);
                            const isActive = idx === currentIdx;
                            const isDone = idx < currentIdx;
                            const dotColor = isDone || isActive ? stepCfg.dot : '#D1D5DB';

                            return (
                              <React.Fragment key={step}>
                                <div className="flex flex-col items-center flex-shrink-0">
                                  <div className="w-3 h-3 rounded-full border-2"
                                       style={{
                                         backgroundColor: isDone || isActive ? dotColor : 'white',
                                         borderColor: dotColor,
                                       }} />
                                  <p className="text-center leading-tight mt-1"
                                     style={{
                                       color: isActive ? stepCfg.color : isDone ? '#6B7280' : '#D1D5DB',
                                       fontWeight: isActive ? 700 : 400,
                                       fontSize: '10px',
                                       maxWidth: '60px',
                                     }}>
                                    {stepCfg.label}
                                  </p>
                                </div>
                                {idx < STATUS_ORDER.length - 1 && (
                                  <div className="flex-1 h-0.5 mb-5 mx-1"
                                       style={{
                                         backgroundColor: idx < currentIdx ? '#9CA3AF' : '#E5E7EB',
                                         minWidth: '16px',
                                       }} />
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>

                        {canReceive && (
                          <button
                            onClick={() => handleReceive(report)}
                            disabled={receiving === report.id}
                            className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                            style={{ backgroundColor: '#059669' }}
                          >
                            {receiving === report.id ? (
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <>
                                <CheckCircle className="w-4 h-4" />
                                Confirmer la réception
                                <ArrowRight className="w-4 h-4" />
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
