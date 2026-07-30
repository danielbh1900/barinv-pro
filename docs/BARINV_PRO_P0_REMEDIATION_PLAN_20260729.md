# BARINV PRO P0 Remediation Plan

Date: 2026-07-29
Status: Planning only
Source audit commit: `15f5ef2841ef44417a186d0dd227323f43298b4b`
Source reports:

- `docs/BARINV_PRO_RELEASE_READINESS_AUDIT_20260729.md`
- `docs/BARINV_PRO_RELEASE_READINESS_AUDIT_20260729.json`

No product code, database object, deployment, signing setting, tag, or remote state was changed while preparing this plan.

## 1. Executive Summary

BARINV PRO has nine open P0 findings and must not proceed to a public App Store release until all nine are closed and independently verified.

The safest path is seven controlled implementation phases after a mandatory backup/freeze phase. The plan deliberately avoids one combined release:

1. Close the database authorization bypasses and anonymous maintenance-function access.
2. Prevent Barback outbox loss and stop trusting public Scale Bridge broadcasts.
3. remove or harden dynamic iOS backend configuration.
4. Publish accurate app-specific legal and support pages.
5. Certify scale accuracy or disable/gate scale features for public v1.
6. Establish a reproducible iOS release branch, version, build, and tag process.
7. Repeat the complete security, data-integrity, physical-device, backup, and release-readiness gates.

The only fixes that should share one implementation unit are P0-01 and P0-02 because they define one Event write contract. Even then, their tests and acceptance criteria remain distinct. P0-03 should use a separate migration. Web, Edge Function, iOS, website, physical certification, and release-governance changes should each have independent approval and rollback checkpoints.

## 2. Recommended Fix Order

| Sequence | Finding | Immediate objective | Why this order |
|---|---|---|---|
| 0 | All | Backup, freeze, owner decisions, baseline hashes/counts | No remediation starts without recoverable evidence |
| 1 | P0-03 | Remove anonymous privileged maintenance access | Small, independent, externally exploitable database closure |
| 2 | P0-01 | Make protected Event fields immutable to normal clients | Stops rewriting existing inventory history |
| 3 | P0-02 | Enforce the client insert status/source contract | Stops new review/audit bypasses |
| 4 | P0-05 | Eliminate silent outbox truncation | Prevents live submission loss without DB changes |
| 5 | P0-04 | Disable untrusted realtime weight ingestion; select secure transport | Prevents forged weights before broader scale certification |
| 6 | P0-06 | Remove or cryptographically restrict dynamic backend configuration | Closes iOS data-redirection risk |
| 7 | P0-07 | Publish app-specific privacy, terms, and support pages | Required before App Store metadata and review |
| 8 | P0-08 | Complete physical certification or gate scale out of public v1 | Determines the supported product surface |
| 9 | P0-09 | Create the reproducible iOS release checkpoint | Must describe a build with all earlier P0s closed |

P0-01 and P0-02 should be designed together and may ship in one database release after isolated tests. Their sequence numbers describe validation order, not separate Production pushes.

## 3. Dependency Map

```text
Phase 0 backups and owner decisions
  |
  +-- Decision: submitted Event edit policy
  |     +--> P0-01 protected update contract
  |
  +-- Decision: allowed immediate APPROVED operational inserts
  |     +--> P0-02 insert contract
  |
  +--> P0-03 privileged maintenance grants
  |
  +--> P0-05 durable outbox behavior
  |
  +-- Decision: scale in v1 / restricted beta / disabled
  |     +--> P0-04 secure bridge or bridge disabled
  |     +--> P0-08 physical certification or feature gate
  |
  +-- Decision: dynamic backend configuration required?
  |     +--> P0-06 remove or signed/allowlisted design
  |
  +-- Decisions: legal URLs and canonical BARINV.ca repo
        +--> P0-07 publish legal/support pages

P0-01 through P0-08 verified closed
  |
  +-- Decision: merge to main or release branch
        +--> P0-09 version/build/release/tag governance
              +--> Phase 7 final release-readiness checkpoint
```

Additional constraints:

- P0-01/P0-02 must preserve tested server-authoritative session auto-approval.
- P0-01/P0-02 must not break legitimate manager review RPCs, durable jobs, CSV imports, or inventory derivation.
- P0-04 implementation depends on recovering or recreating canonical source for the deployed `barback-scale-bridge` Function if the HTTP bridge remains supported.
- P0-07 must finish before final App Store metadata is frozen.
- P0-09 must be last because its commit/tag must identify the final verified source state.

## 4. Exact Scope Boundaries

In scope:

- Forward-only database authorization changes required for P0-01, P0-02, and P0-03.
- Focused web changes to `barback.html` for P0-04 and P0-05.
- Focused iOS web-asset/configuration changes for P0-06.
- App-specific BARINV.ca legal/support content for P0-07.
- Physical scale protocol/accuracy certification or explicit feature gating for P0-08.
- Release branch, version/build, evidence, and tag governance for P0-09.
- Tests, rollback scripts, backups, manifests, checksums, and reports required to prove each closure.

Out of scope:

