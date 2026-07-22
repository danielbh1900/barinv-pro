
-- Cross-Device Staff Portal — Phase A foundation (schema only).
-- Corrected ordering: auth_scoped_session_id() created FIRST so the
-- staff_sessions_self_read policy can reference it. See
-- supabase/migrations/20260505_staff_portal_phase_a.sql for full
-- rationale.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 0. auth_scoped_session_id (created first; staff_sessions policy depends on it)
CREATE OR REPLACE FUNCTION public.auth_scoped_session_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'session_id', '')::uuid;
$fn$;

GRANT EXECUTE ON FUNCTION public.auth_scoped_session_id() TO authenticated;

-- 1. staff_portal_tokens
CREATE TABLE IF NOT EXISTS public.staff_portal_tokens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid NOT NULL REFERENCES public.venues(id)                       ON DELETE RESTRICT,
  night_id            uuid NOT NULL REFERENCES public.nights(id)                       ON DELETE RESTRICT,
  assignment_id       uuid NOT NULL REFERENCES public.night_staff_assignments(id)      ON DELETE RESTRICT,
  staff_id            uuid NOT NULL REFERENCES public.staff(id)                        ON DELETE RESTRICT,
  token_hash          bytea NOT NULL,
  token_prefix        text  NOT NULL,
  generated_by        uuid          REFERENCES auth.users(id)                          ON DELETE SET NULL,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  max_exchanges       integer NOT NULL DEFAULT 1,
  exchanged_count     integer NOT NULL DEFAULT 0,
  last_exchanged_at   timestamptz,
  revoked             boolean NOT NULL DEFAULT false,
  revoked_by          uuid          REFERENCES auth.users(id)                          ON DELETE SET NULL,
  revoked_at          timestamptz,
  notes               text,
  CONSTRAINT spt_no_overuse CHECK (exchanged_count >= 0 AND exchanged_count <= max_exchanges),
  CONSTRAINT spt_max_positive CHECK (max_exchanges >= 1),
  CONSTRAINT spt_revoke_consistency CHECK (
    (revoked = false AND revoked_by IS NULL AND revoked_at IS NULL)
    OR
    (revoked = true  AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT spt_token_prefix_shape CHECK (length(token_prefix) BETWEEN 1 AND 8)
);

CREATE INDEX IF NOT EXISTS idx_spt_assignment    ON public.staff_portal_tokens (assignment_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_spt_venue_night   ON public.staff_portal_tokens (venue_id, night_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_spt_expires       ON public.staff_portal_tokens (expires_at) WHERE revoked = false;
CREATE INDEX IF NOT EXISTS idx_spt_revoked       ON public.staff_portal_tokens (revoked, revoked_at);
CREATE INDEX IF NOT EXISTS idx_spt_generated     ON public.staff_portal_tokens (generated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spt_token_hash ON public.staff_portal_tokens (token_hash);

ALTER TABLE public.staff_portal_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spt_mgr_all ON public.staff_portal_tokens;
CREATE POLICY spt_mgr_all ON public.staff_portal_tokens
  FOR ALL TO authenticated
  USING  (has_venue_access(venue_id, 'manager'))
  WITH CHECK (has_venue_access(venue_id, 'manager'));

-- 2. staff_sessions
CREATE TABLE IF NOT EXISTS public.staff_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid NOT NULL REFERENCES public.venues(id)                       ON DELETE RESTRICT,
  night_id            uuid NOT NULL REFERENCES public.nights(id)                       ON DELETE RESTRICT,
  assignment_id       uuid NOT NULL REFERENCES public.night_staff_assignments(id)      ON DELETE RESTRICT,
  staff_id            uuid NOT NULL REFERENCES public.staff(id)                        ON DELETE RESTRICT,
  source              text NOT NULL CHECK (source IN ('portal_token','staff_access_code','admin_impersonate')),
  source_token_id     uuid          REFERENCES public.staff_portal_tokens(id)          ON DELETE SET NULL,
  user_agent_summary  text,
  ip_class            text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  ended_reason        text          CHECK (ended_reason IS NULL OR ended_reason IN
                        ('signed_out','expired','revoked_by_admin','assignment_revoked','superseded')),
  revoked_by          uuid          REFERENCES auth.users(id)                          ON DELETE SET NULL,
  CONSTRAINT staff_sessions_end_consistency CHECK (
    (ended_at IS NULL AND ended_reason IS NULL)
    OR
    (ended_at IS NOT NULL AND ended_reason IS NOT NULL)
  ),
  CONSTRAINT staff_sessions_lastseen_after_start CHECK (last_seen_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_staff_sessions_assignment ON public.staff_sessions (assignment_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_night      ON public.staff_sessions (night_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff      ON public.staff_sessions (staff_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_active     ON public.staff_sessions (venue_id, night_id, last_seen_at DESC) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_sessions_ended      ON public.staff_sessions (ended_at) WHERE ended_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_sessions_started    ON public.staff_sessions (started_at DESC);

ALTER TABLE public.staff_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_sessions_mgr_all ON public.staff_sessions;
CREATE POLICY staff_sessions_mgr_all ON public.staff_sessions
  FOR ALL TO authenticated
  USING  (has_venue_access(venue_id, 'manager'))
  WITH CHECK (has_venue_access(venue_id, 'manager'));

DROP POLICY IF EXISTS staff_sessions_self_read ON public.staff_sessions;
CREATE POLICY staff_sessions_self_read ON public.staff_sessions
  FOR SELECT TO authenticated
  USING (id = public.auth_scoped_session_id());

-- 3. spt_generate
CREATE OR REPLACE FUNCTION public.spt_generate(
  p_assignment_id   uuid,
  p_max_exchanges   integer DEFAULT 1,
  p_ttl_minutes     integer DEFAULT 1440
) RETURNS TABLE (
  token        text,
  token_id     uuid,
  expires_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_caller     uuid := auth.uid();
  v_venue      uuid;
  v_night      uuid;
  v_staff      uuid;
  v_revoked    boolean;
  v_token      text;
  v_hash       bytea;
  v_prefix     text;
  v_exp        timestamptz;
  v_id         uuid;
BEGIN
  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'spt_generate: assignment_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_max_exchanges IS NULL OR p_max_exchanges < 1 THEN
    RAISE EXCEPTION 'spt_generate: max_exchanges must be >= 1' USING ERRCODE = '22023';
  END IF;
  IF p_ttl_minutes IS NULL OR p_ttl_minutes < 1 THEN
    RAISE EXCEPTION 'spt_generate: ttl_minutes must be >= 1' USING ERRCODE = '22023';
  END IF;

  SELECT nsa.venue_id, nsa.night_id, nsa.staff_id, nsa.revoked
    INTO v_venue, v_night, v_staff, v_revoked
    FROM public.night_staff_assignments nsa
   WHERE nsa.id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'spt_generate: assignment % not found', p_assignment_id USING ERRCODE = '02000';
  END IF;
  IF v_revoked THEN
    RAISE EXCEPTION 'spt_generate: assignment % is revoked', p_assignment_id USING ERRCODE = '42501';
  END IF;

  IF NOT has_venue_access(v_venue, 'manager') THEN
    RAISE EXCEPTION 'spt_generate: manager+ required for venue %', v_venue USING ERRCODE = '42501';
  END IF;

  v_token  := replace(translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_'), '=', '');
  v_hash   := digest(v_token, 'sha256');
  v_prefix := substring(v_token from 1 for 4);
  v_exp    := now() + (p_ttl_minutes || ' minutes')::interval;

  INSERT INTO public.staff_portal_tokens (
    venue_id, night_id, assignment_id, staff_id,
    token_hash, token_prefix,
    generated_by, generated_at, expires_at,
    max_exchanges, exchanged_count
  ) VALUES (
    v_venue, v_night, p_assignment_id, v_staff,
    v_hash, v_prefix,
    v_caller, now(), v_exp,
    p_max_exchanges, 0
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_token::text, v_id, v_exp;
END;
$fn$;

REVOKE ALL ON FUNCTION public.spt_generate(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spt_generate(uuid, integer, integer) TO authenticated;

-- 4. spt_exchange
CREATE OR REPLACE FUNCTION public.spt_exchange(
  p_token              text,
  p_user_agent_summary text,
  p_ip_class           text
) RETURNS TABLE (
  session_id    uuid,
  assignment_id uuid,
  staff_id      uuid,
  venue_id      uuid,
  night_id      uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_hash         bytea;
  v_token_id     uuid;
  v_assignment   uuid;
  v_staff        uuid;
  v_venue        uuid;
  v_night        uuid;
  v_exp          timestamptz;
  v_revoked      boolean;
  v_max          integer;
  v_used         integer;
  v_nsa_revoked  boolean;
  v_session_id   uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RAISE EXCEPTION 'spt_exchange: token is required' USING ERRCODE = '22004';
  END IF;

  v_hash := digest(p_token, 'sha256');

  SELECT spt.id, spt.assignment_id, spt.staff_id, spt.venue_id,
         spt.night_id, spt.expires_at, spt.revoked,
         spt.max_exchanges, spt.exchanged_count
    INTO v_token_id, v_assignment, v_staff, v_venue,
         v_night, v_exp, v_revoked, v_max, v_used
    FROM public.staff_portal_tokens spt
   WHERE spt.token_hash = v_hash
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'spt_exchange: invalid token' USING ERRCODE = '42501';
  END IF;
  IF v_revoked THEN
    RAISE EXCEPTION 'spt_exchange: token revoked' USING ERRCODE = '42501';
  END IF;
  IF v_exp <= now() THEN
    RAISE EXCEPTION 'spt_exchange: token expired' USING ERRCODE = '42501';
  END IF;
  IF v_used >= v_max THEN
    RAISE EXCEPTION 'spt_exchange: token already used' USING ERRCODE = '42501';
  END IF;

  SELECT nsa.revoked INTO v_nsa_revoked
    FROM public.night_staff_assignments nsa
   WHERE nsa.id = v_assignment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'spt_exchange: assignment % not found', v_assignment USING ERRCODE = '02000';
  END IF;
  IF v_nsa_revoked THEN
    RAISE EXCEPTION 'spt_exchange: assignment revoked' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.staff_sessions (
    venue_id, night_id, assignment_id, staff_id,
    source, source_token_id,
    user_agent_summary, ip_class
  ) VALUES (
    v_venue, v_night, v_assignment, v_staff,
    'portal_token', v_token_id,
    NULLIF(p_user_agent_summary, ''),
    NULLIF(p_ip_class, '')
  )
  RETURNING id INTO v_session_id;

  UPDATE public.staff_portal_tokens
     SET exchanged_count   = exchanged_count + 1,
         last_exchanged_at = now()
   WHERE id = v_token_id;

  RETURN QUERY SELECT v_session_id, v_assignment, v_staff, v_venue, v_night;
END;
$fn$;

REVOKE ALL ON FUNCTION public.spt_exchange(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spt_exchange(text, text, text) TO authenticated;

-- 5. auth_session_active() — placeholder
CREATE OR REPLACE FUNCTION public.auth_session_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
  SELECT TRUE;
$fn$;

GRANT EXECUTE ON FUNCTION public.auth_session_active() TO authenticated;

-- 6. department_audit_log.session_id (additive nullable)
ALTER TABLE public.department_audit_log
  ADD COLUMN IF NOT EXISTS session_id uuid
    REFERENCES public.staff_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dal_session
  ON public.department_audit_log (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;
;
