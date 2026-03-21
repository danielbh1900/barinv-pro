# BUILD-START-v3.md — BARINV Pro Execution Plan

**Purpose:** This file is the authoritative execution handoff for rebuilding BARINV as a production-grade hospitality operations platform.

Use this file when:
- starting the new codebase in Cursor or VS Code,
- opening a fresh AI coding assistant thread for implementation,
- creating GitHub milestones and issues,
- briefing a developer or small team,
- aligning architecture before writing code.

**Do not treat this as product history.** This is the current build plan.

---

## 1) Build Goal

Rebuild BARINV from a single-file PWA into a **production-grade, multi-venue, offline-capable hospitality operations platform**.

The rebuilt system must support:
- real role-based access,
- multi-venue organization structure,
- cloud-backed warehouse and inventory,
- offline-safe shift workflows,
- auditable stock and finance actions,
- reporting and purchasing workflows,
- mobile-first day-to-day operations,
- commercial-grade maintainability.

---

## 2) Target Stack

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- TanStack Query (+ devtools in dev)
- React Hook Form
- Zod
- vite-plugin-pwa (Workbox)

### Backend / Platform
- Supabase Postgres
- Supabase Auth
- Supabase Realtime
- Supabase Storage
- Supabase Edge Functions
- Row Level Security (RLS)

### Deployment / Tooling
- GitHub
- GitHub Actions (CI/CD)
- Vercel (preferred over Netlify for edge function proximity and Vite compatibility)
- Supabase CLI + SQL migrations
- ESLint + Prettier
- Vitest
- Playwright
- Sentry

### Storage / Client Utilities
- IndexedDB via `idb`
- Local offline queue utilities
- Service worker via Workbox (vite-plugin-pwa)
- Feature flags: env-based (build-time gates) + DB table (runtime toggles)

---

## 3) Product Scope to Preserve

Preserve and professionalize these BARINV areas:
- Dashboard
- Submit Event
- Events Log
- My History
- Nights
- Placements
- Inventory Clicker
- Warehouse
- Par Levels
- Variance Report
- Analytics
- Cost Center
- Reports
- Suppliers
- Purchase Orders
- Invoices
- Recipes
- Guestlist
- Setup / Business Settings

---

## 4) Non-Negotiable Product Rules

1. Mobile-first for iPhone/iPad use on shift.
2. Core write actions must work offline.
3. Every business record must be scoped correctly.
4. Warehouse cannot remain local-only.
5. Permissions must be enforced in the database, not only hidden in the UI.
6. Every critical inventory/finance action must be auditable.
7. The app must be structured for commercial scale.
8. Inventory and finance history must be reconstructable from durable records.
9. Observability is required early, not added at the end.
10. No module is "done" unless auth, scope, audit, and failure states are handled.
11. Staging environment must exist before any Phase 2 work begins.
12. All timestamps stored in UTC. Display is converted per venue timezone.

---

## 5) Engineering Priorities

When tradeoffs appear, prefer this order:
1. correctness,
2. data integrity,
3. permission safety,
4. offline reliability,
5. maintainability,
6. mobile usability,
7. speed of delivery,
8. visual polish.

Do not optimize for cleverness.

---

## 6) Repo Plan

### Repository name
`barinv-pro`

### Branch strategy
- `main` → production-ready branch
- `staging` → staging environment branch (auto-deploys to staging Vercel + Supabase)
- `develop` → integration branch
- `feature/<name>` → feature work
- `fix/<name>` → bugfixes

### Root structure
```text
barinv-pro/
  .github/
    workflows/
      ci.yml          ← lint, typecheck, unit tests on every PR
      deploy-staging.yml   ← auto-deploy on merge to staging
      deploy-prod.yml      ← auto-deploy on merge to main
  public/
    manifest.webmanifest
    icons/
    robots.txt
  src/
    app/
      router/
      providers/
      layouts/
    components/
      ui/
      forms/
      tables/
      charts/
      feedback/
      pwa/
    features/
      auth/
      dashboard/
      operations/
      nights/
      placements/
      inventory/
      warehouse/
      reports/
      analytics/
      variance/
      purchasing/       ← contains suppliers, purchase-orders, invoices sub-features
      recipes/
      guestlist/        ← contains promoters, door, ticket-classes sub-features
      setup/
      settings/
      venues/
      staff/
    lib/
      supabase/
      query/
      offline/
      permissions/
      audit/
      monitoring/
      edge-functions/
      feature-flags/
      utils/
      validation/
    hooks/
    pages/
    styles/
    types/
    sw.ts             ← service worker entrypoint (Workbox)
    main.tsx
  supabase/
    migrations/
    seeds/
    policies/
    functions/        ← Edge Functions (each in own folder per Supabase CLI convention)
  docs/
    architecture/
    product/
    sql/
    adr/              ← Architecture Decision Records
    guestlist-spec/   ← detailed guestlist/promoter product spec
  tests/
    unit/
    integration/
    e2e/
    rls/              ← dedicated RLS test suite
    migrations/       ← migration smoke tests
  .env.example
  .env.local          ← never committed
  package.json
  tsconfig.json
  vite.config.ts
  README.md
```

### ADR topics required
Create a short ADR for every major architectural decision, including:
- offline sync strategy and queue model,
- service worker caching strategy,
- permissions model and role hierarchy,
- warehouse movement event model,
- cost history snapshot model,
- venue selection and timezone behavior,
- feature-flag strategy (build-time vs runtime),
- Edge Functions usage policy (what belongs server-side vs client-side),
- CI/CD pipeline and environment promotion strategy,
- legacy BARINV data migration approach,
- audit log retention and access policy.

---

## 7) Local Bootstrap

### Step 1 — Project scaffold
```bash
npm create vite@latest barinv-pro -- --template react-ts
cd barinv-pro
npm install
```

### Step 2 — Core dependencies
```bash
npm install react-router-dom @tanstack/react-query @tanstack/react-query-devtools
npm install react-hook-form zod @hookform/resolvers
npm install @supabase/supabase-js idb date-fns lucide-react recharts
```

