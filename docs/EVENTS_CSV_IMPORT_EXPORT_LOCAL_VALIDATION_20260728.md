# BARINV PRO Events CSV Import/Export Local Validation - 2026-07-28

## Executive Summary

Result: PASS.

This local-only follow-up feature adds secure CSV Import and Export to the Web Admin Events Log. It was built from production release commit `d004bc371008624a885fb71c81360225f1120a33` on branch `feature/events-csv-import-export-v1`.

No Production Supabase project, Edge Function, web deployment, tag, push, or iOS repository was touched for this CSV feature.

## Scope

Modified production/admin source:

- `index.html`
- `supabase/migrations/20260728090000_events_csv_import_jobs.sql`
- `supabase/rollbacks/20260728090000_events_csv_import_jobs_ROLLBACK.sql`

Added local validation:

- `supabase/tests/events_csv_import_export_local_test.sql`
- `docs/EVENTS_CSV_IMPORT_EXPORT_LOCAL_VALIDATION_20260728.md`

Expected untracked local folders remain excluded:

- `graphify-out/`
- `supabase/.temp/`

## Architecture

Export is manager-authorized through `public.barinv_export_events_csv_page(...)`. The RPC enforces Venue and Night scope, applies current filters, returns joined readable labels, paginates in pages no larger than 500, and returns `qty` as `numeric::text` so decimal formatting is preserved.

Import is durable and server-authoritative:

- `public.event_csv_import_batches`
- `public.event_csv_import_rows`
- `public.barinv_create_event_csv_import_batch(...)`
- `public.barinv_process_event_csv_import_batch(...)`
- `public.barinv_get_event_csv_import_batch(...)`
- `public.barinv_retry_event_csv_import_failures(...)`

The browser parses the selected CSV and requests a server preview before any insert. The database validates scope, IDs, action, quantity, `qty_basis`, `reason_code`, duplicate `client_event_id`, and authorization. Processing inserts only `PENDING` Events with `source = 'admin_csv_import'`.

## CSV Format

Export columns:

`event_id, created_at, venue_id, venue_name, night_id, night_name, bar_id, bar_name, station_id, station_name, item_id, item_name, action, qty, status, reason_code, qty_basis, notes, submitted_by, staff_id, staff_name, session_id, source, client_event_id`

Import template headers:

`client_event_id, bar_id, bar_name, station_id, station_name, item_id, item_name, action, qty, qty_basis, reason_code, notes, submitted_by, staff_id, staff_name, session_id`

Import uses IDs as authoritative fields. Name columns are readable companions only and are not guessed or matched when IDs are absent.

Omitted import fields:

- `event_id`: imports cannot update existing Events.
- `venue_id` and `night_id`: selected Admin filters are authoritative.
- `status`: supplied status is rejected because imports always create `PENDING`.
- `source`: assigned by the server as `admin_csv_import`.
- `created_at`: assigned by the database.

## Zero-Row Behavior

Export with zero matching Events:

- Shows `0 matching rows`.
- Prevents download.
- Does not claim that any Events were exported.

Import with headers but no data rows:

- Preview reports `total_rows = 0`.
- Creates no import batch.
- Inserts nothing.
- Disables confirmation and shows `No data rows found`.

Empty or whitespace-only file:

- Rejected in the browser with `CSV file is empty or whitespace only`.

All-invalid or all-duplicate import:

- Creates no Events.
- Reports accurate valid, invalid, duplicate, skipped and inserted counts.
- Confirmation is disabled when there are no valid rows.

## Security Model

Security review result: PASS.

