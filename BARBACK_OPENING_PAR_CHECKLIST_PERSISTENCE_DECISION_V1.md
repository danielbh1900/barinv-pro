# Barback Opening PAR Checklist persistence decision — V1

Status: approved local implementation checkpoint. The verified 86-file baseline was restored and migration `20260722063733_barback_opening_par_checklist_persistence.sql` was authored. It has not been executed or deployed.

## Workflow decision

When both the compile gate and venue runtime flag are enabled, PIN login performs an authoritative staff-specific status check before normal operations:

1. no applicable Opening PAR configuration or runtime gate off → Classic TAKEN / RETURN;
2. completed `(session_id, staff_id)` → Classic TAKEN / RETURN;
3. incomplete → dedicated, non-dismissible Opening PAR Checklist;
4. unavailable or inconsistent status → fail closed on the checklist screen.

The checklist never writes to Classic Review, Drafts, Outbox, or `events`.

## Receipt persistence

`public.barback_opening_par_receipts` stores immutable actual counts:

| Column | Contract |
| --- | --- |
| `session_id` | required FK, `ON DELETE RESTRICT` |
| `destination_id` | required `bars` FK, `ON DELETE RESTRICT` |
| `staff_id` | required staff FK, `ON DELETE RESTRICT` |
| `item_id` | required item FK, `ON DELETE RESTRICT` |
| `expected_quantity` | positive integer copied from the immutable session snapshot |
| `received_quantity` | staff-entered whole integer greater than or equal to zero |
| `confirmed_at` | immutable server timestamp |

Primary key: `(session_id, destination_id, staff_id, item_id)`.

An exact retry returns the existing row without changing its quantity, identity, or timestamp. A retry with a different received quantity is rejected.

## Completion persistence

`public.barback_opening_par_completions` records exactly one completion per `(session_id, staff_id)` with `completed_by`, `completed_at`, and the confirmed row count. Completion does not require actual quantity to equal Expected PAR.

The service-only `public.barback_confirm_opening_par(...)` RPC:

- revalidates venue, active session/night/staff/destination/item, assignment scope, and session snapshot;
- derives Expected PAR from `opening_par_config` and never accepts it from the browser;
- serializes concurrent confirmations per staff/session with a transaction advisory lock;
- inserts with `ON CONFLICT DO NOTHING`;
- calculates staff-specific required, confirmed, and remaining counts;
- creates the final receipt and completion in the same transaction;
- appends `opening_par_received` and `opening_par_completed` audit entries;
- returns only safe receipt, variance, progress, and completion data.

## Quantity and variance

Expected PAR is read-only. Received quantity can be zero, below, equal to, or above Expected PAR and has no application-defined cap. Reporting classifies each receipt as:

- `MATCH`: received equals expected;
- `SHORT n`: received is below expected;
- `OVER n`: received is above expected.

Manager session reporting returns aggregate match/short/over counts plus safe shortage/overage rows. It never returns PINs, tokens, URLs, QR data, or credentials.

## Security and rollout

- Both tables have RLS enabled and no browser policies.
- All table privileges are revoked from `PUBLIC`, `anon`, `authenticated`, and `barback_user`.
- The confirmation RPC is executable only by `service_role`.
- The Edge Function derives session and staff identity from the signed Barback JWT and lists receipts only for that staff.
- A later approved deployment must publish `barback-opening-par-checklist` with gateway JWT verification disabled, matching the existing Barback functions; the function itself verifies the custom signed Barback JWT before using the service client.
- `venues.barback_opening_par_enabled` is the authoritative venue-scoped runtime flag. The additive column defaults to false, and a missing venue fails safely to false.
- The existing `events_barback_insert` policy is unchanged.
- A separate `AS RESTRICTIVE` insert policy calls a hardened security-definer helper. It is a no-op when the runtime gate is off, permits sessions without Opening PAR, and denies applicable incomplete staff checklists.
- `OPENING_PAR_V1_ENABLED` remains `false` until a separate rollout approval.

## Indexes

The composite primary keys cover session reconstruction. Additional indexes start with each otherwise-uncovered foreign-key column: receipt staff, destination, and item; completion staff and completed-by.

## Forward-only rollback

1. Set/keep the runtime flag false; Classic behavior is immediately restored.
2. Revert the Barback and Edge Function build to the previous gated version.
3. In a separately reviewed migration, drop only `events_opening_par_completion_gate` and revoke helper/RPC execution.
4. Retain receipt/completion rows for audit. Export and separate destructive approval are required before any table drop.

Rollout order is separately approved and forward-only: execute the persistence migration, deploy the new checklist and reporting functions, verify the runtime flag remains false, publish the gated UI, and only then consider a venue-specific flag activation. None of those production steps occurred in this checkpoint.

## Unrelated production defects

`public.v_barback_diagnostics` and `public.barback_mark_pilot` remain separate defects. This work does not repair, migrate, or deploy either one.
