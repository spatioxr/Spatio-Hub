# Timesheet daily reviews

HRMS-021/HRMS-022 follow-up, authorised September 5, 2026: expose the existing
BOS/EOD records for day and period reviews without introducing Performance,
review comments, ratings, approval periods or a separate Reports module.

## Review flow

Open Timesheets, choose Personal, Managed by me or Organisation, and select a
person and a week/month. Plans and summaries shows the selected day's report
text and submission timestamps in IST. Period review displays all recorded days
in that week/month together. View tasks selects that person/date and scrolls to
the existing task timeline. Person and department filters apply to reports;
project/activity filters apply only to sessions because daily reports describe
an entire workday.

Submitted means report text exists. Pending means no submission is recorded,
not that a deadline was missed. Currently exempt reflects the employee's
current settings, not a historical exemption: requirements are not snapshotted
by date. Recorded workdays without reports are included; dates with no reports,
check-in or non-voided work are omitted rather than marked missing. Report-only
days remain reviewable. Reopening clears EOD through the existing workflow and
the refreshed review then shows it as pending (or currently exempt).

## Database boundary

Migration `20260905000300_timesheet_daily_reviews.sql` adds one read-only,
authenticated RPC, `scoped_daily_reviews`, with a maximum inclusive 31-day range.
It uses `timesheet_scope_members` for role/scope validation, active members only,
and `can_access_employee`, the same predicate enforced by daily_reports SELECT
RLS. Employee reads remain self-only, Manager reads remain assigned-team-only,
and Admin/Superadmin may read organisation records. Anonymous execution is
revoked. Existing report and settings write policies remain unchanged. The RPC
returns only the two current report requirement flags from work settings.

The frontend paginates in batches of 500 and discards responses for superseded
scope, person or period requests. Report errors have their own retry state and
do not stop existing timesheet tasks from loading.

## Validation and release

- Local application gate passed: ESLint, 114 unit tests and production build.
  Synthetic Chrome checks passed for selected-day/period views, exemption text,
  person/date drill-down and no browser errors; screenshots were inspected at
  1280px and 390px, with no mobile horizontal overflow. This is component QA,
  not a signed-in production or database-backed smoke test.
- Focused unit tests cover submission/exemption precedence, cleared EOD, and
  person/department/date filtering including report-only days.
- `supabase/verify/timesheet_daily_reviews.sql` runs rollback-only actual-role
  RPC and direct-table RLS checks, including denied organisation scope, forged
  person selection, anonymous access, password gates, and range limits. It is
  registered before the pre-existing HRMS-010 verifier in the database runner.
- Run `npm run check`, then apply migrations to an isolated Supabase stack and
  run `npm run test:database` before production release.
- This workspace lacks Docker and PostgreSQL client tools. On September 5,
  2026, the migration was applied through the signed-in production Supabase SQL
  editor. All 12 focused rollback-only checks passed against the hosted database,
  including four-role scope, direct report RLS, password gates and anonymous
  denial. Test fixtures were rolled back.
- Release requires the database migration before the frontend deployment.
  Rollback: redeploy the previous frontend first; then optionally drop
  `public.scoped_daily_reviews(date,date,text,uuid)`. No stored reports change.
