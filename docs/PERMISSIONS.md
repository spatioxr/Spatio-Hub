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
| View company In/Break/Out status | Yes | Yes | Yes | Yes |
| View People directory | No | Assigned project teams | Organisation | Organisation |
| Add and edit People profiles | No | No | Organisation, except superadmin role | Organisation |
| Update permitted own-profile fields | Own | Own | Own | Own |
| Track work and submit BOS/EOD | Own | Own | Own | Own |
| View timesheets | Own | Assigned project teams | Organisation | Organisation |
| View active projects | Assigned | Assigned/owned | All | All |
| Assign a project team | No | Owned projects | All projects | All projects |
| Create, edit, archive projects | No | No | Yes | Yes |
| Create, edit, archive activities | No | No | Yes | Yes |
| Correct time entries with reason | No | Assigned project teams | Organisation | Organisation |
| View work-distribution reports | Own summary | Assigned projects | Organisation | Organisation |
| Apply for leave | Own | Own | Own | Own |
| Approve/reject leave | No | No | No | Organisation |
| Configure BOS/EOD exceptions | No | No | No | Organisation |

## Scope rules

- Department remains employee profile data; it does not grant Manager access.
- Manager access comes only from explicit project/team responsibility and membership.
- People removal means changing the employment status to `Released`;
  operational history is retained and employee profiles are not hard-deleted.
- Admins can manage standard Phase 1 profile fields but cannot create, promote,
  or edit a superadmin. Superadmins have the same capability without that role
  boundary.
- An employee shared across projects is visible to a Manager only within projects
  that Manager owns.
- Admin and superadmin organisation access applies only to Phase 1 modules.
  Payroll, payslips, employee administration, Inbox, Performance, and legacy
  Reports remain unavailable.
- Every authorised manual time correction requires a reason and immutable audit
  history.
- Navigation visibility is convenience only. Supabase RLS is the enforcement
  boundary and must reject the same unauthorised reads and writes.
- Manager read scope comes from explicit project ownership and membership.
  The employee-profile `reports_to` and department fields do not grant project
  or timesheet access.

## Implementation ownership

- `HRMS-005`: canonical roles, permission names, UI capability checks, and this matrix.
- `HRMS-004`: database helper functions, current-table RLS policies, and
  direct-client denial checks. See [Phase 1 Row-Level Security](RLS.md).
- `HRMS-009`: explicit project Manager and member assignments used for Manager scope.
- `HRMS-013`: immutable time-entry correction audit history.
- `HRMS-044`: restricted People navigation, controlled profile changes, and
  project-team read scope.
- `HRMS-034`: leave workflow correctness. Phase 1 keeps approvals superadmin-only
  unless the tracker is deliberately changed.
