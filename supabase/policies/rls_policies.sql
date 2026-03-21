-- ============================================================
-- RLS Policies — All Tables
-- Rule: UI-only gating is never enough. RLS is the real guard.
-- ============================================================
-- Conventions used:
--   auth.uid()           → current Supabase auth user ID
--   is_org_member()      → user belongs to the organization
--   get_user_role()      → returns the user's role for a venue
--   has_role_or_above()  → role hierarchy check
-- ============================================================

-- ─────────────────────────────────────────
-- HELPER FUNCTIONS
-- ─────────────────────────────────────────

-- Returns the organization_id for the current authenticated user.
create or replace function public.get_user_org_id()
returns uuid language sql security definer stable as $$
  select organization_id from public.profiles where id = auth.uid() limit 1;
$$;

-- Returns true if the current user belongs to the given organization.
create or replace function public.is_org_member(org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and organization_id = org_id and active = true
  );
$$;

-- Returns the user's role for a specific venue.
create or replace function public.get_venue_role(v_venue_id uuid)
returns public.user_role language sql security definer stable as $$
  select role from public.venue_users
  where user_id = auth.uid() and venue_id = v_venue_id and active = true
  limit 1;
$$;

-- Returns true if the user's role for a venue is >= the minimum role.
-- Role hierarchy: owner > admin > co_admin > manager > finance > bartender > barback > door > promoter
create or replace function public.has_min_role(v_venue_id uuid, min_role public.user_role)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.venue_users
    where user_id = auth.uid()
      and venue_id = v_venue_id
      and active = true
      and case min_role
            when 'owner'     then role = 'owner'
            when 'admin'     then role in ('owner','admin')
            when 'co_admin'  then role in ('owner','admin','co_admin')
            when 'manager'   then role in ('owner','admin','co_admin','manager')
            when 'finance'   then role in ('owner','admin','co_admin','manager','finance')
            when 'bartender' then role in ('owner','admin','co_admin','manager','finance','bartender')
            when 'barback'   then role in ('owner','admin','co_admin','manager','finance','bartender','barback')
            when 'door'      then role in ('owner','admin','co_admin','manager','finance','bartender','barback','door')
            when 'promoter'  then true
          end
  );
$$;

-- Returns true if the user is Owner or Admin (org-level privileged roles).
create or replace function public.is_org_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.venue_users vu
    join public.profiles p on p.id = auth.uid()
    where vu.user_id = auth.uid()
      and vu.organization_id = p.organization_id
      and vu.role in ('owner','admin')
      and vu.active = true
    limit 1
  );
$$;

-- ─────────────────────────────────────────
-- ENABLE RLS ON ALL TABLES
-- ─────────────────────────────────────────

alter table public.organizations          enable row level security;
alter table public.venues                 enable row level security;
alter table public.profiles               enable row level security;
alter table public.venue_users            enable row level security;
alter table public.role_permissions       enable row level security;
alter table public.organization_settings  enable row level security;
alter table public.feature_flags          enable row level security;
alter table public.units                  enable row level security;
alter table public.items                  enable row level security;
alter table public.item_uom_conversions   enable row level security;
alter table public.bars                   enable row level security;
alter table public.stations               enable row level security;
alter table public.nights                 enable row level security;
alter table public.placements             enable row level security;
alter table public.events                 enable row level security;
alter table public.activity_log           enable row level security;
alter table public.warehouse_stock        enable row level security;
alter table public.stock_movements        enable row level security;
alter table public.stock_transfers        enable row level security;
alter table public.stock_adjustments      enable row level security;
alter table public.inventory_snapshots    enable row level security;
alter table public.count_sessions         enable row level security;
alter table public.count_entries          enable row level security;
alter table public.par_rules              enable row level security;
alter table public.waste_log              enable row level security;
alter table public.suppliers              enable row level security;
alter table public.supplier_contacts      enable row level security;
alter table public.purchase_orders        enable row level security;
alter table public.po_items               enable row level security;
alter table public.invoices               enable row level security;
alter table public.invoice_items          enable row level security;
alter table public.reorder_rules          enable row level security;
alter table public.cost_snapshots         enable row level security;
alter table public.recipes                enable row level security;
alter table public.recipe_ingredients     enable row level security;
alter table public.ticket_classes         enable row level security;
alter table public.guestlist_nights       enable row level security;
alter table public.promoters              enable row level security;
alter table public.guestlist_entries      enable row level security;
alter table public.promoter_guest_entries enable row level security;
alter table public.door_checkins          enable row level security;
alter table public.client_operations      enable row level security;
alter table public.device_sessions        enable row level security;
alter table public.offline_queue_status   enable row level security;
alter table public.sync_conflicts         enable row level security;
alter table public.audit_log              enable row level security;
alter table public.attachments            enable row level security;