### Step 3 — PWA and service worker
```bash
npm install -D vite-plugin-pwa workbox-window
```

### Step 4 — Dev tooling
```bash
npm install -D tailwindcss postcss autoprefixer
npm install -D eslint prettier eslint-config-prettier
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
npm install -D @playwright/test
npx tailwindcss init -p
```

### Step 5 — Supabase CLI (for migrations and local dev)
```bash
npm install -D supabase
npx supabase init
npx supabase login
```

### Step 6 — Add later as needed
```bash
npm install html5-qrcode               # barcode scanning
npm install @sentry/react              # error monitoring
npm install -D @sentry/vite-plugin     # source map upload
```

---

## 8) Environment Variables

### `.env.local` (development)
```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_APP_NAME=BARINV Pro
VITE_APP_ENV=development
VITE_APP_VERSION=0.1.0
VITE_ENABLE_SENTRY=false
VITE_SENTRY_DSN=
VITE_SYNC_RETRY_LIMIT=5
VITE_SYNC_STALE_MINUTES=15

# Build-time feature gates (true = feature is compiled in; false = excluded entirely)
# Runtime on/off toggling is handled via the feature_flags DB table, not these vars.
VITE_FEATURE_OFFLINE=true
VITE_FEATURE_GUESTLIST=true
VITE_FEATURE_PURCHASING=true
VITE_FEATURE_RECIPES=true
```

### `.env.staging`
```env
VITE_APP_ENV=staging
VITE_ENABLE_SENTRY=true
# All other vars same as production but pointing to staging Supabase project
```

### `.env.production`
```env
VITE_APP_ENV=production
VITE_ENABLE_SENTRY=true
```

### Important rules
- `VITE_DEFAULT_TIMEZONE` does **not** exist. Timezone is stored per venue in the `venues` table and applied at display time. Never hardcode a timezone assumption globally.
- Feature flags in env are **build-time gates** — they control whether a feature is bundled at all. Runtime enable/disable per organization is handled via the `feature_flags` DB table (see Section 11).
- Never commit `.env.local`. Only `.env.example` is committed.
- Sentry source maps require `VITE_APP_VERSION` to correlate releases. Bump this on every production deploy.

---

## 9) Route Map

```text
/
/login
/select-venue

/dashboard

/operations/submit-event
/operations/events
/operations/my-history
/operations/nights
/operations/placements

/inventory/clicker
/inventory/par-levels
/inventory/transfers
/inventory/waste
/inventory/variance

/warehouse
/warehouse/stock
/warehouse/movements
/warehouse/adjustments
/warehouse/snapshots
/warehouse/count-sessions
/warehouse/count-sessions/:id

/reports
/reports/analytics
/reports/cost-center
/reports/management-summary
/reports/export-center

/purchasing
/purchasing/suppliers
/purchasing/suppliers/:id
/purchasing/purchase-orders
/purchasing/purchase-orders/:id
/purchasing/invoices
/purchasing/invoices/:id
/purchasing/reorder

/recipes
/recipes/:id

/guestlist
/guestlist/promoters
/guestlist/promoters/:id
/guestlist/door
/guestlist/ticket-classes

/setup/venues
/setup/bars
/setup/stations
/setup/items
/setup/staff
/setup/roles
/setup/units

/settings/business
/settings/terminology
/settings/devices
/settings/feature-flags
/settings/profile
/settings/diagnostics
/settings/diagnostics/sync-conflicts
/settings/diagnostics/audit-log
```

### Route guard layers (applied in this order)
1. **Unauthenticated only** — `/login` redirects away if already authenticated
2. **Authenticated** — all other routes redirect to `/login` if no session
3. **Venue-selected** — operational routes redirect to `/select-venue` if no active venue
4. **Org-level only** — `/setup/venues`, `/setup/roles`, org settings: no venue selection required; visible to Owner/Admin only
5. **Role-restricted** — specific routes gated by role (see Permission Model)
6. **Feature-flag restricted** — routes for purchasing, guestlist, recipes check both env build gate and DB feature flag

### Note on `/warehouse`
The `/warehouse` root renders a summary dashboard (stock levels overview, recent movements, alerts). It is not a blank redirect.

---

## 10) Architecture Contracts

### A. Scope contract
- Every business-owned row must include `organization_id`.
- Every venue-specific row must include `venue_id`.
- UI must never be the only barrier for authorization.
- Every server-side write must be attributable to a user or service context.

### B. Inventory contract
- Inventory history is event-based, not balance-only.
- Balances may be cached or materialized, but the ledger is the source of truth.
- Cost history must be snapshotted; it must not be silently rewritten.
- Warehouse actions, transfers, counts, waste, and event consumption must all be traceable.

### C. Offline contract
- Offline writes must carry a stable client-generated operation ID (UUID v4).
- Replays must be idempotent.
- Duplicate submits must be rejected safely (unique constraint on `client_operation_id`).
- Queue state must be visible to users.
- Conflict policy must be explicit per action type.
- IndexedDB failure (quota exceeded, browser policy) must surface as a visible error, not silent data loss.

### D. Audit contract
- Critical mutations must record actor, action, target, before/after shape, scope, and timestamp.
- Sensitive actions must support reason/note capture where appropriate.
- Exports and settings changes are auditable actions.
- Audit entries are immutable — no update or delete on `audit_log` rows.

### E. Observability contract
- Client errors, sync failures, and auth/scope failures must be traceable via Sentry.
- Diagnostics must exist before broad rollout.
- Every Edge Function must emit structured logs.

### F. Service Worker contract
- The service worker is managed via Workbox (vite-plugin-pwa). No custom service worker logic without documented reason.
- Cached for offline: app shell, static assets, Tailwind CSS, core fonts.
- Network-first (with cache fallback): all Supabase API calls. Never serve stale API responses silently.
- Not cached: auth endpoints, audit writes, any destructive mutations.
- On service worker update: show a non-blocking "Update available — reload to apply" banner. Do not force-reload.
- Service worker must be disabled in development mode (vite-plugin-pwa `devOptions.enabled: false`).

