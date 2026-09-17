'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const image = 'public.ecr.aws/supabase/postgres:17.6.1.075';
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260917120000_event_inventory_effects.sql'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
function run(args, opts = {}) { return spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, ...opts }); }
function sql(c, sql) { return run(['exec', c, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atqc', sql]); }

test('approved Event inventory effects are atomic and exactly once', () => {
  const c = `barinv-inventory-effects-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let made = false;
  try {
    const started = run(['run', '-d', '--name', c, '-e', 'POSTGRES_PASSWORD=postgres', image]);
    assert.equal(started.status, 0, started.stderr);
    made = true;
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      const p = run(['exec', c, 'pg_isready', '-U', 'postgres']);
      if (p.status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    assert.equal(ready, true, 'database did not become ready');
    assert.match(migration, /AFTER INSERT OR UPDATE OF status ON public\.events/);
    assert.match(migration, /event_inventory_effects/);
    assert.doesNotMatch(admin, /Auto-update Liquor Room stock/);
    assert.match(admin, /Stock updated by database/);
    const bootstrap = `
      CREATE TABLE public.items(id uuid PRIMARY KEY, liquor_room_stock numeric NOT NULL DEFAULT 0);
      CREATE TABLE public.events(id uuid PRIMARY KEY, item_id uuid, qty numeric, action text, status text, notes text);
      CREATE TABLE public.event_inventory_effects(event_id uuid PRIMARY KEY, item_id uuid, stock_delta numeric NOT NULL, applied boolean NOT NULL, reason text, created_at timestamptz default now());
      INSERT INTO public.items VALUES ('${id(1)}', 10);
    `;
    { const r = sql(c, bootstrap); assert.equal(r.status, 0, [r.stdout, r.stderr].join('\n')); }
    { const r = sql(c, `INSERT INTO public.events VALUES ('${id(9)}','${id(1)}',9,'RETURNED','APPROVED',NULL);`); assert.equal(r.status, 0, [r.stdout, r.stderr].join('\n')); }
    const applied = sql(c, migration);
    assert.equal(applied.status, 0, [applied.stdout, applied.stderr].join('\n'));
    const insert = (eid, qty, action, status, notes = '') => sql(c, `INSERT INTO public.events VALUES ('${eid}','${id(1)}',${qty},'${action}','${status}',${notes ? `'${notes}'` : 'NULL'});`);
    { const r = insert(id(1), 2, 'TAKEN', 'PENDING'); assert.equal(r.status, 0, r.stderr); }
    assert.equal(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim(), '10');
    assert.equal(sql(c, `UPDATE public.events SET status='APPROVED' WHERE id='${id(1)}'`).status, 0);
    assert.equal(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim(), '8');
    assert.equal(sql(c, `UPDATE public.events SET status='APPROVED' WHERE id='${id(1)}'`).status, 0);
    assert.equal(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim(), '8');
    assert.equal(insert(id(2), 2, 'RETURNED', 'APPROVED').status, 0);
    assert.equal(insert(id(3), 1, 'RETURNED', 'APPROVED', '[WEIGHT_G=625] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=1000]').status, 0);
    assert.equal(Number(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim()), 10.25);
    assert.equal(insert(id(5), 2, 'RETURNED', 'PENDING').status, 0);
    assert.equal(Number(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim()), 10.25);
    assert.equal(sql(c, `UPDATE public.events SET status='REJECTED' WHERE id='${id(5)}'`).status, 0);
    assert.equal(Number(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim()), 10.25);
    assert.equal(insert(id(6), 2, 'RETURNED', 'PENDING').status, 0);
    assert.equal(sql(c, `UPDATE public.events SET status='APPROVED' WHERE id='${id(6)}'`).status, 0);
    assert.equal(Number(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim()), 12.25);
    assert.equal(insert(id(7), 1, 'RETURNED', 'APPROVED', '[WEIGHT_G=750] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=1000]').status, 0);
    assert.equal(insert(id(8), 1, 'RETURNED', 'APPROVED', '[WEIGHT_G=625] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=1000]').status, 0);
    assert.equal(Number(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim()), 13);
    assert.equal(insert(id(10), 3, 'RETURNED', 'APPROVED').status, 0);
    assert.equal(Number(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim()), 16);
    assert.equal(insert(id(11), 1, 'TAKEN', 'APPROVED', '[WEIGHT_G=625] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=1000]').status, 0);
    assert.equal(Number(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim()), 15.75);
    assert.equal(insert(id(4), 1, 'TAKEN', 'APPROVED', '[WEIGHT_G=bad]').status, 0);
    assert.equal(Number(sql(c, `SELECT liquor_room_stock FROM public.items WHERE id='${id(1)}'`).stdout.trim()), 15.75);
    assert.equal(sql(c, `SELECT count(*) FROM public.event_inventory_effects WHERE applied=false`).stdout.trim(), '1');
  } finally {
    if (made) run(['rm', '-f', c]);
  }
});
