import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Plus, CreditCard as Edit2, Trash2, Search, Building2, Power } from 'lucide-react';

interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean | null;
  created_at: string;
}

const EMPTY_FORM = {
  name: '',
  contact_person: '',
  phone: '',
  email: '',
  address: '',
  is_active: true
};

export default function Suppliers() {
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [formData, setFormData] = useState(EMPTY_FORM);

  useEffect(() => {
    loadSuppliers();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [suppliers, searchQuery]);

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('spare_parts_suppliers')
        .select('id, name, contact_person, phone, email, address, is_active, created_at')
        .order('name', { ascending: true });

      if (error) throw error;
      setSuppliers((data || []) as Supplier[]);
    } catch (error: any) {
      toast.error('Erreur de chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...suppliers];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        supplier =>
          supplier.name.toLowerCase().includes(query) ||
          (supplier.contact_person ?? '').toLowerCase().includes(query) ||
          (supplier.email ?? '').toLowerCase().includes(query) ||
          (supplier.phone ?? '').toLowerCase().includes(query)
      );
    }

    setFilteredSuppliers(filtered);
  };

  const isActive = (supplier: Supplier) => supplier.is_active !== false;

  const openModal = (supplier?: Supplier) => {
    if (supplier) {
      setEditingSupplier(supplier);
      setFormData({
        name: supplier.name,
        contact_person: supplier.contact_person ?? '',
        phone: supplier.phone ?? '',
        email: supplier.email ?? '',
        address: supplier.address ?? '',
        is_active: isActive(supplier)
      });
    } else {
      setEditingSupplier(null);
      setFormData(EMPTY_FORM);
    }
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.contact_person) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }

    const supplierData = {
      name: formData.name.trim(),
      contact_person: formData.contact_person.trim() || null,
      phone: formData.phone.trim() || null,
      email: formData.email.trim() || null,
      address: formData.address.trim() || null,
      is_active: formData.is_active
    };

    try {
      if (editingSupplier) {
        const { error } = await supabase
          .from('spare_parts_suppliers')
          .update(supplierData)
          .eq('id', editingSupplier.id);

        if (error) throw error;
        toast.success('Fournisseur modifié');
      } else {
        const { error } = await supabase
          .from('spare_parts_suppliers')
          .insert(supplierData);

        if (error) throw error;
        toast.success('Fournisseur ajouté');
      }

      setShowModal(false);
      loadSuppliers();
    } catch (error: any) {
      toast.error("Erreur lors de l'enregistrement");
      console.error(error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce fournisseur ?')) return;

    try {
      const { error } = await supabase
        .from('spare_parts_suppliers')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Fournisseur supprimé');
      loadSuppliers();
    } catch (error: any) {
      toast.error(
        error?.code === '23503'
          ? 'Ce fournisseur a des bons de commande : désactivez-le plutôt'
          : 'Erreur lors de la suppression'
      );
      console.error(error);
    }
  };

  const toggleActive = async (supplier: Supplier) => {
    try {
      const { error } = await supabase
        .from('spare_parts_suppliers')
        .update({ is_active: !isActive(supplier) })
        .eq('id', supplier.id);

      if (error) throw error;
      toast.success(isActive(supplier) ? 'Fournisseur désactivé' : 'Fournisseur activé');
      loadSuppliers();
    } catch (error: any) {
      toast.error('Erreur lors de la mise à jour');
      console.error(error);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Fournisseurs
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Gestion des fournisseurs de pièces détachées</p>
        </div>
        <button
          onClick={() => openModal()}
          className="px-6 py-3 rounded-lg text-white font-bold flex items-center gap-2"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouveau fournisseur
        </button>
      </div>

      <div className="bg-white rounded-xl p-6 border mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un fournisseur..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSuppliers.map(supplier => (
            <div
              key={supplier.id}
              className={`bg-white rounded-xl p-6 border hover:shadow-lg transition-shadow ${isActive(supplier) ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-bold text-lg mb-1">{supplier.name}</h3>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-semibold"
                    style={
                      isActive(supplier)
                        ? { backgroundColor: 'var(--success-light)', color: 'var(--success)' }
                        : { backgroundColor: 'var(--neutral-100)', color: 'var(--text-secondary)' }
                    }
                  >
                    {isActive(supplier) ? 'Actif' : 'Inactif'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openModal(supplier)}
                    className="p-2 rounded-lg border hover:bg-gray-50"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(supplier.id)}
                    className="p-2 rounded-lg border hover:bg-red-50"
                    style={{ color: 'var(--danger)' }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">Contact:</span>
                  <span>{supplier.contact_person || '-'}</span>
                </div>

                {supplier.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold">Téléphone:</span>
                    <a href={`tel:${supplier.phone}`} className="hover:underline" style={{ color: 'var(--primary)' }}>
                      {supplier.phone}
                    </a>
                  </div>
                )}

                {supplier.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold">Email:</span>
                    <a href={`mailto:${supplier.email}`} className="hover:underline" style={{ color: 'var(--primary)' }}>
                      {supplier.email}
                    </a>
                  </div>
                )}

                {supplier.address && (
                  <div className="flex items-start gap-2 text-sm">
                    <span className="font-semibold">Adresse:</span>
                    <span className="flex-1">{supplier.address}</span>
                  </div>
                )}
              </div>

              <button
                onClick={() => toggleActive(supplier)}
                className="w-full px-4 py-2 rounded-lg border-2 font-medium flex items-center justify-center gap-2 transition-colors border-gray-200 hover:bg-gray-50"
              >
                <Power className="w-4 h-4" />
                {isActive(supplier) ? 'Désactiver' : 'Activer'}
              </button>
            </div>
          ))}
        </div>
      )}

      {filteredSuppliers.length === 0 && !loading && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Building2 className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-secondary)' }} />
          <p className="font-semibold mb-1">Aucun fournisseur trouvé</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {suppliers.length === 0 ? 'Ajoutez votre premier fournisseur' : 'Aucun résultat ne correspond à votre recherche'}
          </p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-xl mb-6">
              {editingSupplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
            </h3>

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block mb-2 font-medium">Nom *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    required
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Personne de contact *</label>
                  <input
                    type="text"
                    value={formData.contact_person}
                    onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    required
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Téléphone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block mb-2 font-medium">Adresse</label>
                  <textarea
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    rows={2}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-5 h-5"
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <span>Fournisseur actif (proposé pour les commandes automatiques)</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-3 rounded-lg border font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-6 py-3 rounded-lg text-white font-bold"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {editingSupplier ? 'Modifier' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
