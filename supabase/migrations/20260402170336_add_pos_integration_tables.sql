
-- POS connection configs
CREATE TABLE IF NOT EXISTS public.pos_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  venue_id uuid NOT NULL REFERENCES public.venues(id),
  provider text NOT NULL DEFAULT 'square',
  connection_name text,
  config jsonb DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- POS bar mappings (Square location → BARINV bar)
CREATE TABLE IF NOT EXISTS public.pos_bar_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.pos_connections(id),
  pos_location_id text NOT NULL,
  pos_location_name text,
  bar_id uuid REFERENCES public.bars(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- POS bar snapshots (aggregated sales per bar per sync)
CREATE TABLE IF NOT EXISTS public.pos_bar_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.pos_connections(id),
  bar_id uuid REFERENCES public.bars(id),
  snapshot_ts timestamptz NOT NULL,
  bucket_minutes int NOT NULL DEFAULT 60,
  sales_gross numeric DEFAULT 0,
  sales_net numeric DEFAULT 0,
  tips_total numeric DEFAULT 0,
  cash_total numeric DEFAULT 0,
  card_total numeric DEFAULT 0,
  transactions int DEFAULT 0,
  discounts_total numeric DEFAULT 0,
  voids_total numeric DEFAULT 0,
  refunds_total numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- POS product snapshots (per-product sales per bar)
CREATE TABLE IF NOT EXISTS public.pos_bar_product_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.pos_connections(id),
  bar_id uuid REFERENCES public.bars(id),
  snapshot_ts timestamptz NOT NULL,
  bucket_minutes int NOT NULL DEFAULT 60,
  product_key text NOT NULL,
  product_name text,
  category text,
  qty numeric DEFAULT 0,
  revenue_net numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pos_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_bar_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_bar_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_bar_product_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS policies for authenticated users (org-scoped for connections)
CREATE POLICY "pos_connections_org" ON public.pos_connections
  FOR ALL USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- Service role / anon access for edge function writes
CREATE POLICY "pos_bar_mappings_read" ON public.pos_bar_mappings FOR SELECT USING (true);
CREATE POLICY "pos_bar_mappings_manage" ON public.pos_bar_mappings FOR ALL USING (true);
CREATE POLICY "pos_bar_snapshots_manage" ON public.pos_bar_snapshots FOR ALL USING (true);
CREATE POLICY "pos_bar_product_snapshots_manage" ON public.pos_bar_product_snapshots FOR ALL USING (true);
;
