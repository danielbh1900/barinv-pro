CREATE TABLE performance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  night_id uuid NOT NULL REFERENCES nights(id),
  staff_id uuid NOT NULL REFERENCES profiles(id),
  score numeric(5,2),
  total_variance_pct numeric(5,2),
  drinks_served integer,
  calculated_at timestamptz DEFAULT now()
);

ALTER TABLE performance_scores ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_perf_scores_night ON performance_scores(night_id);
CREATE INDEX idx_perf_scores_staff ON performance_scores(staff_id);;
