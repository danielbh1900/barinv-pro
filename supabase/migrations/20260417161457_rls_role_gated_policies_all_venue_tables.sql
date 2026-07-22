
-- ────────────────────────────────────────────────────────────────────
-- Role-gated RLS policies, applied uniformly per category.
-- Every policy uses public.has_venue_access(venue_id, '<role>').
-- ────────────────────────────────────────────────────────────────────

-- Helper: apply the standard 4 policies (select/insert/update/delete)
-- to a table using the given minimum roles. Internal to this migration.
CREATE OR REPLACE FUNCTION pg_temp.apply_venue_policies(
  tbl TEXT,
  select_role TEXT,
  write_role TEXT,
  delete_role TEXT
) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format($f$
    CREATE POLICY %I ON public.%I
      FOR SELECT TO authenticated
      USING (public.has_venue_access(venue_id, %L))
  $f$, tbl || '_select_v', tbl, select_role);

  EXECUTE format($f$
    CREATE POLICY %I ON public.%I
      FOR INSERT TO authenticated
      WITH CHECK (public.has_venue_access(venue_id, %L))
  $f$, tbl || '_insert_v', tbl, write_role);

  EXECUTE format($f$
    CREATE POLICY %I ON public.%I
      FOR UPDATE TO authenticated
      USING (public.has_venue_access(venue_id, %L))
      WITH CHECK (public.has_venue_access(venue_id, %L))
  $f$, tbl || '_update_v', tbl, write_role, write_role);

  EXECUTE format($f$
    CREATE POLICY %I ON public.%I
      FOR DELETE TO authenticated
      USING (public.has_venue_access(venue_id, %L))
  $f$, tbl || '_delete_v', tbl, delete_role);
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Category A: admin-only writes (settings & integrations).
-- SELECT viewer · INSERT/UPDATE/DELETE admin.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'business_profile',
    'pos_connections',
    'pos_bar_mappings',
    'pos_product_item_mappings',
    'pos_source_map',
    'loyalty_config'
  ] LOOP
    PERFORM pg_temp.apply_venue_policies(tbl, 'viewer', 'admin', 'admin');
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Category B: manager-level writes (setup data).
-- SELECT viewer · INSERT/UPDATE/DELETE manager.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'bars',
    'staff',
    'stations',
    'items',
    'suppliers',
    'purchase_orders',
    'po_items',
    'invoices',
    'recipes',
    'recipe_ingredients',
    'menu_items',
    'menu_settings'
  ] LOOP
    PERFORM pg_temp.apply_venue_policies(tbl, 'viewer', 'manager', 'manager');
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Category C: staff writes, manager deletes (operational data).
-- SELECT viewer · INSERT/UPDATE staff · DELETE manager.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'nights',
    'events',
    'guests',
    'guestlist',
    'guest_bookings',
    'vip_tables',
    'receipts',
    'receipt_items',
    'warehouse_items',
    'warehouse_transfers',
    'placements',
    'loyalty_points',
    'pos_sync_runs',
    'pos_transactions',
    'pos_bar_snapshots',
    'pos_bar_product_snapshots',
    'bar_close_summaries',
    'bar_item_dispatch_snapshots',
    'bar_item_shot_snapshots'
  ] LOOP
    PERFORM pg_temp.apply_venue_policies(tbl, 'viewer', 'staff', 'manager');
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Special: venues (the membership target).
--   • SELECT: members (viewer+).
--   • INSERT: any authenticated — trigger makes them owner.
--   • UPDATE: admin+.
--   • DELETE: owner only.
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY venues_select_v ON public.venues
  FOR SELECT TO authenticated
  USING (public.has_venue_access(id, 'viewer'));

CREATE POLICY venues_insert_v ON public.venues
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY venues_update_v ON public.venues
  FOR UPDATE TO authenticated
  USING (public.has_venue_access(id, 'admin'))
  WITH CHECK (public.has_venue_access(id, 'admin'));

CREATE POLICY venues_delete_v ON public.venues
  FOR DELETE TO authenticated
  USING (public.has_venue_access(id, 'owner'));

-- ────────────────────────────────────────────────────────────────────
-- Special: profiles.
--   • SELECT: self only for now.
--   • INSERT: self only (ids must match auth.uid()).
--   • UPDATE: self only.
--   • DELETE: none (cascade from auth.users handles it).
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY profiles_select_self_v ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY profiles_insert_self_v ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_self_v ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
;
