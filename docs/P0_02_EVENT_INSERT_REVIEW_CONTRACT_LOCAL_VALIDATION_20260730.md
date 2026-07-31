# P0-02 Event Insert Review Contract Local Validation

## Executive Summary

P0-02 local implementation and isolated validation passed on 2026-07-30.
The migration prevents normal authenticated/scoped staff clients from creating
final-status Events or pre-filling server/Barback source and session context.

The new guard executes before the existing Barback session auto-approval
trigger. Barback input is first normalized to `PENDING`; only the established
server-authoritative session trigger may subsequently produce `APPROVED`.

The established non-scoped manager operational `APPROVED` compatibility path is
retained for `NULL` and `admin_adjustment` source values. Managers cannot insert
`REJECTED`; that decision must use the existing review workflow. This explicit
exception preserves active Admin operations and the existing regression suite
while closing the P0 finding for non-privileged staff/client roles.

No existing Event row or other business row was changed by the migration. No
Production Supabase command, linked migration command, deployment, push, tag,
iOS operation, Barback UI change, or BARINV.ca change was performed.

## Scope

- Repository: `/Users/saiedbeikhosseini/Documents/barinv-pro`
- Branch: `fix/p0-event-insert-review-contract-v1`
- Starting commit: `ece4b721c6c283408ffd923778ab10f24ca985a3`
- Previous P0-03 commit:
  `9b5ce6ed31d3c25167c02edcf11b6a3db73a3971`
- Phase 0 evidence:
  `/Volumes/MiniSSD/BARINV_FULL_BACKUPS/BARINV_P0_PHASE0_FREEZE_20260729_230806`
- Disposable database:
  `barinv_event_review_pgtest_20260727`
- Local database image:
  `public.ecr.aws/supabase/postgres:17.6.1.075`

Only these P0-02 files were created:

- `supabase/migrations/20260730123000_enforce_event_pending_insert_contract.sql`
- `supabase/rollbacks/20260730123000_enforce_event_pending_insert_contract_ROLLBACK.sql`
- `supabase/tests/p0_event_insert_review_contract_local_test.sql`
- `docs/P0_02_EVENT_INSERT_REVIEW_CONTRACT_LOCAL_VALIDATION_20260730.md`

## Root Cause

The existing insert policies enforce Venue/Night/Bar and giveaway-action scope,
but do not require normal staff submissions to begin `PENDING`. An
authenticated or scoped staff client could therefore supply `APPROVED`,
`REJECTED`, or another status and bypass the transition firewall and review
audit.

The existing Barback session trigger already normalizes signed Barback Events,
but it covers only Barback source/session combinations. It does not close the
general authenticated staff insert path.

## Actual Event Insert Contract

The canonical statuses present in the isolated schema/data are:

- `PENDING`
- `APPROVED`
- `REJECTED`

The current `events` table has no:

- `approved_by` or `approved_at`
- `reviewed_by` or `reviewed_at`
- `rejected_by` or `rejected_at`
- `review_job_id` or `review_session_id`

`reason_code` is an operational Event reason, not a review decision field.
`session_id` identifies a Barback session and is therefore rejected on normal
staff inserts but retained for the `barback_user` contract.

## Forward Migration

The migration creates:

- `public.barinv_events_enforce_pending_insert_contract()`
- `trg_events_00_enforce_pending_insert`

The `00` trigger name is intentional. PostgreSQL orders triggers with the same
timing/event alphabetically, so this guard runs before
`trg_events_session_auto_approve`.

The function is `SECURITY DEFINER` with `SET search_path = ''`. Direct execution
is revoked from `PUBLIC`, `anon`, `authenticated`, and `barback_user`;
`service_role` retains execution.

The contract is:

1. `service_role` and direct database maintenance without a JWT retain
   controlled server access.
2. `barback_user` input is always normalized to `PENDING`.
3. Barback source supplied by another role is normalized to `PENDING`, then the
   existing session trigger fails closed because the role is not
   `barback_user`.
4. Non-scoped managers may insert `PENDING`.
5. Non-scoped managers may insert operational `APPROVED` only with `NULL` or
   `admin_adjustment` source.
6. Managers cannot insert `REJECTED`.
7. All other clients must insert exactly `PENDING`, with `source` and
   `session_id` both null.

The migration also tightens both authenticated insert policies:

- `events_insert_v`
- `events_staff_insert`

Normal/scoped staff policy checks now require `PENDING`, null `source`, and null
`session_id`. Existing Venue/Night/Bar and giveaway-action restrictions remain
in place and are not loosened.

The migration does not replace an existing review/CSV function, drop an object,
change a column, or execute Event `INSERT`, `UPDATE`, or `DELETE`.

## Preserved Trusted Paths

- Safe authenticated staff `PENDING` insert
- Existing manager operational `APPROVED` insert
- Existing manager status review RPC
- Durable review jobs
- CSV import, which inserts `PENDING` as `admin_csv_import`
- CSV export
- Barback auto-approval from a valid active opted-in session
- `service_role` controlled final-status maintenance

The manager operational exception is intentionally narrow but still creates an
`APPROVED` Event without a transition audit. The release-readiness audit already
tracks centralizing these Admin operational inserts behind audited server RPCs
as separate follow-up work. P0-02 closes the non-privileged client bypass
without silently disabling current warehouse/dispatch workflows.

