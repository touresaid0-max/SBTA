/*
# Codes courrier : code d'agence par destination et domaine de suivi (audit M11)

La migration du 31/08/2026 (« preserve_offline_parcel_codes ») a ajouté la conservation des
codes créés hors ligne, mais en repartant d'une ancienne version de la fonction :
- le lien de suivi des courriers créés en ligne pointait de nouveau vers
  https://sbta-pink.vercel.app au lieu de https://sbta-gestion.cloud ;
- le code d'agence propre à chaque destination (station_destination_agency_codes,
  migration du 26/06/2026) n'était plus utilisé : tous les courriers recevaient le code
  général de la gare de départ.

## Changements
1. `auto_fill_parcel_codes()` redéfinie en réunissant les trois règles :
   - code déjà fourni (courrier créé hors ligne) : conservé ; référence, lien de suivi et
     numéro du jour complétés seulement s'ils manquent ;
   - sinon : code d'agence de la destination pour cette gare de départ, à défaut code
     d'agence de la gare, à défaut 6 chiffres ; unicité vérifiée en base ;
   - lien de suivi sur https://sbta-gestion.cloud.
2. Liens de suivi déjà enregistrés sur un autre domaine : remis sur
   https://sbta-gestion.cloud/track/<code>. Le code du courrier ne change pas ; seuls les
   liens différents sont réécrits (aucun changement de statut, aucun événement de suivi).

Le déclencheur `trg_auto_fill_parcel_codes` (BEFORE INSERT) reste le même.
*/

CREATE OR REPLACE FUNCTION auto_fill_parcel_codes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code        text;
  v_agency_code text;
  v_suffix      text;
  v_exists      boolean;
  v_app_url     text := 'https://sbta-gestion.cloud';
BEGIN
  -- 1. Code already set (parcel created offline): keep it, fill only what is missing
  IF NEW.parcel_code IS NOT NULL AND NEW.parcel_code <> '' THEN
    IF NEW.reference IS NULL OR NEW.reference = '' THEN
      NEW.reference := generate_parcel_reference(NEW.parcel_code);
    END IF;
    IF NEW.tracking_url IS NULL OR NEW.tracking_url = '' THEN
      NEW.tracking_url := v_app_url || '/track/' || NEW.parcel_code;
    END IF;
    IF NEW.daily_sequence IS NULL OR NEW.daily_sequence = 0 THEN
      NEW.daily_sequence := get_daily_sequence(NEW.origin_station_id);
    END IF;
    RETURN NEW;
  END IF;

  -- 2. Agency code of the destination for this origin station
  SELECT sdac.agency_code INTO v_agency_code
  FROM station_destination_agency_codes sdac
  WHERE sdac.origin_station_id = NEW.origin_station_id
    AND sdac.destination_station_id = NEW.destination_station_id
  LIMIT 1;

  -- 3. Otherwise the origin station's general agency code
  IF v_agency_code IS NULL OR length(v_agency_code) = 0 THEN
    SELECT s.agency_code INTO v_agency_code
    FROM stations s
    WHERE s.id = NEW.origin_station_id;
  END IF;

  IF v_agency_code IS NOT NULL AND length(v_agency_code) > 0 THEN
    LOOP
      v_suffix := lpad(floor(random() * 9999 + 1)::text, 4, '0');
      v_code := v_agency_code || v_suffix;
      SELECT EXISTS (SELECT 1 FROM parcels WHERE parcel_code = v_code) INTO v_exists;
      EXIT WHEN NOT v_exists;
    END LOOP;
  ELSE
    LOOP
      v_code := lpad(floor(random() * 999999 + 1)::text, 6, '0');
      SELECT EXISTS (SELECT 1 FROM parcels WHERE parcel_code = v_code) INTO v_exists;
      EXIT WHEN NOT v_exists;
    END LOOP;
  END IF;

  NEW.parcel_code    := v_code;
  NEW.reference      := generate_parcel_reference(v_code);
  NEW.daily_sequence := get_daily_sequence(NEW.origin_station_id);
  NEW.tracking_url   := v_app_url || '/track/' || v_code;
  RETURN NEW;
END;
$$;

-- Tracking links saved on another domain (sbta-pink.vercel.app since 31/08/2026, older hosts)
UPDATE parcels
SET tracking_url = 'https://sbta-gestion.cloud/track/' || parcel_code
WHERE parcel_code IS NOT NULL
  AND parcel_code <> ''
  AND tracking_url IS DISTINCT FROM 'https://sbta-gestion.cloud/track/' || parcel_code;
