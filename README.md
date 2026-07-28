# Spatio HRMS

Spatio HRMS is an internal work-tracking and leave portal built with React, Vite, and Supabase.

The current product work is intentionally limited to phase 1:

- dashboard and live work status
- project or internal-activity time tracking
- task descriptions, breaks, and BOS/EOD reports
- personal, team, and organisation timesheets
- project/activity administration
- leave requests, balances, and approvals

Salary, payslips, employee administration, Inbox, Performance, and the old Reports area are retained in the repository for possible future reuse but are not mounted or routable in phase 1.

## Start locally

Requirements:

- Node.js 18 or newer
- npm
- a Supabase project

```bash
npm install
cp .env.example .env
npm run dev
```

Set these values in `.env`:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Available commands:

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

The lint configuration and automated tests are scheduled under phase-1 tracker issues `HRMS-038` and `HRMS-039`; they are not operational yet.

## Current routes

| Route | Purpose |
| --- | --- |
| `/` | Dashboard |
| `/attendance` | Current attendance view; being evolved into Work Tracking |
| `/leave` | Leave management |
| `/login` | Current login |
| `/reset-password` | Current password flow |

All other routes redirect to the dashboard.

## Project references

- [Phase 1 scope and decisions](docs/PHASE_1.md)
- [Phase 1 permission matrix](docs/PERMISSIONS.md)
- [Phase 1 row-level security](docs/RLS.md)
- [Database migrations and rollback](docs/DATABASE_MIGRATIONS.md)
- [Supabase Auth setup](docs/AUTH_SETUP.md)
- [Issue tracker](https://docs.google.com/spreadsheets/d/1LZCCncJ7yVvNWi6MN-k5rkCAItkkmtV6_76l7hVnFnE/edit?gid=0#gid=0)
- Production: [spatio-hub.vercel.app](https://spatio-hub.vercel.app)
- Supabase project: `spatio-people` (`kuelyansmnumhwwfyboi`)

## Important security status

Authentication uses Supabase Auth sessions and the legacy employee password
column has been retired. All 14 current Phase 1 tables enforce scoped RLS for
employee, manager, admin, and superadmin access. Every future schema issue must
add matching RLS in the same migration that creates its tables.

The canonical database history is `supabase/migrations`. Do not provision an
environment with the legacy root-level `supabase_updates*.sql` files.

## Continuing the project

1. Read `AGENTS.md` and `docs/PHASE_1.md`.
2. Check the issue tracker and select the requested issue.
3. Inspect `git status` before editing and preserve unrelated changes.
4. Implement only the selected phase-1 scope.
5. Run the relevant verification available at that point.
6. Mark the issue done only after its acceptance criteria pass.
