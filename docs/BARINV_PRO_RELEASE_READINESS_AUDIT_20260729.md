# BARINV PRO Release-Readiness Audit

Date: 2026-07-29
Mode: Read-only audit; no product fixes, remote mutations, deployments, commits, tags, installs, signing changes, or secret inspection
Production Supabase project reference verified: `uzommuafouvaerdvirzf`

## 1. Executive Summary

BARINV PRO is **not ready for a public App Store release today**.

The recent Event review and CSV work is substantial and well tested in isolation:

- Event review validation: 50 passed, 0 failed.
- CSV validation: 27 passed, 0 failed.
- Review helper validation: 9 passed, 0 failed.
- Native scale-related JavaScript suites run during this audit: 104 passed, 0 failed.
- Production migration history is aligned through `20260728090000`.
- All 94 inspected public tables have RLS enabled.
- The new review and CSV RPCs have explicit authorization, safe `search_path`, idempotency, Venue/Night scope, and durable processing.

Those results do not close several older, system-wide release blockers. The audit found **49 findings: 9 P0, 24 P1, 12 P2, and 4 P3**. The highest-risk issues are:

1. Authenticated staff can mutate non-status fields of existing Events, including inventory-relevant values.
2. Authenticated/scoped staff can insert Events with a final status and bypass review/audit.
3. Anonymous users can execute three backup/prune `SECURITY DEFINER` functions.
4. The realtime Scale Bridge accepts untrusted client-supplied weight broadcasts.
5. Barback outbox quota recovery can silently discard queued submissions.
6. An unsigned deep-link configuration can redirect the iOS app to an arbitrary backend.
7. No live app-specific privacy policy, terms, and support URL are ready for App Review.
8. The Arboleaf weight decoder and calibration assumptions are not backed by sufficient physical certification.
9. The current iOS release candidate exists only on a feature branch, is untagged, remains version/build `1.0/1`, and is far ahead of `origin/main`.

Recommended release posture: fix and retest all P0 findings, complete the P1 App Store and operational gates, then cut a new iOS release candidate from a documented source-of-truth branch. Keep the ESP32 custom scale outside public v1 unless it is explicitly offered as a restricted beta accessory.

## 2. Current Release State

### Web / Barback repository

- Repository: `/Users/saiedbeikhosseini/Documents/barinv-pro`
- Current branch: `feature/events-csv-import-export-v1`
- HEAD: `875c55e9f50cc9b7fb813bd0842da841d57ad08b`
- Tag at HEAD: `barinv-events-csv-import-export-stable-20260728`
- `origin/main`: `875c55e9f50cc9b7fb813bd0842da841d57ad08b`
- Remote feature branch: same commit
- Local `main`: `7c43a4ee5c62dc244409b8c1a655bd27b0713472`, two commits behind
- Tracked working tree: clean
- Expected untracked local-only directories: `graphify-out/`, `supabase/.temp/`
- GitHub Pages: public repository `danielbh1900/barinv-pro`, source `main` at repository root
- Live `index.html`, `barback.html`, and `barback_manager.html` hashes match the audited web source

### iOS / Admin repository

- Repository: `/Users/saiedbeikhosseini/BARINV-PRO-IOS-WORK-GITFIX`
- Current branch: `feature/events-bulk-approval-v1`
- HEAD: `37d4cf5788a4607cea874098aad4611ad360848d`
- Remote feature branch: same commit
- Tag at HEAD: none
- `origin/main`: `12c54e9` from 2026-04-17 and substantially behind the release candidate
- Tracked working tree: clean
- Expected untracked local-only directories: `graphify-out/`, `supabase/.temp/`
- Authoritative and generated web assets match: `www/index.html` and `ios/App/App/public/index.html` SHA256 `7df9a6f...`
- Candidate status: pushed feature branch, not merged, not tagged, and not an App Store release

### Deployed database and functions

- Linked project reference: exactly `uzommuafouvaerdvirzf`
- Local and remote migration versions align through `20260728090000`
- No pending or remote-only migration was found
- Twenty deployed Edge Functions were listed
- The two recent Event/session functions are deployed, but the repository does not contain canonical source for many other deployed functions
- Remote database lint reports one existing error in `public.backfill_night_bars`: ambiguous `night_id`

## 3. App Store Readiness Status

**Status: BROKEN / NOT READY**

Required blockers before submission:

- Close all P0 security and data-integrity findings.
- Publish app-specific privacy policy, terms, and support pages at stable public URLs.
- Add and validate the privacy manifest and permission declarations.
- Resolve the arbitrary backend deep-link configuration.
- Remove or package missing startup scripts and reduce remote CDN runtime dependencies.
- Certify scale behavior with physical hardware or remove unsupported scale claims from v1.
- Create a controlled release branch/tag and increment version/build.
- Complete physical iPhone/iPad, offline, scanner, Bluetooth, and authenticated production-safe smoke tests.
- Prepare App Store metadata, screenshots, review notes, and a test account.

The audit did not archive, sign, upload, or access App Store Connect.

## 4. Feature Completion Matrix