-- ─────────────────────────────────────────
-- ORGANIZATIONS
-- ─────────────────────────────────────────

create policy "org_select_own"
  on public.organizations for select
  using (is_org_member(id));

-- Only system/Edge Functions insert organizations (no client insert policy).
-- No update or delete from client.

-- ─────────────────────────────────────────
-- VENUES
-- ─────────────────────────────────────────

create policy "venues_select_own_org"
  on public.venues for select
  using (is_org_member(organization_id));

create policy "venues_insert_org_admin"
  on public.venues for insert
  with check (is_org_member(organization_id) and is_org_admin());

create policy "venues_update_org_admin"
  on public.venues for update
  using (is_org_member(organization_id) and is_org_admin());

-- No venue delete from client.

-- ─────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────

create policy "profiles_select_own_org"
  on public.profiles for select
  using (organization_id = get_user_org_id());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid());

-- ─────────────────────────────────────────
-- VENUE_USERS
-- ─────────────────────────────────────────

create policy "venue_users_select_own_org"
  on public.venue_users for select
  using (organization_id = get_user_org_id());

create policy "venue_users_insert_org_admin"
  on public.venue_users for insert
  with check (organization_id = get_user_org_id() and is_org_admin());

create policy "venue_users_update_org_admin"
  on public.venue_users for update
  using (organization_id = get_user_org_id() and is_org_admin());

create policy "venue_users_delete_org_admin"
  on public.venue_users for delete
  using (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- ROLE_PERMISSIONS
-- ─────────────────────────────────────────

create policy "role_permissions_select_own_org"
  on public.role_permissions for select
  using (organization_id = get_user_org_id());

create policy "role_permissions_write_org_admin"
  on public.role_permissions for all
  using (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- ORGANIZATION_SETTINGS
-- ─────────────────────────────────────────

create policy "org_settings_select_own_org"
  on public.organization_settings for select
  using (organization_id = get_user_org_id());

create policy "org_settings_write_org_admin"
  on public.organization_settings for all
  using (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- FEATURE_FLAGS
-- ─────────────────────────────────────────

create policy "feature_flags_select_org_member"
  on public.feature_flags for select
  using (organization_id = get_user_org_id());

create policy "feature_flags_write_org_admin"
  on public.feature_flags for all
  using (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- UNITS
-- ─────────────────────────────────────────

create policy "units_select_own_org"
  on public.units for select
  using (organization_id = get_user_org_id());

create policy "units_insert_manager"
  on public.units for insert
  with check (organization_id = get_user_org_id() and is_org_admin());

create policy "units_update_manager"
  on public.units for update
  using (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- ITEMS
-- ─────────────────────────────────────────

create policy "items_select_own_org"
  on public.items for select
  using (organization_id = get_user_org_id());

create policy "items_insert_admin"
  on public.items for insert
  with check (organization_id = get_user_org_id() and is_org_admin());

create policy "items_update_admin"
  on public.items for update
  using (organization_id = get_user_org_id() and is_org_admin());

-- No hard delete on items. Use deleted_at.

-- ─────────────────────────────────────────
-- ITEM_UOM_CONVERSIONS
-- ─────────────────────────────────────────

create policy "uom_select_own_org"
  on public.item_uom_conversions for select
  using (organization_id = get_user_org_id());

create policy "uom_write_admin"
  on public.item_uom_conversions for all
  using (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- BARS
-- ─────────────────────────────────────────

create policy "bars_select_venue_member"
  on public.bars for select
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = bars.venue_id and active = true
    )
  );

create policy "bars_write_admin"
  on public.bars for all
  using (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- STATIONS
-- ─────────────────────────────────────────

create policy "stations_select_venue_member"
  on public.stations for select
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = stations.venue_id and active = true
    )
  );

create policy "stations_write_admin"
  on public.stations for all
  using (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- NIGHTS
-- ─────────────────────────────────────────

create policy "nights_select_venue_member"
  on public.nights for select
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = nights.venue_id and active = true
    )
  );

create policy "nights_insert_manager"
  on public.nights for insert
  with check (
    organization_id = get_user_org_id()
    and has_min_role(venue_id, 'manager')
  );

create policy "nights_update_manager"
  on public.nights for update
  using (
    organization_id = get_user_org_id()
    and has_min_role(venue_id, 'manager')
  );

-- ─────────────────────────────────────────
-- PLACEMENTS
-- ─────────────────────────────────────────

create policy "placements_select_venue_member"
  on public.placements for select
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = placements.venue_id and active = true
    )
  );

