# BARINV PRO iOS P0-06 / P0-09 Read-Only Plan

Date: 2026-07-31

Mode: Read-only inspection and planning

Product code changed: No

iOS repository changed: No

## 1. Executive Summary

The current iOS release candidate is not the older `69dca97` checkpoint. The
actual checked-out candidate is the clean tracked branch
`feature/events-bulk-approval-v1` at
`37d4cf5788a4607cea874098aad4611ad360848d`. That commit is present on the
matching remote feature ref, but the local branch has no configured upstream,
no tag points to its HEAD, and its two Events UI commits are newer than the
latest later stable checkpoint at `28e4b0d`.

Both remaining iOS P0 findings are confirmed:

- **P0-06:** the app accepts unsigned backend configuration through multiple
  paths, including `barinv://connect?cfg=...`, scanned QR routes, pasted connect
  codes, manual setup, and an Admin/iOS `?cfg=` boot parameter. Supplied backend
  URL/key values are persisted in `localStorage`. Checking that the key claims
  the `anon` role does not authenticate the source or bind it to the approved
  BARINV Production project.
- **P0-09:** release provenance is incomplete. The candidate is on an untagged
  feature branch, `origin/main` is 150 commits behind it, version/build remain
  `1.0` / `1`, generated Capacitor assets are ignored, and no reproducible App
  Store release checkpoint exists.

P0-09 cannot start safely immediately. The completed non-iOS P0 chain exists
locally in the web repository at `5d3bc2082ebce479f5245120db575a4d8f029c3e`,
but the iOS-bundled Barback assets do not contain its outbox, Scale Bridge, and
scale-certification gates. The app-specific legal/support pages are also local
only and not yet live or owner/legal approved. These are release prerequisites,
not changes to combine into the P0-06 security patch.

## 2. Inspected State

### Web / Barback Repository

- Repository: `/Users/saiedbeikhosseini/Documents/barinv-pro`
- Branch: `fix/p0-scale-certification-release-gate-v1`
- HEAD: `5d3bc2082ebce479f5245120db575a4d8f029c3e`
- Tracked state: clean before this report
- Existing untracked paths: `graphify-out/`, `supabase/.temp/`
- `origin/main`: `875c55e9f50cc9b7fb813bd0842da841d57ad08b`
- Completed non-iOS P0 commits are local and have not yet passed their separate
  Production migration/web/legal deployment gates.

### iOS / Admin Repository

- Repository: `/Users/saiedbeikhosseini/BARINV-PRO-IOS-WORK-GITFIX`
- Actual branch: `feature/events-bulk-approval-v1`
- Actual HEAD: `37d4cf5788a4607cea874098aad4611ad360848d`
- Matching remote ref: `origin/feature/events-bulk-approval-v1` at the same commit
- Configured upstream on current local branch: none
- Tracked working tree: clean
- Existing untracked paths: `graphify-out/`, `supabase/.temp/`
- Tag at HEAD: none
- Latest tagged checkpoint in the current ancestry:
  `ios-setup-bars-revive-staff-assignment-stable-20260726_154056`, peeled to
  `28e4b0d73e38cd976eec78c0ab59c025626a163f`
- Commits after that checkpoint:
  - `1a14389e48a5bd9aed11382aab00aedd002c5109` - clarify bulk Pending review
  - `37d4cf5788a4607cea874098aad4611ad360848d` - move decision bar to top
- Older named checkpoint `69dca97381931c010bfeb4e836a6f43d3b7b9b80`
  is an ancestor, eight commits behind the actual candidate.
- `origin/main`: `12c54e907c35a229be2168d21ff11957eb4c7447`
- `origin/main...HEAD`: zero main-only commits and 150 candidate-only commits.

No branch was switched and no iOS file was modified during this inspection.

## 3. Current iOS Build Configuration

| Setting | Inspected value |
|---|---|
| App name | `BARINV Pro` |
| Bundle identifier | `com.barinv.pro` |
| Capacitor `webDir` | `www` |
| Capacitor remote server | None; bundled local assets are used |
| Marketing version | `1.0` |
| Build number | `1` |
| iOS deployment target | `15.0` |
| Device families | iPhone and iPad (`1,2`) |
| URL scheme | `barinv` |
| Signing style | Automatic, unchanged and not inspected for credentials |

The root and generated Capacitor configuration agree. `AppDelegate.swift`
contains the standard Capacitor URL handoff only; backend selection is
implemented in the bundled JavaScript, not native Swift.

The authoritative and copied Admin assets currently match:

- `www/index.html` SHA-256:
  `7df9a6f84c676d4b641070edc09a6b1c91b83d3757350d041f61abb180ea7e93`
- `ios/App/App/public/index.html` SHA-256: the same value

