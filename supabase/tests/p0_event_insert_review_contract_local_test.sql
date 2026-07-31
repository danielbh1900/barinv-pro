\set ON_ERROR_STOP on
\pset pager off

-- P0-02 isolated assertions.
--
-- The runner opens one outer transaction, captures the existing Event
-- count/hash, applies P0-01 then the actual P0-02 migration, includes this
-- file, runs regressions, and rolls everything back.

CREATE TEMP TABLE p0_02_test_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON p0_02_test_results
  TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.p0_02_ok(
  p_name text,
  p_condition boolean,
  p_detail text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION
      'FAIL [%]: %',
      p_name,
      COALESCE(p_detail, 'assertion returned false');
  END IF;

  INSERT INTO p0_02_test_results(test_name, passed, detail)
  VALUES (p_name, true, p_detail)
  ON CONFLICT (test_name) DO UPDATE
    SET passed = EXCLUDED.passed,
        detail = EXCLUDED.detail;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p0_02_expect_error(
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
       AND position(lower(p_match) IN lower(SQLERRM)) = 0 THEN
      RAISE EXCEPTION
        'FAIL [%]: expected error containing "%", got "%"',
        p_name,
        p_match,
        SQLERRM;
    END IF;

    INSERT INTO p0_02_test_results(test_name, passed, detail)
    VALUES (p_name, true, SQLERRM)
    ON CONFLICT (test_name) DO UPDATE
      SET passed = EXCLUDED.passed,
          detail = EXCLUDED.detail;
    RETURN;
  END;

  RAISE EXCEPTION
    'FAIL [%]: expected an error but statement succeeded',
    p_name;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p0_02_set_claims(
  p_role text,
  p_uid uuid,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_claims jsonb :=
    COALESCE(p_extra, '{}'::jsonb)
    || jsonb_build_object(
      'role', p_role,
      'sub', p_uid::text,
      'email',
        'p0-02-local-' ||
        replace(p_uid::text, '-', '') ||
        '@barinv.local.test'
    );
BEGIN
  PERFORM set_config('request.jwt.claim.role', p_role, false);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, false);
  PERFORM set_config(
    'request.jwt.claim.email',
    v_claims ->> 'email',
    false
  );
  PERFORM set_config('request.jwt.claims', v_claims::text, false);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p0_02_event(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT to_jsonb(e)
  FROM public.events AS e
  WHERE e.id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p0_02_audit_count(
  p_event_id uuid,
  p_source text
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
    AND a.review_source = p_source;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p0_02_assert_catalog(
  p_phase text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_function_oid oid :=
    to_regprocedure(
      'public.barinv_events_enforce_pending_insert_contract()'
    )::oid;
  v_insert_triggers text[];
  v_policy text;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'FAIL [%]: insert contract function missing', p_phase;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    WHERE p.oid = v_function_oid
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: insert guard SECURITY DEFINER/search_path missing',
      p_phase;
  END IF;

  IF has_function_privilege(
    'anon',
    'public.barinv_events_enforce_pending_insert_contract()',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.barinv_events_enforce_pending_insert_contract()',
    'EXECUTE'
  ) OR has_function_privilege(
    'barback_user',
    'public.barinv_events_enforce_pending_insert_contract()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: client role can directly execute insert guard',
      p_phase;
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.barinv_events_enforce_pending_insert_contract()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: service_role cannot execute insert guard',
      p_phase;
  END IF;

  SELECT array_agg(t.tgname ORDER BY t.tgname)
    INTO v_insert_triggers
  FROM pg_trigger AS t
  WHERE t.tgrelid = 'public.events'::regclass
    AND NOT t.tgisinternal
    AND pg_get_triggerdef(t.oid, true) LIKE
      'CREATE TRIGGER % BEFORE INSERT ON events %';

  IF v_insert_triggers IS NULL
     OR v_insert_triggers[1] <> 'trg_events_00_enforce_pending_insert'
     OR NOT (
       'trg_events_session_auto_approve' = ANY(v_insert_triggers)
     ) THEN
    RAISE EXCEPTION
      'FAIL [%]: insert guard does not run before session auto-approval: %',
      p_phase,
      v_insert_triggers;
  END IF;

  SELECT pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_policy
  FROM pg_policy AS p
  WHERE p.polrelid = 'public.events'::regclass
    AND p.polname = 'events_insert_v';

  IF v_policy IS NULL
     OR position('(status = ''PENDING''::text)' IN v_policy) = 0
     OR position('(source IS NULL)' IN v_policy) = 0
     OR position('(session_id IS NULL)' IN v_policy) = 0
     OR position(
       'has_venue_access(venue_id, ''manager''::text)'
       IN v_policy
     ) = 0 THEN
    RAISE EXCEPTION
      'FAIL [%]: events_insert_v lacks P0-02 checks: %',
      p_phase,
      v_policy;
  END IF;

  SELECT pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_policy
  FROM pg_policy AS p
  WHERE p.polrelid = 'public.events'::regclass
    AND p.polname = 'events_staff_insert';

  IF v_policy IS NULL
     OR position('(status = ''PENDING''::text)' IN v_policy) = 0
     OR position('(source IS NULL)' IN v_policy) = 0
     OR position('(session_id IS NULL)' IN v_policy) = 0 THEN
    RAISE EXCEPTION
      'FAIL [%]: events_staff_insert lacks P0-02 checks: %',
      p_phase,
      v_policy;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'events'
      AND (
        c.column_name ~
          '^(approved|reviewed|rejected)_(by|at)$'
        OR c.column_name ~ '^review_(job|session)_id$'
      )
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: unhandled Event approval/review columns exist',
      p_phase;
  END IF;
END;
$$;

DO $assert_migration_data_invariant$
DECLARE
  v_before record;
  v_after_count bigint;
  v_after_hash text;
BEGIN
  IF to_regclass('pg_temp.p0_02_events_before') IS NULL THEN
    RAISE EXCEPTION 'Missing pg_temp.p0_02_events_before';
  END IF;

  SELECT *
    INTO STRICT v_before
  FROM pg_temp.p0_02_events_before;

  SELECT
    count(*),
    md5(
      COALESCE(
        string_agg(to_jsonb(e)::text, '' ORDER BY e.id),
        ''
      )
    )
  INTO v_after_count, v_after_hash
  FROM public.events AS e;

  IF v_after_count IS DISTINCT FROM v_before.event_count
     OR v_after_hash IS DISTINCT FROM v_before.event_hash THEN
    RAISE EXCEPTION
      'P0-02 migration changed existing Events: before=(%,%), after=(%,%)',
      v_before.event_count,
      v_before.event_hash,
      v_after_count,
      v_after_hash;
  END IF;
END;
$assert_migration_data_invariant$;

SELECT pg_temp.p0_02_assert_catalog('forward migration');

RESET ROLE;

DELETE FROM public.event_review_audit
WHERE venue_id IN (
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.events
WHERE venue_id IN (
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.barback_sessions
WHERE venue_id IN (
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.venue_members
WHERE user_id IN (
  '98500000-0000-4000-8000-000000000001'::uuid,
  '98500000-0000-4000-8000-000000000002'::uuid,
  '98500000-0000-4000-8000-000000000003'::uuid
);

DELETE FROM public.staff
WHERE venue_id IN (
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.items
WHERE venue_id IN (
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.bars
WHERE venue_id IN (
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.nights
WHERE venue_id IN (
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.venues
WHERE id IN (
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM auth.users
WHERE id IN (
  '98500000-0000-4000-8000-000000000001'::uuid,
  '98500000-0000-4000-8000-000000000002'::uuid,
  '98500000-0000-4000-8000-000000000003'::uuid
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
    '98500000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'p0-02-manager@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"p0_02_manager"}'::jsonb,
    now(),
    now()
  ),
  (
    '98500000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'p0-02-staff@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"p0_02_staff"}'::jsonb,
    now(),
    now()
  ),
  (
    '98500000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'p0-02-unauthorized@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"p0_02_unauthorized"}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.venues (id, name, currency, active)
VALUES
  (
    '98400000-0000-4000-8000-000000000001'::uuid,
    'P0-02 LOCAL TEST VENUE',
    'CAD',
    true
  ),
  (
    '98400000-0000-4000-8000-000000000002'::uuid,
    'P0-02 OTHER VENUE',
    'CAD',
    true
  );

INSERT INTO public.nights (id, venue_id, name, date, code, active)
VALUES
  (
    '98400000-0000-4001-8000-000000000001'::uuid,
    '98400000-0000-4000-8000-000000000001'::uuid,
    'P0-02 LOCAL NIGHT',
    current_date,
    'P002-MAIN',
    true
  ),
  (
    '98400000-0000-4001-8000-000000000002'::uuid,
    '98400000-0000-4000-8000-000000000002'::uuid,
    'P0-02 OTHER NIGHT',
    current_date,
    'P002-OTHER',
    true
  );

INSERT INTO public.bars (id, venue_id, name, active, bar_type)
VALUES
  (
    '98400000-0000-4002-8000-000000000001'::uuid,
    '98400000-0000-4000-8000-000000000001'::uuid,
    'P0-02 LOCAL BAR',
    true,
    'bar'
  ),
  (
    '98400000-0000-4002-8000-000000000002'::uuid,
    '98400000-0000-4000-8000-000000000002'::uuid,
    'P0-02 OTHER BAR',
    true,
    'bar'
  );

INSERT INTO public.items (id, venue_id, name, unit, active)
VALUES
  (
    '98400000-0000-4003-8000-000000000001'::uuid,
    '98400000-0000-4000-8000-000000000001'::uuid,
    'P0-02 LOCAL ITEM',
    'bottle',
    true
  ),
  (
    '98400000-0000-4003-8000-000000000002'::uuid,
    '98400000-0000-4000-8000-000000000002'::uuid,
    'P0-02 OTHER ITEM',
    'bottle',
    true
  );

INSERT INTO public.staff (
  id,
  venue_id,
  name,
  role,
  active,
  auth_user_id
) VALUES
  (
    '98400000-0000-4004-8000-000000000001'::uuid,
    '98400000-0000-4000-8000-000000000001'::uuid,
    'P0-02 Manager',
    'manager',
    true,
    '98500000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '98400000-0000-4004-8000-000000000002'::uuid,
    '98400000-0000-4000-8000-000000000001'::uuid,
    'P0-02 Staff',
    'barback',
    true,
    '98500000-0000-4000-8000-000000000002'::uuid
  );

INSERT INTO public.venue_members (
  user_id,
  venue_id,
  role,
  created_by
) VALUES
  (
    '98500000-0000-4000-8000-000000000001'::uuid,
    '98400000-0000-4000-8000-000000000001'::uuid,
    'manager',
    '98500000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '98500000-0000-4000-8000-000000000002'::uuid,
    '98400000-0000-4000-8000-000000000001'::uuid,
    'staff',
    '98500000-0000-4000-8000-000000000001'::uuid
  );

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
) VALUES
  (
    '98600000-0000-4000-8000-000000000001'::uuid,
    '98400000-0000-4000-8000-000000000001'::uuid,
    '98400000-0000-4001-8000-000000000001'::uuid,
    '98400000-0000-4002-8000-000000000001'::uuid,
    ARRAY['98400000-0000-4002-8000-000000000001'::uuid],
    ARRAY['98400000-0000-4004-8000-000000000002'::uuid],
    'P0-02 auto false',
    '98400000-0000-4004-8000-000000000001'::uuid,
    now() + interval '2 hours',
    false
  ),
  (
    '98600000-0000-4000-8000-000000000002'::uuid,
    '98400000-0000-4000-8000-000000000001'::uuid,
    '98400000-0000-4001-8000-000000000001'::uuid,
    '98400000-0000-4002-8000-000000000001'::uuid,
    ARRAY['98400000-0000-4002-8000-000000000001'::uuid],
    ARRAY['98400000-0000-4004-8000-000000000002'::uuid],
    'P0-02 auto true',
    '98400000-0000-4004-8000-000000000001'::uuid,
    now() + interval '2 hours',
    true
  );

SET ROLE anon;
SELECT pg_temp.p0_02_set_claims(
  'anon',
  '98500000-0000-4000-8000-000000000003'::uuid
);
SELECT pg_temp.p0_02_expect_error(
  'anon_cannot_insert_approved',
  $$INSERT INTO public.events (
       id, venue_id, night_id, bar_id, item_id,
       submitted_by, qty, action, status
     ) VALUES (
       '98700000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4001-8000-000000000001'::uuid,
       '98400000-0000-4002-8000-000000000001'::uuid,
       '98400000-0000-4003-8000-000000000001'::uuid,
       'anon final attempt', 1, 'TAKEN', 'APPROVED'
     )$$,
  'permission denied'
);
SELECT pg_temp.p0_02_expect_error(
  'anon_cannot_insert_rejected',
  $$INSERT INTO public.events (
       id, venue_id, night_id, bar_id, item_id,
       submitted_by, qty, action, status
     ) VALUES (
       '98700000-0000-4000-8000-000000000016'::uuid,
       '98400000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4001-8000-000000000001'::uuid,
       '98400000-0000-4002-8000-000000000001'::uuid,
       '98400000-0000-4003-8000-000000000001'::uuid,
       'anon rejected attempt', 1, 'TAKEN', 'REJECTED'
     )$$,
  'permission denied'
);
SELECT pg_temp.p0_02_expect_error(
  'anon_cannot_insert_unknown_final_status',
  $$INSERT INTO public.events (
       id, venue_id, night_id, bar_id, item_id,
       submitted_by, qty, action, status
     ) VALUES (
       '98700000-0000-4000-8000-000000000017'::uuid,
       '98400000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4001-8000-000000000001'::uuid,
       '98400000-0000-4002-8000-000000000001'::uuid,
       '98400000-0000-4003-8000-000000000001'::uuid,
       'anon final attempt', 1, 'TAKEN', 'FINAL'
     )$$,
  'permission denied'
);

RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.p0_02_set_claims(
  'authenticated',
  '98500000-0000-4000-8000-000000000002'::uuid
);
SELECT pg_temp.p0_02_expect_error(
  'staff_cannot_insert_approved',
  $$INSERT INTO public.events (
       id, venue_id, night_id, bar_id, item_id, staff_id,
       submitted_by, qty, action, status
     ) VALUES (
       '98700000-0000-4000-8000-000000000002'::uuid,
       '98400000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4001-8000-000000000001'::uuid,
       '98400000-0000-4002-8000-000000000001'::uuid,
       '98400000-0000-4003-8000-000000000001'::uuid,
       '98400000-0000-4004-8000-000000000002'::uuid,
       'staff approved attempt', 1, 'TAKEN', 'APPROVED'
     )$$,
  'must begin with PENDING'
);
SELECT pg_temp.p0_02_expect_error(
  'staff_cannot_insert_rejected',
  $$INSERT INTO public.events (
       id, venue_id, night_id, bar_id, item_id, staff_id,
       submitted_by, qty, action, status
     ) VALUES (
       '98700000-0000-4000-8000-000000000003'::uuid,
       '98400000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4001-8000-000000000001'::uuid,
       '98400000-0000-4002-8000-000000000001'::uuid,
       '98400000-0000-4003-8000-000000000001'::uuid,
       '98400000-0000-4004-8000-000000000002'::uuid,
       'staff rejected attempt', 1, 'TAKEN', 'REJECTED'
     )$$,
  'must begin with PENDING'
);
SELECT pg_temp.p0_02_expect_error(
  'staff_cannot_insert_unknown_final_status',
  $$INSERT INTO public.events (
       id, venue_id, night_id, bar_id, item_id, staff_id,
       submitted_by, qty, action, status
     ) VALUES (
       '98700000-0000-4000-8000-000000000004'::uuid,
       '98400000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4001-8000-000000000001'::uuid,
       '98400000-0000-4002-8000-000000000001'::uuid,
       '98400000-0000-4003-8000-000000000001'::uuid,
       '98400000-0000-4004-8000-000000000002'::uuid,
       'staff final attempt', 1, 'TAKEN', 'FINAL'
     )$$,
  'must begin with PENDING'
);
SELECT pg_temp.p0_02_expect_error(
  'staff_cannot_prefill_server_source',
  $$INSERT INTO public.events (
       id, venue_id, night_id, bar_id, item_id, staff_id,
       submitted_by, qty, action, status, source
     ) VALUES (
       '98700000-0000-4000-8000-000000000005'::uuid,
       '98400000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4001-8000-000000000001'::uuid,
       '98400000-0000-4002-8000-000000000001'::uuid,
       '98400000-0000-4003-8000-000000000001'::uuid,
       '98400000-0000-4004-8000-000000000002'::uuid,
       'staff source attempt', 1, 'TAKEN', 'PENDING',
       'admin_csv_import'
     )$$,
  'source must be empty'
);
SELECT pg_temp.p0_02_expect_error(
  'staff_cannot_prefill_barback_session',
  $$INSERT INTO public.events (
       id, venue_id, night_id, bar_id, item_id, staff_id,
       submitted_by, qty, action, status, session_id
     ) VALUES (
       '98700000-0000-4000-8000-000000000006'::uuid,
       '98400000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4001-8000-000000000001'::uuid,
       '98400000-0000-4002-8000-000000000001'::uuid,
       '98400000-0000-4003-8000-000000000001'::uuid,
       '98400000-0000-4004-8000-000000000002'::uuid,
       'staff session attempt', 1, 'TAKEN', 'PENDING',
       '98600000-0000-4000-8000-000000000001'::uuid
     )$$,
  'session_id must be empty'
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
  status
) VALUES (
  '98700000-0000-4000-8000-000000000010'::uuid,
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4001-8000-000000000001'::uuid,
  '98400000-0000-4002-8000-000000000001'::uuid,
  '98400000-0000-4003-8000-000000000001'::uuid,
  '98400000-0000-4004-8000-000000000002'::uuid,
  'staff safe pending',
  1,
  'TAKEN',
  'PENDING'
);

SELECT pg_temp.p0_02_ok(
  'staff_safe_pending_insert_remains_possible',
  (
    pg_temp.p0_02_event(
      '98700000-0000-4000-8000-000000000010'::uuid
    ) ->> 'status'
  ) = 'PENDING'
);

RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.p0_02_set_claims(
  'authenticated',
  '98500000-0000-4000-8000-000000000001'::uuid
);
INSERT INTO public.events (
  id,
  venue_id,
  night_id,
  bar_id,
  item_id,
  submitted_by,
  qty,
  action,
  status,
  source
) VALUES (
  '98700000-0000-4000-8000-000000000011'::uuid,
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4001-8000-000000000001'::uuid,
  '98400000-0000-4002-8000-000000000001'::uuid,
  '98400000-0000-4003-8000-000000000001'::uuid,
  'manager operational approved',
  1,
  'TAKEN',
  'APPROVED',
  'admin_adjustment'
);

SELECT pg_temp.p0_02_ok(
  'manager_operational_approved_insert_preserved',
  (
    pg_temp.p0_02_event(
      '98700000-0000-4000-8000-000000000011'::uuid
    ) ->> 'status'
  ) = 'APPROVED'
);

SELECT pg_temp.p0_02_expect_error(
  'manager_cannot_insert_rejected',
  $$INSERT INTO public.events (
       id, venue_id, night_id, bar_id, item_id,
       submitted_by, qty, action, status
     ) VALUES (
       '98700000-0000-4000-8000-000000000012'::uuid,
       '98400000-0000-4000-8000-000000000001'::uuid,
       '98400000-0000-4001-8000-000000000001'::uuid,
       '98400000-0000-4002-8000-000000000001'::uuid,
       '98400000-0000-4003-8000-000000000001'::uuid,
       'manager rejected attempt', 1, 'TAKEN', 'REJECTED'
     )$$,
  'review workflow'
);

RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.p0_02_set_claims(
  'service_role',
  '98500000-0000-4000-8000-000000000003'::uuid
);
INSERT INTO public.events (
  id,
  venue_id,
  night_id,
  bar_id,
  item_id,
  submitted_by,
  qty,
  action,
  status,
  source
) VALUES (
  '98700000-0000-4000-8000-000000000013'::uuid,
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4001-8000-000000000001'::uuid,
  '98400000-0000-4002-8000-000000000001'::uuid,
  '98400000-0000-4003-8000-000000000001'::uuid,
  'service maintenance rejected',
  1,
  'TAKEN',
  'REJECTED',
  'service_maintenance'
);

SELECT pg_temp.p0_02_ok(
  'service_role_final_insert_preserved',
  (
    pg_temp.p0_02_event(
      '98700000-0000-4000-8000-000000000013'::uuid
    ) ->> 'status'
  ) = 'REJECTED'
);

RESET ROLE;
SET ROLE barback_user;
SELECT pg_temp.p0_02_set_claims(
  'barback_user',
  '98500000-0000-4000-8000-000000000002'::uuid,
  jsonb_build_object(
    'venue_id', '98400000-0000-4000-8000-000000000001',
    'night_id', '98400000-0000-4001-8000-000000000001',
    'staff_id', '98400000-0000-4004-8000-000000000002',
    'session_id', '98600000-0000-4000-8000-000000000001',
    'bar_id', '98400000-0000-4002-8000-000000000001',
    'allowed_bars', '98400000-0000-4002-8000-000000000001'
  )
);
INSERT INTO public.events (
  id,
  venue_id,
  night_id,
  bar_id,
  item_id,
  staff_id,
  session_id,
  source,
  submitted_by,
  qty,
  action,
  status
) VALUES (
  '98700000-0000-4000-8000-000000000014'::uuid,
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4001-8000-000000000001'::uuid,
  '98400000-0000-4002-8000-000000000001'::uuid,
  '98400000-0000-4003-8000-000000000001'::uuid,
  '98400000-0000-4004-8000-000000000002'::uuid,
  '98600000-0000-4000-8000-000000000001'::uuid,
  'barback_web_link',
  'barback malicious final',
  1,
  'TAKEN',
  'APPROVED'
);

SELECT pg_temp.p0_02_ok(
  'barback_client_final_status_is_normalized_to_pending',
  (
    pg_temp.p0_02_event(
      '98700000-0000-4000-8000-000000000014'::uuid
    ) ->> 'status'
  ) = 'PENDING'
);

SELECT pg_temp.p0_02_set_claims(
  'barback_user',
  '98500000-0000-4000-8000-000000000002'::uuid,
  jsonb_build_object(
    'venue_id', '98400000-0000-4000-8000-000000000001',
    'night_id', '98400000-0000-4001-8000-000000000001',
    'staff_id', '98400000-0000-4004-8000-000000000002',
    'session_id', '98600000-0000-4000-8000-000000000002',
    'bar_id', '98400000-0000-4002-8000-000000000001',
    'allowed_bars', '98400000-0000-4002-8000-000000000001'
  )
);
INSERT INTO public.events (
  id,
  venue_id,
  night_id,
  bar_id,
  item_id,
  staff_id,
  session_id,
  source,
  submitted_by,
  qty,
  action,
  status
) VALUES (
  '98700000-0000-4000-8000-000000000015'::uuid,
  '98400000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4001-8000-000000000001'::uuid,
  '98400000-0000-4002-8000-000000000001'::uuid,
  '98400000-0000-4003-8000-000000000001'::uuid,
  '98400000-0000-4004-8000-000000000002'::uuid,
  '98600000-0000-4000-8000-000000000002'::uuid,
  'barback_web_link',
  'barback safe pending',
  1,
  'TAKEN',
  'PENDING'
);

SELECT pg_temp.p0_02_ok(
  'server_auto_approval_still_works_after_client_guard',
  (
    pg_temp.p0_02_event(
      '98700000-0000-4000-8000-000000000015'::uuid
    ) ->> 'status'
  ) = 'APPROVED'
  AND pg_temp.p0_02_audit_count(
    '98700000-0000-4000-8000-000000000015'::uuid,
    'session_auto'
  ) = 1
);

RESET ROLE;

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.email', '', true);
SELECT set_config('request.jwt.claims', '{}', true);

SELECT pg_temp.p0_02_assert_catalog('after runtime assertions');

SELECT
  count(*) AS assertions,
  count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed
FROM p0_02_test_results;
