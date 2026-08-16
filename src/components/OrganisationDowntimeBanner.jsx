import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import {
  downtimeCategoryLabel,
  formatDowntimeDuration,
} from '../utils/downtime';
import { formatAppClock } from '../utils/timezone';

const OrganisationDowntimeBanner = () => {
  const [event, setEvent] = useState(null);
  const [, setTick] = useState(0);

  const loadActive = useCallback(async () => {
    const { data, error } = await supabase.rpc('active_organisation_downtime');
    if (!error) setEvent(data?.[0] || null);
  }, []);

  useEffect(() => {
    void loadActive();
    const interval = window.setInterval(() => {
      void loadActive();
      setTick((current) => current + 1);
    }, 60_000);
    const changed = () => void loadActive();
    window.addEventListener('organisation-downtime-changed', changed);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('organisation-downtime-changed', changed);
    };
  }, [loadActive]);

  if (!event) return null;

  const elapsed = Math.max(0, (Date.now() - new Date(event.started_at).getTime()) / 1000);
  return (
    <div className="downtime-banner" role="status" aria-live="polite">
      <span className="downtime-banner-icon"><i className="ri-alarm-warning-line" /></span>
      <div>
        <strong>Organisation downtime active · {event.title}</strong>
        <span>{downtimeCategoryLabel(event.category)} · since {formatAppClock(event.started_at)} · {formatDowntimeDuration(elapsed)}</span>
      </div>
      <Link to="/timesheets">View downtime</Link>
    </div>
  );
};

export default OrganisationDowntimeBanner;
