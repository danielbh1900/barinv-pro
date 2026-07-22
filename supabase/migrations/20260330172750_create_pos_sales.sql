CREATE TABLE pos_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  night_id uuid REFERENCES nights(id),
  bar_id uuid REFERENCES bars(id),
  recipe_id uuid REFERENCES recipes(id),
  item_id uuid REFERENCES items(id),
  quantity integer DEFAULT 1,
  price numeric(10,2),
  staff_id uuid REFERENCES profiles(id),
  pos_transaction_id text,
  source text DEFAULT 'manual',
  client_operation_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE pos_sales ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_pos_sales_night ON pos_sales(night_id);
CREATE INDEX idx_pos_sales_bar ON pos_sales(bar_id);
CREATE INDEX idx_pos_sales_recipe ON pos_sales(recipe_id);;
