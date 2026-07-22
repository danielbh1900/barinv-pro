begin;

alter table public.vip_table_receipt_images
  add column if not exists gst              numeric,
  add column if not exists liquor_tax       numeric,
  add column if not exists sugar_tax        numeric,
  add column if not exists ocr_fingerprint  text;

create index if not exists idx_vrec_img_fingerprint
  on public.vip_table_receipt_images(venue_id, ocr_fingerprint)
  where ocr_fingerprint is not null;

alter table public.vip_table_receipt_candidates
  add column if not exists category_guess text;

commit;;