### G. CI/CD contract
- Every PR triggers: lint, typecheck (`tsc --noEmit`), unit tests (Vitest), RLS tests.
- Merge to `staging` → auto-deploy to staging Vercel + staging Supabase project.
- Merge to `main` → auto-deploy to production. Requires passing staging deploy.
- Migrations run automatically via `supabase db push` in CI before each deploy.
- No manual deploys to production. All production changes go through `staging` first.
- Sentry release created on each production deploy with version and source maps.

### H. Timezone contract
- All timestamps are stored in UTC in the database. This is non-negotiable.
- Each `venues` row has a `timezone` field (IANA timezone string, e.g. `America/Vancouver`).
- Display-layer timezone conversion uses `date-fns-tz` keyed from the active venue's timezone.
- No global timezone constant. No hardcoded timezone in env vars.
- "Night" date boundaries (e.g. when does a shift end) are calculated relative to venue timezone, not UTC midnight.

### I. Legacy migration contract
- The existing BARINV Supabase instance (Theater and Harbour data) must not be touched during the rebuild.
- A separate migration script will be written in Phase 0 to map old schema → new schema.
- Migration is a one-time import, not a live sync.
- All imported rows must have `migrated_from_legacy: true` flag for traceability.
- Migration must be dry-run tested before touching any production data.
- Legacy system remains live until new system is fully validated in staging with real data.

---

## 11) Core Data Model (v2 Starter)

### Organization and access
- `organizations`
- `venues` — includes `timezone` (IANA string), `settings` (jsonb)
- `profiles`
- `venue_users`
- `role_permissions`
- `organization_settings`
- `feature_flags` — runtime feature toggles per organization (overrides build-time env gates)

### Operations
- `nights`
- `placements`
- `events`
- `activity_log`

### Inventory and warehouse
- `units`
- `items`
- `item_uom_conversions`
- `bars`
- `stations`
- `warehouse_stock`
- `stock_movements`
- `stock_transfers`
- `stock_adjustments`
- `inventory_snapshots`
- `count_sessions`
- `count_entries`
- `par_rules`
- `waste_log`

### Finance and purchasing
- `suppliers`
- `supplier_contacts`
- `purchase_orders`
- `po_items`
- `invoices`
- `invoice_items`
- `reorder_rules`
- `cost_snapshots`

### Recipes
- `recipes`
- `recipe_ingredients`

### Guest and promoter
- `guestlist_entries`
- `promoters`
- `promoter_guest_entries`
- `door_checkins`
- `ticket_classes`
- `guestlist_nights` — links a guestlist to a specific night

### Offline and devices
- `device_sessions`
- `offline_queue_status`
- `sync_conflicts`
- `client_operations`

### Audit
- `audit_log` — immutable, append-only

### Attachments
- `attachments`

---

## 12) Data Modeling Rules

1. Every business-owned row must include `organization_id`.
2. Venue-specific rows must include `venue_id`.
3. Every critical table must include `created_by uuid` and `updated_by uuid` (FK to `profiles`). This is a requirement, not a suggestion.
4. Soft-deleted rows must use `deleted_at timestamptz` and `deleted_by uuid`. Hard deletes are not permitted on any record with audit or financial significance.
5. All timestamps must be stored in UTC (`timestamptz`). Never store local time.
6. Use UUID primary keys (`uuid` type, default `gen_random_uuid()`) consistently.
7. Inventory movement must be event-based, not only balance-based.
8. Historical cost integrity matters — use `cost_snapshots` to freeze cost at point-in-time. Do not silently rewrite cost history.
9. Use immutable movement rows for stock history. Never update a stock movement; insert a correction instead.
10. Use snapshot tables when historical reporting must remain stable even if master data changes later.
11. Units of measure must be explicit; do not rely on implied bottle/case/item assumptions.
12. Count sessions must separate the session header (`count_sessions`) from individual lines (`count_entries`).
13. Every offline-created business row must be linkable back to its `client_operations` record via `client_operation_id`.
14. `guestlist` is renamed to `guestlist_entries` to avoid SQL reserved word conflicts.

---

## 13) Permission Model

### Roles (in descending authority)
- **Owner** — full access to all org data, billing, and irreversible actions
- **Admin** — full operational access; cannot access billing or delete org
- **Co-Admin** — same as Admin except cannot manage Admin/Owner roles
- **Manager** — venue-scoped; can approve events, manage stock, view finance reports; cannot change roles
- **Finance** — read-only on all financial data; can approve invoices; cannot touch stock operations
- **Bartender** — can submit events, use inventory clicker, view own history
- **Barback** — same as Bartender with reduced scope (no cost visibility)
- **Door** — can access guestlist and door checkin only
- **Promoter** — can manage own guest entries only; no operational data access

### Role capability matrix

| Action | Owner | Admin | Co-Admin | Manager | Finance | Bartender | Barback | Door | Promoter |
|--------|-------|-------|----------|---------|---------|-----------|---------|------|----------|
| Submit Event | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — |
| Approve/Reject Event | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| View Events Log | ✅ | ✅ | ✅ | ✅ | — | own | — | — | — |
| Inventory Clicker | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — |
| Warehouse read | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| Warehouse write | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| Stock adjustment | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| View cost data | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Approve invoice | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| Manage suppliers/POs | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| View reports | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Export data | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Manage staff/roles | ✅ | ✅ | ✅* | — | — | — | — | — | — |
| Manage setup (items/bars) | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Change par levels | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| Guestlist read | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ | own |
| Guestlist write | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ | own |
| Conflict resolution | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| View audit log | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Manage feature flags | ✅ | ✅ | — | — | — | — | — | — | — |
| Delete org / billing | ✅ | — | — | — | — | — | — | — | — |

*Co-Admin cannot promote to Admin or Owner.

### Principles
- Role checks happen in both UI (RoleGate component) and RLS. UI-only gating is not acceptable.
- Venue-scoped users (Manager and below) only see data for their assigned venue.
- Bartenders can optionally be restricted to a specific station.
- Destructive actions (delete, adjustment, override) require a stricter role than reads or creates.
- Finance role is read-only on operations — it cannot create or modify stock records.
- Door and Promoter roles have no visibility into inventory, costs, or operational data whatsoever.

