# Testing

HRMS-038 establishes two automated test layers for Phase 1.

## Application rules

Run the deterministic Node tests and production build:

```sh
npm run test:ci
```

The unit suite covers timer state transitions, elapsed-duration behaviour,
required/optional task-description validation, leave-day precision, and the
role permission matrix.

## Database rules

Start the local Supabase stack, then run the rollback-only database suite:

```sh
npx supabase start
npm run test:database
```

The database suite verifies server-enforced role access, duplicate timer and
break actions, overlapping entries, BOS/EOD enforcement, correction
authorization and audit history, configurable task-description enforcement,
switching, duration totals, and leave balance single-deduction behaviour. The
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
