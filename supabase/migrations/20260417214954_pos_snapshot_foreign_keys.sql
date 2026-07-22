
-- ────────────────────────────────────────────────────────────────────
-- Add foreign keys that PostgREST needs for nested SELECTs like
-- pos_bar_snapshots(*, bars(name)). Without these, the frontend error
-- "Could not find a relationship between pos_bar_snapshots and bars"
-- fires at query time.
--
-- Uses IF NOT EXISTS semantics via DO blocks so this migration is safe
-- to run multiple times / safe to re-apply on projects that already
-- have some of the constraints.
-- ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='pos_bar_snapshots'
      AND constraint_name='pos_bar_snapshots_bar_id_fkey'
  ) THEN
    ALTER TABLE public.pos_bar_snapshots
      ADD CONSTRAINT pos_bar_snapshots_bar_id_fkey
      FOREIGN KEY (bar_id) REFERENCES public.bars(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='pos_bar_snapshots'
      AND constraint_name='pos_bar_snapshots_connection_id_fkey'
  ) THEN
    ALTER TABLE public.pos_bar_snapshots
      ADD CONSTRAINT pos_bar_snapshots_connection_id_fkey
      FOREIGN KEY (connection_id) REFERENCES public.pos_connections(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='pos_bar_product_snapshots'
      AND constraint_name='pos_bar_product_snapshots_bar_id_fkey'
  ) THEN
    ALTER TABLE public.pos_bar_product_snapshots
      ADD CONSTRAINT pos_bar_product_snapshots_bar_id_fkey
      FOREIGN KEY (bar_id) REFERENCES public.bars(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='pos_bar_product_snapshots'
      AND constraint_name='pos_bar_product_snapshots_connection_id_fkey'
  ) THEN
    ALTER TABLE public.pos_bar_product_snapshots
      ADD CONSTRAINT pos_bar_product_snapshots_connection_id_fkey
      FOREIGN KEY (connection_id) REFERENCES public.pos_connections(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Index the FK columns for query performance (idempotent)
CREATE INDEX IF NOT EXISTS pos_bar_snapshots_bar_id_idx
  ON public.pos_bar_snapshots(bar_id);
CREATE INDEX IF NOT EXISTS pos_bar_snapshots_connection_id_idx
  ON public.pos_bar_snapshots(connection_id);
CREATE INDEX IF NOT EXISTS pos_bar_product_snapshots_bar_id_idx
  ON public.pos_bar_product_snapshots(bar_id);
CREATE INDEX IF NOT EXISTS pos_bar_product_snapshots_connection_id_idx
  ON public.pos_bar_product_snapshots(connection_id);

-- Force PostgREST to rebuild its schema cache so the new FK graph is
-- visible to client queries immediately.
NOTIFY pgrst, 'reload schema';
;
