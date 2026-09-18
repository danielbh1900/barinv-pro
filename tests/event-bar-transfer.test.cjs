'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const barback = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const transferMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260918113000_bar_to_bar_transfer.sql'), 'utf8');
const inventoryMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260917120000_event_inventory_effects.sql'), 'utf8');
const metadataMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260917162500_enforce_event_metadata_contract.sql'), 'utf8');
const image = 'public.ecr.aws/supabase/postgres:17.6.1.075';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
function run(args, opts = {}) { return spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, ...opts }); }
function sql(container, statement) {
  return run(['exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atqc', statement]);
}

test('Bar-to-Bar TRANSFER is scoped, reviewable, and inventory-neutral', () => {
  assert.match(barback, /data-action="TRANSFER"/);
  assert.match(barback, /destination_bar_id/);
  assert.match(barback, /transfer-to-pick/);
  assert.match(barback, /TRANSFER requires at least two allowed bars/);
  assert.match(admin, /TRANSFER/);
  assert.match(admin, /destinationBarName/);
  assert.match(admin, /parseLiquorRoomStockInput/);
  assert.match(transferMigration, /ADD COLUMN IF NOT EXISTS destination_bar_id uuid/);
  assert.match(transferMigration, /allowed_bars/);
  assert.match(transferMigration, /allowed_movements/);
  assert.match(transferMigration, /SET search_path = ''/);
  assert.match(transferMigration, /trg_events_03_transfer_contract/);
  assert.match(inventoryMigration, /NEW\.action NOT IN \('TAKEN', 'DELIVERED', 'RETURNED'\)/);

  const container = `barinv-transfer-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let created = false;
  try {
    const started = run(['run', '-d', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=postgres', image]);
    assert.equal(started.status, 0, started.stderr);
    created = true;
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      const p = sql(container, 'select 1');
      if (p.status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    assert.equal(ready, true, 'database did not become ready');

    const venue = id(1), night = id(2), source = id(3), destination = id(4), outside = id(5), item = id(6), session = id(7);
    const bootstrap = `
      CREATE TABLE public.venues(id uuid PRIMARY KEY);
      CREATE TABLE public.nights(id uuid PRIMARY KEY, venue_id uuid NOT NULL REFERENCES public.venues(id));
      CREATE TABLE public.bars(id uuid PRIMARY KEY, venue_id uuid NOT NULL REFERENCES public.venues(id), active boolean NOT NULL DEFAULT true, bar_type text NOT NULL DEFAULT 'bar');
      CREATE TABLE public.items(id uuid PRIMARY KEY, liquor_room_stock numeric NOT NULL DEFAULT 0);
      CREATE TABLE public.barback_sessions(id uuid PRIMARY KEY, venue_id uuid NOT NULL, night_id uuid NOT NULL, allowed_bars uuid[] NOT NULL DEFAULT ARRAY[]::uuid[], allowed_movements jsonb NOT NULL DEFAULT '{"take":true,"return":true}'::jsonb);
      CREATE TABLE public.events(id uuid PRIMARY KEY, venue_id uuid, night_id uuid, bar_id uuid, item_id uuid, qty numeric, action text, status text, notes text, source text, session_id uuid);
      INSERT INTO public.venues VALUES ('${venue}'), ('${id(8)}');
      INSERT INTO public.nights VALUES ('${night}', '${venue}');
      INSERT INTO public.bars VALUES ('${source}', '${venue}', true, 'bar'), ('${destination}', '${venue}', true, 'bar'), ('${outside}', '${id(8)}', true, 'bar');
      INSERT INTO public.items VALUES ('${item}', 10);
      INSERT INTO public.barback_sessions VALUES ('${session}', '${venue}', '${night}', ARRAY['${source}','${destination}']::uuid[], '{"take":true,"return":true}'::jsonb);
      CREATE TABLE public.event_inventory_effects(event_id uuid PRIMARY KEY, item_id uuid NOT NULL, stock_delta numeric NOT NULL, applied boolean NOT NULL, reason text);
    `;
    { const boot = sql(container, bootstrap); assert.equal(boot.status, 0, [boot.stdout, boot.stderr].join('\n')); }
    assert.equal(sql(container, inventoryMigration).status, 0);
    assert.equal(sql(container, transferMigration).status, 0);
    assert.equal(sql(container, metadataMigration).status, 0);

    const insert = (eventId, sourceBar, destinationBar, status = 'PENDING', sessionId = session) => sql(container, `INSERT INTO public.events(id,venue_id,night_id,bar_id,destination_bar_id,item_id,qty,action,status,source,session_id) VALUES ('${eventId}','${venue}','${night}','${sourceBar}','${destinationBar}','${item}',1,'TRANSFER','${status}','barback_web_link','${sessionId}');`);
    assert.equal(insert(id(10), source, destination).status, 0, 'authorized PENDING transfer should pass');
    assert.equal(sql(container, `SELECT liquor_room_stock FROM public.items WHERE id='${item}'`).stdout.trim(), '10');
    assert.equal(sql(container, `SELECT count(*) FROM public.event_inventory_effects`).stdout.trim(), '0');
    assert.equal(sql(container, `INSERT INTO public.events(id,venue_id,night_id,bar_id,destination_bar_id,item_id,qty,action,status,notes,source,session_id) VALUES ('${id(17)}','${venue}','${night}','${source}','${destination}','${item}',1,'TRANSFER','PENDING','[WEIGHT_G=625] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=1000] [BOTTLE_STATE=PARTIAL] [REMAINING_PERCENT=25]','barback_web_link','${session}');`).status, 0, 'weighted partial transfer qty 1 should pass');
    const weightedQtyTwo = sql(container, `INSERT INTO public.events(id,venue_id,night_id,bar_id,destination_bar_id,item_id,qty,action,status,notes,source,session_id) VALUES ('${id(18)}','${venue}','${night}','${source}','${destination}','${item}',2,'TRANSFER','PENDING','[WEIGHT_G=625] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=1000]','barback_web_link','${session}');`);
    assert.notEqual(weightedQtyTwo.status, 0, 'weighted transfer qty > 1 must be rejected');
    assert.equal(sql(container, `UPDATE public.events SET status='APPROVED' WHERE id='${id(10)}'`).status, 0);
    assert.equal(sql(container, `SELECT liquor_room_stock FROM public.items WHERE id='${item}'`).stdout.trim(), '10');
    assert.equal(sql(container, `SELECT count(*) FROM public.event_inventory_effects`).stdout.trim(), '0');

    const rejects = [
      ['same bar', `INSERT INTO public.events(id,venue_id,night_id,bar_id,destination_bar_id,item_id,qty,action,status,source,session_id) VALUES ('${id(11)}','${venue}','${night}','${source}','${source}','${item}',1,'TRANSFER','PENDING','barback_web_link','${session}');`],
      ['missing destination', `INSERT INTO public.events(id,venue_id,night_id,bar_id,item_id,qty,action,status,source,session_id) VALUES ('${id(12)}','${venue}','${night}','${source}','${item}',1,'TRANSFER','PENDING','barback_web_link','${session}');`],
      ['cross venue', `INSERT INTO public.events(id,venue_id,night_id,bar_id,destination_bar_id,item_id,qty,action,status,source,session_id) VALUES ('${id(13)}','${venue}','${night}','${source}','${outside}','${item}',1,'TRANSFER','PENDING','barback_web_link','${session}');`],
      ['unauthorized destination', `INSERT INTO public.events(id,venue_id,night_id,bar_id,destination_bar_id,item_id,qty,action,status,source,session_id) VALUES ('${id(14)}','${venue}','${night}','${source}','${outside}','${item}',1,'TRANSFER','PENDING','barback_web_link','${session}');`],
    ];
    for (const [label, statement] of rejects) {
      const result = sql(container, statement);
      assert.notEqual(result.status, 0, `${label} transfer unexpectedly succeeded`);
      assert.match(result.stderr, /ERROR|error/i);
    }
    assert.equal(sql(container, `UPDATE public.barback_sessions SET allowed_movements='{"take":false,"return":true}'::jsonb WHERE id='${session}'`).status, 0);
    const deniedTake = insert(id(15), source, destination);
    assert.notEqual(deniedTake.status, 0, 'take=false must block transfer');
    assert.match(deniedTake.stderr, /requires both TAKE and RETURN/i);
    assert.equal(sql(container, `UPDATE public.barback_sessions SET allowed_movements='{"take":true,"return":false}'::jsonb WHERE id='${session}'`).status, 0);
    const deniedReturn = insert(id(16), source, destination);
    assert.notEqual(deniedReturn.status, 0, 'return=false must block transfer');
    assert.match(deniedReturn.stderr, /requires both TAKE and RETURN/i);
    assert.equal(sql(container, `SELECT count(*) FROM public.events`).stdout.trim(), '2');
  } finally {
    if (created) run(['rm', '-f', container]);
  }
});
