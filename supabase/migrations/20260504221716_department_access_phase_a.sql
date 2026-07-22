
-- Department Access / Shift Accountability Phase A foundation.
-- See supabase/migrations/20260505_department_access_phase_a.sql for
-- the full rationale + verification queries.

-- 1. extend night_staff_assignments
ALTER TABLE public.night_staff_assignments
  ADD COLUMN IF NOT EXISTS departments        text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_area_type text,
  ADD COLUMN IF NOT EXISTS assigned_area_id   uuid,
  ADD COLUMN IF NOT EXISTS assigned_area_name text,
  ADD COLUMN IF NOT EXISTS starts_at          timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at            timestamptz;

ALTER TABLE public.night_staff_assignments
  DROP CONSTRAINT IF EXISTS nsa_departments_valid;
ALTER TABLE public.night_staff_assignments
  ADD CONSTRAINT nsa_departments_valid CHECK (
    cardinality(departments) = 0
    OR departments <@ ARRAY[
      'dispatch','vip_tables','liquor_room','inventory','pos','setup','reports','agent'
    ]::text[]
  );

ALTER TABLE public.night_staff_assignments
  DROP CONSTRAINT IF EXISTS nsa_assigned_area_type_valid;
ALTER TABLE public.night_staff_assignments
  ADD CONSTRAINT nsa_assigned_area_type_valid CHECK (
    assigned_area_type IS NULL
    OR assigned_area_type IN ('liquor_room','vip_section','dispatch_source','bar','custom')
  );

-- 2. department_audit_log table
CREATE TABLE IF NOT EXISTS public.department_audit_log (
  id              bigserial PRIMARY KEY,
  venue_id        uuid NOT NULL REFERENCES public.venues(id)                       ON DELETE RESTRICT,
  night_id        uuid          REFERENCES public.nights(id)                       ON DELETE RESTRICT,
  user_id         uuid          REFERENCES auth.users(id)                          ON DELETE SET NULL,
  staff_id        uuid          REFERENCES public.staff(id)                        ON DELETE SET NULL,
  assignment_id   uuid          REFERENCES public.night_staff_assignments(id)      ON DELETE SET NULL,
  session_scope   text NOT NULL CHECK (session_scope IN ('full_user','scoped_staff')),
  department      text          CHECK (
                    department IS NULL
                    OR department IN (
                      'dispatch','vip_tables','liquor_room','inventory',
                      'pos','setup','reports','agent','system'
                    )
                  ),
  area_type       text          CHECK (
                    area_type IS NULL
                    OR area_type IN ('liquor_room','vip_section','dispatch_source','bar','custom')
                  ),
  area_id         uuid,
  area_name       text,
  action          text NOT NULL,
  target_table    text,
  target_id       uuid,
  before_json     jsonb,
  after_json      jsonb,
  details_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason          text,
  client_event_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dal_before_json_size  CHECK (before_json  IS NULL OR length(before_json::text)  <= 8192),
  CONSTRAINT dal_after_json_size   CHECK (after_json   IS NULL OR length(after_json::text)   <= 8192),
  CONSTRAINT dal_details_json_size CHECK (length(details_json::text) <= 4096)
);

