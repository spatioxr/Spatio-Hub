# Phase 1 launch checklist

This is the operational go-live, monitoring, and recovery checklist for
HRMS-042. Complete every launch gate before onboarding the Phase 1 pilot.

## Current launch gate

**Status:** Blocked as of 30 July 2026 (Asia/Kolkata).

**Launch and monitoring owner:** Jasim, initial Superadmin.

Live environment:

- Application: `https://spatio-hub.vercel.app`
- Vercel project: `spatioxr/hrms-react-app`
- Supabase project: `spatio-people` (`kuelyansmnumhwwfyboi`)
- Production branch: `main`

Verified on 30 July 2026:

- Vercel deployment `a81ce5e` is Ready.
- Vercel exposes Instant Rollback and retains earlier Ready production
  deployments. The control and recovery target were inspected without
  interrupting production.
- Supabase reports the database as Healthy and the Advisor reports no security
  or performance issues.
- One active project exists: `ABC · Test Project`.
- All five Phase 1 activities are active: Marketing material making,
  Estimation, Proposal making, Pre-sales, and Demo video making.
- Two employee profiles exist, but only the initial Superadmin has a linked
  Auth user. The remaining profile is an unlinked test profile and is not a
  launch user.

Blocking findings:

- Supabase reports **No backups**. The project is on the Free plan, which does
  not include scheduled backups.
- On 2 August 2026, Jasim explicitly waived the backup requirement for the
  temporary-password production rollout. This records acceptance of the
  current database-recovery risk; it does not claim that a backup exists.
- The intended pilot users have not been provisioned and verified. There is
  only one Auth user.

Do not begin the pilot until both findings are resolved and the evidence table
at the end of this document is signed off.

## Before go-live

- [ ] Create a recoverable database backup:
  - preferred: enable Supabase scheduled backups and confirm a completed backup
    timestamp in Database > Backups;
  - alternative: create an encrypted, access-controlled logical dump using the
    production database connection, store it outside the repository, and test
    restoration into an isolated project.
- [ ] Record the backup type, timestamp, location, retention, and restore owner
  in the evidence table. Never place a database dump or credentials in Git.
- [ ] Provision three named pilot users through the People and Supabase Auth
  invitation workflow.
- [ ] Confirm every pilot user is active, has the intended Employee, Manager,
  Admin, or Superadmin role, and has a linked `auth_id`.
- [ ] Assign the Manager and employees to `ABC · Test Project`, or replace it
  with the agreed first live project before anyone records work.
- [ ] Confirm the five activity labels are appropriate for the pilot.
- [ ] For every pilot user, verify invitation acceptance, first login, logout,
  profile access, and the role-appropriate navigation.
- [ ] Run `npm run check` and confirm the latest Critical tests workflow is
  green for both application and database jobs.
- [ ] Run the HRMS-041 four-role launch smoke gate in the production-like
  verification environment. Do not leave its rollback-only fixtures behind.
- [ ] Confirm Vercel Production is Ready on the intended commit and the live
  domain opens the login flow.
- [ ] Confirm Supabase is Healthy, Advisor has no unresolved launch-critical
  findings, and the API, Auth, Postgres, and Realtime error panels are clear.
- [ ] Tell the pilot users when the pilot opens, who owns monitoring, how to
  report feedback, and when the next check-in occurs.

## Pilot rollout

1. Jasim opens access for the three-person pilot only.
2. Each pilot user completes one full journey: sign in, BOS, start work,
   break/resume, switch context, End Day/EOD, view timesheet, and submit leave.
3. The Manager verifies assigned-team scope. Admin and Superadmin verify their
   organisation and settings scopes without changing unrelated production
   data.
4. Jasim monitors the surfaces below for one full business day.
5. Expand beyond the pilot only when no P0/P1 issue remains, the backup is
   restorable, and all pilot journeys are signed off.

## Monitoring

Jasim owns launch monitoring and triage until the pilot is formally closed.

