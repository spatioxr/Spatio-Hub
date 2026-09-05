# Testing

HRMS-038 establishes two automated test layers for Phase 1.

## Application rules

Run the deterministic Node tests and production build:

```sh
npm run test:ci
```

The unit suite covers timer state transitions, elapsed-duration behaviour,
start-versus-switch task-description validation, working-day and holiday leave
precision, attendance states and summaries, delegated Leave Admin access, and
the role permission matrix. It also guards the live-board egress contract:
one visibility-aware status request, 60-second fallback polling, private
Storage-backed avatars, and one-time legacy base64 migration.

## Database rules

Start the local Supabase stack, then run the rollback-only database suite:

```sh
npx supabase start
npm run test:database
```

The database suite verifies server-enforced role access, duplicate timer and
break actions, overlapping entries, BOS/EOD enforcement, correction
authorization and audit history, mandatory switch descriptions, description-free
first starts, same-day workday reopening with a replacement final EOD, duration
totals, pending-only leave routing, self-review denial, working-day charges,
immutable balance history, factual Attendance projection, original-check-in
late timing, leave balance single-deduction behaviour, and the private
employee-avatar Storage/RLS boundary. The
HRMS-044 archive check additionally verifies
that Admin/Superadmin can archive and restore users, history remains intact,
and an archived Auth identity cannot read Phase 1 catalogue data or update its
profile.

`test:database` uses the standard local Supabase database container. It can
instead use an external PostgreSQL client when `DATABASE_URL` is set; the URL
is parsed into PostgreSQL environment variables and is not passed on the
process command line.

Both layers run in `.github/workflows/critical-tests.yml`. Database tests start
an isolated local Supabase stack, reset it from the committed migrations and
local-only test seed, execute every critical verification inside a rollback-only
transaction, and stop the stack.

## Launch smoke gate

`HRMS-041` adds a four-role rollback-only launch journey in
`supabase/verify/hrms_041_role_launch_smoke.sql`. For employee, manager, admin,
and superadmin it verifies:

- authenticated employee-profile resolution
- start work, break, resume, context switch, and end day
- personal timesheet and project scope
- People and Admin Settings visibility
- own leave submission

The same run verifies manager-assigned timesheet scope and matching
organisation scope for admin and superadmin. The database runner also includes
the focused personal/organisation timesheet, project, activity, leave, People,
and Admin Settings suites so the launch gate cannot pass by exercising only
the happy-path timer flow.

Every database verification runs inside its own transaction and ends with
`ROLLBACK`; launch fixtures must never remain in the target database.

## Admin HR feedback verification (September 5)

`admin_hr_feedback.sql` verifies Admin leave/downtime access without delegated
flags, organisation history, holiday changes, audited adjustments, half-day
approval deductions, self-action denial, negative-balance/granularity/reason
guards, and archived/password-reset identity denial. HRMS-004 now expects
organisation leave visibility for Admin; HRMS-034 retains negative Manager
coverage. Existing delegated-capability verification remains unchanged.

Release validation: lint, 95 tests and build pass in an isolated copy of the
release contents (excluding the separate uncommitted avatar work). A synthetic-data
browser fixture verified balance preview, overdraft blocking, half-day changes,
request search/status filtering, empty results and clearing filters. The history
view was checked at 390px with no page overflow. These checks do not validate
production data or the database migration. The local database runner could not
start because Docker and an external PostgreSQL connection are unavailable.
