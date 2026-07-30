\set ON_ERROR_STOP on

-- P0-03 isolated catalog assertions.
--
-- The test runner must:
--   1. BEGIN a transaction.
--   2. Create pg_temp.p0_03_table_counts_before for every public table.
--   3. Create pg_temp.p0_03_function_metadata_before for the target functions.
--   4. Apply the actual P0-03 migration.
--   5. Include this file.
--   6. ROLLBACK the transaction.
--
-- No target function is executed because these helpers create/prune data.

DO $assert_setup$
BEGIN
  IF to_regclass('pg_temp.p0_03_table_counts_before') IS NULL THEN
    RAISE EXCEPTION
      'Missing pg_temp.p0_03_table_counts_before test fixture';
  END IF;

  IF to_regclass('pg_temp.p0_03_function_metadata_before') IS NULL THEN
    RAISE EXCEPTION
      'Missing pg_temp.p0_03_function_metadata_before test fixture';
  END IF;
END;
$assert_setup$;

DO $assert_catalog$
DECLARE
  v_signature regprocedure;
  v_proc record;
  v_before record;
  v_target_signatures constant text[] := ARRAY[
    'public._do_create_backup(uuid,text,jsonb,uuid)',
    'public._backup_all_venues_daily()',
    'public.prune_venue_backups(uuid)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    to_regprocedure(v_target_signatures[1]),
    to_regprocedure(v_target_signatures[2]),
    to_regprocedure(v_target_signatures[3])
  ]
  LOOP
    IF v_signature IS NULL THEN
      RAISE EXCEPTION 'A P0-03 target function no longer exists';
    END IF;

    SELECT
      p.oid,
      p.proowner,
      p.prosecdef,
      p.proconfig,
      md5(pg_get_functiondef(p.oid)) AS definition_hash,
      obj_description(p.oid, 'pg_proc') AS catalog_comment
    INTO STRICT v_proc
    FROM pg_proc p
    WHERE p.oid = v_signature::oid;

    SELECT *
    INTO STRICT v_before
    FROM pg_temp.p0_03_function_metadata_before b
    WHERE b.signature = v_signature::text;

    IF v_proc.proowner IS DISTINCT FROM v_before.proowner THEN
      RAISE EXCEPTION
        'Function owner changed for %',
        v_signature;
    END IF;

    IF v_proc.prosecdef IS DISTINCT FROM v_before.prosecdef
       OR NOT v_proc.prosecdef THEN
      RAISE EXCEPTION
        'SECURITY DEFINER was not preserved for %',
        v_signature;
    END IF;

    IF v_proc.proconfig IS DISTINCT FROM v_before.proconfig THEN
      RAISE EXCEPTION
        'Function configuration changed for %',
        v_signature;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(v_proc.proconfig, ARRAY[]::text[])) AS setting
      WHERE setting = 'search_path=public, pg_catalog'
    ) THEN
      RAISE EXCEPTION
        'Explicit safe search_path is missing for %',
        v_signature;
    END IF;

    IF v_proc.definition_hash IS DISTINCT FROM v_before.definition_hash THEN
      RAISE EXCEPTION
        'Function body changed for %',
        v_signature;
    END IF;

    IF COALESCE(v_proc.catalog_comment, '') NOT LIKE 'P0-03 %' THEN
      RAISE EXCEPTION
        'P0-03 catalog comment is missing for %',
        v_signature;
    END IF;

    IF has_function_privilege(
      'anon',
      v_signature::text,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'anon still has EXECUTE on %',
        v_signature;
    END IF;

    IF has_function_privilege(
      'authenticated',
      v_signature::text,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'authenticated still has EXECUTE on %',
        v_signature;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(
          (
            SELECT p.proacl
            FROM pg_proc p
            WHERE p.oid = v_signature::oid
          ),
          acldefault(
            'f',
            (
              SELECT p.proowner
              FROM pg_proc p
              WHERE p.oid = v_signature::oid
            )
          )
        )
      ) acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'PUBLIC still has EXECUTE on %',
        v_signature;
    END IF;

    IF NOT has_function_privilege(
      'service_role',
      v_signature::text,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'service_role lost EXECUTE on %',
        v_signature;
    END IF;
  END LOOP;
END;
$assert_catalog$;

DO $assert_rows$
DECLARE
  v_table record;
  v_count bigint;
  v_before_count bigint;
BEGIN
  FOR v_table IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I',
      v_table.schemaname,
      v_table.tablename
    )
    INTO v_count;

    SELECT b.row_count
    INTO v_before_count
    FROM pg_temp.p0_03_table_counts_before b
    WHERE b.schemaname = v_table.schemaname
      AND b.tablename = v_table.tablename;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Public table appeared during migration: %.%',
        v_table.schemaname,
        v_table.tablename;
    END IF;

    IF v_count IS DISTINCT FROM v_before_count THEN
      RAISE EXCEPTION
        'Row count changed for %.%: before %, after %',
        v_table.schemaname,
        v_table.tablename,
        v_before_count,
        v_count;
    END IF;
  END LOOP;

  IF (
    SELECT count(*)
    FROM pg_temp.p0_03_table_counts_before
  ) IS DISTINCT FROM (
    SELECT count(*)
    FROM pg_tables
    WHERE schemaname = 'public'
  ) THEN
    RAISE EXCEPTION
      'Public table count changed while applying P0-03';
  END IF;
END;
$assert_rows$;

SELECT
  'P0-03 backup maintenance function grant assertions: PASS'
    AS result;
