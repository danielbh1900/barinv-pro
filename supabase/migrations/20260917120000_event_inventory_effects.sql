-- BARINV PRO: database-owned liquor-room inventory effects for approved Events.
-- INSERT/approval transition only; historical rows are never replayed.
BEGIN;

ALTER TABLE public.items
  ALTER COLUMN liquor_room_stock TYPE numeric
  USING liquor_room_stock::numeric;

CREATE TABLE IF NOT EXISTS public.event_inventory_effects (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id),
  stock_delta numeric NOT NULL DEFAULT 0,
  applied boolean NOT NULL DEFAULT false,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_inventory_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_inventory_effects FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_inventory_effects TO service_role;

CREATE OR REPLACE FUNCTION public.barinv_apply_approved_event_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_weight numeric;
  v_tare numeric;
  v_full numeric;
  v_delta numeric;
  v_reason text := NULL;
  -- BOTTLE_STATE alone still represents an ordinary one-bottle count. Only
  -- scale measurements require the complete gross/tare/full conversion.
  v_metadata boolean := COALESCE(NEW.notes, '') ~ E'\\[(WEIGHT_G|TARE_WEIGHT_G|FULL_WEIGHT_G|REMAINING_PERCENT|LIQUID_WEIGHT_G|REMAINING_ML)=';
BEGIN
  IF NEW.status IS DISTINCT FROM 'APPROVED' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'APPROVED' THEN
    RETURN NEW;
  END IF;

  IF NEW.action NOT IN ('TAKEN', 'DELIVERED', 'RETURNED') OR NEW.item_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_metadata THEN
    BEGIN
      v_weight := (regexp_match(COALESCE(NEW.notes, ''), E'\\[WEIGHT_G=([^\\]\\r\\n]*)\\]'))[1]::numeric;
      v_tare := (regexp_match(COALESCE(NEW.notes, ''), E'\\[TARE_WEIGHT_G=([^\\]\\r\\n]*)\\]'))[1]::numeric;
      v_full := (regexp_match(COALESCE(NEW.notes, ''), E'\\[FULL_WEIGHT_G=([^\\]\\r\\n]*)\\]'))[1]::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_reason := 'Invalid numeric weight metadata; inventory effect not applied';
    END;
    IF v_reason IS NULL AND (v_weight IS NULL OR v_tare IS NULL OR v_full IS NULL OR v_full <= v_tare OR v_weight < v_tare OR v_weight > v_full) THEN
      v_reason := 'Incomplete or out-of-range weight metadata; inventory effect not applied';
    END IF;
    IF v_reason IS NULL THEN
      v_delta := (v_weight - v_tare) / (v_full - v_tare);
    END IF;
  ELSE
    v_delta := NEW.qty;
  END IF;

  IF NEW.action IN ('TAKEN', 'DELIVERED') THEN
    v_delta := -v_delta;
  END IF;

  INSERT INTO public.event_inventory_effects(event_id, item_id, stock_delta, applied, reason)
  VALUES (NEW.id, NEW.item_id, COALESCE(v_delta, 0), v_reason IS NULL, v_reason)
  ON CONFLICT (event_id) DO NOTHING;

  IF v_reason IS NULL AND FOUND THEN
    UPDATE public.items
    SET liquor_room_stock = COALESCE(liquor_room_stock, 0) + v_delta
    WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_events_apply_inventory ON public.events;
CREATE TRIGGER trg_events_apply_inventory
AFTER INSERT OR UPDATE OF status ON public.events
FOR EACH ROW EXECUTE FUNCTION public.barinv_apply_approved_event_inventory();

REVOKE ALL ON FUNCTION public.barinv_apply_approved_event_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.barinv_apply_approved_event_inventory() TO service_role;

COMMIT;
