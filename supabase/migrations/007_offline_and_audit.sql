-- ============================================================
-- Migration 007: Offline, Device, and Audit
-- Tables: client_operations, offline_queue_status,
--         device_sessions, sync_conflicts, audit_log
-- ============================================================

-- ─────────────────────────────────────────
-- ENUM TYPES
-- ─────────────────────────────────────────

create type public.queue_status as enum (
  'pending',
  'synced',
  'failed',
  'conflict',
  'blocked'
);

create type public.conflict_status as enum (
  'open',
  'resolved_local',
  'resolved_server',
  'deferred'
);

create type public.audit_source as enum (
  'ui',
  'sync',
  'system',
  'admin_override',
  'migration',
  'edge_function'
);

-- ─────────────────────────────────────────
-- CLIENT_OPERATIONS
-- Server-side record of every client operation ID ever seen.
-- Used for idempotency: reject re-submissions of same operation.
-- ─────────────────────────────────────────

create table public.client_operations (
  id                    uuid primary key,      -- IS the client_operation_id (not a surrogate)
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  venue_id              uuid references public.venues(id) on delete restrict,
  user_id               uuid not null references public.profiles(id) on delete restrict,
  device_session_id     uuid,                  -- FK added after device_sessions
  action_type           text not null,         -- e.g. 'submit_event', 'warehouse_adjustment'
  target_table          text not null,
  status                public.queue_status not null default 'pending',
  payload_hash          text,                  -- SHA256 of payload for duplicate detection
  accepted_at           timestamptz,
  rejected_at           timestamptz,
  rejection_reason      text,
  submitted_at_local    timestamptz,           -- client device time
  created_at            timestamptz not null default now()
);

comment on table public.client_operations is
  'Server record of every client operation UUID. Primary idempotency guard. ID = client_operation_id.';

create index idx_cop_user   on public.client_operations(user_id);
create index idx_cop_org    on public.client_operations(organization_id);
create index idx_cop_status on public.client_operations(status, created_at);

-- ─────────────────────────────────────────
-- DEVICE_SESSIONS
-- Tracks active device instances for sync management and diagnostics.
-- ─────────────────────────────────────────

create table public.device_sessions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  device_name       text,                      -- user-assigned or inferred
  user_agent        text,
  app_version       text,
  last_seen_at      timestamptz not null default now(),
  last_venue_id     uuid references public.venues(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index idx_dses_user on public.device_sessions(user_id);
create index idx_dses_org  on public.device_sessions(organization_id);

-- Add deferred FK from client_operations to device_sessions
alter table public.client_operations
  add constraint fk_cop_device_session
  foreign key (device_session_id) references public.device_sessions(id) on delete set null;

-- ─────────────────────────────────────────
-- OFFLINE_QUEUE_STATUS
-- Server-visible mirror of the client's offline queue state.
-- Updated when the client syncs. Used for diagnostics.
-- ─────────────────────────────────────────

create table public.offline_queue_status (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  user_id               uuid not null references public.profiles(id) on delete cascade,
  device_session_id     uuid references public.device_sessions(id) on delete cascade,
  venue_id              uuid references public.venues(id) on delete set null,
  pending_count         int not null default 0,
  failed_count          int not null default 0,
  conflict_count        int not null default 0,
  oldest_pending_at     timestamptz,
  last_sync_at          timestamptz,
  updated_at            timestamptz not null default now(),

  unique (user_id, device_session_id)
);

create index idx_oqs_user on public.offline_queue_status(user_id);
create index idx_oqs_org  on public.offline_queue_status(organization_id);

create trigger trg_offline_queue_status_updated_at
  before update on public.offline_queue_status
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- SYNC_CONFLICTS
-- When a client write conflicts with the server state.
-- Must be reviewed and resolved by Manager and above.
-- ─────────────────────────────────────────

create table public.sync_conflicts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  venue_id              uuid not null references public.venues(id) on delete restrict,
  client_operation_id   uuid not null references public.client_operations(id) on delete restrict,
  action_type           text not null,
  target_table          text not null,
  target_id             uuid,
  local_value           jsonb not null,
  local_submitted_at    timestamptz,
  local_device_id       uuid references public.device_sessions(id) on delete set null,
  server_value          jsonb not null,
  server_updated_at     timestamptz,
  server_updated_by     uuid references public.profiles(id) on delete set null,
  status                public.conflict_status not null default 'open',
  resolved_by           uuid references public.profiles(id) on delete set null,
  resolved_at           timestamptz,
  resolution_note       text,
  deferred_until        timestamptz,           -- optional: when to re-surface a deferred conflict
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.sync_conflicts is
  'Conflicts between offline client writes and server state. Requires Manager review to resolve.';

create index idx_sc_venue  on public.sync_conflicts(venue_id, status);
create index idx_sc_cop    on public.sync_conflicts(client_operation_id);
create index idx_sc_status on public.sync_conflicts(status, created_at);

create trigger trg_sync_conflicts_updated_at
  before update on public.sync_conflicts
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- AUDIT_LOG
-- Immutable, append-only record of all critical mutations.
-- RLS: INSERT allowed; UPDATE and DELETE NEVER allowed.
-- ─────────────────────────────────────────

create table public.audit_log (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  venue_id              uuid references public.venues(id) on delete restrict,  -- null for org-level actions
  actor_user_id         uuid not null references public.profiles(id) on delete restrict,
  action_type           text not null,         -- enum-like string: 'stock_adjustment', 'role_change', etc.
  target_table          text not null,
  target_id             uuid,
  before_state          jsonb,                 -- snapshot before mutation
  after_state           jsonb,                 -- snapshot after mutation
  reason_note           text,
  source                public.audit_source not null,
  client_operation_id   uuid,
  session_id            text,                  -- browser/app session identifier
  user_agent            text,                  -- for sensitive actions (role changes, exports)
  ip_address            inet,                  -- populated server-side via Edge Function
  created_at            timestamptz not null default now()
  -- NO updated_at — audit_log is append-only and immutable
);

comment on table public.audit_log is
  'Immutable audit trail. RLS must block all UPDATE and DELETE. Append only.';
comment on column public.audit_log.action_type is
  'Controlled vocabulary. Valid values: stock_adjustment, event_approval, event_rejection,
   invoice_approval, item_cost_change, recipe_cost_change, par_level_change, role_change,
   settings_change, feature_flag_change, export_action, conflict_override, sync_retry,
   user_deactivation, data_import, migration_action.';

create index idx_audit_org    on public.audit_log(organization_id, created_at desc);
create index idx_audit_venue  on public.audit_log(venue_id, created_at desc) where venue_id is not null;
create index idx_audit_actor  on public.audit_log(actor_user_id);
create index idx_audit_type   on public.audit_log(action_type, created_at desc);
create index idx_audit_target on public.audit_log(target_table, target_id) where target_id is not null;
create index idx_audit_cop    on public.audit_log(client_operation_id) where client_operation_id is not null;
