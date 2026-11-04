/*
# Contrôles côté base : téléphones, montants, dates (audit M10)

Jusqu'ici seule l'interface contrôlait les saisies : un écran oublié, une ancienne
version de l'application ou un appel direct à l'API enregistrait n'importe quoi.

## Téléphones (règle ivoirienne : 10 chiffres, 01/05/07/21/25/27, enregistrés « 225 » + 10 chiffres)
- `normalize_phone_ci(text)` : remet un numéro valide au format unique (espaces, points,
  +225 / 00225 retirés) ; renvoie '' pour une valeur vide et NULL pour un numéro invalide.
- Courriers (`parcels` : expéditeur, destinataire, personne qui retire) : numéro valide
  remis au format unique, numéro invalide REFUSÉ.
- Bagages (`baggage_tickets.owner_phone`) : numéro valide remis au format unique, numéro
  invalide VIDÉ. Plusieurs écrans écrivent dans cette table (guichet, TPE, bagagiste, vente
  en ligne) : une vente ne doit jamais être bloquée par un numéro mal tapé.

## Montants
- Jamais négatifs : prix des tickets et des bagages, dépenses du guichet, frais et valeur
  déclarée des courriers.

## Dates
- Dépenses du guichet (`counter_charges.charge_date`) : pas plus d'un jour dans le futur,
  pas plus d'un an dans le passé (l'écran est plus strict : aujourd'hui à 30 jours ; la base
  laisse passer les opérations restées longtemps dans une file d'envoi).

## Pourquoi des déclencheurs et pas des contraintes CHECK
Une contrainte CHECK est revérifiée à CHAQUE modification de la ligne, même avec NOT VALID :
un ancien courrier au numéro invalide n'aurait plus pu changer de statut. Les déclencheurs
ne contrôlent une valeur que lorsqu'elle est saisie ou modifiée ; les données existantes ne
sont ni modifiées ni bloquées.

Les refus portent le code 23514 (check_violation) : les files d'envoi de l'application les
classent comme refus définitifs (pas de nouvel essai sans fin).
*/

