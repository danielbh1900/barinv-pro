begin;
create table if not exists public.night_pos_device_mappings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  night_id uuid not null references public.nights(id) on delete cascade,
  event_id uuid,
  square_location_id text, square_device_id text, square_device_name text,
  square_source_key text not null, square_source_label text,
  assigned_bar_id uuid references public.bars(id) on delete set null,
  assigned_vip_id uuid references public.vip_tables(id) on delete set null,
  assigned_internal_area_id uuid,
  assignment_type text not null default 'unassigned' check (assignment_type in ('bar','vip','internal','unassigned')),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  suggested_from_history boolean default false,
  active boolean default true, locked boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  created_by uuid, updated_by uuid,
  unique (venue_id, night_id, square_source_key)
);
create index if not exists idx_npdm_venue_night    on public.night_pos_device_mappings(venue_id, night_id);
create index if not exists idx_npdm_source_key     on public.night_pos_device_mappings(venue_id, square_source_key);
create index if not exists idx_npdm_assignment_bar on public.night_pos_device_mappings(assigned_bar_id) where assigned_bar_id is not null;
alter table public.night_pos_device_mappings enable row level security;
drop policy if exists npdm_mgr_all on public.night_pos_device_mappings;
create policy npdm_mgr_all on public.night_pos_device_mappings for all using (public.has_venue_access(venue_id, 'manager')) with check (public.has_venue_access(venue_id, 'manager'));
drop policy if exists npdm_staff_read on public.night_pos_device_mappings;
create policy npdm_staff_read on public.night_pos_device_mappings for select using (public.has_venue_access(venue_id, 'viewer'));
create or replace function public._npdm_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists npdm_touch_updated_at on public.night_pos_device_mappings;
create trigger npdm_touch_updated_at before update on public.night_pos_device_mappings for each row execute function public._npdm_touch_updated_at();
commit;;