| # | Section | Status | Evidence and missing work | Manual test | Priority |
|---|---|---|---|---|---|
| 1 | Authentication / Admin login | MOSTLY DONE | Supabase auth and role checks exist; backend redirect deep link remains unsafe | Login, expiry, password reset, revoked account | P0 |
| 2 | Staff Access / PIN codes | MOSTLY DONE | PBKDF2, lockout, and IP rate limiting exist; legacy unsigned token compatibility remains | Lockout, stale token, device handoff | P1 |
| 3 | Staff-to-bar assignment | DONE | Scope tests pass and server checks exist | Multi-bar and reassignment event-night test | P2 |
| 4 | Barback Link login | MOSTLY DONE | Production web uses phase3 auth; iOS bundle contains stale auto/test fallback | Android/iPhone login and revoked session | P1 |
| 5 | Barback Manager | MOSTLY DONE | Session create/list works; existing-session auto-approve edit is absent | Create/revoke/rotate/expiry UX | P1 |
| 6 | Session creation | DONE | Scoped session path and manager checks exist | Full manager-to-Barback handoff | P2 |
| 7 | `auto_approve_events` | MOSTLY DONE | Server-authoritative insert trigger and audit tests pass; no edit path after creation | Live-like isolated session toggle | P1 |
| 8 | Events Log | MOSTLY DONE | Review/CSV features exist; web list stops at newest 200 rows | Large filtered log and responsive layout | P1 |
| 9 | Bulk Pending approval | MOSTLY DONE | Secure direct/job paths pass; iOS candidate is not released | Authenticated iPad workflow | P0 |
| 10 | Final Status / Keep Existing Action | MOSTLY DONE | Default status-only flow is correct; action correction is intentionally blocked | TAKEN/RETURNED mixed selection | P2 |
| 11 | CSV Import | MOSTLY DONE | Durable import and validation pass; action whitelist differs from operational actions | 0, 1, 500, 1500, and 5000-row UI | P1 |
| 12 | CSV Export | DONE | Selected/page/all-matching and formula protection implemented | Excel round trip and 0-row UX | P2 |
| 13 | PDF export | UNKNOWN / NEEDS MANUAL TEST | Existing control retained; no focused automated suite found | Filtered PDF and mobile download | P2 |
| 14 | Opening Stock | MOSTLY DONE | Completion and receipt migrations/functions exist | Multi-staff resume and conflict cases | P1 |
| 15 | PAR levels | MOSTLY DONE | Persistence and staff scope implemented | Night rollover and partial completion | P1 |
| 16 | Bar setup | MOSTLY DONE | UI and scoped tables exist | Empty Venue, delete, and reassignment | P2 |
| 17 | Item setup | MOSTLY DONE | Item selectors and inventory joins exist | Inactive items and cross-Venue isolation | P2 |
| 18 | Warehouse / inventory movement | PARTIAL | Operational Event paths exist but broad Event mutation policy undermines integrity | End-to-end transfer reconciliation | P0 |
| 19 | Partial/weighed bottle workflow | PARTIAL | UI and scale paths exist; decoder and calibration are not certified | Physical bottle matrix | P0 |
| 20 | Scale / BLE / Arboleaf | PARTIAL | Mock suites pass; competing stacks and untrusted bridge remain | Physical hardware certification | P0 |
| 21 | Offline / outbox / sync | BROKEN | Retry/dedup exists, but quota fallback can lose Events and service workers are cleared | Offline reload, quota pressure, recovery | P0 |
| 22 | POS / Square integration | PARTIAL | Deployed Square functions exist; canonical source and complete release tests are missing | Sandbox sync, duplicates, failures | P1 |
| 23 | Analytics | MOSTLY DONE | UI exists; no focused reconciliation suite was found | Compare against approved Events/inventory | P1 |
| 24 | Night Control | MOSTLY DONE | UI and scoped Night logic exist | Open/close/reopen and concurrent manager use | P1 |
| 25 | VIP / `service_mode` filtering | MOSTLY DONE | Barback logic fails closed; broad device matrix not tested | VIP/regular assignment matrix | P1 |
| 26 | Assigned bars filtering | DONE | Scope tests pass and server enforcement exists | Real manager changes during session | P2 |
| 27 | Role permissions | BROKEN | Legacy Event insert/update and anonymous function grants bypass intended review boundaries | Adversarial role matrix | P0 |
| 28 | Audit logs | PARTIAL | Exact-once review audit passes; final-status inserts and non-status mutation are not fully covered | Audit reconciliation | P1 |
| 29 | Error handling and alerts | PARTIAL | Raw backend errors and silent local fallback paths remain | Network, quota, invalid-session failures | P1 |
| 30 | Mobile / iPad layout | UNKNOWN / NEEDS MANUAL TEST | Recent Events UI was manually checked locally; full device matrix absent | Supported iPhone/iPad orientations | P1 |
| 31 | App Store readiness | BROKEN | Legal URLs, privacy manifest, metadata, release governance, and device certification incomplete | Full TestFlight/App Review rehearsal | P0 |

## 5. Barback Link / Barback Manager Release Readiness

**Overall status: PARTIAL**

| Area | Status | Evidence | Main gap |
|---|---|---|---|
| Scoped login and session | MOSTLY DONE | Production web uses phase3 login and scoped JWT/session RPCs | Legacy unsigned token acceptance and stale iOS bundle |
| Session creation | DONE | Manager Edge Function carries `auto_approve_events` | Physical end-to-end manager handoff |
| Session update | PARTIAL | Revoke/rotate paths exist | No existing-session edit for auto approve |
| PENDING submissions | DONE | Active Barback client inserts `PENDING`; server decides auto approval | Legacy DB insert policy still permits final statuses |
| TAKEN / RETURNED / DELIVERED | MOSTLY DONE | Client action workflows exist | CSV action-list inconsistency and physical weighed workflow |
| Assigned bars / staff | DONE | Fail-closed checks and tests exist | Real-time reassignment behavior |
| VIP / service mode | MOSTLY DONE | Fail-closed filtering present | Real event-night matrix |
| Search / browse / empty search | MOSTLY DONE | Browsing and fallback paths exist | Mobile usability test |
| Scanner / manual fallback | MOSTLY DONE | Camera/manual controls exist | Android/iPhone permission and browser test |
| Partial bottle / weight | PARTIAL | BLE, bridge, and manual entry paths exist | Decoder, trust, calibration, and physical certification |
| Review queue / Submit All | MOSTLY DONE | Idempotent client IDs and queued submission exist | Quota-loss and stale quarantine behavior |
| Offline / retry | BROKEN | Retry and outbox exist | App-shell cache removal and silent data loss |
| Duplicate prevention | DONE | `client_event_id` and server uniqueness/idempotency are used | Multi-device collision test |
| Stale session / re-login | MOSTLY DONE | Expiry checks and server validation exist | Revocation while offline |
| Manager auto approval | MOSTLY DONE | Separate from pilot mode, create/list supported | No edit path |
| Mobile compatibility | UNKNOWN / NEEDS MANUAL TEST | Responsive code exists | Physical Android Chrome and iPhone Safari matrix |

