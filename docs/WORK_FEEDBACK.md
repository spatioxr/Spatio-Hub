# Work feedback

User-authorized addition on 17 September 2026: an identified, optional five-choice work check-in, an anytime form, and a private superadmin inbox. This is separate from platform bug reports and from the legacy, unmounted Inbox/Performance features. The user explicitly selected **superadmins only** as recipients. The tracker requires a fresh Google sign-in in this session; no issue ID or Done status is claimed. Record the matching tracker issue when access is restored.

## Experience

- Work feedback is available in the staff sidebar at `/feedback`. Observers cannot access it.
- Five labelled choices: Very difficult, Difficult, Okay, Good, Great. Nothing is preselected. A comment (maximum 2,000 characters) and follow-up request are optional.
- The form discloses that the author's name is included, names the current active superadmins, and explains that future superadmins also have access. Submitted responses are readable only by superadmins. Employees, managers and admins do not have response history, including their own submissions.
- By default, a skippable weekly check-in is offered after personal End Day. Superadmins can configure the schedule (see below). Delegated clock-outs do not trigger it. Opening/claiming the prompt counts as the week's offer; closing, Escape or Skip prevents repeated prompts that week. Any feedback submitted that week also suppresses the prompt. A failed feedback request never fails or undoes clock-out.
- No feedback text is stored in browser storage. Retry uses the same request ID to prevent duplicate responses. The server derives the employee and week; the client cannot submit as another person.
- Team inbox is available only to superadmins and supports status filters, 50-row pages, refresh, and New → Acknowledged → Followed up. Follow-up happens outside the portal; mark it after contacting the person. There is no automated message or guaranteed response time.
- Feedback does not affect attendance, time entries, costing or performance scores. There are no sentiment rankings, compulsory responses or participation scorecards.

## Database and release

Migration: `supabase/migrations/20260917000200_work_feedback.sql`.

Both tables enable RLS immediately. Feedback SELECT is limited to an active superadmin. Direct insert/update/delete is revoked from browser roles; writes go through scoped RPCs with pinned search paths and active-employee checks. Prompt claims have no direct browser table access. All RPCs revoke anonymous/PUBLIC execution. Existing employees and external observers retain their existing unrelated permissions.

Apply this migration before shipping the frontend. Without it, the form shows an unavailable message, sending is disabled, and optional clock-out prompts fail quietly. This migration was applied to production on 17 September 2026 after explicit user confirmation. Do not replay older migrations; this project currently uses documented dashboard deployments without a synchronized CLI migration history.

## Verification

- All migrations applied successfully to isolated PostgreSQL; rollback-only `supabase/verify/work_feedback.sql` checks denial of own/cross-person reads for non-superadmins, employee/manager/admin inbox and mutation denial, superadmin status transitions, stale update rejection, ratings 1–5, invalid rating/length rejection, retry deduplication, weekly duplicate rejection, weekly prompt suppression/rollover, anonymous permissions, archived/password-gated identities, and no-session reads.
- The verification is registered in `scripts/run-database-tests.mjs` for CI.
- Synthetic browser preview uses the actual form/page/prompt components and mocked RPCs (no real feedback submitted). Verified five choices, disabled empty submission, optional comments/follow-up, success, skip/no-repeat, inbox acknowledgment/follow-up, and inbox status updates. Checked a 390px viewport without horizontal overflow.
- Production migration committed successfully through the Supabase SQL Editor, with a PostgREST schema reload. Both tables have RLS enabled, direct browser writes are denied, and all five function body hashes match the local migration.
- Production rollback-only checks using existing active employee, manager, admin and superadmin sessions verified submissions, denial of own/all response reads for non-superadmins, and superadmin inbox/status transitions. All synthetic responses rolled back; no existing work or attendance records were changed.
- The local frontend connected to production successfully loaded the actual superadmin recipients and empty inbox. No feedback was submitted through the live browser, and no real End Day was triggered. The weekly UI prompt was exercised only in the synthetic preview.
- `npm run check` passed (lint, 176 unit tests, production build).

Copy refinement: the form leads with the mood question, keeps comments/follow-up optional, and uses a short named-response disclosure beside Send. Recipient names and role-access details are under “Who receives this?”. Attendance/costing terminology is omitted from the employee-facing form.

### Team inbox refinement (17 September 2026)

Consolidated the inbox into one panel with direct status filters, compact response rows, and useful empty states. Pagination only appears when needed. Acknowledgement and follow-up update the row in place; filtered lists refill quietly. Repeated selection of the active view/filter preserves the list. Verified the status progression and filtered empty state in a local synthetic-data preview; no employee feedback was created or changed during UI testing.

### Schedule controls and quick pulses (17 September 2026)

