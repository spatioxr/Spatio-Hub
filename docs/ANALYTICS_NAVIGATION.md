# Analytics navigation — feedback 55

Scope: [feedback 55](https://docs.google.com/spreadsheets/d/1nJBJlD2fnlaeBP-sUiGGA5yilEgZqSpOQqUlId9uugc/edit?gid=0#gid=0), within Phase 1 issues HRMS-030 (filters and drill-down) and HRMS-046 (role-aware navigation).

## Behaviour

- Chart clicks toggle only the selected dimension, preserving the other project, activity, department and employee filters. Project/activity selections retain the existing OR rule; department/employee retain the existing AND rule.
- Supporting entries show removable active filters, Clear all filters, Back to charts and Edit filters. Drill-down starts at the top of the entries list and moves keyboard focus into the section. Returning restores focus to the selected chart button, or the chart group if that button is no longer present. Scrolling respects reduced-motion preferences.
- Applied dates and filters are stored in the URL. Browser Back/Forward restore the corresponding view. The current tab also remembers the last view separately for each signed-in user, allowing the plain Analytics sidebar link to restore it. If session storage is unavailable, URL navigation still works.
- Applying a reporting period preserves filters. Reapplying unchanged dates does not clear the selection or refetch. A retained filter with no work in the new period remains visible and removable; it does not silently widen the results.
- Restored dates are validated against actual calendar dates, end >= start, no future dates, with no duration cap. Invalid dates fall back to the current Monday–Sunday week through today. Older in-flight requests cannot overwrite a newer period.
- The scoped Supabase RPCs and role permissions remain the authority for data access.

## Verification

`npm run check` covers lint, unit tests and the production build. Six focused tests in `src/utils/analyticsNavigation.test.js` cover combined-filter toggles, URL restoration, range changes, clearing, invalid date ranges and retained options.

Browser verification uses the actual Analytics page and navigation hook in a temporary local fixture with synthetic data and mocked authentication/RPCs. Checks include:

- combined project/activity selections, chart deselection and department drill-down;
- Back to charts and Edit filters, including keyboard-focus restoration;
- unchanged and changed reporting periods without filter loss;
- navigating away and returning via browser Back or a plain Analytics link, and reloading;
- an empty reporting period with a retained filter;
- 390px mobile layout with wrapped navigation/filter controls and no document horizontal overflow;
- no browser console errors during the checked flows.

These checks do not constitute deployment or a live multi-role production smoke test. Leave feedback 55 pending production verification until deployed and checked there.

## Week, month and unrestricted custom periods (September 2026)

- Analytics now offers Week / Month / Custom in a single toolbar. Weeks run Monday–Sunday; the current week/month queries only through today, using IST. Previous/next and a calendar/month picker support jumps. Custom offers two calendars (one on mobile), explicit date inputs, Apply/Cancel, and Last 30 days / Last 90 days / This year / All time shortcuts.
- The URL and per-user session selection include `period`. Historical custom ranges have no 31-day cap. Future and invalid dates remain disallowed. Period changes preserve all filters. All time starts at the earliest RLS-visible work or downtime record.
- `20260917000100_analytics_reporting.sql` adds `analytics_entries` and a server-aggregated `analytics_summary`. Both retain the Timesheet employee/managed/organisation authorization boundary; Analytics accepts only managed or organisation scope. Existing Timesheet RPC limits are unchanged. This migration was applied to production on 17 September 2026; see the deployment record below.
- If the Analytics RPCs are unavailable, the client falls back to paginated 31-day Timesheet windows and aggregates them incrementally. This compatibility path supports long ranges immediately but can be slower. Pages use a stable unique work ID. Downtime uses non-overlapping windows and sums clipped durations by event ID.
- Charts load summary groups; supporting entries load on demand or on chart drill-down. Entries render 200 at a time with Show more. CSV exports fetch all matching entries and are not limited to the visible rows. No partial result is presented as complete after a failed page.
- A bounded, 30-second in-memory cache is keyed by user, role scope, dates and summary/detail mode. Changing dates immediately masks previous results with skeleton placeholders while preserving the result area height. One fixed-width status beside the date controls says Loading results; no extra banner shifts the page. Hidden results are inert and excluded from accessibility navigation; exports remain disabled until the selected period finishes. The selected and settled period keys are compared during render, preventing a frame of old totals under new dates before the fetch effect runs. Stale requests cannot overwrite newer selections.
- Focused tests cover leap months, week/year boundaries, long ranges, URL mode restoration, pagination over 1,000 sessions, incremental aggregation and downtime merging. Browser checks cover a real 90-day local view and desktop/mobile picker layouts. Production database execution and role checks are recorded below.

## Production deployment — 17 September 2026

Applied `supabase/migrations/20260917000100_analytics_reporting.sql` to the **spatio-people** production project (`kuelyansmnumhwwfyboi`) using the authenticated Supabase SQL Editor. Both functions were absent before deployment. The migration ran in one transaction with a PostgREST schema reload notification and committed successfully. No employee, work-entry, break or other business records were changed.

The project has no `supabase_migrations.schema_migrations` table. This is a dashboard-applied deployment record, not a claim that CLI migration history is synchronized. Reconcile the existing database baseline before using a future blanket `supabase db push`; do not replay all historical migration files blindly.

Post-deployment verification:

- Stored function bodies match the committed migration: `analytics_entries` MD5 `23242294912ebf4d7220b8d54a439335`; `analytics_summary` MD5 `14baeba79ff1f0cd94f4be38b0ecb0f4`.
- Both functions allow `authenticated` execution and deny `anon`; the entries function remains security definer, the summary remains security invoker, and both pin `search_path=public`.
- Rollback-only checks under the `authenticated` database role used existing active accounts. Admin and superadmin results for 1 July–16 September (78 days) each matched the existing 31-day Timesheet windows across 860 sessions, including worked seconds and summary session totals.
- The sampled manager's managed result matched the existing RPC (zero sessions for that account); this does not establish coverage of a populated manager assignment. Manager organisation access and employee organisation/managed access were rejected. Missing employee sessions were rejected. Admin and superadmin managed-scope requests were also rejected as designed.
- Verification used transaction-local JWT claims and temporary result tables, then rolled back; no account roles or business data were modified.
- Live production UI smoke: reloaded Analytics for 29 July–17 September, confirmed charts and 886 sessions, then loaded supporting entries (200 displayed with Show more). No browser warning/error logs were reported in this checked flow. This was a superadmin UI smoke, not a complete multi-role UI acceptance test.
