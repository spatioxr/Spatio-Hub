# Phase 1 Row-Level Security

The ordered migrations in `supabase/migrations` create the Phase 1 tables and
their policies together. Run `supabase/verify/phase1_schema.sql` afterwards and
confirm:

- all 18 tables report `rls_enabled = true`
- only the expected authenticated policies are present
- anonymous SELECT is denied for every table
- the signed-in superadmin reports organisation access

## Current enforcement

| Data | Employee | Manager | Admin | Superadmin |
| --- | --- | --- | --- | --- |
| Employee profiles | Own | Assigned project teams | Organisation | Organisation |
| Attendance | Own, read-only | Assigned project teams, read-only | Organisation, read-only | Organisation, read-only |
| Daily reports | Own | Assigned project teams, read-only | Organisation, read-only | Organisation |
| Leave and balances | Own | Own | Own | Organisation; decide others |
| Leave Admin projections | Capability-gated | Capability-gated | Capability-gated | Organisation |
| Holidays/policy | Read | Read | Read | Controlled write |
| Projects/assignments | Assigned | Assigned/managed | Organisation | Organisation |
| Work entries/breaks | Own | Assigned teams/projects, read-only | Organisation, read-only | Organisation |
| Audit history | Own | Assigned teams/projects | Organisation | Organisation |
| Work requirements | Own, read-only | Own, read-only | Own, read-only | Organisation |
| Work-requirement history | — | — | — | Organisation |
| Delegated live-work audit | — | — | Organisation | Organisation |

Managers are scoped through explicit project ownership and team membership.
HRMS-027 regression coverage exercises Manager add/remove only on owned
projects, denies Manager project setup and outside-project changes, confirms
Admin/Superadmin override, rejects duplicate membership, and denies Employee
assignment operations at the server boundary.
Neither `reports_to` nor department grants Manager access.

Attendance month reads use `scoped_attendance_month()`. It reuses the
server-validated timesheet member scope, returns calendar/holiday/approved
leave facts and factual attendance timestamps, hides another employee's leave
type unless the caller is a Leave Admin, and grants no direct attendance write
path. The workday functions and audited Timesheet correction functions remain
the only mutation boundary.

Leave review uses `can_manage_leave()` and the `employees.is_leave_admin`
capability. Only a superadmin can assign the capability. Submission, pending
edit, decision, balance adjustment, holiday, and policy mutations are
security-definer functions with input and actor checks; direct leave,
attendance, balance, ledger, holiday, and policy writes are denied. The balance
ledger is RLS-scoped and rejects updates/deletion at a trigger boundary.

The People directory uses the existing employee row scope, while UI access is
limited to Manager, Admin, and Superadmin. Employees retain access to their own
profile only for authentication and permitted self-profile updates; they cannot
open the People directory. Managers can read their own profile and employees
assigned to projects they manage. Admins and superadmins use controlled
`create_employee_profile` and `update_employee_profile` functions for employee
ID, name, work email, department, designation, application role, reporting
manager, joining date, and employment status. Direct authenticated inserts and
deletes are denied. Admins cannot grant or remove privileged roles or manage a
superadmin profile, and nobody can deactivate their own profile. `Released`
profiles are shown as Archived in the UI, lose active portal access, and retain
operational history. `is_active_employee()` also gates the otherwise shared
activity and holiday catalogues, and archived identities cannot update their
profile directly.

Admin Settings is available only to active Admin and Superadmin profiles. The
route groups existing Phase 1 administration controls without widening their
underlying data access. Project and activity controls retain their existing
controlled-function and RLS boundaries, while BOS/EOD requirements remain
superadmin-only. Employee-profile functions also enforce that only a
superadmin may grant or remove the `admin` or `superadmin` role.

Activity administration is exposed through organisation-only projection,
create, definition-update, and archive/restore functions. Direct authenticated
inserts, updates, and deletes are denied. All authenticated employees retain
read access so active activities can be selected for work and archived labels
remain available to historical reports; work-entry functions continue to
reject archived activities for new sessions.

The company live-status board uses `live_work_status()` as a narrow
authenticated projection. It exposes every active employee's name, employee
code, current In/Break/Out state, daily check-in/check-out, and an active break
start time. Context-switch timestamps are not presented as attendance.
`live_attendance_work_modes()` exposes only the current day's self-declared
Office/WFH mode so the UI can add a compact WFH marker without widening direct
attendance access.
Activity context
is visible to authenticated employees; project context is returned only when
the caller already passes `can_access_project`. It does not expose task text or
widen direct `employees`, `work_entries`, or `break_entries` policies. Open
sessions older than 24 hours are flagged by the projection for visible review.

