-- BARINV PRO
-- Rollback for durable Admin Events CSV import jobs.
--
-- LOCAL/CONTROLLED USE ONLY.
-- Do not run against Production without a separately approved rollback plan.

BEGIN;

REVOKE ALL ON FUNCTION public.barinv_retry_event_csv_import_failures(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.barinv_export_events_csv_page(uuid, uuid, uuid, text, text, uuid[], integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.barinv_get_event_csv_import_batch(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.barinv_process_event_csv_import_batch(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.barinv_create_event_csv_import_batch(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.barinv_event_csv_import_summary(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.barinv_retry_event_csv_import_failures(uuid);
DROP FUNCTION IF EXISTS public.barinv_export_events_csv_page(uuid, uuid, uuid, text, text, uuid[], integer, integer);
DROP FUNCTION IF EXISTS public.barinv_get_event_csv_import_batch(uuid);
DROP FUNCTION IF EXISTS public.barinv_process_event_csv_import_batch(uuid, integer);
DROP FUNCTION IF EXISTS public.barinv_create_event_csv_import_batch(uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.barinv_event_csv_import_summary(uuid);

DROP POLICY IF EXISTS event_csv_import_rows_select_manager
  ON public.event_csv_import_rows;

DROP POLICY IF EXISTS event_csv_import_batches_select_manager
  ON public.event_csv_import_batches;

REVOKE ALL ON public.event_csv_import_rows
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON public.event_csv_import_batches
  FROM PUBLIC, anon, authenticated, service_role;

DROP TABLE IF EXISTS public.event_csv_import_rows;
DROP TABLE IF EXISTS public.event_csv_import_batches;

NOTIFY pgrst, 'reload schema';

COMMIT;