### Sensitive actions requiring audit record
- stock adjustment
- event approval / rejection
- invoice approval
- item cost change
- recipe change affecting cost
- par level change
- role change (any)
- settings change (any)
- feature flag change
- export action (any)
- offline conflict override
- manual sync retry / force sync
- data import / migration action
- user deactivation

---

## 14) RLS Checklist

Enable RLS on all business tables. No exceptions.

Every policy set must consider:
- authenticated user identity (via `auth.uid()`),
- organization membership,
- venue scope,
- role capability,
- read vs insert vs update vs delete **separately** (do not combine into one permissive policy).

### All tables requiring RLS
- `organizations`, `venues`, `organization_settings`
- `profiles`, `venue_users`, `role_permissions`
- `feature_flags`
- `items`, `units`, `item_uom_conversions`, `bars`, `stations`
- `nights`, `placements`, `events`, `activity_log`
- `warehouse_stock`, `stock_movements`, `stock_transfers`, `stock_adjustments`
- `inventory_snapshots`, `count_sessions`, `count_entries`
- `par_rules`, `waste_log`
- `suppliers`, `supplier_contacts`, `purchase_orders`, `po_items`
- `invoices`, `invoice_items`, `reorder_rules`, `cost_snapshots`
- `recipes`, `recipe_ingredients`
- `guestlist_entries`, `promoters`, `promoter_guest_entries`, `door_checkins`, `ticket_classes`, `guestlist_nights`
- `device_sessions`, `offline_queue_status`, `sync_conflicts`, `client_operations`
- `audit_log`
- `attachments`

### RLS rules
- `audit_log` is append-only: INSERT allowed for authenticated users with valid org scope; UPDATE and DELETE are never permitted.
- `feature_flags` is read-only for all roles except Owner/Admin.
- `sync_conflicts` is readable and resolvable only by Manager and above.
- No row from organization A must ever be visible to a user from organization B. Test this explicitly.

### RLS implementation rule
Schema and RLS must exist and be tested before any UI work begins. This is an absolute rule.

---

## 15) Service Worker / PWA Architecture

### Library
`vite-plugin-pwa` with Workbox. Configuration lives in `vite.config.ts`.

### PWA manifest
- `name`: BARINV Pro
- `short_name`: BARINV
- `display`: `standalone`
- `orientation`: `portrait` (primary) — landscape supported but not optimized
- `theme_color` and `background_color`: match brand tokens
- Icons: 192×192 and 512×512 minimum; maskable icon required for Android home screen

### Caching strategy (Workbox)

| Asset type | Strategy | Notes |
|------------|----------|-------|
| App shell (HTML, JS, CSS) | Cache-first (versioned) | Busted on each deploy via Vite content hash |
| Static assets (icons, fonts) | Cache-first (long TTL) | |
| Supabase API calls | Network-first, cache fallback | Fallback only for GET requests on read data |
| Auth endpoints | Network-only | Never cache |
| Audit writes, mutations | Network-only | Never cache |
| Images (attachments) | Stale-while-revalidate | |

### Update behavior
- On new service worker detected: show `SyncStatusBanner` with "Update available — tap to reload".
- Do not force-reload automatically. User controls when to apply the update.
- In development: service worker is disabled (`devOptions.enabled: false`). Do not test service worker in dev mode.

### Install prompt
- Show a custom `PWAInstallPrompt` component on first visit (mobile only).
- Do not show the native browser prompt directly.
- Track install state in localStorage key `pwa_install_dismissed`.

### Offline behavior for non-offline routes
- If user navigates to a route that requires live data while offline, show `OfflineIndicator` with a clear message and a list of what is/isn't available offline.
- Do not show a broken or empty UI. Always explain the offline state.

---

## 16) Offline Architecture

### Must work offline
- Submit Event
- Inventory Clicker draft actions
- Simple warehouse movement capture (if enabled for role)

### Required client behavior
- IndexedDB queue for writes (via `idb` library)
- Local status per record: `pending` | `synced` | `failed` | `conflict` | `blocked`
- Visible last sync time in `SyncStatusBanner`
- Visible queue count (pending + failed)
- Retry controls for Manager and above
- Conflict review screen for Manager and above
- Local draft persistence for interrupted forms
- IndexedDB quota/failure handling: if IndexedDB is unavailable or quota exceeded, surface a visible error immediately. Never silently drop offline writes.

### Required sync behavior
- Each queued write gets a client operation UUID (v4) generated client-side
- Writes are retried using idempotency (server rejects duplicate `client_operation_id` with 409)
- Duplicate taps / double submits must not create duplicate rows
- Retry backoff: exponential starting at 5s, max 5 attempts, cap at 5 minutes. After 5 failures, status becomes `failed` and surfaces in diagnostics.
- Permanently failed operations must surface clearly in `QueueStatusTable`
- Stale pending operations (pending > `VITE_SYNC_STALE_MINUTES` minutes) must trigger a Sentry warning

### Conflict policy
Rules defined per action type. Never auto-resolve without explicit logic:

- **Submit Event:** reject true duplicates (same `client_operation_id`). Allow explicit retry by same operation ID if server never received it.
- **Inventory Clicker draft lines:** last local edit wins until first sync. After sync, if server version changed materially, create a `sync_conflicts` record and require Manager review.
- **Warehouse movements:** never silently merge if quantity basis changed. Always create a conflict record for Manager review.
- **Counts / adjustments:** never auto-merge numeric conflicts under any condition. Require explicit privileged resolution.

### Conflict resolution UX

Design this screen before building the sync engine. The schema must support it.

**Who sees it:** Manager and above. Bartenders/Barbacks see "sync issue — contact manager."

**Location:** `/settings/diagnostics/sync-conflicts` + badge count in `SyncStatusBanner`.

**Conflict card must display:**
- Action type (e.g. "Warehouse adjustment — Hendricks 750ml")
- Venue and station scope
- Local submitted value + timestamp + device name
- Current server value + timestamp + last actor
- Difference highlighted (e.g. "−3 vs −5 bottles")
- Reason note if captured at submission
- Client operation ID (collapsed, available for support copy)