Notable production-event risks:

- The outbox quota fallback can discard queued Events without telling the barback.
- The realtime scale bridge trusts broadcast payloads that are not authenticated to the Venue/Night/session.
- The bundled iOS Barback implementation is materially older than the deployed web implementation.
- Offline app-shell behavior is weakened by unconditional service-worker and Cache Storage removal.
- A revoked session may continue displaying queued work until the next online server check.

## 6. Events and Inventory Logic Deep Audit

Verified:

- Production web Barback submissions explicitly start as `PENDING`.
- `TAKEN`, `RETURNED`, and other action values remain separate from review status.
- The iOS bulk decision defaults to `APPROVED` and `KEEP EXISTING ACTION`.
- No active current Admin path using direct `events.update({status: ...})` was found.
- Per-row and bulk review use the secure review RPC/job system.
- Selection is restricted to `PENDING` rows.
- Filter changes clear stale selected/all-matching state.
- Direct processing and durable jobs are separated at the 1,000-row threshold.
- Review job batches are no larger than 500.
- CSV all-matching export paginates server-side beyond 1,000 rows.
- CSV imports are server-created as `PENDING`, max 5,000 rows, processed in batches no larger than 500, with resume/retry/idempotency.
- Inventory calculations inspect `APPROVED` Events.

Material mismatches:

- The web Events list loads only the newest 200 matching rows and has no user-visible paging: `index.html:5235-5253`.
- Web action filters and CSV validation omit operational values such as `TAKEN` and `SOLD`, while Barback produces `TAKEN`: `index.html` CSV whitelist near line 5890 and `supabase/migrations/20260728090000_events_csv_import_jobs.sql:518-528`.
- The iOS current Events implementation includes newer pagination and escaping that the web Admin does not.
- Existing broad database policies allow final-status inserts and non-status mutation of reviewed Events, bypassing the UI/RPC contract.
- Direct final-status operational inserts and non-status changes do not receive the same exact-once review audit coverage.

## 7. Supabase / DB / RPC / RLS Release Readiness

**Overall status: BROKEN because of legacy authorization surfaces**

Positive evidence:

- Project ref exactly matches `uzommuafouvaerdvirzf`.
- Migration history has no drift through `20260728090000`.
- All 94 public tables inspected have RLS enabled.
- No anonymous table grants were found.
- The recent Event review and CSV tables use RLS and manager-scoped RPCs.
- New `SECURITY DEFINER` functions use explicit safe `search_path`.
- Review and CSV RPCs validate Venue/Night scope, IDs, status, reason, and batch ownership.
- Anonymous execute is revoked from the new review/CSV RPCs.
- Public schema grants `USAGE`, not `CREATE`.

Blocking evidence:

- `events_update_v` permits venue staff to update all Event columns. The status firewall runs only when status changes, so quantity, item, action, bar, night, and notes can be altered on final Events: `supabase/migrations/20260417161457_staff_venue_authorization_system.sql:7-40,88-116`.
- Existing Event insert policies scope Venue/Night/Bar but do not force `PENDING`, allowing a client to supply final status/source values: `supabase/migrations/20260418180042_barback_scale_system.sql:149-162` and `20260420080353_phase3_staff_isolation.sql:17-35`.
- `_backup_all_venues_daily`, `_do_create_backup`, and `prune_venue_backups` are anonymous-executable `SECURITY DEFINER` functions without caller authorization: `supabase/migrations/20260418184119_server_side_backup_system.sql:57-94,177-219`.
- Default function privileges grant execute to `anon`, creating a continuing exposure for future functions: remote schema dump default privileges near lines 11431-11434.
- Remote lint reports ambiguous `night_id` in `public.backfill_night_bars`.
- Fourteen deployed functions do not have an obvious canonical source in the current repositories.

## 8. Security and Privacy Risks

No service-role key or credential value is reproduced in this report.

Key risks:

- Unsigned `barinv://connect?cfg=...` configuration can write an arbitrary backend URL/key into local storage: iOS `www/index.html:14233-14259`.
- Stored user-controlled web Admin names are interpolated into `innerHTML` without escaping in several filters: web `index.html:4631-4670` and around `5242`.
- Barback session JWT and outbox content are stored in plaintext localStorage.
- Several privileged backup functions are anonymous executable.
- Default function execute privileges favor `anon`.
- Legacy v1 Barback tokens are accepted without signature verification in `supabase/functions/_shared/jwt.ts:182-204`.
- Edge Functions use broad CORS and sometimes return raw backend error details.
- Runtime code is loaded from multiple third-party CDNs without Subresource Integrity.
- No app-specific live privacy policy currently covers Bluetooth, camera, network, local storage, scale data, staff identity, and operational Event data.

