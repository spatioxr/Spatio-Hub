-- HRMS-002: Link Supabase Auth identities to existing employee profiles.
-- Create Auth users in the Supabase dashboard before running this script.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS auth_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS employees_auth_id_unique
  ON public.employees (auth_id)
  WHERE auth_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(email)
    FROM public.employees
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate employee emails must be resolved before Auth migration.';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employees_auth_id_fkey'
      AND conrelid = 'public.employees'::regclass
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_auth_id_fkey
      FOREIGN KEY (auth_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

UPDATE public.employees AS employee
SET auth_id = auth_user.id
FROM auth.users AS auth_user
WHERE employee.auth_id IS NULL
  AND lower(employee.email) = lower(auth_user.email);
