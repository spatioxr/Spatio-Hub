# Database Migrations

`supabase/migrations` is the only canonical Phase 1 schema history. Apply files
in filename order. The legacy root-level `supabase_updates*.sql` files are
historical references and must not be used to provision or update an
environment.

## Current order

1. `20260728000100_phase1_foundation.sql` creates Auth-linked employee profiles,
   attendance, BOS/EOD reports, leave data, helper functions, and their RLS.
2. `20260728000200_work_tracking_foundation.sql` creates projects, activities,
   assignments, session-based work entries, breaks, audit storage,
   per-employee BOS/EOD settings, constraints, indexes, and matching RLS.
3. `20260728000300_auth_mapping.sql` links any already-created Supabase Auth users
   to employee profiles by a case-insensitive email match.
4. `20260729000100_project_invariants.sql` adds atomic project creation with
   initial manager ownership, active-manager guards, and controlled
   archive/restore operations.
5. `20260729000200_activity_invariants.sql` adds controlled activity creation
   and archive/restore operations, prevents authenticated hard deletion, and
   preserves labels after work has been logged against an activity.
6. `20260729000300_project_assignments.sql` adds controlled Manager and team
   assignment operations, stamps the assigning employee, and makes explicit
   project membership the Manager visibility boundary.
7. `20260729000400_work_sessions.sql` adds server-controlled start, current,
   and end operations for project/activity work sessions and denies direct
   authenticated session writes.
8. `20260729000500_work_breaks.sql` adds server-controlled break/resume state,
   break-excluded worked-duration calculation, and denies direct authenticated
   break writes.
9. `20260729000600_daily_reports.sql` enforces server-stamped BOS/EOD
   submissions, creates mandatory-default settings for every employee, and
   restricts requirement changes to a superadmin-controlled function.
10. `20260729000700_work_entry_audit.sql` adds controlled manual time-entry
    creation and correction, mandatory reasons, atomic old/new audit snapshots,
    Manager project-team scope, and immutable audit history.
11. `20260729000800_work_session_switching.sql` adds an atomic context-switch
    operation that closes the current entry and starts its replacement at one
    shared timestamp while preserving break and assignment guards.
12. `20260729000900_daily_report_workflow.sql` integrates the first work start
    and final End Day with BOS/EOD reports and attendance, preserves switching
    as a report-neutral session boundary, and routes authenticated clients
    through the enforced work-day operations.
13. `20260729001000_daily_report_settings_audit.sql` adds immutable audit
    history for per-employee BOS/EOD exceptions, keeps changes behind the
    superadmin RPC, and publishes setting updates so an affected timer refreshes
    its saved requirements immediately.
14. `20260729001100_live_work_status.sql` adds the authenticated company
    In/Break/Out projection, status-transition timestamps, permission-aware
    project context, and a 24-hour stale-open-entry signal without widening
    direct employee or work-entry RLS.
15. `20260729001200_people_directory.sql` adds controlled employee-profile
    creation and editing, safe employment-status deactivation, superadmin role
    boundaries, Manager project-team visibility, and denial of direct employee
    inserts and deletes.
16. `20260729001300_admin_settings_boundary.sql` adds the authenticated
    Admin/Superadmin settings capability and restricts granting or removing
    privileged Admin and Superadmin roles to Superadmin.
17. `20260729001400_personal_timesheet.sql` adds a self-only daily and weekly
    timesheet projection with project/activity context, task descriptions,
    break detail, and break-excluded worked durations.
18. `20260729001500_scoped_timesheets.sql` adds Personal, managed-project-team,
    and organisation timesheet projections with server-enforced role scope and
    permitted-employee selection.
19. `20260729001600_manual_time_entries.sql` adds the role-scoped manual-entry
    workflow for completed sessions, including project/activity, task, time
    range, break replacement, mandatory reasons, overlap rejection, and atomic
    immutable audit snapshots.
20. `20260729001700_work_entry_change_history.sql` adds a read-only,
    role-scoped audit projection with editor identity, timestamp, reason, and
    readable before/after snapshots for the Timesheets change-history drawer.
21. `20260729001800_project_administration.sql` adds the Manager/Admin project
    administration projection, owned-project assignment candidate lookup, and
    controlled Admin/Superadmin project-definition edits.
22. `20260729001900_activity_administration.sql` adds the Admin/Superadmin
    activity projection and definition-update function and denies direct
    authenticated activity writes.
23. `20260730000100_kolkata_time_standard.sql` makes Asia/Kolkata the explicit
    work-day boundary for BOS/EOD, attendance, sessions, and reports while
    preserving UTC-safe timestamps.