- P1/P2/P3 remediation except where a P1 prerequisite is unavoidable for a P0, such as recovering canonical `barback-scale-bridge` source.
- Broad frontend rewrites or shared-module extraction.
- New Event actions, statuses, inventory behavior, POS features, or staff workflows.
- Data deletion, migration history repair, destructive rollback, or modification of historical migrations.
- Automatic conversion of existing Events.
- App Store submission before the final P0 checkpoint.
- ESP32 general-production support; default recommendation is post-launch/restricted beta.

## 5. Phase 0 - Backup and Freeze

Required before any implementation:

1. Freeze the exact web, iOS, Scale Lab, BARINV.ca, deployed database, deployed Function, and live website baselines.
2. Create Git bundles containing all branches and tags for every version-controlled repository.
3. Create tracked-tree archives for the exact starting commits.
4. Create a complete Production database backup using supported Supabase commands:
   - schema
   - roles
   - public data
   - auth data when permitted
   - storage data/reference
   - migration history
   - functions, triggers, grants, RLS policies, indexes, and extensions
5. Capture Event before-state:
   - total count
   - status counts
   - deterministic hash of immutable/inventory-relevant columns
   - audit count/hash
6. Preserve deployed Edge Function inventory and recover source before changing any Function.
7. Archive live GitHub Pages HTML and BARINV.ca pages/headers.
8. Preserve current iOS source, generated public assets, build settings, bundle hashes, and installed candidate evidence.
9. Preserve Scale Lab dirty state without reset/stash and create a read-only evidence archive.
10. Verify checksums, Git bundles, non-zero SQL files, restore guides, and sufficient MiniSSD capacity.

Freeze rule: no unrelated migration, Function, web, iOS, website, or scale work enters any P0 branch.

## 6. Phase 1 - Supabase/Event Authorization Closure

### P0-03 - Anonymous privileged maintenance functions

- Finding ID: `P0-03`
- Recommended sequence: 1
- Affected surface: Supabase database authorization
- Root cause: `_do_create_backup`, `_backup_all_venues_daily`, and `prune_venue_backups` are `SECURITY DEFINER` and executable through overly broad grants without their own caller authorization.
- Production risk: Critical security and resource-abuse risk
- Effort: Small
- Production change: Yes, one forward-only migration
- App Store blocker: Yes

Safest fix approach:

1. Add a dedicated migration that revokes execute from `PUBLIC`, `anon`, and `authenticated` for every overload of the three internal functions.
2. Grant execute only to `service_role` where operationally required. Function owner/Postgres maintenance remains available.
3. Do not change function behavior, backup retention, tables, or data in this migration.
4. Add catalog assertions proving the final ACL and proving normal backup wrappers still enforce manager access.

Likely files:

- `supabase/migrations/20260729103000_lock_down_backup_maintenance_functions.sql`
- `supabase/rollbacks/20260729103000_lock_down_backup_maintenance_functions_ROLLBACK.sql`
- `supabase/tests/p0_backup_function_grants_local_test.sql`

Likely Supabase objects:

- `public._do_create_backup(...)`
- `public._backup_all_venues_daily()`
- `public.prune_venue_backups(uuid)`
- Existing authorized public wrapper functions, if any

Tests:

- `anon` cannot execute any internal function.
- Ordinary `authenticated` cannot execute any internal function.
- Authorized manager wrapper still works only for an allowed Venue.
- Cross-Venue manager call fails.
- `service_role`/maintenance path remains functional in the isolated harness.
- Function owner, `SECURITY DEFINER`, and explicit `search_path` remain correct.
- No table rows or backup history are changed by migration application itself.

Manual QA:

- Run a manager-created backup through the supported UI/RPC in an isolated database.
- Confirm scheduled maintenance still has a documented owner/role.

Backup:

- Full DB backup, current function definitions, ACL catalog output, backup table counts/hash.

Rollback:

- Do not automatically restore anonymous or authenticated execute.
- If maintenance breaks, issue a forward corrective migration granting only the exact scheduler/service role.
- Keep rollback SQL for syntax/dependency validation, but treat any rollback that reopens public access as emergency-only and owner-approved.

Risk if delayed: anonymous callers can invoke privileged maintenance and pruning operations.

Suggested branch and commit:

- Branch: `fix/p0-backup-function-grants-v1`
- Commit: `fix(db): restrict privileged backup maintenance functions`

### P0-01 - Protected Event updates

- Finding ID: `P0-01`
- Recommended sequence: 2
- Affected surface: Supabase Events table, RLS, triggers, review/audit contract
- Root cause: the broad authenticated Event update policy authorizes Venue staff to update inventory-relevant fields; the current firewall triggers only when `status` changes.
- Production risk: Critical data-integrity risk
- Effort: Large
- Production change: Yes
- App Store blocker: Yes

Safest fix approach:

1. Owner first defines whether submitted Events are immutable and, if not, which fields and roles may edit a `PENDING` Event.
2. Default recommendation:
   - immutable after insert for normal clients: `venue_id`, `night_id`, `bar_id`, `station_id`, `item_id`, `action`, `qty`, `qty_basis`, `source`, `staff_id`, `session_id`, `client_event_id`, `submitted_by`, and `created_at`;
   - status changes remain exclusively under the existing manager review firewall/RPC/job path;
   - any permitted note/reason correction uses a narrow manager RPC and audit record rather than broad table update.
