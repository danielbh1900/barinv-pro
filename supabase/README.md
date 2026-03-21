# BARINV Pro — Database Migrations

## Structure

```
supabase/
  migrations/
    001_org_and_access.sql          ← organizations, venues, profiles, venue_users, role_permissions
    002_inventory_master.sql        ← units, items, item_uom_conversions, bars, stations
    003_operations.sql              ← nights, placements, events, activity_log
    004_warehouse.sql               ← all warehouse and inventory tables
    005_finance.sql                 ← suppliers, purchase_orders, invoices, cost_snapshots
    006_recipes_guestlist.sql       ← recipes, guestlist, promoters, door_checkins
    007_offline_and_audit.sql       ← client_operations, device_sessions, sync_conflicts, audit_log
    008_settings_flags_attachments  ← organization_settings, feature_flags, attachments
  policies/
    rls_policies.sql                ← all RLS policies and helper functions
tests/
  rls/
    rls_test.sql                    ← pgTAP RLS test suite
```

## How to Run (Local)

### Prerequisites
```bash
npm install -D supabase
npx supabase login
npx supabase init        # creates supabase/ folder
npx supabase start       # starts local Postgres + Studio
```

### Apply migrations
```bash
npx supabase db reset    # drops and re-applies all migrations from scratch
```

Or apply individually:
```bash
npx supabase db push
```

### Apply RLS policies
RLS policies are in `supabase/policies/rls_policies.sql`.
Run after all migrations:
```bash
psql $DATABASE_URL -f supabase/policies/rls_policies.sql
```

Or add the policies file to the migration sequence (rename it `009_rls_policies.sql`
and move it to `supabase/migrations/`).

### Run RLS tests
```bash
npx supabase test db     # runs all .sql files in tests/
```

## Sprint 1 Exit Gate

Before any UI work begins, all of the following must be true:

- [ ] `npx supabase db reset` completes with no errors
- [ ] `npx supabase test db` passes all 30 assertions
- [ ] Cross-org isolation verified (user from Org B cannot see Org A data)
- [ ] Cross-venue isolation verified (Manager of Venue A1 cannot see Venue A2 data)
- [ ] `audit_log` UPDATE and DELETE blocked by RLS
- [ ] `feature_flags` write blocked for non-admin roles
- [ ] All migrations run cleanly in CI (GitHub Actions)

## Key Rules

1. **All timestamps are UTC.** Timezone is per-venue in `venues.timezone`.
2. **Never update or delete `stock_movements` rows.** Insert a correction instead.
3. **Never update or delete `audit_log` rows.** RLS blocks this — it is intentional.
4. **`cost_snapshots` are immutable.** Insert a new row when cost changes.
5. **Every offline write must have a `client_operation_id`.** This is the idempotency key.
6. **Soft delete only** for: items, bars, stations, suppliers, purchase_orders, invoices, recipes, guestlist_entries, promoters, attachments.

## Migration Naming Convention

Format: `NNN_description.sql` where NNN is zero-padded (001, 002, ...).

Each migration file:
- is idempotent where possible (`create table if not exists`, `create index if not exists`)
- has a comment header explaining what it creates
- does not reference data from other migrations by hard-coded ID

## Adding New Migrations

```bash
# Create a new migration file
touch supabase/migrations/009_my_feature.sql

# Apply to local
npx supabase db push

# Apply to staging
npx supabase db push --project-ref $STAGING_PROJECT_REF

# Apply to production (via CI only — never manually)
# merge to main → GitHub Actions runs deploy-prod.yml → supabase db push
```