24. `20260730000200_leave_balance_workflow.sql` makes leave submission,
    pending edits, approval/rejection, balance deduction, and Comp Off grants
    controlled atomic operations and closes direct client balance mutations.
25. `20260730000300_harden_leave_workflow.sql` rejects overlapping active
    leave requests at the database boundary for both submissions and edits.
26. `20260730000400_comp_off_granularity.sql` restricts Comp Off grants to
    positive whole-day or half-day units while preserving atomic increments.
27. `20260802000100_hrms_046_manager_live_context.sql` adds permission-aware
    project/activity context to the Manager+ live-status rail without widening
    employee or work-entry table access.
28. `20260802000200_temporary_password_credentials.sql` adds the
    Superadmin-issued temporary-password state, protects the credential
    metadata, blocks Phase 1 writes until replacement, and keeps forced users
    limited to their own profile while changing the credential.
29. `20260806000100_employee_archive_access.sql` makes the retained
    `Released`/Archived employee state a complete portal-access boundary for
    catalogue reads and self-profile changes while preserving the profile for a
    clear refusal message and later restoration.
30. `20260806000200_optional_task_descriptions.sql` adds audited per-employee
    and all-active-employee task-description controls, keeps task descriptions
    required by default, and enforces the saved rule when starting or switching
    a work session.
31. `20260806000300_live_status_first_check_in.sql` keeps the live board's In
    timestamp anchored to the first work entry of the current Asia/Kolkata day
    when switching context opens a replacement entry.
32. `20260806000400_start_and_switch_task_rules.sql` removes task-description
    configuration, omits descriptions on the first work start, requires them
    on context switches, and restores BOS/EOD-only superadmin settings.
33. `20260806000500_reopen_work_day.sql` allows an employee to reopen the same
    Asia/Kolkata workday after End Day, preserves the original BOS and check-in,
    clears the provisional EOD and attendance check-out atomically, and requires
    a fresh EOD on the next final End Day.
34. `20260815000100_live_status_check_in_and_status_since.sql` separates the
    live board's original daily check-in from the current context, break, or out
    transition time so context switches no longer appear to reset check-in.
35. `20260815000200_live_status_attendance_times.sql` makes the live board use
    the official daily attendance check-in/check-out with work-entry fallbacks,
    exposes an active break time separately, and removes context-switch timing
    from the attendance display.
36. `20260815000300_daily_work_mode.sql` adds a nullable historical-safe daily
    Office/WFH attendance mode, a backward-compatible first-start overload,
    audited manual add/correction overloads, and scoped live/timesheet mode
    projections without adding physical-location tracking.
37. `20260815000400_leave_administration_reset.sql` adds delegated Leave Admin
    access, one Monday-Friday/holiday working-day engine, pending-only requests,
    self-decision guards, audited balance adjustments, an immutable balance
    ledger, controlled holiday management, and optional late-cutoff policy.
38. `20260815000500_attendance_month_projection.sql` adds durable factual
    attendance timestamps, closes direct attendance writes, and exposes a
    personal/team/organisation-scoped read-only month projection combining
    work sessions, breaks, approved leave, holidays, WFH, and lateness.
39. `20260815000600_dashboard_visual_sync.sql` adds existing employee profile
    pictures to the authenticated live-status projection and exposes the
    signed-in employee's reporting manager through a narrow self-scoped
    function for the Dashboard.

Future schema work must be added as a new timestamped migration. Never edit a
migration after it has been applied to a shared project; add a corrective
migration instead.

## Clean project

With the Supabase CLI installed and Docker running:

```bash
supabase start
supabase db reset
```

For a linked cloud project:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

The current `spatio-people` project received the three baseline migrations
through the Dashboard while the migration workflow was being introduced. After
linking the CLI for the first time, record that verified baseline once before
the next `db push`:

