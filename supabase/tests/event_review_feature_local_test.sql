-- BARINV PRO local-only Event review validation.
--
-- Run only against the disposable harness:
--   barinv_event_review_pgtest_20260727 / 127.0.0.1:54332
--
-- This script assumes the psql session is connected as supabase_admin.
-- It creates fixed-ID test fixtures, switches SESSION AUTHORIZATION to
-- authenticator for PostgREST-shaped RLS/firewall tests, and raises on
-- the first failed assertion.

\set ON_ERROR_STOP on
\pset pager off

CREATE TEMP TABLE event_review_test_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TEMP TABLE event_review_test_state (
  key text PRIMARY KEY,
  uuid_value uuid,
  json_value jsonb,
  int_value integer
);

GRANT SELECT, INSERT, UPDATE, DELETE ON event_review_test_results TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_review_test_state TO PUBLIC;

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

  INSERT INTO event_review_test_results(test_name, passed, detail)
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

    INSERT INTO event_review_test_results(test_name, passed, detail)
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
      'email', 'event-review-local-' || replace(p_uid::text, '-', '') || '@barinv.local.test'
    );

  PERFORM set_config('request.jwt.claim.role', p_role, false);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, false);
  PERFORM set_config('request.jwt.claim.email', v_claims ->> 'email', false);
  PERFORM set_config('request.jwt.claims', v_claims::text, false);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.test_event_status(p_event_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.status
  FROM public.events AS e
  WHERE e.id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION pg_temp.test_event_audit_count(
  p_event_id uuid,
  p_review_source text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM public.event_review_audit AS a
  WHERE a.event_id = p_event_id
    AND (
      p_review_source IS NULL
      OR a.review_source = p_review_source
    );
$$;

CREATE OR REPLACE FUNCTION pg_temp.test_event_count(
  p_venue_id uuid,
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
  WHERE e.venue_id = p_venue_id
    AND (
      p_status IS NULL
      OR e.status = p_status
    );
$$;

RESET ROLE;
RESET SESSION AUTHORIZATION;

DROP TRIGGER IF EXISTS event_review_local_failure_injector_20260727
  ON public.events;
DROP FUNCTION IF EXISTS public.event_review_local_failure_injector_20260727();

DELETE FROM public.event_review_job_items
WHERE job_id IN (
  SELECT id FROM public.event_review_jobs
  WHERE venue_id IN (
    '90000000-0000-4000-8000-000000000001'::uuid,
    '90000000-0000-4000-8000-000000000002'::uuid
  )
);
DELETE FROM public.event_review_jobs
WHERE venue_id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM public.event_review_audit
WHERE venue_id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM public.events
WHERE venue_id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM public.barback_sessions
WHERE venue_id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM public.venue_members
WHERE venue_id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
)
OR user_id IN (
  '91000000-0000-4000-8000-000000000001'::uuid,
  '91000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM public.staff
WHERE venue_id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM public.items
WHERE venue_id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM public.bars
WHERE venue_id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM public.nights
WHERE venue_id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM public.venues
WHERE id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid
);
DELETE FROM auth.users
WHERE id IN (
  '91000000-0000-4000-8000-000000000001'::uuid,
  '91000000-0000-4000-8000-000000000002'::uuid
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
    '91000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'event-review-manager@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"event_review_manager"}'::jsonb,
    now(),
    now()
  ),
  (
    '91000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'event-review-unauthorized@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"event_review_unauthorized"}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.venues (id, name, currency, active, barback_opening_par_enabled)
VALUES
  ('90000000-0000-4000-8000-000000000001'::uuid, 'EVENT REVIEW LOCAL TEST VENUE', 'CAD', true, false),
  ('90000000-0000-4000-8000-000000000002'::uuid, 'EVENT REVIEW OTHER VENUE', 'CAD', true, false);

INSERT INTO public.nights (id, venue_id, name, date, code, active)
VALUES
  ('90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'EVENT REVIEW AUTO NIGHT', current_date, 'EVR-AUTO', true),
  ('90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'EVENT REVIEW RPC NIGHT', current_date, 'EVR-RPC', true),
  ('90000000-0000-4001-8000-000000000003'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'EVENT REVIEW JOB NIGHT', current_date, 'EVR-JOB', true),
  ('90000000-0000-4001-8000-000000000004'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'EVENT REVIEW RETRY NIGHT', current_date, 'EVR-RETRY', true),
  ('90000000-0000-4001-8000-000000000102'::uuid, '90000000-0000-4000-8000-000000000002'::uuid, 'EVENT REVIEW OTHER NIGHT', current_date, 'EVR-OTHER', true);

INSERT INTO public.bars (id, venue_id, name, active, bar_type)
VALUES
  ('90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'EVENT REVIEW BAR 1', true, 'bar'),
  ('90000000-0000-4002-8000-000000000002'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'EVENT REVIEW BAR 2', true, 'bar'),
  ('90000000-0000-4002-8000-000000000102'::uuid, '90000000-0000-4000-8000-000000000002'::uuid, 'EVENT REVIEW OTHER BAR', true, 'bar');

INSERT INTO public.items (id, venue_id, name, unit, active, service_mode)
VALUES
  ('90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'EVENT REVIEW TEST ITEM', 'bottle', true, 'regular_bar'),
  ('90000000-0000-4003-8000-000000000102'::uuid, '90000000-0000-4000-8000-000000000002'::uuid, 'EVENT REVIEW OTHER ITEM', 'bottle', true, 'regular_bar');

INSERT INTO public.staff (id, venue_id, name, role, active, auth_user_id)
VALUES
  ('90000000-0000-4004-8000-000000000001'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'Event Review Staff 1', 'barback', true, NULL),
  ('90000000-0000-4004-8000-000000000002'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'Event Review Staff 2', 'barback', true, NULL),
  ('90000000-0000-4004-8000-000000000003'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'Event Review Manager Staff', 'manager', true, '91000000-0000-4000-8000-000000000001'::uuid),
  ('90000000-0000-4004-8000-000000000102'::uuid, '90000000-0000-4000-8000-000000000002'::uuid, 'Event Review Other Staff', 'manager', true, '91000000-0000-4000-8000-000000000002'::uuid);

INSERT INTO public.venue_members (user_id, venue_id, role, created_by)
VALUES
  ('91000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, 'manager', '91000000-0000-4000-8000-000000000001'::uuid),
  ('91000000-0000-4000-8000-000000000002'::uuid, '90000000-0000-4000-8000-000000000002'::uuid, 'manager', '91000000-0000-4000-8000-000000000002'::uuid);

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
  revoked_at,
  revoked_by,
  auto_approve_events
) VALUES
  (
    '92000000-0000-4000-8000-000000000001'::uuid,
    '90000000-0000-4000-8000-000000000001'::uuid,
    '90000000-0000-4001-8000-000000000001'::uuid,
    '90000000-0000-4002-8000-000000000001'::uuid,
    ARRAY['90000000-0000-4002-8000-000000000001'::uuid],
    ARRAY['90000000-0000-4004-8000-000000000001'::uuid],
    'auto false',
    '90000000-0000-4004-8000-000000000003'::uuid,
    now() + interval '2 hours',
    NULL,
    NULL,
    false
  ),
  (
    '92000000-0000-4000-8000-000000000002'::uuid,
    '90000000-0000-4000-8000-000000000001'::uuid,
    '90000000-0000-4001-8000-000000000001'::uuid,
    '90000000-0000-4002-8000-000000000001'::uuid,
    ARRAY['90000000-0000-4002-8000-000000000001'::uuid],
    ARRAY['90000000-0000-4004-8000-000000000001'::uuid],
    'auto true',
    '90000000-0000-4004-8000-000000000003'::uuid,
    now() + interval '2 hours',
    NULL,
    NULL,
    true
  ),
  (
    '92000000-0000-4000-8000-000000000003'::uuid,
    '90000000-0000-4000-8000-000000000001'::uuid,
    '90000000-0000-4001-8000-000000000001'::uuid,
    '90000000-0000-4002-8000-000000000001'::uuid,
    ARRAY['90000000-0000-4002-8000-000000000001'::uuid],
    ARRAY['90000000-0000-4004-8000-000000000001'::uuid],
    'expired auto true',
    '90000000-0000-4004-8000-000000000003'::uuid,
    now() - interval '1 hour',
    NULL,
    NULL,
    true
  ),
  (
    '92000000-0000-4000-8000-000000000004'::uuid,
    '90000000-0000-4000-8000-000000000001'::uuid,
    '90000000-0000-4001-8000-000000000001'::uuid,
    '90000000-0000-4002-8000-000000000001'::uuid,
    ARRAY['90000000-0000-4002-8000-000000000001'::uuid],
    ARRAY['90000000-0000-4004-8000-000000000001'::uuid],
    'revoked auto true',
    '90000000-0000-4004-8000-000000000003'::uuid,
    now() + interval '2 hours',
    now() - interval '5 minutes',
    '90000000-0000-4004-8000-000000000003'::uuid,
    true
  ),
  (
    '92000000-0000-4000-8000-000000000005'::uuid,
    '90000000-0000-4000-8000-000000000001'::uuid,
    '90000000-0000-4001-8000-000000000001'::uuid,
    '90000000-0000-4002-8000-000000000001'::uuid,
    ARRAY['90000000-0000-4002-8000-000000000001'::uuid],
    ARRAY['90000000-0000-4004-8000-000000000001'::uuid],
    'wrong staff auto true',
    '90000000-0000-4004-8000-000000000003'::uuid,
    now() + interval '2 hours',
    NULL,
    NULL,
    true
  ),
  (
    '92000000-0000-4000-8000-000000000006'::uuid,
    '90000000-0000-4000-8000-000000000001'::uuid,
    '90000000-0000-4001-8000-000000000001'::uuid,
    '90000000-0000-4002-8000-000000000001'::uuid,
    ARRAY['90000000-0000-4002-8000-000000000001'::uuid],
    ARRAY['90000000-0000-4004-8000-000000000001'::uuid],
    'wrong bar auto true',
    '90000000-0000-4004-8000-000000000003'::uuid,
    now() + interval '2 hours',
    NULL,
    NULL,
    true
  );

INSERT INTO public.events (
  id,
  venue_id,
  night_id,
  bar_id,
  item_id,
  staff_id,
  submitted_by,
  qty,
  action,
  status,
  notes
) VALUES
  ('93000000-0000-4000-8001-000000000001'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'fw direct approve', 1, 'REQUEST', 'PENDING', 'fw direct approve'),
  ('93000000-0000-4000-8001-000000000002'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'fw direct reject', 1, 'REQUEST', 'PENDING', 'fw direct reject'),
  ('93000000-0000-4000-8001-000000000003'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'fw no reason', 1, 'REQUEST', 'PENDING', 'fw no reason'),
  ('93000000-0000-4000-8001-000000000004'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'fw unauthorized', 1, 'REQUEST', 'PENDING', 'fw unauthorized'),
  ('93000000-0000-4000-8001-000000000005'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'fw already approved', 1, 'REQUEST', 'APPROVED', 'fw already approved'),
  ('93000000-0000-4000-8001-000000000006'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'fw already rejected', 1, 'REQUEST', 'REJECTED', 'fw already rejected'),
  ('93000000-0000-4000-8001-000000000007'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'fw non status update', 1, 'REQUEST', 'PENDING', 'fw non status update'),
  ('93000000-0000-4000-8001-000000000008'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'fw venue change', 1, 'REQUEST', 'PENDING', 'fw venue change'),
  ('93000000-0000-4000-8002-000000000001'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'rpc explicit', 1, 'DELIVERED', 'PENDING', 'rpc explicit'),
  ('93000000-0000-4000-8002-000000000002'::uuid, '90000000-0000-4000-8000-000000000002'::uuid, '90000000-0000-4001-8000-000000000102'::uuid, '90000000-0000-4002-8000-000000000102'::uuid, '90000000-0000-4003-8000-000000000102'::uuid, '90000000-0000-4004-8000-000000000102'::uuid, 'rpc other venue', 1, 'DELIVERED', 'PENDING', 'rpc other venue'),
  ('93000000-0000-4000-8002-000000000003'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'rpc preview one', 1, 'RETURNED', 'PENDING', 'rpc preview one'),
  ('93000000-0000-4000-8002-000000000004'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'rpc preview two', 1, 'RETURNED', 'PENDING', 'rpc preview two'),
  ('93000000-0000-4000-8002-000000000005'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'rpc reject one', 1, 'ADJUSTMENT', 'PENDING', 'rpc reject one'),
  ('93000000-0000-4000-8002-000000000006'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000002'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'rpc reject two', 1, 'ADJUSTMENT', 'PENDING', 'rpc reject two');

INSERT INTO public.events (
  venue_id,
  night_id,
  bar_id,
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
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4001-8000-000000000003'::uuid,
  '90000000-0000-4002-8000-000000000001'::uuid,
  '90000000-0000-4003-8000-000000000001'::uuid,
  '90000000-0000-4004-8000-000000000001'::uuid,
  'job 1500 fixture',
  1,
  'REQUEST',
  'PENDING',
  'EVENT_REVIEW_LOCAL_JOB_1500',
  'event-review-local-job-1500-' || gs::text
FROM generate_series(1, 1500) AS gs;

INSERT INTO public.events (
  id,
  venue_id,
  night_id,
  bar_id,
  item_id,
  staff_id,
  submitted_by,
  qty,
  action,
  status,
  notes
) VALUES
  ('93000000-0000-4000-8003-000000000001'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000004'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'retry target', 1, 'ADJUSTMENT', 'PENDING', 'retry target'),
  ('93000000-0000-4000-8003-000000000002'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000004'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'retry other 2', 1, 'ADJUSTMENT', 'PENDING', 'retry other 2'),
  ('93000000-0000-4000-8003-000000000003'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000004'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'retry other 3', 1, 'ADJUSTMENT', 'PENDING', 'retry other 3'),
  ('93000000-0000-4000-8003-000000000004'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000004'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'retry other 4', 1, 'ADJUSTMENT', 'PENDING', 'retry other 4'),
  ('93000000-0000-4000-8003-000000000005'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000004'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'retry other 5', 1, 'ADJUSTMENT', 'PENDING', 'retry other 5'),
  ('93000000-0000-4000-8003-000000000006'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000004'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'retry other 6', 1, 'ADJUSTMENT', 'PENDING', 'retry other 6');

CREATE OR REPLACE FUNCTION public.event_review_local_failure_injector_20260727()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id = '93000000-0000-4000-8003-000000000001'::uuid
     AND OLD.status = 'PENDING'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'event_review_local_failure_injection_20260727';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER event_review_local_failure_injector_20260727
BEFORE UPDATE OF status ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.event_review_local_failure_injector_20260727();

SELECT pg_temp.ok(
  'fixtures_created',
  (SELECT count(*) FROM public.venues WHERE id = '90000000-0000-4000-8000-000000000001'::uuid) = 1
  AND (SELECT count(*) FROM public.bars WHERE venue_id = '90000000-0000-4000-8000-000000000001'::uuid) >= 2
  AND (SELECT count(*) FROM public.staff WHERE venue_id = '90000000-0000-4000-8000-000000000001'::uuid) >= 2
  AND (SELECT count(*) FROM public.events WHERE notes = 'EVENT_REVIEW_LOCAL_JOB_1500') = 1500,
  'test venue, nights, bars, staff, sessions, and 1500 job events inserted'
);

SET SESSION AUTHORIZATION authenticator;

-- AUTO-APPROVE
SET ROLE barback_user;
SELECT pg_temp.set_claims(
  'barback_user',
  '91000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object(
    'venue_id', '90000000-0000-4000-8000-000000000001',
    'night_id', '90000000-0000-4001-8000-000000000001',
    'staff_id', '90000000-0000-4004-8000-000000000001',
    'session_id', '92000000-0000-4000-8000-000000000001',
    'bar_id', '90000000-0000-4002-8000-000000000001',
    'allowed_bars', '90000000-0000-4002-8000-000000000001'
  )
);
INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, session_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, '92000000-0000-4000-8000-000000000001'::uuid, 'barback_web_link', 'auto false', 1, 'REQUEST', 'PENDING');
SELECT pg_temp.ok('auto_approve_false_remains_pending', pg_temp.test_event_status('93000000-0000-4000-8000-000000000001'::uuid) = 'PENDING');

SELECT pg_temp.set_claims(
  'barback_user',
  '91000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object(
    'venue_id', '90000000-0000-4000-8000-000000000001',
    'night_id', '90000000-0000-4001-8000-000000000001',
    'staff_id', '90000000-0000-4004-8000-000000000001',
    'session_id', '92000000-0000-4000-8000-000000000002',
    'bar_id', '90000000-0000-4002-8000-000000000001',
    'allowed_bars', '90000000-0000-4002-8000-000000000001'
  )
);
INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, session_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000002'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, '92000000-0000-4000-8000-000000000002'::uuid, 'barback_web_link', 'auto true', 1, 'REQUEST', 'PENDING');
SELECT pg_temp.ok('auto_approve_true_becomes_approved', pg_temp.test_event_status('93000000-0000-4000-8000-000000000002'::uuid) = 'APPROVED');
SELECT pg_temp.ok(
  'auto_approve_exactly_one_session_auto_audit',
  pg_temp.test_event_audit_count('93000000-0000-4000-8000-000000000002'::uuid, 'session_auto') = 1
);

SELECT pg_temp.set_claims(
  'barback_user',
  '91000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('venue_id', '90000000-0000-4000-8000-000000000001', 'night_id', '90000000-0000-4001-8000-000000000001', 'staff_id', '90000000-0000-4004-8000-000000000001', 'session_id', '92000000-0000-4000-8000-000000000003', 'bar_id', '90000000-0000-4002-8000-000000000001', 'allowed_bars', '90000000-0000-4002-8000-000000000001')
);
INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, session_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000003'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, '92000000-0000-4000-8000-000000000003'::uuid, 'barback_web_link', 'expired', 1, 'REQUEST', 'PENDING');
SELECT pg_temp.ok('expired_session_does_not_auto_approve', pg_temp.test_event_status('93000000-0000-4000-8000-000000000003'::uuid) = 'PENDING');

SELECT pg_temp.set_claims(
  'barback_user',
  '91000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('venue_id', '90000000-0000-4000-8000-000000000001', 'night_id', '90000000-0000-4001-8000-000000000001', 'staff_id', '90000000-0000-4004-8000-000000000001', 'session_id', '92000000-0000-4000-8000-000000000004', 'bar_id', '90000000-0000-4002-8000-000000000001', 'allowed_bars', '90000000-0000-4002-8000-000000000001')
);
INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, session_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000004'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, '92000000-0000-4000-8000-000000000004'::uuid, 'barback_web_link', 'revoked', 1, 'REQUEST', 'PENDING');
SELECT pg_temp.ok('revoked_session_does_not_auto_approve', pg_temp.test_event_status('93000000-0000-4000-8000-000000000004'::uuid) = 'PENDING');

SELECT pg_temp.set_claims(
  'barback_user',
  '91000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('venue_id', '90000000-0000-4000-8000-000000000001', 'night_id', '90000000-0000-4001-8000-000000000001', 'staff_id', '90000000-0000-4004-8000-000000000002', 'session_id', '92000000-0000-4000-8000-000000000005', 'bar_id', '90000000-0000-4002-8000-000000000001', 'allowed_bars', '90000000-0000-4002-8000-000000000001')
);
INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, session_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000005'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000002'::uuid, '92000000-0000-4000-8000-000000000005'::uuid, 'barback_web_link', 'wrong staff', 1, 'REQUEST', 'PENDING');
SELECT pg_temp.ok('wrong_staff_does_not_auto_approve', pg_temp.test_event_status('93000000-0000-4000-8000-000000000005'::uuid) = 'PENDING');

SELECT pg_temp.set_claims(
  'barback_user',
  '91000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('venue_id', '90000000-0000-4000-8000-000000000001', 'night_id', '90000000-0000-4001-8000-000000000001', 'staff_id', '90000000-0000-4004-8000-000000000001', 'session_id', '92000000-0000-4000-8000-000000000006', 'bar_id', '90000000-0000-4002-8000-000000000002', 'allowed_bars', '90000000-0000-4002-8000-000000000002')
);
INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, session_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000006'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000002'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, '92000000-0000-4000-8000-000000000006'::uuid, 'barback_web_link', 'wrong bar', 1, 'REQUEST', 'PENDING');
SELECT pg_temp.ok('wrong_bar_does_not_auto_approve', pg_temp.test_event_status('93000000-0000-4000-8000-000000000006'::uuid) = 'PENDING');

SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '91000000-0000-4000-8000-000000000001'::uuid);
INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000007'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'barback_web_link', 'missing session', 1, 'REQUEST', 'PENDING');
SELECT pg_temp.ok('missing_session_id_does_not_auto_approve', pg_temp.test_event_status('93000000-0000-4000-8000-000000000007'::uuid) = 'PENDING');

INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, session_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000008'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, '92000000-0000-4000-8000-000000000002'::uuid, 'barback_web_link', 'admin spoof', 1, 'REQUEST', 'APPROVED');
SELECT pg_temp.ok('admin_spoofed_barback_approved_fails_closed_to_pending', pg_temp.test_event_status('93000000-0000-4000-8000-000000000008'::uuid) = 'PENDING');

INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000009'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, 'admin_adjustment', 'admin approved insert', 1, 'REQUEST', 'APPROVED');
SELECT pg_temp.ok('non_barback_approved_insert_remains_compatible', pg_temp.test_event_status('93000000-0000-4000-8000-000000000009'::uuid) = 'APPROVED');

SET ROLE barback_user;
SELECT pg_temp.set_claims(
  'barback_user',
  '91000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('venue_id', '90000000-0000-4000-8000-000000000001', 'night_id', '90000000-0000-4001-8000-000000000001', 'staff_id', '90000000-0000-4004-8000-000000000001', 'session_id', '99999999-9999-4999-8999-999999999999', 'bar_id', '90000000-0000-4002-8000-000000000001', 'allowed_bars', '90000000-0000-4002-8000-000000000001')
);
INSERT INTO public.events (id, venue_id, night_id, bar_id, item_id, staff_id, session_id, source, submitted_by, qty, action, status)
VALUES ('93000000-0000-4000-8000-000000000010'::uuid, '90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4001-8000-000000000001'::uuid, '90000000-0000-4002-8000-000000000001'::uuid, '90000000-0000-4003-8000-000000000001'::uuid, '90000000-0000-4004-8000-000000000001'::uuid, '99999999-9999-4999-8999-999999999999'::uuid, 'barback_web_link', 'invalid session', 1, 'REQUEST', 'APPROVED');
SELECT pg_temp.ok('invalid_barback_session_combination_fails_closed', pg_temp.test_event_status('93000000-0000-4000-8000-000000000010'::uuid) = 'PENDING');

-- STATUS FIREWALL
SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '91000000-0000-4000-8000-000000000001'::uuid);
UPDATE public.events
   SET status = 'APPROVED'
 WHERE id = '93000000-0000-4000-8001-000000000001'::uuid;
SELECT pg_temp.ok('manager_direct_pending_to_approved_allowed', (SELECT status FROM public.events WHERE id = '93000000-0000-4000-8001-000000000001'::uuid) = 'APPROVED');
SELECT pg_temp.ok('legacy_direct_approved_has_one_manual_direct_audit', (SELECT count(*) FROM public.event_review_audit WHERE event_id = '93000000-0000-4000-8001-000000000001'::uuid AND review_source = 'manual_direct') = 1);

SELECT set_config('barinv.review_reason', 'local rejection reason', false);
UPDATE public.events
   SET status = 'REJECTED'
 WHERE id = '93000000-0000-4000-8001-000000000002'::uuid;
SELECT set_config('barinv.review_reason', '', false);
SELECT pg_temp.ok('manager_direct_pending_to_rejected_allowed_with_reason', (SELECT status FROM public.events WHERE id = '93000000-0000-4000-8001-000000000002'::uuid) = 'REJECTED');

SELECT set_config('barinv.review_reason', '', false);
SELECT pg_temp.expect_error(
  'direct_rejection_without_reason_rejected',
  $$UPDATE public.events SET status = 'REJECTED' WHERE id = '93000000-0000-4000-8001-000000000003'::uuid$$,
  'rejection reason'
);

SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '91000000-0000-4000-8000-000000000002'::uuid);
UPDATE public.events
   SET status = 'APPROVED'
 WHERE id = '93000000-0000-4000-8001-000000000004'::uuid;
SELECT pg_temp.ok(
  'unauthorized_authenticated_user_cannot_transition_status',
  pg_temp.test_event_status('93000000-0000-4000-8001-000000000004'::uuid) = 'PENDING'
  AND pg_temp.test_event_audit_count('93000000-0000-4000-8001-000000000004'::uuid, NULL) = 0
);

SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '91000000-0000-4000-8000-000000000001'::uuid);
SELECT pg_temp.expect_error(
  'approved_to_pending_blocked',
  $$UPDATE public.events SET status = 'PENDING' WHERE id = '93000000-0000-4000-8001-000000000005'::uuid$$,
  'Only PENDING'
);
SELECT pg_temp.expect_error(
  'approved_to_rejected_blocked',
  $$UPDATE public.events SET status = 'REJECTED' WHERE id = '93000000-0000-4000-8001-000000000005'::uuid$$,
  'Only PENDING'
);
SELECT pg_temp.expect_error(
  'rejected_to_approved_blocked',
  $$UPDATE public.events SET status = 'APPROVED' WHERE id = '93000000-0000-4000-8001-000000000006'::uuid$$,
  'Only PENDING'
);

UPDATE public.events
   SET notes = 'non-status update allowed'
 WHERE id = '93000000-0000-4000-8001-000000000007'::uuid;
SELECT pg_temp.ok(
  'non_status_event_updates_unaffected',
  (SELECT notes = 'non-status update allowed' AND status = 'PENDING' FROM public.events WHERE id = '93000000-0000-4000-8001-000000000007'::uuid)
  AND (SELECT count(*) FROM public.event_review_audit WHERE event_id = '93000000-0000-4000-8001-000000000007'::uuid) = 0
);

SELECT pg_temp.expect_error(
  'venue_id_cannot_change_during_status_transition',
  $$UPDATE public.events SET venue_id = '90000000-0000-4000-8000-000000000002'::uuid, status = 'APPROVED' WHERE id = '93000000-0000-4000-8001-000000000008'::uuid$$,
  NULL
);

-- DIRECT REVIEW RPC
SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '91000000-0000-4000-8000-000000000001'::uuid);
SELECT pg_temp.ok(
  'explicit_event_id_selection_is_venue_scoped',
  (public.barinv_review_events(
    '90000000-0000-4000-8000-000000000001'::uuid,
    'APPROVED',
    ARRAY['93000000-0000-4000-8002-000000000002'::uuid],
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  ) ->> 'updated')::integer = 0
  AND pg_temp.test_event_status('93000000-0000-4000-8002-000000000002'::uuid) = 'PENDING'
);

SELECT pg_temp.ok(
  'night_filter_is_venue_scoped',
  (public.barinv_preview_event_review(
    '90000000-0000-4000-8000-000000000001'::uuid,
    NULL,
    '90000000-0000-4001-8000-000000000102'::uuid,
    NULL,
    NULL,
    NULL
  ) ->> 'total')::integer = 0
);

SELECT pg_temp.expect_error(
  'all_matching_preview_requires_night',
  $$SELECT public.barinv_preview_event_review('90000000-0000-4000-8000-000000000001'::uuid, NULL, NULL, NULL, NULL, NULL)$$,
  'Night selection'
);
SELECT pg_temp.expect_error(
  'all_matching_review_requires_night',
  $$SELECT public.barinv_review_events('90000000-0000-4000-8000-000000000001'::uuid, 'APPROVED', NULL, NULL, NULL, NULL, NULL, NULL)$$,
  'Night selection'
);

WITH preview AS (
  SELECT public.barinv_preview_event_review(
    '90000000-0000-4000-8000-000000000001'::uuid,
    NULL,
    '90000000-0000-4001-8000-000000000002'::uuid,
    NULL,
    'RETURNED',
    NULL
  ) AS j
),
review AS (
  SELECT public.barinv_review_events(
    '90000000-0000-4000-8000-000000000001'::uuid,
    'APPROVED',
    NULL,
    '90000000-0000-4001-8000-000000000002'::uuid,
    NULL,
    'RETURNED',
    NULL,
    NULL
  ) AS j
)
SELECT pg_temp.ok(
  'preview_counts_match_actual_updated_counts',
  (SELECT (j ->> 'total')::integer FROM preview) = 2
  AND (SELECT (j ->> 'updated')::integer FROM review) = 2
);

SELECT pg_temp.ok(
  'already_processed_events_skipped_idempotently',
  (public.barinv_review_events(
    '90000000-0000-4000-8000-000000000001'::uuid,
    'APPROVED',
    ARRAY[
      '93000000-0000-4000-8002-000000000003'::uuid,
      '93000000-0000-4000-8002-000000000004'::uuid
    ],
    '90000000-0000-4001-8000-000000000002'::uuid,
    NULL,
    NULL,
    NULL,
    NULL
  ) ->> 'updated')::integer = 0
);

SELECT pg_temp.ok(
  'one_audit_row_per_successful_direct_rpc_transition',
  (SELECT count(*)
   FROM public.event_review_audit
   WHERE event_id IN (
     '93000000-0000-4000-8002-000000000003'::uuid,
     '93000000-0000-4000-8002-000000000004'::uuid
   )
   AND review_source = 'manual_bulk') = 2
);

WITH bulk_reject AS (
  SELECT public.barinv_review_events(
    '90000000-0000-4000-8000-000000000001'::uuid,
    'REJECTED',
    ARRAY[
      '93000000-0000-4000-8002-000000000005'::uuid,
      '93000000-0000-4000-8002-000000000006'::uuid
    ],
    '90000000-0000-4001-8000-000000000002'::uuid,
    NULL,
    NULL,
    NULL,
    'bulk reject reason'
  ) AS j
)
INSERT INTO event_review_test_state(key, json_value)
SELECT 'rpc_bulk_reject', j
FROM bulk_reject
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

SELECT pg_temp.ok(
  'page_selection_bulk_rejection_updates_selected_ids',
  (SELECT (json_value ->> 'updated')::integer = 2 FROM event_review_test_state WHERE key = 'rpc_bulk_reject')
  AND (SELECT count(*) FROM public.events WHERE id IN (
    '93000000-0000-4000-8002-000000000005'::uuid,
    '93000000-0000-4000-8002-000000000006'::uuid
  ) AND status = 'REJECTED') = 2
);

SELECT pg_temp.ok(
  'single_explicit_rpc_approval_updates_one',
  (public.barinv_review_events(
    '90000000-0000-4000-8000-000000000001'::uuid,
    'APPROVED',
    ARRAY['93000000-0000-4000-8002-000000000001'::uuid],
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  ) ->> 'updated')::integer = 1
);

-- DURABLE JOBS
WITH created AS (
  SELECT public.barinv_create_event_review_job(
    '90000000-0000-4000-8000-000000000001'::uuid,
    'APPROVED',
    NULL,
    '90000000-0000-4001-8000-000000000003'::uuid,
    NULL,
    'REQUEST',
    NULL,
    NULL
  ) AS j
)
INSERT INTO event_review_test_state(key, uuid_value, json_value)
SELECT 'job_1500', (j ->> 'job_id')::uuid, j
FROM created;

SELECT pg_temp.ok(
  'durable_job_created_for_1500_all_matching_events',
  (SELECT (json_value ->> 'total')::integer = 1500
   AND (json_value ->> 'requested')::integer = 1500
   FROM event_review_test_state WHERE key = 'job_1500')
);

WITH batch AS (
  SELECT public.barinv_process_event_review_job(
    (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500'),
    500
  ) AS j
)
SELECT pg_temp.ok(
  'durable_job_batch_1_progress_500',
  (SELECT (j ->> 'processed')::integer = 500 AND (j ->> 'remaining')::integer = 1000 FROM batch)
);

SELECT pg_temp.ok(
  'durable_job_progress_read_after_interrupt',
  (public.barinv_get_event_review_job((SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500')) ->> 'processed')::integer = 500
);

WITH batch AS (
  SELECT public.barinv_process_event_review_job(
    (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500'),
    500
  ) AS j
)
SELECT pg_temp.ok(
  'durable_job_batch_2_progress_1000',
  (SELECT (j ->> 'processed')::integer = 1000 AND (j ->> 'remaining')::integer = 500 FROM batch)
);

WITH batch AS (
  SELECT public.barinv_process_event_review_job(
    (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500'),
    500
  ) AS j
)
SELECT pg_temp.ok(
  'durable_job_batch_3_completed_1500',
  (SELECT (j ->> 'processed')::integer = 1500 AND (j ->> 'updated')::integer = 1500 AND (j ->> 'failed')::integer = 0 AND (j ->> 'status') = 'completed' FROM batch)
);

SELECT pg_temp.ok(
  'all_1500_job_events_reach_approved',
  (SELECT count(*) FROM public.events WHERE notes = 'EVENT_REVIEW_LOCAL_JOB_1500' AND status = 'APPROVED') = 1500
);

SELECT pg_temp.ok(
  'job_1500_audit_exact_once',
  (SELECT count(*) FROM public.event_review_audit WHERE metadata ->> 'job_id' = (SELECT uuid_value::text FROM event_review_test_state WHERE key = 'job_1500')) = 1500
  AND (SELECT count(DISTINCT event_id) FROM public.event_review_audit WHERE metadata ->> 'job_id' = (SELECT uuid_value::text FROM event_review_test_state WHERE key = 'job_1500')) = 1500
);

SELECT pg_temp.ok(
  'reprocessing_completed_job_is_idempotent',
  (public.barinv_process_event_review_job((SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500'), 500) ->> 'updated')::integer = 1500
  AND (SELECT count(*) FROM public.event_review_audit WHERE metadata ->> 'job_id' = (SELECT uuid_value::text FROM event_review_test_state WHERE key = 'job_1500')) = 1500
);

SELECT pg_temp.ok(
  'job_1500_counts_reconcile',
  (SELECT requested_count = 1500
      AND total_count = 1500
      AND processed_count = 1500
      AND updated_count = 1500
      AND skipped_count = 0
      AND failed_count = 0
      AND status = 'completed'
   FROM public.event_review_jobs
   WHERE id = (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500'))
  AND (SELECT count(*) = 1500 FROM public.event_review_job_items WHERE job_id = (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500') AND state = 'updated')
);

-- RETRY JOB
WITH created AS (
  SELECT public.barinv_create_event_review_job(
    '90000000-0000-4000-8000-000000000001'::uuid,
    'APPROVED',
    NULL,
    '90000000-0000-4001-8000-000000000004'::uuid,
    NULL,
    'ADJUSTMENT',
    NULL,
    NULL
  ) AS j
)
INSERT INTO event_review_test_state(key, uuid_value, json_value)
SELECT 'job_retry', (j ->> 'job_id')::uuid, j
FROM created;

WITH batch AS (
  SELECT public.barinv_process_event_review_job(
    (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_retry'),
    500
  ) AS j
)
INSERT INTO event_review_test_state(key, json_value)
SELECT 'retry_first_process', j
FROM batch
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

SELECT pg_temp.ok(
  'retry_job_records_one_failed_item',
  (SELECT (json_value ->> 'updated')::integer = 5
      AND (json_value ->> 'failed')::integer = 1
      AND (json_value ->> 'status') = 'completed_with_errors'
   FROM event_review_test_state
   WHERE key = 'retry_first_process')
  AND (SELECT state = 'failed' AND attempt_count = 1 FROM public.event_review_job_items WHERE job_id = (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_retry') AND event_id = '93000000-0000-4000-8003-000000000001'::uuid)
);

RESET ROLE;
RESET SESSION AUTHORIZATION;

DROP TRIGGER IF EXISTS event_review_local_failure_injector_20260727
  ON public.events;
DROP FUNCTION IF EXISTS public.event_review_local_failure_injector_20260727();

SET SESSION AUTHORIZATION authenticator;
SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '91000000-0000-4000-8000-000000000001'::uuid);

WITH retry AS (
  SELECT public.barinv_retry_event_review_job_failures(
    (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_retry')
  ) AS j
)
INSERT INTO event_review_test_state(key, json_value)
SELECT 'retry_requeue', j
FROM retry
ON CONFLICT (key) DO UPDATE
  SET json_value = EXCLUDED.json_value;

SELECT pg_temp.ok(
  'retry_requeues_only_failed_items',
  (SELECT (json_value ->> 'requeued')::integer = 1
   FROM event_review_test_state
   WHERE key = 'retry_requeue')
  AND (SELECT count(*) FROM public.event_review_job_items WHERE job_id = (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_retry') AND state = 'queued') = 1
);

WITH batch AS (
  SELECT public.barinv_process_event_review_job(
    (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_retry'),
    500
  ) AS j
)
SELECT pg_temp.ok(
  'retry_processes_failed_item_and_completes',
  (SELECT (j ->> 'updated')::integer = 6 AND (j ->> 'failed')::integer = 0 AND (j ->> 'status') = 'completed' FROM batch)
);

SELECT pg_temp.ok(
  'retry_attempt_counts_prove_only_failed_item_reprocessed',
  (SELECT attempt_count = 2 AND state = 'updated' FROM public.event_review_job_items WHERE job_id = (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_retry') AND event_id = '93000000-0000-4000-8003-000000000001'::uuid)
  AND (SELECT count(*) = 5 FROM public.event_review_job_items WHERE job_id = (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_retry') AND event_id <> '93000000-0000-4000-8003-000000000001'::uuid AND attempt_count = 1 AND state = 'updated')
  AND (SELECT count(*) FROM public.event_review_audit WHERE metadata ->> 'job_id' = (SELECT uuid_value::text FROM event_review_test_state WHERE key = 'job_retry')) = 6
);

SELECT pg_temp.ok(
  'durable_job_venue_night_isolation',
  pg_temp.test_event_count('90000000-0000-4000-8000-000000000002'::uuid, 'PENDING') = 1
  AND (SELECT count(*) FROM public.event_review_job_items WHERE job_id = (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500')) = 1500
);

SET ROLE authenticated;
SELECT pg_temp.set_claims('authenticated', '91000000-0000-4000-8000-000000000002'::uuid);
SELECT pg_temp.expect_error(
  'unauthorized_create_job_rejected',
  $$SELECT public.barinv_create_event_review_job('90000000-0000-4000-8000-000000000001'::uuid, 'APPROVED', NULL, '90000000-0000-4001-8000-000000000003'::uuid, NULL, 'REQUEST', NULL, NULL)$$,
  'Manager access'
);
SELECT pg_temp.expect_error(
  'unauthorized_get_job_rejected',
  format($$SELECT public.barinv_get_event_review_job('%s'::uuid)$$, (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500')),
  'Manager access'
);
SELECT pg_temp.expect_error(
  'unauthorized_process_job_rejected',
  format($$SELECT public.barinv_process_event_review_job('%s'::uuid, 500)$$, (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500')),
  'Manager access'
);
SELECT pg_temp.expect_error(
  'unauthorized_retry_job_rejected',
  format($$SELECT public.barinv_retry_event_review_job_failures('%s'::uuid)$$, (SELECT uuid_value FROM event_review_test_state WHERE key = 'job_1500')),
  'Manager access'
);

RESET ROLE;
RESET SESSION AUTHORIZATION;

SELECT pg_temp.ok(
  'failure_injection_trigger_removed',
  NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'event_review_local_failure_injector_20260727'
  )
  AND to_regprocedure('public.event_review_local_failure_injector_20260727()') IS NULL
);

SELECT
  count(*) AS passed_assertions,
  bool_and(passed) AS all_passed
FROM event_review_test_results;

TABLE event_review_test_results
ORDER BY recorded_at, test_name;
