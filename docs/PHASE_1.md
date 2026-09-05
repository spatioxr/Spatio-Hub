# Phase 1 Product Scope

## Goal

Launch an internal, focused work-tracking and leave portal as soon as it is reliable enough for company use. This is not intended to become a full Jibble replacement.

The source of truth for implementation work is the [Spatio HRMS issue tracker](https://docs.google.com/spreadsheets/d/1LZCCncJ7yVvNWi6MN-k5rkCAItkkmtV6_76l7hVnFnE/edit?gid=0#gid=0).

## Confirmed tracking workflow

- An employee starts work by selecting either an assigned project or an internal activity.
- Office is the implicit daily work mode. On the first start only, an employee
  may use the secondary “Mark today as WFH” action; switches and same-day
  reopens preserve that attendance-day mode.
- The first clock-in does not ask for a task description.
- Employees may switch projects or activities during the day.
- Switching requires a concise task description, closes the current underlying session,
  and opens another.
- Department remains sourced from the employee profile.
- A simple Start Break and Resume flow excludes break duration from worked time.
- One BOS report is required at the first start of the day.
- One EOD report is required at the final end of the day.
- If an employee returns after End Day on the same date, the workday reopens:
  the original BOS and check-in stay intact, the earlier EOD is cleared, and
  the employee submits a fresh EOD when ending again.
- Superadmin may make BOS or EOD optional for selected employees.
- Managers, admins, and superadmins may correct permitted time entries with a required reason and immutable audit history.
- Authorised manual Add Time work keeps the selected person and date in context,
  supports ordered work and break entry, and records corrections or voids without
  hard-deleting history.
- Organisation downtime is recorded separately from employee work and breaks.
  An Admin, Superadmin, or Superadmin-assigned Downtime Manager can start/end a live incident or
  record a scheduled/past interval; everyone can see it and reporting never
  multiplies it into estimated employee-hours. Its operational panel sits
  after the personal workday flow in Track Work, while active downtime remains
  announced globally.

Example internal activities include pre-sales, proposal creation, estimation, demo-video production, and marketing-material production.

## Roles

- Employee: own timer, own timesheet, leave, and the company live-status board.
- Manager: employee capabilities plus assigned project/team timesheets and team assignment. This role covers project managers, product managers, tech leads, 3D leads, and similar assigned leads.
- Admin: organisation tracking, project/activity administration, reporting, and permitted corrections.
- Superadmin: full phase-1 access and per-user workday check-in controls.

Exact access must be enforced in Supabase RLS as well as the UI.
The canonical capability table is documented in
[Phase 1 Permission Matrix](PERMISSIONS.md).

## Visibility

All authenticated users may see who is in, out, or on break.

Timesheet visibility:

- employees see their own data
- managers see their assigned project teams
- admins and superadmins see organisation data

Department, project, activity, employee, and date filters will support visual interpretation of tracked work.

## Leave

Phase 1 uses one working-day leave model. Admins and Superadmins have Leave Admin access by role; other roles may receive the separate capability:

- Monday-Friday working-day charges with company holidays excluded
- exact half-day requests
- editable pending requests and no privileged auto-approval
- every request routed to the Leave Admin queue
- no self-approval or self-balance adjustment
- reasoned, half-day-granular balance changes with immutable history
- approved leave reflected in read-only Attendance
- explicit holiday and optional late-cutoff administration

Attendance is the factual calendar; Track Work owns live work and organisation
downtime actions, while Timesheets owns authorised time-entry corrections. See
[Attendance and Leave Contract](ATTENDANCE_LEAVE.md) for the feature and test
matrix.

## Company policies (HRMS-056)

Admins and Superadmins publish vetted PDFs immediately through Policies.
All active signed-in staff can read current company-wide documents inside the
portal. Each version may require an explicit “I have read this” acknowledgement.
Admin reports show acknowledged and pending staff; replacing a PDF requires a
fresh acknowledgement while retaining the previous version and its records.
Archiving removes a document from employee access; Admins can restore it.
There is no draft/approval stage, department targeting, or portal-blocking gate.
See [Policies contract](POLICIES.md).

## Explicit non-goals

Do not add these in phase 1 unless the tracker is deliberately changed:

- payroll or invoicing
- GPS, geofencing, facial recognition, or physical-location tracking
- kiosk mode or native mobile applications
- work scheduling
- timesheet approval periods
- client billing
- complex employee correction-request workflows
- feature parity with Jibble

## Product inspiration

Jibble is a visual and interaction reference only. Useful patterns are:

- a compact persistent timer
- clear In, Break, and Out states
- week and month timesheet navigation
- a manual-entry side panel
- visible change history
- a simple live attendance board
- separate project and activity administration with assignments

Use the existing Spatio branding and build only the smaller workflow described above.

## Delivery order

1. Scope, authentication, RBAC, RLS, and migrations.
2. Project/activity models and the timer state machine.
3. BOS/EOD, breaks, switching, live status, and timesheets.
4. Project administration, leave correctness, reporting, and export.
5. Tests, production setup, smoke testing, and launch checklist.

P0 items are launch requirements. P1 items are phase-1 usability improvements that may follow the first release if speed requires it.
