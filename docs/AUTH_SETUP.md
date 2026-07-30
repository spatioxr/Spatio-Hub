# Supabase Auth and Database Setup

HRMS uses Supabase Auth for identity and the `employees` table for the HR profile.

## Current cloud environment

- Production URL: `https://spatio-hub.vercel.app`
- Supabase project: `spatio-people`
- Supabase project ref: `kuelyansmnumhwwfyboi`
- Initial super-admin: `jasim@spatiotech.ai`

The Supabase integration is connected to Vercel Production and Preview. Never commit Supabase keys or place a service-role key in a `VITE_` environment variable.

## Production controls

The Phase 1 production environment was verified on 30 July 2026:

- Vercel project `hrms-react-app` deploys the production branch to
  `https://spatio-hub.vercel.app`.
- The Vercel Supabase integration is connected to the dedicated
  `spatio-people` project. The browser build consumes only
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Supabase Auth's Site URL is `https://spatio-hub.vercel.app`.
- The redirect allow list contains the exact
  `https://spatio-hub.vercel.app/reset-password` URL. Preview-domain
  wildcards are intentionally excluded.
- Application routes require a Supabase Auth session and a linked active
  employee profile. Supabase RLS remains the authoritative data boundary;
  the Vercel site being reachable does not make HR data publicly readable or
  writable.

The Vercel integration may also manage server or database credentials. Do not
rename any of those credentials with a `VITE_` prefix or read them from client
code. Environment changes must be made through the Vercel/Supabase integration
and followed by a new production deployment.

## Bootstrap a replacement project

For a brand-new, empty Supabase project:

1. Apply every file in `supabase/migrations` in filename order, preferably with
   `supabase db push`.
2. Run `supabase/verify/phase1_schema.sql` and confirm every boolean is true.
3. Confirm the seeded `STS001` employee is `jasim@spatiotech.ai` with role
   `superadmin`.
4. Under Authentication, create or invite `jasim@spatiotech.ai`.
5. If Auth was created after the schema, rerun migration 003's mapping
   statement or sign in once so the app claims the matching profile.
6. Set the Site URL to `https://spatio-hub.vercel.app`.
7. Add `https://spatio-hub.vercel.app/reset-password` to the redirect allow
   list.
8. Redeploy the Vercel Production environment so it reads the latest
   integration variables.

The migrations deliberately contain no mock employee history and no
application-managed password field. Schema and matching RLS policies are
applied together.

If Supabase falls back to the Site URL for an invitation or recovery link, the app detects that Auth flow and routes it to `/reset-password`.

See `DATABASE_MIGRATIONS.md` for clean-project commands, verification, and safe
rollback guidance.

## Adding employees

1. Create the employee profile with a unique employee code and normalised, lowercase email.
2. Send an Auth invitation to that same email.
3. Ask the employee to accept the invitation and choose their password.

On first successful login, the app matches the authenticated email to the employee profile and safely links its `auth_id`. Passwords remain entirely within Supabase Auth.

## Password recovery

Self-service recovery is disabled until launch-grade custom SMTP is configured
and delivery is verified. During the internal Phase 1 rollout, the super-admin
provisions users and handles password-reset assistance. Authenticated users may
change their own password from the profile menu.

## Before production

- Run `npm run check`.
- Confirm the critical database CI job passes the Phase 1 schema and RLS
  verification suites.
- Confirm an anonymous browser is sent to the login flow before protected
  application content renders.
- Test invitation acceptance, first login, logout, and password recovery using
  the production URL when Auth delivery settings change.
- Recheck the Site URL and exact reset redirect after changing either
  production domain.
