-- ============================================================
-- Migration 006: Recipes and Guestlist
-- Tables: recipes, recipe_ingredients,
--         guestlist_nights, ticket_classes, guestlist_entries,
--         promoters, promoter_guest_entries, door_checkins
-- ============================================================

-- ─────────────────────────────────────────
-- RECIPES
-- ─────────────────────────────────────────

create table public.recipes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  name              text not null,
  description       text,
  category          text,                      -- e.g. 'cocktail', 'mocktail', 'shot'
  serving_unit      text,                      -- e.g. 'glass', 'jug'
  yield_quantity    numeric(8,4) not null default 1,
  active            boolean not null default true,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_recipes_org on public.recipes(organization_id);

create trigger trg_recipes_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- RECIPE_INGREDIENTS
-- ─────────────────────────────────────────

create table public.recipe_ingredients (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  recipe_id         uuid not null references public.recipes(id) on delete cascade,
  item_id           uuid not null references public.items(id) on delete restrict,
  unit_id           uuid not null references public.units(id) on delete restrict,
  quantity          numeric(12,4) not null check (quantity > 0),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (recipe_id, item_id, unit_id)
);

create index idx_recipe_ing_recipe on public.recipe_ingredients(recipe_id);
create index idx_recipe_ing_item   on public.recipe_ingredients(item_id);

create trigger trg_recipe_ingredients_updated_at
  before update on public.recipe_ingredients
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- TICKET_CLASSES
-- Types of admission per night. e.g. Free, VIP, Paid, Press.
-- ─────────────────────────────────────────

create table public.ticket_classes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  name              text not null,             -- e.g. 'VIP', 'Free', 'Press'
  description       text,
  capacity          int,                       -- NULL = unlimited
  price             numeric(10,2) not null default 0,
  currency          text not null default 'CAD',
  active            boolean not null default true,
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_ticket_classes_venue on public.ticket_classes(venue_id);

create trigger trg_ticket_classes_updated_at
  before update on public.ticket_classes
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- GUESTLIST_NIGHTS
-- Links a night to its guestlist configuration.
-- One row per night per venue.
-- ─────────────────────────────────────────

create table public.guestlist_nights (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  night_id          uuid not null references public.nights(id) on delete restrict,
  notes             text,
  capacity_total    int,                       -- total capacity across all ticket classes
  check_in_opens_at timestamptz,
  check_in_closes_at timestamptz,
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (night_id)
);

create index idx_guestlist_nights_venue on public.guestlist_nights(venue_id);
create index idx_guestlist_nights_night on public.guestlist_nights(night_id);

create trigger trg_guestlist_nights_updated_at
  before update on public.guestlist_nights
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- PROMOTERS
-- Promoter profiles. Can be linked to a Supabase user (if they have app access)
-- or remain as an external reference.
-- ─────────────────────────────────────────

create table public.promoters (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  user_id           uuid references public.profiles(id) on delete set null, -- if promoter has app login
  name              text not null,
  email             text,
  phone             text,
  instagram_handle  text,
  active            boolean not null default true,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_promoters_venue on public.promoters(venue_id);
create index idx_promoters_user  on public.promoters(user_id) where user_id is not null;

create trigger trg_promoters_updated_at
  before update on public.promoters
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- GUESTLIST_ENTRIES
-- Individual guest records per night.
-- ("guestlist" renamed to avoid SQL reserved word conflicts.)
-- ─────────────────────────────────────────

create table public.guestlist_entries (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  guestlist_night_id uuid not null references public.guestlist_nights(id) on delete restrict,
  night_id          uuid not null references public.nights(id) on delete restrict,
  ticket_class_id   uuid references public.ticket_classes(id) on delete set null,
  promoter_id       uuid references public.promoters(id) on delete set null,
  guest_name        text not null,
  guest_count       int not null default 1 check (guest_count > 0),
  notes             text,
  checked_in        boolean not null default false,
  checked_in_count  int not null default 0 check (checked_in_count >= 0),
  checked_in_at     timestamptz,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles(id),
  created_by        uuid not null references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (checked_in_count <= guest_count)
);

comment on table public.guestlist_entries is
  'Individual guest entries per night. Renamed from "guestlist" to avoid SQL reserved word conflict.';

create index idx_gl_entries_night     on public.guestlist_entries(night_id);
create index idx_gl_entries_promoter  on public.guestlist_entries(promoter_id) where promoter_id is not null;
create index idx_gl_entries_venue     on public.guestlist_entries(venue_id);
create index idx_gl_entries_checkedin on public.guestlist_entries(night_id, checked_in);

create trigger trg_guestlist_entries_updated_at
  before update on public.guestlist_entries
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────
-- PROMOTER_GUEST_ENTRIES
-- Attribution join: which promoter owns which guest entries.
-- Allows multiple promoters to share a guest entry if needed.
-- ─────────────────────────────────────────

create table public.promoter_guest_entries (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  promoter_id       uuid not null references public.promoters(id) on delete cascade,
  guestlist_entry_id uuid not null references public.guestlist_entries(id) on delete cascade,
  created_at        timestamptz not null default now(),

  unique (promoter_id, guestlist_entry_id)
);

create index idx_pge_promoter on public.promoter_guest_entries(promoter_id);
create index idx_pge_entry    on public.promoter_guest_entries(guestlist_entry_id);

-- ─────────────────────────────────────────
-- DOOR_CHECKINS
-- Records the actual check-in event at the door.
-- Separate from guestlist_entries.checked_in for full traceability.
-- ─────────────────────────────────────────

create table public.door_checkins (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  venue_id            uuid not null references public.venues(id) on delete restrict,
  night_id            uuid not null references public.nights(id) on delete restrict,
  guestlist_entry_id  uuid references public.guestlist_entries(id) on delete set null,
  checked_in_by       uuid not null references public.profiles(id),
  guest_count_checked int not null default 1 check (guest_count_checked > 0),
  notes               text,
  created_at          timestamptz not null default now()
);

comment on table public.door_checkins is
  'Immutable record of each door check-in event. Separate from the guestlist entry status.';

create index idx_door_night on public.door_checkins(night_id);
create index idx_door_entry on public.door_checkins(guestlist_entry_id) where guestlist_entry_id is not null;
create index idx_door_by    on public.door_checkins(checked_in_by);
