-- HRMS-056: immediately published company PDFs and immutable acknowledgements.
BEGIN;

CREATE TABLE public.policy_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  current_version_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
  CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

CREATE TABLE public.policy_versions (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.policy_documents(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  file_size BIGINT NOT NULL CHECK (file_size BETWEEN 1 AND 20971520),
  object_path TEXT NOT NULL UNIQUE,
  requires_acknowledgement BOOLEAN NOT NULL DEFAULT true,
  published_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (document_id, version_number),
  UNIQUE (document_id, id)
);

ALTER TABLE public.policy_documents ADD CONSTRAINT policy_current_version_fk
  FOREIGN KEY (id, current_version_id) REFERENCES public.policy_versions(document_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.policy_acknowledgements (
  version_id UUID NOT NULL REFERENCES public.policy_versions(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (version_id, employee_id)
);
CREATE INDEX policy_acknowledgements_employee_idx
  ON public.policy_acknowledgements (employee_id, version_id);

CREATE FUNCTION public.can_manage_policies() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.current_employee_role() IN ('admin', 'superadmin'), false);
$$;

-- A definer helper avoids cyclic policies between documents and versions.
CREATE FUNCTION public.can_read_policy_version(target_version_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_employee_id() IS NOT NULL AND (
    public.can_manage_policies() OR EXISTS (
      SELECT 1 FROM public.policy_documents d
      WHERE d.current_version_id = target_version_id AND d.archived_at IS NULL
    )
  );
$$;

ALTER TABLE public.policy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_acknowledgements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.policy_documents, public.policy_versions,
  public.policy_acknowledgements FROM anon, authenticated;
GRANT SELECT ON public.policy_documents, public.policy_versions,
  public.policy_acknowledgements TO authenticated;

CREATE POLICY policy_documents_read ON public.policy_documents FOR SELECT TO authenticated
  USING (public.current_employee_id() IS NOT NULL
    AND (archived_at IS NULL OR public.can_manage_policies()));
CREATE POLICY policy_versions_read ON public.policy_versions FOR SELECT TO authenticated
  USING (public.can_read_policy_version(id));
CREATE POLICY policy_acknowledgements_read ON public.policy_acknowledgements FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.can_manage_policies());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('company-policies', 'company-policies', false, 20971520, ARRAY['application/pdf']);

CREATE POLICY company_policies_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-policies' AND public.can_manage_policies()
    AND name ~ ('^' || public.current_employee_id()::TEXT || '/[0-9a-f-]{36}\.pdf$'));
CREATE POLICY company_policies_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-policies' AND public.current_employee_id() IS NOT NULL
    AND (public.can_manage_policies() OR EXISTS (
      SELECT 1 FROM public.policy_versions v
      WHERE v.object_path = name AND public.can_read_policy_version(v.id)
    )));
-- No object UPDATE or DELETE grants: a published version's bytes must not change.
-- Restrictive guards also protect this bucket from unrelated permissive policies.
CREATE POLICY company_policies_no_overwrite ON storage.objects AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (bucket_id <> 'company-policies')
  WITH CHECK (bucket_id <> 'company-policies');
CREATE POLICY company_policies_no_delete ON storage.objects AS RESTRICTIVE
  FOR DELETE TO authenticated USING (bucket_id <> 'company-policies');
CREATE POLICY company_policies_insert_boundary ON storage.objects AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (bucket_id <> 'company-policies' OR (
    public.can_manage_policies()
    AND name ~ ('^' || public.current_employee_id()::TEXT || '/[0-9a-f-]{36}\.pdf$')));
CREATE POLICY company_policies_select_boundary ON storage.objects AS RESTRICTIVE
  FOR SELECT TO authenticated USING (bucket_id <> 'company-policies' OR (
    public.current_employee_id() IS NOT NULL AND (public.can_manage_policies() OR EXISTS (
      SELECT 1 FROM public.policy_versions v
      WHERE v.object_path = name AND public.can_read_policy_version(v.id)
    ))));