The Barback and Manager source/copy pairs also match each other. The generated
`ios/App/App/public/` directory is ignored by Git, so a release must record the
copy command and verify source, generated, built, and installed hashes.

## 4. P0-06 - Backend Configuration Hardening

### Confirmed Root Cause

The current `www/index.html` has five mutable backend entry points:

1. Setup wizard manual URL/key fields (`www/index.html:3222-3272`,
   `saveConfig()` at `7117-7163`).
2. Pasted connect code or full `barinv://connect?cfg=` URL
   (`connectWithCode()` at `7205-7279`).
3. Scanned/native connect route (`_routeConnectConfig()` at `14238-14261`).
4. Admin/iOS boot-time `?cfg=` processing (`21190-21213`).
5. Existing persisted `barinv_cfg` loaded from `localStorage` at startup.

`_bsiValidateAnonKey()` rejects service-role and non-anon JWT claims, which is
useful but insufficient. It does not authenticate the configuration issuer,
bind the URL to project `uzommuafouvaerdvirzf`, verify the JWT signature, or
prevent an attacker from supplying an attacker-controlled Supabase project and
its valid anon key. A confirmation dialog is the only trust decision on the
native connect route.

The native listener also logs the full deep-link URL. A configuration URL can
therefore place its supplied key in runtime logs. That logging must be removed
or reduced to non-sensitive route metadata as part of the same patch.

Portal mode contains a guard against `?cfg=` overrides, but normal Admin/iOS
mode does not. Legitimate `barinv://portal`, `barinv://menu`, and Barback session
routes share the same URL scheme and must remain functional.

### Recommended Public-v1 Design

Remove dynamic backend selection from the public iOS build and pin it to the
approved BARINV Production project. This is smaller and safer than designing a
new configuration authority during release hardening.

Implementation sequence:

1. Define the expected Supabase project host/reference as an immutable public
   release constant. Do not package or log privileged credentials.
2. Reject `barinv://connect?cfg=...`, HTTPS `/connect?cfg=...`, QR aliases, and
   encoded variants with a clear operator message.
3. Ignore/reject Admin/iOS boot `?cfg=` before any storage write or Supabase
   client initialization.
4. Remove or disable the pasted connect-code and arbitrary manual backend setup
   controls in the public iOS surface.
5. At startup, accept an existing `barinv_cfg` only when its URL/project matches
   the approved project and its key passes the existing anon-role validation.
   An upgrade must not silently clear app data or Keychain. Invalid legacy
   configuration should fail closed with a recovery message and require a
   separately approved migration/re-authentication path.
6. Redact/remove full deep-link logging.
7. Preserve portal-token, menu, and Barback session routing under the existing
   `barinv` scheme.
8. Generate the public asset with the existing Capacitor copy workflow and
   verify hashes; do not hand-edit generated public output.

### Alternative Requiring Owner Decision

If dynamic multi-backend/enterprise configuration is a real product
requirement, it must be a separate design:

- the QR/deep link carries no raw backend key;
- it carries a short-lived, one-time signed token;
- exchange occurs through a pinned BARINV-controlled endpoint;
- the returned host/project is allowlisted and cryptographically authorized;
- replay, expiry, wrong audience, wrong project, malformed, and oversized
  payloads fail closed;
- only an authenticated administrator can approve a change;
- no configuration is persisted before authorization.

This alternative would require server/API design and its own Production
approval. It should not be improvised inside the iOS asset patch.

### Likely Files for P0-06

Expected source changes:

- `www/index.html`
- `tests/ios-backend-config-hardening.test.cjs` (new focused test)

Generated/verification output, not authoritative source:

- `ios/App/App/public/index.html` through `npx cap copy ios`

No change is currently expected in:

- `ios/App/App/AppDelegate.swift`
- `ios/App/App/Info.plist` (the scheme is still needed for valid routes)
- `capacitor.config.json`
- Supabase schema, migrations, RLS, RPCs, or Edge Functions when the pinned
  public-v1 option is selected

### P0-06 Test Plan

- Raw and encoded `barinv://connect?cfg=` routes are rejected.
- HTTPS `/connect?cfg=` and root `?cfg=` aliases are rejected.
- QR scan and native `appUrlOpen` reach the same rejection.
- No rejected URL/key is written to `localStorage` or logs.
- Wrong host/project and a valid anon key from another project fail closed.
- Existing valid Production configuration starts normally.
- Existing installed valid configuration upgrades without clearing app data.
- Invalid legacy configuration produces a controlled recovery state.
- Portal token, menu, Barback session, barcode, and scanner routes still work.
- Cold launch, authenticated relaunch, offline launch, and session recovery pass.
- JavaScript syntax, focused route tests, Capacitor copy, Xcode build, installed
  asset hash, and device smoke tests pass under later explicit approvals.

