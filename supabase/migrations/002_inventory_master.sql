-- ============================================================
-- Migration 002: Inventory Master Data
-- Tables: units, items, item_uom_conversions, bars, stations
-- ============================================================

-- ─────────────────────────────────────────
-- ENUM TYPES
-- ─────────────────────────────────────────

create type public.item_category as enum (
  'spirit',
  'beer',
  'wine',
  'mixer',
  'garnish',
  'consumable',
  'equipment',
  'other'
);

-- ─────────────────────────────────────────
-- UNITS
-- e.g. 750ml bottle, case of 12, keg, litre
-- ─────────────────────────────────────────

create table public.units (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  name              text not null,             -- e.g. 'Bottle 750ml'
  abbreviation      text not null,             -- e.g. '750ml'
  base_ml           numeric(12,4),             -- optional: base volume in ml for cross-unit math
  active            boolean not null default true,
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (organization_id, name)
);

comment on table public.units is
  'Units of measure for inventory items. Scoped per organization.';
comment on column public.units.base_ml is
  'If unit is volume-based, store base ml for conversion math. NULL for non-volume units.';

create index idx_units_org on public.units(organization_id);

create trigger trg_units_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- ITEMS
-- Master product list.
-- ─────────────────────────────────────────

create table public.items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  name              text not null,
  sku               text,                      -- internal SKU or barcode
  category          public.item_category not null default 'other',
  default_unit_id   uuid not null references public.units(id) on delete restrict,
  current_cost      numeric(12,4),             -- current unit cost (point-in-time; history in cost_snapshots)
  current_cost_currency text not null default 'CAD',
  par_warning_threshold numeric(12,4),         -- optional global par for this item
  active            boolean not null default true,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  migrated_from_legacy boolean not null default false,
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.items is
  'Master product catalogue. Shared across venues within an organization.';
comment on column public.items.current_cost is
  'Current unit cost. Historical cost is preserved in cost_snapshots — never edit this silently.';

create index idx_items_org      on public.items(organization_id);
create index idx_items_sku      on public.items(organization_id, sku) where sku is not null;
create index idx_items_category on public.items(organization_id, category);
create index idx_items_active   on public.items(organization_id) where deleted_at is null;

create trigger trg_items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- ITEM_UOM_CONVERSIONS
-- How units relate to each other for a given item.
-- e.g. 1 Case = 12 Bottles for Hendricks 750ml
-- ─────────────────────────────────────────

create table public.item_uom_conversions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  item_id           uuid not null references public.items(id) on delete cascade,
  from_unit_id      uuid not null references public.units(id) on delete restrict,
  to_unit_id        uuid not null references public.units(id) on delete restrict,
  factor            numeric(16,8) not null,    -- from_unit * factor = to_unit
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (item_id, from_unit_id, to_unit_id),
  check (from_unit_id <> to_unit_id),
  check (factor > 0)
);

comment on table public.item_uom_conversions is
  'Unit-of-measure conversion factors per item. e.g. 1 case = 12 bottles.';

create index idx_uom_item on public.item_uom_conversions(item_id);

create trigger trg_item_uom_conversions_updated_at
  before update on public.item_uom_conversions
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- BARS
-- Physical bar areas within a venue.
-- ─────────────────────────────────────────

create table public.bars (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  name              text not null,
  active            boolean not null default true,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (venue_id, name)
);

comment on table public.bars is
  'Physical bar areas within a venue. e.g. Main Bar, VIP Bar, Patio.';

create index idx_bars_venue on public.bars(venue_id);
create index idx_bars_org   on public.bars(organization_id);

create trigger trg_bars_updated_at
  before update on public.bars
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- STATIONS
-- Specific serving stations within a bar.
-- A station is the finest granularity for inventory and event tracking.
-- ─────────────────────────────────────────

create table public.stations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  bar_id            uuid not null references public.bars(id) on delete restrict,
  name              text not null,
  active            boolean not null default true,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (bar_id, name)
);

comment on table public.stations is
  'Serving stations within a bar. Finest granularity for event and inventory tracking.';

create index idx_stations_bar   on public.stations(bar_id);
create index idx_stations_venue on public.stations(venue_id);
create index idx_stations_org   on public.stations(organization_id);

create trigger trg_stations_updated_at
  before update on public.stations
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- Add station_id FK to venue_users (deferred from migration 001)
-- ─────────────────────────────────────────

alter table public.venue_users
  add constraint fk_venue_users_station
  foreign key (station_id) references public.stations(id) on delete set null;
