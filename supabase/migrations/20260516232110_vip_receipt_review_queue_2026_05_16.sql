-- BARINV — VIP Receipt Review Queue (Phase B foundation)
-- Additive: adds ocr_confidence + review_outcome + computed-state view.
-- Existing receipt-photo save path keeps working unchanged.

alter table public.vip_table_receipt_images
  add column if not exists ocr_confidence  numeric(4,3),
  add column if not exists review_outcome  text;

alter table public.vip_table_receipt_images
  drop constraint if exists vtri_review_outcome_known;
alter table public.vip_table_receipt_images
  add constraint vtri_review_outcome_known
  check (review_outcome is null or review_outcome in ('approved','rejected'));

comment on column public.vip_table_receipt_images.ocr_confidence is
  'Phase B — OCR provider self-rated confidence (0.000..1.000). Surfaced in the review UI as a badge.';
comment on column public.vip_table_receipt_images.review_outcome is
  'Phase B — set when a manager approves or rejects the review. NULL while pending. Pairs with review_required (which flips to false once the row is reviewed either way).';

-- Computed processing-state view. Aggregates ocr_status + ai_parse_status
-- + review_outcome into a single text state that the queue UI can read.
create or replace view public.v_vip_receipt_review_queue as
select
  r.id,
  r.spend_entry_id,
  r.vip_table_id,
  r.night_id,
  r.venue_id,
  r.storage_path,
  r.image_filename,
  r.mime_type,
  r.byte_size,
  r.created_at,
  r.receipt_code,
  r.note,
  r.ocr_status,
  r.ocr_text,
  r.ocr_provider,
  r.ocr_completed_at,
  r.ocr_confidence,
  r.ai_parse_status,
  r.ai_parse_json,
  r.ai_provider,
  r.ai_confidence,
  r.ai_completed_at,
  r.review_required,
  r.review_outcome,
  r.reviewed_by,
  r.reviewed_at,
  r.review_notes,
  case
    when r.review_outcome = 'approved'              then 'approved'
    when r.review_outcome = 'rejected'              then 'rejected'
    when r.ocr_status = 'failed'                    then 'ocr_failed'
    when r.ocr_status = 'processing'                then 'ocr_running'
    when r.ocr_status = 'pending'                   then 'awaiting_ocr'
    when r.ai_parse_status = 'failed'               then 'ai_failed'
    when r.ai_parse_status = 'processing'           then 'ai_parsing'
    when r.ai_parse_status = 'done'
         and r.review_required = true               then 'ready_for_review'
    when r.ai_parse_status = 'pending'
         and r.ocr_status = 'done'                  then 'awaiting_ai'
    when r.ocr_status = 'skipped'
         and r.ai_parse_status = 'skipped'          then 'manual_only'
    else 'unknown'
  end                                               as processing_state,
  t.table_name,
  n.name                                            as night_name,
  e.amount                                          as parent_amount
from public.vip_table_receipt_images r
left join public.vip_tables t on t.id = r.vip_table_id
left join public.nights     n on n.id = r.night_id
left join public.vip_table_spend_entries e on e.id = r.spend_entry_id;

comment on view public.v_vip_receipt_review_queue is
  'Phase B — receipt review queue. Computes processing_state from ocr_status + ai_parse_status + review_outcome. Joined with vip_tables, nights, and the parent ledger row for the queue UI.';

alter view public.v_vip_receipt_review_queue set (security_invoker = true);
grant select on public.v_vip_receipt_review_queue to authenticated;;