- An authenticated manager role for the selected Venue is required for every CSV RPC.
- `anon` has no CSV RPC execute grant.
- RLS is enabled on import batch and row tables.
- CSV import cannot create `APPROVED` or `REJECTED` Events.
- Venue and Night are enforced server-side.
- Bar must belong to the selected Venue and Night via `night_bars`.
- Station must belong to the selected Venue and Bar.
- Item and Staff must belong to the selected Venue.
- Session, when supplied, must belong to the selected Venue and Night.
- Existing status firewall and Event review audit behavior are unchanged.
- CSV import does not write to `event_review_audit`.
- Existing auto-approval is not triggered for `source = 'admin_csv_import'`.
- All SECURITY DEFINER functions use explicit `search_path = ''`.
- SQL uses typed parameters only; no dynamic SQL or interpolated filters.
- Formula-injection protection neutralizes exported values beginning with `=`, `+`, `-`, or `@`.

## Validation Results

Graphify:

- `graphify extract . --no-cluster` scanned the code corpus before implementation. Semantic doc/image extraction required an LLM key and was not used.
- `graphify update .` after source changes: PASS.

SQL compile/apply:

- Migration `20260728090000_events_csv_import_jobs.sql`: PASS on disposable harness.
- Idempotent reapply after index correction: PASS.

Rollback:

- Rollback file is outside `supabase/migrations`: PASS.
- Rollback drops RPCs before tables and drops row table before batch table: PASS.
- Rollback validation against disposable harness: PASS.
- Reapply after rollback: PASS.

Structural validation:

- `event_csv_import_batches` RLS enabled: PASS.
- `event_csv_import_rows` RLS enabled: PASS.
- CSV RPCs are SECURITY DEFINER with explicit safe search path: PASS.
- Anon execute grants absent: PASS.
- Duplicate preview rows are stored with a non-unique batch/client index: PASS.

## Test Matrix

Local disposable harness: `barinv_event_review_pgtest_20260727`.

CSV SQL suite:

- File: `supabase/tests/events_csv_import_export_local_test.sql`
- Assertions: 27 passed, 0 failed.

Covered cases:

- Export selected rows: PASS.
- Export current page: PASS.
- Export all matching beyond 1,000 rows: PASS.
- Export zero matching rows: PASS.
- Venue/Night scope: PASS.
- Exact decimal `qty` text: PASS.
- Joined labels: PASS.
- Import zero data rows creates no batch: PASS.
- Non-array/malformed server payload rejected: PASS.
- Valid one-row preview and import: PASS.
- Status override rejected: PASS.
- Cross-Venue IDs rejected: PASS.
- Cross-Night bar rejected: PASS.
- Dangerous text rejected at import preview: PASS.
- Duplicate `client_event_id` in file skipped: PASS.
- Existing duplicate `client_event_id` skipped: PASS.
- All-invalid import creates no Events: PASS.
- 1,500 valid rows previewed: PASS.
- First import batch processed exactly 500 rows: PASS.
- Resume completed the 1,500-row import: PASS.
- Reprocessing completed import is idempotent: PASS.
- Imported Events remain `PENDING`: PASS.
- `admin_csv_import` does not trigger Barback auto-approval: PASS.
- Failed-row retry requeues only failed rows: PASS.
- Unauthorized import/export rejected: PASS.
- RLS/grant/search_path checks: PASS.

Existing Event review suite after CSV migration:

- File: `supabase/tests/event_review_feature_local_test.sql`
- Temporary local run removed only incompatible `SET SESSION AUTHORIZATION` lines because the harness `postgres` role is not superuser.
- Assertions: 50 passed, 0 failed.

Browser/source helper validation:

- JavaScript inline syntax: PASS.
- `git diff --check`: PASS.
- CSV helper source assertions: 9 passed, 0 failed.
- Covered BOM marker, RFC quoting, formula neutralization, quoted parser fields, header-only zero rows, whitespace-only rejection, exact qty text and ISO timestamp output.

## Load/Resume/Retry Counts

The 1,500-row case is a stress test only. Operational logic supports valid row counts from 0 through the configured maximum of 5,000.

1,500-row import:

