-- ═══════════════════════════════════════════════════════════════════
-- Leave Ceiling table — individual annual leave quota per employee
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS leave_ceilings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL,
  employee_name   text NOT NULL DEFAULT '',
  company_id      uuid,
  company_name    text,
  motif           text,
  year            integer NOT NULL DEFAULT EXTRACT(YEAR FROM now())::int,
  ceiling_days    integer NOT NULL,
  effective_date  date NOT NULL DEFAULT CURRENT_DATE,
  observations    text,
  status          text NOT NULL DEFAULT 'actif' CHECK (status IN ('actif', 'inactif')),
  created_by      uuid,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leave_ceilings_employee ON leave_ceilings(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_ceilings_year ON leave_ceilings(year);
CREATE INDEX IF NOT EXISTS idx_leave_ceilings_company ON leave_ceilings(company_id);
CREATE INDEX IF NOT EXISTS idx_leave_ceilings_status ON leave_ceilings(status);

-- Prevent multiple active ceilings for same employee + same year
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_ceiling_per_employee_year
  ON leave_ceilings (employee_id, year)
  WHERE status = 'actif';

-- Enable RLS
ALTER TABLE leave_ceilings ENABLE ROW LEVEL SECURITY;

-- CRUD policies (same pattern as other leave tables: TO authenticated)
CREATE POLICY "rh_select_leave_ceilings" ON leave_ceilings FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "rh_insert_leave_ceilings" ON leave_ceilings FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "rh_update_leave_ceilings" ON leave_ceilings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "rh_delete_leave_ceilings" ON leave_ceilings FOR DELETE
  TO authenticated USING (true);

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
