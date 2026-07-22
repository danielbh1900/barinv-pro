
-- VIP POS Paid Order → Liquor Room Fulfillment — Phase A0.
-- Additive only; no changes to pos_transactions, events, vip_tables,
-- vip_table_groups, vip_table_group_members, vip_table_spend_entries,
-- items, bars, nights, venues. See
-- supabase/migrations/20260505_vip_pos_fulfillment_phase_a0.sql for
-- the full rationale + verification queries.

CREATE TABLE IF NOT EXISTS public.vip_pos_fulfillment_tasks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id               uuid NOT NULL REFERENCES public.venues(id)            ON DELETE RESTRICT,
  night_id               uuid NOT NULL REFERENCES public.nights(id)            ON DELETE RESTRICT,
  vip_table_id           uuid          REFERENCES public.vip_tables(id)        ON DELETE RESTRICT,
  vip_table_group_id     uuid          REFERENCES public.vip_table_groups(id)  ON DELETE RESTRICT,
  pos_provider           text CHECK (pos_provider IN ('square','manual')),
  pos_transaction_id     uuid          REFERENCES public.pos_transactions(id)  ON DELETE RESTRICT,
  pos_order_id           text,
  pos_payment_id         text,
  pos_receipt_number     text,
  pos_paid_amount_cents  integer NOT NULL DEFAULT 0,
  pos_paid_at            timestamptz,
  pos_paid_status        text,
  matched_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  matched_at             timestamptz,
  match_method           text CHECK (
                           match_method IS NULL
                           OR match_method IN
                              ('manual','suggested_accepted','auto_payment_id','auto_receipt_code')
                         ),
  fulfillment_status     text NOT NULL DEFAULT 'MANUAL_PAID'
                              CHECK (fulfillment_status IN (
                                'POS_PAID','MANUAL_PAID','MATCHED_TO_TABLE',
                                'READY_FOR_LIQUOR_ROOM','PREPARING','PREPARED','CANCELLED'
                              )),
  preparing_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  preparing_at           timestamptz,
  prepared_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prepared_at            timestamptz,
  cancelled_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at           timestamptz,
  cancel_reason          text,
  notes                  text,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vptf_destination_or_unmatched CHECK (
    fulfillment_status IN ('POS_PAID','MANUAL_PAID','CANCELLED')
    OR vip_table_id IS NOT NULL
    OR vip_table_group_id IS NOT NULL
  ),
  CONSTRAINT vptf_match_audit_required CHECK (
    fulfillment_status IN ('POS_PAID','MANUAL_PAID','CANCELLED')
    OR (matched_by IS NOT NULL AND matched_at IS NOT NULL AND match_method IS NOT NULL)
  ),
  CONSTRAINT vptf_preparing_audit_required CHECK (
    fulfillment_status NOT IN ('PREPARING','PREPARED')
    OR (preparing_by IS NOT NULL AND preparing_at IS NOT NULL)
  ),
  CONSTRAINT vptf_prepared_audit_required CHECK (
    fulfillment_status <> 'PREPARED'
    OR (prepared_by IS NOT NULL AND prepared_at IS NOT NULL)
  ),
  CONSTRAINT vptf_cancel_consistency CHECK (
    (fulfillment_status <> 'CANCELLED'
       AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR
    (fulfillment_status = 'CANCELLED' AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vptf_night_status
  ON public.vip_pos_fulfillment_tasks (night_id, fulfillment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vptf_table
  ON public.vip_pos_fulfillment_tasks (vip_table_id, created_at DESC)
  WHERE vip_table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vptf_group
  ON public.vip_pos_fulfillment_tasks (vip_table_group_id, created_at DESC)
  WHERE vip_table_group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vptf_payment_per_venue
  ON public.vip_pos_fulfillment_tasks (venue_id, pos_payment_id)
  WHERE pos_payment_id IS NOT NULL AND fulfillment_status <> 'CANCELLED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_vptf_order_per_venue
  ON public.vip_pos_fulfillment_tasks (venue_id, pos_order_id)
  WHERE pos_order_id IS NOT NULL AND fulfillment_status <> 'CANCELLED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_vptf_receipt_per_venue_night
  ON public.vip_pos_fulfillment_tasks (venue_id, night_id, pos_receipt_number)
  WHERE pos_receipt_number IS NOT NULL AND fulfillment_status <> 'CANCELLED';

ALTER TABLE public.vip_pos_fulfillment_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vptf_mgr_all     ON public.vip_pos_fulfillment_tasks;
CREATE POLICY vptf_mgr_all ON public.vip_pos_fulfillment_tasks
  FOR ALL TO authenticated
  USING  (has_venue_access(venue_id, 'manager'))
  WITH CHECK (has_venue_access(venue_id, 'manager'));

DROP POLICY IF EXISTS vptf_staff_read  ON public.vip_pos_fulfillment_tasks;
CREATE POLICY vptf_staff_read ON public.vip_pos_fulfillment_tasks
  FOR SELECT TO authenticated
  USING (has_venue_access(venue_id, 'staff'));

CREATE TABLE IF NOT EXISTS public.vip_table_receipt_attachments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id               uuid NOT NULL REFERENCES public.venues(id)                     ON DELETE RESTRICT,
  night_id               uuid NOT NULL REFERENCES public.nights(id)                     ON DELETE RESTRICT,
  fulfillment_task_id    uuid NOT NULL REFERENCES public.vip_pos_fulfillment_tasks(id)  ON DELETE RESTRICT,
  vip_table_id           uuid          REFERENCES public.vip_tables(id)                 ON DELETE RESTRICT,
  vip_table_group_id     uuid          REFERENCES public.vip_table_groups(id)           ON DELETE RESTRICT,
  attachment_type        text NOT NULL CHECK (attachment_type IN ('photo','manual_note')),
  image_path             text,
  notes                  text,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vtra_task
  ON public.vip_table_receipt_attachments (fulfillment_task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vtra_night
  ON public.vip_table_receipt_attachments (night_id, created_at DESC);

ALTER TABLE public.vip_table_receipt_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtra_mgr_all    ON public.vip_table_receipt_attachments;
CREATE POLICY vtra_mgr_all ON public.vip_table_receipt_attachments
  FOR ALL TO authenticated
  USING  (has_venue_access(venue_id, 'manager'))
  WITH CHECK (has_venue_access(venue_id, 'manager'));

DROP POLICY IF EXISTS vtra_staff_read ON public.vip_table_receipt_attachments;
CREATE POLICY vtra_staff_read ON public.vip_table_receipt_attachments
  FOR SELECT TO authenticated
  USING (has_venue_access(venue_id, 'staff'));
;
