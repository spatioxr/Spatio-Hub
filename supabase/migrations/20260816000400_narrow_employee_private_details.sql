-- Keep private People profiles limited to the explicitly approved fields.

BEGIN;

DROP FUNCTION public.upsert_employee_private_details(
  UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE
);

ALTER TABLE public.employee_private_details
  DROP COLUMN aadhaar_number,
  DROP COLUMN last_working_date;

CREATE OR REPLACE FUNCTION public.upsert_employee_private_details(
  target_employee_id UUID,
  personal_email_value TEXT DEFAULT NULL,
  gender_value TEXT DEFAULT NULL,
  date_of_birth_value DATE DEFAULT NULL,
  marital_status_value TEXT DEFAULT NULL,
  blood_group_value TEXT DEFAULT NULL,
  address_value TEXT DEFAULT NULL,
  qualification_value TEXT DEFAULT NULL,
  emergency_contact_number_value TEXT DEFAULT NULL,
  emergency_contact_name_value TEXT DEFAULT NULL
)
RETURNS public.employee_private_details
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  normalised_personal_email TEXT;
  saved_details public.employee_private_details;
BEGIN
  IF NOT public.can_manage_people() THEN
    RAISE EXCEPTION 'Only an admin or superadmin can manage private employee details';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = target_employee_id) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  actor_employee_id := public.current_employee_id();
  normalised_personal_email := lower(NULLIF(btrim(personal_email_value), ''));

  INSERT INTO public.employee_private_details (
    employee_id,
    personal_email,
    gender,
    date_of_birth,
    marital_status,
    blood_group,
    address,
    qualification,
    emergency_contact_number,
    emergency_contact_name,
    updated_by
  ) VALUES (
    target_employee_id,
    normalised_personal_email,
    NULLIF(btrim(gender_value), ''),
    date_of_birth_value,
    NULLIF(btrim(marital_status_value), ''),
    NULLIF(btrim(blood_group_value), ''),
    NULLIF(btrim(address_value), ''),
    NULLIF(btrim(qualification_value), ''),
    NULLIF(btrim(emergency_contact_number_value), ''),
    NULLIF(btrim(emergency_contact_name_value), ''),
    actor_employee_id
  )
  ON CONFLICT (employee_id) DO UPDATE SET
    personal_email = EXCLUDED.personal_email,
    gender = EXCLUDED.gender,
    date_of_birth = EXCLUDED.date_of_birth,
    marital_status = EXCLUDED.marital_status,
    blood_group = EXCLUDED.blood_group,
    address = EXCLUDED.address,
    qualification = EXCLUDED.qualification,
    emergency_contact_number = EXCLUDED.emergency_contact_number,
    emergency_contact_name = EXCLUDED.emergency_contact_name,
    updated_by = EXCLUDED.updated_by
  RETURNING * INTO saved_details;

  RETURN saved_details;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_employee_private_details(
  UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_employee_private_details(
  UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMIT;
