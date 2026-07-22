ALTER TABLE items ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS size_ml integer;
ALTER TABLE items ADD COLUMN IF NOT EXISTS density_factor numeric(4,3) DEFAULT 0.94;
ALTER TABLE items ADD COLUMN IF NOT EXISTS tare_weight_grams numeric(8,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS shot_weight_grams numeric(8,2) DEFAULT 30;
ALTER TABLE items ADD COLUMN IF NOT EXISTS full_shots numeric(8,2);;
