begin;

drop view if exists public.v_recon_vip_pos_candidates cascade;
create view public.v_recon_vip_pos_candidates
  with (security_invoker = true) as
with vip as (
  select t.id as vip_table_id, t.venue_id, t.night_id, t.table_name, t.server_name,
         coalesce(t.actual_spend, 0) as vip_total, t.closed_at, t.is_closed
  from public.vip_tables t
  where t.is_closed = true and t.actual_spend is not null
), pos as (
  select p.id as pos_transaction_id, p.venue_id, n.id as night_id,
         (p.amount_cents::numeric / 100.0) as pos_total, p.paid_at,
         p.source_label, p.square_order_id, p.status
  from public.pos_transactions p
  join public.nights n on n.venue_id = p.venue_id
   and p.paid_at >= n.created_at
   and p.paid_at  < n.created_at + interval '36 hours'
  where p.status in ('completed','captured','paid','closed')
), paired as (
  select v.vip_table_id, v.venue_id, v.night_id, v.table_name, v.server_name, v.vip_total, v.closed_at,
         p.pos_transaction_id, p.pos_total, p.paid_at, p.source_label, p.square_order_id,
         abs(v.vip_total - p.pos_total) as amount_delta,
         case when v.vip_total > 0 then abs(v.vip_total - p.pos_total) / v.vip_total else null end as amount_delta_pct,
         extract(epoch from (p.paid_at - v.closed_at))::int as time_delta_sec
  from vip v
  join pos p on p.venue_id = v.venue_id and p.night_id = v.night_id
  where abs(extract(epoch from (p.paid_at - v.closed_at))) < 1800
)
select
  vip_table_id, venue_id, night_id, table_name, server_name, vip_total, closed_at,
  pos_transaction_id, pos_total, paid_at, source_label, square_order_id,
  amount_delta, amount_delta_pct, time_delta_sec,
  case
    when amount_delta < 0.51 and abs(time_delta_sec) <= 300  then 0.95
    when amount_delta < 1.01 and abs(time_delta_sec) <= 600  then 0.88
    when amount_delta < 5.01 and abs(time_delta_sec) <= 900  then 0.75
    when amount_delta_pct is not null and amount_delta_pct < 0.02 and abs(time_delta_sec) <= 1200 then 0.65
    when amount_delta_pct is not null and amount_delta_pct < 0.05 and abs(time_delta_sec) <= 1800 then 0.45
    else 0.25
  end as confidence,
  jsonb_build_object(
    'amount_delta', amount_delta,
    'amount_delta_pct', amount_delta_pct,
    'time_delta_sec', time_delta_sec,
    'square_order_id', square_order_id
  ) as signals
from paired;

drop view if exists public.v_recon_unmatched_vip_tables cascade;
create view public.v_recon_unmatched_vip_tables
  with (security_invoker = true) as
select t.id as vip_table_id, t.venue_id, t.night_id, t.table_name, t.server_name,
       t.actual_spend, t.closed_at,
       (select count(*) from public.vip_table_spend_entries e
         where e.vip_table_id = t.id and e.voided = false) as entry_count
from public.vip_tables t
where t.is_closed = true
  and t.actual_spend > 0
  and not exists (
    select 1 from public.reconciliation_links l
    where l.left_kind = 'vip_table' and l.left_id = t.id
      and l.right_kind = 'pos_transaction'
      and l.link_type = 'confirmed'
  );

drop view if exists public.v_recon_unmatched_pos cascade;
create view public.v_recon_unmatched_pos
  with (security_invoker = true) as
select p.id as pos_transaction_id, p.venue_id,
       (p.amount_cents::numeric / 100.0) as pos_total,
       p.paid_at, p.source_label, p.square_order_id, p.status,
       n.id as night_id
from public.pos_transactions p
left join public.nights n on n.venue_id = p.venue_id
      and p.paid_at >= n.created_at
      and p.paid_at  < n.created_at + interval '36 hours'
where p.status in ('completed','captured','paid','closed')
  and not exists (
    select 1 from public.reconciliation_links l
    where l.right_kind = 'pos_transaction' and l.right_id = p.id
      and l.link_type in ('confirmed','candidate')
  );

drop view if exists public.v_recon_duplicate_receipt_suspicion cascade;
create view public.v_recon_duplicate_receipt_suspicion
  with (security_invoker = true) as
select
  a.id as left_receipt_id, b.id as right_receipt_id,
  a.venue_id, a.night_id, a.vip_table_id,
  a.total_amount as left_total, b.total_amount as right_total,
  abs(a.total_amount - b.total_amount) as amount_delta,
  extract(epoch from (b.created_at - a.created_at))::int as time_delta_sec,
  a.ticket_code as left_ticket, b.ticket_code as right_ticket,
  a.authorization_code as left_auth, b.authorization_code as right_auth,
  case
    when a.authorization_code is not null and a.authorization_code = b.authorization_code then 0.99
    when a.ticket_code is not null and a.ticket_code = b.ticket_code then 0.95
    when abs(a.total_amount - b.total_amount) < 0.01 and abs(extract(epoch from (b.created_at - a.created_at))) < 1800 then 0.80
    else 0.50
  end as confidence
from public.vip_table_receipt_images a
join public.vip_table_receipt_images b
  on a.venue_id = b.venue_id
 and a.vip_table_id = b.vip_table_id
 and a.id < b.id
 and abs(extract(epoch from (b.created_at - a.created_at))) < 21600
where a.total_amount is not null and b.total_amount is not null
  and (
        (a.authorization_code is not null and a.authorization_code = b.authorization_code)
     or (a.ticket_code is not null and a.ticket_code = b.ticket_code)
     or abs(a.total_amount - b.total_amount) < 1.00
  );

drop view if exists public.v_recon_premium_movement cascade;
create view public.v_recon_premium_movement
  with (security_invoker = true) as
select
  pr.venue_id, i.id as item_id, i.name as item_name, i.sku, pr.tier,
  n.id as night_id, n.date as night_date,
  coalesce(sum(si.qty), 0) as vip_qty,
  coalesce(sum(si.line_total), 0) as vip_total,
  count(distinct si.spend_entry_id) as vip_entry_count,
  count(distinct si.vip_table_id)  as vip_table_count
from public.premium_bottle_registry pr
join public.items i on i.id = pr.item_id
join public.nights n on n.venue_id = pr.venue_id and n.active = true
left join public.vip_table_spend_items si
  on si.venue_id = pr.venue_id and si.night_id = n.id and si.item_id  = pr.item_id
where pr.active = true
group by pr.venue_id, i.id, i.name, i.sku, pr.tier, n.id, n.date;

drop view if exists public.v_recon_anomaly_summary cascade;
create view public.v_recon_anomaly_summary
  with (security_invoker = true) as
select venue_id, night_id, anomaly_type, severity,
       count(*) as open_count,
       max(detected_at) as last_detected_at
from public.reconciliation_anomalies
where status = 'open'
group by venue_id, night_id, anomaly_type, severity;

commit;;