## Rollback Strategy

The rollback is intentionally a safety rollback. Restoring the previous staff
insert policies would reopen P0-02. It therefore retains:

- the first insert guard;
- the tightened normal authenticated policy;
- the tightened scoped-staff policy;
- all status/source/session restrictions.

It updates catalog comments to state that enforcement was retained. Any
Production incident requires a forward corrective migration and explicit
owner/security approval; this rollback must not broaden client insert access.

## Isolated Test Design

One outer transaction:

1. Captured the full Event row count and deterministic JSON hash.
2. Applied the committed P0-03 migration.
3. Applied the committed P0-01 migration.
4. Applied the exact P0-02 migration.
5. Ran catalog, policy, trigger-order, data-invariant, and role assertions.
6. Applied the exact P0-02 safety rollback and rechecked the hardened catalog.
7. Reapplied P0-02 and checked idempotent state.
8. Ran the existing Event review suite.
9. Ran the existing CSV import/export suite.
10. Rolled back every fixture, grant, policy, trigger, function, and row change.

The Event regression normally uses `SET SESSION AUTHORIZATION authenticator`,
which requires a privileged harness login. Credential access was prohibited.
The temporary runner used `SET ROLE authenticator`; the local test role is
already a member of all simulated API roles. Repository regression files were
not changed.

## Test Results

| Gate | Result |
|---|---:|
| Focused P0-02 runtime assertions | PASS, 14/14 |
| Canonical trigger function exists | PASS |
| `SECURITY DEFINER` and safe search path | PASS |
| Client roles cannot execute trigger function directly | PASS |
| P0-02 trigger runs before session auto-approval | PASS |
| Tightened normal staff policy | PASS |
| Tightened scoped staff policy | PASS |
| No unhandled approval/review columns | PASS |
| anon `APPROVED` insert rejected | PASS |
| anon `REJECTED` insert rejected | PASS |
| anon unknown-final insert rejected | PASS |
| authenticated staff `APPROVED` insert rejected | PASS |
| authenticated staff `REJECTED` insert rejected | PASS |
| authenticated staff unknown-final insert rejected | PASS |
| staff server-source prefill rejected | PASS |
| staff Barback-session prefill rejected | PASS |
| staff safe `PENDING` insert succeeds | PASS |
| manager operational `APPROVED` insert preserved | PASS |
| manager direct `REJECTED` insert rejected | PASS |
| `service_role` final-status insert preserved | PASS |
| client-supplied Barback final status normalized | PASS |
| valid server session auto-approval preserved | PASS |
| session auto-approval creates one audit row | PASS |
| Migration Event count/hash invariant | PASS |
| Safety rollback syntax and hardened behavior | PASS |
| Idempotent forward reapplication | PASS |
| Existing Event review regression | PASS, 50/50 |
| Existing CSV import/export regression | PASS, 27/27 |
| Outer transaction rollback | PASS |

Final disposable-harness fingerprint after rollback:

- Event count: `5469`
- Event hash: `8ad3769f421235b6203585557eab0e50`
- P0-02 function present after rollback: no
- P0-02 trigger count after rollback: `0`
- Original insert policies restored by outer rollback: yes

Test log:

- `/tmp/p0_02_isolated_test.log`

The temporary log contains no credentials and is not intended for Git.

## Lint Assessment

The Phase 0 Supabase lint baseline completed with exit code `0` and reported
only the known historical `public.backfill_night_bars` ambiguous `night_id`
issue. The evidence hash is:

`39d473f760e197f797d94864c1102ddcdfaa309caea6cc3ac5dd98bd31357ad5`

The disposable database does not have the optional `plpgsql_check` extension,
and no database credential was read to run Supabase CLI lint against the
harness. The new function compiled in PostgreSQL, and its staff deny, manager
allow/deny, Barback normalization, service-role allow, and trigger-order paths
all executed successfully. No existing PL/pgSQL body was replaced. No new
compile/runtime issue was found; the historical lint finding is unchanged.

## File Hashes

- Migration:
  `00a15860947902d6c44fb2ad59da590837192b3ed4d0f1dbe98bd9c12dab9d78`
- Rollback:
  `a15370fc89c6bebff40a938bced07222b192f29cd731673eadf3fc8f3c8feae7`
- Test:
  `86551d8829c893caf6cd2d7b7ee05adc19393714dcf4cf43444ef2de38c72682`

## Production Safety

- Production Supabase: untouched
- Linked migration history: untouched
- Production Events: untouched
- Edge Functions: not deployed
- Web/iOS applications: untouched
- Git remote: untouched
- Secrets and credential files: not accessed

## Remaining Risk and Next Gate

P0-02 is ready for owner review. Before any Production migration:

1. Create a fresh Production database backup and protected Event hash.
2. Verify remote migration history and a dry run containing only approved P0
   migrations.
3. Confirm the temporary manager operational `APPROVED` exception remains
   acceptable until those Admin actions move behind audited server RPCs.
4. Apply only after explicit Production approval.
5. Verify Event count/hash, trigger order, insert policies, Barback
   auto-approval, and review/CSV behavior after deployment.