**Required actions per card:**
- **Accept mine** — local value overwrites server; audit record written with `source: admin_override`
- **Accept server** — local write discarded; audit record notes discard and actor
- **Defer** — card stays open; stale conflicts (>24h unresolved) escalate to warning state

**Conflict card must never:**
- Auto-resolve numeric conflicts silently
- Allow bulk "accept all mine" without per-item confirmation
- Disappear without producing an audit record

**`sync_conflicts` table shape:**
- `id`, `organization_id`, `venue_id`
- `client_operation_id` (FK → `client_operations`)
- `action_type`
- `target_table`, `target_id`
- `local_value` (jsonb), `local_submitted_at`, `local_device_id`
- `server_value` (jsonb), `server_updated_at`, `server_updated_by`
- `status`: `open` | `resolved_local` | `resolved_server` | `deferred`
- `resolved_by`, `resolved_at`, `resolution_note`
- `created_at`

---

## 17) Audit Architecture

### Standard audit event shape
Every critical audit record must capture:
- `id` (uuid)
- `organization_id`
- `venue_id` (if relevant)
- `actor_user_id`
- `action_type` (enum — defined list of allowed action strings)
- `target_table`
- `target_id`
- `before_state` (jsonb — when appropriate)
- `after_state` (jsonb — when appropriate)
- `reason_note` (text — optional but supported)
- `source`: `ui` | `sync` | `system` | `admin_override` | `migration`
- `client_operation_id` (if applicable)
- `session_id` (to correlate actions within one user session)
- `user_agent` (for security-sensitive actions: role changes, exports, overrides)
- `ip_address` (populated server-side via Edge Function where possible)
- `created_at` (timestamptz UTC)

### Audit rules
- Audit log is append-only. RLS must block UPDATE and DELETE on `audit_log`.
- Audit must be structured, not free-form only. `action_type` must be an enum.
- Sensitive actions must produce consistent audit shapes.
- Audit entries must be readable in support/debug workflows.
- Export actions must include export type, scope (venue, date range), and row count.
- Role changes must always record before and after role.
- Settings changes must always record before and after value.
- Migration actions must be tagged with `source: migration`.
- Retention policy: audit records are kept indefinitely by default. If storage cost becomes a concern, define a retention policy in an ADR before purging anything.

### Audit helper
A shared `lib/audit/log.ts` helper must wrap all audit writes. Direct inserts to `audit_log` outside of this helper are not permitted except in Edge Functions, which have their own wrapper.

---

## 18) Edge Functions

### Why Edge Functions
Some logic must not run client-side because:
- it requires service-role Supabase access (bypassing RLS for admin operations),
- it involves secret keys (e.g. future POS integrations),
- it performs calculations that must be authoritative and tamper-proof (e.g. variance calculations used for financial reporting),
- it writes to `audit_log` with server-enriched fields (`ip_address`, verified `user_agent`).

### Required Edge Functions (planned)
| Function | Purpose |
|----------|---------|
| `write-audit-event` | Accepts audit payloads from client; enriches with IP + user agent; writes to audit_log |
| `resolve-sync-conflict` | Validates and applies conflict resolution; writes audit trail |
| `calculate-variance` | Authoritative variance calculation for reporting |
| `generate-cost-snapshot` | Freezes cost history at point-in-time |
| `process-offline-queue` | Server-side idempotent batch write handler |
| `export-data` | Authoritative export with audit record; returns signed download URL |

### Edge Function rules
- Every Edge Function must validate the caller's JWT and extract `organization_id` from it.
- Every Edge Function must emit structured logs.
- Edge Functions are not a general-purpose API layer. Only use them where client-side execution is inadequate.
- Each function lives in `supabase/functions/<function-name>/index.ts`.

---

## 19) Feature Flags

### Two-layer model

**Layer 1 — Build-time env gates** (`VITE_FEATURE_*`)
- Controlled in `.env.*` files.
- Compiled into the bundle. If `false`, the feature's code is tree-shaken out entirely.
- Used for: major features not ready for any deployment (guestlist, purchasing, recipes in early phases).
- Changing requires a new deploy.

**Layer 2 — Runtime DB flags** (`feature_flags` table)
- Controlled per `organization_id` via `/settings/feature-flags` (Owner/Admin only).
- Read at app boot and stored in React context.
- Used for: toggling features on/off per client without a deploy.
- Only takes effect if the build-time env gate is also `true`.

### `feature_flags` table shape
- `id`, `organization_id`, `feature_key` (text), `enabled` (bool), `updated_by`, `updated_at`
- Unique constraint on `(organization_id, feature_key)`
- RLS: read by any authenticated org member; write by Owner/Admin only

### Feature gate check (client)
```typescript
// lib/feature-flags/useFeatureFlag.ts
useFeatureFlag('guestlist')
// returns true only if VITE_FEATURE_GUESTLIST=true AND org flag is enabled
```

### Defined feature keys
- `guestlist`
- `purchasing`
- `recipes`
- `advanced_analytics`
- `offline_sync`
- `multi_venue`

---

## 20) Timezone Strategy

### Core rule
All timestamps in the database are UTC. There are no exceptions.

### Per-venue timezone
Each `venues` row has:
- `timezone` (text, IANA format, e.g. `America/Vancouver`) — required, not nullable
- Validated on insert/update against the IANA timezone database

### Display conversion
- Use `date-fns-tz` for all timezone-aware display formatting.
- Active venue timezone is available via `useVenueTimezone()` hook.
- Never use `new Date().toLocaleString()` with a hardcoded timezone anywhere in the codebase.

### "Night" boundary logic
- A "night" belongs to the date on which it **starts** in the venue's local timezone.
- Night boundary is `04:00 local time` (configurable per venue in `organization_settings`).
- E.g. a night starting 2024-03-01 21:00 Vancouver and ending 2024-03-02 03:00 Vancouver belongs to night date `2024-03-01`.

### Multi-timezone future proofing
- If a second venue is added in a different timezone, no code changes are required.
- All timezone logic is keyed from the venue record, not from any global constant.

---

