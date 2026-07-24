-- Fix ambiguous column reference in barback_confirm_opening_par.
-- The function RETURNS TABLE exposes destination_id/staff_id/item_id names,
-- so the INSERT conflict target must reference the named table constraint.

CREATE OR REPLACE FUNCTION public.barback_confirm_opening_par(
  p_session_id uuid,
  p_venue_id uuid,
  p_night_id uuid,
  p_staff_id uuid,
  p_destination_id uuid,
  p_item_id uuid,
  p_received_quantity numeric,
  p_ip text,
  p_user_agent text
)
RETURNS TABLE (
  destination_id uuid,
  staff_id uuid,
  item_id uuid,
  expected_quantity integer,
  received_quantity text,
  confirmed_at timestamptz,
  variance text,
  required_count integer,
  confirmed_count integer,
  remaining_count integer,
  completed boolean,
  completed_at timestamptz,
  completed_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.barback_sessions%ROWTYPE;
  v_receipt public.barback_opening_par_receipts%ROWTYPE;
  v_completion public.barback_opening_par_completions%ROWTYPE;
  v_destination_ids uuid[] := ARRAY[]::uuid[];
  v_expected_quantity integer;
  v_item_match_count integer := 0;
  v_item_count integer := 0;
  v_destination_count integer := 0;
  v_required_count integer := 0;
  v_confirmed_count integer := 0;
  v_receipt_created boolean := false;
  v_completion_created boolean := false;
BEGIN
  IF p_received_quantity IS NULL OR p_received_quantity < 0
     OR p_received_quantity <> trunc(p_received_quantity) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023', MESSAGE = 'received quantity must be a whole number greater than or equal to zero';
  END IF;

  IF NOT public.barback_opening_par_runtime_enabled(p_venue_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Opening PAR runtime gate is disabled';
  END IF;

  SELECT s.*
    INTO v_session
  FROM public.barback_sessions AS s
  WHERE s.id = p_session_id
    AND s.venue_id = p_venue_id
    AND s.night_id = p_night_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Opening PAR session not found';
  END IF;
  IF v_session.revoked_at IS NOT NULL OR v_session.expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Opening PAR session is inactive';
  END IF;
  IF NOT (p_staff_id = ANY(v_session.allowed_staff)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff is outside this session';
  END IF;
  IF v_session.opening_par_config IS NULL
     OR NOT (v_session.opening_par_config @> '{"enabled":true,"version":1}'::jsonb)
     OR jsonb_typeof(v_session.opening_par_config -> 'items') <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Opening PAR is unavailable for this session';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.nights AS n
    WHERE n.id = p_night_id AND n.venue_id = p_venue_id AND n.active IS TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Opening PAR night is inactive';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.staff AS st
    WHERE st.id = p_staff_id AND st.venue_id = p_venue_id AND st.active IS TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Opening PAR staff is inactive';
  END IF;

  SELECT COALESCE(array_agg(scope.destination_id ORDER BY scope.destination_id), ARRAY[]::uuid[])
    INTO v_destination_ids
  FROM (
    SELECT v_session.bar_id AS destination_id
    WHERE v_session.bar_id IS NOT NULL
    UNION
    SELECT unnest(COALESCE(v_session.allowed_bars, ARRAY[]::uuid[]))
  ) AS scope;

  IF NOT (p_destination_id = ANY(v_destination_ids)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'destination is outside this session';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.bars AS b
    JOIN public.night_bars AS nb
      ON nb.bar_id = b.id AND nb.night_id = p_night_id
    WHERE b.id = p_destination_id
      AND b.venue_id = p_venue_id
      AND b.active IS TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'destination is inactive for this night';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.items AS i
    WHERE i.id = p_item_id AND i.venue_id = p_venue_id AND i.active IS TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'item is inactive or outside this venue';
  END IF;

  SELECT
    count(*)::integer,
    min(
      CASE
        WHEN jsonb_typeof(entry.value -> 'qty') = 'number'
         AND (entry.value ->> 'qty') ~ '^[0-9]+$'
        THEN (entry.value ->> 'qty')::integer
        ELSE NULL
      END
    )
    INTO v_item_match_count, v_expected_quantity
  FROM jsonb_array_elements(v_session.opening_par_config -> 'items') AS entry(value)
  WHERE entry.value ->> 'item_id' = p_item_id::text;

  IF v_item_match_count <> 1 OR v_expected_quantity IS NULL OR v_expected_quantity <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'item is outside this Opening PAR snapshot';
  END IF;

  -- Serialize confirmations only for this staff/session. This prevents two
  -- concurrent final-item confirmations from both missing completion creation.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_session_id::text || ':' || p_staff_id::text, 0)
  );

  INSERT INTO public.barback_opening_par_receipts (
    session_id, destination_id, staff_id, item_id,
    expected_quantity, received_quantity, confirmed_at
  ) VALUES (
    p_session_id, p_destination_id, p_staff_id, p_item_id,
    v_expected_quantity, p_received_quantity, now()
  )
  ON CONFLICT ON CONSTRAINT barback_opening_par_receipts_pkey DO NOTHING
  RETURNING * INTO v_receipt;

  v_receipt_created := FOUND;
  IF NOT v_receipt_created THEN
    SELECT r.*
      INTO v_receipt
    FROM public.barback_opening_par_receipts AS r
    WHERE r.session_id = p_session_id
      AND r.destination_id = p_destination_id
      AND r.staff_id = p_staff_id
      AND r.item_id = p_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'confirmation retry could not be reconstructed';
    END IF;
    IF v_receipt.received_quantity <> p_received_quantity THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505', MESSAGE = 'item was already confirmed with a different received quantity';
    END IF;
  ELSE
    INSERT INTO public.barback_audit_log (
      session_id, staff_id, action, ip, user_agent, detail
    ) VALUES (
      p_session_id,
      p_staff_id,
      'opening_par_received',
      p_ip,
      p_user_agent,
      jsonb_build_object(
        'destination_id', p_destination_id,
        'item_id', p_item_id,
        'expected_quantity', v_expected_quantity,
        'received_quantity', p_received_quantity,
        'variance', p_received_quantity - v_expected_quantity
      )
    );
  END IF;

  SELECT count(DISTINCT entry.value ->> 'item_id')::integer
    INTO v_item_count
  FROM jsonb_array_elements(v_session.opening_par_config -> 'items') AS entry(value)
  WHERE CASE
      WHEN jsonb_typeof(entry.value -> 'qty') = 'number'
       AND (entry.value ->> 'qty') ~ '^[0-9]+$'
      THEN (entry.value ->> 'qty')::integer > 0
      ELSE false
    END
    AND (entry.value ->> 'item_id') IS NOT NULL;

  v_destination_count := COALESCE(array_length(v_destination_ids, 1), 0);
  v_required_count := v_item_count * v_destination_count;
  IF v_required_count <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Opening PAR checklist has no required rows';
  END IF;

  SELECT count(*)::integer
    INTO v_confirmed_count
  FROM public.barback_opening_par_receipts AS r
  WHERE r.session_id = p_session_id
    AND r.staff_id = p_staff_id
    AND r.destination_id = ANY(v_destination_ids)
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_session.opening_par_config -> 'items') AS entry(value)
      WHERE entry.value ->> 'item_id' = r.item_id::text
        AND CASE
          WHEN jsonb_typeof(entry.value -> 'qty') = 'number'
           AND (entry.value ->> 'qty') ~ '^[0-9]+$'
          THEN (entry.value ->> 'qty')::integer > 0
          ELSE false
        END
    );

  IF v_confirmed_count = v_required_count THEN
    INSERT INTO public.barback_opening_par_completions (
      session_id, staff_id, completed_by, completed_at, confirmed_row_count
    ) VALUES (
      p_session_id, p_staff_id, p_staff_id, now(), v_confirmed_count
    )
    ON CONFLICT ON CONSTRAINT barback_opening_par_completions_pkey DO NOTHING
    RETURNING * INTO v_completion;

    v_completion_created := FOUND;
    IF NOT v_completion_created THEN
      SELECT c.*
        INTO v_completion
      FROM public.barback_opening_par_completions AS c
      WHERE c.session_id = p_session_id AND c.staff_id = p_staff_id;
    ELSE
      INSERT INTO public.barback_audit_log (
        session_id, staff_id, action, ip, user_agent, detail
      ) VALUES (
        p_session_id,
        p_staff_id,
        'opening_par_completed',
        p_ip,
        p_user_agent,
        jsonb_build_object('confirmed_row_count', v_confirmed_count)
      );
    END IF;
  ELSE
    SELECT c.*
      INTO v_completion
    FROM public.barback_opening_par_completions AS c
    WHERE c.session_id = p_session_id AND c.staff_id = p_staff_id;
  END IF;

  RETURN QUERY SELECT
    v_receipt.destination_id,
    v_receipt.staff_id,
    v_receipt.item_id,
    v_receipt.expected_quantity,
    v_receipt.received_quantity::text,
    v_receipt.confirmed_at,
    (v_receipt.received_quantity - v_receipt.expected_quantity)::text,
    v_required_count,
    v_confirmed_count,
    GREATEST(v_required_count - v_confirmed_count, 0),
    v_completion.session_id IS NOT NULL,
    v_completion.completed_at,
    v_completion.completed_by;
END;
$$;
