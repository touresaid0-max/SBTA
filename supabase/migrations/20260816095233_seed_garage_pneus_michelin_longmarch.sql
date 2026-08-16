/*
# Seed garage_pneus with sample tire data

1. Purpose
   - Populate the garage_pneus table with realistic sample data for both
     MICHELIN and LONG-MARCH tire types so the Gérant Principal reports
     display actual records in their dedicated tabs.

2. Data inserted
   - ~19 MICHELIN tire records across SBTA, TST, ETL, SNT, G-OUMÉ companies
   - ~18 LONG-MARCH tire records across same companies
   - Dates span July and August 2026 (current reporting period)
   - Quantities range from 2-6 per record
   - MICHELIN at 325 000 FCFA unit price, LONG-MARCH at 135 000 FCFA
   - montant is a generated column (quantite * prix_unitaire) - not inserted

3. Important notes
   - groupe_id references the companies table
   - car_id references the buses table
   - Idempotent: only inserts if table is empty
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM garage_pneus LIMIT 1) THEN

    -- ===== MICHELIN TIRES =====
    INSERT INTO garage_pneus (id, date, car_id, groupe_id, type_pneu, quantite, prix_unitaire)
    VALUES
      (gen_random_uuid(), '2026-08-02', 'b1111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111111', 'MICHELIN', 4, 325000),
      (gen_random_uuid(), '2026-08-05', 'b1111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 'MICHELIN', 2, 325000),
      (gen_random_uuid(), '2026-08-08', 'b1111111-1111-1111-1111-111111111117', '11111111-1111-1111-1111-111111111111', 'MICHELIN', 6, 325000),
      (gen_random_uuid(), '2026-08-10', 'b1111111-1111-1111-1111-111111111115', '11111111-1111-1111-1111-111111111111', 'MICHELIN', 2, 325000),
      (gen_random_uuid(), '2026-08-12', 'aaf054de-485a-41e6-9fed-4c8b898f4c4e', '11111111-1111-1111-1111-111111111111', 'MICHELIN', 4, 325000),
      (gen_random_uuid(), '2026-07-15', 'b1111111-1111-1111-1111-111111111116', '11111111-1111-1111-1111-111111111111', 'MICHELIN', 2, 325000),
      (gen_random_uuid(), '2026-07-22', 'c6722b2b-5f19-4c54-b380-2ef3667ca3d5', '11111111-1111-1111-1111-111111111111', 'MICHELIN', 4, 325000),
      (gen_random_uuid(), '2026-08-03', 'bc2d1d49-6e94-4454-9968-401aeebdd812', '22222222-2222-2222-2222-222222222222', 'MICHELIN', 4, 325000),
      (gen_random_uuid(), '2026-08-06', '39fc9446-09f4-4e24-9ec0-d28d057816c5', '22222222-2222-2222-2222-222222222222', 'MICHELIN', 2, 325000),
      (gen_random_uuid(), '2026-08-09', '5f230b3f-64f9-43d2-b59c-5ed9898abb33', '22222222-2222-2222-2222-222222222222', 'MICHELIN', 6, 325000),
      (gen_random_uuid(), '2026-08-14', '488e34d4-c562-4841-85ba-b56ea56c33ff', '22222222-2222-2222-2222-222222222222', 'MICHELIN', 2, 325000),
      (gen_random_uuid(), '2026-07-18', '7b5411c4-4686-41dc-8f77-72f414b1e59b', '22222222-2222-2222-2222-222222222222', 'MICHELIN', 4, 325000),
      (gen_random_uuid(), '2026-08-04', 'af3efa81-56f0-45b7-bceb-5a26de6d02b7', '33333333-3333-3333-3333-333333333333', 'MICHELIN', 2, 325000),
      (gen_random_uuid(), '2026-08-07', '2dfc07cf-df47-4682-948d-7bf434558970', '33333333-3333-3333-3333-333333333333', 'MICHELIN', 4, 325000),
      (gen_random_uuid(), '2026-08-11', '0f95d840-6f31-4b3f-8053-4d3ba31f43a2', '33333333-3333-3333-3333-333333333333', 'MICHELIN', 6, 325000),
      (gen_random_uuid(), '2026-07-25', 'b0f879dd-d2dd-4248-ba0b-cf073a72b7a2', '33333333-3333-3333-3333-333333333333', 'MICHELIN', 2, 325000),
      (gen_random_uuid(), '2026-08-01', 'ae0d01a3-3c17-4356-a3e0-2a2e4a211971', 'fad1e234-2fec-437a-a00a-d152208403ad', 'MICHELIN', 4, 325000),
      (gen_random_uuid(), '2026-08-13', '0964c7ef-e33a-496d-82a5-44e20f6c8f06', 'fad1e234-2fec-437a-a00a-d152208403ad', 'MICHELIN', 2, 325000),
      (gen_random_uuid(), '2026-08-06', '9420f194-171f-4655-8ec4-3d5a4b195e95', 'cd8ae81b-c4d1-4c36-ad96-3b3da59aa84d', 'MICHELIN', 4, 325000);

    -- ===== LONG-MARCH TIRES =====
    INSERT INTO garage_pneus (id, date, car_id, groupe_id, type_pneu, quantite, prix_unitaire)
    VALUES
      (gen_random_uuid(), '2026-08-01', 'b1111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111111', 'LONG-MARCH', 4, 135000),
      (gen_random_uuid(), '2026-08-04', 'b1111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 'LONG-MARCH', 6, 135000),
      (gen_random_uuid(), '2026-08-07', 'b1111111-1111-1111-1111-111111111117', '11111111-1111-1111-1111-111111111111', 'LONG-MARCH', 2, 135000),
      (gen_random_uuid(), '2026-08-10', 'b1111111-1111-1111-1111-111111111115', '11111111-1111-1111-1111-111111111111', 'LONG-MARCH', 4, 135000),
      (gen_random_uuid(), '2026-08-14', 'b1111111-1111-1111-1111-111111111118', '11111111-1111-1111-1111-111111111111', 'LONG-MARCH', 2, 135000),
      (gen_random_uuid(), '2026-07-20', 'aaf054de-485a-41e6-9fed-4c8b898f4c4e', '11111111-1111-1111-1111-111111111111', 'LONG-MARCH', 4, 135000),
      (gen_random_uuid(), '2026-08-02', 'bc2d1d49-6e94-4454-9968-401aeebdd812', '22222222-2222-2222-2222-222222222222', 'LONG-MARCH', 6, 135000),
      (gen_random_uuid(), '2026-08-05', '39fc9446-09f4-4e24-9ec0-d28d057816c5', '22222222-2222-2222-2222-222222222222', 'LONG-MARCH', 2, 135000),
      (gen_random_uuid(), '2026-08-09', '5f230b3f-64f9-43d2-b59c-5ed9898abb33', '22222222-2222-2222-2222-222222222222', 'LONG-MARCH', 4, 135000),
      (gen_random_uuid(), '2026-08-12', '488e34d4-c562-4841-85ba-b56ea56c33ff', '22222222-2222-2222-2222-222222222222', 'LONG-MARCH', 2, 135000),
      (gen_random_uuid(), '2026-07-28', '7b5411c4-4686-41dc-8f77-72f414b1e59b', '22222222-2222-2222-2222-222222222222', 'LONG-MARCH', 6, 135000),
      (gen_random_uuid(), '2026-08-03', 'af3efa81-56f0-45b7-bceb-5a26de6d02b7', '33333333-3333-3333-3333-333333333333', 'LONG-MARCH', 4, 135000),
      (gen_random_uuid(), '2026-08-08', '2dfc07cf-df47-4682-948d-7bf434558970', '33333333-3333-3333-3333-333333333333', 'LONG-MARCH', 2, 135000),
      (gen_random_uuid(), '2026-08-11', '0f95d840-6f31-4b3f-8053-4d3ba31f43a2', '33333333-3333-3333-3333-333333333333', 'LONG-MARCH', 6, 135000),
      (gen_random_uuid(), '2026-07-19', 'b0f879dd-d2dd-4248-ba0b-cf073a72b7a2', '33333333-3333-3333-3333-333333333333', 'LONG-MARCH', 4, 135000),
      (gen_random_uuid(), '2026-08-06', 'ae0d01a3-3c17-4356-a3e0-2a2e4a211971', 'fad1e234-2fec-437a-a00a-d152208403ad', 'LONG-MARCH', 2, 135000),
      (gen_random_uuid(), '2026-08-15', '0964c7ef-e33a-496d-82a5-44e20f6c8f06', 'fad1e234-2fec-437a-a00a-d152208403ad', 'LONG-MARCH', 4, 135000),
      (gen_random_uuid(), '2026-08-04', '9420f194-171f-4655-8ec4-3d5a4b195e95', 'cd8ae81b-c4d1-4c36-ad96-3b3da59aa84d', 'LONG-MARCH', 4, 135000),
      (gen_random_uuid(), '2026-08-13', '9420f194-171f-4655-8ec4-3d5a4b195e95', 'cd8ae81b-c4d1-4c36-ad96-3b3da59aa84d', 'LONG-MARCH', 2, 135000);

  END IF;
END $$;
