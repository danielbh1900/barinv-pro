\set ON_ERROR_STOP on
\pset pager off

-- P0-01 isolated assertions.
--
-- The test runner must open one outer transaction, capture the pre-migration
-- Event count/hash in pg_temp.p0_01_events_before, apply the actual migration,
-- include this file, and roll back the outer transaction.

CREATE TEMP TABLE p0_01_test_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
);

CREATE TEMP TABLE p0_01_test_state (
  key text PRIMARY KEY,
  value jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON p0_01_test_results
  TO PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON p0_01_test_state
  TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.p0_01_ok(
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

  INSERT INTO p0_01_test_results(test_name, passed, detail)
  VALUES (p_name, true, p_detail)
  ON CONFLICT (test_name) DO UPDATE
    SET passed = EXCLUDED.passed,
        detail = EXCLUDED.detail;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p0_01_expect_error(
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

    INSERT INTO p0_01_test_results(test_name, passed, detail)
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

CREATE OR REPLACE FUNCTION pg_temp.p0_01_set_claims(
  p_role text,
  p_uid uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_claims jsonb :=
    jsonb_build_object(
      'role', p_role,
      'sub', p_uid::text,
      'email',
        'p0-01-local-' ||
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

CREATE OR REPLACE FUNCTION pg_temp.p0_01_event(
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

CREATE OR REPLACE FUNCTION pg_temp.p0_01_assert_catalog(
  p_phase text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_function_oid oid :=
    to_regprocedure(
      'public.barinv_events_guard_protected_update()'
    )::oid;
  v_trigger_definition text;
  v_protected_columns constant text[] := ARRAY[
    'id',
    'venue_id',
    'night_id',
    'bar_id',
    'station_id',
    'item_id',
    'staff_id',
    'submitted_by',
    'qty',
    'action',
    'reason_code',
    'qty_basis',
    'client_event_id',
    'source',
    'session_id',
    'created_at'
  ];
  v_column text;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'FAIL [%]: protected-field guard missing', p_phase;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    WHERE p.oid = v_function_oid
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: guard SECURITY DEFINER/search_path contract missing',
      p_phase;
  END IF;

  IF has_function_privilege(
    'anon',
    'public.barinv_events_guard_protected_update()',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.barinv_events_guard_protected_update()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: normal API role can execute trigger function',
      p_phase;
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.barinv_events_guard_protected_update()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: service_role lost trigger function access',
      p_phase;
  END IF;

  SELECT pg_get_triggerdef(t.oid, true)
    INTO v_trigger_definition
  FROM pg_trigger AS t
  WHERE t.tgrelid = 'public.events'::regclass
    AND t.tgname = 'trg_events_guard_protected_update'
    AND NOT t.tgisinternal;

  IF v_trigger_definition IS NULL
     OR v_trigger_definition NOT LIKE 'CREATE TRIGGER % BEFORE UPDATE OF %'
  THEN
    RAISE EXCEPTION
      'FAIL [%]: protected-field BEFORE UPDATE trigger missing',
      p_phase;
  END IF;

  FOREACH v_column IN ARRAY v_protected_columns
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'events'
        AND c.column_name = v_column
    ) THEN
      RAISE EXCEPTION
        'FAIL [%]: expected protected column % is absent',
        p_phase,
        v_column;
    END IF;

    IF has_column_privilege(
      'authenticated',
      'public.events',
      v_column,
      'UPDATE'
    ) THEN
      RAISE EXCEPTION
        'FAIL [%]: authenticated retains UPDATE on protected column %',
        p_phase,
        v_column;
    END IF;

    IF position(v_column IN v_trigger_definition) = 0 THEN
      RAISE EXCEPTION
        'FAIL [%]: trigger definition omits protected column %',
        p_phase,
        v_column;
    END IF;
  END LOOP;

  IF has_table_privilege(
    'authenticated',
    'public.events',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: authenticated retains table-wide UPDATE',
      p_phase;
  END IF;

  IF NOT has_column_privilege(
    'authenticated',
    'public.events',
    'status',
    'UPDATE'
  ) OR NOT has_column_privilege(
    'authenticated',
    'public.events',
    'notes',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: status/notes compatibility grants missing',
      p_phase;
  END IF;

  IF has_any_column_privilege(
    'anon',
    'public.events',
    'UPDATE'
  ) OR has_any_column_privilege(
    'barback_user',
    'public.events',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: anon or barback_user retains Event UPDATE',
      p_phase;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy AS p
    WHERE p.polrelid = 'public.events'::regclass
      AND p.polname = 'events_update_v'
      AND p.polcmd = 'w'
      AND pg_get_expr(p.polqual, p.polrelid)
        = 'has_venue_access(venue_id, ''manager''::text)'
      AND pg_get_expr(p.polwithcheck, p.polrelid)
        = 'has_venue_access(venue_id, ''manager''::text)'
  ) THEN
    RAISE EXCEPTION
      'FAIL [%]: manager-only events_update_v policy missing',
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
  IF to_regclass('pg_temp.p0_01_events_before') IS NULL THEN
    RAISE EXCEPTION 'Missing pg_temp.p0_01_events_before';
  END IF;

  SELECT *
    INTO STRICT v_before
  FROM pg_temp.p0_01_events_before;

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
      'P0-01 migration changed existing Events: before=(%,%), after=(%,%)',
      v_before.event_count,
      v_before.event_hash,
      v_after_count,
      v_after_hash;
  END IF;
END;
$assert_migration_data_invariant$;

SELECT pg_temp.p0_01_assert_catalog('forward migration');

RESET ROLE;

DELETE FROM public.event_review_audit
WHERE venue_id IN (
  '98000000-0000-4000-8000-000000000001'::uuid,
  '98000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.events
WHERE venue_id IN (
  '98000000-0000-4000-8000-000000000001'::uuid,
  '98000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.venue_members
WHERE user_id IN (
  '98100000-0000-4000-8000-000000000001'::uuid,
  '98100000-0000-4000-8000-000000000002'::uuid,
  '98100000-0000-4000-8000-000000000003'::uuid
);

DELETE FROM public.staff
WHERE venue_id IN (
  '98000000-0000-4000-8000-000000000001'::uuid,
  '98000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.items
WHERE venue_id IN (
  '98000000-0000-4000-8000-000000000001'::uuid,
  '98000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.bars
WHERE venue_id IN (
  '98000000-0000-4000-8000-000000000001'::uuid,
  '98000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.nights
WHERE venue_id IN (
  '98000000-0000-4000-8000-000000000001'::uuid,
  '98000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM public.venues
WHERE id IN (
  '98000000-0000-4000-8000-000000000001'::uuid,
  '98000000-0000-4000-8000-000000000002'::uuid
);

DELETE FROM auth.users
WHERE id IN (
  '98100000-0000-4000-8000-000000000001'::uuid,
  '98100000-0000-4000-8000-000000000002'::uuid,
  '98100000-0000-4000-8000-000000000003'::uuid
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
    '98100000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'p0-01-manager@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"p0_01_manager"}'::jsonb,
    now(),
    now()
  ),
  (
    '98100000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'p0-01-staff@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"p0_01_staff"}'::jsonb,
    now(),
    now()
  ),
  (
    '98100000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'p0-01-unauthorized@barinv.local.test',
    now(),
    '{"provider":"local_test","providers":["local_test"]}'::jsonb,
    '{"local_only":true,"fixture":"p0_01_unauthorized"}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.venues (id, name, currency, active)
VALUES
  (
    '98000000-0000-4000-8000-000000000001'::uuid,
    'P0-01 LOCAL TEST VENUE',
    'CAD',
    true
  ),
  (
    '98000000-0000-4000-8000-000000000002'::uuid,
    'P0-01 OTHER VENUE',
    'CAD',
    true
  );

INSERT INTO public.nights (id, venue_id, name, date, code, active)
VALUES
  (
    '98000000-0000-4001-8000-000000000001'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    'P0-01 LOCAL NIGHT',
    current_date,
    'P001-MAIN',
    true
  ),
  (
    '98000000-0000-4001-8000-000000000002'::uuid,
    '98000000-0000-4000-8000-000000000002'::uuid,
    'P0-01 OTHER NIGHT',
    current_date,
    'P001-OTHER',
    true
  );

INSERT INTO public.bars (id, venue_id, name, active, bar_type)
VALUES
  (
    '98000000-0000-4002-8000-000000000001'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    'P0-01 LOCAL BAR',
    true,
    'bar'
  ),
  (
    '98000000-0000-4002-8000-000000000002'::uuid,
    '98000000-0000-4000-8000-000000000002'::uuid,
    'P0-01 OTHER BAR',
    true,
    'bar'
  );

INSERT INTO public.items (id, venue_id, name, unit, active)
VALUES
  (
    '98000000-0000-4003-8000-000000000001'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    'P0-01 LOCAL ITEM',
    'bottle',
    true
  ),
  (
    '98000000-0000-4003-8000-000000000002'::uuid,
    '98000000-0000-4000-8000-000000000002'::uuid,
    'P0-01 OTHER ITEM',
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
    '98000000-0000-4004-8000-000000000001'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    'P0-01 Manager',
    'manager',
    true,
    '98100000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '98000000-0000-4004-8000-000000000002'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    'P0-01 Staff',
    'barback',
    true,
    '98100000-0000-4000-8000-000000000002'::uuid
  );

INSERT INTO public.venue_members (
  user_id,
  venue_id,
  role,
  created_by
) VALUES
  (
    '98100000-0000-4000-8000-000000000001'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    'manager',
    '98100000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '98100000-0000-4000-8000-000000000002'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    'staff',
    '98100000-0000-4000-8000-000000000001'::uuid
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
  notes,
  reason_code,
  qty_basis,
  client_event_id,
  source,
  created_at
) VALUES
  (
    '98300000-0000-4000-8000-000000000001'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    '98000000-0000-4001-8000-000000000001'::uuid,
    '98000000-0000-4002-8000-000000000001'::uuid,
    '98000000-0000-4003-8000-000000000001'::uuid,
    '98000000-0000-4004-8000-000000000002'::uuid,
    'P0-01 pending fixture',
    1,
    'TAKEN',
    'PENDING',
    'pending note',
    NULL,
    'item_unit',
    'p0-01-pending',
    'admin_adjustment',
    now() - interval '3 minutes'
  ),
  (
    '98300000-0000-4000-8000-000000000002'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    '98000000-0000-4001-8000-000000000001'::uuid,
    '98000000-0000-4002-8000-000000000001'::uuid,
    '98000000-0000-4003-8000-000000000001'::uuid,
    '98000000-0000-4004-8000-000000000002'::uuid,
    'P0-01 approved fixture',
    2,
    'RETURNED',
    'APPROVED',
    'approved note',
    NULL,
    'item_unit',
    'p0-01-approved',
    'admin_adjustment',
    now() - interval '2 minutes'
  ),
  (
    '98300000-0000-4000-8000-000000000003'::uuid,
    '98000000-0000-4000-8000-000000000001'::uuid,
    '98000000-0000-4001-8000-000000000001'::uuid,
    '98000000-0000-4002-8000-000000000001'::uuid,
    '98000000-0000-4003-8000-000000000001'::uuid,
    '98000000-0000-4004-8000-000000000002'::uuid,
    'P0-01 rejected fixture',
    3,
    'DELIVERED',
    'REJECTED',
    'rejected note',
    NULL,
    'item_unit',
    'p0-01-rejected',
    'admin_adjustment',
    now() - interval '1 minute'
  );

SET ROLE anon;
SELECT pg_temp.p0_01_set_claims(
  'anon',
  '98100000-0000-4000-8000-000000000003'::uuid
);
SELECT pg_temp.p0_01_expect_error(
  'anon_cannot_update_event',
  $$UPDATE public.events
       SET qty = 99
     WHERE id = '98300000-0000-4000-8000-000000000001'::uuid$$,
  'permission denied'
);

RESET ROLE;
SET ROLE barback_user;
SELECT pg_temp.p0_01_set_claims(
  'barback_user',
  '98100000-0000-4000-8000-000000000002'::uuid
);
SELECT pg_temp.p0_01_expect_error(
  'barback_user_cannot_update_event',
  $$UPDATE public.events
       SET action = 'RETURNED'
     WHERE id = '98300000-0000-4000-8000-000000000001'::uuid$$,
  'permission denied'
);

RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.p0_01_set_claims(
  'authenticated',
  '98100000-0000-4000-8000-000000000002'::uuid
);
SELECT pg_temp.p0_01_expect_error(
  'venue_staff_cannot_update_protected_qty',
  $$UPDATE public.events
       SET qty = 99
     WHERE id = '98300000-0000-4000-8000-000000000001'::uuid$$,
  'permission denied'
);

UPDATE public.events
   SET notes = 'staff should not change notes'
 WHERE id = '98300000-0000-4000-8000-000000000001'::uuid;

SELECT pg_temp.p0_01_ok(
  'venue_staff_cannot_update_even_allowed_columns',
  pg_temp.p0_01_event(
    '98300000-0000-4000-8000-000000000001'::uuid
  ) ->> 'notes' = 'pending note',
  'manager-only RLS must reject staff note updates'
);

RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.p0_01_set_claims(
  'authenticated',
  '98100000-0000-4000-8000-000000000003'::uuid
);
SELECT pg_temp.p0_01_expect_error(
  'unauthorized_authenticated_cannot_update_protected_action',
  $$UPDATE public.events
       SET action = 'RETURNED'
     WHERE id = '98300000-0000-4000-8000-000000000001'::uuid$$,
  'permission denied'
);

RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.p0_01_set_claims(
  'authenticated',
  '98100000-0000-4000-8000-000000000001'::uuid
);
SELECT pg_temp.p0_01_expect_error(
  'manager_cannot_rewrite_pending_qty',
  $$UPDATE public.events
       SET qty = 99
     WHERE id = '98300000-0000-4000-8000-000000000001'::uuid$$,
  'permission denied'
);
SELECT pg_temp.p0_01_expect_error(
  'manager_cannot_rewrite_approved_action',
  $$UPDATE public.events
       SET action = 'TAKEN'
     WHERE id = '98300000-0000-4000-8000-000000000002'::uuid$$,
  'permission denied'
);
SELECT pg_temp.p0_01_expect_error(
  'manager_cannot_rewrite_rejected_created_at',
  $$UPDATE public.events
       SET created_at = now()
     WHERE id = '98300000-0000-4000-8000-000000000003'::uuid$$,
  'permission denied'
);

UPDATE public.events
   SET notes = 'manager note correction'
 WHERE id = '98300000-0000-4000-8000-000000000001'::uuid;

SELECT pg_temp.p0_01_ok(
  'manager_note_compatibility_preserved',
  pg_temp.p0_01_event(
    '98300000-0000-4000-8000-000000000001'::uuid
  ) ->> 'notes' = 'manager note correction'
);

-- Temporarily restore one column grant inside the disposable transaction to
-- prove the trigger independently blocks a future accidental ACL regression.
RESET ROLE;
GRANT UPDATE (qty) ON public.events TO authenticated;
SET ROLE authenticated;
SELECT pg_temp.p0_01_set_claims(
  'authenticated',
  '98100000-0000-4000-8000-000000000001'::uuid
);
SELECT pg_temp.p0_01_expect_error(
  'trigger_blocks_accidental_protected_column_grant',
  $$UPDATE public.events
       SET qty = 88
     WHERE id = '98300000-0000-4000-8000-000000000001'::uuid$$,
  'protected fields are immutable'
);
SELECT pg_temp.p0_01_expect_error(
  'trigger_blocks_mixed_status_and_qty_change',
  $$UPDATE public.events
       SET status = 'APPROVED',
           qty = 88
     WHERE id = '98300000-0000-4000-8000-000000000001'::uuid$$,
  'protected fields are immutable'
);
RESET ROLE;
REVOKE UPDATE (qty) ON public.events FROM authenticated;

SET ROLE authenticated;
SELECT pg_temp.p0_01_set_claims(
  'authenticated',
  '98100000-0000-4000-8000-000000000001'::uuid
);

INSERT INTO p0_01_test_state(key, value)
VALUES (
  'review_result',
  public.barinv_review_events(
    '98000000-0000-4000-8000-000000000001'::uuid,
    'APPROVED',
    ARRAY[
      '98300000-0000-4000-8000-000000000001'::uuid
    ],
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
);

SELECT pg_temp.p0_01_ok(
  'approved_review_rpc_updates_one',
  (
    SELECT (value ->> 'updated')::integer = 1
    FROM p0_01_test_state
    WHERE key = 'review_result'
  ),
  (
    SELECT value::text
    FROM p0_01_test_state
    WHERE key = 'review_result'
  )
);

SELECT pg_temp.p0_01_ok(
  'approved_review_rpc_changes_status',
  (
    pg_temp.p0_01_event(
      '98300000-0000-4000-8000-000000000001'::uuid
    ) ->> 'status'
  ) = 'APPROVED'
);

SELECT pg_temp.p0_01_ok(
  'approved_review_rpc_writes_exactly_one_audit',
  (
    SELECT count(*) = 1
    FROM public.event_review_audit
    WHERE event_id =
      '98300000-0000-4000-8000-000000000001'::uuid
  )
);

RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.p0_01_set_claims(
  'service_role',
  '98100000-0000-4000-8000-000000000003'::uuid
);
UPDATE public.events
   SET qty = 4
 WHERE id = '98300000-0000-4000-8000-000000000002'::uuid;

SELECT pg_temp.p0_01_ok(
  'service_role_maintenance_access_preserved',
  (
    pg_temp.p0_01_event(
      '98300000-0000-4000-8000-000000000002'::uuid
    ) ->> 'qty'
  )::numeric = 4
);

RESET ROLE;

SELECT set_config('barinv.review_source', '', true);
SELECT set_config('barinv.review_reason', '', true);
SELECT set_config('barinv.review_metadata', '', true);

SELECT pg_temp.p0_01_assert_catalog('after runtime assertions');

SELECT
  count(*) AS assertions,
  count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed
FROM p0_01_test_results;
