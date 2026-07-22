
-- VIP table positions for floor plan
ALTER TABLE public.vip_tables ADD COLUMN IF NOT EXISTS position_x numeric DEFAULT 0;
ALTER TABLE public.vip_tables ADD COLUMN IF NOT EXISTS position_y numeric DEFAULT 0;
ALTER TABLE public.vip_tables ADD COLUMN IF NOT EXISTS table_shape text DEFAULT 'round';
ALTER TABLE public.vip_tables ADD COLUMN IF NOT EXISTS table_seats integer DEFAULT 4;

-- Guest CRM table
CREATE TABLE IF NOT EXISTS public.guests (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  phone text,
  email text,
  instagram text,
  notes text,
  tags text[] DEFAULT '{}',
  total_visits integer DEFAULT 0,
  total_spend numeric DEFAULT 0,
  avg_spend numeric DEFAULT 0,
  last_visit_at timestamp with time zone,
  vip_level text DEFAULT 'regular',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  venue_id uuid
);

-- Guest bookings table  
CREATE TABLE IF NOT EXISTS public.guest_bookings (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  guest_id uuid REFERENCES public.guests(id),
  night_id uuid,
  vip_table_id uuid,
  party_size integer DEFAULT 1,
  status text DEFAULT 'confirmed',
  arrival_time text,
  special_requests text,
  spend numeric DEFAULT 0,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  venue_id uuid
);

-- Indexes
CREATE INDEX idx_guests_venue ON public.guests USING btree (venue_id);
CREATE INDEX idx_guests_name ON public.guests USING btree (name);
CREATE INDEX idx_guest_bookings_venue ON public.guest_bookings USING btree (venue_id);
CREATE INDEX idx_guest_bookings_night ON public.guest_bookings USING btree (night_id);
CREATE INDEX idx_guest_bookings_guest ON public.guest_bookings USING btree (guest_id);

-- RLS
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON public.guests FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "admin_all" ON public.guest_bookings FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
;
