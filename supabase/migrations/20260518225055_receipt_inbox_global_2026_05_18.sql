begin;
alter table public.vip_table_receipt_images
  alter column spend_entry_id drop not null,
  alter column vip_table_id   drop not null;
create index if not exists idx_vrec_inbox
  on public.vip_table_receipt_images(venue_id, created_at desc)
  where vip_table_id is null;
commit;;