No clear SQL injection path was found in the new review or CSV RPC filter handling.

## 9. iOS / Admin App Release Readiness

**Overall status: BROKEN / RELEASE CANDIDATE ONLY**

Evidence:

- Current candidate: `feature/events-bulk-approval-v1` at `37d4cf5788a4607cea874098aad4611ad360848d`.
- Candidate is pushed but unmerged and untagged.
- `origin/main` is months behind.
- Source and generated `index.html` assets match.
- Bundle identifier: `com.barinv.pro`.
- Deployment target: iOS 15; iPhone and iPad families enabled.
- Marketing version/build: `1.0` / `1`.
- Automatic signing is configured.
- Bluetooth, camera, microphone, Photos, and background Bluetooth declarations exist.

Blockers and risks:

- No `PrivacyInfo.xcprivacy` was found.
- The microphone purpose string says it is needed for barcode scanning, which is not a credible microphone use explanation.
- Six referenced local scripts are absent from the bundle: `portal-config.js`, `barinv-build.js`, `barinv-resolver.js`, `qnksTarget.js`, `qnksDecoder.js`, and `arboleafScaleService.js`.
- The app depends on multiple runtime CDNs and may not start reliably offline.
- The bundled Barback and Manager pages are stale relative to the deployed web versions.
- The arbitrary backend configuration route is unsigned.
- There is no unified automated iOS test runner; `npm test` is a placeholder failure.
- No App Store metadata, screenshots, review notes, test account package, or release checklist was found.

## 10. Scale / BLE / Arboleaf Release Readiness

**Overall status: PARTIAL; physical certification required**

Automated evidence run during audit:

- `tests/scale-fsm-phase-a.test.js`: 5/5 passed.
- `tests/scale-ble-phase-b.test.js`: 20/20 passed.
- `tests/scale-runtime-phase-c.test.js`: 7/7 passed.
- `tests/rapid-return-state-machine.test.js`: 72/72 passed.

Those are mock/runtime tests, not physical Arboleaf certification.

Findings:

- Active iOS code contains multiple overlapping scale stacks: debug, ESP32, generic Chipsea, direct Arboleaf, and older TypeScript modules.
- The direct Arboleaf parser checks the 18-byte packet and checksum, but its high-range `/1` rule is inferred from one labelled 1,674 g frame: iOS `www/index.html:52074-52332`, especially `52275-52282`.
- The separate Scale Lab README says weight encoding is not solved, contradicting comments and release assumptions in the app.
- Realtime Scale Bridge broadcasts can inject numeric grams/stable state into the same latest-reading state without trustworthy scope or origin validation: web `barback.html:3970-4157`.
- A per-device station offset is stored locally and affects displayed/saved/published weight without manager authorization or audit: web `barback.html:3490-3501` and save path near `4361`.
- Stability thresholds differ between web and iOS implementations.
- iPhone Safari cannot use Web Bluetooth; it relies on the Scale Bridge or manual fallback.
- Physical cases for zero, negative, unstable, disconnected, wrong scale, reconnect, timeout, tare, and known bottle percentages lack release evidence.

Any public v1 claim that Arboleaf weights are production-accurate should wait for a documented physical matrix with known reference weights and bottle fixtures.

## 11. ESP32 Custom Scale Readiness

**Overall status: PARTIAL / POST-LAUNCH**

Location:

- `/Users/saiedbeikhosseini/BARINV-PRO-IOS-WORK-GITFIX/firmware/esp32-scale`

What exists:

- ESP32/HX711 firmware, runtime C++ module, calibration/tare logic, BLE service and characteristic definitions.
- BLE ASCII protocol using service `BA51E001` and characteristic `BA51E002`, with payload `<grams>|<stable>`.
- Runtime thresholds for settling, stability, display granularity, and unlock behavior.
- App-side protocol support and mock tests.

What is missing:

- Persisted calibration across reboot.
- Device identity and fleet-management model.
- Battery telemetry and low-battery behavior.
- Secure pairing/bonding and trusted-device selection.
- Firmware version negotiation, diagnostics, OTA/update procedure, and signed release process.
- Reproducible firmware build/CI evidence and a hardware test harness.
- Complete wiring, enclosure, field-calibration, maintenance, and replacement instructions.

The `.ino` performs a blocking boot calibration with a hardcoded 588 g reference. Documentation describing the firmware as a stub is stale. Do not include the ESP32 scale as a generally supported App Store v1 accessory; keep it as a controlled post-launch beta until calibration persistence, security, and hardware certification are complete.

## 12. BARINV.ca Website / Marketing / App Store Support Readiness

**Overall status: PARTIAL**

Verified:

- `https://barinv.ca/` and the inspected features/platform/privacy/terms/robots/sitemap endpoints respond.
- Canonical, OpenGraph, Twitter, favicon, robots, sitemap, and basic security headers are present.
- The site contains product positioning and contact information.

Gaps:

- The live privacy policy explicitly describes the marketing website and excludes the operational app.
- The terms page is website-focused and is not an app/software service agreement.
- No dedicated live support URL, App Store page, test-account guidance, or clear pricing/trial/licensing path was found.
- `https://barinv.ca/privacy-policy.html` is 404, while an app-specific local file with that name exists in the iOS repository.
- Website Smart Scale claims exceed the current physical certification evidence.
- Events product visuals show the older UI without current bulk/CSV workflows.
- No authoritative, current version-controlled BARINV.ca source repository was found. `/Users/saiedbeikhosseini/Documents/BARINV.CA` contains older backups rather than the live source of truth.
- Browser automation was unavailable in this audit, so rendered mobile layout, interactions, and visual regressions remain manual-test items.

## 13. Findings Register

