-- Extend backup_snapshots.trigger_source to accept 'pre_migration_unit'
-- so Step B backups get a distinct, greppable tag.
ALTER TABLE public.backup_snapshots
  DROP CONSTRAINT IF EXISTS backup_snapshots_trigger_source_check;

ALTER TABLE public.backup_snapshots
  ADD CONSTRAINT backup_snapshots_trigger_source_check
  CHECK (trigger_source IN ('cron','pre_clean','pre_restore','manual','pre_migration_unit'));;
