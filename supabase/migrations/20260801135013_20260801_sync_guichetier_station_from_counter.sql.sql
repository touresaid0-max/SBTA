/*
# Sync guichetier station_id from assigned counter

## Problem
Some guichetier users have `station_id = NULL` in the `users` table even though
they are assigned to an active counter (`counters.assigned_user_id`) that belongs
to a station. The POS login flow checks `user.station_id` and rejects the user
with "Aucune gare assignée à ce compte" before the counter is ever consulted.

## Fix
1. Backfill `users.station_id` for all guichetiers whose station is NULL but who
   have an active counter assigned — take the station from that counter.
2. This is a one-time data repair; the login code is also patched to use the
   counter's station as a fallback so the problem cannot recur for new users.

## Safety
- Only touches rows where `station_id IS NULL` — never overwrites an existing
  assignment.
- Only affects users with role `guichetier`.
- Read-only for all other roles.
*/

UPDATE users u
SET station_id = c.station_id,
    updated_at = now()
FROM counters c
WHERE c.assigned_user_id = u.id
  AND c.is_active = true
  AND c.station_id IS NOT NULL
  AND u.role = 'guichetier'
  AND u.station_id IS NULL;
