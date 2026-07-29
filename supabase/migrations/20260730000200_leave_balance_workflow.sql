-- HRMS-033: make leave decisions and balance changes atomic and idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.requested_leave_days(
  leave_from DATE,
  leave_to DATE,
  is_half_day BOOLEAN DEFAULT false
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
BEGIN
  IF leave_from IS NULL OR leave_to IS NULL OR leave_to < leave_from THEN
    RAISE EXCEPTION 'Choose a valid leave date range';
  END IF;

  IF is_half_day THEN
    IF leave_from <> leave_to THEN
      RAISE EXCEPTION 'Half-day leave must start and end on the same date';
    END IF;
    RETURN 0.5;
  END IF;

  RETURN (leave_to - leave_from + 1)::numeric;
END;
$$;

-- Forward declaration so submit_leave_request can resolve the atomic decision
-- function while this migration is being compiled. The complete body replaces
-- this declaration below before the transaction commits.
CREATE OR REPLACE FUNCTION public.decide_leave_request(
  target_leave_id UUID,
  approve BOOLEAN,
  decision_comment TEXT DEFAULT NULL
)
RETURNS public.leaves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Leave decision workflow is not ready';
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_leave_request(
  leave_type TEXT,
  leave_from DATE,
  leave_to DATE,
  is_half_day BOOLEAN,
  leave_reason TEXT
)
RETURNS public.leaves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  actor_role TEXT;
  requested_days NUMERIC;
  created_leave public.leaves;
BEGIN
  actor_employee_id := public.current_employee_id();
  actor_role := public.current_employee_role();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF leave_type NOT IN ('Sick Leave', 'Casual Leave', 'Comp Off') THEN
    RAISE EXCEPTION 'Unsupported leave type';
  END IF;

  IF COALESCE(length(btrim(leave_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'Leave reason is required';
  END IF;

  requested_days := public.requested_leave_days(
    leave_from,
    leave_to,
    is_half_day
  );

  INSERT INTO public.leaves (
    employee_id,
    type,
    from_date,
    to_date,
    days,
    reason,
    status
  )
  VALUES (
    actor_employee_id,
    leave_type,
    leave_from,
    leave_to,
    requested_days,
    btrim(leave_reason),
    'Pending'
  )
  RETURNING * INTO created_leave;

  IF actor_role = 'superadmin' THEN
    created_leave := public.decide_leave_request(
      created_leave.id,
      true,
      NULL
    );
  END IF;

  RETURN created_leave;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_pending_leave_request(
  target_leave_id UUID,
  leave_type TEXT,
  leave_from DATE,
  leave_to DATE,
  is_half_day BOOLEAN,
  leave_reason TEXT
)
RETURNS public.leaves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  updated_leave public.leaves;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF leave_type NOT IN ('Sick Leave', 'Casual Leave', 'Comp Off') THEN
    RAISE EXCEPTION 'Unsupported leave type';
  END IF;

  IF COALESCE(length(btrim(leave_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'Leave reason is required';
  END IF;

  UPDATE public.leaves
  SET type = leave_type,
      from_date = leave_from,
      to_date = leave_to,
      days = public.requested_leave_days(
        leave_from,
        leave_to,
        is_half_day
      ),
      reason = btrim(leave_reason)
  WHERE id = target_leave_id
    AND employee_id = actor_employee_id
    AND status = 'Pending'
  RETURNING * INTO updated_leave;

  IF updated_leave.id IS NULL THEN
    RAISE EXCEPTION 'Pending leave request not found';
  END IF;

  RETURN updated_leave;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_leave_request(
  target_leave_id UUID,
  approve BOOLEAN,
  decision_comment TEXT DEFAULT NULL
)
RETURNS public.leaves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_leave public.leaves;
  available_days NUMERIC;
  decided_leave public.leaves;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only a superadmin can decide leave requests';
  END IF;

  SELECT leave_row.*
  INTO target_leave
  FROM public.leaves leave_row
  WHERE leave_row.id = target_leave_id
  FOR UPDATE;

  IF target_leave.id IS NULL THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF target_leave.status <> 'Pending' THEN
    RAISE EXCEPTION 'Leave request has already been decided';
  END IF;

  IF approve THEN
    SELECT CASE target_leave.type
      WHEN 'Sick Leave' THEN balance.sick_leave
      WHEN 'Casual Leave' THEN balance.casual_leave
      WHEN 'Comp Off' THEN balance.comp_off
      ELSE NULL
    END
    INTO available_days
    FROM public.leave_balances balance
    WHERE balance.employee_id = target_leave.employee_id
    FOR UPDATE;

    IF available_days IS NULL THEN
      RAISE EXCEPTION 'Leave balance not found';
    END IF;

    IF target_leave.days > available_days THEN
      RAISE EXCEPTION 'Insufficient % balance', target_leave.type;
    END IF;

    UPDATE public.leave_balances
    SET sick_leave = CASE
          WHEN target_leave.type = 'Sick Leave'
            THEN sick_leave - target_leave.days
          ELSE sick_leave
        END,
        casual_leave = CASE
          WHEN target_leave.type = 'Casual Leave'
            THEN casual_leave - target_leave.days
          ELSE casual_leave
        END,
        comp_off = CASE
          WHEN target_leave.type = 'Comp Off'
            THEN comp_off - target_leave.days
          ELSE comp_off
        END,
        updated_at = statement_timestamp()
    WHERE employee_id = target_leave.employee_id;

    UPDATE public.leaves
    SET status = 'Approved',
        rejection_comment = NULL
    WHERE id = target_leave.id
    RETURNING * INTO decided_leave;
  ELSE
    UPDATE public.leaves
    SET status = 'Rejected',
        rejection_comment = NULLIF(btrim(decision_comment), '')
    WHERE id = target_leave.id
    RETURNING * INTO decided_leave;
  END IF;

  RETURN decided_leave;
END;
$$;

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

-- Preserve the policy topology while closing direct client mutation paths.
DROP POLICY "leaves_insert_own" ON public.leaves;
CREATE POLICY "leaves_insert_own"
  ON public.leaves FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY "leaves_update_superadmin" ON public.leaves;
CREATE POLICY "leaves_update_superadmin"
  ON public.leaves FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY "leave_balances_write_superadmin" ON public.leave_balances;
CREATE POLICY "leave_balances_write_superadmin"
  ON public.leave_balances FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON FUNCTION public.requested_leave_days(DATE, DATE, BOOLEAN)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_leave_request(TEXT, DATE, DATE, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_pending_leave_request(UUID, TEXT, DATE, DATE, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_leave_request(UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_comp_off_balance(UUID, NUMERIC)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.requested_leave_days(DATE, DATE, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_leave_request(TEXT, DATE, DATE, BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pending_leave_request(UUID, TEXT, DATE, DATE, BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_leave_request(UUID, BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_comp_off_balance(UUID, NUMERIC)
  TO authenticated;

COMMIT;
