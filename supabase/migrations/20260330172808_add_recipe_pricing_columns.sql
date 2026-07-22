ALTER TABLE recipes ADD COLUMN IF NOT EXISTS menu_price numeric(10,2);
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS garnish_cost numeric(10,2) DEFAULT 0;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS glassware_cost numeric(10,2) DEFAULT 0;
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS pour_grams numeric(8,2);
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS is_primary boolean DEFAULT true;;