| Window | Checks | Decision |
| --- | --- | --- |
| First 60 minutes | Vercel status, error rate and logs; Supabase API/Auth/Postgres/Realtime errors; failed sign-ins; stuck timers; repeated BOS/EOD or leave failures | Check at launch, +15, +30, and +60 minutes. Stop rollout for any P0 or access-control failure. |
| First business day | Recheck at least every two hours; review stale open sessions, correction audit rows, leave balances, and pilot feedback | Fix or roll back P0/P1 issues before adding users. |
| First week | Daily health and error review; confirm all users can complete the core journey; classify recurring feedback | Close the pilot only after the owner records the result. |

Access-control failures, data loss/corruption, login failure affecting the
pilot, incorrect time totals, and incorrect leave deductions are P0/P1 launch
events.

## Feedback route

Pilot users report issues directly to Jasim through the agreed internal
company message or email route. Each report should include:

- local date and time;
- affected page and user role;
- expected and actual result;
- safe reproduction steps; and
- a screenshot when useful.

Never include passwords, invitation links, tokens, database credentials, or
unredacted sensitive employee data. Jasim records the report in the issue
tracker, assigns severity, and acknowledges P0/P1 reports immediately.

## Rollback and recovery

### Application-only incident

Use this when the database is healthy and a new frontend deployment introduced
the fault.

1. Stop onboarding and tell pilot users not to continue the affected journey.
2. In Vercel, open the production deployment and choose **Instant Rollback**.
3. Select the last known-good Ready deployment and review the target commit.
4. Confirm the rollback. This changes production and must be performed only by
   the launch owner during a declared incident.
5. Verify the production domain, login flow, protected route, and affected
   journey.
6. Check Vercel and Supabase error panels for at least 15 minutes.
7. Record the incident, reverted and restored commits, timestamps, and outcome.

The rollback control and multiple Ready targets were verified on 30 July 2026.
No live rollback was executed because intentionally interrupting a healthy
production deployment is not required to document the recovery path.

### Database or data incident

Do not drop tables, reverse shared migrations in place, or overwrite production
data to attempt a quick recovery.

1. Stop onboarding and all non-essential writes.
2. Preserve the incident time, affected records, current deployment commit,
   logs, and backup identifier.
3. Restore the last known-good scheduled backup or encrypted logical dump into
   a new isolated Supabase project.
4. Apply only migrations newer than that backup when they are required for the
   intended application commit.
5. Run `supabase/verify/phase1_schema.sql`, the focused incident verification,
   `hrms_004_role_access.sql`, and the HRMS-041 launch smoke gate.
6. Validate user/Auth mapping, projects, activities, assignments, current work
   state, audit history, and leave balances.
7. Switch the application integration to the recovered project only after the
   launch owner approves the validation evidence and a fresh Vercel production
   deployment is Ready.
8. Monitor for at least one hour and record the recovery outcome.

This recovery path remains untestable until a database backup exists. A restore
rehearsal must use an isolated project and must never overwrite the healthy
production project.

## Launch evidence

| Gate | Evidence | Owner | Result |
| --- | --- | --- | --- |
| Database backup | Supabase currently reports No backups; Free plan has no scheduled backups | Jasim | Blocked |
| Initial project and activities | One active project and five active Phase 1 activities verified in Supabase | Jasim | Pass |
| Pilot users | Two profiles, one linked Auth user; three-person pilot not provisioned | Jasim | Blocked |
| Monitoring ownership | Owner, monitoring windows, severity rules, and feedback route documented above | Jasim | Pass |
| Application rollback | Vercel Instant Rollback and earlier Ready deployments verified; steps documented | Jasim | Pass |
| Database recovery | Restore-to-new-project procedure documented; rehearsal awaits a backup | Jasim | Blocked |

When the blocked rows pass, add the backup timestamp and pilot-user count,
rerun the pre-launch checks, and update HRMS-042 to Done with the evidence.