3. Add a new `BEFORE UPDATE` guard covering protected fields for every non-maintenance caller.
4. Replace the broad Event update policy with the minimum policy required for legitimate operations.
5. Preserve the existing `barinv_events_guard_status_update` and exact-once review audit behavior.
6. Do not mutate existing Event data during migration.

Likely files:

- `supabase/migrations/20260729100000_close_event_write_contract.sql`
- `supabase/rollbacks/20260729100000_close_event_write_contract_ROLLBACK.sql`
- `supabase/tests/event_write_contract_local_test.sql`
- Existing Event review/CSV test files, updated only to add regression coverage

Likely Supabase objects:

- `public.events`
- Existing Event update policies, including the role-gated Venue policy identified by the audit
- `public.barinv_events_guard_status_update()`
- `trg_events_guard_status_update`
- Proposed `public.barinv_events_guard_protected_update()`
- Proposed `trg_events_guard_protected_update`
- `public.event_review_audit`

Tests:

- Staff cannot change any protected field on `PENDING`, `APPROVED`, or `REJECTED` Events.
- Staff cannot combine a status transition with another protected field change.
- Unauthorized manager and cross-Venue/cross-Night updates fail.
- Existing manager direct status compatibility remains status-only and exactly-once audited.
- Review RPC and durable jobs still pass all existing tests.
- CSV-imported PENDING Events remain immutable after insert except through allowed contracts.
- Service maintenance is limited and explicitly tested.
- Existing Events count, values, status hash, and audit hash remain unchanged after migration.

Manual QA:

- Admin per-row approval/rejection.
- Mixed-action bulk approval with Keep Existing Action.
- Non-status UI behavior that legitimately edits an Event, if the owner approves any such workflow.

Backup:

- Full DB backup plus deterministic hash of all protected Event columns and current policy/function definitions.

Rollback:

- Prefer a forward corrective migration.
- Do not automatically restore broad update authorization.
- Client/UI rollback is acceptable only if it still works with the stricter DB contract.

Risk if delayed: a compromised or malfunctioning staff client can rewrite approved inventory history without review/audit.

Suggested branch and commit:

- Branch: `fix/p0-events-write-contract-v1`
- Commit: `fix(events): protect submitted event fields`

### P0-02 - Event insert status/source contract

- Finding ID: `P0-02`
- Recommended sequence: 3
- Affected surface: Supabase Events inserts, Barback/Admin clients, review and inventory audit
- Root cause: legacy insert policies enforce scope but do not require client submissions to begin `PENDING`; some Admin operational paths intentionally insert `APPROVED`.
- Production risk: Critical review/audit bypass
- Effort: Medium to large, depending on owner decision
- Production change: Yes
- App Store blocker: Yes

Safest fix approach:

1. Inventory every source that inserts an Event and classify it:
   - Barback/user submission: always `PENDING`;
   - CSV import: always `PENDING`;
   - manager review: update through review RPC, never insert a final status;
   - trusted operational/system insertion: owner-approved list only.
2. Add a `BEFORE INSERT` contract guard that rejects unauthorized final status/source combinations.
3. Ensure the insert guard runs before session auto-approval validation. It must validate the client-supplied `PENDING` contract, then allow the existing server trigger to convert a valid session Event to `APPROVED`.
4. Do not rely only on client code or RLS.
5. If immediate `APPROVED` operational inserts remain required, move them behind one narrow `SECURITY DEFINER` RPC that:
   - verifies manager/service authorization;
   - validates Venue/Night and all references;
   - uses a server-owned source;
   - writes a dedicated insertion/audit record;
   - is not executable by `anon`.
6. Reject, rather than silently reinterpret, unauthorized client final status so callers cannot believe an Event was approved.

Likely files:

- Shared migration and rollback with P0-01:
  `20260729100000_close_event_write_contract.sql`
- `supabase/tests/event_write_contract_local_test.sql`
- `index.html`, only if approved operational insert paths must be moved to a new RPC
- iOS `www/index.html`, only if equivalent direct operational inserts exist there

Likely Supabase objects:

- `public.events`
- Existing Event insert policies
- Proposed `public.barinv_events_guard_insert_contract()`
- Proposed lexically ordered `BEFORE INSERT` trigger
- `public.barinv_events_apply_session_auto_approve()`
- `trg_events_session_auto_approve`
- `public.event_review_audit` or a separate operational-insert audit table
- Optional proposed `public.barinv_create_operational_event(...)`

Tests:

- Barback, CSV, and normal staff clients cannot insert `APPROVED` or `REJECTED`.
- Forged source/session/status combinations fail closed.
- Valid Barback PENDING insert remains PENDING when auto approve is false.
- Valid Barback PENDING insert becomes server-approved when auto approve is true.
- Auto-approved Event has exactly one audit row.
- Legitimate owner-approved operational insert path works only through its RPC.
- Cross-Venue/Night/Bar/Staff/Session references fail.
- Existing direct/durable review and 1,500-row suites remain green.
- Migration itself changes no existing Event status or row.

Manual QA:

- Barback submit and Submit All.
- Admin transfer/warehouse/other operational Event creation paths identified by the inventory.
- CSV import preview and small import in the isolated harness.

Backup:

- Same full database and Event hashes as P0-01; source inventory of all Event inserts.

Rollback:

- Use a forward correction, not a rollback to permissive final-status inserts.
- If a legitimate operational workflow fails, disable that workflow temporarily and add a narrowly authorized RPC rather than reopening generic inserts.

Risk if delayed: authenticated clients can bypass PENDING review and exact-once audit.

Suggested branch and commit:

- Branch: `fix/p0-events-write-contract-v1`
- Commit: `fix(events): enforce pending insert contract`

## 7. Phase 2 - Barback Outbox and Scale Bridge Safety

### P0-05 - Silent outbox loss

- Finding ID: `P0-05`
- Recommended sequence: 4
- Affected surface: web Barback Link and any bundled copy that uses the same outbox
- Root cause: `Outbox.save()` catches storage failure and overwrites the durable queue with only the newest half without surfacing failure.
- Production risk: Critical live-event data-loss risk
- Effort: Medium
- Production change: Yes, web deployment; later iOS asset sync only if that bundled path remains supported
- App Store blocker: Yes

Safest fix approach:

1. Remove truncation entirely.
2. Make persistence return a structured success/failure result and verify read-after-write.
3. Do not clear the form or report an Event as queued until durable persistence succeeds.
4. On quota/unavailable storage:
   - preserve the previous durable queue;
   - keep the new record in visible UI memory;
   - block navigation/submission completion;
   - present a clear retry/online-submit action;
   - never claim success.
5. Consider IndexedDB as a separate durable enhancement only if the minimal localStorage fix cannot meet the event-night retention requirement.
6. Preserve `client_event_id`, retry backoff, idempotency, and PENDING status behavior.

Likely files:

- `barback.html`
- Existing Barback outbox/offline JavaScript tests
- New focused test such as `tests/barback-outbox-durability.test.cjs`
- iOS bundled `www/barback.html` only in a separately reviewed asset-sync release

Supabase objects:

- No schema change expected
- Existing Event idempotency/`client_event_id` constraint remains a test dependency

Tests:

- Empty queue, one row, small queue, large queue.
- Mocked `QuotaExceededError` before and after existing records.
- Previous queue remains byte-for-byte intact on failure.
- New record is not reported as queued if persistence failed.
- Retry after capacity recovery stores exactly one record.
- Reload preserves all successfully queued records.
- Submit All interruption/resume and server idempotency.
- 7-day stale/quarantine path does not silently delete.

Manual QA:

- Offline submit, force storage failure in a controlled browser profile, recover online, and verify exact Event count.
- Android Chrome and iPhone browser behavior.

Backup:

- Live `barback.html`, Git bundle/archive, sample redacted local outbox schema, and current live hash.

Rollback:

- Roll back to a known build only if it does not reintroduce silent truncation.
- Otherwise issue a forward hotfix or disable offline queueing with an explicit hard error.

Risk if delayed: queued live Event records can disappear without the barback or manager knowing.

Suggested branch and commit:

- Branch: `fix/p0-barback-outbox-durability-v1`
- Commit: `fix(barback): prevent silent outbox data loss`

### P0-04 - Untrusted Scale Bridge

- Finding ID: `P0-04`
- Recommended sequence: 5
- Affected surface: Barback Link realtime/HTTP bridge, deployed `barback-scale-bridge` Edge Function, scale-latest persistence
- Root cause: the public Realtime broadcast channel accepts client-controlled grams and `stable` values and feeds them directly into the usable latest-reading state.
- Production risk: Critical inventory-integrity risk
- Effort: Large
- Production change: Yes
- App Store blocker: Yes if scale remains available

Safest fix approach:

1. Immediate closure: stop accepting public Realtime broadcast payloads as usable weight.
2. Owner chooses one v1 mode:
   - scale disabled: remove/hide Bridge entry points and retain manual weight fallback;
   - restricted beta: use authenticated HTTPS publish/latest only;
   - public v1: authenticated server-owned transport with certified devices.
3. Preferred restricted/public transport:
   - Edge Function validates signed current Barback/station identity;
   - derives Venue/Night/staff/session from trusted claims;
   - validates assigned Bar/station/device;
   - enforces finite non-negative range, freshness TTL, monotonic sequence, and server timestamp;
   - computes or verifies stability server-side rather than trusting a client boolean;
   - stores one scoped latest record with RLS/service-only writes;
   - receiver obtains the value through authenticated HTTPS or a private authorized channel.
4. Recover and version the exact deployed `barback-scale-bridge` source before any Function deployment.
5. Do not use Production business Events for bridge tests.

Likely files:

- `barback.html`
- Recovered canonical `supabase/functions/barback-scale-bridge/index.ts`
- Shared JWT/authorization helpers if required
- Focused bridge security tests
- Optional forward migration only if scale-latest RLS/private-channel policy needs tightening

Likely Supabase objects:

- `public.barback_scale_latest`
- Existing RLS policies/grants on that table
- `barback-scale-bridge` Edge Function
- Optional Realtime authorization policies if private channels are selected

Suggested migration only if catalog changes are required:

- `supabase/migrations/20260729110000_secure_scale_bridge_transport.sql`
- matching dependency-safe rollback outside `supabase/migrations`

Tests:

