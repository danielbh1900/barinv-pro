# BARINV PRO P0 Phase 0 Freeze Report

Date: 2026-07-29
Result: PASS
Backup directory: `/Volumes/MiniSSD/BARINV_FULL_BACKUPS/BARINV_P0_PHASE0_FREEZE_20260729_230806`

## Executive Summary

The P0 Phase 0 backup and freeze completed without changing product code, Production schema/data, Functions, deployments, Git remotes, tags, iOS signing, app data, or firmware.

The package preserves all three repository states, deployed web assets, iOS source/generated assets and build settings, Production database schema/data/roles/auth/storage/migration history, Supabase policies/functions/grants, BARINV.ca pages and metadata, Scale Lab dirty state, ESP32 firmware, and restore evidence.

The known `public.backfill_night_bars` lint error remains present and unchanged. It is evidence, not a Phase 0 backup failure.

## Source of Truth

- Audit commit: `15f5ef2841ef44417a186d0dd227323f43298b4b`
- P0 plan commit: `2f26b7d39215bb79390923c1620c4ebbe2a77f93`
- Both commits are ancestors of the frozen web HEAD.

## Repository Freeze

| Surface | Branch | HEAD | Tracked state | Untracked | Bundle |
|---|---|---|---|---:|---|
| Web / Barback | `feature/events-csv-import-export-v1` | `2f26b7d39215bb79390923c1620c4ebbe2a77f93` | clean | 2 | PASS |
| iOS / Admin | `feature/events-bulk-approval-v1` | `37d4cf5788a4607cea874098aad4611ad360848d` | clean | 14 | PASS |
| Scale Lab | `master` | `e139f53743c036bde6872f81b41ad88d6a310842` | dirty, preserved | 18 | PASS |

Each repository directory under `git/` includes branch/HEAD/tags, redacted remotes, status, branches, refs, log, tracked/staged diffs, tracked/untracked inventories, all-ref bundle, HEAD archive, bundle verification, and restore notes.

Scale Lab additionally includes `working_tree_excluding_secrets.tar.gz`. It preserves modified/untracked work without reset, stash, checkout, clean, or source modification. Credential-like files, dependencies, and generated caches were deliberately excluded.

## Web / Barback Freeze

Live GitHub Pages source:

- Status: `built`
- Branch/path: `{'branch': 'main', 'path': '/'}`
- URL: `https://danielbh1900.github.io/barinv-pro/`
- Open PRs: 0
- Remote branches captured: 31

Live/local comparison:

| Asset | Local SHA256 | Live SHA256 | Result |
|---|---|---|---|
| `index.html` | `2e1627e1a8be208677c35d031929430fecf1620e7ab4383bf8e1ec0155c6e50e` | `2e1627e1a8be208677c35d031929430fecf1620e7ab4383bf8e1ec0155c6e50e` | MATCH |
| `barback.html` | `201c504db4b00660bacfebbb56487897133af356630ad1bc7c814fc75c71fdc8` | `201c504db4b00660bacfebbb56487897133af356630ad1bc7c814fc75c71fdc8` | MATCH |
| `barback_manager.html` | `a89be690688ba680ac8045fc3491da6e486f03b21c89d1b6e7307656970d0787` | `a89be690688ba680ac8045fc3491da6e486f03b21c89d1b6e7307656970d0787` | MATCH |


`sw.js` and `barback_sw.js` were copied and hashed locally. Test files, package-file inventory, migrations, rollbacks, and Supabase tests were archived. No web package manifest exists at the repository root; the test archive remains non-empty.

## iOS / Admin Freeze

- Branch: `feature/events-bulk-approval-v1`
- HEAD: `37d4cf5788a4607cea874098aad4611ad360848d`
- Bundle ID: `com.barinv.pro`
- Marketing version: `1.0`
- Build number: `1`
- Deployment target: `15.0`
- Device family: `"1,2"`
- Supported platforms: ``
- Code signing style: `Automatic`
- Source/generated asset equality: `PASS`

Frozen asset pairs:

- `www/index.html` and `ios/App/App/public/index.html`: `7df9a6f84c676d4b641070edc09a6b1c91b83d3757350d041f61abb180ea7e93`
- `www/barback.html` and generated copy: `c6a18cc482bc9c2576a19bbdf18ce5f09f697719a2b900b4e73aef52c1563f7e`
- `www/barback_manager.html` and generated copy: `e84e2d5927385cb202feefd4be0d3597b91211a0ba3e18696792e8aff29606b7`

`capacitor.config.json`, `package.json`, `Info.plist`, `AppDelegate.swift`, and the Xcode project were copied. No `xcodebuild`, Capacitor copy, signing change, archive, install, or app-data clearing occurred.

## Supabase Production Freeze

