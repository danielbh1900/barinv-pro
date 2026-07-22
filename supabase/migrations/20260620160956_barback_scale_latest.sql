
-- Ephemeral latest scale weight per (venue, night), for the Scale Bridge polling
-- fallback. Written/read ONLY by the barback-scale-bridge Edge function (service
-- role). RLS enabled with NO policies → anon/barback clients cannot touch it.
create table if not exists public.barback_scale_latest (
  venue_id           uuid        not null,
  night_id           uuid        not null,
  station_id         text        not null,
  grams              numeric     not null,
  stable             boolean     not null default false,
  decoder_confidence text,
  range_mode         text,
  raw_hex            text,
  updated_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  primary key (venue_id, night_id)
);

alter table public.barback_scale_latest enable row level security;

create index if not exists barback_scale_latest_expires_idx
  on public.barback_scale_latest (expires_at);
;
