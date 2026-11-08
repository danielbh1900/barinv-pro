'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../staff/staff-recent-movement-review-v1.js'), 'utf8');

function fixture(rows) {
  let current = true, decision = false, prompts = 0, queries = 0;
  const query = {
    select() { return this; }, eq() { return this; }, in() { return this; }, like() { return this; },
    order() { return this; }, limit: async () => ({ data: rows, error: null })
  };
  const client = { from(table) { assert.equal(table, 'events'); queries++; return query; } };
  const scope = { venueId: 'venue-synthetic', nightId: 'night-synthetic', allowedBarIds: ['bar-synthetic'] };
  const record = { client_event_id: 'new-event', venue_id: 'venue-synthetic', night_id: 'night-synthetic',
    bar_id: 'bar-synthetic', item_id: 'item-synthetic', qty: 2, action: 'RETURNED', status: 'PENDING' };
  const context = vm.createContext({ Date, Number, Set, String });
  vm.runInContext(source, context);
  return {
    record, scope, client,
    run: (options = {}) => context.staffRecentMovementReview({ mode: 'returning', records: [record], scope, client,
      isCurrent: () => current, confirmFn: () => { prompts++; return decision; }, limit: 2, ...options }),
    decide: value => { decision = value; }, stale: () => { current = false; },
    stats: () => ({ prompts, queries })
  };
}

test('more than 50 scoped rows without a visible match requires explicit NEW-work confirmation', async () => {
  const base = fixture([]).record;
  const rows = Array.from({ length: 51 }, (_, i) => ({ ...base, id: `event-${i}`,
    client_event_id: `older-${i}`, item_id: `other-item-${i}` }));
  const g = fixture(rows);
  assert.equal((await g.run({ limit: 50 })).outcome, 'cancel');
  assert.equal(g.stats().prompts, 1);
  g.decide(true);
  const confirmed = await g.run({ limit: 50 });
  assert.equal(confirmed.outcome, 'proceed');
  assert.equal(confirmed.incomplete, true);
  assert.equal(confirmed.confirmedNewWork, true);
});

test('known matching PENDING row remains a review warning, not an automatic duplicate denial', async () => {
  const base = fixture([]).record;
  const f = fixture([{ ...base, id: 'event-existing', client_event_id: 'old-event',
    created_at: '2026-11-08T05:00:00Z' }]);
  assert.equal((await f.run()).outcome, 'cancel');
  f.decide(true);
  const confirmed = await f.run();
  assert.equal(confirmed.outcome, 'proceed');
  assert.equal(confirmed.matches.length, 1);
});

test('exact client event ID is never offered as a new intentional movement', async () => {
  const base = fixture([]).record;
  const f = fixture([{ ...base, id: 'event-existing' }]);
  assert.equal((await f.run()).outcome, 'identified_attempt');
  assert.equal(f.stats().prompts, 0);
});
