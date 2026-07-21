# Barback Opening PAR checklist persistence decision — V1

Status: design checkpoint only. No migration was authored or executed because the repository migration baseline is incomplete.

## Decision

The Received checklist requires a new session-scoped table. Existing storage does not safely satisfy the contract:

- `events` is an append-only TAKEN/RETURN stream and has no unique `(session, destination, item)` state.
- the browser Review drafts and outbox are device-local, editable Classic transaction queues and cannot reconstruct authoritative state across devices;
- `opening_runs` / `opening_run_items` are profile/run based, not session based, and do not store independent item confirmation identity and time per session and destination.

Those stores must remain unchanged so Opening PAR never enters the Classic Review queue.

## Proposed table

`public.barback_opening_par_receipts`

| Column | Type | Contract |
| --- | --- | --- |
| `session_id` | `uuid` | FK to `barback_sessions(id)`, required |
| `destination_id` | `uuid` | FK to `bars(id)`, required |
| `item_id` | `uuid` | FK to `items(id)`, required |
| `status` | `text` | required, check `status = 'received'` |
| `confirmed_at` | `timestamptz` | required, server timestamp |
| `confirmed_by` | `uuid` | FK to `staff(id)`, required |

Primary key: `(session_id, destination_id, item_id)`.

The primary key is the idempotency and retry boundary. A repeated confirmation returns the existing row without changing `confirmed_at` or `confirmed_by`.

Recommended supporting index: `(confirmed_by, confirmed_at desc)` for audit support. The primary key already supports session reconstruction.

Foreign-key deletion behavior should preserve audit history: use `ON DELETE RESTRICT` for session, destination, item, and staff references. Historical sessions and closed nights must not cascade-delete checklist state.

## Security model

- Enable RLS.
- Grant no direct browser `SELECT`, `INSERT`, `UPDATE`, or `DELETE` policy to `anon`, `authenticated`, or `barback_user`.
- Use only the server-mediated `barback-opening-par-checklist` Edge Function with the service role.
- The function verifies the signed Barback JWT and derives `session_id`, venue, night, and staff from its claims.
- Every request rechecks session existence, revocation, expiration, allowed staff, active night, active night destination, and positive item membership in `opening_par_config`.
- The client cannot submit a target quantity or a different session ID.
- There is no update/delete/unconfirm or Confirm All operation in V1.

Manager history, if later required, should also use a manager-authenticated Edge Function rather than a broad table RLS policy.

## API path

`barback-opening-par-checklist` accepts two actions:

- `list`: returns only destination ID, item ID, status, confirmation time, and confirming staff ID for the JWT session;
- `confirm`: accepts only destination ID and item ID, inserts one receipt, and reconstructs the existing receipt on unique-key retry.

No PIN, token, link, QR payload, JWT, target override, or credential field is returned.

When it is eventually deployed, gateway JWT verification must remain disabled for this function because it accepts the separately signed Barback session JWT and performs its own issuer, role, subject, expiry, session, staff, venue, night, destination, and item checks. This is not permission to deploy it in the current checkpoint.

## Rollback

Before rollout, keep `OPENING_PAR_V1_ENABLED = false`. If a future rollout must be reversed:

1. turn the Barback gate off;
2. undeploy or disable the checklist function;
3. retain/export receipt rows for audit;
4. remove policies/grants and drop the table only in a separately reviewed migration after migration-baseline recovery.

Migration-baseline recovery is required before any schema implementation of this design.

## Recorded out-of-scope production defects

- `public.v_barback_diagnostics` is missing, so the Diagnostics tab remains a separate telemetry defect.
- `public.barback_mark_pilot` is missing, so Pilot marking remains a separate defect. The Manager continues to distinguish “session created” from a failed Pilot mark and does not report full Pilot success.

Neither dependency is required by the Opening PAR snapshot, secure Manager session list/revoke functions, or the gated checklist source. This checkpoint does not repair, migrate, or deploy either defect.
