# External Observer access

Approved by Jasim on 16 September 2026 as an extension of the tracker’s
HRMS-004 (database enforcement), HRMS-005 (permissions), HRMS-042 (credentials)
and HRMS-045 (access administration). The tracker had no separate Observer issue
when inspected; no existing issue was relabelled or marked Done for this work.

## Account model

Use **Settings → Users & Access → Edit → Application role → Observer (view only)**.
The same Add person form can create an Observer. There is no separate external
access page. Only an active, password-ready Superadmin can assign or remove the
Observer role; Admins can see these profiles but cannot change them.

Observer is an application role in the unified user list. Internally, external
identities remain separate from active staff so they never enter headcount,
attendance, leave, capacity, costing or policy-obligation rosters. For a converted
staff user, the login moves atomically to the Observer identity and the original
staff row is archived and hidden from the current directory. Work history and
its foreign keys are retained. The unified list shows one user, not two profiles.

Switching that user back to a staff role restores the original staff identity and
login. A newly created Observer can also become staff after entering an Employee
ID and the required staff fields. Login passwords are not reset by a role change.
Running timers and pending leave must be resolved before conversion. Existing
last-project-manager checks still prevent an unsafe role change, and a
Superadmin cannot convert their own account to Observer. Delegated Leave Admin
and Downtime Manager flags are cleared during conversion.

When Observer is selected, employee-only fields and capabilities are hidden or
disabled. Create login / Reset password and Archive / Restore stay in the same
Users & Access list. New Observers use the existing temporary-password workflow;
no email is sent automatically. Share the generated password privately. Revoked
accounts lose database reporting access even with a previously issued session.

## Observer experience

Observers land on an organisation overview and can browse projects, time records,
factual attendance and work summaries. All are read-only. Dates use Asia/Kolkata,
with an inclusive range of at most 31 days. Work totals clip sessions and breaks
to that range; open sessions older than 24 hours are marked unresolved and excluded
from totals. These are recorded-work summaries, not the staff workload/costing
allocation model. Attendance includes recorded work, approved-leave presence,
holidays and weekends; no record is not inferred to be absence.

Observers have no Track Work, leave application, People administration, policy
acknowledgement, settings or correction actions. The timer and staff background
queries/subscriptions are suppressed. They can change their own Auth password and
sign out. Profile picture editing is unavailable.

The reporting projection deliberately excludes staff emails and phone numbers,
private profile details, leave types/reasons/balances, BOS/EOD text, credentials
and administrative settings. Observer login-profile reads expose only their own
external account. Existing staff report RPCs remain staff-scoped; the Observer
does not inherit Admin/Superadmin privileges.

## Database boundary

`20260916000200_external_observer_access.sql` establishes the read-only boundary:

- RLS on `external_accounts`, own-profile/Superadmin reads and no direct client writes.
- `save_external_account`, guarded by active Superadmin access.
- `observer_hub_snapshot`, a bounded, explicit allowlist of reporting fields,
  guarded by active, password-ready external identity on every request.
- Restrictive external-identity policies on existing public tables and Storage.
- Write-denial triggers on existing public tables, including writes reached
  through security-definer functions. Revoked and password-gated external
  identities also remain subject to these guards.
- Cross-table identity checks preventing an external login from acquiring a
  staff profile through the legacy email-link path.

Future public tables must preserve this external read/write boundary. Do not add
Observer to `has_organisation_access()` or reuse Admin mutation permissions for
view-only navigation. Add reporting fields only through a reviewed projection.

`20260916000400_unified_observer_role_editor.sql` adds the unified admin list,
Superadmin-only atomic role conversions, historical staff links and protection
against reactivating a linked staff record through the old staff RPCs. It keeps
the earlier read-only boundary intact.

## Release and verification

Apply both Observer database migrations first, deploy the updated `user-credentials` Edge
Function second, then publish the frontend. No production migration or deployment
was performed as part of the local implementation. Existing staff data is not
rewritten. To disable the feature, revoke external accounts; retain their records
and guards rather than dropping the table while external Auth identities exist.

`external_observer_access.sql` and `unified_observer_role_editor.sql` are wired into the database runner. It verifies
Superadmin creation/revocation/restoration, staff exclusions, break-adjusted
read-only reporting, raw-table/private-data denial, mutation denial including
a definer bypass attempt, duplicate identity rejection, and inactive/password/
anonymous denial. Application tests exercise role permissions, date bounds,
attendance wording, unresolved totals and the actual credentials handler with
mocked Auth operations. Synthetic browser checks cover navigation, forbidden
routes, filters, error clearing, the unified editor, role round trips, new Observer login provisioning and mobile layout. Hosted Auth
and Edge Function smoke checks are still required after deployment.
