# P0-01 Event Protected Fields Local Validation

## Executive Summary

P0-01 local implementation and isolated validation passed on 2026-07-30.
The migration closes the broad Event-update contract through three independent
controls:

1. `authenticated` loses table-wide `UPDATE` and retains only column grants for
   `status` and `notes`.
2. `events_update_v` changes from staff-level to manager-level Venue access.
3. A `BEFORE UPDATE OF` trigger rejects actual changes to every protected Event
   field unless the caller has the `service_role` JWT role.

The existing manager status firewall, direct status audit, review RPC, durable
review jobs, CSV import/export, and manager note correction remain compatible.
No existing Event row or other business row was changed by the migration.

No Production Supabase command, linked migration command, deployment, push,
tag, iOS operation, Barback UI change, or BARINV.ca change was performed.

## Scope

- Repository: `/Users/saiedbeikhosseini/Documents/barinv-pro`
- Branch: `fix/p0-event-protected-fields-v1`
- Starting commit: `9b5ce6ed31d3c25167c02edcf11b6a3db73a3971`
- Phase 0 evidence:
  `/Volumes/MiniSSD/BARINV_FULL_BACKUPS/BARINV_P0_PHASE0_FREEZE_20260729_230806`
- Disposable database:
  `barinv_event_review_pgtest_20260727`
- Local database image:
  `public.ecr.aws/supabase/postgres:17.6.1.075`

Only these P0-01 files were created:

- `supabase/migrations/20260730114500_lock_down_event_protected_fields.sql`
- `supabase/rollbacks/20260730114500_lock_down_event_protected_fields_ROLLBACK.sql`
- `supabase/tests/p0_event_protected_fields_local_test.sql`
- `docs/P0_01_EVENT_PROTECTED_FIELDS_LOCAL_VALIDATION_20260730.md`

## Root Cause

The frozen schema showed:

- `authenticated` had table-wide `UPDATE` on `public.events`;
- `events_update_v` allowed any Venue member with role `staff` or higher to
  update a row and its replacement row;
- the existing status firewall ran only for `UPDATE OF status`.

A staff client could therefore rewrite quantity, action, item, Bar, Night,
attribution, source/session, or submission history without passing through the
review RPC or creating a review audit.

## Actual Event Contract

The isolated schema has 18 Event columns.

Protected and immutable for normal clients:

- `id`
- `venue_id`
- `night_id`
- `bar_id`
- `station_id`
- `item_id`
- `staff_id`
- `submitted_by`
- `qty`
- `action`
- `reason_code`
- `qty_basis`
- `client_event_id`
- `source`
- `session_id`
- `created_at`

Existing controlled compatibility:

- `status`: manager-only RLS/column access plus the existing transition
  firewall and exact-once review audit.
- `notes`: manager-only direct correction; it is not inventory-derived and is
  retained to satisfy the established non-status update behavior.

No `from_bar_id`, `to_bar_id`, bottle-state, gross/net/grams/weight, remaining
percentage, approval timestamp, or update timestamp columns exist on the
current `public.events` table. They were therefore not invented in this
migration. Any future inventory-relevant Event column must be added to both the
column ACL contract and protected-field trigger in its introducing migration.

## Forward Migration

The migration:

- creates `public.barinv_events_guard_protected_update()`;
- preserves an explicit `SET search_path = ''`;
- makes the trigger function `SECURITY DEFINER`;
- revokes direct function execution from `PUBLIC`, `anon`, and
  `authenticated`;
- grants trigger-function execution only to `service_role`;
- creates `trg_events_guard_protected_update` over all 16 protected columns;
- revokes table-wide Event `UPDATE` from normal API roles;
- grants `authenticated` only `UPDATE(status, notes)`;
- recreates `events_update_v` as manager-only for both `USING` and
  `WITH CHECK`;
- records P0-01 comments on the function, trigger, and policy;
- notifies PostgREST to reload schema metadata.

It does not replace an existing Event review/CSV function, drop an object,
change a column, or run Event `INSERT`, `UPDATE`, or `DELETE`.

## Authorization Decisions

- Venue staff and scoped staff cannot update existing Event rows.
- `anon` and `barback_user` cannot update existing Event rows.
- An authenticated manager cannot directly rewrite a protected field.
- A manager may still correct `notes`.
- A manager may still transition `status` only under the existing status
  firewall and audit rules.
- Approved status-only review RPC and durable-job paths remain operational.
- `service_role` retains protected-field maintenance access.

The historical `public.backfill_giveaway_actions(uuid)` RPC updates `action`,
`reason_code`, and `qty_basis`. There is no active web/Barback call site. Under
P0-01 it fails closed for authenticated callers because those submitted Event
fields are protected. If that one-time historical backfill is ever needed
again, it requires a separately reviewed service-role maintenance procedure;
this migration does not create a broad manager bypass.

## Rollback Strategy

