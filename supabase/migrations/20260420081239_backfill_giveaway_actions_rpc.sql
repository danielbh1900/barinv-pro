-- Historical backfill for pre-phase-1 ADJUSTMENT rows that we can
-- deterministically reclassify as COMP or SHOT based on the exact notes
-- prefix the dispatch UI used to write. Ambiguous ADJUSTMENT rows are
-- LEFT ALONE by design — no guessing.
--
-- Returns jsonb { comp_updated: int, shot_updated: int }.
CREATE OR REPLACE FUNCTION public.backfill_giveaway_actions(v_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  comp_count int := 0;
  shot_count int := 0;
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_venue_access(v_venue_id, 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required on this venue';
  END IF;

  WITH upd AS (
    UPDATE public.events
       SET action = 'COMP',
           reason_code = COALESCE(reason_code, 'other'),
           qty_basis   = COALESCE(qty_basis,   'shot')
     WHERE venue_id = v_venue_id
       AND action = 'ADJUSTMENT'
       AND notes LIKE 'COMP from %'
    RETURNING 1
  )
  SELECT count(*) INTO comp_count FROM upd;

  WITH upd AS (
    UPDATE public.events
       SET action = 'SHOT',
           reason_code = COALESCE(reason_code, 'staff_shot'),
           qty_basis   = COALESCE(qty_basis,   'shot')
     WHERE venue_id = v_venue_id
       AND action = 'ADJUSTMENT'
       AND notes LIKE 'SHOT from %'
    RETURNING 1
  )
  SELECT count(*) INTO shot_count FROM upd;

  RETURN jsonb_build_object(
    'venue_id', v_venue_id,
    'comp_updated', comp_count,
    'shot_updated', shot_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_giveaway_actions(uuid) TO authenticated;;
