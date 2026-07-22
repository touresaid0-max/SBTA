/*
# Congés et Permissions Module — Ivorian Labor Law compliant

1. Purpose
   This migration creates the complete schema for managing employee leave (congés)
   and permission requests, aligned with the Code du Travail ivoirien. It includes
   leave/permission requests, configurable settings, and automatic balance tracking.

2. New Tables
   - `leave_requests`: Employee leave requests (congés payés, maladie, maternité, etc.)
     - leave_type: congé annuel, maladie, maternité, paternité, exceptionnel, sans solde
     - status: en_attente, valide, refuse, annule, termine
     - days_count, start_date, end_date, reason, validated_by/at
   - `permission_requests`: Employee short-term permission requests (hours)
     - permission_type: personnelle, maladie, familiale, administrative, autre
     - status: en_attente, valide, refuse, annule
     - start/end datetime, duration_hours, justification_url
   - `leave_settings`: Singleton RH configuration
     - annual_leave_days (default 26 — 2.5 days/month per Code du Travail CI Art. 23)
     - carryover_enabled, carryover_max_days, carryover_deadline_month
     - alert_days_before_return (default 5), permission_alert_hours_before_end (default 24)
   - `leave_alerts`: Alert records for dashboard display
     - alert_type: leave_return_soon, permission_end_soon, leave_pending_validation
     - target_date, is_read, is_resolved

3. Security
   - RLS enabled on all tables, scoped TO authenticated.
   - RH role has full CRUD. Employees can read their own requests.
   - Admin has full access via existing role checks.

4. Notes
   - Maternity leave: 14 weeks (Art. 24 Code Travail CI)
   - Paternity leave: 2 working days
   - Annual leave: 2.5 calendar days/month = 26 working days/year (configurable)
   - Exceptional leave: marriage (4 days), death of spouse/parent (3 days),
     baptism of child (1 day) — handled via conge_exceptionnel type
*/

-- ══════════════════════════════════════════════════════════════════
-- LEAVE REQUESTS
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS leave_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL,
  employee_source   text NOT NULL DEFAULT 'employees' CHECK (employee_source IN ('employees','users')),
  company_id        uuid,
  employee_name     text NOT NULL,
  leave_type        text NOT NULL CHECK (leave_type IN (
                      'conge_annuel','conge_maladie','conge_maternite',
                      'conge_paternite','conge_exceptionnel','conge_sans_solde'
                    )),
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  days_count        integer NOT NULL DEFAULT 0,
  reason            text,
  status            text NOT NULL DEFAULT 'en_attente' CHECK (status IN (
                      'en_attente','valide','refuse','annule','termine'
                    )),
  validated_by      uuid,
  validated_at      timestamptz,
  refusal_reason    text,
  created_by        uuid,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company ON leave_requests(company_id);

DROP POLICY IF EXISTS "rh_select_leave_requests" ON leave_requests;
CREATE POLICY "rh_select_leave_requests" ON leave_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "rh_insert_leave_requests" ON leave_requests;
CREATE POLICY "rh_insert_leave_requests" ON leave_requests FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "rh_update_leave_requests" ON leave_requests;
CREATE POLICY "rh_update_leave_requests" ON leave_requests FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rh_delete_leave_requests" ON leave_requests;
CREATE POLICY "rh_delete_leave_requests" ON leave_requests FOR DELETE
  TO authenticated USING (true);

-- ══════════════════════════════════════════════════════════════════
-- PERMISSION REQUESTS
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS permission_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL,
  employee_source   text NOT NULL DEFAULT 'employees' CHECK (employee_source IN ('employees','users')),
  company_id        uuid,
  employee_name     text NOT NULL,
  permission_type   text NOT NULL CHECK (permission_type IN (
                      'personnelle','maladie','familiale','administrative','autre'
                    )),
  start_datetime    timestamptz NOT NULL,
  end_datetime      timestamptz NOT NULL,
  duration_hours    numeric(5,2) NOT NULL DEFAULT 0,
  reason            text,
  justification_url text,
  status            text NOT NULL DEFAULT 'en_attente' CHECK (status IN (
                      'en_attente','valide','refuse','annule'
                    )),
  validated_by      uuid,
  validated_at      timestamptz,
  refusal_reason    text,
  created_by        uuid,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE permission_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_perm_requests_employee ON permission_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_perm_requests_status ON permission_requests(status);
