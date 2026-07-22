
-- ────────────────────────────────────────────────────────────────────
-- 1. Clean orphan rows whose FK column references a deleted parent.
--    These rows can never be reached by venue-scoped queries anyway
--    (the parent is gone), so deleting them is a no-loss operation.
--    Only 2 such rows existed at v2.3.7 cutover (verified by query).
-- ────────────────────────────────────────────────────────────────────
DELETE FROM public.guestlist  WHERE night_id IS NOT NULL AND night_id NOT IN (SELECT id FROM public.nights);
DELETE FROM public.vip_tables WHERE night_id IS NOT NULL AND night_id NOT IN (SELECT id FROM public.nights);

-- ────────────────────────────────────────────────────────────────────
-- 2. Add the 17 missing FKs identified by the schema audit.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fkdefs TEXT[][] := ARRAY[
    ARRAY['pos_bar_mappings',           'bar_id',        'bars',            'id'],
    ARRAY['pos_bar_mappings',           'connection_id', 'pos_connections', 'id'],
    ARRAY['pos_product_item_mappings',  'connection_id', 'pos_connections', 'id'],
    ARRAY['pos_sync_runs',              'connection_id', 'pos_connections', 'id'],
    ARRAY['bar_close_summaries',        'bar_id',        'bars',            'id'],
    ARRAY['bar_close_summaries',        'connection_id', 'pos_connections', 'id'],
    ARRAY['bar_close_summaries',        'night_id',      'nights',          'id'],
    ARRAY['bar_item_dispatch_snapshots','bar_id',        'bars',            'id'],
    ARRAY['bar_item_dispatch_snapshots','connection_id', 'pos_connections', 'id'],
    ARRAY['bar_item_dispatch_snapshots','item_id',       'items',           'id'],
    ARRAY['bar_item_shot_snapshots',    'bar_id',        'bars',            'id'],
    ARRAY['bar_item_shot_snapshots',    'connection_id', 'pos_connections', 'id'],
    ARRAY['bar_item_shot_snapshots',    'item_id',       'items',           'id'],
    ARRAY['guest_bookings',             'night_id',      'nights',          'id'],
    ARRAY['guestlist',                  'night_id',      'nights',          'id'],
    ARRAY['vip_tables',                 'night_id',      'nights',          'id'],
    ARRAY['warehouse_transfers',        'item_id',       'items',           'id']
  ];
  fk TEXT[];
  cname TEXT;
BEGIN
  FOREACH fk SLICE 1 IN ARRAY fkdefs LOOP
    cname := fk[1] || '_' || fk[2] || '_fkey';
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema='public' AND table_name=fk[1] AND constraint_name=cname
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE CASCADE',
        fk[1], cname, fk[2], fk[3], fk[4]
      );
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(%I)',
        fk[1] || '_' || fk[2] || '_idx', fk[1], fk[2]);
    END IF;
  END LOOP;
END $$;

-- 3. Reload PostgREST schema cache so client queries see the new FK
--    graph immediately. No app restart required.
NOTIFY pgrst, 'reload schema';
;
