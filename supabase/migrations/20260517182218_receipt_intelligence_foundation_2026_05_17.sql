-- BARINV — Receipt Intelligence Foundation (additive)
-- 1. Receipt-header analytics columns on vip_table_receipt_images
-- 2. New table vip_table_receipt_candidates (one row per parsed line)
-- 3. RLS mirrors the existing image-table policy shape

-- ── 1. Header analytics columns (all nullable) ─────────────────────
alter table public.vip_table_receipt_images
  add column if not exists authorization_code text,
  add column if not exists server_name        text,
  add column if not exists payment_method     text,
  add column if not exists subtotal_amount    numeric(12,2),
  add column if not exists tax_total          numeric(12,2),
  add column if not exists gratuity_amount    numeric(12,2),
  add column if not exists total_amount       numeric(12,2),
  add column if not exists ticket_code        text,
  add column if not exists merchant_name      text;

comment on column public.vip_table_receipt_images.authorization_code is
  'Phase F — payment authorization # parsed from receipt. Reserved for future cross-check with POS.';
comment on column public.vip_table_receipt_images.ticket_code is
  'Phase F — POS table/ticket id from receipt header. Distinct from receipt_code (POS-side trace id).';

-- ── 2. Per-line candidate table ────────────────────────────────────
create table if not exists public.vip_table_receipt_candidates (
  id                       uuid          primary key default gen_random_uuid(),
  receipt_image_id         uuid          not null references public.vip_table_receipt_images(id) on delete cascade,
  -- denormalized scope (so RLS + queue queries don't need a join chain)
  vip_table_id             uuid          not null references public.vip_tables(id) on delete restrict,
  night_id                 uuid          not null references public.nights(id)     on delete restrict,
  venue_id                 uuid          not null references public.venues(id)     on delete restrict,
  -- line ordering as observed in OCR (1-based)
  line_index               int           not null check (line_index > 0),
  raw_text                 text,                                -- original OCR line
  parsed_name              text,                                -- normalized name candidate
  parsed_qty               numeric(12,3),
  parsed_unit_price        numeric(12,2),
  parsed_line_total        numeric(12,2),
  parser_confidence        numeric(4,3),                        -- 0..1 LLM/parser self-rated
  -- match-engine output
  suggested_item_id        uuid          references public.items(id) on delete set null,
  match_score              numeric(4,3),                        -- 0..1 fuzzy score
  match_alternatives       jsonb         not null default '[]'::jsonb,
                                                                 -- [{item_id, score}] top N
  match_status             text          not null default 'unmatched'
                                          check (match_status in
                                            ('unmatched','suggested','confirmed','edited','ignored','merged')),
  -- review trail (per-line, in addition to the receipt-level review)
  reviewed_by              uuid          references auth.users(id) on delete set null,
  reviewed_at              timestamptz,
  review_notes             text,
  -- back-link to the committed row in vip_table_spend_items (after APPROVE)
  committed_spend_item_id  uuid          references public.vip_table_spend_items(id) on delete set null,
  created_at               timestamptz   not null default now()
);

comment on table public.vip_table_receipt_candidates is
  'Foundation phase — one row per parsed line from a receipt image. Populated by the AI parser (or operator paste). Operator reviews + approves → vip_table_spend_items rows are inserted, and committed_spend_item_id back-references the committed row.';
comment on column public.vip_table_receipt_candidates.match_alternatives is
  'Top-N fuzzy-match alternatives the JS matcher proposed: [{item_id: uuid, score: 0..1}]. Up to 3 entries.';
comment on column public.vip_table_receipt_candidates.match_status is
  'Per-line state. unmatched=no item picked. suggested=matcher proposed. confirmed=operator accepted suggestion. edited=operator edited name/qty/price. ignored=operator skipped this line. merged=combined with another candidate.';

create index if not exists idx_vtrc_image
  on public.vip_table_receipt_candidates (receipt_image_id, line_index);
create index if not exists idx_vtrc_table_night
  on public.vip_table_receipt_candidates (vip_table_id, night_id, created_at desc);
create index if not exists idx_vtrc_status
  on public.vip_table_receipt_candidates (match_status, created_at)
  where match_status in ('unmatched','suggested');
create index if not exists idx_vtrc_item
  on public.vip_table_receipt_candidates (suggested_item_id)
  where suggested_item_id is not null;

alter table public.vip_table_receipt_candidates enable row level security;

drop policy if exists vtrc_mgr_all on public.vip_table_receipt_candidates;
create policy vtrc_mgr_all on public.vip_table_receipt_candidates
  for all to authenticated
  using  (has_venue_access(venue_id, 'manager'))
  with check (has_venue_access(venue_id, 'manager'));

drop policy if exists vtrc_staff_read on public.vip_table_receipt_candidates;
create policy vtrc_staff_read on public.vip_table_receipt_candidates
  for select to authenticated
  using (has_venue_access(venue_id, 'staff'));;
