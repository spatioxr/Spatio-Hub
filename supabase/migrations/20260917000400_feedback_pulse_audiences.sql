-- Snapshot pulse recipients when launched; only superadmins may select audiences.
ALTER TABLE public.work_feedback_pulses
 ADD COLUMN audience_type text NOT NULL DEFAULT 'everyone' CHECK(audience_type IN ('everyone','project','department','person')),
 ADD COLUMN audience_key text,
 ADD COLUMN audience_label text NOT NULL DEFAULT 'Everyone',
 ADD COLUMN recipient_count integer NOT NULL DEFAULT 0;
CREATE TABLE public.work_feedback_pulse_recipients (
 pulse_id uuid NOT NULL REFERENCES public.work_feedback_pulses(id),
 employee_id uuid NOT NULL REFERENCES public.employees(id),
 PRIMARY KEY(pulse_id,employee_id)
);
ALTER TABLE public.work_feedback_pulse_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_feedback_pulse_recipients FROM PUBLIC,anon,authenticated;
-- Preserve any existing organisation-wide pulse, without adding external or inactive users.
INSERT INTO public.work_feedback_pulse_recipients
 SELECT p.id,e.id FROM public.work_feedback_pulses p CROSS JOIN public.employees e
 WHERE e.status='Active' AND e.role<>'observer' AND e.auth_id IS NOT NULL AND e.id<>p.created_by;
UPDATE public.work_feedback_pulses p SET recipient_count=(SELECT count(*) FROM public.work_feedback_pulse_recipients r WHERE r.pulse_id=p.id);

CREATE FUNCTION public.feedback_pulse_audience_members(kind text, target text) RETURNS TABLE(employee_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT e.id FROM public.employees e WHERE e.status='Active' AND e.role<>'observer'
 AND e.auth_id IS NOT NULL AND e.id<>public.current_employee_id() AND (
   kind='everyone' OR (kind='person' AND e.id::text=target)
   OR (kind='department' AND e.department=target)
   OR (kind='project' AND EXISTS(SELECT 1 FROM public.projects p WHERE p.id::text=target AND p.archived_at IS NULL AND (
     EXISTS(SELECT 1 FROM public.project_members m WHERE m.project_id=p.id AND m.employee_id=e.id)
     OR EXISTS(SELECT 1 FROM public.project_managers m WHERE m.project_id=p.id AND m.employee_id=e.id)
   )))
 );
$$;
CREATE FUNCTION public.work_feedback_audiences() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF public.current_employee_role() IS DISTINCT FROM 'superadmin' THEN RAISE EXCEPTION 'Only superadmins can choose pulse audiences'; END IF;
 WITH choices(kind,key,label) AS (
   SELECT 'everyone'::text,''::text,'Everyone'::text
   UNION ALL SELECT 'project',p.id::text,p.name FROM public.projects p WHERE p.archived_at IS NULL
   UNION ALL SELECT DISTINCT 'department',e.department,e.department FROM public.employees e WHERE e.status='Active' AND e.role<>'observer' AND nullif(btrim(e.department),'') IS NOT NULL
   UNION ALL SELECT 'person',e.id::text,e.name||coalesce(' · '||e.emp_code,'') FROM public.employees e WHERE e.status='Active' AND e.role<>'observer' AND e.auth_id IS NOT NULL AND e.id<>public.current_employee_id()
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('type',kind,'key',key,'label',label,'count',
 (SELECT count(*) FROM public.feedback_pulse_audience_members(kind,key))) ORDER BY label),'[]'::jsonb) INTO result FROM choices;
 RETURN result;
