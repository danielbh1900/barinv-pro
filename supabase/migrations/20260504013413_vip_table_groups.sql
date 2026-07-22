-- VIP Table Grouping Phase A — additive only, no vip_tables changes.
CREATE TABLE IF NOT EXISTS public.vip_table_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  night_id    uuid NOT NULL REFERENCES public.nights(id) ON DELETE CASCADE,
  group_name  text,
  notes       text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vtg_night ON public.vip_table_groups (night_id);
CREATE INDEX IF NOT EXISTS idx_vtg_venue ON public.vip_table_groups (venue_id);

CREATE TABLE IF NOT EXISTS public.vip_table_group_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES public.vip_table_groups(id) ON DELETE CASCADE,
  vip_table_id  uuid NOT NULL REFERENCES public.vip_tables(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('primary','linked')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vtgm_one_group_per_table
  ON public.vip_table_group_members (vip_table_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vtgm_one_primary_per_group
  ON public.vip_table_group_members (group_id) WHERE role = 'primary';
CREATE INDEX IF NOT EXISTS idx_vtgm_group ON public.vip_table_group_members (group_id);

CREATE OR REPLACE FUNCTION public._vtgm_validate_night() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE g_night uuid; m_night uuid;
BEGIN
  SELECT night_id INTO g_night FROM public.vip_table_groups WHERE id = NEW.group_id;
  SELECT night_id INTO m_night FROM public.vip_tables       WHERE id = NEW.vip_table_id;
  IF g_night IS DISTINCT FROM m_night THEN
    RAISE EXCEPTION 'vip_table_group_members night mismatch (group %, table %)', g_night, m_night;
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_vtgm_validate_night ON public.vip_table_group_members;
CREATE TRIGGER trg_vtgm_validate_night
  BEFORE INSERT OR UPDATE ON public.vip_table_group_members
  FOR EACH ROW EXECUTE FUNCTION public._vtgm_validate_night();

CREATE OR REPLACE FUNCTION public._vtg_assert_has_primary() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE g_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN g_id := OLD.group_id; ELSE g_id := NEW.group_id; END IF;
  IF EXISTS (SELECT 1 FROM public.vip_table_groups WHERE id = g_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.vip_table_group_members
        WHERE group_id = g_id AND role = 'primary'
     ) THEN
    RAISE EXCEPTION 'Group % left without a primary member', g_id;
  END IF;
  RETURN NULL;
END$$;

DROP TRIGGER IF EXISTS trg_vtg_assert_has_primary ON public.vip_table_group_members;
CREATE CONSTRAINT TRIGGER trg_vtg_assert_has_primary
  AFTER INSERT OR UPDATE OR DELETE ON public.vip_table_group_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._vtg_assert_has_primary();

ALTER TABLE public.vip_table_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_table_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtg_mgr_all ON public.vip_table_groups;
CREATE POLICY vtg_mgr_all ON public.vip_table_groups
  FOR ALL TO authenticated
  USING (has_venue_access(venue_id, 'manager'))
  WITH CHECK (has_venue_access(venue_id, 'manager'));

DROP POLICY IF EXISTS vtgm_mgr_all ON public.vip_table_group_members;
CREATE POLICY vtgm_mgr_all ON public.vip_table_group_members
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.vip_table_groups g
            WHERE g.id = vip_table_group_members.group_id
              AND has_venue_access(g.venue_id, 'manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.vip_table_groups g
            WHERE g.id = vip_table_group_members.group_id
              AND has_venue_access(g.venue_id, 'manager'))
  );

CREATE OR REPLACE FUNCTION public.vtg_create(
  p_venue_id          uuid,
  p_night_id          uuid,
  p_group_name        text,
  p_primary_table_id  uuid,
  p_linked_table_ids  uuid[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_catalog AS $$
DECLARE
  v_group_id uuid;
  v_linked   uuid;
  v_all      uuid[];
BEGIN
  IF NOT has_venue_access(p_venue_id, 'manager') THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;
  v_all := array_append(COALESCE(p_linked_table_ids, ARRAY[]::uuid[]), p_primary_table_id);
  IF EXISTS (
    SELECT 1 FROM unnest(v_all) tid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.vip_tables
      WHERE id = tid AND night_id = p_night_id AND venue_id = p_venue_id
    )
  ) THEN
    RAISE EXCEPTION 'One or more tables do not belong to the specified venue/night';
  END IF;

  INSERT INTO public.vip_table_groups (venue_id, night_id, group_name, created_by)
  VALUES (p_venue_id, p_night_id, NULLIF(TRIM(p_group_name), ''), auth.uid())
  RETURNING id INTO v_group_id;

  INSERT INTO public.vip_table_group_members (group_id, vip_table_id, role)
  VALUES (v_group_id, p_primary_table_id, 'primary');

  IF p_linked_table_ids IS NOT NULL THEN
    FOREACH v_linked IN ARRAY p_linked_table_ids LOOP
      INSERT INTO public.vip_table_group_members (group_id, vip_table_id, role)
      VALUES (v_group_id, v_linked, 'linked');
    END LOOP;
  END IF;

  RETURN v_group_id;
END$$;

CREATE OR REPLACE FUNCTION public.vtg_split(
  p_vip_table_id        uuid,
  p_promote_to_table_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_catalog AS $$
DECLARE
  v_group_id    uuid;
  v_role        text;
  v_venue_id    uuid;
  v_remaining   int;
BEGIN
  SELECT m.group_id, m.role INTO v_group_id, v_role
  FROM public.vip_table_group_members m WHERE m.vip_table_id = p_vip_table_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Table is not in any group';
  END IF;
  SELECT venue_id INTO v_venue_id FROM public.vip_table_groups WHERE id = v_group_id;
  IF NOT has_venue_access(v_venue_id, 'manager') THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;

  IF v_role = 'primary' THEN
    SELECT count(*) INTO v_remaining
    FROM public.vip_table_group_members
    WHERE group_id = v_group_id AND vip_table_id != p_vip_table_id;
    IF v_remaining = 0 THEN
      DELETE FROM public.vip_table_groups WHERE id = v_group_id;
      RETURN;
    END IF;
    IF p_promote_to_table_id IS NULL THEN
      SELECT vip_table_id INTO p_promote_to_table_id
      FROM public.vip_table_group_members
      WHERE group_id = v_group_id AND vip_table_id != p_vip_table_id
      ORDER BY created_at LIMIT 1;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.vip_table_group_members
      WHERE group_id = v_group_id AND vip_table_id = p_promote_to_table_id
    ) THEN
      RAISE EXCEPTION 'Promotion target is not a member of this group';
    END IF;
    UPDATE public.vip_table_group_members
    SET role = 'primary'
    WHERE group_id = v_group_id AND vip_table_id = p_promote_to_table_id;
  END IF;

  DELETE FROM public.vip_table_group_members
  WHERE vip_table_id = p_vip_table_id AND group_id = v_group_id;
END$$;

CREATE OR REPLACE FUNCTION public.vtg_dissolve(p_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_catalog AS $$
DECLARE v_venue_id uuid;
BEGIN
  SELECT venue_id INTO v_venue_id FROM public.vip_table_groups WHERE id = p_group_id;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;
  IF NOT has_venue_access(v_venue_id, 'manager') THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;
  DELETE FROM public.vip_table_groups WHERE id = p_group_id;
END$$;

GRANT EXECUTE ON FUNCTION public.vtg_create(uuid,uuid,text,uuid,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vtg_split(uuid,uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.vtg_dissolve(uuid)                    TO authenticated;;
