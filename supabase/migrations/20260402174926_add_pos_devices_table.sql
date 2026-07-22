
-- POS device/terminal mapping: each physical Square terminal → a BARINV bar
CREATE TABLE IF NOT EXISTS public.pos_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.pos_connections(id),
  device_id text NOT NULL,
  device_name text,
  bar_id uuid REFERENCES public.bars(id),
  bartender_name text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id, device_id)
);

ALTER TABLE public.pos_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pos_devices_manage" ON public.pos_devices FOR ALL USING (true);

-- Also add device_id to snapshots so we can track per-device sales
ALTER TABLE public.pos_bar_snapshots ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.pos_bar_snapshots ADD COLUMN IF NOT EXISTS device_name text;
ALTER TABLE public.pos_bar_product_snapshots ADD COLUMN IF NOT EXISTS device_id text;
;
