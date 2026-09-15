'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260915160000_pending_event_correction_rpc.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `missing marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `missing marker: ${end}`);
  return source.slice(a, b);
}

const guard = between(
  sql,
  'CREATE OR REPLACE FUNCTION public.barinv_events_guard_protected_update()',
  'CREATE OR REPLACE FUNCTION public.barinv_correct_pending_event(',
);
const rpc = between(
  sql,
  'CREATE OR REPLACE FUNCTION public.barinv_correct_pending_event(',
  "NOTIFY pgrst, 'reload schema';",
);

test('global immutability remains and authenticated receives no direct qty grant', () => {
  assert.match(guard, /RAISE EXCEPTION[\s\S]*Submitted Event protected fields are immutable/);
  assert.match(guard, /v_role = 'service_role'/);
  assert.doesNotMatch(sql, /DROP TRIGGER[^;]*trg_events_guard_protected_update/i);
  assert.doesNotMatch(sql, /GRANT\s+UPDATE\s*\([^)]*qty/i);
  assert.doesNotMatch(sql, /GRANT\s+UPDATE\s+ON\s+(TABLE\s+)?public\.events/i);
});

test('narrow trigger path requires exact same-transaction audit authorization', () => {
  assert.match(guard, /current_setting\('barinv\.pending_event_correction_token', true\)/);
  assert.match(guard, /OLD\.status = 'PENDING'/);
  assert.match(guard, /NEW\.status = 'PENDING'/);
  assert.match(guard, /FROM public\.event_correction_audit AS a/);
  assert.match(guard, /a\.transaction_id = txid_current\(\)/);
  for (const predicate of [
    'a.event_id = OLD.id',
    'a.venue_id = OLD.venue_id',
    'a.actor_user_id = auth.uid()',
    'a.old_qty IS NOT DISTINCT FROM OLD.qty',
    'a.new_qty IS NOT DISTINCT FROM NEW.qty',
    'a.old_notes IS NOT DISTINCT FROM OLD.notes',
    'a.new_notes IS NOT DISTINCT FROM NEW.notes',
  ]) assert.ok(guard.includes(predicate), `missing guard predicate: ${predicate}`);
});

test('RPC is authenticated, manager-only, venue-scoped, and locks one Event', () => {
  assert.match(rpc, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(rpc, /v_actor uuid := auth\.uid\(\)/);
  assert.match(rpc, /public\.has_venue_access\(p_venue_id, 'manager'\)/);
  assert.match(rpc, /WHERE e\.id = p_event_id\s+AND e\.venue_id = p_venue_id\s+FOR UPDATE;/);
  assert.match(rpc, /IF v_event\.status <> 'PENDING'/);
  assert.match(rpc, /Event not found in this Venue/);
  assert.match(rpc, /Event is no longer PENDING/);
});

test('RPC validates mode, positive integer quantity, and finite positive weight', () => {
  assert.match(rpc, /v_mode NOT IN \('QUANTITY', 'WEIGHT'\)/);
  assert.match(rpc, /p_qty IS NULL/);
  assert.match(rpc, /p_qty < 1/);
  assert.match(rpc, /p_qty <> trunc\(p_qty\)/);
  assert.match(rpc, /p_qty::text IN \('NaN', 'Infinity', '-Infinity'\)/);
  assert.match(rpc, /v_mode = 'QUANTITY' AND p_weight_g IS NOT NULL/);
  assert.match(rpc, /p_weight_g IS NULL/);
  assert.match(rpc, /p_weight_g <= 0/);
  assert.match(rpc, /p_weight_g::text IN \('NaN', 'Infinity', '-Infinity'\)/);
});

test('Quantity mode strips every scale tag while preserving all other text', () => {
  const tags = [
    'WEIGHT_G', 'BOTTLE_STATE', 'TARE_WEIGHT_G', 'FULL_WEIGHT_G',
    'REMAINING_PERCENT', 'LIQUID_WEIGHT_G', 'REMAINING_ML',
    'WEIGHT_PROFILE_SOURCE', 'WEIGHT_PROFILE_NEEDED', 'MEASUREMENT_SOURCE',
    'BARBACK_WEIGHT_MVP',
  ];
  for (const tag of tags) assert.match(rpc, new RegExp(`\\b${tag}\\b`));
  assert.match(rpc, /regexp_replace\([\s\S]*COALESCE\(v_event\.notes, ''\)[\s\S]*'g'/);
  assert.match(rpc, /regexp_replace\(v_new_notes, '\[\[:space:\]\]\+', ' ', 'g'\)/);
  assert.doesNotMatch(rpc, /SOME_TAG/);
});

test('Weight mode removes duplicate WEIGHT_G tags and appends one normalized tag', () => {
  assert.match(rpc, /'\\\[WEIGHT_G=\(\[\^\]\]\*\)\\\]'/);
  assert.match(rpc, /'g'\s*\);/);
  assert.match(rpc, /rtrim\(rtrim\(v_weight_text, '0'\), '\.'\)/);
  assert.match(rpc, /'\[WEIGHT_G=' \|\| v_weight_text \|\| '\]'/);
  assert.equal((rpc.match(/BOTTLE_STATE/g) || []).length, 1,
    'Weight branch must not strip or synthesize BOTTLE_STATE');
});

test('RPC mutates only qty and notes with redundant venue/PENDING guards', () => {
  const updates = [...rpc.matchAll(/UPDATE public\.events AS e[\s\S]*?RETURNING e\.id INTO v_updated_id;/g)];
  assert.equal(updates.length, 1);
  const update = updates[0][0];
  assert.match(update, /SET qty = p_qty,\s+notes = v_new_notes/);
  assert.match(update, /WHERE e\.id = v_event\.id\s+AND e\.venue_id = p_venue_id\s+AND e\.status = 'PENDING'/);
  for (const forbidden of ['item_id', 'bar_id', 'station_id', 'night_id', 'action', 'status =', 'submitted_by', 'created_at']) {
    assert.doesNotMatch(update.slice(update.indexOf('SET'), update.indexOf('WHERE')), new RegExp(forbidden));
  }
});

test('audit is append-only to clients and atomically precedes Event correction', () => {
  assert.match(sql, /CREATE TABLE public\.event_correction_audit/);
  for (const field of [
    'event_id', 'venue_id', 'actor_user_id', 'created_at', 'correction_mode',
    'old_qty', 'new_qty', 'old_notes', 'new_notes',
  ]) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /REVOKE ALL ON public\.event_correction_audit\s+FROM PUBLIC, anon, authenticated, barback_user/);
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE)[^;]*event_correction_audit/i);
  const auditInsert = rpc.indexOf('INSERT INTO public.event_correction_audit');
  const eventUpdate = rpc.indexOf('UPDATE public.events AS e');
  assert.ok(auditInsert >= 0 && auditInsert < eventUpdate,
    'audit authorization must be inserted before the Event update');
  assert.doesNotMatch(rpc, /EXCEPTION\s+WHEN/,
    'RPC must not swallow audit/update errors; statement failure rolls back both');
});

test('RPC execution is exposed only to authenticated and returns deterministic fields', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.barinv_correct_pending_event\([\s\S]*FROM PUBLIC, anon, authenticated, barback_user/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.barinv_correct_pending_event\([\s\S]*TO authenticated/);
  for (const field of ['event_id', 'qty', 'notes', 'correction_mode', 'weight_g']) {
    assert.match(rpc, new RegExp(`'${field}'`));
  }
});
