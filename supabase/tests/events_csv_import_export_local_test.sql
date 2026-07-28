-- BARINV PRO local-only Events CSV import/export validation.
--
-- Run only against the disposable harness:
--   barinv_event_review_pgtest_20260727 / 127.0.0.1:54332
--
-- The script creates fixed-ID test fixtures, simulates Supabase JWT
-- claims with SET LOCAL/session config, and raises on the first failed
-- assertion.

\set ON_ERROR_STOP on
\pset pager off

CREATE TEMP TABLE events_csv_test_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TEMP TABLE events_csv_test_state (
  key text PRIMARY KEY,
  uuid_value uuid,
  json_value jsonb,
  int_value integer
);

GRANT SELECT, INSERT, UPDATE, DELETE ON events_csv_test_results TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON events_csv_test_state TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.ok(
  p_name text,
  p_condition boolean,
  p_detail text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'FAIL [%]: %', p_name, COALESCE(p_detail, 'assertion returned false');
  END IF;

  INSERT INTO events_csv_test_results(test_name, passed, detail)
  VALUES (p_name, true, p_detail)
  ON CONFLICT (test_name) DO UPDATE
    SET passed = EXCLUDED.passed,
        detail = EXCLUDED.detail,
        recorded_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(
  p_name text,
  p_sql text,
  p_match text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF p_match IS NOT NULL
       AND position(lower(p_match) in lower(SQLERRM)) = 0 THEN
      RAISE EXCEPTION 'FAIL [%]: expected error containing "%", got "%"', p_name, p_match, SQLERRM;
    END IF;

    INSERT INTO events_csv_test_results(test_name, passed, detail)
    VALUES (p_name, true, SQLERRM)
    ON CONFLICT (test_name) DO UPDATE
      SET passed = EXCLUDED.passed,
          detail = EXCLUDED.detail,
          recorded_at = now();
    RETURN;
  END;

  RAISE EXCEPTION 'FAIL [%]: expected an error but statement succeeded', p_name;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.set_claims(
  p_role text,
  p_uid uuid,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_claims jsonb;
BEGIN
  v_claims :=
    COALESCE(p_extra, '{}'::jsonb)
    || jsonb_build_object(
      'role', p_role,
      'sub', p_uid::text,
      'email', 'events-csv-local-' || replace(p_uid::text, '-', '') || '@barinv.local.test'
    );

  PERFORM set_config('request.jwt.claim.role', p_role, false);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, false);
  PERFORM set_config('request.jwt.claim.email', v_claims ->> 'email', false);
  PERFORM set_config('request.jwt.claims', v_claims::text, false);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.csv_test_event_count(
  p_client_prefix text,
  p_status text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM public.events AS e
  WHERE e.client_event_id LIKE p_client_prefix || '%'
    AND (
      p_status IS NULL
      OR e.status = p_status
    );
$$;

RESET ROLE;

DROP TRIGGER IF EXISTS events_csv_local_failure_injector_20260728
  ON public.events;
DROP FUNCTION IF EXISTS public.events_csv_local_failure_injector_20260728();

DELETE FROM public.event_csv_import_batches
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.event_review_audit
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.events
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
)
OR client_event_id LIKE 'events-csv-local-%';

DELETE FROM public.barback_sessions
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.night_bars
WHERE night_id IN (
  '95000000-0000-4001-8000-000000000001'::uuid,
  '95000000-0000-4001-8000-000000000002'::uuid,
  '95000000-0000-4001-8000-000000000102'::uuid
);

DELETE FROM public.venue_members
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
)
OR user_id IN (
  '95100000-0000-4000-8000-000000000001'::uuid,
  '95100000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.stations
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.staff
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.items
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.bars
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.nights
WHERE venue_id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.venues
WHERE id IN (
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM auth.users
WHERE id IN (
  '95100000-0000-4000-8000-000000000001'::uuid,
  '95100000-0000-4000-8000-000000000002'::uuid
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES
  (
    '95100000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'events-csv-manager@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"events_csv_manager"}'::jsonb,
    now(),
    now()
  ),
  (
    '95100000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'events-csv-unauthorized@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"events_csv_unauthorized"}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.venues (id, name, currency, active, barback_opening_par_enabled)
VALUES
  ('95000000-0000-4000-8000-000000000001'::uuid, 'EVENTS CSV LOCAL TEST VENUE', 'CAD', true, false),
  ('95000000-0000-4000-8000-000000000002'::uuid, 'EVENTS CSV OTHER VENUE', 'CAD', true, false);

INSERT INTO public.nights (id, venue_id, name, date, code, active)
VALUES
  ('95000000-0000-4001-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, 'EVENTS CSV MAIN NIGHT', current_date, 'CSV-MAIN', true),
  ('95000000-0000-4001-8000-000000000002'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, 'EVENTS CSV OTHER NIGHT', current_date, 'CSV-OTHER', true),
  ('95000000-0000-4001-8000-000000000102'::uuid, '95000000-0000-4000-8000-000000000002'::uuid, 'EVENTS CSV CROSS VENUE NIGHT', current_date, 'CSV-XVENUE', true);

INSERT INTO public.bars (id, venue_id, name, active, bar_type)
VALUES
  ('95000000-0000-4002-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, 'EVENTS CSV MAIN BAR', true, 'bar'),
  ('95000000-0000-4002-8000-000000000002'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, 'EVENTS CSV OTHER NIGHT BAR', true, 'bar'),
  ('95000000-0000-4002-8000-000000000102'::uuid, '95000000-0000-4000-8000-000000000002'::uuid, 'EVENTS CSV CROSS VENUE BAR', true, 'bar');

INSERT INTO public.night_bars (night_id, bar_id, bar_name_at)
VALUES
  ('95000000-0000-4001-8000-000000000001'::uuid, '95000000-0000-4002-8000-000000000001'::uuid, 'EVENTS CSV MAIN BAR'),
  ('95000000-0000-4001-8000-000000000002'::uuid, '95000000-0000-4002-8000-000000000002'::uuid, 'EVENTS CSV OTHER NIGHT BAR'),
  ('95000000-0000-4001-8000-000000000102'::uuid, '95000000-0000-4002-8000-000000000102'::uuid, 'EVENTS CSV CROSS VENUE BAR');

INSERT INTO public.stations (id, venue_id, bar_id, name, active)
VALUES
  ('95000000-0000-4005-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4002-8000-000000000001'::uuid, 'EVENTS CSV MAIN STATION', true),
  ('95000000-0000-4005-8000-000000000002'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4002-8000-000000000002'::uuid, 'EVENTS CSV OTHER STATION', true),
  ('95000000-0000-4005-8000-000000000102'::uuid, '95000000-0000-4000-8000-000000000002'::uuid, '95000000-0000-4002-8000-000000000102'::uuid, 'EVENTS CSV CROSS VENUE STATION', true);

INSERT INTO public.items (id, venue_id, name, unit, active, service_mode)
VALUES
  ('95000000-0000-4003-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, 'EVENTS CSV MAIN ITEM', 'bottle', true, 'regular_bar'),
  ('95000000-0000-4003-8000-000000000102'::uuid, '95000000-0000-4000-8000-000000000002'::uuid, 'EVENTS CSV CROSS VENUE ITEM', 'bottle', true, 'regular_bar');

INSERT INTO public.staff (id, venue_id, name, role, active, auth_user_id)
VALUES
  ('95000000-0000-4004-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, 'Events CSV Staff', 'barback', true, NULL),
  ('95000000-0000-4004-8000-000000000002'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, 'Events CSV Manager Staff', 'manager', true, '95100000-0000-4000-8000-000000000001'::uuid),
  ('95000000-0000-4004-8000-000000000102'::uuid, '95000000-0000-4000-8000-000000000002'::uuid, 'Events CSV Other Staff', 'manager', true, '95100000-0000-4000-8000-000000000002'::uuid);

INSERT INTO public.venue_members (user_id, venue_id, role, created_by)
VALUES
  ('95100000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, 'manager', '95100000-0000-4000-8000-000000000001'::uuid),
  ('95100000-0000-4000-8000-000000000002'::uuid, '95000000-0000-4000-8000-000000000002'::uuid, 'manager', '95100000-0000-4000-8000-000000000002'::uuid);

INSERT INTO public.barback_sessions (
  id,
  venue_id,
  night_id,
  bar_id,
  allowed_bars,
  allowed_staff,
  nickname,
  issued_by,
  expires_at,
  auto_approve_events
) VALUES (
  '95200000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4001-8000-000000000001'::uuid,
  '95000000-0000-4002-8000-000000000001'::uuid,
  ARRAY['95000000-0000-4002-8000-000000000001'::uuid],
  ARRAY['95000000-0000-4004-8000-000000000001'::uuid],
  'csv auto approve should not apply',
  '95000000-0000-4004-8000-000000000002'::uuid,
  now() + interval '2 hours',
  true
);

INSERT INTO public.events (
  id,
  venue_id,
  night_id,
  bar_id,
  station_id,
  item_id,
  staff_id,
  submitted_by,
  qty,
  action,
  status,
  notes,
  client_event_id
) VALUES
  ('95300000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4001-8000-000000000001'::uuid, '95000000-0000-4002-8000-000000000001'::uuid, '95000000-0000-4005-8000-000000000001'::uuid, '95000000-0000-4003-8000-000000000001'::uuid, '95000000-0000-4004-8000-000000000001'::uuid, 'export one', 1.2500, 'REQUEST', 'PENDING', '=formula note', 'events-csv-local-export-1'),
  ('95300000-0000-4000-8000-000000000002'::uuid, '95000000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4001-8000-000000000001'::uuid, '95000000-0000-4002-8000-000000000001'::uuid, NULL, '95000000-0000-4003-8000-000000000001'::uuid, '95000000-0000-4004-8000-000000000001'::uuid, 'export two', 2.500, 'DELIVERED', 'APPROVED', 'export two', 'events-csv-local-export-2'),
  ('95300000-0000-4000-8000-000000000102'::uuid, '95000000-0000-4000-8000-000000000002'::uuid, '95000000-0000-4001-8000-000000000102'::uuid, '95000000-0000-4002-8000-000000000102'::uuid, '95000000-0000-4005-8000-000000000102'::uuid, '95000000-0000-4003-8000-000000000102'::uuid, '95000000-0000-4004-8000-000000000102'::uuid, 'other venue export', 1, 'REQUEST', 'PENDING', 'other venue export', 'events-csv-local-export-other');

INSERT INTO public.events (
  venue_id,
  night_id,
  bar_id,
  station_id,
  item_id,
  staff_id,
  submitted_by,
  qty,
  action,
  status,
  notes,
  client_event_id
)
SELECT
  '95000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4001-8000-000000000001'::uuid,
  '95000000-0000-4002-8000-000000000001'::uuid,
  '95000000-0000-4005-8000-000000000001'::uuid,
  '95000000-0000-4003-8000-000000000001'::uuid,
  '95000000-0000-4004-8000-000000000001'::uuid,
  'export beyond 1000',
  (gs::numeric / 1000),
  'RETURNED',
  'PENDING',
  'export all matching beyond 1000',
  'events-csv-local-export-many-' || gs::text
FROM generate_series(1, 1005) AS gs;

SELECT pg_temp.ok(
  'fixtures_created',
  (SELECT count(*) FROM public.venues WHERE id = '95000000-0000-4000-8000-000000000001'::uuid) = 1
  AND (SELECT count(*) FROM public.night_bars WHERE night_id = '95000000-0000-4001-8000-000000000001'::uuid) = 1
  AND (SELECT count(*) FROM public.events WHERE client_event_id LIKE 'events-csv-local-export-many-%') = 1005,
  'CSV test venue, night, scoped bars, stations, items, staff, session, and export rows inserted'
);

SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '95100000-0000-4000-8000-000000000002'::uuid);

SELECT pg_temp.expect_error(
  'unauthorized_import_preview_rejected',
  $$SELECT public.barinv_create_event_csv_import_batch(
      '95000000-0000-4000-8000-000000000001'::uuid,
      '95000000-0000-4001-8000-000000000001'::uuid,
      '[]'::jsonb,
      'unauthorized.csv'
    )$$,
  'Manager access'
);

SELECT pg_temp.expect_error(
  'unauthorized_export_rejected',
  $$SELECT public.barinv_export_events_csv_page(
      '95000000-0000-4000-8000-000000000001'::uuid,
      '95000000-0000-4001-8000-000000000001'::uuid
    )$$,
  'Manager access'
);

SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '95100000-0000-4000-8000-000000000001'::uuid);

WITH zero_preview AS (
  SELECT public.barinv_create_event_csv_import_batch(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    '[]'::jsonb,
    'headers-only.csv'
  ) AS j
)
SELECT pg_temp.ok(
  'zero_data_rows_preview_has_no_batch',
  (SELECT j ->> 'batch_id' IS NULL
   AND (j ->> 'total_rows')::integer = 0
   AND (j ->> 'can_confirm')::boolean IS FALSE
   FROM zero_preview)
  AND (SELECT count(*) FROM public.event_csv_import_batches WHERE venue_id = '95000000-0000-4000-8000-000000000001'::uuid) = 0,
  'headers-only import returns total_rows=0 and creates no durable batch'
);

SELECT pg_temp.expect_error(
  'non_array_import_payload_rejected',
  $$SELECT public.barinv_create_event_csv_import_batch(
      '95000000-0000-4000-8000-000000000001'::uuid,
      '95000000-0000-4001-8000-000000000001'::uuid,
      '{}'::jsonb,
      'not-array.csv'
    )$$,
  'JSON array'
);

WITH preview AS (
  SELECT public.barinv_create_event_csv_import_batch(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    jsonb_build_array(jsonb_build_object(
      '_csv_row_number', 2,
      'client_event_id', 'events-csv-local-import-one',
      'bar_id', '95000000-0000-4002-8000-000000000001',
      'station_id', '95000000-0000-4005-8000-000000000001',
      'item_id', '95000000-0000-4003-8000-000000000001',
      'staff_id', '95000000-0000-4004-8000-000000000001',
      'session_id', '95200000-0000-4000-8000-000000000001',
      'action', 'request',
      'qty', '1.2500',
      'qty_basis', 'SHOT',
      'notes', 'valid import',
      'submitted_by', 'CSV Tester'
    )),
    'one-row.csv'
  ) AS j
)
INSERT INTO events_csv_test_state(key, uuid_value, json_value)
SELECT 'batch_one', (j ->> 'batch_id')::uuid, j
FROM preview;

SELECT pg_temp.ok(
  'one_row_valid_preview',
  (SELECT (json_value ->> 'total_rows')::integer = 1
      AND (json_value ->> 'valid_rows')::integer = 1
      AND (json_value ->> 'invalid_rows')::integer = 0
      AND (json_value ->> 'can_confirm')::boolean IS TRUE
   FROM events_csv_test_state WHERE key = 'batch_one')
);

INSERT INTO events_csv_test_state(key, json_value)
SELECT
  'batch_one_processed',
  public.barinv_process_event_csv_import_batch(
    (SELECT uuid_value FROM events_csv_test_state WHERE key = 'batch_one'),
    500
  )
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

SELECT pg_temp.ok(
  'one_row_import_inserts_pending_event',
  (SELECT (json_value ->> 'inserted_rows')::integer = 1
      AND json_value ->> 'status' = 'completed'
   FROM events_csv_test_state WHERE key = 'batch_one_processed')
  AND (SELECT count(*) = 1 FROM public.events WHERE client_event_id = 'events-csv-local-import-one' AND status = 'PENDING' AND source = 'admin_csv_import')
  AND (SELECT count(*) = 0 FROM public.event_review_audit WHERE event_id = (SELECT id FROM public.events WHERE client_event_id = 'events-csv-local-import-one')),
  'CSV import inserted one PENDING Event and did not create review audit rows'
);

SELECT pg_temp.ok(
  'admin_csv_import_does_not_trigger_barback_auto_approve',
  (SELECT status = 'PENDING' FROM public.events WHERE client_event_id = 'events-csv-local-import-one')
);

WITH status_preview AS (
  SELECT public.barinv_create_event_csv_import_batch(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    '[{"_csv_row_number":2,"client_event_id":"events-csv-local-status-override","bar_id":"95000000-0000-4002-8000-000000000001","item_id":"95000000-0000-4003-8000-000000000001","action":"REQUEST","qty":"1","status":"APPROVED"}]'::jsonb,
    'status-override.csv'
  ) AS j
)
SELECT pg_temp.ok(
  'csv_status_override_rejected',
  (SELECT (j ->> 'valid_rows')::integer = 0
      AND (j ->> 'invalid_rows')::integer = 1
      AND j -> 'error_rows' -> 0 ->> 'validation_code' = 'status_not_allowed'
   FROM status_preview)
  AND pg_temp.csv_test_event_count('events-csv-local-status-override') = 0
);

WITH invalid_preview AS (
  SELECT public.barinv_create_event_csv_import_batch(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    jsonb_build_array(
      jsonb_build_object('_csv_row_number', 2, 'client_event_id', 'events-csv-local-cross-venue-bar', 'bar_id', '95000000-0000-4002-8000-000000000102', 'item_id', '95000000-0000-4003-8000-000000000001', 'action', 'REQUEST', 'qty', '1'),
      jsonb_build_object('_csv_row_number', 3, 'client_event_id', 'events-csv-local-cross-venue-item', 'bar_id', '95000000-0000-4002-8000-000000000001', 'item_id', '95000000-0000-4003-8000-000000000102', 'action', 'REQUEST', 'qty', '1'),
      jsonb_build_object('_csv_row_number', 4, 'client_event_id', 'events-csv-local-cross-night-bar', 'bar_id', '95000000-0000-4002-8000-000000000002', 'item_id', '95000000-0000-4003-8000-000000000001', 'action', 'REQUEST', 'qty', '1'),
      jsonb_build_object('_csv_row_number', 5, 'client_event_id', 'events-csv-local-dangerous', 'bar_id', '95000000-0000-4002-8000-000000000001', 'item_id', '95000000-0000-4003-8000-000000000001', 'action', 'REQUEST', 'qty', '1', 'notes', '=cmd')
    ),
    'invalid.csv'
  ) AS j
)
SELECT pg_temp.ok(
  'invalid_rows_report_exact_errors',
  (SELECT (j ->> 'valid_rows')::integer = 0
      AND (j ->> 'invalid_rows')::integer = 4
      AND j -> 'error_rows' @> '[{"validation_code":"cross_night_bar"}]'::jsonb
      AND j -> 'error_rows' @> '[{"validation_code":"cross_venue_item"}]'::jsonb
      AND j -> 'error_rows' @> '[{"validation_code":"dangerous_text"}]'::jsonb
   FROM invalid_preview)
);

WITH duplicate_preview AS (
  SELECT public.barinv_create_event_csv_import_batch(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    jsonb_build_array(
      jsonb_build_object('_csv_row_number', 2, 'client_event_id', 'events-csv-local-dupe-in-file', 'bar_id', '95000000-0000-4002-8000-000000000001', 'item_id', '95000000-0000-4003-8000-000000000001', 'action', 'REQUEST', 'qty', '1'),
      jsonb_build_object('_csv_row_number', 3, 'client_event_id', 'events-csv-local-dupe-in-file', 'bar_id', '95000000-0000-4002-8000-000000000001', 'item_id', '95000000-0000-4003-8000-000000000001', 'action', 'REQUEST', 'qty', '1')
    ),
    'duplicate.csv'
  ) AS j
)
SELECT pg_temp.ok(
  'duplicate_client_event_id_in_file_skipped',
  (SELECT (j ->> 'valid_rows')::integer = 1
      AND (j ->> 'duplicate_rows')::integer = 1
      AND j -> 'error_rows' -> 0 ->> 'validation_code' = 'duplicate_in_file'
   FROM duplicate_preview)
);

WITH existing_duplicate AS (
  SELECT public.barinv_create_event_csv_import_batch(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    '[{"_csv_row_number":2,"client_event_id":"events-csv-local-import-one","bar_id":"95000000-0000-4002-8000-000000000001","item_id":"95000000-0000-4003-8000-000000000001","action":"REQUEST","qty":"1"}]'::jsonb,
    'existing-duplicate.csv'
  ) AS j
)
SELECT pg_temp.ok(
  'reimport_existing_client_event_id_is_duplicate',
  (SELECT (j ->> 'valid_rows')::integer = 0
      AND (j ->> 'duplicate_rows')::integer = 1
      AND (j ->> 'can_confirm')::boolean IS FALSE
   FROM existing_duplicate)
  AND pg_temp.csv_test_event_count('events-csv-local-import-one') = 1
);

WITH all_invalid AS (
  SELECT public.barinv_process_event_csv_import_batch(
    (SELECT (j ->> 'batch_id')::uuid
     FROM (
       SELECT public.barinv_create_event_csv_import_batch(
         '95000000-0000-4000-8000-000000000001'::uuid,
         '95000000-0000-4001-8000-000000000001'::uuid,
         '[{"_csv_row_number":2,"client_event_id":"events-csv-local-all-invalid","bar_id":"not-a-uuid","item_id":"95000000-0000-4003-8000-000000000001","action":"REQUEST","qty":"1"}]'::jsonb,
         'all-invalid.csv'
       ) AS j
     ) AS created),
    500
  ) AS j
)
SELECT pg_temp.ok(
  'all_invalid_import_creates_no_events',
  (SELECT (j ->> 'inserted_rows')::integer = 0
      AND (j ->> 'status') = 'completed_with_errors'
   FROM all_invalid)
  AND pg_temp.csv_test_event_count('events-csv-local-all-invalid') = 0
);

WITH selected_export AS (
  SELECT public.barinv_export_events_csv_page(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    NULL,
    NULL,
    NULL,
    ARRAY['95300000-0000-4000-8000-000000000001'::uuid],
    500,
    0
  ) AS j
)
SELECT pg_temp.ok(
  'export_selected_rows_with_exact_qty_text',
  (SELECT (j ->> 'total_rows')::integer = 1
      AND j -> 'rows' -> 0 ->> 'event_id' = '95300000-0000-4000-8000-000000000001'
      AND j -> 'rows' -> 0 ->> 'qty' = '1.2500'
      AND j -> 'rows' -> 0 ->> 'venue_name' = 'EVENTS CSV LOCAL TEST VENUE'
   FROM selected_export)
);

WITH page_export AS (
  SELECT public.barinv_export_events_csv_page(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    NULL,
    NULL,
    NULL,
    ARRAY[
      '95300000-0000-4000-8000-000000000001'::uuid,
      '95300000-0000-4000-8000-000000000002'::uuid
    ],
    500,
    0
  ) AS j
)
SELECT pg_temp.ok(
  'export_current_page_scope',
  (SELECT (j ->> 'total_rows')::integer = 2
      AND jsonb_array_length(j -> 'rows') = 2
   FROM page_export)
);

WITH export_zero AS (
  SELECT public.barinv_export_events_csv_page(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    NULL,
    'REJECTED',
    'WASTE',
    NULL,
    500,
    0
  ) AS j
)
SELECT pg_temp.ok(
  'export_zero_matching_rows_returns_zero_without_rows',
  (SELECT (j ->> 'total_rows')::integer = 0
      AND jsonb_array_length(j -> 'rows') = 0
   FROM export_zero)
);

WITH p1 AS (
  SELECT public.barinv_export_events_csv_page(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    NULL,
    'PENDING',
    'RETURNED',
    NULL,
    500,
    0
  ) AS j
),
p2 AS (
  SELECT public.barinv_export_events_csv_page(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    NULL,
    'PENDING',
    'RETURNED',
    NULL,
    500,
    500
  ) AS j
),
p3 AS (
  SELECT public.barinv_export_events_csv_page(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    NULL,
    'PENDING',
    'RETURNED',
    NULL,
    500,
    1000
  ) AS j
)
SELECT pg_temp.ok(
  'export_all_matching_beyond_1000_uses_pagination',
  (SELECT (j ->> 'total_rows')::integer = 1005 AND jsonb_array_length(j -> 'rows') = 500 FROM p1)
  AND (SELECT (j ->> 'total_rows')::integer = 1005 AND jsonb_array_length(j -> 'rows') = 500 FROM p2)
  AND (SELECT (j ->> 'total_rows')::integer = 1005 AND jsonb_array_length(j -> 'rows') = 5 FROM p3)
);

SELECT pg_temp.expect_error(
  'all_matching_export_requires_night',
  $$SELECT public.barinv_export_events_csv_page('95000000-0000-4000-8000-000000000001'::uuid, NULL)$$,
  'Night'
);

WITH large_preview AS (
  SELECT public.barinv_create_event_csv_import_batch(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    (
      SELECT jsonb_agg(jsonb_build_object(
        '_csv_row_number', gs + 1,
        'client_event_id', 'events-csv-local-import-large-' || gs::text,
        'bar_id', '95000000-0000-4002-8000-000000000001',
        'station_id', '95000000-0000-4005-8000-000000000001',
        'item_id', '95000000-0000-4003-8000-000000000001',
        'staff_id', '95000000-0000-4004-8000-000000000001',
        'action', 'ADJUSTMENT',
        'qty', '2.5',
        'notes', 'large import'
      ))
      FROM generate_series(1, 1500) AS gs
    ),
    'large.csv'
  ) AS j
)
INSERT INTO events_csv_test_state(key, uuid_value, json_value)
SELECT 'large_batch', (j ->> 'batch_id')::uuid, j
FROM large_preview;

SELECT pg_temp.ok(
  'large_import_preview_1500_valid_rows',
  (SELECT (json_value ->> 'total_rows')::integer = 1500
      AND (json_value ->> 'valid_rows')::integer = 1500
      AND (json_value ->> 'can_confirm')::boolean IS TRUE
   FROM events_csv_test_state WHERE key = 'large_batch')
);

INSERT INTO events_csv_test_state(key, json_value)
SELECT
  'large_first_batch',
  public.barinv_process_event_csv_import_batch(
    (SELECT uuid_value FROM events_csv_test_state WHERE key = 'large_batch'),
    500
  )
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

SELECT pg_temp.ok(
  'large_import_first_batch_no_more_than_500',
  (SELECT (json_value ->> 'processed_rows')::integer = 500
      AND (json_value ->> 'inserted_rows')::integer = 500
      AND json_value ->> 'status' = 'running'
   FROM events_csv_test_state WHERE key = 'large_first_batch')
);

INSERT INTO events_csv_test_state(key, json_value)
SELECT
  'large_second_batch',
  public.barinv_process_event_csv_import_batch(
    (SELECT uuid_value FROM events_csv_test_state WHERE key = 'large_batch'),
    500
  )
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

INSERT INTO events_csv_test_state(key, json_value)
SELECT
  'large_third_batch',
  public.barinv_process_event_csv_import_batch(
    (SELECT uuid_value FROM events_csv_test_state WHERE key = 'large_batch'),
    500
  )
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

INSERT INTO events_csv_test_state(key, json_value)
SELECT
  'large_completed_again',
  public.barinv_process_event_csv_import_batch(
    (SELECT uuid_value FROM events_csv_test_state WHERE key = 'large_batch'),
    500
  )
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

SELECT pg_temp.ok(
  'large_import_resume_completes_idempotently',
  (SELECT (json_value ->> 'inserted_rows')::integer = 1500
      AND (json_value ->> 'processed_rows')::integer = 1500
      AND json_value ->> 'status' = 'completed'
   FROM events_csv_test_state WHERE key = 'large_completed_again')
  AND pg_temp.csv_test_event_count('events-csv-local-import-large-', 'PENDING') = 1500
);

SELECT pg_temp.ok(
  'large_import_no_review_audit_rows',
  (SELECT count(*) = 0
   FROM public.event_review_audit AS a
   JOIN public.events AS e
     ON e.id = a.event_id
   WHERE e.client_event_id LIKE 'events-csv-local-import-large-%')
);

RESET ROLE;

CREATE OR REPLACE FUNCTION public.events_csv_local_failure_injector_20260728()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.client_event_id = 'events-csv-local-retry-2' THEN
    RAISE EXCEPTION 'events_csv_local_failure_injection_20260728';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER events_csv_local_failure_injector_20260728
BEFORE INSERT ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.events_csv_local_failure_injector_20260728();

SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '95100000-0000-4000-8000-000000000001'::uuid);

WITH retry_preview AS (
  SELECT public.barinv_create_event_csv_import_batch(
    '95000000-0000-4000-8000-000000000001'::uuid,
    '95000000-0000-4001-8000-000000000001'::uuid,
    jsonb_build_array(
      jsonb_build_object('_csv_row_number', 2, 'client_event_id', 'events-csv-local-retry-1', 'bar_id', '95000000-0000-4002-8000-000000000001', 'item_id', '95000000-0000-4003-8000-000000000001', 'action', 'REQUEST', 'qty', '1'),
      jsonb_build_object('_csv_row_number', 3, 'client_event_id', 'events-csv-local-retry-2', 'bar_id', '95000000-0000-4002-8000-000000000001', 'item_id', '95000000-0000-4003-8000-000000000001', 'action', 'REQUEST', 'qty', '1'),
      jsonb_build_object('_csv_row_number', 4, 'client_event_id', 'events-csv-local-retry-3', 'bar_id', '95000000-0000-4002-8000-000000000001', 'item_id', '95000000-0000-4003-8000-000000000001', 'action', 'REQUEST', 'qty', '1')
    ),
    'retry.csv'
  ) AS j
)
INSERT INTO events_csv_test_state(key, uuid_value, json_value)
SELECT 'retry_batch', (j ->> 'batch_id')::uuid, j
FROM retry_preview;

WITH retry_first AS (
  SELECT public.barinv_process_event_csv_import_batch(
    (SELECT uuid_value FROM events_csv_test_state WHERE key = 'retry_batch'),
    500
  ) AS j
)
SELECT pg_temp.ok(
  'retry_import_records_one_failed_row',
  (SELECT (j ->> 'inserted_rows')::integer = 2
      AND (j ->> 'failed_rows')::integer = 1
      AND j ->> 'status' = 'completed_with_errors'
   FROM retry_first)
);

RESET ROLE;
DROP TRIGGER IF EXISTS events_csv_local_failure_injector_20260728
  ON public.events;
DROP FUNCTION IF EXISTS public.events_csv_local_failure_injector_20260728();

SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '95100000-0000-4000-8000-000000000001'::uuid);

INSERT INTO events_csv_test_state(key, json_value)
SELECT
  'retry_requeued',
  public.barinv_retry_event_csv_import_failures(
    (SELECT uuid_value FROM events_csv_test_state WHERE key = 'retry_batch')
  )
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

INSERT INTO events_csv_test_state(key, json_value)
SELECT
  'retry_done',
  public.barinv_process_event_csv_import_batch(
    (SELECT uuid_value FROM events_csv_test_state WHERE key = 'retry_batch'),
    500
  )
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

SELECT pg_temp.ok(
  'retry_reprocesses_only_failed_rows',
  (SELECT (json_value ->> 'requeued')::integer = 1 FROM events_csv_test_state WHERE key = 'retry_requeued')
  AND (SELECT (json_value ->> 'inserted_rows')::integer = 3
      AND (json_value ->> 'failed_rows')::integer = 0
      AND json_value ->> 'status' = 'completed'
   FROM events_csv_test_state WHERE key = 'retry_done')
  AND (SELECT count(*) = 1
       FROM public.event_csv_import_rows
       WHERE batch_id = (SELECT uuid_value FROM events_csv_test_state WHERE key = 'retry_batch')
         AND client_event_id = 'events-csv-local-retry-2'
         AND attempt_count = 2)
  AND (SELECT count(*) = 2
       FROM public.event_csv_import_rows
       WHERE batch_id = (SELECT uuid_value FROM events_csv_test_state WHERE key = 'retry_batch')
         AND client_event_id IN ('events-csv-local-retry-1', 'events-csv-local-retry-3')
         AND attempt_count = 1)
);

SELECT pg_temp.ok(
  'import_tables_have_rls_enabled',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_csv_import_batches'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_csv_import_rows'::regclass)
);

SELECT pg_temp.ok(
  'security_definer_functions_have_explicit_search_path',
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'barinv_create_event_csv_import_batch',
        'barinv_process_event_csv_import_batch',
        'barinv_get_event_csv_import_batch',
        'barinv_retry_event_csv_import_failures',
        'barinv_export_events_csv_page'
      )
      AND NOT (
        p.prosecdef
        AND COALESCE(array_to_string(p.proconfig, ','), '') LIKE '%search_path=%'
      )
  )
);

SELECT pg_temp.ok(
  'anon_has_no_csv_rpc_execute_grants',
  NOT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND routine_name IN (
        'barinv_create_event_csv_import_batch',
        'barinv_process_event_csv_import_batch',
        'barinv_get_event_csv_import_batch',
        'barinv_retry_event_csv_import_failures',
        'barinv_export_events_csv_page'
      )
      AND grantee = 'anon'
  )
);

SELECT
  count(*) AS assertions,
  count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed
FROM events_csv_test_results;
