-- ============================================================
-- Migration 003: Operations
-- Tables: nights, placements, events, activity_log
-- ============================================================

-- ─────────────────────────────────────────
-- ENUM TYPES
-- ─────────────────────────────────────────

create type public.event_status as enum (
  'pending',
  'approved',
  'rejected',
  'voided'
);

create type public.event_type as enum (
  'bottle_service',
  'spillage',
  'breakage',
  'comp',
  'void',
  'transfer',
  'other'
);

create type public.placement_status as enum (
  'open',
  'closed',
  'cancelled'
);

-- ─────────────────────────────────────────
-- NIGHTS
-- A "night" is one operational shift at a venue.
-- Date is the LOCAL venue date (not UTC), stored as date type.
-- The actual UTC timestamps are open_at / close_at.
-- ─────────────────────────────────────────

create table public.nights (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  night_date        date not null,             -- local venue date; e.g. 2024-03-01
  label             text,                      -- optional human label e.g. 'St. Patrick's Night'
  open_at           timestamptz,               -- UTC time shift opened
  close_at          timestamptz,               -- UTC time shift closed
  closed_by         uuid references public.profiles(id),
  notes             text,
  migrated_from_legacy boolean not null default false,
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (venue_id, night_date)
);

comment on table public.nights is
  'One operational shift at a venue. night_date is the local venue date, not UTC.';
comment on column public.nights.night_date is
  'Local venue date. A shift starting Fri 21:00 and ending Sat 03:00 belongs to Fri.';

create index idx_nights_venue      on public.nights(venue_id);
create index idx_nights_org        on public.nights(organization_id);
create index idx_nights_date       on public.nights(venue_id, night_date desc);

create trigger trg_nights_updated_at
  before update on public.nights
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- PLACEMENTS
-- A placement is an assignment of staff to a station for a night.
-- ─────────────────────────────────────────

create table public.placements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  night_id          uuid not null references public.nights(id) on delete restrict,
  station_id        uuid not null references public.stations(id) on delete restrict,
  user_id           uuid not null references public.profiles(id) on delete restrict,
  status            public.placement_status not null default 'open',
  start_at          timestamptz,
  end_at            timestamptz,
  notes             text,
  migrated_from_legacy boolean not null default false,
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.placements is
  'Staff assigned to a station for a specific night.';

create index idx_placements_night   on public.placements(night_id);
create index idx_placements_station on public.placements(station_id);
create index idx_placements_user    on public.placements(user_id);
create index idx_placements_venue   on public.placements(venue_id);

create trigger trg_placements_updated_at
  before update on public.placements
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- EVENTS
-- A stock consumption or movement event submitted by staff.
-- This is the core operational write action.
-- ─────────────────────────────────────────

create table public.events (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  venue_id              uuid not null references public.venues(id) on delete restrict,
  night_id              uuid not null references public.nights(id) on delete restrict,
  placement_id          uuid references public.placements(id) on delete set null,
  station_id            uuid not null references public.stations(id) on delete restrict,
  submitted_by          uuid not null references public.profiles(id),
  approved_by           uuid references public.profiles(id),
  rejected_by           uuid references public.profiles(id),

  event_type            public.event_type not null,
  status                public.event_status not null default 'pending',

  item_id               uuid not null references public.items(id) on delete restrict,
  unit_id               uuid not null references public.units(id) on delete restrict,
  quantity              numeric(12,4) not null check (quantity > 0),

  reason_note           text,
  rejection_note        text,

  -- Offline support
  client_operation_id   uuid unique,           -- idempotency key from client
  submitted_at_local    timestamptz,           -- timestamp on device when submitted offline

  migrated_from_legacy  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.events is
  'Stock consumption or movement event submitted by staff during a night.';
comment on column public.events.client_operation_id is
  'UUID generated client-side for offline idempotency. Unique constraint prevents duplicate submission.';
comment on column public.events.submitted_at_local is
  'Timestamp from client device when action was taken offline. May differ from created_at.';

create index idx_events_night       on public.events(night_id);
create index idx_events_station     on public.events(station_id);
create index idx_events_submitted   on public.events(submitted_by);
create index idx_events_venue       on public.events(venue_id);
create index idx_events_status      on public.events(venue_id, status);
create index idx_events_item        on public.events(item_id);
create index idx_events_cop         on public.events(client_operation_id) where client_operation_id is not null;

create trigger trg_events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- ACTIVITY_LOG
-- Lightweight operational log for in-app display.
-- NOT a replacement for audit_log — that is in migration 007.
-- This is for "recent activity" feeds visible to all staff.
-- ─────────────────────────────────────────

create table public.activity_log (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  night_id          uuid references public.nights(id) on delete set null,
  actor_id          uuid not null references public.profiles(id),
  action_type       text not null,             -- e.g. 'event_submitted', 'event_approved'
  target_table      text,
  target_id         uuid,
  description       text,                      -- human-readable summary
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now()
);

comment on table public.activity_log is
  'Lightweight recent-activity feed for in-app display. Not the audit trail — see audit_log.';

create index idx_activity_venue on public.activity_log(venue_id, created_at desc);
create index idx_activity_night on public.activity_log(night_id) where night_id is not null;
create index idx_activity_actor on public.activity_log(actor_id);