- Expected/linked project: `uzommuafouvaerdvirzf`
- Project reference verification: PASS
- Migration entries: 92
- Migration drift: NO
- Deployed Functions captured: 20
- Public schema SHA256: `5b9bc23789a1e5ba520617d2466e365faa9096ab25c29a47da318dcee8ba8258`
- Public data SHA256: `5c0b9e9e88ff4f391072cb47f598a56dd857ada1e524ba3196446e32bc98d27c`
- Database lint: completed; known unchanged error in `public.backfill_night_bars` (`night_id` ambiguous)

Backup files:

| File | Bytes |
|---|---:|
| `auth_data.sql` | 80779 |
| `public_data.sql` | 81092300 |
| `public_schema.sql` | 397174 |
| `roles.sql` | 410 |
| `storage_data.sql` | 48426 |
| `supabase_migrations_data.sql` | 484366 |


Auth, roles, and storage backups were written with restrictive permissions and were not inspected or printed.

Schema inventory:

- Functions: 68
- Policies: 240
- RLS enable statements: 94
- Grants/revokes: 442
- Triggers: 0

P0 evidence confirms the current Production state:

- `events_insert_v` scopes the caller but does not force `PENDING`.
- `events_update_v` grants authenticated staff broad Event updates.
- `_backup_all_venues_daily`, `_do_create_backup`, and `prune_venue_backups` grant execute to `anon` and `authenticated`.

Only read-only list, lint, and dump commands were used. No push, migration, repair, SQL insert/update/delete, Function deployment, or secret operation occurred.

## Event Before-State

- Total Events: 1059
- APPROVED: 557
- PENDING: 480
- REJECTED: 22
- Protected-field hash: `9a16abb261ab1623d99ff056aae091da66d01501b6b54b9f61d34d76dc3f67df`
- All-column Event hash: `b82eb509c4ea2616ad92cfaa70c32d1b1df8f2150a3a2f67c55cdb00f4174249`
- Review audit rows: 223
- Review audit hash: `40d1820c0c1ac6c9a41f10921b0737dbdca2bec306e4be6142e1205fbeeca173`

Selected table counts:

| Table | Rows |
|---|---:|
| `barback_scale_latest` | 2 |
| `barback_sessions` | 83 |
| `bars` | 131 |
| `event_csv_import_batches` | 0 |
| `event_csv_import_rows` | 0 |
| `event_review_audit` | 223 |
| `event_review_job_items` | 0 |
| `event_review_jobs` | 0 |
| `events` | 1059 |
| `night_bars` | 220 |
| `night_staff_assignments` | 108 |
| `nights` | 14 |
| `placements` | 1148 |
| `staff` | 207 |
| `venue_members` | 6 |


The hashes use canonical compact JSON with rows sorted by `id`/`created_at`; COPY nulls are JSON null. No row values appear in this report.

## BARINV.ca Freeze

| Path | HTTP |
|---|---:|
| `/` | 200 |
| `/features` | 200 |
| `/platform` | 200 |
| `/privacy` | 200 |
| `/terms` | 200 |
| `/robots.txt` | 200 |
| `/sitemap.xml` | 200 |
| `/privacy-policy.html` | 404 |

Raw bodies, headers, hashes, title/meta/canonical/OpenGraph summaries, and link inventories are preserved. The expected `/privacy-policy.html` 404 remains confirmed. A canonical current version-controlled BARINV.ca source was not identified; candidate/source-search evidence and this restore gap are recorded.

## Scale / ESP32 Freeze

- Scale Lab HEAD: `e139f53743c036bde6872f81b41ad88d6a310842`
- Scale Lab tracked state: dirty and preserved
- Scale Lab working-tree archive: `/Volumes/MiniSSD/BARINV_FULL_BACKUPS/BARINV_P0_PHASE0_FREEZE_20260729_230806/git/scale_lab/working_tree_excluding_secrets.tar.gz`
- iOS ESP32 firmware files: 8
- iOS scale test files: 4
- Web scale test files: 0
- Scale Lab test files: 4

README, handoff, report, analysis, firmware, and test inventories/hashes are included. No hardware was connected and no firmware was built or flashed.

## Disk and Backup Health

MiniSSD began this freeze with approximately 38 GiB available at 96% utilization. Initial and final `df -h` evidence, recent BARINV backup directories, package size, manifest, checksum verification, and restore guide are included.

## Validation

- Required directories: PASS
- Key files non-empty: PASS
- JSON parse: PASS
- Git bundle verification: PASS
- Live GitHub Pages hashes: PASS
- BARINV.ca required captures: PASS
- SHA256SUMS: PASS after final generation/verification
- Product code modified: NO
- Supabase mutation: NO
- Push/tag/deploy: NO
- iOS build/signing/app-data change: NO

## Restore and Security Notes

Use `restore/RESTORE_GUIDE.md`. Restore only into a new isolated location or separately approved target. Never apply rollback/security-relaxing SQL automatically. Verify SHA256SUMS and Git bundles before use. Sensitive backup files must remain access-controlled and must not be printed.

## Phase 0 Result

Phase 0 backup and freeze: **COMPLETE / PASS**

Next approval required: owner decisions D1-D8, then a separately scoped approval for the first local-only P0 remediation implementation. No P0 fix is authorized by this report.
