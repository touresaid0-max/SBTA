/*
# Journal d'activité (activity_logs) : alléger l'audit

Constat (production, 30/10/2026) : activity_logs pesait 373 Mo, plus que toutes les autres
tables réunies. Chaque modification d'une table auditée y copiait la ligne complète, avant
et après, y compris pour les compteurs recalculés automatiquement à chaque vente
(schedules / update : 24 519 lignes, 51 Mo ; buses / update : 10 608 lignes, 18 Mo).

Remplace audit_critical_table() (la version de 20261030190000 est reprise et complétée) :

1. Modification (UPDATE) : old_values / new_values ne contiennent plus que les colonnes
   réellement modifiées (environ 10 à 20 fois plus léger). Les pages Journal d'activité et
   Audit les affichent de la même façon. Création et suppression gardent la ligne complète.
2. Rien n'est enregistré quand :
   - rien n'a changé à part updated_at ;
   - sur schedules, seuls les compteurs de sièges ont changé (seats_reserved,
     seats_available, fill_rate) ;
   - sur buses, seul le taux de remplissage a changé (fill_rate_current).
   Ces compteurs sont recalculés à partir des ventes, qui restent elles-mêmes auditées.
   Toute autre modification d'un départ ou d'un bus (chauffeur, bus, statut, horaire…)
   reste auditée.

3. Conservation : la purge automatique de nuit (run_archive, politique archive_policies)
   supprime désormais les lignes de plus de 12 mois (au lieu de 24).
*/

CREATE OR REPLACE FUNCTION public.audit_critical_table()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _action text;
  _target_id uuid;
  _old jsonb;
  _new jsonb;
  _desc text;
  _changed text[];
BEGIN
  _action := lower(TG_OP);

  IF TG_OP = 'DELETE' THEN
    _target_id := OLD.id;
    _old := to_jsonb(OLD);
    _new := NULL;
    _desc := 'Suppression dans ' || TG_TABLE_NAME;
  ELSIF TG_OP = 'INSERT' THEN
    _target_id := NEW.id;
    _old := NULL;
    _new := to_jsonb(NEW);
    _desc := 'Création dans ' || TG_TABLE_NAME;
  ELSE -- UPDATE
    _target_id := NEW.id;
    _desc := 'Modification dans ' || TG_TABLE_NAME;

    -- Keep only the columns whose value changed
    SELECT coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb),
           coalesce(jsonb_object_agg(n.key, to_jsonb(OLD) -> n.key), '{}'::jsonb),
           coalesce(array_agg(n.key), ARRAY[]::text[])
      INTO _new, _old, _changed
    FROM jsonb_each(to_jsonb(NEW)) AS n
    WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);

    -- Nothing changed apart from the update timestamp: nothing to audit
    IF _changed <@ ARRAY['updated_at'] THEN
      RETURN NEW;
    END IF;

    -- Counters recalculated from sales (the sales themselves are audited)
    IF TG_TABLE_NAME = 'schedules'
       AND _changed <@ ARRAY['seats_reserved', 'seats_available', 'fill_rate', 'updated_at'] THEN
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'buses'
       AND _changed <@ ARRAY['fill_rate_current', 'updated_at'] THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO activity_logs (user_id, target_id, target_type, action, description, old_values, new_values)
  VALUES (
    auth.uid(),
    _target_id,
    TG_TABLE_NAME,
    _action,
    _desc,
    _old,
    _new
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Nightly purge (run_archive): keep 12 months of activity log instead of 24
UPDATE public.archive_policies
SET retention_months = 12
WHERE source_table = 'activity_logs';