CREATE FUNCTION public.publish_policy(
  target_document_id UUID,
  expected_version_id UUID,
  new_version_id UUID,
  policy_title TEXT,
  policy_description TEXT,
  pdf_file_name TEXT,
  require_acknowledgement BOOLEAN
) RETURNS public.policy_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor UUID := public.current_employee_id();
  document public.policy_documents;
  version public.policy_versions;
  object_metadata JSONB;
  pdf_path TEXT;
  next_number INTEGER := 1;
BEGIN
  IF NOT public.can_manage_policies() THEN
    RAISE EXCEPTION 'Only an Admin can publish policies' USING ERRCODE = '42501';
  END IF;
  IF new_version_id IS NULL OR require_acknowledgement IS NULL
    OR policy_title IS NULL OR length(btrim(policy_title)) NOT BETWEEN 1 AND 160
    OR length(COALESCE(policy_description, '')) > 2000
    OR pdf_file_name IS NULL OR length(pdf_file_name) NOT BETWEEN 1 AND 255
    OR lower(pdf_file_name) NOT LIKE '%.pdf' THEN
    RAISE EXCEPTION 'Provide a title and a PDF file within the allowed limits';
  END IF;
  -- Serialise retries, including first publication when no document exists yet.
  PERFORM pg_advisory_xact_lock(hashtextextended(new_version_id::TEXT, 56));
  SELECT * INTO version FROM public.policy_versions WHERE id = new_version_id;
  IF FOUND THEN
    IF version.published_by = actor
      AND (target_document_id IS NULL OR target_document_id = version.document_id)
      AND version.title = btrim(policy_title)
      AND version.description = btrim(COALESCE(policy_description, ''))
      AND version.file_name = pdf_file_name
      AND version.requires_acknowledgement = require_acknowledgement THEN
      RETURN version;
    END IF;
    RAISE EXCEPTION 'This upload was already published with different details';
  END IF;
  pdf_path := actor::TEXT || '/' || new_version_id::TEXT || '.pdf';
  SELECT metadata INTO object_metadata FROM storage.objects
    WHERE bucket_id = 'company-policies' AND name = pdf_path;
  IF NOT FOUND OR object_metadata->>'mimetype' IS DISTINCT FROM 'application/pdf'
    OR COALESCE((object_metadata->>'size')::BIGINT, 0) NOT BETWEEN 1 AND 20971520 THEN
    RAISE EXCEPTION 'Upload a PDF of up to 20 MB before publishing';
  END IF;
  IF target_document_id IS NULL THEN
    IF expected_version_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid new policy version'; END IF;
    INSERT INTO public.policy_documents (current_version_id, created_by)
      VALUES (new_version_id, actor) RETURNING * INTO document;
  ELSE
    SELECT * INTO document FROM public.policy_documents WHERE id = target_document_id FOR UPDATE;
    IF NOT FOUND OR document.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'This policy is unavailable or archived. Refresh the library';
    END IF;
    IF document.current_version_id IS DISTINCT FROM expected_version_id THEN
      RAISE EXCEPTION 'Someone updated this policy. Refresh before replacing it';
    END IF;
    SELECT v.version_number + 1 INTO next_number FROM public.policy_versions v
      WHERE v.id = document.current_version_id;
  END IF;
  INSERT INTO public.policy_versions (id, document_id, version_number, title, description,
    file_name, file_size, object_path, requires_acknowledgement, published_by)
  VALUES (new_version_id, document.id, next_number, btrim(policy_title),
    btrim(COALESCE(policy_description, '')), pdf_file_name, (object_metadata->>'size')::BIGINT,
    pdf_path, require_acknowledgement, actor) RETURNING * INTO version;
  UPDATE public.policy_documents SET current_version_id = version.id WHERE id = document.id;
  RETURN version;
END;
$$;

