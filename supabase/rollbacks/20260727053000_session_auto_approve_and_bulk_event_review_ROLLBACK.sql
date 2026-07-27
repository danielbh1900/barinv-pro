-- BARINV PRO
-- Rollback for session Auto-Approve + bulk event review.
-- Review separately before execution.

BEGIN;

DROP TRIGGER IF EXISTS trg_events_audit_session_auto_approve
  ON public.events;

DROP TRIGGER IF EXISTS trg_events_audit_status_update
  ON public.events;

DROP TRIGGER IF EXISTS trg_events_guard_status_update
  ON public.events;

DROP TRIGGER IF EXISTS trg_events_session_auto_approve
  ON public.events;

DROP FUNCTION IF EXISTS public.barinv_events_audit_status_update();
DROP FUNCTION IF EXISTS public.barinv_events_guard_status_update();

DROP FUNCTION IF EXISTS public.barinv_events_audit_session_auto_approve();
DROP FUNCTION IF EXISTS public.barinv_events_apply_session_auto_approve();

DROP FUNCTION IF EXISTS public.barinv_preview_event_review(
  uuid, uuid[], uuid, uuid, text, uuid
);

DROP FUNCTION IF EXISTS public.barinv_review_events(
  uuid, text, uuid[], uuid, uuid, text, uuid, text
);

DROP INDEX IF EXISTS public.idx_events_review_scope;
DROP TABLE IF EXISTS public.event_review_audit;

ALTER TABLE public.barback_sessions
  DROP COLUMN IF EXISTS auto_approve_events;

COMMIT;
