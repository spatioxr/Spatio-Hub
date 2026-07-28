-- HRMS-003: Retire application-managed employee passwords.
-- Supabase Auth is now the only password authority.
-- This preserves every employee row and all related historical data.

ALTER TABLE public.employees
  DROP COLUMN IF EXISTS password;
