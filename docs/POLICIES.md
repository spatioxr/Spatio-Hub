# Company policies — HRMS-056

Agreed 5 September 2026: PDFs have been vetted separately. Uploading publishes
immediately; no draft, preview approval, or publishing workflow is required.

## Product contract

- Policies is available to all active signed-in roles in the common sidebar.
- Admin and Superadmin can upload PDFs (up to 20 MB), with a title and optional
  description. “Require acknowledgement” defaults on and can be turned off for
  reference documents. The setting is immutable within a published version.
- The portal's PDF.js reader supports page navigation, fit-to-width, zoom and
  selectable text on desktop and mobile. PDF code and worker load only when a
  document is opened. The original remains downloadable. Scripts embedded in
  PDFs are not executed by this reader.
- PDF fonts, character maps and image decoders are bundled by
  `scripts/pdf-assets.mjs` and served from the portal's origin. Node 22.13+ is
  required; CI uses Node 22 to match the reader dependency.
- “I have read this” is enabled after the reader renders a page. This records a
  person's explicit confirmation, not proof that they read every page or an
  electronic signature. The portal remains usable without acknowledging.
- Replacing a PDF publishes a new numbered version and requires a fresh
  acknowledgement when enabled. Old PDF bytes, metadata and acknowledgements
  stay available to Admins through version history.
- Archive hides the document and its PDFs from ordinary employee access.
  Restore republishes the same version and retains its acknowledgements.
- Admin reports show pending **currently active staff**, including Admins and
  Superadmins, and all recorded acknowledgements. Inactive people with prior
  acknowledgements remain visible with their employment status. Historical or
  archived versions show recorded acknowledgements only; no historical pending
  roster is invented. Timestamps are displayed in IST.

## Data and access

Migration `20260905000200_company_policies.sql` adds three RLS-protected tables:
`policy_documents`, immutable `policy_versions`, and immutable
`policy_acknowledgements`. All authenticated direct table mutations are denied.
Controlled functions publish, archive/restore and acknowledge. Every function
enforces the existing active-profile/password-reset gate and relevant role.
Acknowledgement takes only a version ID; employee ID and time come from the
server. The version/employee primary key makes repeated clicks idempotent.

The private `company-policies` Storage bucket accepts only application/pdf,
up to 20 MB. Each file uses an Admin-scoped UUID path. Authenticated users cannot
overwrite or delete object bytes, including Admins. Ordinary users can download
only currently published versions. Metadata publication verifies that the
uploaded object exists with the correct MIME type and size. The client also
checks the PDF header; this is format screening, not malware scanning or a
guarantee that every page is well formed. Vetted PDFs remain the upload contract.

Publication uses a stable client attempt ID for safe retries and locks the
document for replacement. Concurrent stale replacements and acknowledgements
are rejected. A metadata failure leaves an Admin-only unreferenced object; a
retry reuses it. Abandoned uploads are deliberately not deleted by ordinary
clients. Any future maintenance cleanup must use trusted server access, verify
that an object is unreferenced and coordinate with publication. No cleanup job
or service-role credential is shipped in this feature.

PDF downloads are authenticated and converted to temporary browser blob URLs;
no public or persisted signed URLs are stored. Reader changes/unmount revoke
the blob URL. Already downloaded copies cannot be recalled by archive or a
permission change.

## Implementation verification — 5 September 2026

`npm run check` passed: lint, 110 unit tests and the production build. A
synthetic-data Chrome browser run passed immediate Admin publishing, employee
PDF rendering and page navigation, acknowledgement failure/retry, replacement,
pending filters, version reports, archive/restore, dialog keyboard dismissal,
and 390px overflow checks. RPC fixtures covered PostgREST row-array responses.

The feature migration and its rollback verifier passed all 39 assertions in
isolated PostgreSQL through PGlite, using the repository's actual Auth helper
definitions and minimal Auth/Storage dependency tables. This does not exercise
the complete existing schema or hosted Storage API. `npm run test:database`
could not start because Docker and an external PostgreSQL connection are
unavailable. The production migration and deployment have not been performed;
HRMS-056 remains In Progress pending the release checks below.

## Verification and release

- `npm run check`: role and PDF validation tests, safe publication retry tests,
  replacement/pending filtering, lint, and production build.
- `supabase/verify/hrms_056_company_policies.sql`: rollback-only actual-role RLS
  and RPC checks for publication, forged acknowledgements, repeated calls,
  private/unpublished/archived file access, employee/manager denial, Superadmin
  access, password/inactive gates, replacement and historical reports.
  This is included in `npm run test:database` and the 24-table schema gate.
- Browser QA must exercise Admin upload and replacement, employee in-portal
  reading and acknowledgement (including a failed save and retry), version
  reports, archive/restore, keyboard dialog dismissal, and 390px layouts.

Apply the migration and run the full Supabase database verification before
deploying the frontend. Test an actual upload/download through the destination
Storage API: isolated PostgreSQL tests verify SQL/RLS, not the hosted Storage
service. Roll back by reverting the Policies UI; retain its private bucket,
tables, grants and all acknowledgement history. Do not drop stored documents.
