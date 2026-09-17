# Sorting in phase 1

User-authorised 17 September 2026, extending the workload/project usability work
(feedback 14/50, HRMS-029/030) to the existing phase-1 lists.

Click a data-column heading to sort ascending; click again for descending.
The arrow and `aria-sort` identify the selected column and direction. Action
columns remain ordinary actions. Card lists use Sort by and Order controls.
Sorting applies to the entire filtered, permission-scoped dataset already loaded
by the page. It does not change records, totals, exports, permissions or RLS.

Covered views:
- Workload people, project members, and individual project/internal allocations.
- People directory and Users & Access.
- Leave request/history/review tables and policy acknowledgement reports.
- Observer live people, timesheets, attendance, work summaries and project lists.
- Project administration/team lists and internal activity catalogue.
- Timesheet month team summaries and Analytics supporting entries.

Workload project sorting remains as previously implemented. Calendars, daily
work/break timelines and audit histories retain their chronological structure.
Unmounted phase-2 pages are not changed.

Sort choices are scoped by view and retained in query parameters. Hours/counts
use numeric values, names/codes use case-insensitive natural ordering, dates use
ISO dates or timestamps. Missing values sort last in both directions. Ties keep
source order. Composite cells provide a primary `data-sort-value` so secondary
labels, initials and badges cannot alter the order.
