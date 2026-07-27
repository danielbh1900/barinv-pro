-- BARINV PRO
-- Rollback for persistent bulk Event review jobs.
-- Review separately before execution.

BEGIN;

DROP FUNCTION IF EXISTS
  public.barinv_retry_event_review_job_failures(uuid);

DROP FUNCTION IF EXISTS
  public.barinv_get_event_review_job(uuid);

DROP FUNCTION IF EXISTS
  public.barinv_process_event_review_job(uuid, integer);

DROP FUNCTION IF EXISTS
  public.barinv_create_event_review_job(
    uuid,
    text,
    uuid[],
    uuid,
    uuid,
    text,
    uuid,
    text
  );

DROP TABLE IF EXISTS public.event_review_job_items;
DROP TABLE IF EXISTS public.event_review_jobs;

COMMIT;
