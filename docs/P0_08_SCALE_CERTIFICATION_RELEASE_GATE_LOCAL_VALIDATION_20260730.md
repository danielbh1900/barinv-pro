# P0-08 Scale Certification Release Gate - Local Validation

Date: 2026-07-30
Branch: `fix/p0-scale-certification-release-gate-v1`
Starting commit: `79acef2c00b8dfe43229e95ba560a49151de4e63`

## Result

**PASS - ready for owner review as a release gate, not as physical scale certification.**

BARINV does not have repository evidence that the Arboleaf/QN-KS/custom scale
path is physically certified, legal-for-trade, or validated across the required
device, load, temperature, tare, negative-weight, transient, and reconnect
matrix. Scale-assisted field filling is now default-off for each page load,
clearly labeled as an uncertified beta estimate, and requires both explicit
operator enablement and per-reading confirmation.

No physical certification was performed by this change. The operator must keep
the gate in beta mode until a separate physical certification program is
completed and approved.

## Root Cause

The Scale Lab provides useful packet captures and decoder tests, but the
available evidence is not a physical certification record:

- `BARINV-Scale-Lab/QNKS_DECODER_ANALYSIS.md` is based on one captured QN-KS
  device/session and four settled reference phases.
- Stable-state semantics remain a hypothesis.
- Negative/tare behavior, unit handling, dynamic transients, drift, and
  temperature behavior are explicitly unresolved.
- The Scale Lab working tree contains ongoing, uncommitted decoder/capture work.
- No legal-for-trade certificate or multi-device physical acceptance report was
  found.

Before this change, a stable direct Web Bluetooth or native BLE reading could
fill TAKEN, PARTIAL, or RETURN inventory fields after one button press. P0-04
correctly excluded remote bridge values, but direct local readings did not
communicate or enforce the separate physical-certification boundary.

## Local Implementation

### Default-off beta gate

`barback.html` now contains a page-scoped certification gate:

- `SCALE_PHYSICAL_CERTIFICATION_COMPLETE` is explicitly `false`.
- Scale connection, all-device discovery, local offset controls, and use buttons
  are disabled until the operator enables beta scale estimates.
- Enablement is held only in memory and is not persisted to `localStorage` or
  `sessionStorage`.
- A refresh returns the scale workflow to disabled.

### Operator warnings and confirmation

The main, RETURN, and partial-bottle scale surfaces state that readings:

- are beta/internal inventory estimates;
- are not certified or legal-for-trade;
- must be verified by the operator.

Every direct scale-to-field action requires confirmation before changing:

- partial bottle Weight (g);
- TAKEN Weight (g);
- RETURN QTY grams.

Rejecting or dismissing confirmation leaves the existing field value unchanged.

### Preserved behavior

- Manual grams inputs remain enabled and outside the scale gate.
- TAKEN partial/weighed bottle handling remains available.
- RETURN grams handling remains available.
- Partial bottle remaining-percentage calculations remain unchanged.
- Direct readings still require the P0-04 trusted local provenance and stable
  reading checks before the P0-08 confirmation is offered.
- The remote Scale Bridge remains disabled/display-only.
- No submission, Event, Supabase, schema, Edge Function, or bottle-movement
  business rule was changed.

## Files Changed

- `barback.html`
- `tests/barback-scale-certification-release-gate.test.cjs`
- `tests/barback-scale-bridge-trust-boundary.test.cjs`
- `docs/P0_08_SCALE_CERTIFICATION_RELEASE_GATE_LOCAL_VALIDATION_20260730.md`

The P0-04 test harness change only models an already confirmed operator so that
its separate provenance assertions continue to test the original trust
boundary.

## Validation

| Check | Result |
|---|---:|
| P0-08 certification-gate tests | PASS, 12/12 |
| P0-04 bridge trust-boundary regression | PASS, 11/11 |
| Focused combined scale tests | PASS, 23/23 |
| Scale Lab target/packet/capture/decoder tests | PASS, 111/111 |
| Complete Barback test suite | 163/164 PASS |
| Inline JavaScript syntax | PASS, 1 script |
| `git diff --check` | PASS |

The one complete-suite failure is pre-existing and unrelated:
`tests/barback-scope-session-security.test.cjs` expects 89 migration files while
the repository currently contains 95. No P0-08 migration was added.

### P0-08 assertions

The focused test proves:

1. All direct scale surfaces expose beta/certification warnings.
2. Physical certification is false and the beta gate is default-off.
3. Gate enablement is page-scoped and not persisted.
4. A disabled gate prevents field mutation.
5. A declined confirmation prevents field mutation.
6. Confirmed direct readings still support partial bottle calculations.
7. Confirmed direct readings still support TAKEN weight.
8. Confirmed native readings still support RETURN grams.
9. Manual grams remain available.
10. Web Bluetooth and native BLE connection entry points are gated.
11. Local scale calibration/offset controls are gated.
12. The P0-04 remote bridge remains disabled/display-only.

## Security and Release Boundary

This change does not claim that local BLE provenance proves scale accuracy.
P0-04 answers whether the reading came from a direct local device path; P0-08
answers whether that reading is physically certified. The latter remains false.

The gate prevents an uncertified reading from silently becoming inventory input,
but operator confirmation is not a substitute for physical certification. For
public release, the owner must choose one of:

1. keep the current default-off beta/operator-estimate gate;
2. disable all scale assistance and use manual grams only; or
3. complete and approve physical certification before changing the certification
   constant or removing warnings.

## Required Physical Certification Work

Before scale readings can be represented as validated/certified evidence:

- define acceptable gram and percentage error thresholds;
- test at least three production-representative devices;
- test empty, known loads, full bottle, partial bottle, overload, zero, negative,
  unstable, tare, reconnect, stale, and 10x-decoding scenarios;
- test temperature and battery variation;
- compare every test against traceable reference weights;
- document firmware/model/version identifiers;
- retain signed results and owner approval;
- determine whether legal-for-trade regulations apply to the intended use.

## Scope Confirmation

- Production Supabase commands: **none**
- Deployment/push/tag commands: **none**
- Database migrations or Edge Functions changed: **no**
- iOS files or iOS repository touched: **no**
- BARINV.ca changed: **no**
- Scale Lab changed: **no** (read-only inspection and tests only)

## Remaining Risk

The decoder and software-stability behavior are still based on incomplete
physical evidence. The safe release position is therefore beta/operator-estimate
or manual-only. P0-08 must not be considered physically certified until the
external test matrix and owner decision are complete.
