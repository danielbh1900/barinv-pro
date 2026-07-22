
CREATE TABLE vip_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  night_id uuid REFERENCES nights(id),
  name text NOT NULL,
  guest_name text,
  booked_by text,
  min_spend numeric(10,2) DEFAULT 0,
  deposit_paid numeric(10,2) DEFAULT 0,
  actual_spend numeric(10,2) DEFAULT 0,
  comps numeric(10,2) DEFAULT 0,
  discounts numeric(10,2) DEFAULT 0,
  server_id uuid REFERENCES profiles(id),
  status text DEFAULT 'open' CHECK (status IN ('open','seated','closed','cancelled')),
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vip_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vip_tables_select_venue_member" ON vip_tables
  FOR SELECT USING (
    organization_id = get_user_org_id()
    AND EXISTS (SELECT 1 FROM venue_users WHERE user_id = auth.uid() AND venue_id = vip_tables.venue_id AND active = true)
  );

CREATE POLICY "vip_tables_write_manager" ON vip_tables
  FOR ALL USING (
    organization_id = get_user_org_id()
    AND has_min_role(venue_id, 'manager'::user_role)
  );

CREATE INDEX idx_vip_tables_night ON vip_tables(night_id);
CREATE INDEX idx_vip_tables_venue ON vip_tables(venue_id);
;
