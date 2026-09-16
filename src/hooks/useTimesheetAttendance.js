import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { addAppDays } from '../utils/timezone';

// Reuse Attendance's server-authorised projection; never query private leave
// requests directly. Bound concurrency for organisation-wide selections.
export default function useTimesheetAttendance({ start, end, scope, members, loading }) {
  const [result, setResult] = useState({ rows: [], error: '', key: null });
  const [revision, setRevision] = useState(0);
  const employeeIds = members.map((member) => member.employee_id).sort().join(',');
  const key = `${scope}:${start}:${end}:${employeeIds}:${revision}`;

  useEffect(() => {
    let active = true;
    setResult({ rows: [], error: '', key: null });
    if (loading) return () => { active = false; };
    const load = async () => {
      const ids = employeeIds ? employeeIds.split(',') : [];
      const rows = [];
      try {
        for (let index = 0; index < ids.length; index += 4) {
          if (!active) return;
          const responses = await Promise.all(ids.slice(index, index + 4).map((id) => (
            supabase.rpc('scoped_attendance_month', {
              requested_start_date: start,
              requested_end_date: addAppDays(end, 1),
              requested_scope: scope,
              requested_employee_id: id,
            })
          )));
          for (const response of responses) {
            if (response.error) throw response.error;
            rows.push(...(response.data || []));
          }
        }
        if (active) setResult({ rows, error: '', key });
      } catch (error) {
        if (active) setResult({ rows: [], error: error.message || 'Unable to load approved leave.', key });
      }
    };
    void load();
    return () => { active = false; };
  }, [employeeIds, end, key, loading, scope, start]);

  const current = !loading && result.key === key;
  return {
    rows: current ? result.rows : [],
    loading: !current,
    error: current ? result.error : '',
    retry: () => setRevision((value) => value + 1),
  };
}
