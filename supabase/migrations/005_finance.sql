-- ============================================================
-- Migration 005: Finance and Purchasing
-- Tables: suppliers, supplier_contacts, purchase_orders,
--         po_items, invoices, invoice_items,
--         reorder_rules, cost_snapshots
-- ============================================================

-- ─────────────────────────────────────────
-- ENUM TYPES
-- ─────────────────────────────────────────

create type public.po_status as enum (
  'draft',
  'sent',
  'partially_received',
  'received',
  'cancelled'
);

create type public.invoice_status as enum (
  'pending',
  'approved',
  'rejected',
  'paid',
  'void'
);

-- ─────────────────────────────────────────
-- SUPPLIERS
-- ─────────────────────────────────────────

create table public.suppliers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  name              text not null,
  account_number    text,
  email             text,
  phone             text,
  address           text,
  notes             text,
  active            boolean not null default true,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (organization_id, name)
);

create index idx_suppliers_org on public.suppliers(organization_id);

create trigger trg_suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- SUPPLIER_CONTACTS
-- ─────────────────────────────────────────

create table public.supplier_contacts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  supplier_id       uuid not null references public.suppliers(id) on delete cascade,
  name              text not null,
  role              text,
  email             text,
  phone             text,
  primary_contact   boolean not null default false,
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_supplier_contacts_supplier on public.supplier_contacts(supplier_id);

create trigger trg_supplier_contacts_updated_at
  before update on public.supplier_contacts
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- PURCHASE_ORDERS
-- ─────────────────────────────────────────

create table public.purchase_orders (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  supplier_id       uuid not null references public.suppliers(id) on delete restrict,
  po_number         text,                      -- human-readable reference
  status            public.po_status not null default 'draft',
  ordered_at        timestamptz,
  expected_at       date,
  received_at       timestamptz,
  notes             text,
  total_amount      numeric(14,4),
  currency          text not null default 'CAD',
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_po_venue    on public.purchase_orders(venue_id);
create index idx_po_supplier on public.purchase_orders(supplier_id);
create index idx_po_status   on public.purchase_orders(venue_id, status);

create trigger trg_purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- PO_ITEMS
-- Line items on a purchase order.
-- ─────────────────────────────────────────

create table public.po_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  po_id             uuid not null references public.purchase_orders(id) on delete cascade,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  quantity_ordered  numeric(12,4) not null check (quantity_ordered > 0),
  quantity_received numeric(12,4) not null default 0 check (quantity_received >= 0),
  unit_cost         numeric(12,4) not null check (unit_cost >= 0),
  total_cost        numeric(14,4)
    generated always as (quantity_ordered * unit_cost) stored,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_po_items_po   on public.po_items(po_id);
create index idx_po_items_item on public.po_items(item_id);

create trigger trg_po_items_updated_at
  before update on public.po_items
  for each row execute function public.set_updated_at();

-- Add deferred FK from stock_movements to purchase_orders
alter table public.stock_movements
  add constraint fk_smov_po
  foreign key (reference_po_id) references public.purchase_orders(id) on delete restrict;

-- ─────────────────────────────────────────
-- INVOICES
-- ─────────────────────────────────────────

create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  supplier_id       uuid not null references public.suppliers(id) on delete restrict,
  po_id             uuid references public.purchase_orders(id) on delete set null,
  invoice_number    text,
  status            public.invoice_status not null default 'pending',
  invoice_date      date,
  due_date          date,
  total_amount      numeric(14,4) not null check (total_amount >= 0),
  tax_amount        numeric(14,4) not null default 0,
  currency          text not null default 'CAD',
  attachment_url    text,                      -- link to Supabase Storage object
  notes             text,
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  rejection_note    text,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_invoices_venue    on public.invoices(venue_id);
create index idx_invoices_supplier on public.invoices(supplier_id);
create index idx_invoices_status   on public.invoices(venue_id, status);
create index idx_invoices_po       on public.invoices(po_id) where po_id is not null;

create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- INVOICE_ITEMS
-- ─────────────────────────────────────────

create table public.invoice_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  item_id           uuid references public.items(id) on delete set null,
  description       text not null,             -- free text description (item may be null)
  unit_id           uuid references public.units(id) on delete set null,
  quantity          numeric(12,4) not null check (quantity > 0),
  unit_cost         numeric(12,4) not null check (unit_cost >= 0),
  line_total        numeric(14,4)
    generated always as (quantity * unit_cost) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_invoice_items_invoice on public.invoice_items(invoice_id);
create index idx_invoice_items_item    on public.invoice_items(item_id) where item_id is not null;

create trigger trg_invoice_items_updated_at
  before update on public.invoice_items
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- REORDER_RULES
-- Automated reorder suggestions per item per venue.
-- ─────────────────────────────────────────

create table public.reorder_rules (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  supplier_id       uuid references public.suppliers(id) on delete set null,
  reorder_point     numeric(12,4) not null,    -- trigger reorder when stock falls below this
  reorder_quantity  numeric(12,4) not null,    -- how much to order
  active            boolean not null default true,
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (venue_id, item_id, unit_id)
);

create index idx_reorder_venue on public.reorder_rules(venue_id);
create index idx_reorder_item  on public.reorder_rules(item_id);

create trigger trg_reorder_rules_updated_at
  before update on public.reorder_rules
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- COST_SNAPSHOTS
-- Point-in-time record of item cost.
-- Created whenever item cost changes. Immutable once written.
-- ─────────────────────────────────────────

create table public.cost_snapshots (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  cost              numeric(12,4) not null,
  currency          text not null default 'CAD',
  effective_from    timestamptz not null default now(),
  source            text not null,             -- 'manual', 'invoice', 'po', 'migration'
  reference_id      uuid,                      -- FK to invoice or PO if applicable
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now()
  -- NO updated_at — cost snapshots are immutable
);

comment on table public.cost_snapshots is
  'Immutable point-in-time cost record. Created on every item cost change. Never updated.';

create index idx_cost_item on public.cost_snapshots(item_id, effective_from desc);
