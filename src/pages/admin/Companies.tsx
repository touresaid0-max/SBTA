import { useState, useEffect } from 'react';
import { Plus, CreditCard as Edit2, Trash2, Building2, Bus as BusIcon, TrendingUp, ChevronRight, ChevronDown, Layers } from 'lucide-react';
import { supabase } from '../../services/supabase';
import DataTable from '../../components/shared/DataTable';
import KPICard from '../../components/shared/KPICard';
import { formatCurrency } from '../../utils/formatCurrency';
import toast from 'react-hot-toast';
import type { Company, Bus } from '../../types';

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [activeTab, setActiveTab] = useState<'infos' | 'buses' | 'performance'>('infos');
  // Groups expanded state (parent_id → bool)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'G-OUMÉ': true });
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    siret: '',
    logo_url: '',
    is_active: true,
    parent_id: '',
    is_group: false,
  });

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    if (selectedCompany) {
      loadCompanyBuses(selectedCompany.id);
    }
  }, [selectedCompany]);

  const loadCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('name');

      if (error) throw error;
      setCompanies(data || []);
    } catch (error: any) {
      toast.error('Erreur lors du chargement des sociétés');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadCompanyBuses = async (companyId: string) => {
    try {
      const { data, error } = await supabase
        .from('buses')
        .select('*')
        .eq('company_id', companyId)
        .order('registration_number');

      if (error) throw error;
      setBuses(data || []);
    } catch (error: any) {
      console.error(error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const companyData = {
        name: formData.name,
        code: formData.code,
        address: formData.address,
        phone: formData.phone,
        email: formData.email,
        siret: formData.siret,
        logo_url: formData.logo_url,
        is_active: formData.is_active,
        parent_id: formData.parent_id || null,
        is_group: formData.is_group,
      };

      if (editingCompany) {
        const { error } = await supabase
          .from('companies')
          .update(companyData)
          .eq('id', editingCompany.id);

        if (error) throw error;
        toast.success('Société mise à jour avec succès');
      } else {
        const { error } = await supabase
          .from('companies')
          .insert([companyData]);

        if (error) throw error;
        toast.success('Société créée avec succès');
      }

      setShowModal(false);
      setEditingCompany(null);
      resetForm();
      loadCompanies();
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de l\'enregistrement');
      console.error(error);
    }
  };

  const handleEdit = (company: Company) => {
    setEditingCompany(company);
    setFormData({
      name: company.name,
      code: company.code,
      address: company.address || '',
      phone: company.phone || '',
      email: company.email || '',
      siret: company.siret || '',
      logo_url: company.logo_url || '',
      is_active: company.is_active,
      parent_id: company.parent_id || '',
      is_group: company.is_group || false,
    });
    setShowModal(true);
  };

  const handleDelete = async (company: Company) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer "${company.name}" ?`)) return;

    try {
      const { error } = await supabase
        .from('companies')
        .delete()
        .eq('id', company.id);

      if (error) throw error;
      toast.success('Société supprimée avec succès');
      loadCompanies();
    } catch (error: any) {
      toast.error('Erreur lors de la suppression');
      console.error(error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      address: '',
      phone: '',
      email: '',
      siret: '',
      logo_url: '',
      is_active: true,
      parent_id: '',
      is_group: false,
    });
  };

  const columns = [
    {
      key: 'logo',
      label: '',
      render: (company: Company) => (
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--surface-raised)' }}>
          {company.logo_url ? (
            <img src={company.logo_url} alt={company.name} className="w-8 h-8 object-contain" />
          ) : (
            <Building2 className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          )}
        </div>
      ),
    },
    { key: 'name', label: 'Nom', sortable: true },
    { key: 'code', label: 'Code', sortable: true },
    { key: 'phone', label: 'Téléphone' },
    { key: 'email', label: 'Email' },
    {
      key: 'is_active',
      label: 'Statut',
      render: (company: Company) => (
        <span
          className="px-2 py-1 rounded-full text-xs font-medium"
          style={{
            backgroundColor: company.is_active ? 'var(--success-light)' : 'var(--danger-light)',
            color: company.is_active ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {company.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (company: Company) => (
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedCompany(company)}
            className="p-2 rounded-lg hover:bg-gray-100"
            style={{ color: 'var(--info)' }}
          >
            <Building2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleEdit(company)}
            className="p-2 rounded-lg hover:bg-gray-100"
            style={{ color: 'var(--primary)' }}
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleDelete(company)}
            className="p-2 rounded-lg hover:bg-gray-100"
            style={{ color: 'var(--danger)' }}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const busColumns = [
    { key: 'registration_number', label: 'Immatriculation' },
    { key: 'model', label: 'Modèle' },
    {
      key: 'status',
      label: 'Statut',
      render: (bus: Bus) => (
        <span className="px-2 py-1 rounded-full text-xs font-medium capitalize">
          {bus.status.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'fill_rate',
      label: 'Taux remplissage',
      render: (bus: Bus) => `${bus.fill_rate_current || 0}%`,
    },
  ];

  if (loading) {
    return <div className="p-6">Chargement...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Gestion des sociétés
          </h1>
          <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
            Gérez les groupes et sociétés autonomes
          </p>
        </div>
        <button
          onClick={() => {
            setEditingCompany(null);
            resetForm();
            setShowModal(true);
          }}
          className="px-4 py-2 rounded-lg flex items-center gap-2"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouvelle société
        </button>
      </div>

      {/* ── Hierarchy view ────────────────────────────────────────── */}
      {(() => {
        const groups   = companies.filter(c => c.is_group);
        const roots    = companies.filter(c => !c.parent_id && !c.is_group);
        const childMap: Record<string, Company[]> = {};
        for (const c of companies) {
          if (c.parent_id) {
            if (!childMap[c.parent_id]) childMap[c.parent_id] = [];
            childMap[c.parent_id].push(c);
          }
        }

        const CompanyRow = ({ company, indent = false }: { company: Company; indent?: boolean }) => (
          <div
            className={`flex items-center gap-3 px-4 py-3 transition-colors ${indent ? 'pl-10 border-l-2' : ''}`}
            style={{
              borderColor: indent ? '#86efac' : 'transparent',
              backgroundColor: 'transparent',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-subtle)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: company.is_group ? '#d4edda' : 'var(--surface-raised)' }}
            >
              {company.logo_url
                ? <img src={company.logo_url} alt={company.name} className="w-7 h-7 object-contain" />
                : company.is_group
                  ? <Layers className="w-5 h-5" style={{ color: '#0B7439' }} />
                  : <Building2 className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{company.name}</span>
                <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>{company.code}</span>
                {company.is_group && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
                    Groupe — {(childMap[company.id] ?? []).length} filiales
                  </span>
                )}
                {indent && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#f0fdf4', color: '#166534' }}>
                    Filiale
                  </span>
                )}
                {!company.is_active && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fee2e2', color: '#DC2626' }}>Inactive</span>
                )}
              </div>
              {(company.phone || company.email) && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                  {[company.phone, company.email].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => setSelectedCompany(company)} className="p-1.5 rounded-lg hover:bg-gray-100" style={{ color: 'var(--info)' }} title="Détails">
                <Building2 className="w-4 h-4" />
              </button>
              <button onClick={() => handleEdit(company)} className="p-1.5 rounded-lg hover:bg-gray-100" style={{ color: 'var(--primary)' }} title="Modifier">
                <Edit2 className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(company)} className="p-1.5 rounded-lg hover:bg-gray-100" style={{ color: 'var(--danger)' }} title="Supprimer">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        );

        return (
          <div className="space-y-6">
            {/* ── Section: Groupes ───────────────── */}
            {groups.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4" style={{ color: '#0B7439' }} />
                  <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#0B7439' }}>
                    Groupes ({groups.length})
                  </h2>
                </div>
                {groups.map(group => {
                  const subs = childMap[group.id] ?? [];
                  const isOpen = !!expandedGroups[group.code];
                  return (
                    <div key={group.id} className="rounded-xl overflow-hidden" style={{ border: '2px solid #86efac', backgroundColor: 'var(--surface)' }}>
                      {/* Group header row — clickable */}
                      <div
                        className="flex items-center cursor-pointer"
                        style={{ backgroundColor: '#f0fdf4' }}
                        onClick={() => setExpandedGroups(s => ({ ...s, [group.code]: !s[group.code] }))}
                      >
                        <button className="p-3 pl-4 flex-shrink-0" tabIndex={-1}>
                          {isOpen
                            ? <ChevronDown className="w-4 h-4" style={{ color: '#0B7439' }} />
                            : <ChevronRight className="w-4 h-4" style={{ color: '#0B7439' }} />
                          }
                        </button>
                        <div className="flex-1 pointer-events-none">
                          <CompanyRow company={group} />
                        </div>
                      </div>
                      {/* Subsidiaries */}
                      {isOpen && (
                        <div style={{ backgroundColor: 'var(--surface)' }}>
                          {subs.length === 0 ? (
                            <p className="px-10 py-4 text-xs italic" style={{ color: 'var(--text-muted)' }}>Aucune filiale rattachée</p>
                          ) : (
                            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                              {subs.sort((a, b) => a.code.localeCompare(b.code)).map((sub, idx) => (
                                <div key={sub.id} className="flex items-center" style={{ paddingLeft: '2.5rem' }}>
                                  <span className="text-xs mr-2 flex-shrink-0 w-5 text-right" style={{ color: '#86efac' }}>
                                    {idx === subs.length - 1 ? '└' : '├'}
                                  </span>
                                  <div className="flex-1 border-l-2" style={{ borderColor: '#86efac' }}>
                                    <CompanyRow company={sub} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Section: Sociétés autonomes ────── */}
            {roots.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                  <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                    Sociétés autonomes ({roots.length})
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
                    Indépendantes · Non filiales
                  </span>
                </div>
                <div className="rounded-xl overflow-hidden divide-y" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
                  {roots.map(c => <CompanyRow key={c.id} company={c} />)}
                </div>
              </div>
            )}

            {companies.length === 0 && (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                Aucune société enregistrée
              </div>
            )}
          </div>
        );
      })()}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="rounded-lg p-6 max-w-2xl w-full mx-4" style={{ backgroundColor: 'var(--surface)' }}>
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              {editingCompany ? 'Modifier la société' : 'Nouvelle société'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Nom *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)' }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Code *
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    required
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)' }}
                    placeholder="Ex: SBTA-01"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Adresse
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Téléphone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)' }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)' }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  SIRET
                </label>
                <input
                  type="text"
                  value={formData.siret}
                  onChange={(e) => setFormData({ ...formData, siret: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Logo URL
                </label>
                <input
                  type="url"
                  value={formData.logo_url}
                  onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)' }}
                  placeholder="https://..."
                />
              </div>

              {/* Société mère (pour les filiales) */}
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Groupe parent (optionnel)
                </label>
                <select
                  value={formData.parent_id}
                  onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <option value="">— Aucun (société indépendante) —</option>
                  {companies.filter(c => c.is_group && c.id !== editingCompany?.id).map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded"
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <label htmlFor="is_active" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Société active
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_group"
                    checked={formData.is_group}
                    onChange={(e) => setFormData({ ...formData, is_group: e.target.checked })}
                    className="rounded"
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <label htmlFor="is_group" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Société de groupe (holding / consolidatrice)
                  </label>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingCompany(null);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-lg"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
                >
                  {editingCompany ? 'Mettre à jour' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedCompany && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="sticky top-0 border-b p-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {selectedCompany.logo_url && (
                    <img src={selectedCompany.logo_url} alt={selectedCompany.name} className="w-12 h-12 object-contain" />
                  )}
                  <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {selectedCompany.name}
                  </h2>
                </div>
                <button
                  onClick={() => setSelectedCompany(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div className="flex gap-4 mt-4 border-b" style={{ borderColor: 'var(--border)' }}>
                {[
                  { key: 'infos', label: 'Informations', icon: Building2 },
                  { key: 'buses', label: 'Bus associés', icon: BusIcon },
                  { key: 'performance', label: 'Performances', icon: TrendingUp },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`flex items-center gap-2 px-4 py-2 border-b-2 ${activeTab === tab.key ? 'border-current' : 'border-transparent'}`}
                    style={{ color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-muted)' }}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6">
              {activeTab === 'infos' && (
                <div className="space-y-4">
                  {/* Hierarchy badge */}
                  {selectedCompany.is_group && (
                    <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: '#d4edda', border: '1px solid #86efac' }}>
                      <Layers className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
                      <div>
                        <p className="text-sm font-semibold" style={{ color: '#0B7439' }}>Société de groupe</p>
                        <p className="text-xs" style={{ color: '#166534' }}>
                          {companies.filter(c => c.parent_id === selectedCompany.id).length} filiale(s) rattachée(s) :&nbsp;
                          {companies.filter(c => c.parent_id === selectedCompany.id).map(c => c.code).join(', ')}
                        </p>
                      </div>
                    </div>
                  )}
                  {selectedCompany.parent_id && (
                    <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                      <Building2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                      <div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Filiale de</p>
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {companies.find(c => c.id === selectedCompany.parent_id)?.name ?? '—'}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Code</label>
                      <p style={{ color: 'var(--text-primary)' }}>{selectedCompany.code}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>SIRET</label>
                      <p style={{ color: 'var(--text-primary)' }}>{selectedCompany.siret || '-'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Téléphone</label>
                      <p style={{ color: 'var(--text-primary)' }}>{selectedCompany.phone || '-'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Email</label>
                      <p style={{ color: 'var(--text-primary)' }}>{selectedCompany.email || '-'}</p>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Adresse</label>
                    <p style={{ color: 'var(--text-primary)' }}>{selectedCompany.address || '-'}</p>
                  </div>
                </div>
              )}

              {activeTab === 'buses' && (
                <div>
                  <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                    {buses.length} bus associé(s)
                  </p>
                  <DataTable data={buses} columns={busColumns} searchable={false} pageSizeKey="sbta_admin_company_buses_page_size" itemLabel="bus" />
                </div>
              )}

              {activeTab === 'performance' && (
                <div>
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <KPICard
                      title="Revenus du mois"
                      value={formatCurrency(0)}
                      trend={0}
                      icon={<TrendingUp className="w-5 h-5" />}
                    />
                    <KPICard
                      title="Charges du mois"
                      value={formatCurrency(0)}
                      trend={0}
                      icon={<TrendingUp className="w-5 h-5" />}
                    />
                    <KPICard
                      title="Bénéfice"
                      value={formatCurrency(0)}
                      trend={0}
                      icon={<TrendingUp className="w-5 h-5" />}
                    />
                  </div>
                  <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                    Données détaillées à venir
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
