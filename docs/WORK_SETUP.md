# Work Setup

Phase-1 settings follow-up to HRMS-045 (admin settings), project administration and internal activity setup. Work Setup now opens directly to Projects; the existing project/activity URLs remain valid. Projects, Internal activities and Costing share section navigation. All routes keep their existing admin permission gates and all mutations continue through the existing authorized Supabase RPCs.

- Setup projects use sortable Code, Project, Managers and Status columns with a single Edit action. Descriptions and Archive/Restore live inside Edit. Setup edits definitions and manager assignments; team assignments remain in Manage → Projects and are not resubmitted by setup saves.
- Activities use sortable Activity, Description and Status columns. Description previews are limited to two lines. The historical-name restriction is explained beside the locked name field. Archive/Restore is inside Edit and retains reported work.
- Active/Archived/All controls include counts, using an ellipsis during loading. The separate statistic cards and sort dropdown rows are removed from setup lists.
- Drawers block closing during saves and confirm discarding changed forms. Unchanged forms cannot save. Availability actions require clean forms. Settings forms also guard refresh/close and normal link navigation when dirty or saving.
- Costing starts with the currently effective saved monthly hours, scheduled changes and collapsed history. Edit pre-fills the baseline effective for the selected month. Revisions for the same month use the latest ID, matching the database calculator. All baseline rows are paginated so future schedules cannot hide an older effective value. The 176-hour default is used only when no saved baseline applies. Existing reason, month and numeric validation remain in place.

Verification: `npm run check`, focused costing-baseline tests, desktop/mobile inspection of tabs and drawers, unchanged-save checks. No real project, activity, assignment or costing mutations are performed during UI verification.
