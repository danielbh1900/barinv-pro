-- BARINV — VIP Receipt Photo / OCR / AI-ready foundation
-- New table vip_table_receipt_images with OCR + AI scaffolding.
-- Storage bucket vip-receipts must be created separately (next step).

create table if not exists public.vip_table_receipt_images (
  id              uuid          primary key default gen_random_uuid(),
  spend_entry_id  uuid          not null references public.vip_table_spend_entries(id) on delete cascade,
  vip_table_id    uuid          not null references public.vip_tables(id) on delete restrict,
  night_id        uuid          not null references public.nights(id)     on delete restrict,
  venue_id        uuid          not null references public.venues(id)     on delete restrict,
  storage_path    text          not null,
  image_filename  text,
  mime_type       text,
  byte_size       int,
  uploaded_by     uuid          references auth.users(id) on delete set null,
  created_at      timestamptz   not null default now(),
  ocr_status        text        not null default 'pending'
                                check (ocr_status in ('pending','processing','done','failed','skipped')),
  ocr_text          text,
  ocr_provider      text,
  ocr_completed_at  timestamptz,
  ai_parse_status   text        not null default 'pending'
                                check (ai_parse_status in ('pending','processing','done','failed','skipped')),
  ai_parse_json     jsonb,
  ai_provider       text,
  ai_confidence     numeric(4,3),
  ai_completed_at   timestamptz,
  review_required   boolean     not null default true,
  reviewed_by       uuid        references auth.users(id) on delete set null,
  reviewed_at       timestamptz,
  review_notes      text,
  receipt_code      text,
  note              text
);

comment on table public.vip_table_receipt_images is
  'Phase A receipt-foundation — receipt photos attached to a vip_table_spend_entries parent. OCR/AI columns reserved for a future pipeline; null by default.';
comment on column public.vip_table_receipt_images.storage_path is
  'Either "vip-receipts/<venue>/<night>/<uuid>.<ext>" (Supabase Storage) or "local-test:<key>" (base64 in localStorage when the bucket is unavailable).';
comment on column public.vip_table_receipt_images.ai_parse_json is
  'Reserved for future structured parse. Target shape documented in VIP_RECEIPT_PHOTO_OCR_ARCHITECTURE.md.';
comment on column public.vip_table_receipt_images.review_required is
  'Phase A safety — true means AI/OCR output is informational only; the operator MUST review before any line items are committed.';

create index if not exists idx_vtri_spend_entry
  on public.vip_table_receipt_images (spend_entry_id);
create index if not exists idx_vtri_table_night
  on public.vip_table_receipt_images (vip_table_id, night_id, created_at desc);
create index if not exists idx_vtri_ocr_pending
  on public.vip_table_receipt_images (ocr_status, created_at)
  where ocr_status = 'pending';
create index if not exists idx_vtri_ai_pending
  on public.vip_table_receipt_images (ai_parse_status, created_at)
  where ai_parse_status = 'pending';
create index if not exists idx_vtri_review_required
  on public.vip_table_receipt_images (venue_id, night_id, created_at)
  where review_required = true;

alter table public.vip_table_receipt_images enable row level security;

drop policy if exists vtri_mgr_all on public.vip_table_receipt_images;
create policy vtri_mgr_all on public.vip_table_receipt_images
  for all to authenticated
  using  (has_venue_access(venue_id, 'manager'))
  with check (has_venue_access(venue_id, 'manager'));

drop policy if exists vtri_staff_read on public.vip_table_receipt_images;
create policy vtri_staff_read on public.vip_table_receipt_images
  for select to authenticated
  using (has_venue_access(venue_id, 'staff'));;
