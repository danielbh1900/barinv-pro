-- ============================================================
-- Migration 004: Warehouse and Inventory
-- Tables: warehouse_stock, stock_movements, stock_transfers,
--         stock_adjustments, inventory_snapshots,
--         count_sessions, count_entries, par_rules, waste_log
-- ============================================================

-- ─────────────────────────────────────────
-- ENUM TYPES
-- ─────────────────────────────────────────

create type public.movement_type as enum (
  'receipt',          -- stock received from supplier
  'transfer_out',     -- transferred to another station/bar
  'transfer_in',      -- received from another station/bar
  'adjustment',       -- manual correction
  'waste',            -- spoilage, breakage, spillage
  'event_consumption',-- consumed via an approved event
  'count_correction', -- result of a stock count reconciliation
  'opening_balance',  -- initial balance when system goes live
  'migration'         -- imported from legacy system
);

create type public.adjustment_reason as enum (
  'found',
  'lost',
  'damaged',
  'theft',
  'administrative',
  'opening_balance',
  'other'
);

create type public.count_session_status as enum (
  'draft',
  'in_progress',
  'submitted',
  'approved',
  'voided'
);

create type public.waste_reason as enum (
  'spillage',
  'breakage',
  'expired',
  'contamination',
  'other'
);

-- ─────────────────────────────────────────
-- WAREHOUSE_STOCK
-- Current stock level per item per venue (materialized balance).
-- The ledger (stock_movements) is the source of truth.
-- This table is the cached/materialized view for fast reads.
-- ─────────────────────────────────────────

create table public.warehouse_stock (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  quantity          numeric(12,4) not null default 0,
  last_movement_at  timestamptz,
  updated_at        timestamptz not null default now(),

  unique (venue_id, item_id, unit_id)
);

comment on table public.warehouse_stock is
  'Materialized current stock balance per item per venue. Ledger (stock_movements) is source of truth.';

create index idx_wstock_venue on public.warehouse_stock(venue_id);
create index idx_wstock_item  on public.warehouse_stock(item_id);

create trigger trg_warehouse_stock_updated_at
  before update on public.warehouse_stock
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- STOCK_MOVEMENTS
-- Immutable ledger of every stock change.
-- Never update or delete a movement — insert a correction instead.
-- ─────────────────────────────────────────

create table public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  movement_type     public.movement_type not null,
  quantity_delta    numeric(12,4) not null,    -- positive = stock in, negative = stock out
  quantity_after    numeric(12,4) not null,    -- balance after this movement
  cost_per_unit     numeric(12,4),             -- cost at time of movement (snapshot)
  cost_currency     text not null default 'CAD',

  -- Traceability: at least one of these should be set
  reference_event_id        uuid references public.events(id) on delete restrict,
  reference_transfer_id     uuid,              -- FK added after stock_transfers created
  reference_adjustment_id   uuid,              -- FK added after stock_adjustments created
  reference_count_session_id uuid,             -- FK added after count_sessions created
  reference_waste_id        uuid,              -- FK added after waste_log created
  reference_po_id           uuid,              -- FK added in migration 005

  actor_id          uuid not null references public.profiles(id),
  client_operation_id uuid,                   -- for offline idempotency
  reason_note       text,
  migrated_from_legacy boolean not null default false,
  created_at        timestamptz not null default now()
  -- NO updated_at — movements are immutable
);

comment on table public.stock_movements is
  'Immutable stock ledger. Every change to stock produces a row here. Never update or delete.';
comment on column public.stock_movements.quantity_delta is
  'Positive = stock added (receipt, transfer_in). Negative = stock removed (consumption, waste).';
comment on column public.stock_movements.quantity_after is
  'Balance snapshot after this movement. Allows point-in-time reconstruction.';

create index idx_smov_venue     on public.stock_movements(venue_id, created_at desc);
create index idx_smov_item      on public.stock_movements(item_id);
create index idx_smov_type      on public.stock_movements(movement_type);
create index idx_smov_event     on public.stock_movements(reference_event_id) where reference_event_id is not null;
create index idx_smov_cop       on public.stock_movements(client_operation_id) where client_operation_id is not null;

-- ─────────────────────────────────────────
-- STOCK_TRANSFERS
-- Movement of stock between bars or stations within a venue.
-- Produces two stock_movements rows (transfer_out + transfer_in).
-- ─────────────────────────────────────────

create table public.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  from_bar_id       uuid references public.bars(id) on delete restrict,
  to_bar_id         uuid references public.bars(id) on delete restrict,
  from_station_id   uuid references public.stations(id) on delete restrict,
  to_station_id     uuid references public.stations(id) on delete restrict,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  quantity          numeric(12,4) not null check (quantity > 0),
  reason_note       text,
  client_operation_id uuid unique,
  actor_id          uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),

  check (
    (from_bar_id is not null or from_station_id is not null) and
    (to_bar_id is not null or to_station_id is not null)
  )
);

comment on table public.stock_transfers is
  'Transfer of stock between bars or stations. Produces two stock_movements rows.';

create index idx_stransfer_venue on public.stock_transfers(venue_id);
create index idx_stransfer_item  on public.stock_transfers(item_id);

-- Add deferred FK to stock_movements
alter table public.stock_movements
  add constraint fk_smov_transfer
  foreign key (reference_transfer_id) references public.stock_transfers(id) on delete restrict;

