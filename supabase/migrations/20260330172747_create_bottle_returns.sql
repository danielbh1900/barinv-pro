CREATE TABLE bottle_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  night_id uuid REFERENCES nights(id),
  bar_id uuid REFERENCES bars(id),
  item_id uuid NOT NULL REFERENCES items(id),
  returned_by uuid REFERENCES profiles(id),
  weight_grams numeric(8,2) NOT NULL,
  tare_weight_grams numeric(8,2),
  net_liquid_grams numeric(8,2) GENERATED ALWAYS AS (weight_grams - COALESCE(tare_weight_grams, 0)) STORED,
  client_operation_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bottle_returns ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_bottle_returns_night ON bottle_returns(night_id);
CREATE INDEX idx_bottle_returns_bar ON bottle_returns(bar_id);
CREATE INDEX idx_bottle_returns_item ON bottle_returns(item_id);;