-- ── Téléphones ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_phone_ci(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  d := regexp_replace(p_value, '\D', '', 'g');
  IF d = '' THEN
    RETURN '';
  END IF;
  IF d LIKE '00225%' THEN
    d := substr(d, 6);
  ELSIF d LIKE '225%' AND length(d) = 13 THEN
    d := substr(d, 4);
  END IF;
  IF d ~ '^(01|05|07|21|25|27)[0-9]{8}$' THEN
    RETURN '225' || d;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.normalize_phone_ci(text) IS
  'Numéro ivoirien au format 225 + 10 chiffres ; '''' si vide ; NULL si invalide (audit M10).';

CREATE OR REPLACE FUNCTION public.parcels_check_phones()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v text;
BEGIN
  -- Expéditeur
  IF TG_OP = 'INSERT' OR NEW.sender_phone IS DISTINCT FROM OLD.sender_phone THEN
    v := public.normalize_phone_ci(NEW.sender_phone);
    IF NEW.sender_phone IS NOT NULL AND v IS NULL THEN
      RAISE EXCEPTION 'Téléphone de l''expéditeur invalide : « % » (10 chiffres commençant par 01, 05, 07, 21, 25 ou 27)', NEW.sender_phone
        USING ERRCODE = '23514';
    END IF;
    NEW.sender_phone := v;
  END IF;

  -- Destinataire
  IF TG_OP = 'INSERT' OR NEW.recipient_phone IS DISTINCT FROM OLD.recipient_phone THEN
    v := public.normalize_phone_ci(NEW.recipient_phone);
    IF NEW.recipient_phone IS NOT NULL AND v IS NULL THEN
      RAISE EXCEPTION 'Téléphone du destinataire invalide : « % » (10 chiffres commençant par 01, 05, 07, 21, 25 ou 27)', NEW.recipient_phone
        USING ERRCODE = '23514';
    END IF;
    NEW.recipient_phone := v;
  END IF;

  -- Personne qui retire le courrier
  IF TG_OP = 'INSERT' OR NEW.delivery_recipient_phone IS DISTINCT FROM OLD.delivery_recipient_phone THEN
    v := public.normalize_phone_ci(NEW.delivery_recipient_phone);
    IF NEW.delivery_recipient_phone IS NOT NULL AND v IS NULL THEN
      RAISE EXCEPTION 'Téléphone de la personne qui retire invalide : « % » (10 chiffres commençant par 01, 05, 07, 21, 25 ou 27)', NEW.delivery_recipient_phone
        USING ERRCODE = '23514';
    END IF;
    NEW.delivery_recipient_phone := NULLIF(v, '');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_parcels_check_phones ON public.parcels;
CREATE TRIGGER trg_parcels_check_phones
  BEFORE INSERT OR UPDATE OF sender_phone, recipient_phone, delivery_recipient_phone ON public.parcels
  FOR EACH ROW EXECUTE FUNCTION public.parcels_check_phones();

CREATE OR REPLACE FUNCTION public.baggage_normalize_owner_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.owner_phone IS DISTINCT FROM OLD.owner_phone THEN
    -- Invalide → vide : la vente du bagage n'est jamais bloquée par le numéro
    NEW.owner_phone := COALESCE(public.normalize_phone_ci(NEW.owner_phone), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_baggage_normalize_owner_phone ON public.baggage_tickets;
CREATE TRIGGER trg_baggage_normalize_owner_phone
  BEFORE INSERT OR UPDATE OF owner_phone ON public.baggage_tickets
  FOR EACH ROW EXECUTE FUNCTION public.baggage_normalize_owner_phone();

-- ── Montants ──────────────────────────────────────────────────────────────────

-- Colonnes à contrôler passées en arguments du déclencheur ; une colonne absente de la
-- table est ignorée. Seule une valeur saisie ou modifiée est contrôlée.
CREATE OR REPLACE FUNCTION public.reject_negative_amounts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  col text;
  new_row jsonb := to_jsonb(NEW);
  old_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  v numeric;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF NOT (new_row ? col) THEN
      CONTINUE;
    END IF;
    IF TG_OP = 'UPDATE' AND (new_row -> col) IS NOT DISTINCT FROM (old_row -> col) THEN
      CONTINUE;
    END IF;
    v := NULLIF(new_row ->> col, '')::numeric;
    IF v < 0 THEN
      RAISE EXCEPTION 'Montant négatif refusé (%) : %', col, v USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservations_amounts ON public.reservations;
CREATE TRIGGER trg_reservations_amounts
  BEFORE INSERT OR UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.reject_negative_amounts('total_price');

DROP TRIGGER IF EXISTS trg_baggage_tickets_amounts ON public.baggage_tickets;
CREATE TRIGGER trg_baggage_tickets_amounts
  BEFORE INSERT OR UPDATE ON public.baggage_tickets
  FOR EACH ROW EXECUTE FUNCTION public.reject_negative_amounts('price', 'declared_value');

DROP TRIGGER IF EXISTS trg_counter_charges_amounts ON public.counter_charges;
CREATE TRIGGER trg_counter_charges_amounts
  BEFORE INSERT OR UPDATE ON public.counter_charges
  FOR EACH ROW EXECUTE FUNCTION public.reject_negative_amounts('amount');

DROP TRIGGER IF EXISTS trg_parcels_amounts ON public.parcels;
CREATE TRIGGER trg_parcels_amounts
  BEFORE INSERT OR UPDATE ON public.parcels
  FOR EACH ROW EXECUTE FUNCTION public.reject_negative_amounts('declared_value', 'delivery_fee', 'sms_tracking_fee');

-- ── Dates ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.counter_charges_check_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- Heure de la Côte d'Ivoire (UTC)
  today date := (now() AT TIME ZONE 'Africa/Abidjan')::date;
BEGIN
  IF NEW.charge_date IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.charge_date IS NOT DISTINCT FROM OLD.charge_date THEN
    RETURN NEW;
  END IF;
  IF NEW.charge_date > today + 1 THEN
    RAISE EXCEPTION 'Date de dépense dans le futur refusée : %', NEW.charge_date USING ERRCODE = '23514';
  END IF;
  IF NEW.charge_date < today - 365 THEN
    RAISE EXCEPTION 'Date de dépense trop ancienne (plus d''un an) : %', NEW.charge_date USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_counter_charges_check_date ON public.counter_charges;
CREATE TRIGGER trg_counter_charges_check_date
  BEFORE INSERT OR UPDATE OF charge_date ON public.counter_charges
  FOR EACH ROW EXECUTE FUNCTION public.counter_charges_check_date();
