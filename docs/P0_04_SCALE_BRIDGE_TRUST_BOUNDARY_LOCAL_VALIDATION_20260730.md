# P0-04 Scale Bridge Trust Boundary - Local Validation

Date: 2026-07-30
Repository: `/Users/saiedbeikhosseini/Documents/barinv-pro`
Branch: `fix/p0-scale-bridge-trust-boundary-v1`
Starting commit: `52d9388d6553759eb079b3bdcb2f44a3234d4986`

## Result

**PASS - ready for owner review.**

The Barback Realtime Scale Bridge is disabled for public release. Remote
Realtime and HTTP bridge readings are retained only as explicitly untrusted,
display-only diagnostics and cannot become inventory weight. Direct local Web
Bluetooth, direct native BLE, and manual gram entry remain available.

No Production command, Supabase command, migration, Edge Function deployment,
Git push, tag, iOS change, or BARINV.ca change was performed.

## Root Cause

The Scale Bridge subscribed to a venue/night-scoped public Realtime broadcast
and accepted client-supplied `grams` and `stable` values. The shared receiver
then assigned those values directly to `bleScale.latest`. Existing Use buttons
copied `bleScale.latest.grams` into:

- TAKEN/PARTIAL `Weight (g)`
- RETURN `QTY`
- the partial-bottle scan modal

The authenticated HTTP polling fallback had the same trust issue because it
returned weight originally published by a client. The canonical deployed
`barback-scale-bridge` Edge Function source is not present in this repository,
so this local phase cannot establish or audit an end-to-end authenticated device
trust chain.

## Implementation

Changed `barback.html` only:

1. Set `SCALE_BRIDGE_RELEASE_ENABLED = false`.
2. Disabled bridge listen, publish, and use controls in initial HTML and runtime
   initialization.
3. Added a visible operator warning that remote bridge readings are untrusted
   and cannot fill inventory weight.
4. Added release guards to every bridge network entry point:
   library load, client creation, Realtime subscribe, HTTP publish/poll, listen,
   station start, heartbeat, and frame publish.
5. Changed `_bridgeApplyWeight` to update only `bridge.latest` with
   `trusted: false`; it never writes `bleScale.latest`.
6. Changed `_bridgeShowNoWeight` so bridge state can no longer clear a trusted
   direct local reading.
7. Marked decoded direct Web Bluetooth/native BLE readings with
   `trusted: true` and an allowlisted local source.
8. Added trusted-local and stable-reading checks to every scale field-fill
   helper.
9. Kept manual gram entry and bottle movement business rules unchanged.

## Security Properties

| Property | Result |
|---|---|
| Public Realtime payload can become saved/submitted weight | Blocked |
| HTTP bridge payload can become saved/submitted weight | Blocked |
| Remote payload can overwrite direct BLE/native BLE state | Blocked |
| Remote no-weight/stale response can clear local trusted state | Blocked |
| Bridge network subscribe/publish/poll starts in release build | Blocked |
| Bridge Use button fills an inventory field | Blocked |
| Direct Web Bluetooth trusted reading remains usable | Preserved |
| Direct native BLE trusted reading remains usable | Preserved |
| Manual gram entry remains usable | Preserved |
| TAKEN/PARTIAL and RETURN business rules | Unchanged |

The release gate is defense in depth, not the only control. Even if the gate
were changed at runtime, receiver code still marks remote data untrusted,
does not assign it to authoritative scale state, and `_bridgeUse` refuses to
fill inventory inputs.

## Local Tests

### Focused P0-04 suite

Command:

```sh
node --test tests/barback-scale-bridge-trust-boundary.test.cjs
```

Result: **PASS - 11 passed, 0 failed**

Coverage:

1. Release gate and disabled operator controls.
2. Guards on every bridge network entry point.
3. Realtime/HTTP payload remains untrusted and display-only.
4. Untrusted values cannot fill TAKEN, RETURN, or PARTIAL inputs.
5. Trusted direct Web Bluetooth fills PARTIAL and TAKEN weight.
6. Trusted direct native BLE fills RETURN grams.
7. Unstable and spoofed-source readings fail closed.
8. Bridge stale/no-weight state does not clear local trusted state.
9. Only direct frame decode assigns trusted authoritative state.
10. Manual inputs remain available and bridge code performs no Event submission.
11. Partial-bottle remaining-percent calculation still handles valid grams.

### Relevant Barback regressions

Command:

```sh
node --test \
  tests/barback-bartender-labels.test.cjs \
  tests/barback-item-thumbnails.test.cjs \
  tests/barback-manager-venue-selector.test.cjs \
  tests/barback-opening-par-session.test.cjs \
  tests/barback-opening-par.test.cjs \
  tests/barback-outbox-durability.test.cjs \
  tests/barback-scale-bridge-trust-boundary.test.cjs \
  tests/barback-staff-isolation.test.cjs
```

Result: **PASS - 117 passed, 0 failed**

### Complete Barback test discovery

Command:

```sh
node --test tests/barback-*.test.cjs
```

Result: **150 passed, 1 failed**

The one failure is pre-existing and unrelated:
`tests/barback-scope-session-security.test.cjs` expects exactly 89 migration
files, while the repository currently contains 95. The test fails before
examining P0-04 behavior. It was not modified because it is outside this scope.

### Syntax and diff checks

- `barback.html` inline JavaScript compile: **PASS**
- `git diff --check`: **PASS**

## Files

- `barback.html`
- `tests/barback-scale-bridge-trust-boundary.test.cjs`
- `docs/P0_04_SCALE_BRIDGE_TRUST_BOUNDARY_LOCAL_VALIDATION_20260730.md`

No database migration, Supabase Function, iOS file, native file, or website file
was changed.

## Remaining Limitations

1. Remote Scale Bridge operation is intentionally unavailable for public
   release. iPhone Safari/Chrome users without direct Bluetooth must enter grams
   manually.
2. Restoring remote bridge operation requires a separately reviewed,
   authenticated device trust design and recoverable canonical server source.
3. P0-08 physical scale decoding/calibration certification remains separate and
   unresolved. This change establishes provenance boundaries; it does not
   certify Arboleaf physical accuracy.
4. No physical BLE hardware test was performed in this local phase. Direct BLE
   behavior is covered by source-level/browserless tests and still requires
   hardware QA before release.

## Rollback

No database rollback is needed. A source rollback would revert only the P0-04
commit after owner approval. Re-enabling the prior remote bridge behavior would
restore the P0 trust failure and is not a release-safe rollback.

## Owner Review Gate

Approve one local commit containing exactly the three files listed above. Do
not deploy this change until operator messaging and direct BLE/manual fallback
behavior have also passed device-level QA.
