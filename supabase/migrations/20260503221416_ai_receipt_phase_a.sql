-- AI Receipt Receiving Phase A — additive only.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS image_path        text,
  ADD COLUMN IF NOT EXISTS image_hash        text,
  ADD COLUMN IF NOT EXISTS currency          text,
  ADD COLUMN IF NOT EXISTS bottle_deposit    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discounts         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fees              numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total       numeric,
  ADD COLUMN IF NOT EXISTS payment_method    text,
  ADD COLUMN IF NOT EXISTS confidence        numeric,
  ADD COLUMN IF NOT EXISTS confirmed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS extraction_id     uuid;

COMMENT ON COLUMN public.receipts.image_path IS
  'Storage path inside private bucket purchase-receipts (replaces base64 in image_data for the new flow).';
COMMENT ON COLUMN public.receipts.image_hash IS
  'sha256(image bytes); used for duplicate detection by the Edge Function.';

CREATE INDEX IF NOT EXISTS idx_receipts_status      ON public.receipts (status);
CREATE INDEX IF NOT EXISTS idx_receipts_image_hash  ON public.receipts (image_hash) WHERE image_hash IS NOT NULL;

ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS item_id              uuid REFERENCES public.items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_item_id    uuid REFERENCES public.items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_description      text,
  ADD COLUMN IF NOT EXISTS unit_size            text,
  ADD COLUMN IF NOT EXISTS package_size         text,
  ADD COLUMN IF NOT EXISTS tax_included         boolean,
  ADD COLUMN IF NOT EXISTS deposit_included     boolean,
  ADD COLUMN IF NOT EXISTS confidence           numeric,
  ADD COLUMN IF NOT EXISTS needs_review         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS line_status          text NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_receipt_items_item_id   ON public.receipt_items (item_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_needs_rev ON public.receipt_items (needs_review) WHERE needs_review;

CREATE TABLE IF NOT EXISTS public.receipt_extractions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id        uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  venue_id          uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  ai_provider       text NOT NULL,
  ai_model          text NOT NULL,
  raw_response      jsonb NOT NULL,
  parsed_response   jsonb,
  corrected_json    jsonb,
  validation_errors jsonb,
  confidence        numeric,
  warnings          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_extractions_provider_check
    CHECK (ai_provider IN ('openai','claude'))
);
CREATE INDEX IF NOT EXISTS idx_re_receipt_id ON public.receipt_extractions (receipt_id);
CREATE INDEX IF NOT EXISTS idx_re_venue_id   ON public.receipt_extractions (venue_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE c.conname = 'receipts_extraction_id_fkey'
      AND n.nspname = 'public'
      AND cl.relname = 'receipts'
  ) THEN
    ALTER TABLE public.receipts
      ADD CONSTRAINT receipts_extraction_id_fkey
        FOREIGN KEY (extraction_id)
        REFERENCES public.receipt_extractions(id)
        ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.vendor_sku_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  supplier_id         uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  vendor_description  text NOT NULL,
  item_id             uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vsm_unique_per_vendor
    UNIQUE (venue_id, supplier_id, vendor_description)
);
CREATE INDEX IF NOT EXISTS idx_vsm_venue_supplier ON public.vendor_sku_mappings (venue_id, supplier_id);

ALTER TABLE public.receipt_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_sku_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS re_mgr_all ON public.receipt_extractions;
CREATE POLICY re_mgr_all ON public.receipt_extractions
  FOR ALL TO authenticated
  USING (has_venue_access(venue_id, 'manager'))
  WITH CHECK (has_venue_access(venue_id, 'manager'));

DROP POLICY IF EXISTS vsm_mgr_all ON public.vendor_sku_mappings;
CREATE POLICY vsm_mgr_all ON public.vendor_sku_mappings
  FOR ALL TO authenticated
  USING (has_venue_access(venue_id, 'manager'))
  WITH CHECK (has_venue_access(venue_id, 'manager'));;
