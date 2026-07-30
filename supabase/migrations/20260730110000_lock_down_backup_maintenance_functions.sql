-- BARINV PRO P0-03
--
-- These SECURITY DEFINER functions are internal maintenance helpers. They
-- create or prune backup data and must never be executable by public clients.
-- Keep their bodies, owners, and search_path settings unchanged; restrict only
-- their execution ACLs and record the security contract in catalog comments.

REVOKE EXECUTE ON FUNCTION
  public._do_create_backup(uuid, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public._backup_all_venues_daily()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.prune_venue_backups(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public._do_create_backup(uuid, text, jsonb, uuid)
  TO service_role;

GRANT EXECUTE ON FUNCTION
  public._backup_all_venues_daily()
  TO service_role;

GRANT EXECUTE ON FUNCTION
  public.prune_venue_backups(uuid)
  TO service_role;

COMMENT ON FUNCTION
  public._do_create_backup(uuid, text, jsonb, uuid)
  IS 'P0-03 internal backup helper; execution is restricted to service_role and the function owner.';

COMMENT ON FUNCTION
  public._backup_all_venues_daily()
  IS 'P0-03 internal scheduled backup helper; execution is restricted to service_role and the function owner.';

COMMENT ON FUNCTION
  public.prune_venue_backups(uuid)
  IS 'P0-03 internal backup retention helper; execution is restricted to service_role and the function owner.';
