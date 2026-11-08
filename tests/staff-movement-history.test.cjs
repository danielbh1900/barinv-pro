'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../staff/index.html'), 'utf8');
const start = html.indexOf('// Read-only Staff movement history.');
const end = html.indexOf('function isAdminSession()', start);
assert.ok(start >= 0 && end > start, 'scoped Staff history source exists');
const source = html.slice(start, end) + '\nthis.historyState = STAFF_MOVEMENT_HISTORY; this.receipt = () => STAFF_MOVEMENT_RECEIPT;';

function harness(response = { data: [], error: null }) {
  const elements = Object.fromEntries(['staff-dashboard', 'staff-movement-history-status',
    'staff-movement-history-refresh', 'staff-movement-history-list',
    'staff-movement-history-more', 'staff-movement-receipt'].map(id => [id, {
      textContent: '', innerHTML: '', className: '', disabled: false, style: {}, dataset: { staffView: 'history' }
    }]));
  const user = { allowed_bar_ids: ['b1', 'b2'] };
  const session = { user, venueId: 'v1', cache: { authorizedBars: [
    { id: 'b1', active: true }, { id: 'b2', active: true }, { id: 'foreign', active: true }
  ] } };
  const calls = [];
  const query = {
    select(value) { calls.push(['select', value]); return this; },
    eq(key, value) { calls.push(['eq', key, value]); return this; },
    in(key, value) { calls.push(['in', key, value]); return this; },
    order(key, options) { calls.push(['order', key, options.ascending]); return this; },
    range(from, to) { calls.push(['range', from, to]); return Promise.resolve(typeof response === 'function' ? response(from, to) : response); }
  };
  const context = {
    SESSION: session, document: { getElementById: id => elements[id] },
    staffOpeningContext: () => ({ userRef: session.user, key: 'v1|staff|night', venueId: session.venueId, nightId: 'n1' }),
    SB: { from: table => { calls.push(['from', table]); return query; } },
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'staff-movement-history.js' });
  return { context, calls, elements, session };
}
const row = {
  id: 'event-1', client_event_id: 'client-1', created_at: '2026-11-08T01:00:00Z',
  bar_id: 'b1', item_id: 'i1', qty: 1, action: 'RETURNED', status: 'PENDING',
  items: { name: 'Finlandia' }, bars: { name: 'B3-B1' }, destination_bar: null
};

test('history is read-only and scoped to current venue, Night, and authorized active Bars', async () => {
  const h = harness({ data: [row], error: null });
  await h.context.staffMovementHistoryLoad(true);
  assert.equal(JSON.stringify(h.calls.find(call => call[0] === 'in')), JSON.stringify(['in', 'bar_id', ['b1', 'b2']]));
  assert.ok(h.calls.some(call => call[0] === 'eq' && call[1] === 'venue_id' && call[2] === 'v1'));
  assert.ok(h.calls.some(call => call[0] === 'eq' && call[1] === 'night_id' && call[2] === 'n1'));
  assert.match(h.elements['staff-movement-history-list'].innerHTML, /RETURNED.*Finlandia/);
  assert.match(h.elements['staff-movement-history-list'].innerHTML, /PENDING/);
  assert.match(h.elements['staff-movement-history-status'].textContent, /not an exact-ID submission check/);
  assert.equal(h.calls.filter(call => call[0] === 'from').length, 1);
});

test('history error is distinct from a verified empty page and does not leave stale rows', async () => {
  const h = harness({ data: null, error: { message: 'offline' } });
  await h.context.staffMovementHistoryLoad(true);
  assert.match(h.elements['staff-movement-history-status'].textContent, /unavailable/);
  assert.equal(h.elements['staff-movement-history-list'].innerHTML, '');
  assert.equal(h.elements['staff-movement-history-refresh'].disabled, false);
  const empty = harness({ data: [], error: null });
  await empty.context.staffMovementHistoryLoad(true);
  assert.match(empty.elements['staff-movement-history-status'].textContent, /No events visible/);
});

test('delayed response cannot replace a changed Staff context', async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const pending = h.context.staffMovementHistoryLoad(true);
  h.session.user = { allowed_bar_ids: ['b2'] };
  release({ data: [row], error: null });
  await pending;
  assert.equal(h.elements['staff-movement-history-list'].innerHTML, '');
  assert.equal(h.context.historyState.busy, false);
});

test('receipt requires a complete verified batch and stays bound to the same Staff context', () => {
  const h = harness();
  const record = { client_event_id: 'staff-opening-1' };
  const batch = { context: { userRef: h.session.user, venueId: 'v1', nightId: 'n1' },
    records: [record], ack: { acknowledged: 1, statuses: { PENDING: 1 } } };
  assert.equal(h.context.staffMovementRecordVerified('opening', batch), true);
  assert.match(h.elements['staff-movement-receipt'].textContent, /PENDING: 1.*staff-opening-1/);
  h.session.user = { allowed_bar_ids: ['b1'] };
  h.context.staffMovementRenderReceipt();
  assert.equal(h.elements['staff-movement-receipt'].textContent, '');
  assert.equal(h.context.staffMovementRecordVerified('opening', { ...batch, ack: { statuses: { PENDING: 0 } } }), false);
});

test('history pages through bounded results without losing the sentinel row', async () => {
  const all = Array.from({ length: 51 }, (_, index) => ({ ...row, id: 'event-' + index }));
  const h = harness((from, to) => ({ data: all.slice(from, to + 1), error: null }));
  await h.context.staffMovementHistoryLoad(true);
  assert.equal(h.context.historyState.rows.length, 50);
  assert.equal(h.elements['staff-movement-history-more'].style.display, 'inline-flex');
  await h.context.staffMovementHistoryLoad(false);
  assert.equal(h.context.historyState.rows.length, 51);
  assert.equal(h.context.historyState.rows[50].id, 'event-50');
  assert.equal(h.elements['staff-movement-history-more'].style.display, 'none');
});

test('same-scope restored session restarts a pending History read instead of leaving stale loading', async () => {
  let releaseOld, requests = 0;
  const h = harness(() => {
    requests++;
    return requests === 1 ? new Promise(resolve => { releaseOld = resolve; }) : { data: [row], error: null };
  });
  const old = h.context.staffMovementHistoryLoad(true);
  h.session.user = { ...h.session.user, allowed_bar_ids: ['b1', 'b2'] };
  await h.context.staffMovementHistoryLoad(true);
  assert.equal(requests, 2);
  assert.match(h.elements['staff-movement-history-list'].innerHTML, /Finlandia/);
  assert.match(h.elements['staff-movement-history-status'].textContent, /Showing 1 visible event/);
  releaseOld({ data: [], error: null });
  await old;
  assert.match(h.elements['staff-movement-history-list'].innerHTML, /Finlandia/);
  assert.equal(h.context.historyState.busy, false);
});
