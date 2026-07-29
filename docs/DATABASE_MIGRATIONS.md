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
Every returned boolean must be `true`. This verifies all 15 current tables,
RLS, anonymous denial, the 43 scoped policies, helper functions, seed
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

Run `supabase/verify/hrms_016_work_switching.sql` for the rollback-only atomic
work-switch check. It verifies shared session boundaries, separate automatic
entries, project/activity transitions, input guards, break-state denial,
break-excluded totals, and continued direct-write denial.

Run `supabase/verify/hrms_018_daily_report_workflow.sql` for the rollback-only
BOS/EOD work-day check. It verifies first-start BOS enforcement, report-neutral
switching, break-safe final End Day, EOD enforcement, attendance integration,
per-employee exemptions, and denial of the legacy bypass RPCs.

Run `supabase/verify/hrms_019_daily_report_settings.sql` for the rollback-only
BOS/EOD exception check. It verifies mandatory defaults, superadmin-only
changes, immediate saved values, actor-stamped old/new audit snapshots,
no-op handling, immutable history, and direct-write denial.

Run `supabase/verify/hrms_020_live_work_status.sql` for the rollback-only live
board check. It verifies Employee visibility of all active names and statuses,
In/Break/Out transition timestamps, permitted activity context, hidden
out-of-scope project context, the 24-hour stale flag, and anonymous/unlinked
denial.

Run `supabase/verify/hrms_044_people_directory.sql` for the rollback-only
People check. It verifies employee route denial, Manager project-team read-only
scope, Admin create/edit/deactivate behavior, superadmin role boundaries,
default leave/work settings, retained profiles, and denial of direct employee
inserts and deletes.

Run `supabase/verify/hrms_004_role_access.sql` for the rollback-only
authenticated-role RLS matrix. It verifies Employee self scope, Manager
assigned-team scope, Admin organisation read scope, Superadmin-only leave and
BOS/EOD controls, and direct-client write denial across all 15 Phase 1 tables.

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
