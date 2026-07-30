# P0-03 Backup Function Grants Local Validation

## Executive Summary

P0-03 local implementation and isolated validation passed on 2026-07-30.
The forward-only migration removes `PUBLIC`, `anon`, and `authenticated`
execution access from the three privileged backup/prune `SECURITY DEFINER`
functions and preserves `service_role` plus implicit owner access.

No function body, owner, security mode, search path, table, or business row was
changed. No Production Supabase command, linked migration command, deployment,
push, tag, iOS operation, Barback UI change, or BARINV.ca change was performed.

## Scope

- Repository: `/Users/saiedbeikhosseini/Documents/barinv-pro`
- Branch: `fix/p0-backup-function-grants-v1`
- Starting HEAD: `a052e5845a8335e68e7f02822db8c4a8701f06f1`
- Phase 0 evidence:
  `/Volumes/MiniSSD/BARINV_FULL_BACKUPS/BARINV_P0_PHASE0_FREEZE_20260729_230806`
- Disposable database:
  `barinv_event_review_pgtest_20260727`
- Local database image:
  `public.ecr.aws/supabase/postgres:17.6.1.075`

Only these feature files were created:

- `supabase/migrations/20260730110000_lock_down_backup_maintenance_functions.sql`
- `supabase/rollbacks/20260730110000_lock_down_backup_maintenance_functions_ROLLBACK.sql`
- `supabase/tests/p0_backup_function_grants_local_test.sql`
- `docs/P0_03_BACKUP_FUNCTION_GRANTS_LOCAL_VALIDATION_20260730.md`

## Root Cause

The Phase 0 Production schema freeze showed explicit `EXECUTE` grants to
`PUBLIC`, `anon`, and `authenticated` on internal maintenance helpers that can
create or prune backup data:

- `public._do_create_backup(uuid,text,jsonb,uuid)`
- `public._backup_all_venues_daily()`
- `public.prune_venue_backups(uuid)`

Each function is owned by `postgres`, is `SECURITY DEFINER`, and has
`search_path=public, pg_catalog`. The broad client grants therefore exposed
privileged maintenance behavior to normal API roles.

## Forward Migration

The migration uses the three verified explicit signatures. For each function it:

1. Revokes `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`.
2. Preserves/grants `EXECUTE` to `service_role`.
3. Adds a catalog comment documenting the P0-03 security contract.

It does not replace or drop a function, change an owner, alter a function
configuration, change a table, or mutate data.

## Rollback Strategy

The rollback is a safety rollback, not a restoration of the vulnerable state.
It retains the restricted ACL and removes only the P0-03 catalog comments.
It explicitly warns that restoring `PUBLIC`, `anon`, or `authenticated`
execution requires separate owner/security approval. A forward corrective
migration remains the required Production incident path.

## Isolated Test Design

The test runner opened one outer transaction and captured:

- row counts for every table in `public`;
- function owner;
- `SECURITY DEFINER` state;
- function configuration and search path;
- `md5(pg_get_functiondef(...))` for each target.

It then applied the actual forward migration, ran catalog assertions, applied
the actual rollback, reapplied the forward migration to prove idempotent
behavior, ran the assertions again, ran the existing Event review and CSV
regression suites, and rolled back the outer transaction.

The maintenance functions were never invoked, so the test could not create or
prune backup data.

The existing Event review test normally uses `SET SESSION AUTHORIZATION
authenticator`, which requires a local superuser login. Credential access was
prohibited. The temporary generated runner used `SET ROLE authenticator`
instead. The local `postgres` test role is already a member of `authenticator`,
`authenticated`, `barback_user`, and `service_role`; all repository test files
were left unchanged, and the effective client roles and JWT claim simulation
were preserved.

## Test Results

| Gate | Result | Evidence |
|---|---:|---|
| Explicit target signatures exist | PASS | 3/3 catalog assertions |
| `anon` cannot execute | PASS | 3/3 `has_function_privilege` assertions |
| `authenticated` cannot execute | PASS | 3/3 `has_function_privilege` assertions |
| `PUBLIC` has no execute ACL | PASS | 3/3 `aclexplode` assertions |
| `service_role` retains execute | PASS | 3/3 privilege assertions |
| Functions remain present | PASS | 3/3 `regprocedure` assertions |
| Function owner unchanged | PASS | 3/3 metadata comparisons |
| `SECURITY DEFINER` preserved | PASS | 3/3 metadata comparisons |
| Explicit search path preserved | PASS | `search_path=public, pg_catalog` |
| Function definitions unchanged | PASS | 3/3 definition hashes |
| Public table rows unchanged | PASS | every `public` table count |
| Rollback parses and preserves safe ACL | PASS | transaction test |
| Forward migration reapplication | PASS | second assertion pass |
| Event review regression | PASS | 50 passed, 0 failed |
| CSV import/export regression | PASS | 27 passed, 0 failed |
| Outer transaction rollback | PASS | database returned to pre-test state |

Focused test log:

- `/tmp/p0_03_focused_test.log`

Full adapted regression log:

- `/tmp/p0_03_regression_adapted.log`

These `/tmp` logs contain no credentials and are not intended for Git.

## Lint Assessment

The Phase 0 read-only Supabase lint baseline completed with exit code `0` and
reported only the known historical `public.backfill_night_bars` ambiguous
`night_id` issue. Its evidence hash is:

`39d473f760e197f797d94864c1102ddcdfaa309caea6cc3ac5dd98bd31357ad5`

The disposable database does not have the optional `plpgsql_check` extension
installed, so Supabase CLI lint was not rerun against it without a database
credential. The P0-03 migration contains no function-body DDL, and the isolated
test proved all three `pg_get_functiondef` hashes are unchanged. It therefore
introduces no new PL/pgSQL lint surface. The known `backfill_night_bars` finding
is unrelated and unchanged.

## File Hashes

- Migration:
  `62e5cd6f37e1e57f1c1636a580d4ec82789582fdcd359a14743b1f7205e63f37`
- Rollback:
  `4e80963029e30cb6556279d19ab07214a356351627465ab6ed1bfedb05ab422f`
- Test:
  `c88d7b190e840f7f0fd2fde71f3731b26956f27cc4d09418a189b52f79e887a5`

## Production Safety

- Production Supabase: untouched
- Linked migration history: untouched
- Production data: untouched
- Edge Functions: not deployed
- Web/iOS applications: untouched
- Git remote: untouched
- Secrets and credential files: not accessed

## Remaining Risk and Next Gate

The migration is ready for owner review. Before any Production application,
perform a fresh Production backup and read-only migration-history/dry-run gate,
then apply only this migration under separate explicit approval. After an
approved Production migration, verify the three exact function ACLs through
read-only catalog evidence. Do not execute the maintenance functions as a smoke
test.
