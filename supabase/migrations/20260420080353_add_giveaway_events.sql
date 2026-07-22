-- Phase 1 giveaway event support
-- Adds reason_code + qty_basis columns, a partial index, and tightens RLS so
-- only manager+ users (not scoped bartender/barback) can insert giveaway
-- actions (COMP, SHOT, PROMO, WASTE, BREAKAGE).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS reason_code TEXT;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS qty_basis TEXT
  CHECK (qty_basis IS NULL OR qty_basis IN ('shot','item_unit'));

CREATE INDEX IF NOT EXISTS idx_events_giveaway
  ON public.events (venue_id, night_id, action)
  WHERE action IN ('COMP','SHOT','PROMO','WASTE','BREAKAGE');

-- Tighten admin/non-scoped insert: staff+ for normal actions, manager+ for giveaways.
ALTER POLICY events_insert_v ON public.events
  WITH CHECK (
    public.has_venue_access(venue_id, 'staff')
    AND (
      action NOT IN ('COMP','SHOT','PROMO','WASTE','BREAKAGE')
      OR public.has_venue_access(venue_id, 'manager')
    )
  );

-- Scoped bartender/barback accounts: explicitly blocked from writing giveaways.
ALTER POLICY events_staff_insert ON public.events
  WITH CHECK (
    public.auth_is_scoped_staff()
    AND (venue_id = public.auth_scoped_venue())
    AND (night_id = public.auth_scoped_night())
    AND (bar_id = ANY (public.auth_scoped_bar_ids()))
    AND action NOT IN ('COMP','SHOT','PROMO','WASTE','BREAKAGE')
  );;
