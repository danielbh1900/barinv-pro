-- Add station/area type classification to bars.
-- Open-ended text (no CHECK) so admin-defined custom types are allowed.
-- Default 'bar' so every existing row keeps current report behavior.
ALTER TABLE public.bars
  ADD COLUMN IF NOT EXISTS bar_type text NOT NULL DEFAULT 'bar';

COMMENT ON COLUMN public.bars.bar_type IS
  'Station classification. Built-in values: bar, vip, table, bottle_service, stockroom, other. Admin can also store custom string values.';;
