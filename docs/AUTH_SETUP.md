# Supabase Auth Setup

HRMS uses Supabase Auth for identity and the `employees` table for the HR profile.

## Configure the Supabase project

1. In Supabase, enable the Email provider under Authentication.
2. Set the production Site URL to the deployed HRMS URL.
3. Add these redirect URLs:
   - local: `http://localhost:5173/reset-password`
   - production: `https://<your-hrms-domain>/reset-password`
4. Create an Auth user for each employee who should access HRMS.
5. Use the same normalised email address in Authentication and `public.employees`.
6. Run `supabase_auth_setup.sql` once to link existing employee rows to Auth users.

The app first looks up an employee by `auth_id`. During the transition it may fall back to the authenticated email and link the row automatically. The explicit SQL link is preferred before enabling RLS.

## Password recovery

The Forgot Password page calls Supabase recovery email. Confirm that the Supabase email template points users back to the configured `/reset-password` redirect.

## Before production

- Complete `HRMS-003` to remove the legacy employee password column and old seed passwords.
- Complete `HRMS-004` to enable and verify RLS policies.
- Never place the Supabase service-role key in a `VITE_` environment variable or browser code.