### P0-06 Rollback

Do not restore the unsigned configuration path. If the hardened build fails,
issue a forward build that retains the pinned Production trust boundary while
correcting the regression. Preserve the prior app bundle and source backup for
diagnosis only.

## 5. Bundled Asset Comparison and Release Prerequisites

The current iOS bundle is not a direct copy of the completed web source and must
not be replaced wholesale.

| Asset | iOS source SHA-256 | Completed web source SHA-256 | Result |
|---|---|---|---|
| Admin `index.html` | `7df9a6f84c676d4b641070edc09a6b1c91b83d3757350d041f61abb180ea7e93` | `2e1627e1a8be208677c35d031929430fecf1620e7ab4383bf8e1ec0155c6e50e` | Intentionally divergent; iOS contains native/mobile and later bulk UI work |
| `barback.html` | `c6a18cc482bc9c2576a19bbdf18ce5f09f697719a2b900b4e73aef52c1563f7e` | `4a87c1733076dbfcb9f457222c2b9db843f66f5a9ad7a8170fbf0af40de27443` | Stale relative to completed non-iOS P0 chain |
| `barback_manager.html` | `e84e2d5927385cb202feefd4be0d3597b91211a0ba3e18696792e8aff29606b7` | `a89be690688ba680ac8045fc3491da6e486f03b21c89d1b6e7307656970d0787` | Stale/divergent |

The iOS `barback.html` lacks the completed P0-05 outbox blocking warning, P0-04
untrusted bridge display-only gate, and P0-08 uncertified-scale/operator
confirmation markers. A separate selective/manual asset integration and test
phase is required before P0-09. Direct replacement would risk losing
iOS-specific Barback behavior.

Additional release-readiness gaps observed but not changed here:

- No `PrivacyInfo.xcprivacy` file was found.
- `npm test` is a placeholder failure rather than a unified test runner.
- Six referenced local runtime files are absent from `www/`:
  `portal-config.js`, `barinv-build.js`, `barinv-resolver.js`, `qnksTarget.js`,
  `qnksDecoder.js`, and `arboleafScaleService.js`.
- The current Info.plist microphone explanation attributes microphone access to
  barcode scanning and needs App Store/privacy review.
- Full App Store metadata, screenshots, review notes, test-account package, and
  release checklist were not found.

These are P1/App Store prerequisites or related asset-integration work. They
must be resolved or formally scoped before public submission; they should not
be mixed into P0-06.

## 6. P0-09 - Release Governance and Reproducibility

### Confirmed Root Cause

- Current candidate `37d4cf5` is an untagged feature-branch commit.
- Its matching remote feature ref exists, but the local branch has no upstream.
- The latest stable checkpoint in its ancestry is two commits behind.
- `origin/main` is 150 commits behind the candidate.
- Version/build have remained `1.0` / `1` from `69dca97` through the current
  candidate.
- Generated public assets are ignored and therefore not proven by commit alone.
- Legal/support pages are not live and approved.
- Completed non-iOS P0 work has not completed its separate Production release.

### Required Preconditions

P0-09 starts only after all of the following are true:

1. P0-06 has a reviewed, tested, locally committed iOS fix.
2. P0-01, P0-02, and P0-03 have passed approved Production migration gates.
3. P0-04, P0-05, and P0-08 web/Barback changes have passed approved deployment
   and smoke gates.
4. The required non-iOS P0 Barback changes are selectively integrated into the
   bundled iOS assets and regression-tested.
5. P0-07 legal/support wording, owner identity/contact, canonical URLs, and
   BARINV.ca deployment source are approved; the URLs return verified live
   content.
6. A fresh audit reports zero open P0 findings.
7. P1 App Store blockers are either closed or explicitly judged blocking before
   archive work. P0 closure alone does not imply App Store readiness.

### Recommended Governance Sequence

1. Create a fresh all-refs Git bundle, tracked-tree archive, current source and
   generated asset hashes, and installed-build evidence.
2. Owner selects the canonical integration strategy:
   - merge reviewed work to a protected `main`; or
   - create a protected `release/ios-appstore-v1.0.0` branch from the final
     verified candidate and document how it will later reconcile with `main`.
3. Use PR/fast-forward integration only. Do not rewrite history or force-push.
4. Assign an owner-approved marketing version and a build number confirmed not
   to have been used in App Store Connect. Do not guess or reuse build numbers.
5. Run a clean-checkout reproducibility pass and record:
   - exact source commit and dependency lockfile;
   - `www/` hashes before copy;
   - Capacitor command and generated public hashes;
   - Xcode version, project, scheme, configuration, destination, and settings;
   - archive, dSYM, and exported binary hashes when later authorized;
   - legal/support URLs and supported feature scope;
   - full automated/manual test matrix.