Every finding includes priority, area, evidence, risk, recommended correction, effort, and whether Production work is expected.

| ID | Priority | Area | Description and evidence | Risk | Recommended fix | Effort | Production change |
|---|---|---|---|---|---|---|---|
| P0-01 | P0 | Events authorization | Venue staff can update all Event columns under `events_update_v`; status trigger does not guard non-status changes. Migration `20260417161457...sql:7-40,88-116`. | Approved inventory history can be rewritten without review/audit. | Replace broad update policy with narrow server-authorized operations; block protected field changes after insert/finalization; backfill audit checks. | Large | Yes |
| P0-02 | P0 | Events insertion | Existing insert policies do not force `PENDING`; client can choose final status/source. Migrations `20260418180042...sql:149-162`, `20260420080353...sql:17-35`. | Review, firewall, and audit can be bypassed. | Add server guard forcing allowed source/status contracts and reject unauthorized final inserts. | Medium | Yes |
| P0-03 | P0 | Supabase functions | `_backup_all_venues_daily`, `_do_create_backup`, and `prune_venue_backups` are anonymous-executable `SECURITY DEFINER` functions without caller checks. | Anonymous backup creation/pruning and resource abuse. | Revoke anon/public execute, add explicit admin/service authorization, retest backup operations. | Small | Yes |
| P0-04 | P0 | Scale Bridge | Realtime topic accepts client-supplied grams/stable values without trustworthy Venue/Night/session/source validation. `barback.html:3970-4157`. | Forged weight can corrupt inventory. | Move trust to authenticated server channel, bind payload to session/device/scope, validate freshness/range/sequence, reject client stable claims. | Large | Yes |
| P0-05 | P0 | Barback outbox | On localStorage quota error, outbox saves only the newest half and does not alert. `barback.html:1673-1681`. | Live Event submissions can be silently lost. | Fail loudly, preserve immutable pending entries, add quota telemetry/recovery/export, and test pressure conditions. | Medium | Web deployment |
| P0-06 | P0 | iOS configuration | Unsigned deep link can set arbitrary Supabase/backend URL and key in localStorage. iOS `www/index.html:14233-14259`. | Phishing, credential capture, and data diversion. | Remove in public build or require signed, pinned, allowlisted configuration with administrative confirmation. | Medium | App release |
| P0-07 | P0 | App Store privacy/legal | No live app-specific privacy policy, terms, or support URL; current BARINV.ca policy excludes the app. | App Review rejection and privacy compliance gap. | Publish app-specific legal/support pages matching actual permissions and data flows. | Medium | Website |
| P0-08 | P0 | Scale accuracy | Arboleaf conversion rule lacks adequate physical certification and conflicts with Scale Lab documentation. | 10x or otherwise wrong weight can corrupt bottle percentages/inventory. | Establish authoritative protocol evidence and physical test matrix; gate or disable unsupported devices until certified. | Large | App/web if gated |
| P0-09 | P0 | Release governance | iOS candidate is only on a feature branch, untagged, `origin/main` is stale, version/build remain `1.0/1`. | Cannot reproduce or identify the submitted binary safely. | Create a reviewed release branch/tag, update version/build, verify clean archive provenance. | Medium | Git/App release |
| P1-01 | P1 | Edge Function source | Roughly 14 deployed functions have no canonical current-repo source. | Production behavior cannot be reproduced, reviewed, or rolled back reliably. | Recover exact deployed source, assign ownership, and include it in version control. | Large | Possibly |
| P1-02 | P1 | Barback auth | Legacy v1 session tokens are accepted without signature verification. `_shared/jwt.ts:182-204`. | Token forgery/legacy authorization risk. | Measure usage, expire legacy path, require signed current tokens. | Medium | Function deployment |
| P1-03 | P1 | iOS bundled web | Bundled `barback.html` and `barback_manager.html` are materially older than deployed web; old Barback has auto/test PIN fallback. | Different security and workflow behavior depending on entry path. | Define source-of-truth asset sync and bring bundled pages to verified versions without losing iOS customizations. | Large | App release |
| P1-04 | P1 | iOS runtime assets | Six referenced local scripts are missing; many third-party scripts load at runtime from CDNs without SRI. | Startup/offline/supply-chain failures. | Package pinned assets locally, remove stale references, add integrity/build checks. | Medium | App release |
| P1-05 | P1 | Web XSS | Several Admin option labels use unescaped names in `innerHTML`. `index.html:4631-4670,5242`. | Stored names can execute script in manager context. | Use DOM text APIs or the existing escaping helper consistently; add malicious-label tests. | Medium | Web deployment |
| P1-06 | P1 | Supabase defaults | Default privileges grant execute on new functions to anon; 51 functions currently expose anon execute. | Future privileged RPCs may be exposed accidentally. | Revoke default anon execute and explicitly grant per function; audit current list. | Medium | Yes |
| P1-07 | P1 | Database lint | `public.backfill_night_bars` has ambiguous `night_id`. | Broken maintenance/backfill operation and failed quality gate. | Correct in a new migration and add compile/lint regression. | Small | Yes |
| P1-08 | P1 | Test suite | `barback-scope-session-security.test.cjs` expects 89 migrations but finds 92. | Aggregate Barback suite is not green and can hide regressions. | Replace brittle count assertion with expected-version/security checks. | Small | No |
| P1-09 | P1 | CI/test orchestration | iOS `npm test` is a placeholder failure; no unified CI runs JS, SQL, rollback, UI, firmware, and build gates. | Release status depends on manual evidence. | Add deterministic read-only CI matrix and release gate. | Large | No |
| P1-10 | P1 | Web Events Log | Web loads only newest 200 matching rows with no visible paging. `index.html:5235-5253`. | Managers cannot inspect or page through older matching Events. | Add server-side paging consistent with iOS and preserve all-matching counts. | Medium | Web deployment |
| P1-11 | P1 | CSV/actions | CSV action validation omits active operational actions such as `TAKEN`/`SOLD`. | Valid workflows cannot be imported/export-replayed consistently. | Define one server-owned action enum and consume it in clients/tests. | Medium | DB and web/app |
| P1-12 | P1 | Manager sessions | `auto_approve_events` is create/list only; existing sessions cannot be edited. | Manager cannot correct the setting without replacing a session. | Add a manager-authorized update path with audit and clear UX. | Medium | Function/web |
| P1-13 | P1 | Local data storage | Barback JWT, session details, and outbox entries are plaintext in localStorage. | Shared/lost device exposure and XSS amplification. | Reduce token lifetime, minimize stored data, use platform secure storage where possible, add logout wipe policy. | Large | App/web |
| P1-14 | P1 | Offline/cache | Web service worker uses root paths inappropriate for `/barinv-pro/`; Barback unregisters all workers and deletes all origin caches. | Offline reload failure and interference with other Pages surfaces. | Scope/version service worker correctly and remove global cache destruction. | Medium | Web deployment |
| P1-15 | P1 | Scale calibration | Local station offset changes saved/published weight without manager approval or audit. | Hidden calibration can bias inventory. | Make calibration server-authorized, device-specific, bounded, versioned, and audited. | Medium | DB/web |
| P1-16 | P1 | Scale architecture | Multiple active stacks and different stability thresholds compete across web/iOS. | Divergent readings and hard-to-debug production behavior. | Select one authoritative adapter contract and shared stability rules. | Large | App/web |
| P1-17 | P1 | ESP32 | Calibration is boot-time/RAM-only; no device identity, battery, security, OTA, or release process. | Custom hardware is not supportable in public production. | Keep beta-only; add persistent calibration, security, diagnostics, and hardware release process. | Large | Post-launch |
| P1-18 | P1 | Physical QA | No complete Android/iPhone/iPad/scanner/BLE/offline/event-night certification matrix. | Platform-specific blockers may surface during live service. | Run documented physical-device release matrix with known fixtures and recovery scenarios. | Large | No |
| P1-19 | P1 | App Store package | Privacy manifest, metadata, screenshots, review notes, test account, and permission reconciliation are missing. | Submission rejection or incomplete review. | Prepare App Store package and validate every permission against actual use. | Medium | App Store |
| P1-20 | P1 | Backup capacity | MiniSSD is about 96% full with about 38 GiB free. | Next full backup may fail during release. | Verify retention, move verified old sets to secondary storage, preserve manifests/checksums. | Medium | No |
| P1-21 | P1 | BARINV.ca source | No authoritative version-controlled source matching the live site was found. | Site cannot be safely reproduced or rolled back. | Recover/export live source into a controlled repository with deployment documentation. | Medium | Website |
| P1-22 | P1 | Marketing claims | Smart Scale and live feature claims exceed current physical certification; Events imagery is stale. | Customer expectation, legal, and App Review inconsistency. | Align claims/screenshots with certified capabilities and current UI. | Small | Website |
| P1-23 | P1 | Audit completeness | Exact-once audit covers review transitions but not final-status insert bypasses or protected non-status mutation. | Inventory-changing actions may lack accountable history. | Expand immutable Event/audit contract after closing policy bypasses. | Large | Yes |
| P1-24 | P1 | Function hardening | Broad CORS, raw backend error details, and ambiguous service-key fallback remain. | Information disclosure and configuration fragility. | Standardize CORS, public errors, internal logging, and explicit service-key role selection. | Medium | Functions |
| P2-01 | P2 | Manager dead path | `extendSession()` exists without reachable `data-extend` UI; older deployed management functions overlap. | Confusing ownership and untested behavior. | Decide supported lifecycle, remove dead UI code, deprecate obsolete functions. | Small | Possibly |
| P2-02 | P2 | Auth helper | `auth_session_active()` returns `TRUE` and is misleading. | Future callers may assume it enforces session validity. | Remove or implement correctly with tests. | Small | Yes |
| P2-03 | P2 | Frontend maintainability | Web and iOS use very large divergent single-file HTML implementations. | Fixes drift and security patches are missed between surfaces. | Extract versioned shared modules and generated asset pipeline incrementally. | Large | App/web |
| P2-04 | P2 | Bulk action correction | iOS exposes action choice but blocks non-keep values because no secure server contract exists. | UI implies a capability that is unavailable. | Hide/disable with clear product decision or add separately audited correction RPC later. | Medium | Product decision |
| P2-05 | P2 | Website visuals | BARINV.ca Events visuals show an older UI. | Public documentation does not match product. | Replace with current, redacted screenshots after release UI stabilizes. | Small | Website |
| P2-06 | P2 | Commercial readiness | Pricing/trial/licensing and dedicated support flow are unclear. | Prospects and App Review cannot understand service access/support. | Publish owner-approved commercial and support information. | Medium | Website |
| P2-07 | P2 | Website QA | Rendered browser/mobile inspection was unavailable; static HTTP/source checks only. | Visual or interactive regressions may remain. | Run automated and physical responsive/browser audit against live pages. | Small | No |
| P2-08 | P2 | POS/Square | Deployed integration exists but current source ownership and full sandbox failure tests are incomplete. | Sync duplicates or stale inventory may be missed. | Recover source and execute sandbox reconciliation/retry/idempotency matrix. | Large | Possibly |
| P2-09 | P2 | Operational inserts | Some Admin operational paths intentionally insert `APPROVED` Events directly. | Policy is fragmented and audit semantics are unclear. | Document and centralize allowed system-origin final inserts behind audited server APIs. | Large | Yes |
| P2-10 | P2 | Git hygiene | Local web `main` is stale; many old branches/tags/backups remain. | Operators may build/deploy from wrong point. | Produce branch/tag retention and release-source policy after backups verify. | Medium | Git |
| P2-11 | P2 | Production logging | Scale packet/debug logging is verbose. | Noise, performance impact, and operational detail exposure. | Gate diagnostics behind non-production debug settings and redact identifiers. | Small | App/web |
| P2-12 | P2 | Scale Lab governance | Scale Lab has no remote and is heavily dirty with deleted core tests/modules and untracked captures/tools. | Evidence is not reproducible or recoverable. | Preserve, inventory, establish canonical branch/remote, and restore a green test baseline. | Large | No |
| P3-01 | P3 | Naming/comments | Names such as `TEST_MODE_BARBACK` and stale phase comments do not reflect active production behavior. | Reviewer confusion. | Rename/update comments after security behavior is locked. | Small | No |
| P3-02 | P3 | Repository cleanup | Old backup branches/tags are numerous. | Navigation and release inventory are noisy. | Archive only after verified bundles and owner-approved retention list. | Small | Git |
| P3-03 | P3 | Marketing preview | Website illustrative Events preview remains old. | Minor credibility/usability mismatch. | Refresh alongside marketing release. | Small | Website |
| P3-04 | P3 | Documentation | ESP32 README calls working firmware a stub and several runbook claims exceed evidence. | Engineers may follow incorrect assumptions. | Reconcile docs with tested hardware state. | Small | No |

