-- Add FK constraints so PostgREST can resolve the company join in leave/permission queries.
-- company_id is nullable, so the FK allows NULL values.

ALTER TABLE leave_requests
  ADD CONSTRAINT fk_leave_requests_company
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE permission_requests
  ADD CONSTRAINT fk_permission_requests_company
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE leave_alerts
  ADD CONSTRAINT fk_leave_alerts_company
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