CREATE FUNCTION public.set_policy_archived(target_document_id UUID, expected_version_id UUID, archive BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE document public.policy_documents;
BEGIN
  IF NOT public.can_manage_policies() THEN
    RAISE EXCEPTION 'Only an Admin can archive policies' USING ERRCODE = '42501';
  END IF;
  IF archive IS NULL THEN RAISE EXCEPTION 'Choose archive or restore'; END IF;
  SELECT * INTO document FROM public.policy_documents WHERE id = target_document_id FOR UPDATE;
  IF NOT FOUND OR document.current_version_id IS DISTINCT FROM expected_version_id THEN
    RAISE EXCEPTION 'This policy changed. Refresh the library';
  END IF;
  UPDATE public.policy_documents
    SET archived_at = CASE WHEN archive THEN COALESCE(archived_at, statement_timestamp()) END,
        archived_by = CASE WHEN archive THEN COALESCE(archived_by, public.current_employee_id()) END
    WHERE id = target_document_id;
END;
$$;

CREATE FUNCTION public.acknowledge_policy(target_version_id UUID)
RETURNS public.policy_acknowledgements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor UUID := public.current_employee_id();
  document public.policy_documents;
  acknowledgement public.policy_acknowledgements;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to acknowledge a policy' USING ERRCODE = '42501'; END IF;
  -- Lock the same document as replacement/archive so a stale reader cannot acknowledge a new version.
  SELECT d.* INTO document FROM public.policy_documents d
    JOIN public.policy_versions v ON v.document_id = d.id
    WHERE v.id = target_version_id FOR UPDATE OF d;
  IF NOT FOUND OR document.archived_at IS NOT NULL
    OR document.current_version_id <> target_version_id THEN
    RAISE EXCEPTION 'This policy changed or was archived. Refresh and read the current version';
  END IF;
  IF NOT (SELECT requires_acknowledgement FROM public.policy_versions WHERE id = target_version_id) THEN
    RAISE EXCEPTION 'This document does not require acknowledgement';
  END IF;
  INSERT INTO public.policy_acknowledgements (version_id, employee_id)
    VALUES (target_version_id, actor) ON CONFLICT DO NOTHING;
  SELECT * INTO acknowledgement FROM public.policy_acknowledgements
    WHERE version_id = target_version_id AND employee_id = actor;
  RETURN acknowledgement;
END;
$$;

CREATE FUNCTION public.policy_acknowledgement_report(target_version_id UUID)
RETURNS TABLE (employee_id UUID, employee_name TEXT, department TEXT, employment_status TEXT,
  acknowledged_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE show_pending BOOLEAN;
BEGIN
  IF NOT public.can_manage_policies() THEN
    RAISE EXCEPTION 'Only an Admin can view acknowledgement reports' USING ERRCODE = '42501';
  END IF;
  SELECT d.current_version_id = v.id AND d.archived_at IS NULL AND v.requires_acknowledgement
    INTO show_pending FROM public.policy_versions v
    JOIN public.policy_documents d ON d.id = v.document_id WHERE v.id = target_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Policy version not found'; END IF;
  RETURN QUERY SELECT e.id, e.name, e.department, e.status, a.acknowledged_at
    FROM public.employees e LEFT JOIN public.policy_acknowledgements a
      ON a.employee_id = e.id AND a.version_id = target_version_id
    WHERE a.employee_id IS NOT NULL OR (show_pending AND e.status = 'Active')
    ORDER BY a.acknowledged_at NULLS FIRST, e.name, e.id;
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_policies(), public.can_read_policy_version(UUID),
  public.publish_policy(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN),
  public.set_policy_archived(UUID, UUID, BOOLEAN), public.acknowledge_policy(UUID),
  public.policy_acknowledgement_report(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_policies(), public.can_read_policy_version(UUID),
  public.publish_policy(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN),
  public.set_policy_archived(UUID, UUID, BOOLEAN), public.acknowledge_policy(UUID),
  public.policy_acknowledgement_report(UUID) TO authenticated;

COMMIT;
