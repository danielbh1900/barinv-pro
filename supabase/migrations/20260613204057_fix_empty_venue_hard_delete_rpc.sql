CREATE OR REPLACE FUNCTION public.delete_empty_venue(v_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_name         text;
  v_blocking     bigint;
  v_other_venues bigint;
BEGIN
  IF NOT public.has_venue_access(v_id, 'owner') THEN
    RAISE EXCEPTION 'Forbidden: owner role required on this venue';
  END IF;

  SELECT name INTO v_name FROM public.venues WHERE id = v_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Venue not found';
  END IF;

  SELECT
      (SELECT count(*) FROM public.nights                         WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.staff                          WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.bars                           WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.items                          WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.events                         WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.vip_tables                     WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.department_audit_log           WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.staff_portal_tokens            WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.staff_sessions                 WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.terminal_devices              WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.vip_pos_fulfillment_tasks     WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.vip_table_receipt_attachments  WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.vip_table_receipt_candidates   WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.vip_table_receipt_images       WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.vip_table_spend_entries        WHERE venue_id = v_id)
    + (SELECT count(*) FROM public.vip_table_spend_items          WHERE venue_id = v_id)
  INTO v_blocking;

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'Venue "%" is not empty (% blocking row(s)) -- archive instead', v_name, v_blocking;
  END IF;

  SELECT count(*) INTO v_other_venues
  FROM public.venue_members vm
  WHERE vm.user_id = auth.uid() AND vm.venue_id <> v_id;
  IF v_other_venues = 0 THEN
    RAISE EXCEPTION 'Cannot delete your last venue';
  END IF;

  PERFORM set_config('barinv.deleting_venue', v_id::text, true);
  DELETE FROM public.venues WHERE id = v_id;

  RETURN jsonb_build_object('deleted', true, 'venue_id', v_id, 'name', v_name);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_empty_venue(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_last_owner_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF current_setting('barinv.deleting_venue', true) = OLD.venue_id::text THEN
    RETURN OLD;
  END IF;
  IF OLD.role = 'owner' THEN
    IF (SELECT count(*) FROM public.venue_members
        WHERE venue_id = OLD.venue_id AND role = 'owner') <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner of venue %', OLD.venue_id;
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;;
