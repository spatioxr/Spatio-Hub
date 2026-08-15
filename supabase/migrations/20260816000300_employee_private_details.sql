-- Restricted employee demographics for the People administration drawer.

BEGIN;

CREATE TABLE public.employee_private_details (
  employee_id UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  personal_email TEXT,
  gender TEXT,
  date_of_birth DATE,
  marital_status TEXT,
  blood_group TEXT,
  address TEXT,
  qualification TEXT,
  emergency_contact_number TEXT,
  emergency_contact_name TEXT,
  aadhaar_number TEXT,
  last_working_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  CONSTRAINT employee_private_details_personal_email_valid CHECK (
    personal_email IS NULL
    OR (
      personal_email = lower(btrim(personal_email))
      AND personal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    )
  ),
  CONSTRAINT employee_private_details_dob_valid CHECK (
    date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE
  ),
  CONSTRAINT employee_private_details_emergency_phone_valid CHECK (
    emergency_contact_number IS NULL
    OR (
      emergency_contact_number = btrim(emergency_contact_number)
      AND length(emergency_contact_number) <= 25
      AND emergency_contact_number ~ '^\+?[0-9 ()-]+$'
      AND length(regexp_replace(emergency_contact_number, '[^0-9]', '', 'g')) BETWEEN 7 AND 15
    )
  ),
  CONSTRAINT employee_private_details_aadhaar_valid CHECK (
    aadhaar_number IS NULL OR aadhaar_number ~ '^[0-9]{12}$'
  ),
  CONSTRAINT employee_private_details_text_lengths CHECK (
    length(COALESCE(gender, '')) <= 50
    AND length(COALESCE(marital_status, '')) <= 50
    AND length(COALESCE(blood_group, '')) <= 20
    AND length(COALESCE(address, '')) <= 1000
    AND length(COALESCE(qualification, '')) <= 250
    AND length(COALESCE(emergency_contact_name, '')) <= 150
  )
);

ALTER TABLE public.employee_private_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "People administrators can view private employee details"
  ON public.employee_private_details
  FOR SELECT
  TO authenticated
  USING (public.can_manage_people());

CREATE TRIGGER employee_private_details_set_updated_at
  BEFORE UPDATE ON public.employee_private_details
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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
  emergency_contact_name_value TEXT DEFAULT NULL,
  aadhaar_number_value TEXT DEFAULT NULL,
  last_working_date_value DATE DEFAULT NULL
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
    aadhaar_number,
    last_working_date,
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
    NULLIF(regexp_replace(aadhaar_number_value, '[^0-9]', '', 'g'), ''),
    last_working_date_value,
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
    aadhaar_number = EXCLUDED.aadhaar_number,
    last_working_date = EXCLUDED.last_working_date,
    updated_by = EXCLUDED.updated_by
  RETURNING * INTO saved_details;

  RETURN saved_details;
END;
$$;

REVOKE ALL ON TABLE public.employee_private_details FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.employee_private_details TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_employee_private_details(
  UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_employee_private_details(
  UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE
) TO authenticated;

COMMIT;
