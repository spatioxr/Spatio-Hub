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
