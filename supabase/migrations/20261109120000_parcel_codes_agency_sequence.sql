/*
# Codes courrier : code agence de la gare qui expédie, suivi de 001, 002, 003…

## Besoin
Le code d'un courrier était le code agence suivi de 4 chiffres tirés au hasard (6 chiffres au
hasard pour une gare sans code agence), et hors ligne une forme « H » + 5 caractères. Il doit
être le code agence de la gare qui expédie suivi d'un numéro qui se suit : 53001, 53002, 53003…
(après 53999 : 531000, 531001…).

## Règles
1. Préfixe : le code agence de la gare de départ (stations.agency_code), celui de la liste
   Gares. Les codes agence par destination (station_destination_agency_codes) ne servent plus
   pour le courrier (la table n'est pas modifiée).
2. Gare sans code agence : l'enregistrement du courrier est refusé, avec un message demandant
   à l'administrateur de saisir le code.
3. Numéro : un compteur par code agence (parcel_code_counters), incrémenté en une seule
   instruction : deux courriers enregistrés au même instant ne reçoivent jamais le même numéro.
   Un code déjà pris (ancien code au hasard de la même forme) est sauté.
4. Hors ligne : le poste réserve à l'avance des numéros pour sa gare (reserve_parcel_codes) et
   les utilise sans réseau ; le code imprimé sur le reçu est définitif. Un numéro réservé et
   jamais utilisé laisse un trou dans la suite.
5. Code déjà fourni (courrier créé hors ligne) : conservé, comme avant.
6. Courriers existants : leurs codes ne changent pas (reçus déjà remis aux clients).
7. Référence (unique) : « MM/JJ-HHMI- » suivi du code COMPLET, au lieu de ses 4 derniers
   caractères. Avec des numéros qui se suivent, 53001, 23001 et 63001 finissent tous par 3001 :
   deux gares enregistrant leur n°001 dans la même minute auraient eu la même référence, et le
   second courrier aurait été refusé. Le code étant unique, la référence l'est aussi. Les
   références existantes ne changent pas.

## Sécurité
Table nouvelle, RLS activée sans politique : lue et écrite seulement par les fonctions
ci-dessous (SECURITY DEFINER). reserve_parcel_codes : utilisateur connecté, 100 numéros au plus
par appel. Aucune politique RLS existante modifiée, aucune donnée supprimée.
*/

-- 1. Compteur par code agence
CREATE TABLE IF NOT EXISTS public.parcel_code_counters (
  agency_code  text PRIMARY KEY,
  last_number  integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.parcel_code_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parcel_code_counters FROM anon, authenticated;

-- 2. Code formé : préfixe + numéro sur 3 chiffres au moins (1 → 001, 1000 → 1000)
--    (lpad seul tronquerait 1000 en « 100 »)
CREATE OR REPLACE FUNCTION public.format_parcel_code(p_agency_code text, p_number integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_agency_code || CASE WHEN p_number < 1000 THEN lpad(p_number::text, 3, '0') ELSE p_number::text END;
$$;

-- 3. Prochain code libre pour un code agence (numéro suivant, codes déjà pris sautés)
CREATE OR REPLACE FUNCTION public.next_parcel_code(p_agency_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_number integer;
  v_code   text;
BEGIN
  LOOP
    INSERT INTO public.parcel_code_counters AS c (agency_code, last_number, updated_at)
    VALUES (p_agency_code, 1, now())
    ON CONFLICT (agency_code)
    DO UPDATE SET last_number = c.last_number + 1, updated_at = now()
    RETURNING c.last_number INTO v_number;

    v_code := public.format_parcel_code(p_agency_code, v_number);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.parcels WHERE parcel_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.next_parcel_code(text) FROM PUBLIC, anon, authenticated;

-- 4. Code agence de la gare qui expédie ; refus si la gare n'en a pas
CREATE OR REPLACE FUNCTION public.station_parcel_agency_code(p_station_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_name text;
BEGIN
  SELECT btrim(coalesce(s.agency_code, '')), s.name INTO v_code, v_name
  FROM public.stations s WHERE s.id = p_station_id;
  IF v_code IS NULL OR v_code = '' THEN
    RAISE EXCEPTION 'Code agence non défini pour la gare %. Demandez à l''administrateur de le saisir (Gares), puis enregistrez le courrier.', coalesce(v_name, '')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.station_parcel_agency_code(uuid) FROM PUBLIC, anon, authenticated;

-- 5. Référence : date, heure et code complet (unique comme le code)
CREATE OR REPLACE FUNCTION public.generate_parcel_reference(p_code varchar)
RETURNS varchar(50)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  now_ts timestamptz := now();
BEGIN
  RETURN
    TO_CHAR(now_ts, 'MM') || '/' ||
    TO_CHAR(now_ts, 'DD') || '-' ||
    TO_CHAR(now_ts, 'HH24') || TO_CHAR(now_ts, 'MI') || '-' ||
    p_code;
END;
$$;

-- 6. Déclencheur : code agence de la gare + numéro suivant (même déclencheur
--    trg_auto_fill_parcel_codes, BEFORE INSERT ; lien de suivi et numéro du jour inchangés)
CREATE OR REPLACE FUNCTION public.auto_fill_parcel_codes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code    text;
  v_app_url text := 'https://sbta-gestion.cloud';
BEGIN
  -- Code déjà fourni (courrier créé hors ligne) : conservé, seul le reste est complété
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

  v_code := public.next_parcel_code(public.station_parcel_agency_code(NEW.origin_station_id));

  NEW.parcel_code    := v_code;
  NEW.reference      := generate_parcel_reference(v_code);
  NEW.daily_sequence := get_daily_sequence(NEW.origin_station_id);
  NEW.tracking_url   := v_app_url || '/track/' || v_code;
  RETURN NEW;
END;
$$;

-- 7. Numéros réservés par un poste pour enregistrer des courriers sans réseau
CREATE OR REPLACE FUNCTION public.reserve_parcel_codes(p_station_id uuid, p_count integer)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency text;
  v_codes  text[] := ARRAY[]::text[];
  v_count  integer := LEAST(GREATEST(coalesce(p_count, 0), 1), 100);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;
  v_agency := public.station_parcel_agency_code(p_station_id);
  FOR i IN 1..v_count LOOP
    v_codes := v_codes || public.next_parcel_code(v_agency);
  END LOOP;
  RETURN v_codes;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_parcel_codes(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_parcel_codes(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