## 14. P0 Blockers

Public release is blocked until all nine P0 findings are closed and independently retested:

- `P0-01`: prevent staff from changing protected fields on submitted/final Events.
- `P0-02`: force client-created operational Events through the allowed `PENDING` contract.
- `P0-03`: remove anonymous access to privileged database backup/prune functions.
- `P0-04`: authenticate and scope realtime Scale Bridge readings.
- `P0-05`: prevent silent Barback outbox loss under storage pressure.
- `P0-06`: remove or cryptographically authorize arbitrary backend configuration.
- `P0-07`: publish app-specific privacy, terms, and support URLs.
- `P0-08`: physically certify Arboleaf decoding/calibration or gate the feature.
- `P0-09`: create a reproducible, versioned, tagged iOS release candidate.

## 15. P1 Required Before Public Release

The 24 P1 items should be completed before App Store/public launch:

- Recover canonical source for deployed Edge Functions.
- Retire unsigned legacy Barback tokens.
- Reconcile stale iOS Barback/Manager assets with deployed web.
- Package missing/runtime CDN assets safely.
- Close stored-XSS render paths in web Admin.
- Replace anonymous default function grants with explicit grants.
- Fix the remote database lint error.
- Restore a fully green aggregate test suite and release CI.
- Add web Events paging.
- Unify the action enum used by CSV and operational Events.
- Add the owner-approved session update workflow.
- Reduce sensitive localStorage exposure.
- repair service-worker/cache behavior.
- Make scale calibration authorized and auditable.
- Consolidate scale adapters and stability rules.
- Keep ESP32 restricted until its hardware lifecycle is production-ready.
- Complete the physical device/browser/event-night QA matrix.
- Prepare the App Store privacy/metadata/review package.
- Restore safe backup capacity.
- Establish an authoritative BARINV.ca source repository.
- Align marketing claims with verified product behavior.
- Complete immutable Event audit coverage.
- Standardize Function CORS, public errors, logging, and key-role selection.

