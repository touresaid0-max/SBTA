/*
# Planification (admin) : historique des modifications d'un départ

L'admin peut décloturer un départ (fonction existante `admin_toggle_schedule_status`, qui
garde le motif dans `schedule_reactivation_logs` et protège le départ de la clôture
automatique). Il doit ensuite voir ce que le guichet a modifié.

## Changements
1. `admin_schedule_history(p_schedule_id, p_since)` : les modifications d'un départ et de ce
   qui lui est rattaché, depuis une date (par défaut : toutes), lues dans le journal d'audit
   `activity_logs` :
   - le départ lui-même (`schedules`) ;
   - ses tickets (`reservations`), ses dépenses (`counter_charges`), ses bagages
     (`baggage_tickets`).
   Chaque ligne : date, table, action, auteur (nom), anciennes et nouvelles valeurs.
   Réservé aux rôles admin, daf et gestionnaire.
2. Journal d'audit des bagages : `baggage_tickets` n'était pas suivi ; il l'est désormais
   (création, modification, suppression), comme les tickets et les dépenses.
*/

-- ── 1. Bagages suivis dans le journal d'audit ───────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_baggage_tickets ON public.baggage_tickets;
CREATE TRIGGER trg_audit_baggage_tickets
  AFTER INSERT OR UPDATE OR DELETE ON public.baggage_tickets
  FOR EACH ROW EXECUTE FUNCTION public.audit_critical_table();

-- ── 2. Historique d'un départ ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_schedule_history(
  p_schedule_id uuid,
  p_since       timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  created_at  timestamptz,
  target_type text,
  target_id   uuid,
  action      text,
  user_name   text,
  old_values  jsonb,
  new_values  jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'daf', 'gestionnaire')
  ) AND (auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Historique réservé à l''administration.';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.created_at,
    l.target_type::text,
    l.target_id,
    l.action::text,
    COALESCE(u.full_name, u.email, 'Système')::text,
    l.old_values,
    l.new_values
  FROM activity_logs l
  LEFT JOIN users u ON u.id = l.user_id
  WHERE (p_since IS NULL OR l.created_at >= p_since)
    AND (
      (l.target_type = 'schedules' AND l.target_id = p_schedule_id)
      OR (
        l.target_type IN ('reservations', 'counter_charges', 'baggage_tickets')
        AND (
          l.new_values->>'schedule_id' = p_schedule_id::text
          OR l.old_values->>'schedule_id' = p_schedule_id::text
        )
      )
    )
  ORDER BY l.created_at DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_schedule_history(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_schedule_history(uuid, timestamptz) TO authenticated;