## 21) Legacy Data Migration Strategy

### Principle
The existing BARINV Supabase instance (Theater and Harbour) is the source of truth for historical data. It must not be modified during the migration.

### Approach
1. **Audit the old schema** — document every table, column, and relationship in the existing Supabase project before writing any migration code.
2. **Write a mapping document** (`docs/sql/legacy-migration-map.md`) — old column → new column, data type changes, dropped fields, new required fields.
3. **Write the migration script** — a standalone TypeScript script (not part of the app) that reads from the old Supabase project and inserts into the new one. Tag all migrated rows with `migrated_from_legacy: true`.
4. **Dry-run in staging** — run the migration script against the staging Supabase project first. Verify row counts, spot-check data, run RLS tests against migrated data.
5. **Zero-downtime cut-over** — old system stays live until new system is validated. Migration is a one-time import. No live sync between old and new.

### What must be migrated
- All existing venues (mapped to org + venue structure)
- All historical nights and events
- All inventory items and units
- All warehouse stock records and movements
- All staff records (mapped to new role model)
- All historical placements

### What does not need migration
- Legacy local-only data that was never synced to Supabase
- Test or demo data

### Migration issues to resolve before coding
- Old system may not have `organization_id` — all rows must be assigned to the correct org during import
- Old role model may not match new role hierarchy — define explicit mapping
- Old timestamps: verify whether they were stored in UTC or local time; convert accordingly

---

## 22) Guestlist and Promoter Spec

### Overview
The guestlist module tracks guest entries per night, managed by promoters and door staff. It is separate from inventory and operational modules.

### Data flow
- **Promoter** creates guest entries for a specific night via `/guestlist/promoters/:id` view
- **Door staff** check in guests at the door via `/guestlist/door`
- **Manager/Admin** views the full guestlist and stats per night

### Table relationships
- `guestlist_nights` links a night to a guestlist configuration (ticket classes, capacity)
- `guestlist_entries` holds individual guest records (name, guest count, ticket class, promoter)
- `promoter_guest_entries` is a join table between `promoters` and `guestlist_entries` for attribution
- `door_checkins` records the actual check-in event (timestamp, door staff actor)
- `ticket_classes` defines admission types per night (e.g. Free, VIP, Paid)

### Permission rules
- Promoters can only see and edit their own guest entries
- Door staff can read all entries for the active night and create checkin records; they cannot edit guest entries
- Managers can see full guestlist with all promoter attribution and checkin status
- No guestlist data is visible to inventory or operational roles

### Fields for `guestlist_entries`
- `id`, `organization_id`, `venue_id`, `night_id`
- `guest_name` (text)
- `guest_count` (int — how many people on this entry)
- `ticket_class_id` (FK → `ticket_classes`)
- `promoter_id` (FK → `promoters`)
- `notes` (text, optional)
- `checked_in` (bool)
- `checked_in_count` (int — actual people checked in, may differ from `guest_count`)
- `created_by`, `created_at`, `updated_by`, `updated_at`

---

## 23) CI/CD Pipeline

### Environments
| Environment | Branch | Supabase Project | Vercel Project |
|-------------|--------|-----------------|----------------|
| Development | local | local Supabase CLI | localhost |
| Staging | `staging` | staging project | staging Vercel |
| Production | `main` | production project | production Vercel |

### GitHub Actions workflows

**`ci.yml`** — triggers on every PR:
1. `npm ci`
2. `npx tsc --noEmit`
3. `npx eslint src`
4. `npx vitest run`
5. RLS tests against local Supabase (via `supabase start` in CI)

**`deploy-staging.yml`** — triggers on merge to `staging`:
1. Run all CI steps
2. `npx supabase db push --project-ref $STAGING_PROJECT_REF`
3. Deploy to Vercel staging
4. Run Playwright E2E against staging URL
5. Notify on failure

**`deploy-prod.yml`** — triggers on merge to `main`:
1. Require `deploy-staging.yml` to have passed on same commit
2. `npx supabase db push --project-ref $PROD_PROJECT_REF`
3. Deploy to Vercel production
4. Create Sentry release with version + source maps
5. Notify on failure

### Rules
- No direct pushes to `main`. All production changes must go through a PR and staging.
- Migration files are reviewed manually before merge. Never run destructive migrations without explicit approval.
- Secrets (Supabase service role key, Sentry auth token) are stored in GitHub Actions secrets only.

---

## 24) Shared UI Component Plan

### Core components
- `AppShell`
- `Sidebar`
- `MobileNav`
- `TopBar`
- `ProtectedRoute`
- `RoleGate`
- `VenueSwitcher`
- `StatusChip`
- `KPIGrid`
- `EmptyState`
- `ErrorState`
- `LoadingSkeleton`
- `ConfirmDialog`
- `Toast` system
- `SyncStatusBanner`
- `OfflineIndicator`
- `DiagnosticsPanel`
- `PWAInstallPrompt`

### Form components
- `SearchSelect`
- `BarcodeInput`
- `QuantityInput`
- `NotesField`
- `DateRangePicker`
- `StaffPicker`
- `ItemPicker`
- `VenuePicker`
- `StationPicker`
- `UnitPicker`

### Data components
- `DataTable`
- `FilterBar`
- `EventTimeline`
- `StockCard`
- `VarianceTable`
- `CostBreakdownChart`
- `ExportPanel`
- `AuditTrailPanel`
- `QueueStatusTable`
- `ConflictReviewCard`
- `RolePermissionMatrix` (for setup/roles page)

---

## 25) Testing Strategy

Testing is mandatory. Manual checks alone are not enough.

### Required layers

1. **Migration tests** (`tests/migrations/`)
   - verify migrations apply cleanly to a blank database
   - verify seed data loads without errors
   - verify rollback scripts exist for destructive migrations

2. **Schema / RLS tests** (`tests/rls/`)
   - verify organization scoping: user from org A cannot read org B rows
   - verify venue scoping: user assigned to venue A cannot read venue B rows
   - verify allowed vs denied actions per role (use role matrix from Section 13)
   - verify `audit_log` cannot be updated or deleted
   - verify `feature_flags` write is blocked for non-Owner/Admin

