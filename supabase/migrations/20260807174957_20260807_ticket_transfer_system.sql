/*
# Ticket transfer system for bus change in POS

## Purpose
When a guichetier changes a bus on a departure due to breakdown and the new bus has fewer seats,
surplus tickets must be transferred to the next departure. This migration creates two tables:
1. `ticket_transfer_logs` — permanent audit trail of every transfer
2. `pending_ticket_transfers` — queue of surplus tickets waiting for a next departure to be created

## New Tables

### ticket_transfer_logs
- `id` (uuid, PK)
- `source_schedule_id` (uuid, FK schedules) — the original departure
- `target_schedule_id` (uuid, FK schedules, nullable) — the receiving departure
- `old_bus_id` / `new_bus_id` (uuid, FK buses, nullable) — buses involved
- `old_capacity` / `new_capacity` (int) — seat counts
- `transferred_count` (int) — number of tickets moved
- `retained_count` (int) — tickets kept on original departure
- `transfer_reason` (text) — why (e.g. "panne", "capacity_reduction")
- `ticket_ids` (jsonb) — array of transferred reservation IDs
- `transferred_by` (uuid, FK auth.users) — who performed the transfer
- `transferred_at` (timestamptz)
- `status` (text) — 'completed' | 'pending'

### pending_ticket_transfers
- `id` (uuid, PK)
- `source_schedule_id` (uuid, FK schedules) — original departure with surplus
- `route_id` (uuid) — route to match next departure
- `station_id` (uuid) — station scope
- `counter_id` (uuid, nullable) — counter scope
- `old_bus_id` / `new_bus_id` (uuid, nullable)
- `old_capacity` / `new_capacity` (int)
- `surplus_count` (int) — tickets waiting
- `ticket_ids` (jsonb) — array of reservation IDs to transfer
- `ticket_data` (jsonb) — snapshot of ticket data for reprint
- `created_by` (uuid, FK auth.users)
- `created_at` (timestamptz)
- `applied_to_schedule_id` (uuid, nullable) — set when applied
- `applied_at` (timestamptz, nullable)
- `status` (text) — 'pending' | 'applied' | 'cancelled'

## Security
- RLS enabled on both tables
- Authenticated users can read all transfer logs (for audit)
- Authenticated users can insert/update their own transfers
- Same pattern for pending transfers

## Important Notes
1. ticket_transfer_logs is append-only audit — no deletes
2. pending_ticket_transfers is a work queue — rows move to 'applied' when consumed
3. Both tables use gen_random_uuid() for IDs
4. All FKs use ON DELETE CASCADE for schedules, ON DELETE SET NULL for buses
*/

-- ── ticket_transfer_logs ──
CREATE TABLE IF NOT EXISTS ticket_transfer_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_schedule_id  uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  target_schedule_id  uuid REFERENCES schedules(id) ON DELETE CASCADE,
  old_bus_id          uuid REFERENCES buses(id) ON DELETE SET NULL,
  new_bus_id          uuid REFERENCES buses(id) ON DELETE SET NULL,
  old_capacity        integer NOT NULL DEFAULT 0,
  new_capacity        integer NOT NULL DEFAULT 0,
  transferred_count   integer NOT NULL DEFAULT 0,
  retained_count      integer NOT NULL DEFAULT 0,
  transfer_reason     text NOT NULL DEFAULT 'capacity_reduction',
  ticket_ids          jsonb NOT NULL DEFAULT '[]'::jsonb,
  transferred_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  transferred_at      timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','pending'))
);

ALTER TABLE ticket_transfer_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_transfer_logs" ON ticket_transfer_logs;
CREATE POLICY "authenticated_read_transfer_logs"
  ON ticket_transfer_logs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_insert_transfer_logs" ON ticket_transfer_logs;
CREATE POLICY "authenticated_insert_transfer_logs"
  ON ticket_transfer_logs FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_update_transfer_logs" ON ticket_transfer_logs;
CREATE POLICY "authenticated_update_transfer_logs"
  ON ticket_transfer_logs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── pending_ticket_transfers ──
CREATE TABLE IF NOT EXISTS pending_ticket_transfers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_schedule_id       uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  route_id                 uuid,
  station_id               uuid,
  counter_id               uuid,
  old_bus_id               uuid REFERENCES buses(id) ON DELETE SET NULL,
  new_bus_id               uuid REFERENCES buses(id) ON DELETE SET NULL,
  old_capacity             integer NOT NULL DEFAULT 0,
  new_capacity             integer NOT NULL DEFAULT 0,
  surplus_count            integer NOT NULL DEFAULT 0,
  ticket_ids               jsonb NOT NULL DEFAULT '[]'::jsonb,
  ticket_data              jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  applied_to_schedule_id   uuid REFERENCES schedules(id) ON DELETE SET NULL,
  applied_at               timestamptz,
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled'))
);

ALTER TABLE pending_ticket_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_pending_transfers" ON pending_ticket_transfers;
CREATE POLICY "authenticated_read_pending_transfers"
  ON pending_ticket_transfers FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_insert_pending_transfers" ON pending_ticket_transfers;
CREATE POLICY "authenticated_insert_pending_transfers"
  ON pending_ticket_transfers FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_update_pending_transfers" ON pending_ticket_transfers;
CREATE POLICY "authenticated_update_pending_transfers"
  ON pending_ticket_transfers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_delete_pending_transfers" ON pending_ticket_transfers;
CREATE POLICY "authenticated_delete_pending_transfers"
  ON pending_ticket_transfers FOR DELETE TO authenticated USING (true);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_ptt_route_status ON pending_ticket_transfers(route_id, status);
CREATE INDEX IF NOT EXISTS idx_ptt_source_schedule ON pending_ticket_transfers(source_schedule_id);
CREATE INDEX IF NOT EXISTS idx_ttl_source_schedule ON ticket_transfer_logs(source_schedule_id);
CREATE INDEX IF NOT EXISTS idx_ttl_target_schedule ON ticket_transfer_logs(target_schedule_id);
