-- BARINV PRO: prevent malformed bottle-weight metadata on new Event writes.
-- INSERT and metadata/quantity UPDATE validation only; historical rows are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.barinv_events_guard_metadata_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_notes text := COALESCE(NEW.notes, '');
  v_state text;
  v_weight text;
  v_tare text;
  v_full text;
  v_remaining text;
  v_weight_n numeric;
  v_tare_n numeric;
  v_full_n numeric;
  v_remaining_n numeric;
  v_has_metadata boolean;
BEGIN
  v_has_metadata := v_notes ~ E'\\[(WEIGHT_G|BOTTLE_STATE|TARE_WEIGHT_G|FULL_WEIGHT_G|REMAINING_PERCENT|LIQUID_WEIGHT_G|REMAINING_ML)=';

  IF NOT v_has_metadata THEN
    RETURN NEW;
  END IF;

  IF NEW.qty IS DISTINCT FROM 1::numeric THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Single-bottle metadata requires quantity 1';
  END IF;

  SELECT (regexp_match(v_notes, E'\\[BOTTLE_STATE=([^\\]\\r\\n]*)\\]'))[1] INTO v_state;
  SELECT (regexp_match(v_notes, E'\\[WEIGHT_G=([^\\]\\r\\n]*)\\]'))[1] INTO v_weight;
  SELECT (regexp_match(v_notes, E'\\[TARE_WEIGHT_G=([^\\]\\r\\n]*)\\]'))[1] INTO v_tare;
  SELECT (regexp_match(v_notes, E'\\[FULL_WEIGHT_G=([^\\]\\r\\n]*)\\]'))[1] INTO v_full;
  SELECT (regexp_match(v_notes, E'\\[REMAINING_PERCENT=([^\\]\\r\\n]*)\\]'))[1] INTO v_remaining;

  IF v_weight IS NOT NULL THEN
    IF btrim(v_weight) !~ '^[+]?[0-9]+(\\.[0-9]+)?$' OR btrim(v_weight)::numeric <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WEIGHT_G must be a finite positive number';
    END IF;
    v_weight_n := btrim(v_weight)::numeric;
  END IF;

  IF (v_tare IS NULL) <> (v_full IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TARE_WEIGHT_G and FULL_WEIGHT_G must be provided together';
  END IF;
  IF v_tare IS NOT NULL THEN
    IF btrim(v_tare) !~ '^[+]?[0-9]+(\\.[0-9]+)?$'
       OR btrim(v_full) !~ '^[+]?[0-9]+(\\.[0-9]+)?$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Bottle weight profile must be finite numeric data';
    END IF;
    v_tare_n := btrim(v_tare)::numeric;
    v_full_n := btrim(v_full)::numeric;
    IF v_full_n <= v_tare_n THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FULL_WEIGHT_G must be greater than TARE_WEIGHT_G';
    END IF;
    IF v_weight_n IS NOT NULL AND v_weight_n < v_tare_n THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WEIGHT_G cannot be below TARE_WEIGHT_G';
    END IF;
  END IF;

  IF v_remaining IS NOT NULL THEN
    IF btrim(v_remaining) !~ '^[+]?[0-9]+(\\.[0-9]+)?$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REMAINING_PERCENT must be finite numeric data';
    END IF;
    v_remaining_n := btrim(v_remaining)::numeric;
    IF v_remaining_n < 0 OR v_remaining_n > 100 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REMAINING_PERCENT must be between 0 and 100';
    END IF;
    IF upper(btrim(COALESCE(v_state, ''))) = 'PARTIAL' AND v_remaining_n >= 100 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PARTIAL bottle must be less than 100% full';
    END IF;
  END IF;

  IF upper(btrim(COALESCE(v_state, ''))) = 'PARTIAL'
     AND v_weight_n IS NOT NULL
     AND v_full_n IS NOT NULL
     AND v_weight_n > v_full_n THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PARTIAL weight cannot exceed FULL_WEIGHT_G';
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_events_02_metadata_contract ON public.events;
CREATE TRIGGER trg_events_02_metadata_contract
BEFORE INSERT OR UPDATE OF qty, notes ON public.events
FOR EACH ROW EXECUTE FUNCTION public.barinv_events_guard_metadata_contract();

REVOKE ALL ON FUNCTION public.barinv_events_guard_metadata_contract() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.barinv_events_guard_metadata_contract() TO service_role;

COMMIT;