3. **Unit / component tests** (`tests/unit/`)
   - forms and Zod validation schemas
   - permission helper functions
   - offline queue utilities (enqueue, retry, idempotency)
   - formatting and timezone conversion utilities
   - feature flag resolution logic

4. **Integration tests** (`tests/integration/`)
   - auth + venue selection flow
   - submit event write path (including offline queue)
   - warehouse movement write path
   - count session save path
   - conflict resolution write path

5. **E2E tests** (`tests/e2e/`)
   - login → select venue → setup → submit event
   - inventory / warehouse happy path
   - one permission-denied path (Bartender attempts warehouse write)
   - offline: submit event while offline → come back online → verify sync

### Testing rules
- A feature with RLS, offline, or stock impact is not complete without automated coverage.
- RLS tests must run in CI on every PR. Not just locally.
- E2E tests run against staging after every staging deploy.
- Migration tests run in CI before any deploy.

---

## 26) Module Build Order

### Phase 0 — Data foundation
Build first:
- Supabase project setup (production + staging)
- Migration structure and seed strategy
- Legacy schema audit and migration mapping document
- `organizations`, `venues` (with `timezone`), `profiles`, `venue_users` schema
- `role_permissions` and `organization_settings` schema
- `feature_flags` schema
- `units`, `items`, `bars`, `stations` schema
- All operations, warehouse, finance, guestlist, offline, audit schemas
- Base RLS policies for all tables
- `audit_log` with append-only RLS
- Migration tests and RLS tests in CI

**Phase 0 exit gate (required before Phase 1 begins):**
- [ ] All business tables have RLS enabled
- [ ] Organization scoping verified: cross-org row access is blocked
- [ ] Venue scoping verified: cross-venue row access is blocked
- [ ] Role-based read/write/delete denials verified per sensitive table
- [ ] `audit_log` update/delete is blocked by RLS
- [ ] `feature_flags` write blocked for non-Owner/Admin
- [ ] Migration tests pass on blank database
- [ ] Automated RLS tests passing in CI

Do not begin Phase 1 until this gate is closed.

### Phase 1 — App + infrastructure foundation
Build next:
- React + Vite + TypeScript + Tailwind project scaffold
- GitHub Actions CI pipeline (lint, typecheck, tests)
- Staging + production Vercel projects and deploy pipeline
- Supabase client and env loading
- Auth flow and session persistence
- Venue selection flow
- Route structure and all guard layers
- Role permission helpers (client-side)
- Service worker (vite-plugin-pwa, Workbox, manifest)
- PWAInstallPrompt, OfflineIndicator
- Feature flag client (env + DB layer)
- Sentry integration and diagnostics shell
- Offline queue client (IndexedDB, client operation ID, retry logic)
- Setup pages: venues, bars, stations, items, staff, units, roles
- Base dashboard shell and navigation

**Goal:** app boots cleanly in staging, users can log in, role rules exist, master data can be created, service worker is installed, errors are observable.

### Phase 2 — Core operations
Build next:
- Submit Event (with offline queue)
- Events Log
- My History
- Nights
- Placements
- Activity log writes for all operational actions
- Offline queue UX (SyncStatusBanner, QueueStatusTable)
- Conflict review screen

**Goal:** live operational flow works end-to-end with auditability and offline-safe behavior.

### Phase 3 — Inventory + warehouse
Build next:
- Inventory Clicker (cloud-backed)
- Warehouse stock, movements, transfers, adjustments
- Inventory snapshots
- Par levels
- Count sessions and count entries
- Waste log
- Offline support for Inventory Clicker drafts and warehouse captures

**Goal:** inventory is multi-device reliable and no longer local-only.

### Phase 4 — Reporting
Build next:
- Variance report (via Edge Function)
- Management summary
- Export center (via Edge Function with audit record)
- Cost center
- Analytics

**Goal:** managers and admins can trust the numbers and export them.

### Phase 5 — Purchasing + recipes + guestlist
Build next:
- Suppliers and supplier contacts
- Purchase orders and PO items
- Invoices and invoice approval
- Reorder suggestions
- Recipes and recipe ingredients
- Guestlist, promoters, door checkin, ticket classes

**Goal:** complete commercial feature set.

### Phase 6 — Hardening and legacy migration
Build next:
- Legacy BARINV data migration script (dry-run in staging, then production)
- Attachment upload (Supabase Storage)
- Full audit coverage review
- Seed and demo environment
- Advanced monitoring and alerting
- Support tooling
- Final UX polish and accessibility pass

**Goal:** production-ready launch candidate with real historical data imported.

---

## 27) GitHub Issues — Sprint Plan

### Sprint 1 — Schema Foundation
**Exit criterion:** every table exists, RLS is enabled and tested in CI, no UI work begins until this sprint is closed.

1. Add README and ADR template
2. Initialize Supabase projects (staging + production)
3. Add migration structure, seed strategy, and migration test harness
4. Create `organizations`, `venues` (with `timezone`), `profiles`, `venue_users` schema
5. Create `role_permissions`, `organization_settings`, `feature_flags` schema
6. Create `units`, `items`, `item_uom_conversions`, `bars`, `stations` schema
7. Create operations schema: `nights`, `placements`, `events`, `activity_log`
8. Create warehouse schema: all 9 warehouse/inventory tables
9. Create finance schema: all purchasing and cost tables
10. Create guestlist schema: all 6 guestlist tables
11. Create offline/device schema: `device_sessions`, `offline_queue_status`, `sync_conflicts`, `client_operations`
12. Create `audit_log` schema (append-only)
13. Add RLS policies for organization and venue scoping (all tables)
14. Add RLS policies for role-restricted tables (warehouse, finance, audit)
15. Add append-only RLS on `audit_log`
16. Add RLS and permission tests — Sprint 1 gate (do not advance until all passing in CI)

### Sprint 2 — App + Infrastructure Foundation
**Entry criterion:** Sprint 1 gate is fully passing in CI.

