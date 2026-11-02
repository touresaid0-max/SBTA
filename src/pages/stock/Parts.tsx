import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Plus, CreditCard as Edit2, Trash2, Search, Package } from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';

interface Part {
  id: string;
  part_number: string;
  name: string;
  description: string | null;
  category: string | null;
  unit_price: number | null;
  stock_quantity: number;
  min_stock_level: number;
  location: string | null;
  supplier_id: string | null;
  created_at: string;
}

interface Supplier {
  id: string;
  name: string;
}

const CATEGORIES = [
  'Moteur',
  'Transmission',
  'Freinage',
  'Suspension',
  'Électrique',
  'Carrosserie',
  'Pneumatiques',
  'Climatisation',
  'Filtration',
  'Autre'
];

const EMPTY_FORM = {
  part_number: '',
  name: '',
  description: '',
  category: '',
  unit_price: 0,
  stock_quantity: 0,
  min_stock_level: 5,
  location: '',
  supplier_id: ''
};

export default function Parts() {
  const [loading, setLoading] = useState(true);
  const [parts, setParts] = useState<Part[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filteredParts, setFilteredParts] = useState<Part[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [formData, setFormData] = useState(EMPTY_FORM);

  useEffect(() => {
    loadParts();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [parts, searchQuery, filterCategory, filterSupplier, filterStatus]);

  const loadParts = async () => {
    try {
      setLoading(true);
      const [partsRes, suppliersRes] = await Promise.all([
        supabase
          .from('spare_parts')
          .select('id, part_number, name, description, category, unit_price, stock_quantity, min_stock_level, location, supplier_id, created_at')
          .order('name', { ascending: true }),
        supabase
          .from('spare_parts_suppliers')
          .select('id, name')
          .order('name', { ascending: true })
      ]);

      if (partsRes.error) throw partsRes.error;
      if (suppliersRes.error) throw suppliersRes.error;
      setParts((partsRes.data || []) as Part[]);
      setSuppliers(suppliersRes.data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const supplierName = (id: string | null) =>
    suppliers.find(s => s.id === id)?.name ?? '';

  // Known categories plus those already used by existing parts
  const categories = Array.from(
    new Set([...CATEGORIES, ...parts.map(p => p.category).filter((c): c is string => !!c)])
  );

  const minOf = (part: Part) => Number(part.min_stock_level ?? 0);
  const stockOf = (part: Part) => Number(part.stock_quantity ?? 0);

  const applyFilters = () => {
    let filtered = [...parts];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        part =>
          part.part_number.toLowerCase().includes(query) ||
          part.name.toLowerCase().includes(query) ||
          (part.description ?? '').toLowerCase().includes(query)
      );
    }

    if (filterCategory) {
      filtered = filtered.filter(part => part.category === filterCategory);
    }

    if (filterSupplier) {
      filtered = filtered.filter(part => part.supplier_id === filterSupplier);
    }

    if (filterStatus) {
      filtered = filtered.filter(part => {
        if (filterStatus === 'low') return stockOf(part) < minOf(part);
        if (filterStatus === 'warning')
          return stockOf(part) >= minOf(part) && stockOf(part) <= minOf(part) * 1.2;
        if (filterStatus === 'ok') return stockOf(part) > minOf(part) * 1.2;
        return true;
      });
    }

    setFilteredParts(filtered);
  };

  const getStockStatus = (part: Part) => {
    if (stockOf(part) < minOf(part)) {
      return { color: 'var(--danger)', bg: 'var(--danger-light)', label: 'Critique', icon: '🔴' };
    }
    if (stockOf(part) <= minOf(part) * 1.2) {
      return { color: 'var(--warning)', bg: 'var(--warning-light)', label: 'Bas', icon: '🟠' };
    }
    return { color: 'var(--success)', bg: 'var(--success-light)', label: 'OK', icon: '🟢' };
  };

  const openModal = (part?: Part) => {
    if (part) {
      setEditingPart(part);
      setFormData({
        part_number: part.part_number,
        name: part.name,
        description: part.description ?? '',
        category: part.category ?? '',
        unit_price: Number(part.unit_price ?? 0),
        stock_quantity: stockOf(part),
        min_stock_level: minOf(part),
        location: part.location ?? '',
        supplier_id: part.supplier_id ?? ''
      });
    } else {
      setEditingPart(null);
      setFormData(EMPTY_FORM);
    }
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.part_number || !formData.name || !formData.category) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }

    try {
      const partData = {
        part_number: formData.part_number.trim(),
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        category: formData.category,
        unit_price: formData.unit_price,
        stock_quantity: formData.stock_quantity,
        min_stock_level: formData.min_stock_level,
        location: formData.location.trim() || null,
        supplier_id: formData.supplier_id || null
      };

      if (editingPart) {
        const { error } = await supabase
          .from('spare_parts')
          .update({ ...partData, updated_at: new Date().toISOString() })
          .eq('id', editingPart.id);

        if (error) throw error;
        toast.success('Pièce modifiée');
      } else {
        const { error } = await supabase
          .from('spare_parts')
          .insert(partData);

        if (error) throw error;
        toast.success('Pièce ajoutée');
      }

      setShowModal(false);
      loadParts();
    } catch (error: any) {
      toast.error(
        error?.code === '23505'
          ? 'Cette référence existe déjà'
          : "Erreur lors de l'enregistrement"
      );
      console.error(error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette pièce ?')) return;

    try {
      const { error } = await supabase.from('spare_parts').delete().eq('id', id);

      if (error) throw error;
      toast.success('Pièce supprimée');
      loadParts();
    } catch (error: any) {
      toast.error(
        error?.code === '23503'
          ? 'Cette pièce a des mouvements de stock : suppression impossible'
          : 'Erreur lors de la suppression'
      );
      console.error(error);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Pièces détachées
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Gestion du stock de pièces</p>
        </div>
        <button
          onClick={() => openModal()}
          className="px-6 py-3 rounded-lg text-white font-bold flex items-center gap-2"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouvelle pièce
        </button>
      </div>

      <div className="bg-white rounded-xl p-6 border mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher par référence, nom ou description..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
          </div>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Toutes catégories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <select
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Tous fournisseurs</option>
            {suppliers.map(supplier => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="">Tous statuts</option>
            <option value="low">🔴 Critique</option>
            <option value="warning">🟠 Bas</option>
            <option value="ok">🟢 OK</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
                <tr>
                  <th className="text-left p-4 font-semibold">Référence</th>
                  <th className="text-left p-4 font-semibold">Désignation</th>
                  <th className="text-left p-4 font-semibold">Catégorie</th>
                  <th className="text-left p-4 font-semibold">Fournisseur</th>
                  <th className="text-left p-4 font-semibold">Stock</th>
                  <th className="text-left p-4 font-semibold">Minimum</th>
                  <th className="text-left p-4 font-semibold">Prix unitaire</th>
                  <th className="text-left p-4 font-semibold">Statut</th>
                  <th className="text-left p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredParts.map(part => {
                  const status = getStockStatus(part);
                  return (
                    <tr key={part.id} className="border-t hover:bg-gray-50">
                      <td className="p-4">
                        <p className="font-mono font-bold">{part.part_number}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-semibold">{part.name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {part.location}
                        </p>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100">
                          {part.category || '-'}
                        </span>
                      </td>
                      <td className="p-4">
                        <p className="font-medium">{supplierName(part.supplier_id) || '-'}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-bold text-lg">{stockOf(part)}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-semibold">{minOf(part)}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-semibold">{formatCurrency(Number(part.unit_price ?? 0))}</p>
                      </td>
                      <td className="p-4">
                        <span
                          className="px-3 py-1 rounded-full text-xs font-bold"
                          style={{ backgroundColor: status.bg, color: status.color }}
                        >
                          {status.icon} {status.label}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openModal(part)}
                            className="p-2 rounded-lg border hover:bg-gray-50"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(part.id)}
                            className="p-2 rounded-lg border hover:bg-red-50"
                            style={{ color: 'var(--danger)' }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredParts.length === 0 && (
              <div className="p-12 text-center">
                <Package className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-secondary)' }} />
                <p className="font-semibold mb-1">Aucune pièce trouvée</p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {parts.length === 0 ? 'Ajoutez votre première pièce' : 'Aucun résultat ne correspond aux filtres'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-xl mb-6">
              {editingPart ? 'Modifier la pièce' : 'Nouvelle pièce'}
            </h3>

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block mb-2 font-medium">Référence *</label>
                  <input
                    type="text"
                    value={formData.part_number}
                    onChange={(e) => setFormData({ ...formData, part_number: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    required
                  />
                </div>

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
                  <label className="block mb-2 font-medium">Catégorie *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    required
                  >
                    <option value="">Sélectionner</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Fournisseur</label>
                  <select
                    value={formData.supplier_id}
                    onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                  >
                    <option value="">Aucun</option>
                    {suppliers.map(supplier => (
                      <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Stock actuel</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.stock_quantity}
                    onChange={(e) => setFormData({ ...formData, stock_quantity: parseInt(e.target.value) || 0 })}
                    className="w-full p-3 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Stock minimum</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.min_stock_level}
                    onChange={(e) => setFormData({ ...formData, min_stock_level: parseInt(e.target.value) || 0 })}
                    className="w-full p-3 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Prix unitaire (FCFA)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={formData.unit_price}
                    onChange={(e) => setFormData({ ...formData, unit_price: parseFloat(e.target.value) || 0 })}
                    className="w-full p-3 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Emplacement</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    placeholder="Ex: Étagère A-12"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block mb-2 font-medium">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    rows={3}
                    placeholder="Ex: modèles compatibles, marque..."
                  />
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
                  {editingPart ? 'Modifier' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
