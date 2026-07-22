CREATE TABLE IF NOT EXISTS public.vip_table_spend_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid NOT NULL REFERENCES public.venues(id)     ON DELETE RESTRICT,
  night_id      uuid NOT NULL REFERENCES public.nights(id)     ON DELETE RESTRICT,
  vip_table_id  uuid NOT NULL REFERENCES public.vip_tables(id) ON DELETE RESTRICT,
  entry_type    text NOT NULL CHECK (entry_type IN ('spend','adjustment','legacy')),
  amount        numeric NOT NULL DEFAULT 0,
  comps         numeric NOT NULL DEFAULT 0,
  discounts     numeric NOT NULL DEFAULT 0,
  receipt_code  text,
  note          text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  voided        boolean NOT NULL DEFAULT false,
  voided_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at     timestamptz,
  void_reason   text,
  CONSTRAINT vtse_void_consistency CHECK (
    (voided = false AND voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL)
    OR
    (voided = true  AND voided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vtse_vip_table     ON public.vip_table_spend_entries (vip_table_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vtse_venue_night   ON public.vip_table_spend_entries (venue_id, night_id);
CREATE INDEX IF NOT EXISTS idx_vtse_receipt_code  ON public.vip_table_spend_entries (vip_table_id, receipt_code) WHERE receipt_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vtse_one_legacy_per_table
  ON public.vip_table_spend_entries (vip_table_id) WHERE entry_type = 'legacy';

CREATE OR REPLACE FUNCTION public._vtse_sync_table_totals() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id uuid;
  v_actual    numeric;
  v_comps     numeric;
  v_discounts numeric;
BEGIN
  v_id := COALESCE(NEW.vip_table_id, OLD.vip_table_id);
  IF v_id IS NULL THEN RETURN NULL; END IF;
  SELECT
    COALESCE(SUM(amount)    FILTER (WHERE NOT voided), 0),
    COALESCE(SUM(comps)     FILTER (WHERE NOT voided), 0),
    COALESCE(SUM(discounts) FILTER (WHERE NOT voided), 0)
  INTO v_actual, v_comps, v_discounts
  FROM public.vip_table_spend_entries
  WHERE vip_table_id = v_id;
  UPDATE public.vip_tables
     SET actual_spend = v_actual,
         comps        = v_comps,
         discounts    = v_discounts,
         updated_at   = now()
   WHERE id = v_id;
  RETURN NULL;
END$$;

DROP TRIGGER IF EXISTS trg_vtse_sync_after_change ON public.vip_table_spend_entries;
CREATE TRIGGER trg_vtse_sync_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.vip_table_spend_entries
  FOR EACH ROW EXECUTE FUNCTION public._vtse_sync_table_totals();

ALTER TABLE public.vip_table_spend_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtse_mgr_all ON public.vip_table_spend_entries;
CREATE POLICY vtse_mgr_all ON public.vip_table_spend_entries
  FOR ALL TO authenticated
  USING (has_venue_access(venue_id, 'manager'))
  WITH CHECK (has_venue_access(venue_id, 'manager'));

INSERT INTO public.vip_table_spend_entries
  (venue_id, night_id, vip_table_id, entry_type, amount, comps, discounts,
   note, created_at)
SELECT
  v.venue_id, v.night_id, v.id, 'legacy',
  COALESCE(v.actual_spend, 0),
  COALESCE(v.comps, 0),
  COALESCE(v.discounts, 0),
  'Legacy total captured at spend-ledger migration',
  COALESCE(v.updated_at, v.created_at, now())
FROM public.vip_tables v
WHERE COALESCE(v.actual_spend, 0) > 0
   OR COALESCE(v.comps, 0) > 0
   OR COALESCE(v.discounts, 0) > 0
ON CONFLICT DO NOTHING;;
