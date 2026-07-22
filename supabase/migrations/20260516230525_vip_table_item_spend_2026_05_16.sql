-- BARINV — VIP Table Item Spend (Phase A)
-- Extends vip_table_spend_entries with item_*/qty/unit_price/barcode/source/staff_id.
-- Trigger _vtse_sync_table_totals unchanged. Idempotent.

alter table public.vip_table_spend_entries
  add column if not exists item_id     uuid           references public.items(id) on delete set null,
  add column if not exists item_sku    text,
  add column if not exists item_name   text,
  add column if not exists qty         numeric(12,3),
  add column if not exists unit_price  numeric(12,2),
  add column if not exists barcode     text,
  add column if not exists source      text not null default 'manual_spend',
  add column if not exists staff_id    uuid           references public.staff(id) on delete set null;

comment on column public.vip_table_spend_entries.source is
  'Phase A item-spend — provenance: ''manual_spend'' | ''table_item_spend'' | ''legacy_unknown''.';

alter table public.vip_table_spend_entries
  drop constraint if exists vtse_source_known;
alter table public.vip_table_spend_entries
  add constraint vtse_source_known
  check (source in ('manual_spend','table_item_spend','legacy_unknown'));

update public.vip_table_spend_entries
   set source = case when entry_type = 'legacy' then 'legacy_unknown' else 'manual_spend' end
 where source is null;

create index if not exists idx_vtse_item
  on public.vip_table_spend_entries (vip_table_id, item_id, created_at desc)
  where item_id is not null;

create or replace view public.v_vip_table_items_tonight as
select
  e.id              as entry_id,
  e.venue_id,
  e.night_id,
  e.vip_table_id,
  e.entry_type,
  e.source,
  e.item_id,
  coalesce(e.item_name, i.name) as display_name,
  e.item_sku,
  e.barcode,
  e.qty,
  e.unit_price,
  e.amount,
  e.comps,
  e.discounts,
  e.receipt_code,
  e.note,
  e.created_by,
  e.staff_id,
  e.created_at,
  e.voided
from public.vip_table_spend_entries e
left join public.items i on i.id = e.item_id
where e.source = 'table_item_spend';

grant select on public.v_vip_table_items_tonight to authenticated;;
