-- BARINV PRO: single-event, session-scoped Bar-to-Bar transfers.
-- Transfers are auditable Event rows and have no liquor-room stock effect.
BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS destination_bar_id uuid
  REFERENCES public.bars(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_events_destination_bar_id
  ON public.events(destination_bar_id)
  WHERE destination_bar_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.barinv_events_guard_transfer_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source public.bars%ROWTYPE;
  v_destination public.bars%ROWTYPE;
  v_night_venue uuid;
  v_session public.barback_sessions%ROWTYPE;
BEGIN
  IF NEW.action <> 'TRANSFER' THEN
    IF NEW.destination_bar_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'destination_bar_id is only valid for TRANSFER Events';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.bar_id IS NULL OR NEW.destination_bar_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRANSFER requires source and destination bars';
  END IF;
  IF NEW.bar_id = NEW.destination_bar_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRANSFER source and destination must differ';
  END IF;
  IF NEW.item_id IS NULL OR NEW.qty IS NULL OR NEW.qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRANSFER requires an item and positive quantity';
  END IF;
  IF NEW.night_id IS NULL OR NEW.venue_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRANSFER requires venue and night';
  END IF;

  SELECT b.* INTO v_source
  FROM public.bars AS b
  WHERE b.id = NEW.bar_id
    AND b.venue_id = NEW.venue_id
    AND b.active IS TRUE
    AND COALESCE(b.bar_type, 'bar') = 'bar';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TRANSFER source bar is not an active bar in this Venue';
  END IF;

  SELECT b.* INTO v_destination
  FROM public.bars AS b
  WHERE b.id = NEW.destination_bar_id
    AND b.venue_id = NEW.venue_id
    AND b.active IS TRUE
    AND COALESCE(b.bar_type, 'bar') = 'bar';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TRANSFER destination bar is not an active bar in this Venue';
  END IF;

  SELECT n.venue_id INTO v_night_venue
  FROM public.nights AS n
  WHERE n.id = NEW.night_id;
  IF NOT FOUND OR v_night_venue IS DISTINCT FROM NEW.venue_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TRANSFER night is outside this Venue';
  END IF;

  IF NEW.source IN ('barback_web_link', 'barback_live_pilot') OR NEW.session_id IS NOT NULL THEN
    IF NEW.session_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Barback TRANSFER requires a session';
    END IF;
    SELECT s.* INTO v_session
    FROM public.barback_sessions AS s
    WHERE s.id = NEW.session_id
      AND s.venue_id = NEW.venue_id
      AND s.night_id = NEW.night_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TRANSFER session is outside this Venue or Night';
    END IF;
    IF NOT (NEW.bar_id = ANY(COALESCE(v_session.allowed_bars, ARRAY[]::uuid[])))
       OR NOT (NEW.destination_bar_id = ANY(COALESCE(v_session.allowed_bars, ARRAY[]::uuid[]))) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TRANSFER bars are outside the Barback session scope';
    END IF;
    IF COALESCE((v_session.allowed_movements ->> 'take')::boolean, false) IS NOT TRUE
       OR COALESCE((v_session.allowed_movements ->> 'return')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TRANSFER requires both TAKE and RETURN permission';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_03_transfer_contract ON public.events;
CREATE TRIGGER trg_events_03_transfer_contract
  BEFORE INSERT OR UPDATE OF action, bar_id, destination_bar_id, venue_id,
    night_id, session_id, qty, notes ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.barinv_events_guard_transfer_contract();

REVOKE ALL ON FUNCTION public.barinv_events_guard_transfer_contract() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.barinv_events_guard_transfer_contract() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
