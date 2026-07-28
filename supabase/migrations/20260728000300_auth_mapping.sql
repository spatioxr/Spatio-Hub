-- HRMS-006 migration 003: map pre-created Auth users to employee profiles.
-- It is safe when no matching Auth user exists; the app can claim its own
-- unlinked profile by verified email at first sign-in.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(email)
    FROM public.employees
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate employee emails must be resolved before Auth mapping.';
  END IF;
END
$$;

UPDATE public.employees AS employee
SET auth_id = auth_user.id
FROM auth.users AS auth_user
WHERE employee.auth_id IS NULL
  AND lower(employee.email) = lower(auth_user.email);

COMMIT;
