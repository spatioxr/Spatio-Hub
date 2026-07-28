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
Every returned boolean must be `true`. This verifies all 14 current tables,
RLS, anonymous denial, the 43 scoped policies, helper functions, seed
activities, and overlap guards.

Run `supabase/verify/hrms_007_projects.sql` for the rollback-only project model
check. It creates and archives a temporary project inside a transaction, checks
manager ownership and enforcement objects, then rolls everything back.

Run `supabase/verify/hrms_008_activities.sql` for the rollback-only activity
catalogue check. It creates and archives a temporary activity, confirms the
five Phase 1 seeds remain selectable, verifies historical label retention and
the archived-activity work-entry guard, then rolls everything back.

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
