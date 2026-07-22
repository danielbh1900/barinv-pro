
-- Sequences
CREATE SEQUENCE IF NOT EXISTS bar_item_dispatch_snapshots_id_seq AS bigint START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS bar_item_shot_snapshots_id_seq AS bigint START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS pos_product_item_mappings_id_seq AS bigint START WITH 1 INCREMENT BY 1;

-- Tables
CREATE TABLE IF NOT EXISTS public.venues (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, name text NOT NULL, address text, phone text, logo_url text, currency text DEFAULT 'CAD'::text, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.profiles (id uuid NOT NULL PRIMARY KEY, username text NOT NULL, role text DEFAULT 'admin'::text NOT NULL, created_at timestamp with time zone DEFAULT now(), CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id));

CREATE TABLE IF NOT EXISTS public.bars (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, name text NOT NULL, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.stations (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, bar_id uuid NOT NULL REFERENCES public.bars(id), name text NOT NULL, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.items (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, name text NOT NULL, sku text, category text, unit text DEFAULT 'bottle'::text, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), par_level integer DEFAULT 0, cost_price numeric DEFAULT 0, sale_price numeric DEFAULT 0, supplier_id uuid, category_type text DEFAULT 'beverage'::text, unit_size text DEFAULT '750ml'::text, units_per_case integer DEFAULT 1, reorder_point integer DEFAULT 0, bottle_size_ml integer, service_mode text DEFAULT 'regular_bar'::text, full_shots numeric, shot_weight_g numeric DEFAULT 31.5, measurement_mode text DEFAULT 'shot'::text, restock_threshold_shots numeric DEFAULT 0 NOT NULL, empty_bottle_weight_g numeric, full_bottle_weight_g numeric, image_url text, liquor_room_stock integer DEFAULT 0, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.nights (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, name text NOT NULL, date date NOT NULL, code text NOT NULL, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.events (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, night_id uuid, bar_id uuid, station_id uuid, item_id uuid, submitted_by text NOT NULL, qty numeric DEFAULT 1, action text NOT NULL, status text DEFAULT 'PENDING'::text, notes text, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.placements (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, station_id uuid NOT NULL, item_id uuid NOT NULL, qty numeric DEFAULT 1 NOT NULL, bartender_id uuid, barback_id uuid, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.staff (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, name text NOT NULL, role text NOT NULL, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), legal_name text, email text, phone text, emergency_contact text, notes text, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.suppliers (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, name text NOT NULL, contact text, email text, phone text, address text, notes text, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.purchase_orders (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, supplier_id uuid, status text DEFAULT 'DRAFT'::text, po_number text, notes text, total_cost numeric DEFAULT 0, ordered_at timestamp with time zone, received_at timestamp with time zone, created_by text, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.po_items (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, po_id uuid, item_id uuid, quantity numeric NOT NULL, unit_cost numeric DEFAULT 0, total_cost numeric DEFAULT 0, received_qty numeric DEFAULT 0, notes text, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.invoices (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, supplier_id uuid, po_id uuid, invoice_number text, amount numeric DEFAULT 0, status text DEFAULT 'PENDING'::text, invoice_date date, due_date date, notes text, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.receipts (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, supplier_id uuid, vendor_name text, purchased_by text, receipt_date date, subtotal numeric DEFAULT 0, tax numeric DEFAULT 0, total numeric DEFAULT 0, image_data text, notes text, status text DEFAULT 'PENDING'::text, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.receipt_items (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, receipt_id uuid, item_name text, quantity numeric DEFAULT 1, unit_price numeric DEFAULT 0, total_price numeric DEFAULT 0, notes text, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.recipes (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, name text NOT NULL, category text, description text, yield_qty numeric DEFAULT 1, yield_unit text DEFAULT 'serving'::text, sale_price numeric DEFAULT 0, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.recipe_ingredients (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, recipe_id uuid, item_id uuid, quantity numeric NOT NULL, unit text DEFAULT 'ml'::text, notes text, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.guestlist (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, night_id uuid, name text NOT NULL, phone text, ticket_type text DEFAULT 'General'::text, notes text, checked_in boolean DEFAULT false, checked_in_at timestamp with time zone, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.business_profile (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, business_name text DEFAULT 'My Business'::text, business_type text DEFAULT 'bar'::text, currency text DEFAULT 'CAD'::text, timezone text DEFAULT 'America/Vancouver'::text, logo_url text, address text, settings jsonb DEFAULT '{}'::jsonb, updated_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.warehouse_items (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, category text DEFAULT 'Other'::text NOT NULL, brand text NOT NULL, size text, unit text DEFAULT 'ml'::text, stock numeric DEFAULT 0, min_stock integer DEFAULT 0, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.warehouse_transfers (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, item_id uuid, quantity numeric NOT NULL, destination text, created_by text, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.vip_tables (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, night_id uuid, table_name text NOT NULL, guest_name text, server_name text, minimum_spend numeric DEFAULT 0 NOT NULL, deposit_paid numeric DEFAULT 0 NOT NULL, actual_spend numeric DEFAULT 0 NOT NULL, comps numeric DEFAULT 0 NOT NULL, discounts numeric DEFAULT 0 NOT NULL, notes text, is_closed boolean DEFAULT false NOT NULL, closed_at timestamp with time zone, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, booked_by text DEFAULT ''::text, venue_id uuid);

-- POS tables
CREATE TABLE IF NOT EXISTS public.pos_connections (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, business_id uuid, provider text NOT NULL, name text NOT NULL, is_active boolean DEFAULT true NOT NULL, config jsonb DEFAULT '{}'::jsonb NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.pos_bar_mappings (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, connection_id uuid NOT NULL, pos_location_id text NOT NULL, pos_location_name text, bar_id uuid NOT NULL, is_active boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.pos_bar_snapshots (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, connection_id uuid NOT NULL, bar_id uuid NOT NULL, snapshot_ts timestamp with time zone NOT NULL, bucket_minutes integer DEFAULT 1 NOT NULL, sales_gross numeric DEFAULT 0 NOT NULL, sales_net numeric DEFAULT 0 NOT NULL, tips_total numeric DEFAULT 0 NOT NULL, cash_total numeric DEFAULT 0 NOT NULL, card_total numeric DEFAULT 0 NOT NULL, transactions integer DEFAULT 0 NOT NULL, discounts_total numeric DEFAULT 0 NOT NULL, voids_total numeric DEFAULT 0 NOT NULL, refunds_total numeric DEFAULT 0 NOT NULL, currency text DEFAULT 'CAD'::text, source_ref jsonb DEFAULT '{}'::jsonb NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.pos_bar_product_snapshots (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, connection_id uuid NOT NULL, bar_id uuid NOT NULL, snapshot_ts timestamp with time zone NOT NULL, bucket_minutes integer DEFAULT 1 NOT NULL, product_key text NOT NULL, product_name text NOT NULL, category text, qty numeric DEFAULT 0 NOT NULL, revenue_net numeric DEFAULT 0 NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.pos_product_item_mappings (id bigint DEFAULT nextval('pos_product_item_mappings_id_seq'::regclass) NOT NULL PRIMARY KEY, connection_id uuid NOT NULL, product_key text NOT NULL, product_name text NOT NULL, inventory_item_id uuid NOT NULL, usage_mode text DEFAULT 'shot'::text NOT NULL, shots_per_sale numeric DEFAULT 0 NOT NULL, ml_per_sale numeric DEFAULT 0 NOT NULL, units_per_sale numeric DEFAULT 0 NOT NULL, is_active boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.pos_source_map (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, provider text DEFAULT 'square'::text NOT NULL, location_id text NOT NULL, square_source_key text NOT NULL, square_source_label text, local_bar_code text NOT NULL, local_bar_name text, active boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.pos_sync_runs (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, connection_id uuid NOT NULL, started_at timestamp with time zone DEFAULT now() NOT NULL, ended_at timestamp with time zone, status text DEFAULT 'running'::text NOT NULL, range_start timestamp with time zone, range_end timestamp with time zone, cursor text, metrics jsonb DEFAULT '{}'::jsonb NOT NULL, error_message text, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.pos_transactions (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, provider text DEFAULT 'square'::text NOT NULL, square_payment_id text NOT NULL, square_order_id text, location_id text NOT NULL, source_key text, source_label text, local_bar_code text, amount_cents integer DEFAULT 0 NOT NULL, tip_cents integer DEFAULT 0 NOT NULL, cash_cents integer DEFAULT 0 NOT NULL, card_cents integer DEFAULT 0 NOT NULL, status text, paid_at timestamp with time zone, raw jsonb, created_at timestamp with time zone DEFAULT now(), venue_id uuid);

CREATE TABLE IF NOT EXISTS public.bar_close_summaries (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, night_id uuid, bar_id uuid NOT NULL, connection_id uuid, closed_at timestamp with time zone DEFAULT now() NOT NULL, sales_gross numeric DEFAULT 0 NOT NULL, sales_net numeric DEFAULT 0 NOT NULL, tips_total numeric DEFAULT 0 NOT NULL, cash_total numeric DEFAULT 0 NOT NULL, card_total numeric DEFAULT 0 NOT NULL, transactions integer DEFAULT 0 NOT NULL, discounts_total numeric DEFAULT 0 NOT NULL, voids_total numeric DEFAULT 0 NOT NULL, refunds_total numeric DEFAULT 0 NOT NULL, currency text DEFAULT 'CAD'::text, notes text, source_ref jsonb DEFAULT '{}'::jsonb NOT NULL, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.bar_item_dispatch_snapshots (id bigint DEFAULT nextval('bar_item_dispatch_snapshots_id_seq'::regclass) NOT NULL PRIMARY KEY, connection_id uuid, bar_id uuid NOT NULL, item_id uuid NOT NULL, snapshot_ts timestamp with time zone NOT NULL, bucket_minutes integer DEFAULT 60 NOT NULL, bottles_sent numeric DEFAULT 0 NOT NULL, shots_sent numeric DEFAULT 0 NOT NULL, ml_sent numeric DEFAULT 0 NOT NULL, units_sent numeric DEFAULT 0 NOT NULL, source text DEFAULT 'dispatch'::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, venue_id uuid);

CREATE TABLE IF NOT EXISTS public.bar_item_shot_snapshots (id bigint DEFAULT nextval('bar_item_shot_snapshots_id_seq'::regclass) NOT NULL PRIMARY KEY, connection_id uuid, bar_id uuid NOT NULL, item_id uuid NOT NULL, snapshot_ts timestamp with time zone NOT NULL, bucket_minutes integer DEFAULT 60 NOT NULL, bottles_sent numeric DEFAULT 0 NOT NULL, full_shots_per_bottle numeric DEFAULT 0 NOT NULL, total_shots_sent numeric DEFAULT 0 NOT NULL, shots_sold numeric DEFAULT 0 NOT NULL, expected_shots_remaining numeric DEFAULT 0 NOT NULL, expected_bottles_remaining numeric DEFAULT 0 NOT NULL, expected_grams_remaining numeric DEFAULT 0 NOT NULL, restock_threshold_shots numeric DEFAULT 0 NOT NULL, restock_needed boolean DEFAULT false NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, venue_id uuid);
;