- Anonymous publish/read rejected.
- Authenticated wrong Venue/Night/staff/session/device rejected.
- Forged `stable`, stale timestamp, repeated sequence, negative, zero when disallowed, non-finite, extreme, and malformed values rejected.
- Revoked/expired session rejected.
- A valid authorized station publishes and an authorized receiver reads only its scope.
- Stale readings cannot populate a usable Event field.
- Direct BLE and manual fallback remain separate.
- No client can overwrite another station's scope.

Manual QA:

- Two-device same Venue/Night flow.
- Wrong-night and revoked-session flow.
- Network loss, reconnect, stale reading, and station replacement.
- Confirm UI never enables Use Weight from an untrusted or stale payload.

Backup:

- Function inventory/source, scale-latest schema/data count, RLS/grants, live `barback.html`, and current endpoint response evidence.

Rollback:

- Maintain a server/client kill switch that disables Bridge use.
- Never roll back to public untrusted broadcast ingestion.
- If the secure bridge fails, fall back to manual entry or direct certified BLE only.

Risk if delayed: any party able to publish to the topic can inject an inventory-changing weight.

Suggested branch and commits:

- Branch: `fix/p0-scale-bridge-trust-v1`
- Commit: `fix(scale): reject untrusted realtime bridge weights`
- Function commit, if approved: `fix(scale): authorize and scope bridge transport`

## 8. Phase 3 - iOS Backend Configuration Hardening

### P0-06 - Unsigned dynamic backend configuration

- Finding ID: `P0-06`
- Recommended sequence: 6
- Affected surface: iOS/Admin app routing and persisted Supabase configuration
- Root cause: a `barinv://connect?cfg=...` deep link contains arbitrary URL/key JSON; a confirmation prompt is the only trust decision before persistence.
- Production risk: Critical account/data-redirection risk
- Effort: Medium
- Production change: Yes, iOS release
- App Store blocker: Yes

Safest fix approach:

1. Owner decides whether dynamic backend configuration is required.
2. Default public-v1 recommendation: remove/disable the configuration route and pin the approved Production project/host in the release build.
3. If enterprise dynamic configuration is required:
   - QR/deep link contains no raw key;
   - it carries a short-lived signed token;
   - token is exchanged through a pinned BARINV-controlled endpoint;
   - returned configuration is allowlisted and signature-verified;
   - project/host identity is shown clearly;
   - configuration changes require an authenticated administrator;
   - previous sessions/tokens are cleared only through an explicit approved migration flow.
4. Never print/store service-role credentials. An anon client key is not a password, but it must not authorize arbitrary backend redirection.

Likely files:

- iOS authoritative `www/index.html`
- Generated `ios/App/App/public/index.html` through the existing Capacitor copy workflow
- Existing route/deep-link tests or a new focused route test
- Optional `portal-token-exchange` Function only if signed exchange is chosen

Supabase objects:

- None if public-v1 route is removed and backend is pinned
- `portal-token-exchange` or a new narrowly scoped configuration exchange only if owner retains the feature

Tests:

- Raw `barinv://connect?cfg=` is rejected in public build.
- HTTP/HTTPS aliases and encoded variants cannot bypass the rejection.
- Existing portal token and Barback QR routes continue to work.
- Allowed Production configuration loads normally.
- Wrong host/project, expired token, bad signature, replay, malformed JSON, and oversized payload fail.
- No backend/key value is written before authorization.

Manual QA:

- Cold launch, authenticated launch, QR scan, universal/deep-link handling, and upgrade from existing installed state without clearing app data.
- Confirm no login/session regression.

Backup:

- iOS Git bundle/tree archive, current `www/index.html`, generated public asset, installed bundle hash, route behavior evidence.

Rollback:

- Use a new forward app build; do not re-release the unsigned route.
- If signed enterprise configuration fails, keep the pinned Production build as the safe fallback.

Risk if delayed: a crafted link can redirect user authentication and operational data to an attacker-controlled backend.

Suggested branch and commit:

- Branch: `fix/p0-ios-backend-config-v1`
- Commit: `fix(ios): restrict dynamic backend configuration`

## 9. Phase 4 - App Legal, Privacy, and Support Pages

### P0-07 - Missing app-specific legal/support URLs

- Finding ID: `P0-07`
- Recommended sequence: 7
- Affected surface: BARINV.ca, App Store metadata, in-app legal/support links
- Root cause: current live privacy/terms cover the marketing website and explicitly do not cover the operational app; no stable app support page is ready.
- Production risk: High compliance and App Review risk
- Effort: Medium
- Production change: Yes, website and App Store metadata
- App Store blocker: Yes

Safest fix approach:

1. Owner names the legal entity, support contact/SLA, governing jurisdiction, and final URLs.
2. Establish the canonical BARINV.ca source repository before editing/deploying.
3. Publish distinct stable pages, for example:
   - `https://barinv.ca/app/privacy`
   - `https://barinv.ca/app/terms`
   - `https://barinv.ca/support`
4. Privacy content must match actual use of:
   - account/staff/Venue/Night data;
   - Events and inventory data;
   - camera/scanner;
   - Bluetooth/scale data;
   - local storage/offline outbox;
   - Supabase/network processors;
   - retention, deletion, access, and support requests.
