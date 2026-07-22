-- Phase A — additive idempotency key for the offline-first event queue.
-- Default NULL preserves every existing INSERT call site. The partial
-- UNIQUE index lets two NULLs coexist (legacy rows + future server-side
-- inserts) but prevents duplicate non-NULL keys, so a retry whose first
-- attempt actually persisted will fail with code 23505 and the client
-- treats that as "already synced".
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS client_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS events_client_event_id_unique
  ON public.events (client_event_id)
  WHERE client_event_id IS NOT NULL;

COMMENT ON COLUMN public.events.client_event_id IS
  'Client-generated UUID for idempotent retry of offline-queued events. NULL for legacy / server-side inserts.';;
