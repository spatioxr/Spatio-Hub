# Dashboard product and test contract

The Dashboard is a visual summary of existing Phase 1 facts. It does not own
work actions, corrections, leave decisions, employee editing, or analytics.

## Data ownership

| Dashboard surface | Source of truth | Destination for action |
| --- | --- | --- |
| Workday state | Restored `WorkSessionContext` | Track Work |
| Monthly attendance | `scoped_attendance_month` personal scope | Attendance |
| Leave balances and requests | Shared governed `LeaveContext` projections | Leave |
| Holidays | Shared governed `LeaveContext` holiday list | Leave policy |
| Reporting manager | Self-scoped `current_reporting_manager()` | People |
| Company In/Break/Out | `live_work_status()` and work-mode projection | Live board / rail |
| Active people count | RLS-scoped active employee records | People |

The page reconciles these facts on mount, after timer changes, every minute,
when the browser regains focus, and when the tab becomes visible. This avoids
the former isolated holiday copy and makes changes from Attendance, Leave,
People, and work tracking visible without a hard reload.

## Feedback acceptance

| Feedback | Acceptance check |
| --- | --- |
| 19 | Add a profile picture to a person, open the Dashboard live board/rail, and confirm the image replaces initials without hiding the status dot. |
| 26 | Assign or change the signed-in employee's reporting manager in People, return to the Dashboard or refocus the tab, and confirm the manager name and designation/code update. |
| Dashboard visual redesign | Verify workday hero, summary cards, attendance ring, leave bars, quick actions, holiday dialog, live status, loading/error messaging and empty states at laptop and mobile widths. |

All facts remain permission-scoped in Supabase. The Dashboard introduces no
Phase 2 route or mutation.

## Availability follow-up (17 September 2026)

User-requested extension of the HRMS-048 governed leave surface: Leave Admin
viewers see today's approved absences plus the next four upcoming approved
requests, ordered by start date. Future rows show the employee, leave type,
half-day indicator and date range. Ongoing leave stays in today's list; pending,
rejected and cancelled requests are excluded. Empty lists have explicit messages,
and a View all leave link appears when either list has more than four requests.
Both lists reuse `scoped_leave_requests` through LeaveContext and retain the
existing permission boundary and dashboard refresh cycle.

Verify date/year boundaries, ordering and excluded statuses with dashboard unit
tests; check populated/empty availability and date wrapping at laptop/mobile widths.

The Next Holiday card now opens a monthly company calendar (HRMS-035 follow-up).
It starts at the next holiday's month, or the current month if none is upcoming.
Previous/next month and Today controls support browsing; holidays are highlighted
with date markers and their full names appear in a readable list below the grid.
Only the displayed month's holidays are marked; today's date is outlined. It reuses the
governed holiday list, IST date formatting and existing accessible dialog focus,
Escape and dismissal behavior. Month-grid tests cover leap days, Monday/Sunday
starts, multiple holidays on a date and navigation across year boundaries.
