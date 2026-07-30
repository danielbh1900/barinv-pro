-- BARINV PRO P0-03 SAFETY ROLLBACK
--
-- WARNING: The pre-migration state granted EXECUTE to PUBLIC, anon, and
-- authenticated. Restoring those grants would reopen a release-blocking
-- security vulnerability, so this rollback intentionally does not do that.
--
-- For a real incident, prefer a forward corrective migration. Any broader
-- grant requires explicit owner/security approval and must not be added here.
-- This script removes only the P0-03 catalog comments while preserving the
-- minimum safe operational ACL: service_role plus implicit function-owner
-- access.

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
  IS NULL;

COMMENT ON FUNCTION
  public._backup_all_venues_daily()
  IS NULL;

COMMENT ON FUNCTION
  public.prune_venue_backups(uuid)
  IS NULL;
