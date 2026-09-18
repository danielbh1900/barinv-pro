'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const image = 'public.ecr.aws/supabase/postgres:17.6.1.075';
const guard = fs.readFileSync(path.join(root, 'supabase/migrations/20260917162500_enforce_event_metadata_contract.sql'), 'utf8');
const inventory = fs.readFileSync(path.join(root, 'supabase/migrations/20260917120000_event_inventory_effects.sql'), 'utf8');
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const run = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...opts });
const sql = (c, q) => run(['exec', '-i', c, 'psql', '-X', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '--set=VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres', '-At'], { input: q });

test('metadata contract protects new Event writes without replaying history', () => {
  const c = `barinv-metadata-prevention-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let made = false;
  try {
    const started = run(['run', '--pull=never', '--detach', '--rm', '--name', c, '-e', 'POSTGRES_PASSWORD=x', image]);
    assert.equal(started.status, 0, started.stderr);
    made = true;
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      if (run(['exec', c, 'psql', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1']).status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    assert.equal(ready, true, 'database did not become ready');
    const boot = `
      CREATE TABLE public.items(id uuid PRIMARY KEY, liquor_room_stock integer NOT NULL DEFAULT 0);
      CREATE TABLE public.events(id uuid PRIMARY KEY, item_id uuid, qty numeric, action text, status text, notes text);
      INSERT INTO public.items VALUES ('${id(1)}', 10);
      INSERT INTO public.events VALUES ('${id(90)}','${id(1)}',1,'RETURNED','APPROVED','historical');
    `;
    { const r = sql(c, boot); assert.equal(r.status, 0, [r.stdout, r.stderr].join('\n')); }
    assert.equal(sql(c, guard).status, 0);
    const insert = (eid, qty, action, status, notes = '') => sql(c, `INSERT INTO public.events VALUES ('${eid}','${id(1)}',${qty},'${action}','${status}',${notes ? `'${notes}'` : 'NULL'});`);
    assert.equal(insert(id(1), 1, 'RETURNED', 'APPROVED').status, 0);
    assert.equal(insert(id(2), 2, 'RETURNED', 'APPROVED').status, 0);
    assert.equal(insert(id(3), 1, 'RETURNED', 'APPROVED', '[BOTTLE_STATE=UNOPENED]').status, 0);
    assert.equal(insert(id(4), 1, 'RETURNED', 'APPROVED', '[WEIGHT_G=625] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=1000]').status, 0);
    assert.equal(insert(id(5), 1, 'TAKEN', 'APPROVED', '[WEIGHT_G=625] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=1000]').status, 0);
    const reject = (eid, notes, qty = 1) => {
      const before = Number(sql(c, `SELECT count(*) FROM public.events`).stdout.trim());
      const r = insert(eid, qty, 'RETURNED', 'APPROVED', notes);
      assert.notEqual(r.status, 0, `expected rejection for ${notes}`);
      assert.match(`${r.stdout}\n${r.stderr}`, /22023/);
      assert.equal(Number(sql(c, `SELECT count(*) FROM public.events`).stdout.trim()), before);
    };
    assert.equal(insert(id(10), 1, 'RETURNED', 'APPROVED', '[WEIGHT_G=600]').status, 0);
    reject(id(11), '[WEIGHT_G=600]', 2);
    reject(id(12), '[WEIGHT_G=600] [TARE_WEIGHT_G=700] [FULL_WEIGHT_G=1000]');
    reject(id(13), '[WEIGHT_G=600] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=400]');
    reject(id(14), '[BOTTLE_STATE=PARTIAL] [REMAINING_PERCENT=100]');
    assert.equal(insert(id(15), 1, 'RETURNED', 'APPROVED', '[BOTTLE_STATE=PARTIAL] [REMAINING_PERCENT=99]').status, 0);
    const update = sql(c, `UPDATE public.events SET qty=2, notes='[WEIGHT_G=600]' WHERE id='${id(1)}'`);
    assert.notEqual(update.status, 0);
    assert.match(`${update.stdout}\n${update.stderr}`, /22023/);
    assert.equal(sql(c, `SELECT qty FROM public.events WHERE id='${id(1)}'`).stdout.trim(), '1');
  } finally {
    if (made) run(['rm', '-f', c]);
  }
});
