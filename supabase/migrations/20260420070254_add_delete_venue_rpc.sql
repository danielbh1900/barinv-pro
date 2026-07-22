CREATE OR REPLACE FUNCTION public.delete_venue(v_venue_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.venue_members
    WHERE user_id = caller AND venue_id = v_venue_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the venue owner can delete this venue';
  END IF;

  -- FK-safe order: children first, parents last
  DELETE FROM public.events WHERE venue_id = v_venue_id;
  DELETE FROM public.loyalty_points WHERE venue_id = v_venue_id;
  DELETE FROM public.menu_items WHERE venue_id = v_venue_id;
  DELETE FROM public.placements WHERE venue_id = v_venue_id;
  DELETE FROM public.po_items WHERE venue_id = v_venue_id;
  DELETE FROM public.recipe_ingredients WHERE venue_id = v_venue_id;
  DELETE FROM public.invoices WHERE venue_id = v_venue_id;
  DELETE FROM public.receipt_items WHERE venue_id = v_venue_id;
  DELETE FROM public.guest_bookings WHERE venue_id = v_venue_id;
  DELETE FROM public.guestlist WHERE venue_id = v_venue_id;
  DELETE FROM public.vip_tables WHERE venue_id = v_venue_id;
  DELETE FROM public.bar_close_summaries WHERE venue_id = v_venue_id;
  DELETE FROM public.bar_item_dispatch_snapshots WHERE venue_id = v_venue_id;
  DELETE FROM public.bar_item_shot_snapshots WHERE venue_id = v_venue_id;
  DELETE FROM public.pos_bar_product_snapshots WHERE venue_id = v_venue_id;
  DELETE FROM public.pos_bar_snapshots WHERE venue_id = v_venue_id;
  DELETE FROM public.pos_sync_runs WHERE venue_id = v_venue_id;
  DELETE FROM public.pos_transactions WHERE venue_id = v_venue_id;
  DELETE FROM public.pos_bar_mappings WHERE venue_id = v_venue_id;
  DELETE FROM public.pos_product_item_mappings WHERE venue_id = v_venue_id;
  DELETE FROM public.pos_source_map WHERE venue_id = v_venue_id;
  DELETE FROM public.warehouse_transfers WHERE venue_id = v_venue_id;
  DELETE FROM public.nights WHERE venue_id = v_venue_id;
  DELETE FROM public.purchase_orders WHERE venue_id = v_venue_id;
  DELETE FROM public.receipts WHERE venue_id = v_venue_id;
  DELETE FROM public.recipes WHERE venue_id = v_venue_id;
  DELETE FROM public.warehouse_items WHERE venue_id = v_venue_id;
  DELETE FROM public.pos_connections WHERE venue_id = v_venue_id;
  DELETE FROM public.stations WHERE venue_id = v_venue_id;
  DELETE FROM public.bars WHERE venue_id = v_venue_id;
  DELETE FROM public.items WHERE venue_id = v_venue_id;
  DELETE FROM public.staff WHERE venue_id = v_venue_id;
  DELETE FROM public.suppliers WHERE venue_id = v_venue_id;
  DELETE FROM public.guests WHERE venue_id = v_venue_id;
  DELETE FROM public.business_profile WHERE venue_id = v_venue_id;
  DELETE FROM public.menu_settings WHERE venue_id = v_venue_id;
  DELETE FROM public.loyalty_config WHERE venue_id = v_venue_id;

  -- Cascades: backup_snapshots, venue_members, pos_credentials, night_staff_assignments
  DELETE FROM public.venues WHERE id = v_venue_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_venue(uuid) TO authenticated;;
