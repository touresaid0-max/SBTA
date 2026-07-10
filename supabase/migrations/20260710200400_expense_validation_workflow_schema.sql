/*
# Expense Validation Workflow for TST, ETL, SNT

## Overview
Adds a validation workflow for vehicle expenses specific to companies TST, ETL, and SNT.
Expenses created by comptables in these companies start as 'en_attente' and must be
explicitly validated before appearing in Gestionnaire/DAF reports.

## Schema Changes
1. New column `validation_status` on `vehicle_expenses`:
   - Type: text with CHECK constraint ('en_attente', 'validee')
   - Default: 'validee' (backward-compatible — existing + other companies unaffected)
   - Index for efficient filtering

2. New columns `validated_at` and `validated_by` for audit trail

## Important Notes
- Other companies (not TST/ETL/SNT) continue operating as before — their expenses
  default to 'validee' instantly.
- Only expenses with validation_status = 'validee' are counted in Gestionnaire and DAF reports.
- The comptable UI will set 'en_attente' for TST/ETL/SNT at creation time.
*/

-- Add validation_status column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_expenses' AND column_name = 'validation_status'
  ) THEN
    ALTER TABLE public.vehicle_expenses
      ADD COLUMN validation_status text NOT NULL DEFAULT 'validee';
  END IF;
END $$;

-- Add CHECK constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'vehicle_expenses' AND constraint_name = 'vehicle_expenses_validation_status_check'
  ) THEN
    ALTER TABLE public.vehicle_expenses
      ADD CONSTRAINT vehicle_expenses_validation_status_check
      CHECK (validation_status IN ('en_attente', 'validee'));
  END IF;
END $$;

-- Add validated_at column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_expenses' AND column_name = 'validated_at'
  ) THEN
    ALTER TABLE public.vehicle_expenses ADD COLUMN validated_at timestamptz;
  END IF;
END $$;

-- Add validated_by column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_expenses' AND column_name = 'validated_by'
  ) THEN
    ALTER TABLE public.vehicle_expenses ADD COLUMN validated_by uuid REFERENCES auth.users(id);
  END IF;
END $$;

-- Index for filtering by validation_status
CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_validation_status
  ON public.vehicle_expenses(validation_status);
