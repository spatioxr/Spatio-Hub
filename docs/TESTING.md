# Testing

HRMS-038 establishes two automated test layers for Phase 1.

## Application rules

Run the deterministic Node tests and production build:

```sh
npm run test:ci
```

The unit suite covers timer state transitions, elapsed-duration behaviour,
leave-day precision, and the role permission matrix.

## Database rules

Start the local Supabase stack, then run the rollback-only database suite:

```sh
npx supabase start
npm run test:database
```

The database suite verifies server-enforced role access, duplicate timer and
break actions, overlapping entries, BOS/EOD enforcement, correction
authorization and audit history, switching, duration totals, and leave balance
single-deduction behaviour.

`test:database` uses the standard local Supabase database container. It can
instead use an external PostgreSQL client when `DATABASE_URL` is set; the URL
is parsed into PostgreSQL environment variables and is not passed on the
process command line.

Both layers run in `.github/workflows/critical-tests.yml`. Database tests start
an isolated local Supabase stack, reset it from the committed migrations and
local-only test seed, execute every critical verification inside a rollback-only
transaction, and stop the stack.
