ALTER TABLE public.work_feedback_settings DROP CONSTRAINT work_feedback_settings_weekday_check;
ALTER TABLE public.work_feedback_settings ADD CONSTRAINT work_feedback_settings_weekday_check CHECK(weekday BETWEEN 0 AND 7);
ALTER TABLE public.work_feedback_settings
 ADD COLUMN time_mode text NOT NULL DEFAULT 'end_day' CHECK(time_mode IN ('end_day','fixed','random')),
 ADD COLUMN time_minutes integer NOT NULL DEFAULT 600 CHECK(time_minutes BETWEEN 0 AND 1439),
 ADD COLUMN sound_enabled boolean NOT NULL DEFAULT true;

CREATE FUNCTION public.feedback_person_due(actor uuid, today date, cadence text, day_number integer, timing text, minutes integer)
RETURNS timestamp LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE start_date date; end_date date; days date[]; chosen date; seed bigint;
BEGIN
 start_date := CASE WHEN cadence='monthly' THEN date_trunc('month',today)::date
 WHEN cadence='fortnightly' THEN date '2026-01-05'+floor((today-date '2026-01-05')::numeric/14)::integer*14
 ELSE date_trunc('week',today)::date END;
 end_date := CASE WHEN cadence='monthly' THEN (start_date+interval '1 month')::date ELSE start_date+CASE WHEN cadence='fortnightly' THEN 14 ELSE 7 END END;
 seed := ('x'||substr(md5(actor::text||start_date::text),1,8))::bit(32)::bigint;
 IF day_number=0 THEN
 SELECT array_agg(d::date ORDER BY d) INTO days FROM generate_series(start_date::timestamp,(end_date-1)::timestamp,interval '1 day') d WHERE extract(isodow FROM d)<=5;
 chosen := days[1+(seed%cardinality(days))::integer];
 ELSE chosen := start_date+((day_number-extract(isodow FROM start_date)::integer+7)%7);
 END IF;
 RETURN chosen::timestamp + make_interval(mins=>CASE WHEN timing='random' THEN 600+((seed/31)%420)::integer ELSE minutes END);
END $$;
CREATE FUNCTION public.save_work_feedback_schedule(automatic boolean,cadence text,preferred_day integer,timing text,minutes integer,sound boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.current_employee_role() IS DISTINCT FROM 'superadmin' THEN RAISE EXCEPTION 'Only superadmins can manage feedback prompts'; END IF;
 IF automatic IS NULL OR cadence IS NULL OR cadence NOT IN ('weekly','fortnightly','monthly') OR preferred_day IS NULL OR preferred_day NOT BETWEEN 0 AND 7 OR timing IS NULL OR timing NOT IN ('end_day','fixed','random') OR minutes IS NULL OR minutes NOT BETWEEN 0 AND 1439 OR sound IS NULL THEN RAISE EXCEPTION 'Choose a valid schedule'; END IF;
 UPDATE public.work_feedback_settings SET starts_on=CASE WHEN (enabled,frequency,weekday,time_mode,time_minutes) IS DISTINCT FROM (automatic,cadence,preferred_day,timing,minutes) THEN (now() AT TIME ZONE 'Asia/Kolkata')::date ELSE starts_on END,
 enabled=automatic,frequency=cadence,weekday=preferred_day,time_mode=timing,time_minutes=minutes,sound_enabled=sound WHERE id;
 RETURN public.manage_work_feedback('get');
END $$;
CREATE FUNCTION public.claim_scheduled_work_feedback(after_end_day boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=public.current_employee_id(); settings public.work_feedback_settings;
 local_now timestamp:=now() AT TIME ZONE 'Asia/Kolkata'; due timestamp; period_start date; claimed integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'An active employee session is required'; END IF;
 SELECT * INTO settings FROM public.work_feedback_settings WHERE id;
 IF NOT settings.enabled OR (settings.time_mode='end_day' AND NOT coalesce(after_end_day,false)) THEN RETURN NULL; END IF;
 due := public.feedback_person_due(actor,local_now::date,settings.frequency,settings.weekday,settings.time_mode,CASE WHEN settings.time_mode='end_day' THEN 0 ELSE settings.time_minutes END);
 IF due::date<settings.starts_on OR due>local_now THEN RETURN NULL; END IF;
 IF settings.time_mode='random' AND ((settings.weekday=0 AND extract(isodow FROM local_now)>5) OR local_now::time<time '10:00' OR local_now::time>=time '17:00') THEN RETURN NULL; END IF;
 period_start:=CASE WHEN settings.frequency='monthly' THEN date_trunc('month',local_now)::date WHEN settings.frequency='fortnightly' THEN date '2026-01-05'+floor((local_now::date-date '2026-01-05')::numeric/14)::integer*14 ELSE date_trunc('week',local_now)::date END;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,170002));
 IF EXISTS(SELECT 1 FROM public.work_feedback_prompts WHERE employee_id=actor AND week_start>=period_start)
 OR EXISTS(SELECT 1 FROM public.work_feedback WHERE employee_id=actor AND created_at>=(period_start::timestamp AT TIME ZONE 'Asia/Kolkata')) THEN RETURN NULL; END IF;
 INSERT INTO public.work_feedback_prompts VALUES(actor,period_start) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS claimed=ROW_COUNT;
 IF claimed=0 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('sound',settings.sound_enabled,'after_end_day',settings.time_mode='end_day');
END $$;
-- Old clients must not deliver timed prompts on End Day.
CREATE OR REPLACE FUNCTION public.claim_work_feedback_prompt() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.work_feedback_settings WHERE id AND time_mode='end_day') THEN RETURN false; END IF;
 RETURN public.claim_scheduled_work_feedback(true) IS NOT NULL;
END $$;
CREATE FUNCTION public.work_feedback_sound_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT sound_enabled FROM public.work_feedback_settings WHERE id AND public.current_employee_id() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.feedback_person_due(uuid,date,text,integer,text,integer),public.save_work_feedback_schedule(boolean,text,integer,text,integer,boolean),public.claim_scheduled_work_feedback(boolean),public.work_feedback_sound_enabled() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_work_feedback_schedule(boolean,text,integer,text,integer,boolean),public.claim_scheduled_work_feedback(boolean),public.work_feedback_sound_enabled() TO authenticated;

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
 RETURN jsonb_build_object('time_mode',settings.time_mode,'time_minutes',settings.time_minutes,'sound_enabled',settings.sound_enabled,'enabled',settings.enabled,'frequency',settings.frequency,'weekday',settings.weekday,'pulse',CASE WHEN pulse.id IS NULL THEN NULL ELSE to_jsonb(pulse) END,
 'next_due',public.feedback_schedule_due((now() AT TIME ZONE 'Asia/Kolkata')::date,settings.frequency,settings.weekday));
END $$;

NOTIFY pgrst, 'reload schema';
