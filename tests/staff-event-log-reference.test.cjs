'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../staff/index.html'), 'utf8');
const start = html.indexOf('// Reference lookup is read-only');
const end = html.indexOf('async function setStatus(', start);
assert.ok(start >= 0 && end > start);
const source = html.slice(start, end);

function fixture(responder = () => ({ data: [], error: null })) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', textContent: '', innerHTML: '', style: {}, disabled: false });
    return nodes.get(id);
  };
  const user = { id: 'admin-1' };
  const calls = [];
  const context = {
    SESSION: { type: 'admin', venueId: 'venue-1', user, cache: { nights: [], bars: [] } },
    document: { getElementById: node },
    isAdminSession: () => context.SESSION.type === 'admin',
    esc: value => String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    EVENT_REVIEW: { filterKey: '', rows: [], allMatching: false, selectedIds: new Set() },
    EVENT_CSV_IMPORT: { filterKey: '', fileRows: [] },
    eventReviewCurrentFilters: () => ({ venueId: context.SESSION.venueId, nightId: node('ef-night').value,
      barId: node('ef-bar').value, status: node('ef-status').value, action: node('ef-action').value }),
    eventReviewFilterKey: filters => JSON.stringify(filters),
    eventReviewClearSelection: () => { context.EVENT_REVIEW.selectedIds.clear(); context.EVENT_REVIEW.allMatching = false; },
    eventReviewUpdateToolbar: () => {}, eventCsvRenderStoredImportHint: () => {},
    eventCsvDismissImportPanel: () => {}, eventCsvSetStatus: () => {},
    eventLogQtyDisplay: row => String(row.qty), eventCorrectionEditButton: () => '',
    SB: { from: table => {
      assert.equal(table, 'events');
      const filters = [];
      let limitCount = 200;
      const q = {
        select(value) { calls.push(['select', value]); return this; },
        eq(key, value) { filters.push(['eq', key, value]); calls.push(['eq', key, value]); return this; },
        like(key, value) { filters.push(['like', key, value]); calls.push(['like', key, value]); return this; },
        order(key, options) { calls.push(['order', key, options.ascending]); return this; },
        limit(count) { limitCount = count; calls.push(['limit', count]); return this; },
        then(resolve, reject) { return Promise.resolve(responder(filters, limitCount)).then(resolve, reject); }
      };
      return q;
    } }
  };
  node('ef-reference').value = '';
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, calls, node };
}
const row = {
  id: 'event-1', client_event_id: 'staff-opening-example-1', created_at: '2026-11-08T01:00:00Z',
  item_id: 'item-1', bar_id: 'bar-1', qty: 2, action: 'DELIVERED', status: 'PENDING',
  items: { name: 'Finlandia' }, bars: { name: 'B3-B1' }
};

test('Manager exact client reference is read-only, venue scoped, and separate from bulk selection', async () => {
  const ref = 'staff-opening-example-1';
  const h = fixture(filters => filters.some(f => f[1] === 'client_event_id' && f[2] === ref)
    ? { data: [row], error: null } : { data: [], error: null });
  h.node('ef-reference').value = ref;
  h.context.EVENT_REVIEW.selectedIds.add('existing-selection');
  await h.context.eventLogFindReference();
  assert(h.calls.some(c => c[0] === 'eq' && c[1] === 'venue_id' && c[2] === 'venue-1'));
  assert(h.calls.some(c => c[0] === 'eq' && c[1] === 'client_event_id' && c[2] === ref));
  assert.match(h.node('event-log-reference-results').innerHTML, /Finlandia.*PENDING/);
  assert.match(h.node('event-log-reference-status').textContent, /Found 1 matching event/);
  assert.equal(h.context.EVENT_REVIEW.selectedIds.has('existing-selection'), true);
});

