-- ============================================================
-- Migration 001: Organization and Access
-- Tables: organizations, venues, profiles, venue_users,
--         role_permissions
-- ============================================================

-- Enable UUID extension (safe to run multiple times)
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────
-- ENUM TYPES
-- ─────────────────────────────────────────

create type public.user_role as enum (
  'owner',
  'admin',
  'co_admin',
  'manager',
  'finance',
  'bartender',
  'barback',
  'door',
  'promoter'
);

create type public.permission_action as enum (
  'read',
  'insert',
  'update',
  'delete'
);

-- ─────────────────────────────────────────
-- ORGANIZATIONS
-- ─────────────────────────────────────────

create table public.organizations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,       -- url-safe identifier
  logo_url          text,
  billing_email     text,
  active            boolean not null default true,
  migrated_from_legacy boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.organizations is
  'Top-level tenant. All business data belongs to an organization.';

create index idx_organizations_slug on public.organizations(slug);

-- ─────────────────────────────────────────
-- VENUES
-- ─────────────────────────────────────────

create table public.venues (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  name              text not null,
  slug              text not null,             -- unique within org
  timezone          text not null,             -- IANA timezone, e.g. 'America/Vancouver'
  address           text,
  active            boolean not null default true,
  settings          jsonb not null default '{}',
  migrated_from_legacy boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (organization_id, slug)
);

comment on table public.venues is
  'A physical venue within an organization. Timezone is required and per-venue.';
comment on column public.venues.timezone is
  'IANA timezone string. All timestamps stored in UTC; this is used for display only.';
comment on column public.venues.settings is
  'Venue-level config: night_boundary_hour (default 4), etc.';

create index idx_venues_org on public.venues(organization_id);

-- Validate timezone is a non-empty string (full IANA validation happens in application layer)
alter table public.venues
  add constraint venues_timezone_nonempty check (char_length(trim(timezone)) > 0);

-- ─────────────────────────────────────────
-- PROFILES
-- Extends Supabase auth.users with app-level fields.
-- Inserted automatically via trigger on auth.users insert.
-- ─────────────────────────────────────────

create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  full_name         text not null,
  display_name      text,
  phone             text,
  avatar_url        text,
  active            boolean not null default true,
  migrated_from_legacy boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.profiles is
  'App-level user profile. One per auth.users row. Always scoped to an organization.';

create index idx_profiles_org on public.profiles(organization_id);

-- Auto-create profile on signup (org assignment handled in application layer / Edge Function)
-- The trigger below creates a minimal profile; full onboarding sets organization_id.

-- ─────────────────────────────────────────
-- VENUE_USERS
-- Which users are assigned to which venues, and with what role.
-- A user can have different roles in different venues.
-- ─────────────────────────────────────────

create table public.venue_users (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  role              public.user_role not null,
  station_id        uuid,                      -- optional: restrict bartender/barback to a station (FK added in migration 002)
  active            boolean not null default true,
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (venue_id, user_id)                  -- one role per user per venue
);

comment on table public.venue_users is
  'Assigns a user to a venue with a specific role. A user may have different roles across venues.';

create index idx_venue_users_venue on public.venue_users(venue_id);
create index idx_venue_users_user  on public.venue_users(user_id);
create index idx_venue_users_org   on public.venue_users(organization_id);

-- ─────────────────────────────────────────
-- ROLE_PERMISSIONS
-- Granular permission definitions per role per resource.
-- Seeded once; rarely modified at runtime.
-- ─────────────────────────────────────────

create table public.role_permissions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  role              public.user_role not null,
  resource          text not null,             -- e.g. 'warehouse', 'events', 'finance'
  action            public.permission_action not null,
  allowed           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (organization_id, role, resource, action)
);

comment on table public.role_permissions is
  'Granular permission matrix per role per resource. Seeded with defaults; overridable per org.';

create index idx_role_permissions_org_role on public.role_permissions(organization_id, role);

-- ─────────────────────────────────────────
-- UPDATED_AT TRIGGER FUNCTION
-- Reused by all tables that need auto-updated_at.
-- ─────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply trigger to all tables with updated_at
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger trg_venues_updated_at
  before update on public.venues
  for each row execute function public.set_updated_at();

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_venue_users_updated_at
  before update on public.venue_users
  for each row execute function public.set_updated_at();

create trigger trg_role_permissions_updated_at
  before update on public.role_permissions
  for each row execute function public.set_updated_at();
