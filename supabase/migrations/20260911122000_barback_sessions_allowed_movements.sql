-- BARINV PRO — per-session Barback Link movement permissions
-- LOCAL IMPLEMENTATION FILE ONLY. Do not run automatically.

ALTER TABLE public.barback_sessions
  ADD COLUMN IF NOT EXISTS allowed_movements jsonb NOT NULL
    DEFAULT '{"take":true,"return":true}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'barback_sessions_allowed_movements_shape'
      AND conrelid = 'public.barback_sessions'::regclass
  ) THEN
    ALTER TABLE public.barback_sessions
      ADD CONSTRAINT barback_sessions_allowed_movements_shape
      CHECK (
        jsonb_typeof(allowed_movements) = 'object'
        AND jsonb_typeof(allowed_movements -> 'take') = 'boolean'
        AND jsonb_typeof(allowed_movements -> 'return') = 'boolean'
        AND (allowed_movements - 'take' - 'return') = '{}'::jsonb
        AND NOT (
          (allowed_movements ->> 'take')::boolean = false
          AND (allowed_movements ->> 'return')::boolean = false
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.barinv_events_enforce_session_allowed_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed jsonb;
  v_take boolean := true;
  v_return boolean := true;
BEGIN
  -- Only Barback Link rows with a linked session are restricted here.
  -- Admin/iOS rows and legacy rows without a resolvable session retain
  -- existing behavior. The default for absent/malformed legacy data is BOTH.
  IF NEW.source IN ('barback_web_link', 'barback_live_pilot')
     AND NEW.session_id IS NOT NULL
     AND NEW.action IN ('TAKEN', 'RETURNED') THEN
    SELECT s.allowed_movements
      INTO v_allowed
    FROM public.barback_sessions AS s
    WHERE s.id = NEW.session_id
      AND s.venue_id = NEW.venue_id
      AND s.night_id = NEW.night_id;

    IF FOUND
       AND jsonb_typeof(v_allowed) = 'object'
       AND jsonb_typeof(v_allowed -> 'take') = 'boolean'
       AND jsonb_typeof(v_allowed -> 'return') = 'boolean' THEN
      v_take := (v_allowed ->> 'take')::boolean;
      v_return := (v_allowed ->> 'return')::boolean;
    END IF;

    IF NEW.action = 'TAKEN' AND NOT v_take THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'This Barback session does not allow TAKE movements';
    END IF;
    IF NEW.action = 'RETURNED' AND NOT v_return THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'This Barback session does not allow RETURN movements';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_session_allowed_movements ON public.events;

CREATE TRIGGER trg_events_session_allowed_movements
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.barinv_events_enforce_session_allowed_movements();

COMMENT ON FUNCTION public.barinv_events_enforce_session_allowed_movements()
  IS 'Rejects Barback Link TAKEN/RETURNED events disallowed by the authoritative session configuration.';
