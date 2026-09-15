-- BARINV PRO: audited manager-only correction of PENDING Event quantity/weight.
--
-- This intentionally does not grant direct UPDATE(qty) to authenticated users.
-- The protected-field trigger remains active and permits only the exact qty
-- mutation pre-authorized by an audit row created in the same transaction by
-- public.barinv_correct_pending_event().

BEGIN;

CREATE TABLE public.event_correction_audit (
  id               uuid PRIMARY KEY,
  transaction_id   bigint NOT NULL,
  event_id         uuid NOT NULL,
  venue_id         uuid NOT NULL,
  actor_user_id    uuid NOT NULL,
  correction_mode  text NOT NULL
    CHECK (correction_mode IN ('QUANTITY', 'WEIGHT')),
  old_qty          numeric NOT NULL,
  new_qty          numeric NOT NULL,
  old_notes        text,
  new_notes        text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_correction_audit_event_idx
  ON public.event_correction_audit(event_id, created_at DESC);

CREATE INDEX event_correction_audit_venue_idx
  ON public.event_correction_audit(venue_id, created_at DESC);

ALTER TABLE public.event_correction_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_correction_audit_select_v
  ON public.event_correction_audit
  FOR SELECT
  TO authenticated
  USING (public.has_venue_access(venue_id, 'manager'));

REVOKE ALL ON public.event_correction_audit
  FROM PUBLIC, anon, authenticated, barback_user;

GRANT SELECT ON public.event_correction_audit TO authenticated;
GRANT ALL ON public.event_correction_audit TO service_role;

COMMENT ON TABLE public.event_correction_audit IS
  'Append-only audit and same-transaction authorization for manager corrections of PENDING Event qty/notes.';


-- SECURITY DEFINER alone does not change auth.role(), so the historical
-- service_role-only bypass cannot authorize an authenticated manager RPC.
-- Instead, accept only an exact mutation whose unforgeable audit token and
-- old/new values were inserted by the RPC in this same transaction. Normal
-- clients have no INSERT privilege or policy on event_correction_audit and
-- still have no UPDATE(qty) privilege on events.
CREATE OR REPLACE FUNCTION public.barinv_events_guard_protected_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_correction_token text := NULLIF(
    current_setting('barinv.pending_event_correction_token', true),
    ''
  );
BEGIN
  IF ROW(
    NEW.id,
    NEW.venue_id,
    NEW.night_id,
    NEW.bar_id,
    NEW.station_id,
    NEW.item_id,
    NEW.staff_id,
    NEW.submitted_by,
    NEW.qty,
    NEW.action,
    NEW.reason_code,
    NEW.qty_basis,
    NEW.client_event_id,
    NEW.source,
    NEW.session_id,
    NEW.created_at
  ) IS NOT DISTINCT FROM ROW(
    OLD.id,
    OLD.venue_id,
    OLD.night_id,
    OLD.bar_id,
    OLD.station_id,
    OLD.item_id,
    OLD.staff_id,
    OLD.submitted_by,
    OLD.qty,
    OLD.action,
    OLD.reason_code,
    OLD.qty_basis,
    OLD.client_event_id,
    OLD.source,
    OLD.session_id,
    OLD.created_at
  ) THEN
    RETURN NEW;
  END IF;

  IF v_correction_token IS NOT NULL
     AND OLD.status = 'PENDING'
     AND NEW.status = 'PENDING'
     AND ROW(
       NEW.id,
       NEW.venue_id,
       NEW.night_id,
       NEW.bar_id,
       NEW.station_id,
       NEW.item_id,
       NEW.staff_id,
       NEW.submitted_by,
       NEW.action,
       NEW.reason_code,
       NEW.qty_basis,
       NEW.client_event_id,
       NEW.source,
       NEW.session_id,
       NEW.created_at
     ) IS NOT DISTINCT FROM ROW(
       OLD.id,
       OLD.venue_id,
       OLD.night_id,
       OLD.bar_id,
       OLD.station_id,
       OLD.item_id,
       OLD.staff_id,
       OLD.submitted_by,
       OLD.action,
       OLD.reason_code,
       OLD.qty_basis,
       OLD.client_event_id,
       OLD.source,
       OLD.session_id,
       OLD.created_at
     )
     AND EXISTS (
       SELECT 1
       FROM public.event_correction_audit AS a
       WHERE a.id::text = v_correction_token
         AND a.transaction_id = txid_current()
         AND a.event_id = OLD.id
         AND a.venue_id = OLD.venue_id
         AND a.actor_user_id = auth.uid()
         AND a.old_qty IS NOT DISTINCT FROM OLD.qty
         AND a.new_qty IS NOT DISTINCT FROM NEW.qty
         AND a.old_notes IS NOT DISTINCT FROM OLD.notes
         AND a.new_notes IS NOT DISTINCT FROM NEW.notes
     ) THEN
    RETURN NEW;
  END IF;

  -- Preserve the existing trusted service-role maintenance path.
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE =
      'Submitted Event protected fields are immutable; use an approved server workflow';
END;
$$;

REVOKE ALL ON FUNCTION
  public.barinv_events_guard_protected_update()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.barinv_events_guard_protected_update()
  TO service_role;

COMMENT ON FUNCTION public.barinv_events_guard_protected_update() IS
  'P0-01 guard: blocks normal protected Event updates and permits only service-role maintenance or an exact same-transaction audited PENDING correction.';


CREATE OR REPLACE FUNCTION public.barinv_correct_pending_event(
  p_venue_id uuid,
  p_event_id uuid,
  p_mode text,
  p_qty numeric,
  p_weight_g numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_mode text := upper(trim(COALESCE(p_mode, '')));
  v_event public.events%ROWTYPE;
  v_new_notes text;
  v_weight_text text;
  v_audit_id uuid := gen_random_uuid();
  v_updated_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  IF NOT COALESCE(
    public.has_venue_access(p_venue_id, 'manager'),
    false
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Manager access required for this Venue';
  END IF;

  IF v_mode NOT IN ('QUANTITY', 'WEIGHT') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Correction mode must be QUANTITY or WEIGHT';
  END IF;

  IF p_qty IS NULL
     OR p_qty::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_qty < 1
     OR p_qty <> trunc(p_qty) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Quantity must be a positive integer';
  END IF;

  IF v_mode = 'QUANTITY' AND p_weight_g IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Weight must be null for QUANTITY correction';
  END IF;

  IF v_mode = 'WEIGHT'
     AND (
       p_weight_g IS NULL
       OR p_weight_g::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_weight_g <= 0
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Weight must be a finite number greater than zero';
  END IF;

  SELECT e.*
    INTO v_event
  FROM public.events AS e
  WHERE e.id = p_event_id
    AND e.venue_id = p_venue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Event not found in this Venue';
  END IF;

  IF v_event.status <> 'PENDING' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Event is no longer PENDING';
  END IF;

  IF v_mode = 'QUANTITY' THEN
    v_new_notes := regexp_replace(
      COALESCE(v_event.notes, ''),
      '\[(WEIGHT_G|BOTTLE_STATE|TARE_WEIGHT_G|FULL_WEIGHT_G|REMAINING_PERCENT|LIQUID_WEIGHT_G|REMAINING_ML|WEIGHT_PROFILE_SOURCE|WEIGHT_PROFILE_NEEDED|MEASUREMENT_SOURCE|BARBACK_WEIGHT_MVP)=([^]]*)\]',
      ' ',
      'g'
    );
  ELSE
    v_new_notes := regexp_replace(
      COALESCE(v_event.notes, ''),
      '\[WEIGHT_G=([^]]*)\]',
      ' ',
      'g'
    );

    v_weight_text := p_weight_g::text;
    IF strpos(v_weight_text, '.') > 0 THEN
      v_weight_text := rtrim(rtrim(v_weight_text, '0'), '.');
    END IF;
  END IF;

  v_new_notes := btrim(
    regexp_replace(v_new_notes, '[[:space:]]+', ' ', 'g')
  );

  IF v_mode = 'WEIGHT' THEN
    v_new_notes := concat_ws(
      ' ',
      NULLIF(v_new_notes, ''),
      '[WEIGHT_G=' || v_weight_text || ']'
    );
  END IF;

  v_new_notes := NULLIF(v_new_notes, '');

  INSERT INTO public.event_correction_audit (
    id,
    transaction_id,
    event_id,
    venue_id,
    actor_user_id,
    correction_mode,
    old_qty,
    new_qty,
    old_notes,
    new_notes
  ) VALUES (
    v_audit_id,
    txid_current(),
    v_event.id,
    v_event.venue_id,
    v_actor,
    v_mode,
    v_event.qty,
    p_qty,
    v_event.notes,
    v_new_notes
  );

  PERFORM set_config(
    'barinv.pending_event_correction_token',
    v_audit_id::text,
    true
  );

  UPDATE public.events AS e
     SET qty = p_qty,
         notes = v_new_notes
   WHERE e.id = v_event.id
     AND e.venue_id = p_venue_id
     AND e.status = 'PENDING'
  RETURNING e.id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Event correction lost a concurrent PENDING status race';
  END IF;

  PERFORM set_config(
    'barinv.pending_event_correction_token',
    '',
    true
  );

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'qty', p_qty,
    'notes', v_new_notes,
    'correction_mode', v_mode,
    'weight_g', CASE WHEN v_mode = 'WEIGHT' THEN p_weight_g ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.barinv_correct_pending_event(
  uuid, uuid, text, numeric, numeric
) FROM PUBLIC, anon, authenticated, barback_user;

GRANT EXECUTE ON FUNCTION public.barinv_correct_pending_event(
  uuid, uuid, text, numeric, numeric
) TO authenticated;

COMMENT ON FUNCTION public.barinv_correct_pending_event(
  uuid, uuid, text, numeric, numeric
) IS
  'Manager-only atomic correction of qty/scale notes on one locked PENDING Event, with an append-only same-transaction audit record.';

NOTIFY pgrst, 'reload schema';

COMMIT;
