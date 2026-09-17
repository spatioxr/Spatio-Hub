# Workday check-in requirements

Phase-1 admin settings follow-up (HRMS-045): the superadmin-only route and existing `set_daily_report_requirements` RPC authorization remain unchanged.

The page lists active employees, employee IDs and explicit Required/Optional states for each report. Both reports default to required when no saved preference exists. Search matches names or IDs, sortable headings support scanning, and Exceptions shows employees with either report optional. Counts remain placeholders during load/error; failures offer Retry.

Edit opens a focused drawer with independently labelled Required/Optional radio groups. Optional means the employee can start/end the day without that report. Make both required edits the draft only. Save is disabled until changed; Cancel/Escape/backdrop confirm discarding changes, and closing is blocked while saving. Drafts are separate from the saved settings map, so cancelling cannot leave unsaved values displayed as saved. Successful saves update only the target row and notify existing work-session listeners.

Verification: default/exception and draft-isolation unit tests, lint/build, desktop exception filtering, unchanged Save disabled, and responsive layout checks. Live employee requirements are not changed during verification.
