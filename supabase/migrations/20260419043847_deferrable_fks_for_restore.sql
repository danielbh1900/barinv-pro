-- ═══════════════════════════════════════════════════════════════════
-- Deferrable FKs for transactional restore
--
-- v2.4.2 restore_venue_backup used SET session_replication_role='replica'
-- to bypass FK checks during delete+reinsert, but that GUC is
-- superuser-only in Supabase hosted Postgres — even inside a
-- SECURITY DEFINER function owned by `postgres`. Confirmed via
-- end-to-end test: 42501 permission denied.
--
-- Fix: switch every FK on venue-scoped tables to DEFERRABLE
-- INITIALLY IMMEDIATE. Normal behavior is unchanged (INITIALLY
-- IMMEDIATE = fire on every INSERT/UPDATE), but a caller with
-- authenticated role can now issue `SET CONSTRAINTS ALL DEFERRED`
-- inside a transaction — which is standard SQL, no superuser required.
--
-- Idempotent: the DO block skips any FK that's already deferrable.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Convert every FK on any table with a venue_id column to deferrable.
DO $$
DECLARE
  r RECORD;
  count_changed int := 0;
  count_skipped int := 0;
BEGIN
  FOR r IN
    SELECT c.conname, t.relname
    FROM pg_constraint c
    JOIN pg_class     t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name   = t.relname
          AND col.column_name  = 'venue_id'
      )
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint c2
      WHERE c2.conname = r.conname
        AND c2.condeferrable = true
    ) THEN
      count_skipped := count_skipped + 1;
    ELSE
      EXECUTE format(
        'ALTER TABLE public.%I ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE',
        r.relname, r.conname
      );
      count_changed := count_changed + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '[deferrable-fks] changed=% skipped=%', count_changed, count_skipped;
END $$;

-- 2. Rewrite restore_venue_backup to use SET CONSTRAINTS ALL DEFERRED.
--    Signature unchanged (uuid → jsonb). Body simpler and portable.
CREATE OR REPLACE FUNCTION public.restore_venue_backup(v_backup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
DECLARE
  bk           public.backup_snapshots;
  t            text;
  rows_ins     integer;
  total_ins    integer := 0;
  tables_used  integer := 0;
BEGIN
  SELECT * INTO bk FROM public.backup_snapshots WHERE id = v_backup_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup not found';
  END IF;
  IF NOT public.has_venue_access(bk.venue_id, 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required on this venue';
  END IF;

  -- Defer FK checks for the duration of this transaction. All venue-
  -- scoped FKs were switched to DEFERRABLE in the deferrable_fks_for_restore
  -- migration. Non-deferrable FKs (if any get added later) will simply
  -- continue firing eagerly — the restore may then fail on order, which
  -- is preferable to silent corruption.
  SET CONSTRAINTS ALL DEFERRED;

  -- Wipe current venue data (all venue-scoped tables)
  FOR t IN SELECT table_name FROM public._venue_scoped_tables() LOOP
    EXECUTE format('DELETE FROM public.%I WHERE venue_id = $1', t) USING bk.venue_id;
  END LOOP;

  -- Reinsert from payload, populating full rows via jsonb_populate_recordset
  FOR t IN SELECT table_name FROM public._venue_scoped_tables() LOOP
    IF bk.payload ? t AND jsonb_typeof(bk.payload->t) = 'array'
       AND jsonb_array_length(bk.payload->t) > 0 THEN
      EXECUTE format(
        'INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(NULL::public.%I, $1)',
        t, t
      ) USING bk.payload->t;
      GET DIAGNOSTICS rows_ins = ROW_COUNT;
      total_ins := total_ins + rows_ins;
      tables_used := tables_used + 1;
    END IF;
  END LOOP;

  -- SET CONSTRAINTS IMMEDIATE forces all deferred checks NOW,
  -- before COMMIT, so any violation produces an error we can
  -- translate clearly instead of COMMIT-time surprises.
  SET CONSTRAINTS ALL IMMEDIATE;

  RAISE NOTICE '[BARINV-restore] backup=% venue=% rows_inserted=% tables=%',
    v_backup_id, bk.venue_id, total_ins, tables_used;

  RETURN jsonb_build_object(
    'backup_id',       bk.id,
    'venue_id',        bk.venue_id,
    'rows_inserted',   total_ins,
    'tables_restored', tables_used,
    'restored_at',     now()
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.restore_venue_backup(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.restore_venue_backup(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';;
