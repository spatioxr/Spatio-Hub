# Phase 1 Permission Matrix

This is the single product-level permission source for Phase 1. UI checks use
`src/utils/rbac.js`; `HRMS-004` must encode the same scopes in Supabase RLS.

Only these roles may be assigned to new users:

- `employee`
- `manager`
- `admin`
- `superadmin`

Legacy `pm` and `head` values are read as `manager` and `admin` temporarily.
They are not valid choices for new records.

Manager is intentionally broad. It can represent a project manager, product
manager, tech lead, 3D lead, or another person assigned responsibility for a
project or team.

## Permission matrix

| Capability | Employee | Manager | Admin | Superadmin |
| --- | --- | --- | --- | --- |
| Access the Phase 1 portal | Yes | Yes | Yes | Yes |
| Read current company PDFs and acknowledge own reading | Yes | Yes | Yes | Yes |
| Publish, replace, archive/restore policies and view acknowledgement reports | No | No | Yes | Yes |
| View company In/Break/Out status | Yes | Yes | Yes | Yes |
| View People directory | No | Assigned project teams | Organisation | Organisation |
| Add and edit People profiles | No | No | Organisation; privileged roles locked | Organisation |
| Access Admin Settings | No | No | Yes | Yes |
| Update permitted own-profile fields | Own | Own | Own | Own |
| Track work and submit BOS/EOD | Own | Own | Own | Own |
| Operate another employee's live timer | No | No | Organisation | Organisation |
| View timesheets | Own | Assigned project teams | Organisation | Organisation |
| View active projects | Assigned | Assigned/owned | All | All |
| Assign a project team | No | Owned projects | All projects | All projects |
| Create, edit, archive projects | No | No | Yes | Yes |
| Create, edit, archive activities | No | No | Yes | Yes |
| Correct time entries with reason | No | Assigned project teams | Organisation | Organisation |
| View organisation downtime | Yes | Yes | Yes | Yes |
| Record/correct organisation downtime | Downtime Manager capability only | Downtime Manager capability only | Organisation | Organisation |
| View work-distribution reports | Own summary | Assigned projects | Organisation | Organisation |
| Apply for leave | Own | Own | Own | Own |
| Approve/reject leave | Designated Leave Admin only | Designated Leave Admin only | Organisation | Organisation |
| Adjust leave balances and manage holidays/late cutoff | Designated Leave Admin only | Designated Leave Admin only | Organisation | Organisation |
| Configure BOS/EOD requirements | No | No | No | Organisation |

## Scope rules

- Department remains employee profile data; it does not grant Manager access.
- Manager access comes only from explicit project/team responsibility and membership.
- Archiving a person means changing the stored employment status to `Released`;
  the UI labels that state `Archived`. Portal access is blocked, operational
  history is retained, and employee profiles are not hard-deleted.
- Admins can manage standard Phase 1 profile fields but cannot create, promote,
  or edit a superadmin. Only a superadmin can grant or remove either the admin
  or superadmin role. Superadmins otherwise have every Admin capability.
- An employee shared across projects is visible to a Manager only within projects
  that Manager owns.
- Admin and superadmin organisation access applies only to Phase 1 modules.
  Payroll, payslips, employee administration, Inbox, Performance, and legacy
  Reports remain unavailable.
- Every authorised manual time correction requires a reason and immutable audit
  history.
- Every admin action on another employee's live timer records the actor, target,
  action, work entry, and timestamp in immutable audit history.
- Navigation visibility is convenience only. Supabase RLS is the enforcement
  boundary and must reject the same unauthorised reads and writes.
- Manager read scope comes from explicit project ownership and membership.
  The employee-profile `reports_to` and department fields do not grant project
  or timesheet access.
- Leave Admin is an explicit capability that only a superadmin may assign to an
  active profile. It does not change the person's application role or grant any
  unrelated management permission. Admins and Superadmins retain the capability by role.
- A Leave Admin cannot decide their own request or adjust their own balance.
  Every request, including a Superadmin request, starts Pending.
- Downtime Manager is a separate explicit capability that only a superadmin may
  assign to an active profile. It does not widen People, project, employee, or
  timesheet scope. Admins and Superadmins retain the capability by role.
- Organisation downtime is never written into employee work entries or breaks,
  never stops a timer automatically, and is not multiplied by employee count.

## Implementation ownership

- `HRMS-005`: canonical roles, permission names, UI capability checks, and this matrix.
- `HRMS-004`: database helper functions, current-table RLS policies, and
  direct-client denial checks. See [Phase 1 Row-Level Security](RLS.md).
- `HRMS-009`: explicit project Manager and member assignments used for Manager scope.
- `HRMS-013`: immutable time-entry correction audit history.
- `HRMS-044`: restricted People navigation, controlled profile changes, and
  project-team read scope.
- `HRMS-045`: separate Admin Settings navigation and superadmin-only
  privileged-role changes.
- `HRMS-048`: Attendance and Leave reset, working-day rules, delegated Leave
  Admin governance, immutable balance history, and factual Attendance.