END $$;
CREATE FUNCTION public.launch_work_feedback_pulse(audience text DEFAULT 'everyone', target text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pulse public.work_feedback_pulses; label text; members uuid[];
BEGIN
 IF public.current_employee_role() IS DISTINCT FROM 'superadmin' THEN RAISE EXCEPTION 'Only superadmins can send pulses'; END IF;
 IF audience IS NULL OR audience NOT IN ('everyone','project','department','person') OR (audience<>'everyone' AND nullif(target,'') IS NULL) OR (audience='everyone' AND nullif(target,'') IS NOT NULL) THEN RAISE EXCEPTION 'Choose a valid audience'; END IF;
 PERFORM 1 FROM public.work_feedback_settings WHERE id FOR UPDATE;
 SELECT * INTO pulse FROM public.work_feedback_pulses WHERE closed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN
   IF pulse.audience_type<>audience OR coalesce(pulse.audience_key,'')<>coalesce(target,'') THEN RAISE EXCEPTION 'A pulse is already open. Close it before sending to a different audience.'; END IF;
   RETURN public.manage_work_feedback('get');
 END IF;
 SELECT item->>'label' INTO label FROM jsonb_array_elements(public.work_feedback_audiences()) item
 WHERE item->>'type'=audience AND item->>'key'=coalesce(target,'');
 IF label IS NULL THEN RAISE EXCEPTION 'This audience is no longer available'; END IF;
 SELECT array_agg(employee_id) INTO members FROM public.feedback_pulse_audience_members(audience,target);
 IF coalesce(cardinality(members),0)=0 THEN RAISE EXCEPTION 'This audience has no eligible staff. Your own account is excluded.'; END IF;
 INSERT INTO public.work_feedback_pulses(created_by,audience_type,audience_key,audience_label,recipient_count)
 VALUES(public.current_employee_id(),audience,nullif(target,''),label,cardinality(members)) RETURNING * INTO pulse;
 INSERT INTO public.work_feedback_pulse_recipients SELECT pulse.id,unnest(members);
 RETURN public.manage_work_feedback('get');
END $$;
CREATE OR REPLACE FUNCTION public.claim_work_feedback_pulse() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=public.current_employee_id(); pulse public.work_feedback_pulses; claimed integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'An active employee session is required'; END IF;
 SELECT p.* INTO pulse FROM public.work_feedback_pulses p
 JOIN public.work_feedback_pulse_recipients r ON r.pulse_id=p.id AND r.employee_id=actor
 WHERE p.closed_at IS NULL AND p.expires_at>now() ORDER BY p.created_at DESC LIMIT 1;
 IF pulse.id IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.work_feedback_pulse_claims VALUES(pulse.id,actor) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS claimed=ROW_COUNT;
 RETURN CASE WHEN claimed=1 THEN pulse.id ELSE NULL END;
END $$;
REVOKE ALL ON FUNCTION public.feedback_pulse_audience_members(text,text),public.work_feedback_audiences(),public.launch_work_feedback_pulse(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_feedback_audiences(),public.launch_work_feedback_pulse(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_work_feedback(action text, automatic boolean DEFAULT NULL, cadence text DEFAULT NULL, preferred_day integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE settings public.work_feedback_settings; pulse public.work_feedback_pulses;
BEGIN
 IF public.current_employee_role() IS DISTINCT FROM 'superadmin' THEN RAISE EXCEPTION 'Only superadmins can manage feedback prompts'; END IF;
 -- Serialize launches and settings writes, including retrying an active pulse.
 SELECT * INTO settings FROM public.work_feedback_settings WHERE id FOR UPDATE;
 IF action='save' THEN
   IF automatic IS NULL OR cadence IS NULL OR cadence NOT IN ('weekly','fortnightly','monthly') OR preferred_day IS NULL OR preferred_day NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'Choose a valid schedule'; END IF;
   UPDATE public.work_feedback_settings SET starts_on=CASE WHEN (enabled,frequency,weekday) IS DISTINCT FROM (automatic,cadence,preferred_day) THEN (now() AT TIME ZONE 'Asia/Kolkata')::date ELSE starts_on END,enabled=automatic,frequency=cadence,weekday=preferred_day WHERE id RETURNING * INTO settings;
 ELSIF action='launch' THEN
   RETURN public.launch_work_feedback_pulse('everyone',NULL);
 ELSIF action='close' THEN
   UPDATE public.work_feedback_pulses SET closed_at=now() WHERE closed_at IS NULL AND expires_at>now();
 ELSIF action<>'get' OR action IS NULL THEN RAISE EXCEPTION 'Invalid action';
 END IF;
 SELECT * INTO pulse FROM public.work_feedback_pulses WHERE closed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1;
 RETURN jsonb_build_object('enabled',settings.enabled,'frequency',settings.frequency,'weekday',settings.weekday,'pulse',CASE WHEN pulse.id IS NULL THEN NULL ELSE to_jsonb(pulse) END,
 'next_due',public.feedback_schedule_due((now() AT TIME ZONE 'Asia/Kolkata')::date,settings.frequency,settings.weekday));
END $$;

NOTIFY pgrst, 'reload schema';
