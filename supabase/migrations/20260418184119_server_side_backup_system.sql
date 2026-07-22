-- ═══════════════════════════════════════════════════════════════════
-- v2.4.2 — Server-side backup system (Option A: DB-resident snapshots)
--
-- Full, atomic, venue-scoped snapshots stored as JSONB. Triggers:
--   • daily cron at 4 AM
--   • pre_clean   (client calls before Clean Night Data)
--   • pre_restore (client calls before Restore From Backup)
--   • manual      (admin taps "Backup Now")
--
-- Retention: last 30 daily + last 12 monthly per venue. Pruning runs
-- after every backup; cron keeps the set bounded.
--
-- Restore: FULL replace, transactional, FK-safe via
-- session_replication_role=replica. All-or-nothing.
--
-- Auth: admin+ on venue for both create & restore (RLS on the table
-- itself + explicit has_venue_access check in the functions).
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. Snapshot storage -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backup_snapshots (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         uuid         NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  trigger_source   text         NOT NULL CHECK (trigger_source IN ('cron','pre_clean','pre_restore','manual')),
  trigger_context  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  payload          jsonb        NOT NULL,
  row_count        integer      NOT NULL DEFAULT 0,
  table_count      integer      NOT NULL DEFAULT 0,
  byte_size        bigint       GENERATED ALWAYS AS (octet_length(payload::text)) STORED,
  created_by       uuid         NULL
);
CREATE INDEX IF NOT EXISTS idx_bks_venue_time ON public.backup_snapshots(venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bks_trigger    ON public.backup_snapshots(trigger_source);

ALTER TABLE public.backup_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bks_admin_all ON public.backup_snapshots;
CREATE POLICY bks_admin_all ON public.backup_snapshots
  FOR ALL TO authenticated
  USING (public.has_venue_access(venue_id, 'admin'))
  WITH CHECK (public.has_venue_access(venue_id, 'admin'));

-- 2. Discover venue-scoped tables (any table with a venue_id column) --
CREATE OR REPLACE FUNCTION public._venue_scoped_tables() RETURNS TABLE(table_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
  SELECT c.table_name::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.column_name = 'venue_id'
    -- Exclude the backup table itself + ephemeral logs to avoid recursive growth.
    AND c.table_name NOT IN ('backup_snapshots')
  ORDER BY c.table_name;
$fn$;

-- 3. Internal dump (no auth check; called by cron + public wrappers) --
CREATE OR REPLACE FUNCTION public._do_create_backup(
  v_venue_id uuid,
  v_trigger  text,
  v_context  jsonb DEFAULT '{}'::jsonb,
  v_caller   uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
DECLARE
  payload      jsonb := '{}'::jsonb;
  tbl_payload  jsonb;
  tbl_count    integer;
  total_rows   integer := 0;
  total_tables integer := 0;
  t            text;
  bk_id        uuid;
BEGIN
  FOR t IN SELECT table_name FROM public._venue_scoped_tables() LOOP
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(r)), ''[]''::jsonb), count(*)::int
         FROM public.%I r WHERE venue_id = $1', t
    ) INTO tbl_payload, tbl_count USING v_venue_id;
    payload := payload || jsonb_build_object(t, tbl_payload);
    total_rows := total_rows + tbl_count;
    total_tables := total_tables + 1;
  END LOOP;

  INSERT INTO public.backup_snapshots
    (venue_id, trigger_source, trigger_context, payload, row_count, table_count, created_by)
  VALUES
    (v_venue_id, v_trigger, COALESCE(v_context, '{}'::jsonb), payload, total_rows, total_tables, v_caller)
  RETURNING id INTO bk_id;

  RAISE NOTICE '[BARINV-backup] venue=% trigger=% rows=% tables=% id=%',
    v_venue_id, v_trigger, total_rows, total_tables, bk_id;
  RETURN bk_id;
END;
$fn$;

-- 4. Public create (admin-gated) -------------------------------------
CREATE OR REPLACE FUNCTION public.create_venue_backup(
  v_venue_id uuid,
  v_trigger  text DEFAULT 'manual',
  v_context  jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
DECLARE bk_id uuid;
BEGIN
  IF NOT public.has_venue_access(v_venue_id, 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required on this venue';
  END IF;
  IF v_trigger NOT IN ('cron','pre_clean','pre_restore','manual') THEN
    RAISE EXCEPTION 'Invalid trigger: %', v_trigger;
  END IF;
  bk_id := public._do_create_backup(v_venue_id, v_trigger, v_context, auth.uid());
  PERFORM public.prune_venue_backups(v_venue_id);
  RETURN bk_id;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.create_venue_backup(uuid, text, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_venue_backup(uuid, text, jsonb) TO authenticated;

-- 5. Restore (admin-gated, transactional, FK-safe) -------------------
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

  -- Disable triggers + FK checks for this session so delete + reinsert
  -- aren't order-dependent. Restored in the COMMIT path.
  PERFORM set_config('session_replication_role', 'replica', true);

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

  RAISE NOTICE '[BARINV-restore] backup=% venue=% rows_inserted=% tables=%',
    v_backup_id, bk.venue_id, total_ins, tables_used;

  RETURN jsonb_build_object(
    'backup_id',     bk.id,
    'venue_id',      bk.venue_id,
    'rows_inserted', total_ins,
    'tables_restored', tables_used,
    'restored_at',   now()
  );
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.restore_venue_backup(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.restore_venue_backup(uuid) TO authenticated;

-- 6. Retention: keep last 30 daily + last 12 monthly per venue -------
CREATE OR REPLACE FUNCTION public.prune_venue_backups(v_venue_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
DECLARE deleted_count integer;
BEGIN
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY date_trunc('day', created_at) ORDER BY created_at DESC) AS day_rank,
           ROW_NUMBER() OVER (PARTITION BY date_trunc('month', created_at) ORDER BY created_at DESC) AS month_rank
    FROM public.backup_snapshots
    WHERE venue_id = v_venue_id
  ),
  keepers AS (
    -- Keep most-recent-per-day for the last 30 days  +  most-recent-per-month for the last 12 months
    SELECT id FROM public.backup_snapshots bs
    WHERE bs.venue_id = v_venue_id
      AND (
        bs.id IN (SELECT id FROM ranked WHERE day_rank = 1 AND created_at > now() - interval '30 days') OR
        bs.id IN (SELECT id FROM ranked WHERE month_rank = 1 AND created_at > now() - interval '12 months')
      )
  )
  DELETE FROM public.backup_snapshots
   WHERE venue_id = v_venue_id AND id NOT IN (SELECT id FROM keepers);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$fn$;

-- 7. Cron driver: back up every active venue once per run ------------
CREATE OR REPLACE FUNCTION public._backup_all_venues_daily() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
DECLARE v uuid;
BEGIN
  FOR v IN SELECT id FROM public.venues LOOP
    BEGIN
      PERFORM public._do_create_backup(v, 'cron', '{}'::jsonb, NULL);
      PERFORM public.prune_venue_backups(v);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[BARINV-cron] backup failed for venue %: %', v, SQLERRM;
    END;
  END LOOP;
END;
$fn$;

-- 8. Schedule: daily 4 AM UTC (≈8 PM Pacific, 11 PM Eastern) ---------
-- Unschedule existing job if present, then (re-)schedule fresh.
DO $$
DECLARE job_id int;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'barinv_daily_backup';
  IF job_id IS NOT NULL THEN PERFORM cron.unschedule(job_id); END IF;
  PERFORM cron.schedule(
    'barinv_daily_backup',
    '0 4 * * *',
    $cron$ SELECT public._backup_all_venues_daily(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';;