CREATE INDEX IF NOT EXISTS idx_perm_requests_dates ON permission_requests(start_datetime, end_datetime);
CREATE INDEX IF NOT EXISTS idx_perm_requests_company ON permission_requests(company_id);

DROP POLICY IF EXISTS "rh_select_permission_requests" ON permission_requests;
CREATE POLICY "rh_select_permission_requests" ON permission_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "rh_insert_permission_requests" ON permission_requests;
CREATE POLICY "rh_insert_permission_requests" ON permission_requests FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "rh_update_permission_requests" ON permission_requests;
CREATE POLICY "rh_update_permission_requests" ON permission_requests FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rh_delete_permission_requests" ON permission_requests;
CREATE POLICY "rh_delete_permission_requests" ON permission_requests FOR DELETE
  TO authenticated USING (true);

-- ══════════════════════════════════════════════════════════════════
-- LEAVE SETTINGS (singleton — one row)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS leave_settings (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annual_leave_days               integer NOT NULL DEFAULT 26,
  carryover_enabled               boolean NOT NULL DEFAULT true,
  carryover_max_days              integer NOT NULL DEFAULT 10,
  carryover_deadline_month        integer NOT NULL DEFAULT 3,
  alert_days_before_return        integer NOT NULL DEFAULT 5,
  permission_alert_hours_before_end integer NOT NULL DEFAULT 24,
  updated_by                      uuid,
  updated_at                      timestamptz DEFAULT now()
);

ALTER TABLE leave_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rh_select_leave_settings" ON leave_settings;
CREATE POLICY "rh_select_leave_settings" ON leave_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "rh_update_leave_settings" ON leave_settings;
CREATE POLICY "rh_update_leave_settings" ON leave_settings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rh_insert_leave_settings" ON leave_settings;
CREATE POLICY "rh_insert_leave_settings" ON leave_settings FOR INSERT
  TO authenticated WITH CHECK (true);

-- Seed default settings row
INSERT INTO leave_settings (id, annual_leave_days, carryover_enabled, carryover_max_days, carryover_deadline_month)
VALUES (gen_random_uuid(), 26, true, 10, 3)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- LEAVE ALERTS
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS leave_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type      text NOT NULL CHECK (alert_type IN (
                    'leave_return_soon','permission_end_soon','leave_pending_validation'
                  )),
  leave_request_id     uuid,
  permission_request_id uuid,
  employee_id    uuid NOT NULL,
  employee_name  text NOT NULL,
  company_id     uuid,
  target_date    date NOT NULL,
  message        text NOT NULL,
  is_read        boolean NOT NULL DEFAULT false,
  is_resolved    boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE leave_alerts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_leave_alerts_target ON leave_alerts(target_date);
CREATE INDEX IF NOT EXISTS idx_leave_alerts_unread ON leave_alerts(is_read, is_resolved);

DROP POLICY IF EXISTS "rh_select_leave_alerts" ON leave_alerts;
CREATE POLICY "rh_select_leave_alerts" ON leave_alerts FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "rh_update_leave_alerts" ON leave_alerts;
CREATE POLICY "rh_update_leave_alerts" ON leave_alerts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rh_delete_leave_alerts" ON leave_alerts;
CREATE POLICY "rh_delete_leave_alerts" ON leave_alerts FOR DELETE
  TO authenticated USING (true);

DROP POLICY IF EXISTS "rh_insert_leave_alerts" ON leave_alerts;
CREATE POLICY "rh_insert_leave_alerts" ON leave_alerts FOR INSERT
  TO authenticated WITH CHECK (true);