## 16. P2 Improvements

The 12 P2 findings can follow the P0/P1 release gates unless the owner promotes one into v1 scope:

- Resolve dead/overlapping session-management paths.
- Remove or implement the misleading `auth_session_active()` helper.
- Reduce web/iOS single-file duplication with a controlled shared asset pipeline.
- Decide whether secure Event action correction belongs in the product.
- Refresh website visuals and commercial/support information.
- Complete rendered/mobile BARINV.ca QA.
- Recover and test POS/Square source and sandbox behavior.
- Centralize legitimate system-origin final Event inserts.
- Formalize Git branch/tag retention and release-source rules.
- Reduce production scale debug logging.
- Preserve and establish a reproducible Scale Lab baseline.

## 17. Half-Started or Unfinished Features

- Existing-session update for `auto_approve_events`.
- Secure Event action-correction workflow after selection.
- ESP32 production accessory lifecycle.
- Scale device calibration/fleet trust model.
- Canonical source recovery for deployed Edge Functions.
- Unified web/iOS frontend source pipeline.
- Proper offline app-shell and durable outbox recovery.
- Full POS/Square sandbox and rollback evidence.
- App Store legal, privacy, metadata, and review package.
- Version-controlled BARINV.ca source and rollback process.

## 18. Bugs Found

- Silent outbox truncation under localStorage quota pressure.
- Web Events list stops at 200 rows without paging.
- CSV action whitelist rejects operational action values used elsewhere.
- Stored XSS exposure in several web Admin option render paths.
- Root-scoped service-worker URLs are incorrect for the GitHub Pages subpath.
- Barback deletes all service workers and Cache Storage entries for the origin.
- Remote DB lint failure in `backfill_night_bars`.
- Aggregate Barback security test has a stale exact migration-count assertion.
- Missing iOS local scripts cause startup warnings/fallbacks.
- iOS bundled Barback/Manager behavior differs from current production web.

## 19. Testing Gaps