17. Initialize React + TypeScript + Vite project
18. Add Tailwind and base design tokens
19. Configure Supabase client and env loading (dev/staging/prod)
20. Set up GitHub Actions CI pipeline (lint, typecheck, Vitest, RLS tests)
21. Set up GitHub Actions staging deploy pipeline
22. Set up GitHub Actions production deploy pipeline
23. Configure Vercel staging and production projects
24. Add test harness for Vitest and Playwright
25. Set up routing, protected layout, and all route guard layers
26. Build auth flow and session persistence
27. Build venue selection flow
28. Add role model permission helpers (client-side, keyed from DB role)
29. Add offline queue client (IndexedDB, client_operation_id, retry with backoff)
30. Add service worker (vite-plugin-pwa, Workbox, manifest, PWAInstallPrompt, OfflineIndicator)
31. Add feature flag client (env gate + DB runtime layer)
32. Add Sentry integration and diagnostics shell
33. Build setup pages: venues, bars, stations, items, staff, units, roles
34. Build base dashboard shell and navigation
35. Add integration tests: auth flow, venue selection, permission-denied path, offline queue

---

## 28) Definition of Done

A feature is not done unless:
- UI exists and is usable on iPhone,
- form validation exists (Zod schema),
- permissions are enforced in RLS, not only in UI,
- database writes succeed with correct org/venue scope,
- loading, error, and empty states exist,
- audit behavior is implemented or explicitly documented as ruled out,
- service worker / offline behavior is defined (works offline, or shows OfflineIndicator),
- feature works with real seeded data,
- automated tests exist for any RLS, offline, or stock-impact behavior,
- diagnostics/observability are considered (Sentry error boundaries, structured logs),
- edge cases are tested manually,
- the feature has been validated in staging before merging to main.

---

## 29) MVP Cut Line

### MVP must include
- auth
- venue selection
- setup master data (venues, bars, stations, items, staff, units)
- Submit Event (with offline support)
- Events Log
- My History
- Nights
- Placements
- Inventory Clicker (cloud-backed)
- Warehouse stock + movements + transfers
- Count sessions (basic)
- Basic dashboard
- Basic variance/report view
- Activity log for critical actions
- Visible sync status / queue UX
- Conflict resolution screen
- Service worker (PWA install, offline indicator)

### Keep out of MVP unless capacity is strong
- Broad analytics depth
- Invoice and purchasing depth
- Recipe costing depth
- Promoter/door advanced flows
- POS integrations
- White-labeling and billing
- Fancy dashboard polish
- Legacy data migration (can follow immediately post-MVP)

### MVP rule
Prioritize the operational spine over impressive breadth. A venue must be able to run a real shift on MVP day one.

---

## 30) Immediate First Build Task

Start here, in this order:

1. Create GitHub repo `barinv-pro`, add README and ADR template
2. Initialize Supabase staging and production projects
3. Set up Supabase CLI locally (`supabase init`, `supabase start`)
4. Write migration 001: organizations, venues, profiles, venue_users, role_permissions
5. Write migration 002: items, units, bars, stations
6. Write migration 003: nights, placements, events, activity_log
7. Write migration 004: all warehouse and inventory tables
8. Write migration 005: finance and purchasing tables
9. Write migration 006: guestlist tables
10. Write migration 007: offline/device and audit tables
11. Write migration 008: organization_settings, feature_flags
12. Add RLS policies for all tables
13. Write RLS test suite
14. Set up GitHub Actions CI to run RLS tests
15. Confirm Sprint 1 gate passes in CI

Do **not** write a single line of React until the Sprint 1 gate passes.
Do **not** begin with analytics or fancy dashboards.
Do **not** keep warehouse local-only in the new architecture.
Do **not** defer audit, service worker, or offline contracts until "later".
Do **not** hardcode any timezone.

---

## 31) AI Coding Assistant Kickoff Prompt

Use this to start implementation in Cursor or a fresh AI coding chat:

```
You are helping me build BARINV Pro, a professional hospitality inventory and operations platform for real production use across multiple venues.

Stack:
- React, TypeScript, Vite
- Tailwind CSS
- React Router
- TanStack Query
- React Hook Form + Zod
- Supabase (Auth, Postgres, Realtime, Storage, Edge Functions)
- vite-plugin-pwa (Workbox) for service worker and PWA
- Vitest, Playwright
- GitHub Actions (CI/CD)
- Sentry

Build goals:
- Mobile-first PWA installable on iPhone
- Multi-venue support with per-venue timezone
- Real role-based permissions enforced in Supabase RLS
- Warehouse cloud-backed, not local-only
- Offline-safe core write actions with visible queue state
- Auditable inventory and finance flows
- Production-quality maintainability

Architectural rules:
1. Generate production-quality code, not demo code.
2. Keep everything modular and scalable using feature-based folder structure.
3. All timestamps stored in UTC. Timezone is per-venue from the venues table, applied at display time using date-fns-tz. No global timezone constant. No hardcoded timezone.
4. Respect organization_id and venue_id in every business table.
5. Use RLS as the real enforcement layer. UI-only gating is not acceptable.
6. Add Zod validation and loading/error/empty states on every form and data fetch.
7. Treat offline as a visible product workflow: IndexedDB queue, client operation UUIDs, idempotent writes, visible sync status.
8. Service worker via Workbox (vite-plugin-pwa): cache app shell only; network-first for API calls; never cache auth or write endpoints.
9. Add audit writes for all critical mutations via a shared audit helper.
10. Feature flags: build-time env gates + runtime DB table per organization.
11. Staging environment exists and all work is validated there before production.
12. CI runs lint, typecheck, unit tests, and RLS tests on every PR.
13. Add Sentry error boundaries and structured diagnostics early.

Current first task:
[INSERT CURRENT TASK FROM SECTION 30]
```

---

## 32) Final Rules

When in doubt, optimize for:
- correctness,
- data integrity,
- permission safety,
- offline reliability,
- maintainability,
- mobile usability on real shift conditions,
- auditability.

Do not optimize for cleverness.
Do not defer security to "later."
Do not assume a feature is done because it works in the happy path.
Do not hardcode timezones, organization IDs, or venue IDs.
A venue must be able to run a real shift on this system from day one of production.