5. Terms must define account authority, event-night operational use, scale limitations, acceptable use, data ownership, support, and service availability.
6. Do not claim certified scale accuracy until P0-08 closes.
7. Add in-app links only after URLs are live and owner/legal-approved.

Likely files:

- Canonical BARINV.ca page source once identified
- BARINV.ca navigation/footer, sitemap, robots, metadata
- iOS in-app settings/about/support links if required
- App Store Connect metadata, handled only after separate approval

Supabase objects:

- None expected

Tests:

- HTTP 200, HTTPS, canonical URL, mobile rendering, accessibility, no broken links.
- Privacy/terms/support links from home and app surfaces.
- Sitemap inclusion and search metadata.
- Content review against actual Info.plist permissions and application behavior.

Manual QA:

- Legal/owner review.
- App Review URL access without authentication.
- Support email/form delivery test without exposing user data.

Backup:

- Current live website archive, headers, DNS/Cloudflare configuration inventory, source repository bundle, and rollback version ID.

Rollback:

- Revert website to the previous deployment while keeping a compliant emergency legal page available.
- Never replace app-specific terms/privacy with the marketing-only policy after submission.

Risk if delayed: App Review rejection and inaccurate public privacy disclosures.

Suggested branch and commit:

- Branch: `fix/p0-app-legal-support-v1`
- Commit: `docs(legal): add BARINV app privacy terms and support`

## 10. Phase 5 - Scale Certification or Feature-Gating Decision

### P0-08 - Arboleaf decoding and calibration accuracy

- Finding ID: `P0-08`
- Recommended sequence: 8
- Affected surface: iOS/Admin, Barback Link, Scale Lab, product claims, physical devices
- Root cause: high-range conversion and calibration behavior are based on insufficient captures, while Scale Lab documentation says the encoding remains unresolved.
- Production risk: Critical inventory-accuracy risk
- Effort: Large
- Production change: Yes if gating or decoder changes are required
- App Store blocker: Yes if scale is visible/supported

Safest fix approach:

1. Owner chooses:
   - include in App Store v1 after certification;
   - restricted beta with explicit device allowlist and warning;
   - disable/post-launch while retaining manual weight entry.
2. Default recommendation: disable Arboleaf/Bridge use in public v1 unless certification passes.
3. Certification protocol must define:
   - exact supported device model/firmware;
   - service/characteristic UUIDs and packet format;
   - at least three physical scales if supported broadly;
   - traceable reference weights across low and high ranges;
   - tare, zero, negative, unstable, disconnect, reconnect, timeout, wrong-device, and battery conditions;
   - raw packet, decoded grams, displayed grams, persisted grams, and resulting bottle percentage;
   - acceptance tolerance derived from manufacturer/spec and inventory requirements;
   - explicit 10x-low/10x-high rejection cases.
4. Use no Production business Events. Persist evidence in a clean, reproducible Scale Lab repository.
5. ESP32 remains post-launch/restricted beta by default and does not count as Arboleaf certification.
6. If certification fails or remains ambiguous, feature-gate all unsupported scale paths and update BARINV.ca/App Store claims.

Likely files:

- iOS `www/index.html` and generated public asset if gating/decoder changes are required
- Web `barback.html` if gating/decoder changes are required
- `/Users/saiedbeikhosseini/Documents/BARINV-Scale-Lab` tests, fixtures, captures, and protocol report
- Scale/rapid-return test files
- BARINV.ca feature claims

Supabase objects:

- None for direct BLE certification
- P0-04 objects if Bridge remains in supported scope

Tests:

- Automated captured-packet fixtures with expected grams.
- Cross-implementation web/iOS decoder parity.
- Bounds, checksum, packet length, negative, zero, unstable, 10x-low/high, stale, and reconnect cases.
- Known full/empty/net bottle calculations and partial return percentages.
- Manual fallback remains available and explicit.

Manual QA:

- Physical reference-weight matrix and known-bottle matrix.
- Supported iPhone/iPad/Android behavior.
- Independent second-person verification of recorded weights and acceptance results.

Backup:

- Preserve current Scale Lab dirty state, current decoders, raw captures, physical-device identifiers, and app/web builds.

Rollback:

- Feature flag/allowlist defaults to disabled.
- If a decoder regression appears, disable scale and use manual entry; do not roll back to an unverified decoder.

Risk if delayed: wrong weights or percentages can silently corrupt inventory and customer trust.

Suggested branches and commits:

- Scale Lab: `audit/p0-arboleaf-certification-v1`
- App/web gate: `fix/p0-scale-safety-gate-v1`
- Commit: `fix(scale): gate unverified scale decoding`
- Certification commit: `test(scale): certify supported Arboleaf decoding`

## 11. Phase 6 - iOS Release Governance

### P0-09 - Reproducible release branch, version, build, and tag

- Finding ID: `P0-09`
- Recommended sequence: 9
- Affected surface: iOS Git repository, Xcode version/build, release evidence, App Store process
- Root cause: current release candidate is on an untagged feature branch, `origin/main` is stale, and marketing/build versions remain `1.0/1`.
- Production risk: High release provenance and rollback risk
- Effort: Medium
- Production change: Yes, Git/iOS release process and eventual App Store build
- App Store blocker: Yes

