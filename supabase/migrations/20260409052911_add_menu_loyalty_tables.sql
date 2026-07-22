
-- Digital menu settings
CREATE TABLE IF NOT EXISTS public.menu_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  venue_id uuid,
  title text DEFAULT 'Our Menu',
  subtitle text,
  logo_url text,
  theme text DEFAULT 'dark',
  show_prices boolean DEFAULT true,
  show_categories boolean DEFAULT true,
  footer_text text,
  active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Menu items (which inventory items appear on public menu)
CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  item_id uuid REFERENCES public.items(id),
  venue_id uuid,
  display_name text,
  description text,
  menu_category text,
  display_order integer DEFAULT 0,
  featured boolean DEFAULT false,
  visible boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- Loyalty program
CREATE TABLE IF NOT EXISTS public.loyalty_config (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  venue_id uuid,
  points_per_dollar numeric DEFAULT 1,
  tier_silver integer DEFAULT 500,
  tier_gold integer DEFAULT 2000,
  tier_platinum integer DEFAULT 5000,
  reward_rules jsonb DEFAULT '[]',
  active boolean DEFAULT true,
  updated_at timestamp with time zone DEFAULT now()
);

-- Loyalty points ledger
CREATE TABLE IF NOT EXISTS public.loyalty_points (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  guest_id uuid REFERENCES public.guests(id),
  venue_id uuid,
  points integer NOT NULL,
  reason text NOT NULL,
  booking_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

-- Indexes
CREATE INDEX idx_menu_items_venue ON public.menu_items USING btree (venue_id);
CREATE INDEX idx_menu_items_item ON public.menu_items USING btree (item_id);
CREATE INDEX idx_loyalty_points_guest ON public.loyalty_points USING btree (guest_id);
CREATE INDEX idx_loyalty_points_venue ON public.loyalty_points USING btree (venue_id);

-- RLS
ALTER TABLE public.menu_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_points ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "admin_all" ON public.menu_settings FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "admin_all" ON public.menu_items FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "admin_all" ON public.loyalty_config FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "admin_all" ON public.loyalty_points FOR ALL TO public USING ((auth.role() = 'authenticated'::text));

-- Public read for menu (guests can see menu without auth)
CREATE POLICY "anon_read_menu_settings" ON public.menu_settings FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_menu_items" ON public.menu_items FOR SELECT TO anon USING (true);
;
