# Workload and costing — feedback 14 and 50

Authorised 16 September 2026. This extends HRMS-029/030 Analytics and HRMS-026
project detail, with HRMS-022/023/024 scoped records and corrections. The feedback
tracker is [HRMS Feedback Tracker](https://docs.google.com/spreadsheets/d/1nJBJlD2fnlaeBP-sUiGGA5yilEgZqSpOQqUlId9uugc/edit).

## User workflow

Workload & Costing in the sidebar opens `/analytics/workload`. Analytics remains
accessible at `/analytics`, including existing bookmarked filters. Week is the
default. Managers read provisional allocation hours here and copy them into their
existing scorecards/cost trackers. CSV exports remain a separate existing feature;
no new export, salary rate, payroll, invoice, or period approval is introduced.

People shows recorded time, provisional costing hours, total workload across all
projects and internal work, leave, and review flags. Select a person for daily and
context breakdowns and a reconciliation of each month's allowance. Project detail
shows assignments, contributors (including no-time assignees), leave in the selected
period, project-specific hours and each person's overall workload. Select a future
period to inspect upcoming approved leave. Projects → View project opens the same
view. Current assignments are labelled as such; no historical staffing plan is
inferred. Leave reasons are not returned.

## Calculation contract

The monthly allowance H defaults to **176 hours**, not an hourly pay rate. Admins
and Superadmins may append a reasoned baseline change effective in the current or
a future month through Work Setup. The latest version for the latest effective
month at or before the reporting month wins. Earlier months retain their baseline;
baseline versions are immutable. Before the first setting, H is 176.

1. Count company working days D using the attendance policy and holidays. Each day
   reserves H / D hours. Pre-joining dates do not fund work. If D is zero, the full
   allowance stays unallocated. Released people with work remain in historical
   reports; release-date proration is not inferred because no release date exists.
2. Approved working-day leave reserves its full or half daily share. Future leave
   can already reserve its share; other future days remain unallocated.
3. A working day's funded work share is `(H / D) × min(1 − leave fraction,
   eligible recorded seconds / 28,800)`. A day with any open timer, 24-hour session,
   future time, unconfirmed 12+ hour day, or work during full-day leave funds zero.
   Short days fund only the recorded fraction: extra hours on another day never
   cover missing hours. Weekend/holiday work does not create additional allowance.
4. Sum funded shares to form the person's monthly work pool P. Divide P among all
   eligible recorded project **and internal activity** seconds in that month,
   including valid weekend/holiday work, proportionally. Each day/context receives
   `P × context seconds / eligible monthly seconds`. Zero denominators yield zero.
5. `allocated work + leave reserve + unallocated = H`. Workload hours remain actual
   recorded time and may exceed H. Overtime changes the allocation split, never H.
6. Week/project/person filters slice these server results; they never recalculate
   the denominator. A week spanning two months uses both full monthly calculations
   and includes only the selected dates. All allocations remain provisional and
   can change after later entries or corrections. Round only when displaying hours;
   two-decimal displayed rows may differ from the displayed total by a centihour.

Sessions and breaks are intersected with IST calendar days. Entries beginning
before the month are included where they overlap it. This view intentionally
uses calendar-day slices; legacy Timesheets and recorded-time exports still group
sessions by their start date. Review links open the original session date.

Leave/missing-time reservation prevents a few recorded days from receiving the
full monthly allocation. Unknown time is not labelled productive, available, or
billable. Missing time and data problems keep the entire affected month's costing
figures labelled Needs review, even when a selected week has no local problem.

## Flags and actions

- Above eight hours: factual workload signal, not a costing premium or rejection.
- More than twelve hours: provisional review threshold. An Admin/Superadmin
  confirms the complete day with a reason or corrects it in Timesheets.
- Open timers: live time displayed separately, no allocation on that day. A timer
  from a previous day enters the review queue; a session spanning 24 hours is
  flagged even if it has subsequently been closed.
- Future end times and work during full-day approved leave require correction.
- Past working dates below the available eight-hour baseline show missing or
  incomplete time. A short, otherwise valid day retains its proportional share.
- Confirmations are immutable and tied to the entries/breaks snapshot. Editing a
  confirmed day invalidates its confirmation. They are not timesheet approvals.
- Admins/Superadmins can resolve a previous-day timer with its actual end and a
  reason. Existing breaks may not be contradicted. Entry/break before-and-after
  values are audited. No end time or EOD text is invented. Other corrections and
  voids remain in the existing Timesheets flow.

## Permission boundary

`workload_month` is manager/admin/superadmin only, validates the active/password
state, and returns one bounded month as JSON so PostgREST row limits cannot silently
truncate monthly denominators. Admins see organisation data. Managers see current
team members/assigned managers and contributors to owned projects; other-project
hours are aggregated without project identifiers, task descriptions or entry IDs.
Internal work participates in the denominator; its workload context is aggregated
for Managers. Existing team-internal Timesheet detail access is retained.

The new immutable baseline/review tables have RLS and SELECT-only client grants;
writes use guarded RPCs. Managers can read only their own review notes; Admins
can inspect all review history. The private day calculator has no client execution grant.
Raw work-entry RLS, break/audit access, scoped active/voided timesheet RPCs and change
history now consistently exclude other projects' entries from Manager detail reads.
Full-day confirmation and stale-timer resolution are Admin/Superadmin-only. Managers
see flags but cannot confirm them. Employees cannot read management workload or settings.

## Release and verification

Apply `20260916000100_workload_costing.sql` before deploying the UI. The app shows an
explicit retryable error if the API is unavailable; it never fabricates allocations
from partially loaded legacy rows. Refresh and window focus reload the snapshot;
there is no background polling or unsolicited external messaging.

Run `npm run check` and the rollback-only `supabase/verify/workload_costing.sql`.
It covers allowance conservation, internal allocation, missing/half-leave reserves,
midnight/month/break splits, stale correction audit, long-day confirmation and
invalidation, baseline effective dates, active actor checks and real-role RLS.
The verifier is registered first in `npm run test:database`.

For rollback, deploy the previous frontend first. Keep the tables/audit history;
do not delete data. The raw manager read-scope tightening is intentional and should
remain unless the permission contract is explicitly changed.

### Local verification — 16 September 2026

- `npm run check`: lint, 139 unit tests and production build passed.
- All repository migrations applied successfully to isolated PostgreSQL 18 with
  synthetic Supabase Auth/Storage schema adapters; 37 focused workload checks passed.
- Related HRMS-004, HRMS-022, HRMS-024, HRMS-026 and daily-review verifiers passed.
- Synthetic Chrome smoke checks passed at 1440px and 390px: weekly person/project
  views, no-time roster members, leave coverage, confirmation action, stale-timer
  dialog, keyboard dismissal, baseline save and no page-level horizontal overflow
  or browser errors. Screenshots were inspected.
- This is local verification. No production migration, deployment or tracker
  completion update was performed.

### Shared database installation — 16 September 2026

After the localhost preview reported “Workload unavailable”, confirmed that
`workload_month(date)` and `costing_baselines` were absent from spatio-people
(`kuelyansmnumhwwfyboi`). With explicit user approval, applied
`20260916000100_workload_costing.sql` through the authenticated SQL Editor;
the transaction completed successfully.

All 37 rollback-only workload verification checks passed on the shared database.
A read-only September workload call under the authenticated role with an active,
password-cleared management identity returned 23 people, 9 projects, and the
176-hour baseline within an eight-second statement timeout. The local preview
can now use the installed backend after refresh. Its separate signed-in browser
session was not accessible for an end-to-end page check. No frontend production
deployment or issue status change was performed.

### Review workflow refinement — 16 September 2026

User clarified that resolution should use the existing Admin boundary (including
Superadmin), not the Leave Admin assignment. Migration
`20260916000300_admin_workload_review.sql` restricts both the returned `can_review`
capability and the confirmation RPC; stale-timer resolution already required Admin.
Applied successfully to the shared database. Manager project visibility is unchanged.

Workload & Costing now has its own sidebar item. The calculation explanation is
available at the top; the allocation formula itself is unchanged. Review filters
separate incomplete time, long days, and invalid/stale records. Confirm correct
requires a reason; Needs correction opens the existing timesheet in an embedded
drawer with the selected person/day and Add time/correction/history tools. Closing
refreshes the queue without losing its filter, period, or selected person. Resolved
flags disappear based on corrected source records, with confirmed days separately
visible and entry corrections retained in timesheet history. No arbitrary dismissal
of invalid hours or fabricated replacement time is introduced.

Lint, 147 unit tests, build, and 40 database assertions passed. The 40 assertions
also passed against the shared database with RLS enabled on the temporary test table
and all test records rolled back. Browser inspection
confirmed the separate navigation and the live-data correction drawer's person,
date, and correction controls. Concurrent external-observer work was preserved.

### Short-day confirmation and presentation — 16 September 2026

Applied `20260916000500_confirm_short_workdays.sql` to the shared database.
Admins/Superadmins can confirm completed, nonzero short days with a reason.
The fingerprint-based confirmation clears the missing-time review flag without
changing the funded allocation: unworked hours remain unallocated. Below-eight
hours remains an informational label, matching above-eight hours. Empty days,
open timers, stale/future records and leave conflicts cannot be dismissed this way.
Editing confirmed records reopens review. All 43 database assertions passed both
locally and on the shared database (rollback-only test records).

The costing guide is now at the bottom, with three steps, a proportional-allocation
example and separate explanations of provisional weeks and zero allocations.
The correction drawer has inset margins, a rounded frame, a loading indication,
locked background scrolling and opens at the selected day's detail. Returning
retains the review period and filters. No employee records were changed for UI checks.
