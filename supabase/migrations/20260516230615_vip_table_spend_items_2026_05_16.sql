-- BARINV — VIP Table Spend Items (line-item child table)
-- One row per item line on an itemized invoice. Parent = vip_table_spend_entries.
-- line_total is GENERATED. RLS manager+ FOR ALL. Convenience rollup view.

create table if not exists public.vip_table_spend_items (
  id              uuid          primary key default gen_random_uuid(),
  spend_entry_id  uuid          not null references public.vip_table_spend_entries(id) on delete cascade,
  vip_table_id    uuid          not null references public.vip_tables(id) on delete restrict,
  night_id        uuid          not null references public.nights(id)     on delete restrict,
  venue_id        uuid          not null references public.venues(id)     on delete restrict,
  item_id         uuid                   references public.items(id) on delete set null,
  barcode         text,
  item_sku        text,
  item_name       text          not null,
  qty             numeric(12,3) not null check (qty > 0),
  unit_price      numeric(12,2) not null check (unit_price >= 0),
  line_total      numeric(12,2) generated always as (round(qty * unit_price, 2)) stored,
  note            text,
  created_at      timestamptz   not null default now()
);

comment on table public.vip_table_spend_items is
  'Phase A — line items for itemized table spend. 0..N rows per vip_table_spend_entries parent. line_total is GENERATED.';

create index if not exists idx_vtsi_spend_entry
  on public.vip_table_spend_items (spend_entry_id);
create index if not exists idx_vtsi_table_night
  on public.vip_table_spend_items (vip_table_id, night_id, created_at desc);
create index if not exists idx_vtsi_item
  on public.vip_table_spend_items (item_id, created_at desc)
  where item_id is not null;
create index if not exists idx_vtsi_barcode
  on public.vip_table_spend_items (barcode)
  where barcode is not null;

alter table public.vip_table_spend_items enable row level security;

drop policy if exists vtsi_mgr_all on public.vip_table_spend_items;
create policy vtsi_mgr_all on public.vip_table_spend_items
  for all to authenticated
  using (has_venue_access(venue_id, 'manager'))
  with check (has_venue_access(venue_id, 'manager'));

create or replace view public.v_vip_table_spend_line_rollup as
select
  e.id                                              as spend_entry_id,
  e.vip_table_id,
  e.night_id,
  e.venue_id,
  e.created_at                                       as entry_created_at,
  e.amount                                           as parent_amount,
  coalesce(i.line_count, 0)                          as line_count,
  coalesce(i.lines_subtotal, 0)                      as lines_subtotal,
  (
    coalesce(i.line_count, 0) > 0
    and abs(coalesce(e.amount, 0) - coalesce(i.lines_subtotal, 0)) > 0.01
  )                                                  as manual_override_active
from public.vip_table_spend_entries e
left join (
  select spend_entry_id,
         count(*)::int        as line_count,
         sum(line_total)      as lines_subtotal
    from public.vip_table_spend_items
   group by spend_entry_id
) i on i.spend_entry_id = e.id;

grant select on public.v_vip_table_spend_line_rollup to authenticated;;