6. Create an annotated RC tag only after local and physical-device tests pass.
7. Rehearse through TestFlight only after separate upload approval.
8. Create a stable annotated tag only after TestFlight/App Review smoke gates
   pass. Never move or overwrite published tags.

Given the 150-commit gap, a protected release branch from the final verified
candidate is operationally lower risk for the immediate release, while a
separate reviewed effort reconciles `main`. This remains an owner governance
decision, not an automatic action.

### Likely Files and Release Artifacts for P0-09

Expected tracked source change:

- `ios/App/App.xcodeproj/project.pbxproj` for approved version/build

Expected new release evidence, names finalized during the approved phase:

- release checklist/report
- release manifest and SHA-256 inventory
- build/archive/installed-bundle provenance records
- physical-device and TestFlight test matrix

Prerequisite changes that belong in separate work, not the P0-09 version commit:

- selective `www/barback.html` / `www/barback_manager.html` integration
- generated `ios/App/App/public/` copy and hash evidence
- P0-06 `www/index.html` security patch and focused tests
- privacy manifest, permission wording, and App Store metadata under their
  separately reviewed App Store/P1 scope

### P0-09 Validation

- Branch/commit/tag/version/build all resolve to one documented release source.
- Clean checkout reproduces authoritative and generated asset hashes.
- Source, generated public, built app, and installed app hashes reconcile.
- JavaScript tests, Capacitor copy, `git diff --check`, Xcode build, launch, and
  supported-device layout tests pass.
- Admin login, Events, bulk review, CSV, Barback routes, offline/outbox,
  scanner, staff access, Opening Stock/PAR, POS, Night Control, and gated scale
  behavior pass without Production test-data mutation.
- Privacy/legal/support URLs resolve and match App Store metadata.
- Archive/dSYM/checksum evidence and restore instructions verify.
- No signing change occurs without explicit owner approval.

### P0-09 Rollback

- Never rewrite release history, delete published tags, or decrement/reuse a
  build number.
- Keep the last verified stable binary, Git bundle, archive, dSYM, and manifest.
- Correct release defects with a new forward commit and higher build number.

## 7. Recommended Order

1. Owner decision: remove dynamic backend configuration from public v1
   (recommended) or fund a separately authenticated enterprise design.
2. Approve a local P0-06 branch from the actual candidate `37d4cf5`, not the
   older `69dca97` checkpoint.
3. Implement and validate P0-06 independently.
4. Complete approved non-iOS P0 Production rollout and live legal URL closure.
5. Selectively integrate completed Barback P0 protections into the iOS bundle;
   do not replace the entire asset.
6. Close remaining App Store P1 blockers and run a fresh zero-P0 audit.
7. Owner selects protected main versus protected release-branch governance.
8. Approve unique version/build values and execute the reproducible RC process.
9. Approve TestFlight upload, then stable tagging only after smoke validation.

## 8. Owner Decisions Required

1. Should dynamic iOS backend configuration exist in public v1? Recommended:
   **no; pin the approved BARINV Production project**.
2. If configuration remains, who owns the signed-token issuer, allowlist,
   rotation, expiry, and recovery process?
3. Should the iOS release reconcile into protected `main`, or use a protected
   release branch while main is repaired separately?
4. What marketing version and unused build number are approved?
5. Are the intended App Store URLs exactly:
   - `https://barinv.ca/privacy-policy.html`
   - `https://barinv.ca/app/terms`
   - `https://barinv.ca/support.html`
6. Who approves the legal entity/contact wording and canonical BARINV.ca
   deployment source?
7. Which scale modes are supported in App Store v1, and what operator-facing
   beta/certification language must appear in the iOS Admin surface?
8. Is the stale bundled Barback/Manager asset integration required for the same
   RC? Recommended: **yes**, because the current bundle omits completed P0
   protections.

## 9. Definition of Done

P0-06 is closed when the public iOS build cannot persist or initialize an
attacker-selected backend through any deep link, QR, query, pasted code, manual
setup, or stale configuration path; legitimate routes and upgrade behavior pass
without clearing app data.

P0-09 is closed when every P0 is independently verified closed, legal URLs are
live and approved, the candidate is on an owner-approved protected branch with
a unique version/build, source and generated assets are reproducible, physical
and TestFlight gates pass, and immutable annotated release checkpoints identify
the exact submitted binary.

## 10. Safety Record

- iOS repository modified: **No**
- Web product code modified: **No**
- Branch switch/reset/stash/merge/rebase: **No**
- Build/sign/archive/upload: **No**
- Commit/push/tag/deploy: **No**
- Production Supabase command: **No**
- Secret or credential file accessed: **No**

This document is a plan only. It authorizes no implementation or remote action.
