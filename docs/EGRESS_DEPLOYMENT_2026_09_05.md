# HRMS-020 egress fix — production deployment

Applied on 5 September 2026 to Supabase spatio-people (kuelyansmnumhwwfyboi)
and Vercel spatioxr/hrms-react-app. This is a performance correction to
HRMS-020; HRMS-055 in the tracker remains the separate monthly-timesheet issue.
The pre-existing avatar schema verifier retains its supplied filename.

## Deployment

- Migration: 20260828000100_avatar_egress_optimisation.sql, applied through
  the authenticated Supabase SQL Editor in one transaction; success confirmed.
- Existing profile guard compared before replacement. Existing authenticated
  and service_role RPC grants retained; anonymous execution remains denied.
- Leave Admin and Downtime Manager protection triggers retained.
- Vercel deployment: dpl_8MPVy8sBiJeDa4n5q3E7FZCCPU4B, Production Ready,
  created 2026-09-05 22:09 IST.
- Deployment URL: https://hrms-react-afhvpak0i-spatioxr.vercel.app
- Production alias: https://spatio-hub.vercel.app
- Served JavaScript: /assets/index-Bm892EuY.js. Direct retrieval confirms
  one live_work_status RPC, 60-second interval, document visibility guard,
  active-panel guard and no live_attendance_work_modes call.
- Supabase has no supabase_migrations.schema_migrations table. This was a
  dashboard apply, not a CLI migration-history repair or baseline operation.

## Verification and measured reduction

- npm run check: 102/102 unit tests, ESLint with zero warnings, production build.
- Production hrms_055_avatar_egress.sql: all 11 schema checks true.
- Production hrms_020_avatar_access.sql: all behavioral assertions passed.
  Tests use isolated fixtures in a rolled-back transaction. Own-folder reads,
  inserts, updates and profile linking succeed; cross-folder upload/update,
  cross-folder profile linking, embedded-image reintroduction, role escalation,
  anonymous RPC access and inactive-employee avatar reads are denied.
- Production admin_hr_feedback.sql: all_checks_pass=true, preserving the
  Admin leave/downtime behavior from 119949c.
- Production hrms_020_live_work_status.sql: all 10 checks true. Fixed an
  existing ambiguous fixture variable named break_started_at before rerunning.
- Before: 20 status rows, 177,284 serialized JSON bytes, 14 embedded photos.
- After: 20 status rows, 8,154 serialized JSON bytes, zero embedded photos.
  Measurements use the same authenticated-role SQL projection and json_agg;
  these are uncompressed payload sizes, not network/billing-meter deltas.
- Payload reduction: 95.4%. At one request per minute instead of four,
  this payload stream falls by approximately 98.9%, before hidden-tab and
  closed-drawer savings. The separate old work-mode request also disappears.
- Real signed-in profile migration succeeded: one linked private JPEG,
  6,899 bytes, with the old database avatar_url cleared. Both the profile
  and board rendered its signed image successfully (240-pixel source).
  Thirteen legacy photos remained, to migrate on their owners' next visits.
- Closed drawer retained its 22:17 last-update timestamp for over 90 seconds
  while other dashboard content refreshed. Opening the board loaded 20 people.
- At 1800px, the permanently visible rail refreshed immediately with the
  drawer toggle still closed. Production console inspection reported no errors
  or warnings. Hidden-tab logic was verified in the served bundle; a separate
  browser network trace was not obtained during concurrent browser activity.

## Free-plan assessment

Free is plausibly sufficient for ordinary use by the current 20-person team,
but a post-deployment billing-day measurement is still required. At 8 visible
hours per day, 22 workdays and 20 viewers, the measured status payload alone
models about 1.72 GB/month. Add avatars, authentication, other page queries,
headers and all other organization projects. Twenty always-visible clients
running 24/7 would use about 7.05 GB/month for this stream alone, so the
conclusion depends on actual use and background suppression.

The observed organization meter remained 11.575 GB against 5 GB uncached
allowance; cached egress has its separate 5 GB allowance. Usage reporting can
lag by an hour. Existing cumulative usage is not erased by this deployment;
the supplied billing cycle resets on 20 September. The dashboard still warns
of possible restrictions from 1 October if usage remains over quota.

Compare complete post-deployment days, aiming below roughly 160 MB/day total
uncached organization egress (preferably 100 MB/day for headroom). Do not
extrapolate the existing cumulative total as if it were the new usage rate.
No paid upgrade was purchased.

Source: https://supabase.com/docs/guides/platform/manage-your-usage/egress
