/*
# Add audit triggers for critical tables

1. New Function
  - `audit_critical_table()`: Generic SECURITY DEFINER trigger function that logs
    INSERT, UPDATE, DELETE operations on any attached table into `activity_logs`.
    Captures the authenticated user (auth.uid()), the table name, target row ID,
    operation type, and old/new JSON values.

2. Tables with new audit triggers
  - `reservations` (ticket sales) - INSERT, UPDATE, DELETE
  - `counter_charges` (guichet charges) - INSERT, UPDATE, DELETE
  - `schedules` (route schedules) - INSERT, UPDATE, DELETE
  - `employees` (HR employee records) - INSERT, UPDATE, DELETE
  - `pay_slips` (payroll bulletins) - INSERT, UPDATE
  - `fuel_vouchers` (fuel management) - INSERT, UPDATE
  - `buses` (fleet changes) - UPDATE
  - `bus_expenses` (expense entries) - INSERT, UPDATE, DELETE
  - `counter_shifts` (shift tracking) - INSERT, UPDATE
  - `maintenance_work_orders` (garage work orders) - INSERT, UPDATE
  - `user_sessions` (login/logout tracking) - INSERT, UPDATE
  - `counters` (counter assignments) - UPDATE
  - `breakdown_reports` (bus breakdowns) - INSERT, UPDATE

3. Security
  - Function is SECURITY DEFINER with search_path = 'public' for safe execution.
  - No RLS changes needed; activity_logs already has appropriate policies.

4. Notes
  - Uses TG_TABLE_NAME to auto-detect the source table.
  - Captures full old/new row as JSONB for maximum traceability.
  - Existing triggers on `users` (role_change, suspension) and `parcels` are preserved.
*/

-- Generic audit function
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
    _old := to_jsonb(OLD);
    _new := to_jsonb(NEW);
    _desc := 'Modification dans ' || TG_TABLE_NAME;
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

-- reservations
DROP TRIGGER IF EXISTS trg_audit_reservations ON reservations;
CREATE TRIGGER trg_audit_reservations
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- counter_charges
DROP TRIGGER IF EXISTS trg_audit_counter_charges ON counter_charges;
CREATE TRIGGER trg_audit_counter_charges
  AFTER INSERT OR UPDATE OR DELETE ON counter_charges
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- schedules
DROP TRIGGER IF EXISTS trg_audit_schedules ON schedules;
CREATE TRIGGER trg_audit_schedules
  AFTER INSERT OR UPDATE OR DELETE ON schedules
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- employees
DROP TRIGGER IF EXISTS trg_audit_employees ON employees;
CREATE TRIGGER trg_audit_employees
  AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- pay_slips
DROP TRIGGER IF EXISTS trg_audit_pay_slips ON pay_slips;
CREATE TRIGGER trg_audit_pay_slips
  AFTER INSERT OR UPDATE ON pay_slips
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- fuel_vouchers
DROP TRIGGER IF EXISTS trg_audit_fuel_vouchers ON fuel_vouchers;
CREATE TRIGGER trg_audit_fuel_vouchers
  AFTER INSERT OR UPDATE ON fuel_vouchers
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- buses
DROP TRIGGER IF EXISTS trg_audit_buses ON buses;
CREATE TRIGGER trg_audit_buses
  AFTER UPDATE ON buses
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- bus_expenses
DROP TRIGGER IF EXISTS trg_audit_bus_expenses ON bus_expenses;
CREATE TRIGGER trg_audit_bus_expenses
  AFTER INSERT OR UPDATE OR DELETE ON bus_expenses
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- counter_shifts
DROP TRIGGER IF EXISTS trg_audit_counter_shifts ON counter_shifts;
CREATE TRIGGER trg_audit_counter_shifts
  AFTER INSERT OR UPDATE ON counter_shifts
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- maintenance_work_orders
DROP TRIGGER IF EXISTS trg_audit_maintenance_work_orders ON maintenance_work_orders;
CREATE TRIGGER trg_audit_maintenance_work_orders
  AFTER INSERT OR UPDATE ON maintenance_work_orders
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- user_sessions
DROP TRIGGER IF EXISTS trg_audit_user_sessions ON user_sessions;
CREATE TRIGGER trg_audit_user_sessions
  AFTER INSERT OR UPDATE ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- counters
DROP TRIGGER IF EXISTS trg_audit_counters ON counters;
CREATE TRIGGER trg_audit_counters
  AFTER UPDATE ON counters
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();

-- breakdown_reports
DROP TRIGGER IF EXISTS trg_audit_breakdown_reports ON breakdown_reports;
CREATE TRIGGER trg_audit_breakdown_reports
  AFTER INSERT OR UPDATE ON breakdown_reports
  FOR EACH ROW EXECUTE FUNCTION audit_critical_table();