create policy "placements_write_manager"
  on public.placements for all
  using (
    organization_id = get_user_org_id()
    and has_min_role(venue_id, 'manager')
  );

-- ─────────────────────────────────────────
-- EVENTS
-- ─────────────────────────────────────────

create policy "events_select_venue_member"
  on public.events for select
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = events.venue_id and active = true
    )
  );

create policy "events_insert_bartender"
  on public.events for insert
  with check (
    organization_id = get_user_org_id()
    and has_min_role(venue_id, 'bartender')
    and submitted_by = auth.uid()
  );

-- Only manager+ can approve/reject (update status)
create policy "events_update_manager"
  on public.events for update
  using (
    organization_id = get_user_org_id()
    and has_min_role(venue_id, 'manager')
  );

-- ─────────────────────────────────────────
-- ACTIVITY_LOG
-- ─────────────────────────────────────────

create policy "activity_log_select_venue_member"
  on public.activity_log for select
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = activity_log.venue_id and active = true
    )
  );

create policy "activity_log_insert_any_member"
  on public.activity_log for insert
  with check (
    organization_id = get_user_org_id()
    and actor_id = auth.uid()
  );

-- No update or delete on activity_log.

-- ─────────────────────────────────────────
-- WAREHOUSE TABLES (warehouse_stock, stock_movements,
-- stock_transfers, stock_adjustments, inventory_snapshots,
-- count_sessions, count_entries, par_rules, waste_log)
-- Only manager+ can write. All venue members can read.
-- ─────────────────────────────────────────

create policy "wstock_select_venue_member"
  on public.warehouse_stock for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = warehouse_stock.venue_id and active = true)
  );

create policy "wstock_write_manager"
  on public.warehouse_stock for all
  using (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

create policy "smov_select_venue_member"
  on public.stock_movements for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = stock_movements.venue_id and active = true)
  );

-- stock_movements is write-once (no update/delete policies)
create policy "smov_insert_manager"
  on public.stock_movements for insert
  with check (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

create policy "stransfer_select_venue_member"
  on public.stock_transfers for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = stock_transfers.venue_id and active = true)
  );

create policy "stransfer_insert_manager"
  on public.stock_transfers for insert
  with check (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

create policy "sadj_select_venue_member"
  on public.stock_adjustments for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = stock_adjustments.venue_id and active = true)
  );

create policy "sadj_insert_manager"
  on public.stock_adjustments for insert
  with check (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

create policy "isnap_select_venue_member"
  on public.inventory_snapshots for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = inventory_snapshots.venue_id and active = true)
  );

create policy "isnap_insert_manager"
  on public.inventory_snapshots for insert
  with check (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

create policy "csess_select_venue_member"
  on public.count_sessions for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = count_sessions.venue_id and active = true)
  );

create policy "csess_write_bartender"
  on public.count_sessions for all
  using (organization_id = get_user_org_id() and has_min_role(venue_id, 'bartender'));

create policy "centry_select_venue_member"
  on public.count_entries for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = count_entries.venue_id and active = true)
  );

create policy "centry_write_bartender"
  on public.count_entries for all
  using (organization_id = get_user_org_id() and has_min_role(venue_id, 'bartender'));

create policy "par_select_venue_member"
  on public.par_rules for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = par_rules.venue_id and active = true)
  );

create policy "par_write_manager"
  on public.par_rules for all
  using (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

create policy "waste_select_venue_member"
  on public.waste_log for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = waste_log.venue_id and active = true)
  );

create policy "waste_insert_bartender"
  on public.waste_log for insert
  with check (organization_id = get_user_org_id() and has_min_role(venue_id, 'bartender'));