```bash
supabase migration repair --linked --status applied \
  20260728000100 20260728000200 20260728000300
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must report that the remote database is up to date. Do not edit the
`supabase_migrations` schema manually; use `migration repair`.

Do not commit database passwords, access tokens, service-role keys, or local
Supabase state. Create the Auth user separately, then rerun the Auth-mapping
statement if the profile was created before the Auth identity. The application
also supports claiming an unlinked profile with the same verified email on
first sign-in.

## Verification

Run `supabase/verify/phase1_schema.sql` in the SQL editor after migrations.
Every returned boolean must be `true`. This verifies all 17 current tables,
RLS, anonymous denial, the 45 scoped policies, helper functions, seed
activities, and overlap guards.

Run `supabase/verify/hrms_007_projects.sql` for the rollback-only project model
check. It creates and archives a temporary project inside a transaction, checks
manager ownership and enforcement objects, then rolls everything back.

Run `supabase/verify/hrms_008_activities.sql` for the rollback-only activity
catalogue check. It creates and archives a temporary activity, confirms the
five Phase 1 seeds remain selectable, verifies historical label retention and
the archived-activity work-entry guard, then rolls everything back.

Run `supabase/verify/hrms_009_project_assignments.sql` for the rollback-only
assignment check. It verifies admin and owned-project Manager assignments,
strict Manager and employee project scope, assignment actor stamping, and
denial outside Manager ownership, then rolls everything back.

Run `supabase/verify/hrms_010_work_sessions.sql` for the rollback-only
session-model check. It verifies activity and project sessions, exactly-one
target enforcement, ordered non-overlapping sessions, current-session lookup,
department derivation, and denial of direct authenticated writes.

Run `supabase/verify/hrms_011_work_breaks.sql` for the rollback-only simple
break check. It verifies Working/Break transitions, repeated-click denial,
current-break restoration, break-excluded duration, the overlap guard, and the
absence of break categories.

Run `supabase/verify/hrms_012_daily_reports.sql` for the rollback-only daily
report check. It verifies one row per employee/date, mandatory-default settings,
server-controlled submission timestamps, automatic settings creation, and
superadmin-only BOS/EOD exceptions.

Run `supabase/verify/hrms_013_work_entry_audit.sql` for the rollback-only
correction audit check. It verifies audited manual creation and correction,
required reasons, old/new snapshots, Manager project-team scope, employee and
out-of-scope denial, immutable audit rows, and continued direct-write denial.

Run `supabase/verify/hrms_015_optional_task_descriptions.sql` for the
rollback-only task-description workflow check. It verifies description-free
first starts, mandatory described switches, atomic switch rejection, removed
task-description configuration, retained audited BOS/EOD control, and scoped
function privileges.

Run `supabase/verify/hrms_016_work_switching.sql` for the rollback-only atomic
work-switch check. It verifies shared session boundaries, separate automatic
entries, project/activity transitions, input guards, break-state denial,
break-excluded totals, and continued direct-write denial.

Run `supabase/verify/hrms_018_daily_report_workflow.sql` for the rollback-only
BOS/EOD work-day check. It verifies first-start BOS enforcement, report-neutral
switching, break-safe final End Day, EOD enforcement, attendance integration,
same-day reopening with a fresh final EOD, per-employee exemptions, and denial
of the legacy bypass RPCs.

Run `supabase/verify/hrms_019_daily_report_settings.sql` for the rollback-only
BOS/EOD exception check. It verifies mandatory defaults, superadmin-only
changes, immediate saved values, actor-stamped old/new audit snapshots,
no-op handling, immutable history, and direct-write denial.

Run `supabase/verify/hrms_020_live_work_status.sql` for the rollback-only live
board check. It verifies Employee visibility of all active names and statuses,
In/Break/Out transition timestamps, permitted activity context, hidden
out-of-scope project context, the 24-hour stale flag, and anonymous/unlinked
denial.

Run `supabase/verify/hrms_049_dashboard_sync.sql` to confirm the live-status
projection includes profile photos, the self-scoped reporting-manager function
exists, anonymous execution remains denied, and authenticated execution is
available.

Run `supabase/verify/hrms_044_people_directory.sql` for the rollback-only
People check. It verifies employee route denial, Manager project-team read-only
scope, Admin create/edit/deactivate behavior, superadmin role boundaries,
default leave/work settings, retained profiles, and denial of direct employee
inserts and deletes.

Run `supabase/verify/hrms_045_admin_settings.sql` for the rollback-only Admin
Settings check. It verifies Employee and Manager denial, Admin access to
standard People controls, denial of Admin privileged-role changes,
Superadmin promotion/demotion authority, and restricted function execution.

Run `supabase/verify/hrms_042_temporary_passwords.sql` for the rollback-only
credential gate check. It verifies the required employee fields, all 15 write
triggers, self-only profile visibility during first login, denied application
identity until replacement, and denial of direct credential-state changes.

Run `supabase/verify/hrms_021_personal_timesheet.sql` for the rollback-only
personal-timesheet check. It verifies self-only weekly scope, project and
activity context, task descriptions, break detail, break-excluded totals,
bounded ranges, and denial for anonymous or unlinked identities.

Run `supabase/verify/hrms_022_scoped_timesheets.sql` for the rollback-only
role-scope check. It verifies Employee personal-only access, Manager
project-assigned team access, Admin/Superadmin organisation access,
out-of-scope employee denial, member visibility, and restricted function
execution.

Run `supabase/verify/hrms_023_manual_time_entries.sql` for the rollback-only
manual-entry check. It verifies Admin organisation and Manager assigned-team
creation, permitted context choices, session and break correction, mandatory
reasons, overlap and invalid-break rejection, Employee and out-of-scope
denial, atomic audit snapshots, and continued direct-write denial.

Run `supabase/verify/hrms_024_change_history.sql` for the rollback-only
change-history check. It verifies readable creation and correction snapshots,
editor/timestamp/reason fields, Employee own, Manager assigned-team, and
Admin/Superadmin organisation scope, out-of-scope denial, authenticated-only
function execution, and continued audit immutability.

Run `supabase/verify/hrms_026_project_administration.sql` for the rollback-only
project-administration check. It verifies controlled definition edits,
Manager-owned project visibility, assignment summaries, owned-project
candidate lookup, denial outside Manager ownership, and restricted function
availability.

Run `supabase/verify/hrms_027_manager_assignment_boundaries.sql` for the
rollback-only assignment-boundary check. It verifies Manager add/remove only
on owned projects, duplicate denial, project-setup denial, Admin override,
Employee denial, hidden administration projection, and the membership primary
key.

Run `supabase/verify/hrms_028_activity_administration.sql` for the rollback-only
activity-administration check. It verifies Admin and Superadmin create/edit/
archive capability, Manager and Employee denial, controlled-function-only
writes, active selection, archived historical reporting, stable historical
labels, and the agreed seed catalogue.

Run `supabase/verify/hrms_029_work_distribution.sql` for the rollback-only
analytics-source check. It verifies organisation totals for worked and break
time, project/activity separation, department and employee dimensions, and
server-side denial of organisation scope to Employee and Manager roles.

Run `supabase/verify/hrms_032_timezone_duration.sql` for the rollback-only
timezone check. It verifies the Asia/Kolkata midnight boundary and clock
conversion, fixed 24-hour report days, isolation from US daylight-saving
changes, and explicit timezone configuration on BOS/EOD workflow functions.

Run `supabase/verify/hrms_033_leave_balances.sql` for the rollback-only leave
correctness check. It verifies seeded remaining balances, edit/rejection
neutrality, exactly-once approval deductions, exact half-day arithmetic,
pending-only privileged requests, Comp Off grants, and direct-write denial.

Run `supabase/verify/hrms_034_leave_workflow.sql` for the rollback-only core
leave hardening check. It verifies default Superadmin organisation review,
Employee/Admin scope, half-day and reason handling, overlap rejection,
approval/rejection status, and balance outcomes.

Run `supabase/verify/hrms_035_holidays_comp_off.sql` for the rollback-only
holiday and Comp Off check. It verifies authenticated holiday reads with exact
date values, Superadmin-only grants, half-day grant granularity, single
deduction on approval, and matching final balance and request data.

Run `supabase/verify/hrms_048_attendance_leave_reset.sql` for the rollback-only
reset contract. It verifies delegated Leave Admin access, working-day and
holiday charges, editable pending requests, all-request queueing, self-decision
and self-adjustment denial, reasoned rejection, immutable ledger entries,
approved-leave Attendance projection, original-check-in late timing, employee
scope, anonymous denial, and direct Attendance write denial.

Run `supabase/verify/hrms_004_role_access.sql` for the rollback-only
authenticated-role RLS matrix. It verifies Employee self scope, Manager
assigned-team scope, Admin organisation read scope, Superadmin-only leave and
BOS/EOD controls, and direct-client write denial across all 17 Phase 1 tables.

## Rollback

Production rollback should restore the pre-migration Supabase backup into a
new project and switch the application only after validation. Dropping tables
in place is intentionally not automated because it permanently deletes work
and audit history.

For an empty development project only, reverse migration 002 by dropping its
objects in dependency order:

1. `work_entry_audit`, `break_entries`, `work_entries`
2. `project_members`, `project_managers`
3. `employee_work_settings`, `activities`, `projects`
4. `can_access_work_entry`, `can_access_project`, `can_manage_project`,
   `guard_project_manager_role`, and `set_updated_at`

Migration 003 can be logically reversed by setting the affected
`employees.auth_id` values to `NULL`; do this only after confirming those
profiles should no longer sign in. Migration 001 owns operational employee,
attendance, report, and leave history and must be rolled back through backup
restoration, not destructive table drops.
