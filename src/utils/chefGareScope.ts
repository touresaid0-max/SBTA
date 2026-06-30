import { supabase } from '../services/supabase';

export interface ChefGareScope {
  stationId: string | null;
  // null  => single-chef station: the chef sees every counter of the station.
  // string => multi-chef station: the chef sees only counters whose
  //           manager_id equals this value (their own user id).
  restrictManagerId: string | null;
}

export async function loadChefGareScope(userId: string): Promise<ChefGareScope> {
  const { data: sid } = await supabase.rpc('get_my_station_id');
  if (!sid) return { stationId: null, restrictManagerId: null };

  const { count } = await supabase
    .from('station_managers')
    .select('id', { count: 'exact', head: true })
    .eq('station_id', sid);

  const multiChef = (count ?? 0) > 1;
  return {
    stationId: sid as string,
    restrictManagerId: multiChef ? userId : null,
  };
}
