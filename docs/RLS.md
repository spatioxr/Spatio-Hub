# Phase 1 Row-Level Security

The ordered migrations in `supabase/migrations` create the Phase 1 tables and
their policies together. Run `supabase/verify/phase1_schema.sql` afterwards and
confirm:

- all 14 tables report `rls_enabled = true`
- only the expected authenticated policies are present
- anonymous SELECT is denied for every table
- the signed-in superadmin reports organisation access

## Current enforcement

| Data | Employee | Manager | Admin | Superadmin |
| --- | --- | --- | --- | --- |
| Employee profiles | Own | Explicit reports | Organisation | Organisation |
| Attendance | Own | Explicit reports, read-only | Organisation, read-only | Organisation |
| Daily reports | Own | Explicit reports, read-only | Organisation, read-only | Organisation |
| Leave and balances | Own | Own | Own | Organisation |
| Holidays | Read | Read | Read | Read/write |
| Projects/assignments | Assigned | Assigned/managed | Organisation | Organisation |
| Work entries/breaks | Own | Assigned teams/projects, read-only | Organisation, read-only | Organisation |
| Audit history | Own | Assigned teams/projects | Organisation | Organisation |
| BOS/EOD settings | Own, read-only | Own, read-only | Own, read-only | Organisation |

Managers are scoped through explicit `reports_to` relationships and assigned
project teams. Department never grants Manager access.

Attendance and daily-report corrections remain self-service or superadmin-only
until HRMS-013 adds mandatory edit reasons and immutable audit history. This
prevents a direct client from bypassing the future audit requirement.

## Rule for future tables

RLS must be enabled in the same migration that creates every project, activity,
assignment, work-session, break, daily-requirement, or audit table. That
migration must:

1. revoke all `anon` table access
2. grant only required operations to `authenticated`
3. attach policies matching `docs/PERMISSIONS.md`
4. add a verification query or automated policy test

No future Phase 1 table is complete while it is publicly writable or missing
its scoped policies.
