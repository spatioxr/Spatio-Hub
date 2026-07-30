-- HRMS-034: enforce non-overlapping active leave requests at the database boundary.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_leave_request_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.status, '') <> 'Rejected'
    AND EXISTS (
      SELECT 1
      FROM public.leaves existing
      WHERE existing.employee_id = NEW.employee_id
        AND existing.id <> NEW.id
        AND existing.status <> 'Rejected'
        AND NEW.from_date <= existing.to_date
        AND NEW.to_date >= existing.from_date
    )
  THEN
    RAISE EXCEPTION 'An active leave request already overlaps these dates';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leaves_prevent_active_overlap ON public.leaves;
CREATE TRIGGER leaves_prevent_active_overlap
BEFORE INSERT OR UPDATE OF employee_id, from_date, to_date, status
ON public.leaves
FOR EACH ROW
EXECUTE FUNCTION public.enforce_leave_request_overlap();

REVOKE ALL ON FUNCTION public.enforce_leave_request_overlap()
  FROM PUBLIC, anon, authenticated;

COMMIT;