test('Taking bare operation UUID finds the matching client-ID prefix without treating similarity as identity', async () => {
  const op = '12345678-1234-4234-8234-123456789abc';
  const h = fixture(filters => filters.some(f => f[0] === 'like')
    ? { data: [{ ...row, client_event_id: `staff-taking-${op}-0` }, { ...row, id: 'event-2', client_event_id: `staff-taking-${op}-1` }], error: null }
    : { data: [], error: null });
  h.node('ef-reference').value = op;
  await h.context.eventLogFindReference();
  assert(h.calls.some(c => c[0] === 'like' && c[1] === 'client_event_id' && c[2] === `staff-taking-${op}-%`));
  assert.match(h.node('event-log-reference-status').textContent, /Found 2 matching events/);
  assert.match(h.node('event-log-reference-results').innerHTML, /PENDING/);
});

test('reference lookup failure and changed venue never claim an absent submission', async () => {
  const error = fixture(() => ({ data: null, error: { message: 'synthetic offline' } }));
  error.node('ef-reference').value = 'staff-opening-example-1';
  await error.context.eventLogFindReference();
  assert.match(error.node('event-log-reference-status').textContent, /unavailable/);
  let resolve;
  const delayed = fixture(() => new Promise(done => { resolve = done; }));
  delayed.node('ef-reference').value = 'staff-opening-example-1';
  const pending = delayed.context.eventLogFindReference();
  for (let i = 0; !resolve && i < 8; i++) await Promise.resolve();
  assert.equal(typeof resolve, 'function');
  delayed.context.SESSION.venueId = 'venue-2';
  resolve({ data: [row], error: null });
  await pending;
  assert.equal(delayed.node('event-log-reference-results').innerHTML, '');
  assert.match(delayed.node('event-log-reference-status').textContent, /context changed/);
});

test('Manager Event Log distinguishes error, verified empty filters, and latest-200 limit', async () => {
  const failed = fixture(() => ({ data: null, error: { message: 'synthetic offline' } }));
  failed.context.EVENT_REVIEW.selectedIds.add('old-selection');
  await failed.context.loadEvents();
  assert.match(failed.node('events-tbody').innerHTML, /Event Log unavailable/);
  assert.match(failed.node('events-load-status').textContent, /lookup failed/);
  assert.equal(failed.context.EVENT_REVIEW.selectedIds.size, 0);
  const empty = fixture(() => ({ data: [], error: null }));
  await empty.context.loadEvents();
  assert.match(empty.node('events-tbody').innerHTML, /No events visible with current filters/);
  assert.match(empty.node('events-load-status').textContent, /not proof/);
  const many = fixture(() => ({ data: Array.from({ length: 200 }, (_, i) => ({ ...row, id: `event-${i}` })), error: null }));
  await many.context.loadEvents();
  assert.match(many.node('events-load-status').textContent, /latest 200.*older events may exist/);
});



test('unauthorized and malformed references cause no Event query', async () => {
  const unauthorized = fixture();
  unauthorized.context.SESSION.type = 'barback';
  unauthorized.node('ef-reference').value = 'staff-opening-example-1';
  await unauthorized.context.eventLogFindReference();
  assert.equal(unauthorized.calls.length, 0);
  assert.match(unauthorized.node('event-log-reference-status').textContent, /authorized Manager venue/);
  const malformed = fixture();
  malformed.node('ef-reference').value = 'bad%reference';
  await malformed.context.eventLogFindReference();
  assert.equal(malformed.calls.length, 0);
  assert.match(malformed.node('event-log-reference-status').textContent, /Enter one exact/);
});

test('exact Event UUID is findable beyond the latest-200 table query', async () => {
  const eventId = '12345678-1234-4234-8234-123456789abc';
  const h = fixture(filters => filters.some(f => f[1] === 'id' && f[2] === eventId)
    ? { data: [{ ...row, id: eventId, status: 'APPROVED' }], error: null } : { data: [], error: null });
  h.node('ef-reference').value = eventId;
  await h.context.eventLogFindReference();
  assert(h.calls.some(c => c[0] === 'eq' && c[1] === 'id' && c[2] === eventId));
  assert.match(h.node('event-log-reference-results').innerHTML, /APPROVED/);
  assert.equal(h.calls.filter(c => c[0] === 'limit' && c[1] === 200).length, 0);
});