- Preview total rows: 1,500.
- Valid rows: 1,500.
- First processing call: 500 rows.
- Final inserted rows: 1,500.
- Final processed rows: 1,500.
- Final status: `completed`.
- Inserted Event status: all `PENDING`.
- Review audit rows for imported Events: 0.

Retry test:

- Retry batch rows: 3.
- Injected failures: 1.
- Initial inserted rows: 2.
- Initial failed rows: 1.
- Requeued rows: 1.
- Final inserted rows: 3.
- Failed rows after retry: 0.
- Only failed row had `attempt_count = 2`.

Export beyond 1,000 rows:

- Matching rows: 1,005.
- Page 1 returned: 500.
- Page 2 returned: 500.
- Page 3 returned: 5.

## Root Causes Found

During local validation, the initial CSV import row index was incorrectly unique on `(batch_id, client_event_id)`. That prevented duplicate rows from being recorded as preview errors. The migration was corrected to use a non-unique index so duplicate rows can be stored and reported without aborting preview.

The SQL test initially asserted Event inserts in the same SQL statement that invoked a side-effecting RPC. PostgreSQL snapshot visibility meant the RPC JSON was visible but the inserted row was not. The test was corrected by splitting RPC execution and post-insert assertions into separate statements. This was a test defect, not a production defect.

## Commands Used

Representative local commands:

```sh
/Library/Frameworks/Python.framework/Versions/3.13/bin/graphify extract . --no-cluster
/Library/Frameworks/Python.framework/Versions/3.13/bin/graphify update .
docker start barinv_event_review_pgtest_20260727
docker exec -i barinv_event_review_pgtest_20260727 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/20260728090000_events_csv_import_jobs.sql
docker exec -i barinv_event_review_pgtest_20260727 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/events_csv_import_export_local_test.sql
docker exec -i barinv_event_review_pgtest_20260727 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/20260728090000_events_csv_import_jobs_ROLLBACK.sql
awk '/^<script>$/{flag=1;next}/^<\/script>$/{flag=0}flag' index.html > /tmp/barinv-index-inline.js
node --check /tmp/barinv-index-inline.js
git diff --check
```

## SHA256

```text
2e1627e1a8be208677c35d031929430fecf1620e7ab4383bf8e1ec0155c6e50e  index.html
c96403be7cfc3824388b60edb02f8ef5b3d1623401573cba112ba0681795ff42  supabase/migrations/20260728090000_events_csv_import_jobs.sql
66598989a83ff9500b8ad5de2179534e9b760924574842400492f25ce4c21ab1  supabase/rollbacks/20260728090000_events_csv_import_jobs_ROLLBACK.sql
a000e5cf6aae00e54716bbe449454c5c0eac7d68a250d767a43bd4057179cd8e  supabase/tests/events_csv_import_export_local_test.sql
```

## Remaining Risks

- The Events page currently has no text search input, so CSV export respects the existing Venue, Night, Bar, Status, and Action filters.
- The import template includes readable name companion columns, but IDs remain authoritative by design.
- Full browser-click UX testing was not performed in Production. Local source and helper validation passed, and database behavior was validated in the disposable harness.
- The Supabase CLI lint was not rerun for this new feature because the available validated path for this work was the isolated disposable PostgreSQL harness, not the linked Production project.

## Final Local Status

- CSV migration compile/apply: PASS.
- CSV rollback validation: PASS.
- CSV SQL assertions: 27 passed, 0 failed.
- Existing Event review assertions: 50 passed, 0 failed.
- JavaScript syntax: PASS.
- CSV helper assertions: 9 passed, 0 failed.
- `git diff --check`: PASS.
- Production Supabase: UNTOUCHED for CSV feature.
- Edge Functions: NOT DEPLOYED for CSV feature.
- Web deployment: NOT PERFORMED for CSV feature.
- Git push/tag: NOT PERFORMED for CSV feature.
- iOS repository: UNTOUCHED.