-- ─────────────────────────────────────────
-- FINANCE TABLES (suppliers, purchase_orders, etc.)
-- Finance role and manager+ can read. Finance+admin can write.
-- ─────────────────────────────────────────

create policy "suppliers_select_finance"
  on public.suppliers for select
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid()
        and organization_id = suppliers.organization_id
        and role in ('owner','admin','co_admin','manager','finance')
        and active = true
    )
  );

create policy "suppliers_write_admin"
  on public.suppliers for all
  using (organization_id = get_user_org_id() and is_org_admin());

create policy "supplier_contacts_select_finance"
  on public.supplier_contacts for select
  using (organization_id = get_user_org_id());

create policy "supplier_contacts_write_admin"
  on public.supplier_contacts for all
  using (organization_id = get_user_org_id() and is_org_admin());

create policy "po_select_finance"
  on public.purchase_orders for select
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = purchase_orders.venue_id
        and role in ('owner','admin','co_admin','manager','finance') and active = true
    )
  );

create policy "po_write_admin"
  on public.purchase_orders for all
  using (organization_id = get_user_org_id() and is_org_admin());

create policy "po_items_select"
  on public.po_items for select
  using (organization_id = get_user_org_id());

create policy "po_items_write_admin"
  on public.po_items for all
  using (organization_id = get_user_org_id() and is_org_admin());

create policy "invoices_select_finance"
  on public.invoices for select
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = invoices.venue_id
        and role in ('owner','admin','co_admin','manager','finance') and active = true
    )
  );

create policy "invoices_write_admin_finance"
  on public.invoices for all
  using (
    organization_id = get_user_org_id()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = invoices.venue_id
        and role in ('owner','admin','co_admin','finance') and active = true
    )
  );

create policy "invoice_items_select"
  on public.invoice_items for select
  using (organization_id = get_user_org_id());

create policy "invoice_items_write"
  on public.invoice_items for all
  using (organization_id = get_user_org_id() and is_org_admin());

create policy "reorder_select_finance"
  on public.reorder_rules for select
  using (organization_id = get_user_org_id());

create policy "reorder_write_admin"
  on public.reorder_rules for all
  using (organization_id = get_user_org_id() and is_org_admin());

create policy "cost_snapshots_select_finance"
  on public.cost_snapshots for select
  using (organization_id = get_user_org_id());

-- cost_snapshots are insert-only; no update/delete.
create policy "cost_snapshots_insert_admin"
  on public.cost_snapshots for insert
  with check (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- RECIPES
-- ─────────────────────────────────────────

create policy "recipes_select_own_org"
  on public.recipes for select
  using (organization_id = get_user_org_id());

create policy "recipes_write_admin"
  on public.recipes for all
  using (organization_id = get_user_org_id() and is_org_admin());

create policy "recipe_ing_select_own_org"
  on public.recipe_ingredients for select
  using (organization_id = get_user_org_id());

create policy "recipe_ing_write_admin"
  on public.recipe_ingredients for all
  using (organization_id = get_user_org_id() and is_org_admin());

-- ─────────────────────────────────────────
-- GUESTLIST TABLES
-- Promoters see only their own entries.
-- Door sees all entries for active night.
-- Manager+ sees everything.
-- ─────────────────────────────────────────

create policy "ticket_classes_select_venue_member"
  on public.ticket_classes for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = ticket_classes.venue_id and active = true)
  );

create policy "ticket_classes_write_admin"
  on public.ticket_classes for all
  using (organization_id = get_user_org_id() and is_org_admin());

create policy "guestlist_nights_select_venue_member"
  on public.guestlist_nights for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = guestlist_nights.venue_id and active = true)
  );

create policy "guestlist_nights_write_manager"
  on public.guestlist_nights for all
  using (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

create policy "promoters_select_venue_member"
  on public.promoters for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = promoters.venue_id and active = true)
  );

