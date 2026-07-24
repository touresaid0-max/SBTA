import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';

export interface PompisteTank {
  id: string;
  name: string;
  code: string;
  fuel_type: string;
  capacity_liters: number;
  current_level_liters: number;
  is_active: boolean;
}

interface UsePompisteTanksResult {
  tanks: PompisteTank[];
  tankIds: string[];
  loading: boolean;
  isCarburant: boolean;
  isPompiste: boolean;
  refresh: () => Promise<void>;
}

export function usePompisteTanks(): UsePompisteTanksResult {
  const user = useAuthStore((s) => s.user);
  const isCarburant = user?.role === 'carburant';
  const isPompiste = user?.role === 'pompiste';

  const [tanks, setTanks] = useState<PompisteTank[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('fuel_tanks')
        .select('id, name, code, fuel_type, capacity_liters, current_level_liters, is_active')
        .eq('is_active', true)
        .order('name');

      if (isPompiste) {
        query = query.eq('pompiste_id', user?.id ?? '');
      }
      const { data, error } = await query;
      if (error) throw error;
      setTanks((data as PompisteTank[]) || []);
    } catch {
      setTanks([]);
    } finally {
      setLoading(false);
    }
  }, [isPompiste, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    tanks,
    tankIds: tanks.map((t) => t.id),
    loading,
    isCarburant,
    isPompiste,
    refresh: load,
  };
}
