# Supabase Auth and Database Setup

HRMS uses Supabase Auth for identity and the `employees` table for the HR profile.

## Current cloud environment

- Production URL: `https://spatio-hub.vercel.app`
- Supabase project: `spatio-people`
- Supabase project ref: `kuelyansmnumhwwfyboi`
- Initial super-admin: `jasim@spatiotech.ai`

The Supabase integration is connected to Vercel Production and Preview. Never commit Supabase keys or place a service-role key in a `VITE_` environment variable.

## Bootstrap a replacement project

For a brand-new, empty Supabase project:

1. Run `supabase_phase1_bootstrap.sql` once in the Supabase SQL editor.
2. Confirm the six public tables exist: `employees`, `attendance`, `daily_reports`, `leaves`, `leave_balances`, and `holidays`.
3. Confirm the seeded `STS001` employee is `jasim@spatiotech.ai` with role `superadmin`.
4. Under Authentication, send an email invitation to `jasim@spatiotech.ai`.
5. Set the Site URL to `https://spatio-hub.vercel.app`.
6. Add `https://spatio-hub.vercel.app/reset-password` to the redirect allow list.
7. Redeploy the Vercel Production environment so it reads the latest integration variables.

The bootstrap deliberately contains no mock employee history and no application-managed password field. It enables baseline RLS policies; the complete RBAC policy matrix and tests belong to `HRMS-004`.

If Supabase falls back to the Site URL for an invitation or recovery link, the app detects that Auth flow and routes it to `/reset-password`.

Do not run the bootstrap against an existing populated project. It is intended for a clean phase-1 environment.

## Adding employees

1. Create the employee profile with a unique employee code and normalised, lowercase email.
2. Send an Auth invitation to that same email.
3. Ask the employee to accept the invitation and choose their password.

On first successful login, the app matches the authenticated email to the employee profile and safely links its `auth_id`. Passwords remain entirely within Supabase Auth.

## Password recovery

The Forgot Password page requests a Supabase recovery email. The production `/reset-password` URL must remain in the Auth redirect allow list.

## Before production

- Complete `HRMS-004` and verify the full role matrix.
- Complete the basic automated-test issue `HRMS-039`.
- Test invitation acceptance, first login, logout, and password recovery using the production URL.
