-- BARINV — Reconciliation Intelligence Foundation (2026-05-17)
-- Additive-only intelligence layer between POS / VIP / INV pillars.

begin;

create table if not exists public.reconciliation_links (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references public.venues(id) on delete cascade,
  night_id        uuid references public.nights(id) on delete set null,
  left_kind       text not null check (left_kind in (
                    'vip_table','vip_spend_entry','vip_spend_item',
                    'receipt_image','receipt_candidate',
                    'pos_transaction','item','dispatch_event')),
  left_id         uuid not null,
  right_kind      text not null check (right_kind in (
                    'vip_table','vip_spend_entry','vip_spend_item',
                    'receipt_image','receipt_candidate',
                    'pos_transaction','item','dispatch_event')),
  right_id        uuid not null,
  confidence      numeric(5,4) check (confidence >= 0 and confidence <= 1),
  signals         jsonb default '{}'::jsonb,
  link_type       text default 'candidate' check (link_type in
                    ('candidate','confirmed','rejected','suspected_duplicate')),
  detector        text,
  created_at      timestamptz default now(),
  created_by      uuid,
  decided_at      timestamptz,
  decided_by      uuid,
  decision_notes  text,
  unique (left_kind, left_id, right_kind, right_id)
);
create index if not exists idx_recon_links_venue_night on public.reconciliation_links(venue_id, night_id);
create index if not exists idx_recon_links_left  on public.reconciliation_links(left_kind, left_id);
create index if not exists idx_recon_links_right on public.reconciliation_links(right_kind, right_id);
create index if not exists idx_recon_links_open  on public.reconciliation_links(venue_id, link_type) where link_type in ('candidate','suspected_duplicate');
alter table public.reconciliation_links enable row level security;
drop policy if exists recon_links_mgr_all on public.reconciliation_links;
create policy recon_links_mgr_all on public.reconciliation_links
  for all using (public.has_venue_access(venue_id, 'manager'))
           with check (public.has_venue_access(venue_id, 'manager'));
drop policy if exists recon_links_staff_read on public.reconciliation_links;
create policy recon_links_staff_read on public.reconciliation_links
  for select using (public.has_venue_access(venue_id, 'viewer'));

create table if not exists public.reconciliation_anomalies (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references public.venues(id) on delete cascade,
  night_id        uuid references public.nights(id) on delete set null,
  anomaly_type    text not null check (anomaly_type in (
                    'vip_without_pos','pos_without_vip',
                    'duplicate_receipt_suspicion',
                    'premium_dispatched_unsold','premium_sold_undispatched',
                    'high_value_unmatched','amount_mismatch_vip_pos',
                    'manual_edit_excess','missing_return','comp_excess',
                    'untracked_premium_movement')),
  severity        text not null default 'medium' check (severity in
                    ('low','medium','high','critical')),
  subject_kind    text,
  subject_id      uuid,
  related         jsonb default '{}'::jsonb,
  evidence        jsonb default '{}'::jsonb,
  confidence      numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  explanation     text,
  detector        text,
  status          text not null default 'open' check (status in
                    ('open','acknowledged','dismissed','resolved')),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_by     uuid,
  resolved_at     timestamptz,
  resolution_notes text,
  detected_at     timestamptz default now(),
  detected_value  numeric,
  expected_value  numeric
);
create index if not exists idx_recon_anom_venue_night on public.reconciliation_anomalies(venue_id, night_id);
create index if not exists idx_recon_anom_status on public.reconciliation_anomalies(venue_id, status, severity);
create index if not exists idx_recon_anom_type   on public.reconciliation_anomalies(venue_id, anomaly_type);
create index if not exists idx_recon_anom_subject on public.reconciliation_anomalies(subject_kind, subject_id);
alter table public.reconciliation_anomalies enable row level security;
drop policy if exists recon_anom_mgr_all on public.reconciliation_anomalies;
create policy recon_anom_mgr_all on public.reconciliation_anomalies
  for all using (public.has_venue_access(venue_id, 'manager'))
           with check (public.has_venue_access(venue_id, 'manager'));
drop policy if exists recon_anom_staff_read on public.reconciliation_anomalies;
create policy recon_anom_staff_read on public.reconciliation_anomalies
  for select using (public.has_venue_access(venue_id, 'viewer'));

create table if not exists public.reconciliation_audit_log (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  night_id      uuid references public.nights(id) on delete set null,
  actor_id      uuid,
  actor_label   text,
  action        text not null,
  subject_kind  text,
  subject_id    uuid,
  before_value  jsonb,
  after_value   jsonb,
  reason        text,
  source        text default 'app',
  created_at    timestamptz default now()
);
create index if not exists idx_recon_audit_venue_night on public.reconciliation_audit_log(venue_id, night_id, created_at desc);
create index if not exists idx_recon_audit_subject on public.reconciliation_audit_log(subject_kind, subject_id, created_at desc);
create index if not exists idx_recon_audit_actor on public.reconciliation_audit_log(actor_id, created_at desc);
alter table public.reconciliation_audit_log enable row level security;
drop policy if exists recon_audit_mgr_read on public.reconciliation_audit_log;
create policy recon_audit_mgr_read on public.reconciliation_audit_log
  for select using (public.has_venue_access(venue_id, 'manager'));
drop policy if exists recon_audit_mgr_insert on public.reconciliation_audit_log;
create policy recon_audit_mgr_insert on public.reconciliation_audit_log
  for insert with check (public.has_venue_access(venue_id, 'viewer'));

create table if not exists public.premium_bottle_registry (
  id                          uuid primary key default gen_random_uuid(),
  venue_id                    uuid not null references public.venues(id) on delete cascade,
  item_id                     uuid not null references public.items(id) on delete cascade,
  tier                        text default 'high_premium' check (tier in
                                ('standard_premium','high_premium','ultra_premium')),
  unit_price_threshold        numeric,
  require_dispatch_match      boolean default true,
  require_pos_match           boolean default true,
  require_return_tracking     boolean default true,
  max_comps_per_night         integer,
  max_manual_edits_per_night  integer default 2,
  notes                       text,
  active                      boolean default true,
  created_by                  uuid,
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now(),
  unique (venue_id, item_id)
);
create index if not exists idx_premium_reg_venue_active on public.premium_bottle_registry(venue_id) where active = true;
alter table public.premium_bottle_registry enable row level security;
drop policy if exists premium_reg_mgr_all on public.premium_bottle_registry;
create policy premium_reg_mgr_all on public.premium_bottle_registry
  for all using (public.has_venue_access(venue_id, 'manager'))
           with check (public.has_venue_access(venue_id, 'manager'));
drop policy if exists premium_reg_staff_read on public.premium_bottle_registry;
create policy premium_reg_staff_read on public.premium_bottle_registry
  for select using (public.has_venue_access(venue_id, 'viewer'));

commit;;