-- ─────────────────────────────────────────
-- STOCK_ADJUSTMENTS
-- Manual stock corrections by Manager and above.
-- Always produces a stock_movements row.
-- Always produces an audit_log row (added in migration 007).
-- ─────────────────────────────────────────

create table public.stock_adjustments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  quantity_before   numeric(12,4) not null,
  quantity_after    numeric(12,4) not null,
  reason            public.adjustment_reason not null,
  reason_note       text,
  client_operation_id uuid unique,
  actor_id          uuid not null references public.profiles(id),
  created_at        timestamptz not null default now()
);

comment on table public.stock_adjustments is
  'Manual stock corrections. Always linked to a stock_movements row and an audit_log row.';

create index idx_sadj_venue on public.stock_adjustments(venue_id);
create index idx_sadj_item  on public.stock_adjustments(item_id);

alter table public.stock_movements
  add constraint fk_smov_adjustment
  foreign key (reference_adjustment_id) references public.stock_adjustments(id) on delete restrict;

-- ─────────────────────────────────────────
-- INVENTORY_SNAPSHOTS
-- Point-in-time freeze of all stock balances.
-- Used for reporting that must remain stable even if live data changes.
-- ─────────────────────────────────────────

create table public.inventory_snapshots (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  snapshot_date     date not null,
  label             text,
  snapshot_data     jsonb not null,            -- { item_id: { quantity, unit_id, cost_per_unit } }
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now()
);

comment on table public.inventory_snapshots is
  'Point-in-time freeze of stock balances for stable historical reporting.';

create index idx_isnap_venue on public.inventory_snapshots(venue_id, snapshot_date desc);

-- ─────────────────────────────────────────
-- COUNT_SESSIONS
-- A stock count event (header record).
-- Counting lines are in count_entries.
-- ─────────────────────────────────────────

create table public.count_sessions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  bar_id            uuid references public.bars(id) on delete restrict,
  night_id          uuid references public.nights(id) on delete restrict,
  status            public.count_session_status not null default 'draft',
  label             text,
  started_at        timestamptz,
  submitted_at      timestamptz,
  approved_at       timestamptz,
  approved_by       uuid references public.profiles(id),
  voided_at         timestamptz,
  voided_by         uuid references public.profiles(id),
  void_reason       text,
  client_operation_id uuid unique,
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.count_sessions is
  'Header for a stock count event. Individual count lines are in count_entries.';

create index idx_csess_venue  on public.count_sessions(venue_id);
create index idx_csess_bar    on public.count_sessions(bar_id) where bar_id is not null;
create index idx_csess_status on public.count_sessions(venue_id, status);

create trigger trg_count_sessions_updated_at
  before update on public.count_sessions
  for each row execute function public.set_updated_at();

alter table public.stock_movements
  add constraint fk_smov_count_session
  foreign key (reference_count_session_id) references public.count_sessions(id) on delete restrict;

-- ─────────────────────────────────────────
-- COUNT_ENTRIES
-- Individual item count lines within a count session.
-- ─────────────────────────────────────────

create table public.count_entries (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  count_session_id  uuid not null references public.count_sessions(id) on delete cascade,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  expected_quantity numeric(12,4),             -- what system expected based on last snapshot
  counted_quantity  numeric(12,4) not null,
  variance          numeric(12,4)              -- generated: counted - expected
    generated always as (counted_quantity - coalesce(expected_quantity, 0)) stored,
  notes             text,
  counted_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (count_session_id, item_id, unit_id)
);

comment on table public.count_entries is
  'Individual item lines within a count session. variance is computed automatically.';

create index idx_centry_session on public.count_entries(count_session_id);
create index idx_centry_item    on public.count_entries(item_id);

create trigger trg_count_entries_updated_at
  before update on public.count_entries
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- PAR_RULES
-- Minimum stock level rules per item per venue/bar.
-- ─────────────────────────────────────────

create table public.par_rules (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  bar_id            uuid references public.bars(id) on delete restrict,   -- NULL = venue-wide
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  par_quantity      numeric(12,4) not null check (par_quantity >= 0),
  reorder_quantity  numeric(12,4),             -- suggested reorder quantity
  active            boolean not null default true,
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (venue_id, bar_id, item_id, unit_id)
);

comment on table public.par_rules is
  'Minimum stock level rules. bar_id NULL means venue-wide rule.';

create index idx_par_venue on public.par_rules(venue_id);
create index idx_par_item  on public.par_rules(item_id);

create trigger trg_par_rules_updated_at
  before update on public.par_rules
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- WASTE_LOG
-- Records of stock lost to spoilage, breakage, etc.
-- Always produces a stock_movements row.
-- ─────────────────────────────────────────

create table public.waste_log (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  night_id          uuid references public.nights(id) on delete restrict,
  station_id        uuid references public.stations(id) on delete restrict,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  quantity          numeric(12,4) not null check (quantity > 0),
  reason            public.waste_reason not null,
  reason_note       text,
  client_operation_id uuid unique,
  actor_id          uuid not null references public.profiles(id),
  migrated_from_legacy boolean not null default false,
  created_at        timestamptz not null default now()
);

comment on table public.waste_log is
  'Stock lost to spillage, breakage, expiry. Always linked to a stock_movements row.';

create index idx_waste_venue on public.waste_log(venue_id);
create index idx_waste_item  on public.waste_log(item_id);
create index idx_waste_night on public.waste_log(night_id) where night_id is not null;

alter table public.stock_movements
  add constraint fk_smov_waste
  foreign key (reference_waste_id) references public.waste_log(id) on delete restrict;
