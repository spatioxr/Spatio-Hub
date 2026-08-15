-- HRMS-048/051/052: define one auditable Attendance and Leave administration model.
-- Existing leave_balances rows remain as a compatibility cache; the immutable
-- transaction ledger is the source of explanation for every future change.

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS is_leave_admin BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.leaves
  ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.leave_balance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  leave_type TEXT NOT NULL
    CHECK (leave_type IN ('Sick Leave', 'Casual Leave', 'Comp Off')),
  amount NUMERIC NOT NULL
    CHECK (amount <> 0 AND mod(amount, 0.5) = 0),
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('opening', 'adjustment', 'leave_approval', 'reversal')),
  source_leave_id UUID REFERENCES public.leaves(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK (
    (transaction_type = 'leave_approval' AND source_leave_id IS NOT NULL AND amount < 0)
    OR transaction_type <> 'leave_approval'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_balance_transactions_opening_unique
  ON public.leave_balance_transactions (employee_id, leave_type)
  WHERE transaction_type = 'opening';

CREATE UNIQUE INDEX IF NOT EXISTS leave_balance_transactions_approval_unique
  ON public.leave_balance_transactions (source_leave_id)
  WHERE transaction_type = 'leave_approval';

CREATE INDEX IF NOT EXISTS leave_balance_transactions_employee_created_idx
  ON public.leave_balance_transactions (employee_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_leave_balance_transaction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Leave balance history is immutable';
END;
$$;

DROP TRIGGER IF EXISTS leave_balance_transactions_prevent_mutation
  ON public.leave_balance_transactions;
CREATE TRIGGER leave_balance_transactions_prevent_mutation
BEFORE UPDATE OR DELETE ON public.leave_balance_transactions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_leave_balance_transaction_mutation();

INSERT INTO public.leave_balance_transactions (
  employee_id,
  leave_type,
  amount,
  transaction_type,
  reason
)
SELECT balance.employee_id, source.leave_type, source.amount, 'opening',
  'Opening balance preserved at the Attendance and Leave reset'
FROM public.leave_balances balance
CROSS JOIN LATERAL (
  VALUES
    ('Sick Leave'::TEXT, balance.sick_leave),
    ('Casual Leave'::TEXT, balance.casual_leave),
    ('Comp Off'::TEXT, balance.comp_off)
) source(leave_type, amount)
WHERE source.amount <> 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.leave_balance_transactions existing
    WHERE existing.employee_id = balance.employee_id
      AND existing.leave_type = source.leave_type
      AND existing.transaction_type = 'opening'
  );

CREATE OR REPLACE FUNCTION public.seed_leave_balance_opening_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.leave_balance_transactions (
    employee_id,
    leave_type,
    amount,
    transaction_type,
    reason
  )
  SELECT NEW.employee_id, source.leave_type, source.amount, 'opening',
    'Opening balance created with the employee profile'
  FROM (
    VALUES
      ('Sick Leave'::TEXT, NEW.sick_leave),
      ('Casual Leave'::TEXT, NEW.casual_leave),
      ('Comp Off'::TEXT, NEW.comp_off)
  ) source(leave_type, amount)
  WHERE source.amount <> 0
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_balances_seed_opening_transactions
  ON public.leave_balances;
CREATE TRIGGER leave_balances_seed_opening_transactions
AFTER INSERT ON public.leave_balances
FOR EACH ROW
EXECUTE FUNCTION public.seed_leave_balance_opening_transactions();

CREATE TABLE IF NOT EXISTS public.attendance_policy (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  late_after TIME,
  working_weekdays SMALLINT[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::SMALLINT[],
  updated_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK (
    cardinality(working_weekdays) > 0
    AND working_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]
  )
);

INSERT INTO public.attendance_policy (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_manage_leave()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_id = auth.uid()
        AND employee.status = 'Active'
        AND NOT employee.must_change_password
        AND (employee.role = 'superadmin' OR employee.is_leave_admin)
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.set_leave_admin_access(
  target_employee_id UUID,
  enabled BOOLEAN
)
RETURNS public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved_employee public.employees;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only a superadmin can assign Leave Admin access';
  END IF;

  IF COALESCE(enabled, false) AND NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = target_employee_id
      AND employee.status = 'Active'
  ) THEN
    RAISE EXCEPTION 'Leave Admin access can only be assigned to an active employee';
  END IF;

  UPDATE public.employees
  SET is_leave_admin = COALESCE(enabled, false)
  WHERE id = target_employee_id
  RETURNING * INTO saved_employee;

  IF saved_employee.id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  RETURN saved_employee;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_leave_admin_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_leave_admin IS DISTINCT FROM OLD.is_leave_admin
    AND NOT public.is_superadmin()
  THEN
    RAISE EXCEPTION 'Only a superadmin can assign Leave Admin access';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_protect_leave_admin_access ON public.employees;
CREATE TRIGGER employees_protect_leave_admin_access
BEFORE UPDATE OF is_leave_admin ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.protect_leave_admin_access();

CREATE OR REPLACE FUNCTION public.leave_working_days(
  leave_from DATE,
  leave_to DATE,
  is_half_day BOOLEAN DEFAULT false
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  weekdays SMALLINT[];
  counted_days NUMERIC;
BEGIN
  IF leave_from IS NULL OR leave_to IS NULL OR leave_to < leave_from THEN
    RAISE EXCEPTION 'Choose a valid leave date range';
  END IF;

  SELECT policy.working_weekdays
  INTO weekdays
  FROM public.attendance_policy policy
  WHERE policy.singleton;

  weekdays := COALESCE(weekdays, ARRAY[1, 2, 3, 4, 5]::SMALLINT[]);

  IF is_half_day THEN
    IF leave_from <> leave_to THEN
      RAISE EXCEPTION 'Half-day leave must start and end on the same date';
    END IF;

    IF NOT (extract(isodow FROM leave_from)::SMALLINT = ANY(weekdays))
      OR EXISTS (
        SELECT 1 FROM public.holidays holiday WHERE holiday.date = leave_from
      )
    THEN
      RAISE EXCEPTION 'Half-day leave must be on a company working day';
    END IF;

    RETURN 0.5;
  END IF;

  SELECT count(*)::NUMERIC
  INTO counted_days
  FROM generate_series(leave_from, leave_to, INTERVAL '1 day') day_value
  WHERE extract(isodow FROM day_value)::SMALLINT = ANY(weekdays)
    AND NOT EXISTS (
      SELECT 1
      FROM public.holidays holiday
      WHERE holiday.date = day_value::DATE
    );

  IF counted_days = 0 THEN
    RAISE EXCEPTION 'The selected range contains no company working days';
  END IF;

  RETURN counted_days;
END;
$$;

-- Keep the legacy name available for existing callers while moving its rule to
-- the canonical working-day engine.
CREATE OR REPLACE FUNCTION public.requested_leave_days(
  leave_from DATE,
  leave_to DATE,
  is_half_day BOOLEAN DEFAULT false
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.leave_working_days(leave_from, leave_to, is_half_day);
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
  requested_days NUMERIC;
  available_days NUMERIC;
  pending_days NUMERIC;
  created_leave public.leaves;
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

  requested_days := public.leave_working_days(leave_from, leave_to, is_half_day);

  SELECT CASE leave_type
    WHEN 'Sick Leave' THEN balance.sick_leave
    WHEN 'Casual Leave' THEN balance.casual_leave
    WHEN 'Comp Off' THEN balance.comp_off
  END
  INTO available_days
  FROM public.leave_balances balance
  WHERE balance.employee_id = actor_employee_id
  FOR UPDATE;

  IF available_days IS NULL THEN
    RAISE EXCEPTION 'Leave balance not found';
  END IF;

  SELECT COALESCE(sum(request.days), 0)
  INTO pending_days
  FROM public.leaves request
  WHERE request.employee_id = actor_employee_id
    AND request.type = leave_type
    AND request.status = 'Pending';

  IF requested_days + pending_days > available_days THEN
    RAISE EXCEPTION 'Insufficient % balance after pending requests', leave_type;
  END IF;

  INSERT INTO public.leaves (
    employee_id,
    type,
    from_date,
    to_date,
    days,
    reason,
    status,
    decided_by,
    decided_at,
    rejection_comment
  )
  VALUES (
    actor_employee_id,
    leave_type,
    leave_from,
    leave_to,
    requested_days,
    btrim(leave_reason),
    'Pending',
    NULL,
    NULL,
    NULL
  )
  RETURNING * INTO created_leave;

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
  requested_days NUMERIC;
  available_days NUMERIC;
  pending_days NUMERIC;
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.leaves request
    WHERE request.id = target_leave_id
      AND request.employee_id = actor_employee_id
      AND request.status = 'Pending'
  ) THEN
    RAISE EXCEPTION 'Pending leave request not found';
  END IF;

  requested_days := public.leave_working_days(leave_from, leave_to, is_half_day);

  SELECT CASE leave_type
    WHEN 'Sick Leave' THEN balance.sick_leave
    WHEN 'Casual Leave' THEN balance.casual_leave
    WHEN 'Comp Off' THEN balance.comp_off
  END
  INTO available_days
  FROM public.leave_balances balance
  WHERE balance.employee_id = actor_employee_id
  FOR UPDATE;

  SELECT COALESCE(sum(request.days), 0)
  INTO pending_days
  FROM public.leaves request
  WHERE request.employee_id = actor_employee_id
    AND request.type = leave_type
    AND request.status = 'Pending'
    AND request.id <> target_leave_id;

  IF requested_days + pending_days > available_days THEN
    RAISE EXCEPTION 'Insufficient % balance after pending requests', leave_type;
  END IF;

  UPDATE public.leaves
  SET type = leave_type,
      from_date = leave_from,
      to_date = leave_to,
      days = requested_days,
      reason = btrim(leave_reason)
  WHERE id = target_leave_id
    AND employee_id = actor_employee_id
    AND status = 'Pending'
  RETURNING * INTO updated_leave;

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
  actor_employee_id UUID;
  target_leave public.leaves;
  available_days NUMERIC;
  decided_leave public.leaves;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF NOT public.can_manage_leave() THEN
    RAISE EXCEPTION 'Leave Admin access is required to decide leave requests';
  END IF;

  SELECT request.*
  INTO target_leave
  FROM public.leaves request
  WHERE request.id = target_leave_id
  FOR UPDATE;

  IF target_leave.id IS NULL THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF target_leave.employee_id = actor_employee_id THEN
    RAISE EXCEPTION 'You cannot decide your own leave request';
  END IF;

  IF target_leave.status <> 'Pending' THEN
    RAISE EXCEPTION 'Leave request has already been decided';
  END IF;

  IF NOT approve AND COALESCE(length(btrim(decision_comment)), 0) = 0 THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  IF approve THEN
    SELECT CASE target_leave.type
      WHEN 'Sick Leave' THEN balance.sick_leave
      WHEN 'Casual Leave' THEN balance.casual_leave
      WHEN 'Comp Off' THEN balance.comp_off
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
    SET sick_leave = CASE WHEN target_leave.type = 'Sick Leave'
          THEN sick_leave - target_leave.days ELSE sick_leave END,
        casual_leave = CASE WHEN target_leave.type = 'Casual Leave'
          THEN casual_leave - target_leave.days ELSE casual_leave END,
        comp_off = CASE WHEN target_leave.type = 'Comp Off'
          THEN comp_off - target_leave.days ELSE comp_off END,
        updated_at = statement_timestamp()
    WHERE employee_id = target_leave.employee_id;

    INSERT INTO public.leave_balance_transactions (
      employee_id,
      leave_type,
      amount,
      transaction_type,
      source_leave_id,
      reason,
      created_by
    ) VALUES (
      target_leave.employee_id,
      target_leave.type,
      -target_leave.days,
      'leave_approval',
      target_leave.id,
      concat('Approved leave: ', target_leave.from_date, ' to ', target_leave.to_date),
      actor_employee_id
    );

    UPDATE public.leaves
    SET status = 'Approved',
        rejection_comment = NULLIF(btrim(decision_comment), ''),
        decided_by = actor_employee_id,
        decided_at = statement_timestamp()
    WHERE id = target_leave.id
    RETURNING * INTO decided_leave;
  ELSE
    UPDATE public.leaves
    SET status = 'Rejected',
        rejection_comment = NULLIF(btrim(decision_comment), ''),
        decided_by = actor_employee_id,
        decided_at = statement_timestamp()
    WHERE id = target_leave.id
    RETURNING * INTO decided_leave;
  END IF;

  RETURN decided_leave;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_leave_balance(
  target_employee_id UUID,
  leave_type TEXT,
  adjustment NUMERIC,
  adjustment_reason TEXT
)
RETURNS public.leave_balance_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  available_days NUMERIC;
  created_transaction public.leave_balance_transactions;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF NOT public.can_manage_leave() THEN
    RAISE EXCEPTION 'Leave Admin access is required to adjust balances';
  END IF;

  IF target_employee_id = actor_employee_id THEN
    RAISE EXCEPTION 'Leave Admins cannot adjust their own balance';
  END IF;

  IF leave_type NOT IN ('Sick Leave', 'Casual Leave', 'Comp Off') THEN
    RAISE EXCEPTION 'Unsupported leave type';
  END IF;

  IF adjustment IS NULL OR adjustment = 0 OR mod(adjustment, 0.5) <> 0 THEN
    RAISE EXCEPTION 'Balance adjustments must use non-zero half-day increments';
  END IF;

  IF COALESCE(length(btrim(adjustment_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'An adjustment reason is required';
  END IF;

  SELECT CASE leave_type
    WHEN 'Sick Leave' THEN balance.sick_leave
    WHEN 'Casual Leave' THEN balance.casual_leave
    WHEN 'Comp Off' THEN balance.comp_off
  END
  INTO available_days
  FROM public.leave_balances balance
  WHERE balance.employee_id = target_employee_id
  FOR UPDATE;

  IF available_days IS NULL THEN
    RAISE EXCEPTION 'Leave balance not found';
  END IF;

  IF available_days + adjustment < 0 THEN
    RAISE EXCEPTION 'The adjustment would make the balance negative';
  END IF;

  UPDATE public.leave_balances
  SET sick_leave = CASE WHEN leave_type = 'Sick Leave'
        THEN sick_leave + adjustment ELSE sick_leave END,
      casual_leave = CASE WHEN leave_type = 'Casual Leave'
        THEN casual_leave + adjustment ELSE casual_leave END,
      comp_off = CASE WHEN leave_type = 'Comp Off'
        THEN comp_off + adjustment ELSE comp_off END,
      updated_at = statement_timestamp()
  WHERE employee_id = target_employee_id;

  INSERT INTO public.leave_balance_transactions (
    employee_id,
    leave_type,
    amount,
    transaction_type,
    reason,
    created_by
  ) VALUES (
    target_employee_id,
    leave_type,
    adjustment,
    'adjustment',
    btrim(adjustment_reason),
    actor_employee_id
  )
  RETURNING * INTO created_transaction;

  RETURN created_transaction;
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
  ignored_transaction public.leave_balance_transactions;
  updated_balance public.leave_balances;
BEGIN
  ignored_transaction := public.adjust_leave_balance(
    target_employee_id,
    'Comp Off',
    days_to_add,
    'Comp Off grant'
  );

  SELECT * INTO updated_balance
  FROM public.leave_balances balance
  WHERE balance.employee_id = target_employee_id;

  RETURN updated_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_balance_summary(
  requested_employee_id UUID DEFAULT NULL
)
RETURNS TABLE (
  employee_id UUID,
  leave_type TEXT,
  available NUMERIC,
  pending NUMERIC,
  used_this_year NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  target_employee_id UUID;
BEGIN
  actor_employee_id := public.current_employee_id();
  target_employee_id := COALESCE(requested_employee_id, actor_employee_id);

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF target_employee_id <> actor_employee_id AND NOT public.can_manage_leave() THEN
    RAISE EXCEPTION 'Leave Admin access is required to view another balance';
  END IF;

  RETURN QUERY
  WITH types(leave_type) AS (
    VALUES ('Sick Leave'::TEXT), ('Casual Leave'::TEXT), ('Comp Off'::TEXT)
  )
  SELECT
    target_employee_id,
    types.leave_type,
    CASE types.leave_type
      WHEN 'Sick Leave' THEN balance.sick_leave
      WHEN 'Casual Leave' THEN balance.casual_leave
      WHEN 'Comp Off' THEN balance.comp_off
    END AS available,
    COALESCE((
      SELECT sum(request.days)
      FROM public.leaves request
      WHERE request.employee_id = target_employee_id
        AND request.type = types.leave_type
        AND request.status = 'Pending'
    ), 0)::NUMERIC AS pending,
    COALESCE((
      SELECT sum(request.days)
      FROM public.leaves request
      WHERE request.employee_id = target_employee_id
        AND request.type = types.leave_type
        AND request.status = 'Approved'
        AND extract(year FROM request.from_date) = extract(year FROM public.app_current_date(statement_timestamp()))
    ), 0)::NUMERIC AS used_this_year
  FROM types
  JOIN public.leave_balances balance
    ON balance.employee_id = target_employee_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.scoped_leave_requests()
RETURNS TABLE (
  leave_id UUID,
  employee_id UUID,
  employee_name TEXT,
  employee_code TEXT,
  employee_department TEXT,
  leave_type TEXT,
  from_date DATE,
  to_date DATE,
  days NUMERIC,
  reason TEXT,
  request_status TEXT,
  decision_comment TEXT,
  created_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  decided_by_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  manage_leave BOOLEAN;
BEGIN
  actor_employee_id := public.current_employee_id();
  manage_leave := public.can_manage_leave();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  RETURN QUERY
  SELECT
    request.id,
    request.employee_id,
    employee.name,
    employee.emp_code,
    employee.department,
    request.type,
    request.from_date,
    request.to_date,
    request.days,
    request.reason,
    request.status,
    request.rejection_comment,
    request.created_at,
    request.decided_at,
    decider.name
  FROM public.leaves request
  JOIN public.employees employee ON employee.id = request.employee_id
  LEFT JOIN public.employees decider ON decider.id = request.decided_by
  WHERE request.employee_id = actor_employee_id OR manage_leave
  ORDER BY request.created_at DESC, request.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_admin_balance_overview()
RETURNS TABLE (
  employee_id UUID,
  employee_name TEXT,
  employee_code TEXT,
  employee_department TEXT,
  sick_leave NUMERIC,
  casual_leave NUMERIC,
  comp_off NUMERIC,
  pending_requests BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_leave() THEN
    RAISE EXCEPTION 'Leave Admin access is required';
  END IF;

  RETURN QUERY
  SELECT
    employee.id,
    employee.name,
    employee.emp_code,
    employee.department,
    balance.sick_leave,
    balance.casual_leave,
    balance.comp_off,
    count(request.id) FILTER (WHERE request.status = 'Pending')
  FROM public.employees employee
  JOIN public.leave_balances balance ON balance.employee_id = employee.id
  LEFT JOIN public.leaves request ON request.employee_id = employee.id
  WHERE employee.status <> 'Released'
  GROUP BY employee.id, employee.name, employee.emp_code, employee.department,
    balance.sick_leave, balance.casual_leave, balance.comp_off
  ORDER BY employee.name, employee.emp_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_balance_history(
  requested_employee_id UUID DEFAULT NULL
)
RETURNS TABLE (
  transaction_id UUID,
  employee_id UUID,
  leave_type TEXT,
  amount NUMERIC,
  transaction_type TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ,
  created_by_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  target_employee_id UUID;
BEGIN
  actor_employee_id := public.current_employee_id();
  target_employee_id := COALESCE(requested_employee_id, actor_employee_id);

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF target_employee_id <> actor_employee_id AND NOT public.can_manage_leave() THEN
    RAISE EXCEPTION 'Leave Admin access is required to view another balance history';
  END IF;

  RETURN QUERY
  SELECT
    ledger_entry.id,
    ledger_entry.employee_id,
    ledger_entry.leave_type,
    ledger_entry.amount,
    ledger_entry.transaction_type,
    ledger_entry.reason,
    ledger_entry.created_at,
    actor.name
  FROM public.leave_balance_transactions ledger_entry
  LEFT JOIN public.employees actor ON actor.id = ledger_entry.created_by
  WHERE ledger_entry.employee_id = target_employee_id
  ORDER BY ledger_entry.created_at DESC, ledger_entry.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_company_holiday(
  target_holiday_id UUID,
  holiday_name TEXT,
  holiday_date DATE
)
RETURNS public.holidays
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved_holiday public.holidays;
  existing_holiday_date DATE;
BEGIN
  IF NOT public.can_manage_leave() THEN
    RAISE EXCEPTION 'Leave Admin access is required to manage holidays';
  END IF;

  IF COALESCE(length(btrim(holiday_name)), 0) = 0 OR holiday_date IS NULL THEN
    RAISE EXCEPTION 'Holiday name and date are required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.leaves request
    WHERE request.status IN ('Pending', 'Approved')
      AND holiday_date BETWEEN request.from_date AND request.to_date
  ) THEN
    RAISE EXCEPTION 'This date is already used by an active leave request';
  END IF;

  IF target_holiday_id IS NOT NULL THEN
    SELECT holiday.date
    INTO existing_holiday_date
    FROM public.holidays holiday
    WHERE holiday.id = target_holiday_id;

    IF existing_holiday_date IS NULL THEN
      RAISE EXCEPTION 'Holiday not found';
    END IF;

    IF existing_holiday_date <> holiday_date AND EXISTS (
      SELECT 1
      FROM public.leaves request
      WHERE request.status IN ('Pending', 'Approved')
        AND existing_holiday_date BETWEEN request.from_date AND request.to_date
    ) THEN
      RAISE EXCEPTION 'The existing holiday date is already used by an active leave request';
    END IF;
  END IF;

  IF target_holiday_id IS NULL THEN
    INSERT INTO public.holidays (name, date)
    VALUES (btrim(holiday_name), holiday_date)
    RETURNING * INTO saved_holiday;
  ELSE
    UPDATE public.holidays
    SET name = btrim(holiday_name), date = holiday_date
    WHERE id = target_holiday_id
    RETURNING * INTO saved_holiday;
  END IF;

  IF saved_holiday.id IS NULL THEN
    RAISE EXCEPTION 'Holiday not found';
  END IF;

  RETURN saved_holiday;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_company_holiday(
  target_holiday_id UUID
)
RETURNS public.holidays
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed_holiday public.holidays;
BEGIN
  IF NOT public.can_manage_leave() THEN
    RAISE EXCEPTION 'Leave Admin access is required to manage holidays';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.holidays holiday
    JOIN public.leaves request
      ON holiday.date BETWEEN request.from_date AND request.to_date
    WHERE holiday.id = target_holiday_id
      AND request.status IN ('Pending', 'Approved')
  ) THEN
    RAISE EXCEPTION 'This holiday is already used by an active leave request';
  END IF;

  DELETE FROM public.holidays holiday
  WHERE holiday.id = target_holiday_id
    AND holiday.date >= public.app_current_date(statement_timestamp())
  RETURNING * INTO removed_holiday;

  IF removed_holiday.id IS NULL THEN
    RAISE EXCEPTION 'Only current or future holidays can be removed';
  END IF;

  RETURN removed_holiday;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_attendance_late_cutoff(
  requested_late_after TIME
)
RETURNS public.attendance_policy
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved_policy public.attendance_policy;
BEGIN
  IF NOT public.can_manage_leave() THEN
    RAISE EXCEPTION 'Leave Admin access is required to manage attendance policy';
  END IF;

  UPDATE public.attendance_policy
  SET late_after = requested_late_after,
      updated_by = public.current_employee_id(),
      updated_at = statement_timestamp()
  WHERE singleton
  RETURNING * INTO saved_policy;

  RETURN saved_policy;
END;
$$;

ALTER TABLE public.leave_balance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leaves_select_own_or_superadmin ON public.leaves;
CREATE POLICY leaves_select_own_or_leave_admin
  ON public.leaves FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.can_manage_leave());

DROP POLICY IF EXISTS leaves_delete_superadmin ON public.leaves;
CREATE POLICY leaves_delete_controlled
  ON public.leaves FOR DELETE TO authenticated
  USING (false);

DROP POLICY IF EXISTS leave_balances_select_own_or_superadmin ON public.leave_balances;
CREATE POLICY leave_balances_select_own_or_leave_admin
  ON public.leave_balances FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.can_manage_leave());

CREATE POLICY leave_balance_transactions_select_scoped
  ON public.leave_balance_transactions FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.can_manage_leave());

CREATE POLICY attendance_policy_read_active
  ON public.attendance_policy FOR SELECT TO authenticated
  USING (public.is_active_employee());

DROP POLICY IF EXISTS holidays_write_superadmin ON public.holidays;
CREATE POLICY holidays_write_controlled
  ON public.holidays FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON public.leave_balance_transactions FROM PUBLIC, anon;
REVOKE ALL ON public.attendance_policy FROM PUBLIC, anon;
GRANT SELECT ON public.leave_balance_transactions TO authenticated;
GRANT SELECT ON public.attendance_policy TO authenticated;

REVOKE ALL ON FUNCTION public.can_manage_leave() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_leave_balance_transaction_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_leave_admin_access(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_leave_admin_access() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_leave_balance_opening_transactions()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_working_days(DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.requested_leave_days(DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_leave_request(TEXT, DATE, DATE, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_pending_leave_request(UUID, TEXT, DATE, DATE, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_leave_request(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adjust_leave_balance(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_comp_off_balance(UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_balance_summary(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scoped_leave_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_admin_balance_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_balance_history(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_company_holiday(UUID, TEXT, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_company_holiday(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_attendance_late_cutoff(TIME) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_manage_leave() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_leave_admin_access(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_working_days(DATE, DATE, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.requested_leave_days(DATE, DATE, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_leave_request(TEXT, DATE, DATE, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pending_leave_request(UUID, TEXT, DATE, DATE, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_leave_request(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_leave_balance(UUID, TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_comp_off_balance(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_balance_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scoped_leave_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_admin_balance_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_balance_history(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_company_holiday(UUID, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_company_holiday(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_attendance_late_cutoff(TIME) TO authenticated;

COMMIT;
