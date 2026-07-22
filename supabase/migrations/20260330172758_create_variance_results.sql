CREATE TABLE variance_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  night_id uuid NOT NULL REFERENCES nights(id),
  bar_id uuid REFERENCES bars(id),
  item_id uuid NOT NULL REFERENCES items(id),
  expected_usage_grams numeric(10,2),
  actual_usage_grams numeric(10,2),
  variance_grams numeric(10,2),
  variance_pct numeric(5,2),
  calculated_at timestamptz DEFAULT now()
);

ALTER TABLE variance_results ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_variance_results_night ON variance_results(night_id);
CREATE INDEX idx_variance_results_item ON variance_results(item_id);;
