/*
# Enable realtime on employees table

1. Purpose
   Add the `employees` table to the `supabase_realtime` publication so that
   INSERT events are broadcast to subscribed clients. This lets the RH
   Employees page show a live toast notification when a new employee record is
   created automatically by the sync trigger (e.g. when an Admin creates a user).

2. Changes
   - ALTER PUBLICATION supabase_realtime ADD TABLE public.employees

3. Security
   No RLS changes. Existing employees policies still govern which rows each
   role can read; realtime only broadcasts rows the client is allowed to see.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;