Safest fix approach:

1. Do not start until P0-01 through P0-08 are verified closed.
2. Owner decides:
   - merge reviewed work to `main`; or
   - maintain a protected `release/ios-appstore-v1.0.0` branch with a documented relationship to `main`.
3. Require clean fast-forward/PR-based integration; no history rewrite or force push.
4. Increment marketing version/build to owner-approved values; never reuse an uploaded build number.
5. Produce one reproducible release candidate:
   - exact source commit;
   - dependency lockfiles;
   - Capacitor asset hash;
   - Xcode project/scheme/destination;
   - archive and dSYM hash;
   - privacy/legal URLs;
   - test matrix and backup path.
6. Create an annotated RC tag only after local/physical tests pass.
7. Create a stable tag only after TestFlight/App Review smoke gates pass.

Likely files:

- `ios/App/App.xcodeproj/project.pbxproj` for version/build
- Release checklist/report and manifests
- `www/` and `ios/App/App/public/` only through verified asset copy
- Privacy manifest/metadata files if separately approved under P1/App Store work

Supabase objects:

- None

Tests:

- Clean checkout reproduces asset and build hashes.
- JavaScript syntax, Capacitor copy, `git diff --check`, Xcode build, app launch.
- iPhone/iPad layout, login, Events, Barback routes, offline, scanner, scale-gated behavior.
- Installed bundle matches source commit and documented hash.
- No Production mutation during smoke test without explicit approval.

Manual QA:

- Owner signs off on release branch strategy, version/build, legal URLs, supported features, and test account.
- TestFlight rehearsal before public release.

Backup:

- Git bundle/all refs, tree archive, prior installed build, Xcode settings inventory, signed archive/dSYM when created, release manifest/checksums.

Rollback:

- Never move/delete published tags or rewrite history.
- Release a new higher build containing a forward fix.
- Keep the last verified stable build and source bundle.

Risk if delayed: the submitted binary cannot be traced, reproduced, or safely rolled back.

Suggested branch, commits, and tags:

- Branch: `release/ios-appstore-v1.0.0`
- Commit: `chore(ios): prepare App Store release version`
- RC tag: `barinv-ios-appstore-v1.0.0-rc1-20260729`
- Stable tag: `barinv-ios-appstore-v1.0.0-stable-<YYYYMMDD>`

## 12. Phase 7 - Final Retest and Release-Readiness Checkpoint

Required final gates:

1. Re-run all Event review, CSV, staff-scope, Barback, outbox, scale, rollback, lint, JavaScript, and iOS build tests.
2. Add adversarial role tests for every Event insert/update field and every privileged function.
3. Verify zero anonymous access to the three internal maintenance functions.
4. Verify no client can create a final-status Event outside an explicitly approved server RPC.
5. Verify no normal caller can alter protected submitted/final Event fields.
6. Verify Barback storage failure produces a visible non-success state with no record loss.
7. Verify Scale Bridge is disabled or authenticated/scoped and physically certified.
8. Verify arbitrary iOS backend redirection is impossible.
9. Verify app privacy, terms, and support URLs are live and match permissions/data flow.
10. Verify current Event counts/status counts/protected-field hash/audit hash reconcile before and after each database migration.
11. Verify all backups/checksums/restores and available disk capacity.
12. Re-run the full release-readiness audit and require P0 count `0`.

No App Store release proceeds if any final assertion fails.

## 13. What Can Be Fixed Together Safely

- P0-01 and P0-02:
  - one design branch;
  - one Event write-contract migration;
  - one isolated database harness cycle;
  - separate commits and acceptance sections are preferred.
- P0-04 and P0-08:
  - one owner scale-scope decision;
  - shared physical fixtures and kill-switch design;
  - implementation/deployment remains separate.
- P0-07 and P0-09:
  - legal URLs become inputs to App Store release metadata;
  - website deployment must complete before iOS release metadata freezes.

## 14. What Must Be Fixed Separately

- P0-03 uses its own migration and deployment approval.
- P0-05 is a standalone Barback web change and should not share a release with scale transport.
- P0-04 Edge Function/transport changes need a separate deployment gate from web UI.
- P0-06 is an iOS security change with separate build/TestFlight validation.
- P0-07 is a website/legal publication with owner/legal review.
- P0-08 physical certification is evidence-driven and must not be treated as a code-only fix.
- P0-09 is release governance and must occur only after all functional/security P0s close.

## 15. Owner Decisions Required Before Implementation

1. Scale scope: App Store v1, restricted beta, or disabled/post-launch?
2. ESP32 scope: default recommendation is post-launch/restricted beta only. Confirm.
3. Which Admin operational workflows, if any, may create immediately `APPROVED` Events?
4. May staff edit a submitted Event? If yes, which fields, statuses, time window, role, and audit rule?
5. Should dynamic iOS backend configuration exist at all?
6. What exact privacy, terms, and support URLs/legal entity/support contact should App Store use?
7. Which repository becomes the canonical BARINV.ca source?
8. Should iOS release work merge to protected `main` or use a protected release branch?

No implementation should infer these product/legal decisions.

## 16. Suggested Branches

