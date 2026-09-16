# Analytics CSV exports — feedback item 42

Reference: [HRMS Feedback Tracker, item 42](https://docs.google.com/spreadsheets/d/1nJBJlD2fnlaeBP-sUiGGA5yilEgZqSpOQqUlId9uugc/edit?gid=0#gid=0).

Analytics offers three export formats. Each file contains one header row and a
consistent table, with no blank separator rows, totals rows, or appended tables.
Work entries is the default. Exports use the already loaded, permission-scoped
report data; there are no new database queries or permission changes.

| Format | Columns |
| --- | --- |
| Work entries | Work date (IST), Employee code, Employee, Department, Work type, Project / activity, Task description, Start (IST), End (IST), Status, Break hours, Worked hours |
| Daily employee summary | Work date (IST), Employee code, Employee, Department, Session count, Break hours, Worked hours, Status |
| Organisation downtime | Event, Category, Status, Start (IST), End (IST), Recorded hours, Notes |

## Interpretation

- Work exports respect the applied reporting period and project, activity,
  department, and employee filters. Daily rows group by employee ID and the
  session's IST start date, matching the existing Timesheets and Analytics model.
  An overnight session belongs entirely to its start date; this is not a calendar
  midnight split. Dates with no matching sessions do not generate zero rows.
- Start and end use `YYYY-MM-DD HH:mm:ss` in Asia/Kolkata (IST). Both include the
  date so overnight sessions are unambiguous. Work date uses `YYYY-MM-DD`.
- A missing session end is blank and labelled `In progress`. Daily rows are
  `In progress` if any included session is open. Durations are the server-provided
  snapshot from the last data load, not recomputed at the moment of download.
- Hours are numeric decimal values rounded to two decimal places: `1.50` means
  1 hour 30 minutes. Daily totals sum source seconds before rounding. Therefore,
  summing individually rounded detailed rows can differ slightly from the daily
  summary. Worked hours already exclude breaks.
- Downtime uses the selected reporting period, but not employee/project filters.
  It remains a separate organisation measure and is never added to work totals
  or multiplied by employee count. Categories and statuses have readable labels.
- Only the selected export's data determines whether download is enabled. With
  no matching work, downtime can still be exported if events exist.
- Filenames identify the export type and applied date range. Files use UTF-8 BOM,
  CRLF rows, quoted/escaped cells, and formula neutralisation for text that could
  execute as a spreadsheet formula, including leading whitespace.

## Verification

`npm run check` covers unit tests, lint, and production build. Focused tests cover
IST midnight and overnight boundaries, employee identity grouping, open sessions,
rounding after aggregation, separate downtime, empty files, filenames, Unicode,
quoted/multiline text, and formula safety.

Browser acceptance: download all three formats with synthetic data, verify work
filters in the downloads, verify downtime is independent of work filters, verify
empty work disables only work exports, and inspect controls at 390px width.

Local verification on 16 September 2026: all 129 unit tests, lint, and production
build passed. Synthetic-data Chrome checks passed all three actual downloads,
filter isolation, independent downtime, empty-result states, and mobile controls.
