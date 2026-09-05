-- HRMS-056 rollback-only verification, including real authenticated RLS reads/writes.
BEGIN;
CREATE TEMP TABLE policy_checks (name TEXT PRIMARY KEY, passed BOOLEAN NOT NULL);
CREATE FUNCTION pg_temp.policy_assert(check_name TEXT, passed BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF passed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Policy check failed: %', check_name; END IF;
  INSERT INTO policy_checks VALUES (check_name, true);
END;
$$;

DO $$
<<policy_test>>
DECLARE
  admin_auth UUID := gen_random_uuid();
  employee_auth UUID := gen_random_uuid();
  manager_auth UUID := gen_random_uuid();
  superadmin_auth UUID := gen_random_uuid();
  inactive_auth UUID := gen_random_uuid();
  gated_auth UUID := gen_random_uuid();
  admin_id UUID; employee_id UUID; manager_id UUID;
  version_one UUID := gen_random_uuid();
  version_two UUID := gen_random_uuid();
  reference_id UUID := gen_random_uuid();
  missing_id UUID := gen_random_uuid();
  first_version public.policy_versions;
  next_version public.policy_versions;
  ref_version public.policy_versions;
  first_ack public.policy_acknowledgements;
  retry_ack public.policy_acknowledgements;
  denied BOOLEAN;
  changed INTEGER;
  actor UUID;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (admin_auth, 'hrms056-admin@example.invalid'),
    (employee_auth, 'hrms056-employee@example.invalid'),
    (manager_auth, 'hrms056-manager@example.invalid'),
    (superadmin_auth, 'hrms056-superadmin@example.invalid'),
    (inactive_auth, 'hrms056-inactive@example.invalid'),
    (gated_auth, 'hrms056-gated@example.invalid');
  INSERT INTO public.employees (auth_id, emp_code, name, email, department, role, status, must_change_password) VALUES
    (admin_auth, 'HRMS056ADM', 'Policy Test Admin', 'hrms056-admin@example.invalid', 'Verification', 'admin', 'Active', false),
    (employee_auth, 'HRMS056EMP', 'Policy Test Employee', 'hrms056-employee@example.invalid', 'Verification', 'employee', 'Active', false),
    (manager_auth, 'HRMS056MGR', 'Policy Test Manager', 'hrms056-manager@example.invalid', 'Verification', 'manager', 'Active', false),
    (superadmin_auth, 'HRMS056SUP', 'Policy Test Superadmin', 'hrms056-superadmin@example.invalid', 'Verification', 'superadmin', 'Active', false),
    (inactive_auth, 'HRMS056OFF', 'Policy Test Inactive', 'hrms056-inactive@example.invalid', 'Verification', 'employee', 'Released', false),
    (gated_auth, 'HRMS056PWD', 'Policy Test Password Gate', 'hrms056-gated@example.invalid', 'Verification', 'admin', 'Active', true);
  SELECT id INTO admin_id FROM public.employees WHERE auth_id = admin_auth;
  SELECT id INTO employee_id FROM public.employees WHERE auth_id = employee_auth;
  SELECT id INTO manager_id FROM public.employees WHERE auth_id = manager_auth;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', admin_auth, 'role', 'authenticated')::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.policy_assert('admin_can_manage', public.can_manage_policies());
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    ('company-policies', admin_id::TEXT || '/' || version_one::TEXT || '.pdf', '{"mimetype":"application/pdf","size":128}'),
    ('company-policies', admin_id::TEXT || '/' || version_two::TEXT || '.pdf', '{"mimetype":"application/pdf","size":256}'),
    ('company-policies', admin_id::TEXT || '/' || reference_id::TEXT || '.pdf', '{"mimetype":"application/pdf","size":128}');
  first_version := public.publish_policy(NULL, NULL, version_one, ' Remote Work ', 'Company-wide', 'remote.pdf', true);
  PERFORM pg_temp.policy_assert('upload_publishes_immediately', first_version.version_number = 1 AND first_version.title = 'Remote Work'
    AND EXISTS (SELECT 1 FROM public.policy_documents WHERE id = first_version.document_id AND current_version_id = version_one));
  next_version := public.publish_policy(NULL, NULL, version_one, ' Remote Work ', 'Company-wide', 'remote.pdf', true);
  PERFORM pg_temp.policy_assert('publication_retry_is_idempotent', next_version.id = first_version.id
    AND (SELECT count(*) = 1 FROM public.policy_versions WHERE document_id = first_version.document_id));
  denied := false;
  BEGIN
    PERFORM public.publish_policy(NULL, NULL, missing_id, 'Missing PDF', '', 'missing.pdf', true);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.policy_assert('missing_upload_cannot_publish', denied);
  denied := false;
  BEGIN
    UPDATE public.policy_versions SET title = 'Tampered' WHERE id = version_one;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM pg_temp.policy_assert('admin_cannot_rewrite_version_metadata', denied);
  UPDATE storage.objects SET metadata = '{"size":1}' WHERE bucket_id = 'company-policies' AND name = first_version.object_path;
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM pg_temp.policy_assert('admin_cannot_overwrite_pdf_bytes', changed = 0);
  denied := false;
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'company-policies' AND name = first_version.object_path;
    GET DIAGNOSTICS changed = ROW_COUNT;
    denied := changed = 0;
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.policy_assert('admin_cannot_delete_published_pdf', denied);
  ref_version := public.publish_policy(NULL, NULL, reference_id, 'Reference', '', 'reference.pdf', false);

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', employee_auth, 'role', 'authenticated')::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.policy_assert('employee_can_read_current_pdf', EXISTS (SELECT 1 FROM public.policy_versions WHERE id = version_one)
    AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'company-policies' AND name = first_version.object_path));
  PERFORM pg_temp.policy_assert('employee_cannot_read_unpublished_upload', NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id = 'company-policies' AND name = admin_id::TEXT || '/' || version_two::TEXT || '.pdf'));
  first_ack := public.acknowledge_policy(version_one);
  retry_ack := public.acknowledge_policy(version_one);
  PERFORM pg_temp.policy_assert('self_acknowledgement_is_idempotent_and_server_stamped', first_ack.employee_id = employee_id
    AND first_ack.version_id = version_one AND first_ack.acknowledged_at IS NOT NULL
    AND first_ack.acknowledged_at = retry_ack.acknowledged_at);
  denied := false;
  BEGIN
    INSERT INTO public.policy_acknowledgements (version_id, employee_id, acknowledged_at)
      VALUES (version_one, manager_id, '2000-01-01');
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM pg_temp.policy_assert('cannot_forge_another_person_or_timestamp', denied);
  denied := false;
  BEGIN
    UPDATE public.policy_acknowledgements SET acknowledged_at = '2000-01-01' WHERE version_id = version_one;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM pg_temp.policy_assert('acknowledgements_cannot_be_edited', denied);
  denied := false;
  BEGIN
    DELETE FROM public.policy_acknowledgements WHERE version_id = version_one;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM pg_temp.policy_assert('acknowledgements_cannot_be_deleted', denied);
  denied := false;
  BEGIN PERFORM public.acknowledge_policy(reference_id);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.policy_assert('reference_document_requires_no_acknowledgement', denied);

  FOREACH actor IN ARRAY ARRAY[employee_auth, manager_auth] LOOP
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::TEXT, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    denied := false;
    BEGIN PERFORM public.publish_policy(NULL, NULL, gen_random_uuid(), 'Forbidden', '', 'forbidden.pdf', true);
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    PERFORM pg_temp.policy_assert('non_admin_publish_denied_' || actor, denied);
    denied := false;
    BEGIN PERFORM public.set_policy_archived(first_version.document_id, version_one, true);
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    PERFORM pg_temp.policy_assert('non_admin_archive_denied_' || actor, denied);
    denied := false;
    BEGIN PERFORM * FROM public.policy_acknowledgement_report(version_one);
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    PERFORM pg_temp.policy_assert('non_admin_report_denied_' || actor, denied);
    denied := false;
    BEGIN INSERT INTO storage.objects (bucket_id, name, metadata)
      VALUES ('company-policies', public.current_employee_id()::TEXT || '/' || gen_random_uuid()::TEXT || '.pdf', '{"mimetype":"application/pdf","size":128}');
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    PERFORM pg_temp.policy_assert('non_admin_storage_upload_denied_' || actor, denied);
  END LOOP;
  PERFORM pg_temp.policy_assert('manager_cannot_read_employee_acknowledgement', NOT EXISTS (
    SELECT 1 FROM public.policy_acknowledgements WHERE version_id = version_one AND policy_acknowledgements.employee_id = policy_test.employee_id));

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', admin_auth, 'role', 'authenticated')::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.policy_assert('admin_report_has_read_and_pending_people',
    EXISTS (SELECT 1 FROM public.policy_acknowledgement_report(version_one) r WHERE r.employee_id = policy_test.employee_id AND r.acknowledged_at IS NOT NULL)
    AND EXISTS (SELECT 1 FROM public.policy_acknowledgement_report(version_one) r WHERE r.employee_id = manager_id AND r.acknowledged_at IS NULL));
  next_version := public.publish_policy(first_version.document_id, version_one, version_two, 'Remote Work updated', '', 'remote-v2.pdf', true);
  PERFORM pg_temp.policy_assert('replacement_advances_version_and_preserves_acknowledgements', next_version.version_number = 2
    AND EXISTS (SELECT 1 FROM public.policy_acknowledgements WHERE version_id = version_one)
    AND NOT EXISTS (SELECT 1 FROM public.policy_acknowledgements WHERE version_id = version_two));
  PERFORM pg_temp.policy_assert('historical_report_does_not_invent_pending_roster',
    NOT EXISTS (SELECT 1 FROM public.policy_acknowledgement_report(version_one) WHERE acknowledged_at IS NULL));
  denied := false;
  BEGIN PERFORM public.set_policy_archived(first_version.document_id, version_one, true);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.policy_assert('stale_admin_action_rejected', denied);

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', employee_auth, 'role', 'authenticated')::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied := false;
  BEGIN PERFORM public.acknowledge_policy(version_one);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.policy_assert('stale_reader_cannot_acknowledge_replaced_version', denied);
  PERFORM pg_temp.policy_assert('old_pdf_not_readable_by_employee', NOT EXISTS (SELECT 1 FROM public.policy_versions WHERE id = version_one)
    AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE name = first_version.object_path AND bucket_id = 'company-policies'));
  retry_ack := public.acknowledge_policy(version_two);
  PERFORM pg_temp.policy_assert('replacement_needs_fresh_acknowledgement', retry_ack.version_id = version_two AND retry_ack.employee_id = employee_id);

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', superadmin_auth, 'role', 'authenticated')::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.policy_assert('superadmin_retains_admin_capability', public.can_manage_policies());
  PERFORM public.set_policy_archived(first_version.document_id, version_two, true);
  PERFORM pg_temp.policy_assert('admin_can_read_archived_version', EXISTS (SELECT 1 FROM public.policy_versions WHERE id = version_two));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', employee_auth, 'role', 'authenticated')::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.policy_assert('archived_document_and_file_hidden', NOT EXISTS (SELECT 1 FROM public.policy_documents WHERE id = first_version.document_id)
    AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE name = next_version.object_path AND bucket_id = 'company-policies'));
  denied := false;
  BEGIN PERFORM public.acknowledge_policy(version_two);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.policy_assert('archived_version_cannot_be_acknowledged', denied);

  FOREACH actor IN ARRAY ARRAY[inactive_auth, gated_auth] LOOP
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::TEXT, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM pg_temp.policy_assert('inactive_or_password_gated_access_denied_' || actor,
      NOT public.can_manage_policies() AND NOT EXISTS (SELECT 1 FROM public.policy_versions WHERE id = reference_id)
      AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE name = ref_version.object_path AND bucket_id = 'company-policies'));
  END LOOP;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  denied := false;
  BEGIN PERFORM public.acknowledge_policy(reference_id);
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM pg_temp.policy_assert('anonymous_acknowledgement_denied', denied);
  denied := false;
  BEGIN PERFORM * FROM public.policy_documents;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM pg_temp.policy_assert('anonymous_documents_denied', denied);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.policy_assert('bucket_is_private_and_pdf_bounded', EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'company-policies' AND NOT public
      AND file_size_limit = 20971520 AND allowed_mime_types = ARRAY['application/pdf']));
END;
$$;

SELECT bool_and(passed) AS all_checks_pass, jsonb_object_agg(name, passed) AS checks FROM policy_checks;
ROLLBACK;