Personal timesheets use `personal_timesheet_entries()` as a self-only
authenticated projection. It resolves the signed-in employee on the server and
returns only that employee's sessions for a bounded date range, including
project/activity labels, task descriptions, break detail, and break-excluded
worked duration. Team and organisation timesheet scope is not exposed by this
function.

Team and organisation timesheets use `timesheet_scope_members()` and
`scoped_timesheet_entries()` as role-scoped authenticated projections.
Employees remain personal-only. Managers can read employees explicitly
assigned to projects they manage, including those employees' project and
activity sessions, but cannot select anyone outside that team. Admins and
superadmins can use organisation scope. The requested scope and optional
employee selection are validated on the server before any entries are returned.
The organisation work-distribution dashboard reuses this projection with
`organisation` scope and aggregates only the returned rows into project,
activity, department, and employee totals. Its React route is limited to Admin
and Superadmin, while the projection independently rejects Employee and Manager
organisation requests on the server.
Analytics filters and chart drill-downs operate only on the rows returned by
that server-scoped request; they never issue a broader client-side table read.
CSV exports serialize only the same filtered in-memory rows and totals, so
export cannot bypass the organisation projection or its role checks.

Authenticated clients read permitted work sessions through RLS and begin or
finally end their own work day only through the server-controlled BOS/EOD
workflow functions. Initial starts store a blank task description. Context
switches require a description and remain atomic and report-neutral. The
same controlled start function may reopen a completed workday on the same
Asia/Kolkata date; it preserves BOS and the original check-in while atomically
clearing the provisional EOD and check-out so the next End Day is final. The
legacy session-only start/end functions are no longer executable by
authenticated clients, and direct insert, update, and delete privileges on
`work_entries` are denied.
Managers, admins, and superadmins create or correct completed manual entries
only through audited server functions. Managers are restricted to employees in
their explicitly owned project teams, every change requires a reason, and
employees cannot correct time entries.
Daily Office/WFH mode is stored once on `attendance`. The normal first-start
path records Office unless the employee explicitly uses the secondary WFH
action. The controlled manual-entry overloads apply the mode to the whole
Asia/Kolkata attendance day and include mode-only corrections in immutable
work-entry audit history. Direct callers cannot execute the internal mode-write
helper.
The HRMS-023 manual-entry functions also validate the permitted project or
activity, positive completed session ranges, non-overlapping employee time,
and ordered non-overlapping breaks contained inside the session. Corrections
replace the complete break list atomically and record old/new session and break
snapshots in immutable audit history.
Timesheet change history is read through `work_entry_change_history()`, a
read-only authenticated projection. Employees can read their own entry
history, Managers can read employees assigned to projects they manage, and
Admins/Superadmins can read organisation history. The projection adds editor
identity and historical project/activity labels to the stored old/new
snapshots without granting audit mutation privileges.
Breaks follow the same pattern: authenticated clients use the break/resume
functions, while direct writes to `break_entries` are denied.
Admins and superadmins may operate an active employee's current timer only
through the `admin_*` live-work functions. Those functions re-check the caller
role and active target on the server, preserve BOS/EOD, assignment, work-mode,
break, and reopen rules, and append to `admin_work_action_audit`. Employees and
Managers cannot execute a delegated action successfully, and authenticated
clients cannot insert, update, or delete the audit rows directly.

BOS/EOD report text remains writable only within the existing own or
superadmin row scope, and a database trigger owns the corresponding submission
timestamps. Per-employee BOS/EOD requirements are readable within their
existing scope but may be changed only through the superadmin-controlled
settings function; direct authenticated settings writes are denied. The
retained task-description column is compatibility-only and is not queried or
configurable by the application.
Each effective settings change records the previous and saved BOS/EOD values,
the superadmin actor, and the shared change timestamp in immutable history.
Unchanged saves do not create misleading audit events. Setting updates are
published to signed-in affected employees so their timer refreshes the saved
requirements without a page reload.

Work-entry and BOS/EOD-settings audit rows are inserted atomically by their
controlled functions. Authenticated clients have no insert, update, or delete
privileges on audit history, and database triggers also reject audit updates
and deletion.

`supabase/verify/hrms_004_role_access.sql` exercises the complete policy model
as real Employee, Manager, Admin, and Superadmin Auth identities with the
database role set to `authenticated`. Its fixtures and permitted mutations are
transactional and roll back after the positive and negative access assertions.

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
