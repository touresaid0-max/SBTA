/*
# Stagiaire : une nature de contrat, plus un type de contrat

Demande RH (11/11/2026) : à l'enregistrement d'un employé, « Stagiaire » se choisit dans
« Nature du contrat » (avec CDI et CDD), plus dans « Type de contrat » (titulaire, contractuel).

1. La nature du contrat accepte STAGE (affiché « Stagiaire ») sur employees et users.
2. Les employés déjà enregistrés comme stagiaires (type de contrat « stagiaire ») reçoivent la
   nature STAGE s'ils n'en ont pas. Leur type de contrat n'est pas changé : la RH le reclasse en
   titulaire ou contractuel en ouvrant leur fiche (l'ancien choix y reste affiché « à reclasser »).
   La valeur « stagiaire » reste acceptée pour ces fiches.
*/

-- Every CHECK on contract_nature is removed, whatever its name, then the new one is added
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conrelid::regclass AS tbl, con.conname
    FROM pg_constraint con
    WHERE con.contype = 'c'
      AND con.conrelid IN ('public.employees'::regclass, 'public.users'::regclass)
      AND pg_get_constraintdef(con.oid) ILIKE '%contract_nature%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE public.employees ADD CONSTRAINT employees_contract_nature_check
  CHECK (contract_nature IN ('CDI', 'CDD', 'STAGE'));
ALTER TABLE public.users ADD CONSTRAINT users_contract_nature_check
  CHECK (contract_nature IN ('CDI', 'CDD', 'STAGE'));

UPDATE public.employees SET contract_nature = 'STAGE'
WHERE contract_type = 'stagiaire' AND contract_nature IS NULL;

UPDATE public.users SET contract_nature = 'STAGE'
WHERE contract_type = 'stagiaire' AND contract_nature IS NULL;