The rollback is intentionally a safety rollback. Restoring the historical
staff-level policy or table-wide authenticated update grant would reopen P0-01.
The rollback therefore retains:

- manager-only `events_update_v`;
- authenticated `status`/`notes` column grants only;
- the protected-field function and trigger.

It updates catalog comments to state that the safe contract was retained.
Production incidents require a forward corrective migration and explicit owner
approval; this rollback must not be used to broaden access.

## Isolated Test Design

One outer transaction:

1. Captured the full Event row count and deterministic JSON hash.
2. Applied the exact forward migration.
3. Ran catalog, ACL, policy, data-invariant, and runtime role assertions.
4. Applied the exact safety rollback and rechecked the hardened catalog.
5. Reapplied the forward migration and rechecked idempotent final state.
6. Ran the existing Event review suite.
7. Ran the existing CSV import/export suite.
8. Rolled back every fixture, ACL, policy, trigger, function, and row change.

The Event regression normally uses `SET SESSION AUTHORIZATION authenticator`,
which requires a privileged harness login. Credential access was prohibited.
The temporary generated runner used `SET ROLE authenticator`; the local test
role is already a member of all simulated API roles. Repository test files were
not changed.

## Test Results

| Gate | Result |
|---|---:|
| Focused P0-01 runtime assertions | PASS, 15/15 |
| All 16 protected columns exist and lack authenticated update access | PASS |
| Authenticated table-wide Event update removed | PASS |
| Authenticated status/notes compatibility grants present | PASS |
| Manager-only update policy | PASS |
| Guard exists as `SECURITY DEFINER` with safe search path | PASS |
| Guard direct execution denied to normal API roles | PASS |
| `anon` Event update rejected | PASS |
| `barback_user` Event update rejected | PASS |
| Venue staff protected update rejected | PASS |
| Venue staff note update rejected by manager-only RLS | PASS |
| Unauthorized authenticated update rejected | PASS |
| Manager protected update rejected on PENDING Event | PASS |
| Manager protected update rejected on APPROVED Event | PASS |
| Manager protected update rejected on REJECTED Event | PASS |
| Trigger blocks a temporarily restored protected-column grant | PASS |
| Trigger blocks mixed status plus quantity mutation | PASS |
| Manager note correction remains compatible | PASS |
| Manager review RPC changes one Event status | PASS |
| Manager review RPC writes exactly one audit row | PASS |
| `service_role` maintenance access retained | PASS |
| Migration Event count/hash invariant | PASS |
| Safety rollback syntax and hardened behavior | PASS |
| Idempotent forward reapplication | PASS |
| Existing Event review regression | PASS, 50/50 |
| Existing CSV import/export regression | PASS, 27/27 |
| Outer transaction rollback | PASS |

Final disposable-harness fingerprint after rollback:

- Event count: `5469`
- Event hash: `8ad3769f421235b6203585557eab0e50`
- P0-01 function present after rollback: no
- P0-01 trigger count after rollback: `0`
- Original staff-level policy restored by outer rollback: yes
- Original table-wide authenticated update restored by outer rollback: yes

Test log:

- `/tmp/p0_01_isolated_test.log`

The temporary log contains no credentials and is not intended for Git.

## Lint Assessment

The Phase 0 Supabase lint baseline completed with exit code `0` and reported
only the known historical `public.backfill_night_bars` ambiguous `night_id`
issue.

The disposable database does not have the optional `plpgsql_check` extension
installed, and no database credential was read to run Supabase CLI lint against
the harness. The new trigger function compiled in PostgreSQL and both its deny
and service-role allow paths executed successfully. The migration does not
replace any existing PL/pgSQL body. No new compile/runtime issue was found; the
known `backfill_night_bars` finding remains unrelated and unchanged.

## File Hashes

- Migration:
  `3ab511e9f15a512689e55805b9db1d2da225e4a572755c877c301dd7366ae668`
- Rollback:
  `142578238ad0e306e66e4fd44943d8d9a70da2f492e91fac127665bc0b7cff41`
- Test:
  `abaaea4982c653023f576e1378830437c82444e6b133ade9ce4cca37f970d876`

## Production Safety

- Production Supabase: untouched
- Linked migration history: untouched
- Production Events: untouched
- Edge Functions: not deployed
- Web/iOS applications: untouched
- Git remote: untouched
- Secrets and credential files: not accessed

## Remaining Risk and Next Gate

P0-01 is ready for owner review. Before any Production migration:

1. Create a fresh Production database backup and protected-Event hash.
2. Verify remote migration history and a dry run containing only the approved
   pending P0 migration(s).
3. Decide whether the inactive historical giveaway backfill RPC should be
   separately revoked or retained as a service-role-only maintenance tool.
4. Apply only after explicit Production approval.
5. Verify Event count/hash, ACLs, policy, trigger, status review, and audit
   behavior read-only after deployment.
