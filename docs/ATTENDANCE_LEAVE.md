# Attendance and Leave Contract

This document defines what the Phase 1 Attendance and Leave features are for,
what they are not for, and how each rule is verified. It replaces the legacy
assumption that Attendance is another work-entry or BOS/EOD editing screen.

## Product boundaries

| Surface | Purpose | Source of truth | Explicitly not owned here |
| --- | --- | --- | --- |
| Track Work | Start, switch, break, resume, reopen, and end today's work | Controlled work-session functions | Historical corrections or leave decisions |
| Timesheets | Inspect session detail and make authorised audited corrections | Work entries, breaks, and change audit | Attendance policy or leave balances |
| Attendance | Read-only calendar of factual first check-in, final check-out, worked time, WFH, approved leave, holidays, and configured lateness | `scoped_attendance_month` | BOS/EOD text, direct corrections, or policy guesses |
| Leave | Request time away, view balances and request history | Controlled leave functions | Payroll, scheduling, or WFH approval |
| Leave Admin workspace | Review every request, adjust balances, manage holidays, and configure the optional late cutoff | Leave Admin RPCs and immutable ledger | Role administration or self-service decisions |

The Dashboard is a summary only. It links to Attendance and Leave and does not
duplicate their mutation controls.

## Leave rules

- Company working days are Monday through Friday. Weekends and company
  holidays do not consume leave.
- A half day is exactly `0.5` on one company working date.
- Every request enters `Pending`, including requests from a Leave Admin or
  Superadmin. There is no privileged auto-approval.
- Pending days reserve capacity. A new or edited request is rejected when its
  charge plus other pending requests exceeds the remaining balance.
- Employees may edit their own pending requests. Decisions are immutable
  workflow transitions; a decided request cannot be edited or decided again.
- Only an active designated Leave Admin or Superadmin can review organisation
  leave. A reviewer cannot approve or reject their own request.
- Rejection requires a reason. Approval may include an optional note.
- An approved request deducts the balance and writes one immutable ledger
  transaction in the same database transaction.
- Balance adjustments use signed half-day increments, require a reason, cannot
  make a balance negative, and cannot be made by a Leave Admin against their
  own balance.
- The current balance table remains the fast current-state cache. The ledger
  explains opening balances, adjustments, approvals, and reversals.
- Adding, moving, or removing a holiday is blocked when that date is already
  covered by a pending or approved request. This prevents a calendar edit from
  silently changing a request's stored charge.

Superadmins assign or remove the `Leave Admin` capability in Users & Access.
It is separate from the employee/manager/admin role and does not grant People,
project, analytics, time-correction, or BOS/EOD-setting access.

## Attendance rules

- Attendance is read-only for browser clients. Start/end work and authorised
  Timesheet corrections are the controlled mutation paths.
- A month is projected as calendar dates for one employee after server-side
  validation of personal, managed-team, or organisation scope.
- The first daily check-in and final check-out come from the attendance record,
  with factual work-session timestamps as a historical fallback.
- Context switches never replace the first check-in.
- Net worked duration excludes recorded breaks. An open session is shown as in
  progress rather than inventing a final check-out.
- Approved leave appears on chargeable working dates. Pending leave does not
  alter the factual Attendance calendar.
- Company holidays and weekends are non-working dates. Dates before the
  employee's joining date are not counted as missing attendance.
- `No record` means an elapsed company working day has neither approved leave
  nor factual work. It is not automatically labelled absent.
- Late status is disabled until a Leave Admin configures a cutoff. When set,
  the original first check-in is late only when it is strictly after the
  cutoff; a check-in exactly at the cutoff is on time.

## Feedback acceptance map

| Feedback | Delivered behavior | Manual acceptance test | Automated evidence |
| --- | --- | --- | --- |
| 5 | First check-in and final check-out are visible in the calendar detail; context switches cannot reset the first check-in | Start work, switch context, open today's Attendance detail, and confirm the displayed first check-in remains the original time | `hrms_048_attendance_leave_reset.sql`; navigation/reliability unit tests |
| 6 | BOS/SOD and EOD content is absent from Attendance | Open Attendance and confirm the calendar/detail contain no BOS/EOD plan or editing action | `navigation.test.js` asserts no BOS/EOD or `daily_reports` dependency |
| 7 | Approved leave is projected into Attendance; pending leave remains pending-only | Submit leave, confirm Attendance is unchanged while pending, approve it as another Leave Admin, then confirm the working dates show approved leave | `hrms_048_attendance_leave_reset.sql`; `attendance.test.js` |
| 8 | An employee can edit type, dates, half-day state, and reason while a request is pending | Submit a request, choose Edit, change the dates, save, and confirm working-day charge and history update | `hrms_033_leave_balances.sql`; `hrms_048_attendance_leave_reset.sql` |
| 10 | Leave Admin can add or subtract balances in `0.5` increments with a required reason and ledger entry | In Leave → Balances, adjust another employee by `+0.5` and `-0.5`; confirm current balance and two immutable history rows | `hrms_035_holidays_comp_off.sql`; `hrms_048_attendance_leave_reset.sql` |
| 15 | Holiday calendar and working-day totals use one rule | Add a future holiday not covered by active leave, request a range crossing it and a weekend, and confirm neither consumes leave or counts as an Attendance working day | `leave.test.js`; `hrms_048_attendance_leave_reset.sql` |
| 23 | Every request goes to the HR queue, with no role-based auto-approval | Submit as Employee, Leave Admin, and Superadmin; confirm all three are Pending and visible to another Leave Admin | `hrms_033_leave_balances.sql`; `hrms_048_attendance_leave_reset.sql` |
| 24 | Late timing has an explicit optional criterion | Leave policy disabled: no late labels. Set cutoff to `10:00`; confirm `10:00` is on time and `10:01` is late using the original check-in | `hrms_048_attendance_leave_reset.sql`; `attendance.test.js` |

## Release gate

1. Run `npm run check`.
2. Start an isolated Supabase stack, reset it from migrations, and run
   `npm run test:database`.
3. Perform Employee, Leave Admin, Manager, Admin, and Superadmin browser smoke
   tests at desktop and mobile widths.
4. Take a database backup before applying migrations 37 and 38 to a shared
   environment.
5. Apply the migrations, rerun `phase1_schema.sql` and
   `hrms_048_attendance_leave_reset.sql`, then complete a production smoke test.
6. Only then mark the linked feedback and issue-tracker rows Done/Verified.