- Superadmins use Work feedback → Settings to enable/disable scheduled prompts and choose weekly, every two weeks, or monthly, plus a preferred weekday. Monthly means the first chosen weekday of the month. Fortnightly dates use the Monday 5 January 2026 anchor. All dates use Asia/Kolkata.
- Schedule changes start on or after the save date; no immediate catch-up for a date before that change. Employees are prompted at their next personal End Day on/after the due date, once per period. Previous offers and feedback suppress repeat scheduled prompts. Turning automatic prompts off does not disable anytime feedback or deliberate quick pulses.
- Send pulse now has an explicit confirmation in the product. One active pulse at a time, expiring after 24 hours; Close pulse stops new offers. The sender is excluded. Staff who return within the window are eligible, including those who already gave scheduled feedback.
- Visible hubs poll at most every 30 seconds. Prompts wait for other dialogs, focused input fields, and feedback drafts; hidden tabs wait until visible. Claims are atomic per employee and pulse, so Skip/Escape and multiple tabs cannot re-offer the same pulse. Existing open responses may finish after closure/expiry. No real pulse was launched during implementation.
- Responses keep the same privacy rules and show Quick pulse as the source in the superadmin inbox. There are no compulsory responses or individual participation reports.
- Migration `20260917000300_feedback_prompt_controls.sql` was applied transactionally to production Supabase. All three new tables have RLS; direct browser mutations are revoked, with superadmin-only management RPCs and employee-scoped claims/submissions. Five function body hashes match isolated PostgreSQL. Production has zero launched pulses after deployment.
- Isolated verification covers schedule dates (including monthly fallback and fortnightly cadence), disabled/future schedules, role restrictions, sender exclusion, repeat claims, idempotent active launch and submission, unclaimed/duplicate response rejection, closed/expired pulses, private responses, and anonymous RPC denial. Existing feedback verification also passes.
- Browser checks used synthetic data for save, launch confirmation, automatic pop-up, Skip and Close pulse; the local portal successfully loaded real production settings without changing the schedule or sending a pulse. Team-wide prompt delivery requires deploying the frontend release.

### Targeted pulses (17 September 2026)

- Quick pulse now offers Everyone, Project members, Department, or One person, with a required selection and eligible recipient count before confirmation. Project audiences include assigned members and project managers, deduplicated. Only active staff with a linked login are eligible; external observers and the sender are excluded.
- Recipients are snapshotted at launch. Later project/department changes do not widen an existing pulse. One active pulse at a time is preserved; retrying the same audience returns the existing pulse, while changing audience requires closing it first.
- `20260917000400_feedback_pulse_audiences.sql` adds private recipient storage with RLS and no browser table grants. Audience directory/launch RPCs are superadmin-only. Claim RPCs enforce the selected recipient list; submissions require an employee's own claim.
- Isolated database tests cover all three targeted audiences, duplicate member/manager assignments, sender exclusion, missing targets, non-superadmin denial, outsider claim/submission denial, private recipient storage and retry behavior. Existing feedback suites also pass. UI tested with synthetic audiences and an individual launch, without contacting employees.
- **Production deployed after explicit user approval:** applied `20260917000400_feedback_pulse_audiences.sql` transactionally on 17 September 2026. All five function body hashes match the tested local migration. Recipient-table RLS is enabled; direct authenticated reads/writes, anonymous launch and direct helper execution are denied. The local portal loads real audience options and recipient counts successfully. Production pulse count remains zero; no pulse was sent.

### Frontend release verification

Final `npm run check` passed: lint, 176 unit tests, and production build. The pulse dialog reveals the optional note after a mood selection, smoothly expands without reserved blank space, and shows recipient details without changing dialog height. Desktop and narrow-screen behavior were checked in the synthetic preview. All three feedback migrations are already applied to production; do not replay them as new migrations. No live pulse was launched during verification.

### Random day/time and notification sound

`20260917000500_feedback_random_schedule.sql` was applied transactionally to production on 17 September 2026 after explicit user approval. All six function body hashes match the tested migration; anonymous save/claim access and direct authenticated helper access are denied. The live local portal loaded all controls successfully. The existing weekly Wednesday / End Day schedule was preserved; no pulse was launched by the deployment. Frontend release verification passed lint, all 177 unit tests, and the production build. Regular settings gain Random weekday (Monday–Friday per person/period), End Day / fixed India time / Random time (10 AM–5 PM), and a sound toggle applying to all feedback prompts. Random assignments are deterministic per employee/period, so polling cannot reroll or repeatedly prompt. Missed prompts expire at the period boundary; random-time delivery waits for its allowed time window and visible, idle UI. Existing default settings remain weekly Monday after End Day until edited. Old clients do not claim timed prompts on End Day. Notification audio is a brief, quiet synthesized chime after prior browser interaction; audio failures never block a pulse.

Isolated PostgreSQL tests cover deterministic random assignments across 100 employees, weekday/time windows, weekly/fortnightly/monthly bounds, fixed times, deduplication, sound settings, validation and role restrictions; all prior feedback verification suites still pass. Synthetic UI verifies saving random day/time. Audio tests verify gesture gating, two-note playback, silent failure and listener cleanup. No real pulse or schedule was changed.
