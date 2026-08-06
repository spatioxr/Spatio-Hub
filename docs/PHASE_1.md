# Phase 1 Product Scope

## Goal

Launch an internal, focused work-tracking and leave portal as soon as it is reliable enough for company use. This is not intended to become a full Jibble replacement.

The source of truth for implementation work is the [Spatio HRMS issue tracker](https://docs.google.com/spreadsheets/d/1LZCCncJ7yVvNWi6MN-k5rkCAItkkmtV6_76l7hVnFnE/edit?gid=0#gid=0).

## Confirmed tracking workflow

- An employee starts work by selecting either an assigned project or an internal activity.
- A concise task description is available for each work session and is required by default.
- Employees may switch projects or activities during the day.
- Switching automatically closes the current underlying session and opens another.
- Department remains sourced from the employee profile.
- A simple Start Break and Resume flow excludes break duration from worked time.
- One BOS report is required at the first start of the day.
- One EOD report is required at the final end of the day.
- Superadmin may make task descriptions, BOS, or EOD optional for selected employees.
- Superadmin may apply the same task-description requirement to every active employee at once.
- Managers, admins, and superadmins may correct permitted time entries with a required reason and immutable audit history.

Example internal activities include pre-sales, proposal creation, estimation, demo-video production, and marketing-material production.

## Roles

- Employee: own timer, own timesheet, leave, and the company live-status board.
- Manager: employee capabilities plus assigned project/team timesheets and team assignment. This role covers project managers, product managers, tech leads, 3D leads, and similar assigned leads.
- Admin: organisation tracking, project/activity administration, reporting, and permitted corrections.
- Superadmin: full phase-1 access and organisation/per-user work-requirement controls.

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

Phase 1 retains the existing leave workflow and focuses on correctness:

- balances
- applications and reasons
- half days
- approval/rejection
- history
- holidays and comp-off where already supported

The known balance calculation issue is tracked as `HRMS-033`.

## Explicit non-goals

Do not add these in phase 1 unless the tracker is deliberately changed:

- payroll or invoicing
- GPS, geofencing, facial recognition, or locations
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
- weekly timesheet navigation
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
