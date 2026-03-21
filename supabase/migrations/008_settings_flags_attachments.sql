-- ============================================================
-- Migration 008: Settings, Feature Flags, Attachments
-- Tables: organization_settings, feature_flags, attachments
-- ============================================================

-- ─────────────────────────────────────────
-- ORGANIZATION_SETTINGS
-- Key-value configuration per organization.
-- Structured values stored in jsonb.
-- ─────────────────────────────────────────

create table public.organization_settings (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  key               text not null,
  value             jsonb not null,
  description       text,                      -- human-readable description of this setting
  updated_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),

  unique (organization_id, key)
);

comment on table public.organization_settings is
  'Key-value configuration per organization. Changes always produce an audit_log row.';
comment on column public.organization_settings.key is
  'Known keys: night_boundary_hour (int, default 4), default_currency (text),
   require_event_notes (bool), max_pending_queue_minutes (int).';

create index idx_org_settings_org on public.organization_settings(organization_id);

create trigger trg_organization_settings_updated_at
  before update on public.organization_settings
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- FEATURE_FLAGS
-- Runtime feature toggles per organization.
-- Checked alongside build-time env gates.
-- env gate = false → feature is excluded from the bundle entirely.
-- env gate = true AND this flag = false → feature is compiled in but disabled for this org.
-- ─────────────────────────────────────────

create table public.feature_flags (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  feature_key       text not null,
  enabled           boolean not null default false,
  notes             text,
  updated_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),

  unique (organization_id, feature_key)
);

comment on table public.feature_flags is
  'Runtime feature toggles per organization. Used alongside VITE_FEATURE_* build-time env gates.';
comment on column public.feature_flags.feature_key is
  'Valid keys: guestlist, purchasing, recipes, advanced_analytics, offline_sync, multi_venue.';

create index idx_feature_flags_org on public.feature_flags(organization_id);

create trigger trg_feature_flags_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- ATTACHMENTS
-- Metadata for files stored in Supabase Storage.
-- The actual file lives in Storage; this table tracks it.
-- ─────────────────────────────────────────

create table public.attachments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid references public.venues(id) on delete restrict,
  storage_bucket    text not null,             -- Supabase Storage bucket name
  storage_path      text not null,             -- path within bucket
  file_name         text not null,             -- original filename
  file_size_bytes   bigint,
  mime_type         text,
  -- Polymorphic association: what this attachment belongs to
  target_table      text not null,             -- e.g. 'invoices', 'purchase_orders'
  target_id         uuid not null,
  uploaded_by       uuid not null references public.profiles(id),
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);

comment on table public.attachments is
  'Metadata for files in Supabase Storage. target_table + target_id = polymorphic owner.';

create index idx_attachments_org    on public.attachments(organization_id);
create index idx_attachments_target on public.attachments(target_table, target_id);

-- ─────────────────────────────────────────
-- DEFAULT SEEDS: organization_settings keys
-- Inserted per org at org creation time (via Edge Function or app logic).
-- Listed here for documentation only — do not insert without an organization_id.
-- ─────────────────────────────────────────

-- Key: night_boundary_hour       Value: 4        -- local hour when a new night starts
-- Key: default_currency          Value: "CAD"    -- default currency for new finance records
-- Key: require_event_notes       Value: false    -- whether events require a note
-- Key: max_pending_queue_minutes Value: 15       -- stale queue threshold for diagnostics alerts

-- ─────────────────────────────────────────
-- DEFAULT SEEDS: feature_flags keys
-- Inserted per org at org creation time. All false by default.
-- ─────────────────────────────────────────

-- feature_key: guestlist
-- feature_key: purchasing
-- feature_key: recipes
-- feature_key: advanced_analytics
-- feature_key: offline_sync
-- feature_key: multi_venue