create policy "promoters_write_manager"
  on public.promoters for all
  using (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

-- Guestlist entries: promoters see only their own
create policy "gl_entries_select_own_promoter"
  on public.guestlist_entries for select
  using (
    organization_id = get_user_org_id()
    and (
      -- manager+ sees all
      has_min_role(venue_id, 'manager')
      -- door sees all for their venue
      or exists (
        select 1 from public.venue_users
        where user_id = auth.uid() and venue_id = guestlist_entries.venue_id
          and role in ('door') and active = true
      )
      -- promoter sees only their entries
      or exists (
        select 1 from public.promoters p
        where p.user_id = auth.uid() and p.id = guestlist_entries.promoter_id
      )
    )
  );

create policy "gl_entries_insert_promoter"
  on public.guestlist_entries for insert
  with check (
    organization_id = get_user_org_id()
    and (
      has_min_role(venue_id, 'manager')
      or exists (
        select 1 from public.promoters p
        where p.user_id = auth.uid() and p.id = guestlist_entries.promoter_id
      )
    )
  );

create policy "gl_entries_update_manager"
  on public.guestlist_entries for update
  using (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

create policy "pge_select"
  on public.promoter_guest_entries for select
  using (organization_id = get_user_org_id());

create policy "pge_write_manager"
  on public.promoter_guest_entries for all
  using (organization_id = get_user_org_id() and has_min_role(
    (select venue_id from public.promoters where id = promoter_guest_entries.promoter_id limit 1),
    'manager'
  ));

create policy "door_checkins_select_venue_member"
  on public.door_checkins for select
  using (
    organization_id = get_user_org_id()
    and exists (select 1 from public.venue_users where user_id = auth.uid() and venue_id = door_checkins.venue_id and active = true)
  );

-- Door role and manager+ can insert checkins
create policy "door_checkins_insert_door"
  on public.door_checkins for insert
  with check (
    organization_id = get_user_org_id()
    and checked_in_by = auth.uid()
    and exists (
      select 1 from public.venue_users
      where user_id = auth.uid() and venue_id = door_checkins.venue_id
        and role in ('owner','admin','co_admin','manager','door') and active = true
    )
  );

-- ─────────────────────────────────────────
-- OFFLINE / DEVICE TABLES
-- ─────────────────────────────────────────

create policy "cop_select_own"
  on public.client_operations for select
  using (organization_id = get_user_org_id() and user_id = auth.uid());

create policy "cop_insert_own"
  on public.client_operations for insert
  with check (organization_id = get_user_org_id() and user_id = auth.uid());

-- client_operations are write-once; no update/delete.

create policy "dses_select_own"
  on public.device_sessions for select
  using (organization_id = get_user_org_id() and user_id = auth.uid());

create policy "dses_write_own"
  on public.device_sessions for all
  using (organization_id = get_user_org_id() and user_id = auth.uid());

create policy "oqs_select_own"
  on public.offline_queue_status for select
  using (organization_id = get_user_org_id() and user_id = auth.uid());

create policy "oqs_write_own"
  on public.offline_queue_status for all
  using (organization_id = get_user_org_id() and user_id = auth.uid());

-- Sync conflicts: manager+ can read and update (resolve)
create policy "sc_select_manager"
  on public.sync_conflicts for select
  using (
    organization_id = get_user_org_id()
    and has_min_role(venue_id, 'manager')
  );

create policy "sc_insert_system"
  on public.sync_conflicts for insert
  with check (organization_id = get_user_org_id());

create policy "sc_update_manager"
  on public.sync_conflicts for update
  using (organization_id = get_user_org_id() and has_min_role(venue_id, 'manager'));

-- ─────────────────────────────────────────
-- AUDIT_LOG
-- INSERT: any authenticated org member (for UI-sourced audits).
-- Server-side audits written via Edge Function (service role, bypasses RLS).
-- UPDATE and DELETE: NEVER ALLOWED. No policy = blocked.
-- ─────────────────────────────────────────

create policy "audit_log_select_admin"
  on public.audit_log for select
  using (
    organization_id = get_user_org_id()
    and is_org_admin()
  );

create policy "audit_log_insert_org_member"
  on public.audit_log for insert
  with check (
    organization_id = get_user_org_id()
    and actor_user_id = auth.uid()
  );

-- No UPDATE policy on audit_log.
-- No DELETE policy on audit_log.
-- These are intentionally absent — RLS blocks them by default.

-- ─────────────────────────────────────────
-- ATTACHMENTS
-- ─────────────────────────────────────────

create policy "attachments_select_org_member"
  on public.attachments for select
  using (organization_id = get_user_org_id());

create policy "attachments_insert_org_member"
  on public.attachments for insert
  with check (
    organization_id = get_user_org_id()
    and uploaded_by = auth.uid()
  );

-- Soft delete only (deleted_at). No hard delete policy.
