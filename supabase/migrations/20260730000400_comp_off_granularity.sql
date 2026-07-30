-- HRMS-035: keep Comp Off grants aligned to whole-day and half-day leave units.

BEGIN;

CREATE OR REPLACE FUNCTION public.grant_comp_off_balance(
  target_employee_id UUID,
  days_to_add NUMERIC
)
RETURNS public.leave_balances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_balance public.leave_balances;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only a superadmin can grant Comp Off';
  END IF;

  IF days_to_add IS NULL OR days_to_add <= 0 THEN
    RAISE EXCEPTION 'Comp Off grant must be positive';
  END IF;

  IF mod(days_to_add, 0.5) <> 0 THEN
    RAISE EXCEPTION 'Comp Off grant must use half-day increments';
  END IF;

  UPDATE public.leave_balances
  SET comp_off = comp_off + days_to_add,
      updated_at = statement_timestamp()
  WHERE employee_id = target_employee_id
  RETURNING * INTO updated_balance;

  IF updated_balance.employee_id IS NULL THEN
    RAISE EXCEPTION 'Leave balance not found';
  END IF;

  RETURN updated_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_comp_off_balance(UUID, NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_comp_off_balance(UUID, NUMERIC)
  TO authenticated;

COMMIT;
