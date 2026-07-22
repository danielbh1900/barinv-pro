
-- Add a bar_type column to classify bars vs items vs staff that got mixed in
ALTER TABLE public.bars ADD COLUMN IF NOT EXISTS bar_type text NOT NULL DEFAULT 'bar';
-- Mark known actual bars
UPDATE public.bars SET bar_type = 'bar' WHERE name IN ('Main Bar', 'Kitchen Bar', 'Wall Bar', 'Redbull Bar');
-- Deactivate entries that look like staff names (contain space and no product keywords)
UPDATE public.bars SET bar_type = 'staff', active = false 
WHERE name SIMILAR TO '%[a-z]% [A-Z][a-z]%'
AND name NOT IN ('Main Bar', 'Kitchen Bar', 'Wall Bar', 'Redbull Bar', 'Redbull Bar', 'Host 1', 'Saint-Louis')
AND name NOT LIKE '%Bar%';
-- Deactivate entries that look like product/item names  
UPDATE public.bars SET bar_type = 'item', active = false
WHERE name IN (
  'ACE','AZUL','BELVEDERE','BELVEDERE 1.14','Budweiser','BUDWEISER','Budweiser / Kokanee /24',
  'CASAMIGO REPOSADO','CASAMIGOS BLANCO','Cazadores','CRYSTAL','EL JIMADOR BLANCO','EL JIMADOR REPASADO',
  'Finlandia','Gordon''s','Gray Goose','GRAY GOOSE 1.140','GRAY GOOSE Magnum','GRAY GOOSE MAGNUME',
  'HENNESSY VS','IRISH','JAGERMEISTER','Jägermeister','JAMESON','MOEAT & ROSE','Moet Imperial',
  'PATRON SILVER','REDBULL CASE SF/R','REDBULL R/F 24','REDBULL R/F SINGLE','REDBULL SINGLE SF/R',
  'WATER','WATER 24','WATER case','WATER SINGLE 1'
);
;