CREATE INDEX IF NOT EXISTS idx_dal_venue_night_time
  ON public.department_audit_log (venue_id, night_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dal_user_time
  ON public.department_audit_log (venue_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dal_staff_time
  ON public.department_audit_log (venue_id, staff_id, created_at DESC)
  WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dal_target
  ON public.department_audit_log (target_table, target_id, created_at DESC)
  WHERE target_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dal_client_event
  ON public.department_audit_log (venue_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- 3. RLS — read-only for users, no direct write
ALTER TABLE public.department_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dal_admin_read  ON public.department_audit_log;
CREATE POLICY dal_admin_read ON public.department_audit_log
  FOR SELECT TO authenticated
  USING (has_venue_access(venue_id, 'manager'));

DROP POLICY IF EXISTS dal_self_read   ON public.department_audit_log;
CREATE POLICY dal_self_read ON public.department_audit_log
  FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS dal_owner_delete ON public.department_audit_log;
CREATE POLICY dal_owner_delete ON public.department_audit_log
  FOR DELETE TO authenticated
  USING (has_venue_access(venue_id, 'owner'));

-- 4. JWT-claim helper
CREATE OR REPLACE FUNCTION public.auth_scoped_has_department(dept text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
  SELECT auth_is_scoped_staff()
     AND COALESCE(
           (auth.jwt() -> 'app_metadata' -> 'departments') ? dept,
           false
         );
$fn$;

GRANT EXECUTE ON FUNCTION public.auth_scoped_has_department(text) TO authenticated;

-- 5. dal_log() write helper
CREATE OR REPLACE FUNCTION public.dal_log(
  p_venue_id        uuid,
  p_action          text,
  p_department      text DEFAULT NULL,
  p_night_id        uuid DEFAULT NULL,
  p_target_table    text DEFAULT NULL,
  p_target_id       uuid DEFAULT NULL,
  p_area_type       text DEFAULT NULL,
  p_area_id         uuid DEFAULT NULL,
  p_area_name       text DEFAULT NULL,
  p_before          jsonb DEFAULT NULL,
  p_after           jsonb DEFAULT NULL,
  p_details         jsonb DEFAULT NULL,
  p_reason          text  DEFAULT NULL,
  p_client_event_id text  DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_is_scoped     boolean := auth_is_scoped_staff();
  v_scope         text;
  v_assignment_id uuid;
  v_staff_id      uuid;
  v_jwt_venue     uuid;
  v_jwt_night     uuid;
  v_authorized    boolean := false;
  v_existing_id   bigint;
  v_id            bigint;
BEGIN
  IF p_venue_id IS NULL THEN
    RAISE EXCEPTION 'dal_log: venue_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_action IS NULL OR length(trim(p_action)) = 0 THEN
    RAISE EXCEPTION 'dal_log: action is required' USING ERRCODE = '22004';
  END IF;

  IF v_is_scoped THEN
    v_scope := 'scoped_staff';
    v_assignment_id := auth_scoped_assignment_id();
    v_jwt_venue     := auth_scoped_venue();
    v_jwt_night     := auth_scoped_night();
    SELECT nsa.staff_id INTO v_staff_id
      FROM public.night_staff_assignments nsa
     WHERE nsa.id = v_assignment_id;
  ELSIF v_uid IS NOT NULL THEN
    v_scope := 'full_user';
  ELSE
    RAISE EXCEPTION 'dal_log: no auth context' USING ERRCODE = '42501';
  END IF;

  IF v_scope = 'scoped_staff' THEN
    IF p_department IS NULL THEN
      v_authorized := false;
    ELSIF auth_scoped_has_department(p_department)
          AND p_venue_id = v_jwt_venue
          AND (p_night_id IS NULL OR p_night_id = v_jwt_night) THEN
      v_authorized := true;
    END IF;
  ELSE
    v_authorized := has_venue_access(p_venue_id, 'staff');
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'dal_log: not authorized to log to venue % department %',
      p_venue_id, COALESCE(p_department, '<null>')
      USING ERRCODE = '42501';
  END IF;

  IF p_client_event_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM public.department_audit_log
     WHERE venue_id = p_venue_id AND client_event_id = p_client_event_id
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  INSERT INTO public.department_audit_log (
    venue_id, night_id,
    user_id, staff_id, assignment_id,
    session_scope, department,
    area_type, area_id, area_name,
    action, target_table, target_id,
    before_json, after_json, details_json, reason, client_event_id
  ) VALUES (
    p_venue_id, p_night_id,
    CASE WHEN v_scope = 'full_user' THEN v_uid ELSE NULL END,
    v_staff_id, v_assignment_id,
    v_scope, p_department,
    p_area_type, p_area_id, p_area_name,
    p_action, p_target_table, p_target_id,
    p_before, p_after, COALESCE(p_details, '{}'::jsonb),
    p_reason, p_client_event_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.dal_log(
  uuid, text, text, uuid, text, uuid, text, uuid, text,
  jsonb, jsonb, jsonb, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dal_log(
  uuid, text, text, uuid, text, uuid, text, uuid, text,
  jsonb, jsonb, jsonb, text, text
) TO authenticated;
;