| Scope | Suggested branch |
|---|---|
| P0-03 maintenance ACL | `fix/p0-backup-function-grants-v1` |
| P0-01/P0-02 Event contract | `fix/p0-events-write-contract-v1` |
| P0-05 Barback outbox | `fix/p0-barback-outbox-durability-v1` |
| P0-04 Scale Bridge | `fix/p0-scale-bridge-trust-v1` |
| P0-06 iOS configuration | `fix/p0-ios-backend-config-v1` |
| P0-07 BARINV.ca legal/support | `fix/p0-app-legal-support-v1` |
| P0-08 Scale certification | `audit/p0-arboleaf-certification-v1` |
| P0-08 public feature gate | `fix/p0-scale-safety-gate-v1` |
| P0-09 iOS release | `release/ios-appstore-v1.0.0` |

Create branches only after verifying clean starting state and approved base commits. Do not mix repositories in one commit.

## 17. Suggested Commit Messages

- `fix(db): restrict privileged backup maintenance functions`
- `fix(events): protect submitted event fields`
- `fix(events): enforce pending insert contract`
- `test(events): cover adversarial event write authorization`
- `fix(barback): prevent silent outbox data loss`
- `fix(scale): reject untrusted realtime bridge weights`
- `fix(scale): authorize and scope bridge transport`
- `fix(ios): restrict dynamic backend configuration`
- `docs(legal): add BARINV app privacy terms and support`
- `fix(scale): gate unverified scale decoding`
- `test(scale): certify supported Arboleaf decoding`
- `chore(ios): prepare App Store release version`

Each commit should be independently reviewable and contain only one safety contract or its focused tests.

## 18. Suggested Migrations and Rollbacks

| Purpose | Forward migration | Rollback location |
|---|---|---|
| P0-01/P0-02 Event write contract | `supabase/migrations/20260729100000_close_event_write_contract.sql` | `supabase/rollbacks/20260729100000_close_event_write_contract_ROLLBACK.sql` |
| P0-03 maintenance function ACL | `supabase/migrations/20260729103000_lock_down_backup_maintenance_functions.sql` | `supabase/rollbacks/20260729103000_lock_down_backup_maintenance_functions_ROLLBACK.sql` |
| P0-04 scale transport, only if catalog changes are required | `supabase/migrations/20260729110000_secure_scale_bridge_transport.sql` | `supabase/rollbacks/20260729110000_secure_scale_bridge_transport_ROLLBACK.sql` |

Rules:

- Do not modify historical migrations.
- Rollbacks stay outside `supabase/migrations`.
- Compile/apply/rollback-test only in the disposable isolated harness first.
- Production rollback is never automatic.
- Security rollbacks must not restore anonymous grants or broad Event write access; use a forward corrective migration.

## 19. Required Production Verification After Approval

For database releases:

- linked project reference exactly matches the approved project;
- migration history has no drift and dry run lists only approved migrations;
- complete pre-release backup passes;
- before/after Event total, status counts, protected-field hash, and audit hash reconcile;
- new triggers/functions/policies/grants/search paths exist;
- anonymous/authenticated negative probes fail;
- existing review/CSV/auto-approve contracts remain available;
- no business Event is created or modified for testing.

For web/Function releases:

- deploy only approved files/functions;
- source commit/hash matches deployed content;
- unauthorized endpoints remain unauthorized;
- outbox/bridge behavior is tested with isolated fixtures;
- live HTTP/DOM markers and browser errors are checked;
- no secret/env change unless separately approved.

For iOS:

- exact source/generated/built/installed hashes reconcile;
- signing settings are unchanged unless separately approved;
- no app data/Keychain clear without approval;
- dynamic config attacks fail;
- legal/support links resolve;
- feature-gated scale state is visible and accurate;
- release commit/version/build/tag/archive are traceable.

## 20. Final Definition of Done

All P0s are closed only when:

- P0 count in a fresh audit is zero.
- Anonymous users cannot execute privileged backup/prune internals.
- Normal staff cannot mutate protected fields on submitted/final Events.
- Client/scoped staff cannot insert final-status Events.
- Legitimate Barback PENDING and server auto-approval behavior still pass.
- Every successful review transition remains exactly-once audited.
- Outbox persistence failure never loses or falsely reports a queued Event.
- Scale Bridge accepts no untrusted/stale/cross-scope weight.
- Arboleaf scale is physically certified for declared devices or disabled/gated.
- iOS cannot be redirected to an arbitrary backend.
- App-specific privacy, terms, and support URLs are live and owner-approved.
- The iOS candidate has an approved branch strategy, unique version/build, reproducible archive evidence, and annotated checkpoint tag.
- All local, isolated database, physical-device, rollback, backup, and Production-safe verification gates pass.
- No unresolved P0 owner decision remains.

## 21. Approval Gates

Recommended next approval sequence:

1. Owner answers the eight decision points.
2. Approve Phase 0 backup/freeze only.
3. Approve local P0-03 implementation and isolated tests.
4. Approve local P0-01/P0-02 implementation and isolated tests.
5. Review database gate evidence before any Production migration.
6. Approve each remaining web, Function, iOS, website, and scale phase independently.
7. Approve final release governance only after a fresh zero-P0 audit.

No implementation, commit, push, migration, Function deployment, website deployment, iOS build/release, or tag is authorized by this planning document.