Missing or incomplete release gates:

- Adversarial SQL authorization tests against every Event insert/update field.
- Anonymous RPC inventory test that fails on unapproved execute grants.
- Authenticated end-to-end UI test for web and iOS Events workflows.
- Browser tests for zero-row, all-invalid, all-duplicate, 5,000-row CSV, refresh/resume, and file download.
- Offline quota, abrupt app termination, stale outbox, and multi-device idempotency tests.
- Physical iPhone/iPad/Android scanner/BLE/manual fallback matrix.
- Physical Arboleaf reference-weight and known-bottle-percentage certification.
- ESP32 reproducible build, protocol compatibility, calibration persistence, and battery tests.
- POS/Square sandbox retries, duplicate webhook, reconciliation, and outage recovery.
- App startup without network/CDNs.
- BARINV.ca visual/mobile/accessibility/broken-link automation.
- Restore rehearsal from the latest database, Git bundle, and website source.

## 20. Data, Backup, and Rollback Risks

Evidence found:

- Event review production release backup:
  `/Volumes/MiniSSD/BARINV_FULL_BACKUPS/BARINV_EVENT_REVIEW_PRODUCTION_RELEASE_20260727_20260727_134424`
- CSV production release backup:
  `/Volumes/MiniSSD/BARINV_FULL_BACKUPS/BARINV_EVENTS_CSV_PRODUCTION_RELEASE_20260728_20260728_093551`
- Isolated database harness:
  `/Volumes/MiniSSD/BARINV_EVENT_REVIEW_DB_TEST_20260727`
- iOS Events bulk fixes backup:
  `/Volumes/MiniSSD/BARINV_IOS_EVENTS_BULK_FIXES_BACKUP_20260729_130501`
- iOS web-asset investigation:
  `/Volumes/MiniSSD/BARINV_IOS_WEB_ASSET_READONLY_INVESTIGATION_20260728_120203`
- New feature rollback SQL files are outside `supabase/migrations` and have validation evidence.
- iOS backup checksum verification reports all checked files OK.

Gaps:

- MiniSSD capacity is near exhaustion.
- No current authoritative BARINV.ca source backup was found.
- Many deployed Edge Functions cannot be reconstructed from current repo source.
- No audited end-to-end restore rehearsal covers database, functions, Pages, iOS source, and website together.
- Scale Lab has no remote and a materially dirty/unreproducible state.

## 21. Recommended Release Plan and Exact Next Actions

1. Freeze release scope and preserve current web/iOS/Scale Lab states with verified bundles.
2. Close P0-01 through P0-03 using new forward-only database migrations and adversarial local tests.
3. Close P0-04 and P0-08; either certify scale paths or feature-gate them from public v1.
4. Fix outbox loss and prove offline recovery under quota/network/app-termination conditions.
5. Remove or cryptographically restrict the arbitrary backend configuration route.
6. Publish app-specific privacy, terms, and support pages; reconcile every iOS permission.
7. Recover canonical source for all deployed Edge Functions and remove unsafe default grants.
8. Reconcile web/iOS Barback and Manager implementations through a controlled asset pipeline.
9. Make all automated suites green, including database lint and the stale migration-count test.
10. Run a documented physical-device and event-night rehearsal using isolated/test data.
11. Create a clean iOS release branch/tag, increment version/build, and produce a reproducible archive.
12. Complete TestFlight review before public App Store submission.

## 22. Definition of Done for Public App Store Release

- Zero open P0 findings.
- P1 findings either closed or explicitly accepted by the owner with compensating controls.
- No staff/anon path can bypass Event review, mutate final inventory history, or run privileged maintenance.
- Scale features are physically certified or disabled/labelled beta.
- No queued Barback Event can be silently discarded.
- App backend configuration is pinned/authorized.
- Live app privacy, terms, and support URLs match actual data and permissions.
- Privacy manifest, permission text, metadata, screenshots, review notes, and test account are complete.
- Web, iOS, Barback, Manager, and deployed functions have identifiable source commits.
- All automated suites, lint, rollback tests, and release checks pass.
- Supported device/browser matrix passes, including offline recovery.
- Pre-release backup and full restore rehearsal pass.
- Release branch, annotated tag, version/build, archive hash, and deployed binary are traceable.

## 23. Owner Decisions Required

- Is Arboleaf scale support required for App Store v1, restricted beta, or post-launch?
- Is the ESP32 custom scale in v1 scope or post-launch?
- Should staff ever be allowed to modify an Event after submission, and which fields?
- Which Admin workflows are legitimately allowed to insert immediately `APPROVED` Events?
- Should action correction be supported in bulk review, or should the UI remain status-only?
- Is dynamic backend configuration a required enterprise feature? If yes, who signs/authorizes it?
- What is the canonical repository for all deployed Edge Functions and BARINV.ca?
- What is the supported offline retention/recovery promise for live event nights?
- Which iPhone/iPad/Android models and scale devices are officially supported?
- What legal entity, support SLA, pricing, trial, and licensing language should be published?

## 24. Audit Method and Limitations

The audit used read-only Git/GitHub/Supabase/HTTP inspection, Graphify code-only extraction, static source review, existing validation evidence, and safe local test commands. Graphify code-only maps completed successfully:

- Web: 112 files, 453 nodes, 1,021 edges.
- iOS: 49 files, 217 nodes, 292 edges.

Full Graphify extraction was not forced when non-code documents/images required unavailable API-key processing. No key was added. Rendered BARINV.ca browser automation was unavailable, so website visual/mobile claims remain manual. No Production data was modified, no migration/function was deployed, no app was installed, no firmware was flashed, no signing state was changed, and no credential file was read.
