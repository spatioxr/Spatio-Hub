import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

export default function useDailyReviews({ scope, employeeId, startDate, endDate, refreshKey }) {
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([scope, employeeId, startDate, endDate, retry]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = [];
        // Organisation months can exceed the API's default row limit.
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await supabase.rpc('scoped_daily_reviews', {
            requested_start_date: startDate,
            requested_end_date: endDate,
            requested_scope: scope,
            requested_employee_id: employeeId === 'all' ? null : employeeId,
          }).range(offset, offset + 499);
          if (cancelled) return;
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < 500) break;
        }
        setResult({ key: requestKey, refreshKey, rows });
      } catch (error) {
        if (!cancelled) setResult({ key: requestKey, refreshKey, error: error.message || 'Unable to load daily reports.' });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [requestKey, refreshKey, scope, employeeId, startDate, endDate]);

  const current = result?.key === requestKey && result.refreshKey === refreshKey ? result : null;
  return { current, retry: () => setRetry((value) => value + 1) };
}
