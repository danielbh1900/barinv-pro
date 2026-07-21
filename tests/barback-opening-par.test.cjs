'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/barback-pin-login/index.ts'), 'utf8');
const checklistEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-opening-par-checklist/index.ts'), 'utf8');

function between(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  assert.notEqual(a, -1, `missing marker: ${start}`);
  assert.notEqual(b, -1, `missing marker: ${end}`);
  return html.slice(a + start.length, b);
}

const coreContext = {};
vm.runInNewContext(
  between('// OPENING_PAR_V1_CORE_START', '// OPENING_PAR_V1_CORE_END') +
    '\nthis.OpeningParV1 = OpeningParV1;',
  coreContext,
  { filename: 'barback-opening-par-core.js' },
);
const core = coreContext.OpeningParV1;

const visibleItems = [
  { id: 'heineken', name: 'Heineken', par_level: 99, service_mode: 'regular_bar', unit: 'bottle' },
  { id: 'corona', name: 'Corona', par_level: 88, service_mode: 'all_bars', unit: 'case' },
];
const snapshot = {
  enabled: true, version: 1,
  items: [{ item_id: 'heineken', qty: 4 }, { item_id: 'corona', qty: 3 }],
};
const model = core.normalizeSessionSnapshot(snapshot, visibleItems);
const destinations = [
  { id: 'bar-1', name: 'Main Bar', bar_type: 'bar' },
  { id: 'dispatch-1', name: 'Dispatch', bar_type: 'dispatch' },
];

function checklist(overrides = {}) {
  return core.buildChecklist({
    sessionId: 'session-1', items: model.items, destinations: [destinations[0]], completions: [], ...overrides,
  });
}

function addToReviewHarness() {
  const start = html.indexOf('function addToReview(payload)');
  const end = html.indexOf('//  Save button (manual flow)', start);
  assert.ok(start >= 0 && end > start, 'addToReview source not found');
  const captured = [];
  let sequence = 0;
  const context = {
    state: {
      tokenPayload: { venue_id: 'venue-1', night_id: 'night-1', session_id: 'session-1' },
      serverSession: { session_id: 'session-1' }, jwt: 'jwt', staffId: 'staff-1', staffName: 'Bar Back',
    },
    cache: { items: visibleItems },
    isItemAllowedForRole: () => true,
    getCurrentUserRole: () => 'barback',
    scopeBlockReason: () => 'blocked',
    isAreaAllowedForSession: id => id === 'bar-1',
    normalizeBottleState: (state, weight) => state || (weight ? 'PARTIAL' : 'UNOPENED'),
    normalizeWeightG: value => Number(value) > 0 ? Number(value) : null,
    uuidv4: () => `ce-${++sequence}`,
    STAGING_MODE: false, LIVE_PILOT_MODE: false,
    WeightProfiles: { calcRemaining: () => null },
    deriveLiquidG: () => null, deriveRemainingMl: () => null,
    nonNegNum: value => Number(value) >= 0 ? Number(value) : null,
    Drafts: { add: record => captured.push(record) },
    StageLog: { push: () => {} }, Recent: { add: () => {} }, Telemetry: { bump: () => {} },
    renderRecentItemChips: () => {},
  };
  vm.runInNewContext(html.slice(start, end), context, { filename: 'add-to-review.js' });
  return { context, captured };
}

test('1. authenticated session snapshot supplies read-only target quantities', () => {
  assert.equal(model.enabled, true);
  assert.equal(model.items[0].opening_par_qty, 4);
  assert.equal(model.items[0].par_level, 99);
});

test('2. one destination creates one checklist row per positive item', () => {
  const result = checklist();
  assert.equal(result.destinationCount, 1);
  assert.equal(result.rowCount, 2);
});

test('3. multiple destinations are independent and deduplicated', () => {
  const result = checklist({ destinations: [destinations[0], destinations[1], destinations[0]] });
  assert.equal(result.destinationCount, 2);
  assert.equal(result.rowCount, 4);
  assert.equal(result.groups[1].destination.id, 'dispatch-1');
});

test('4. no authorized destination fails closed with no checklist rows', () => {
  const result = checklist({ destinations: [] });
  assert.equal(result.rowCount, 0);
  assert.match(between('// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END'), /reviewSessionBars\(\)/);
});

test('5. zero or malformed snapshot quantities cannot become confirmable rows', () => {
  const malformed = core.normalizeSessionSnapshot(
    { enabled: true, version: 1, items: [{ item_id: 'heineken', qty: 0 }] }, visibleItems,
  );
  assert.equal(malformed.valid, false);
  assert.equal(core.positiveParItems([{ id: 'x', opening_par_qty: 0 }]).length, 0);
});

test('6. Master PAR changes cannot alter the stored target', () => {
  visibleItems[0].par_level = 123;
  assert.equal(model.items[0].opening_par_qty, 4);
});

test('7. receipt state is keyed by session, destination, and item', () => {
  assert.equal(core.checklistKey('s', 'd', 'i'), 's|d|i');
  assert.notEqual(core.checklistKey('s', 'd1', 'i'), core.checklistKey('s', 'd2', 'i'));
});

test('8. completing one destination does not complete another', () => {
  const result = checklist({
    destinations,
    completions: [{ destination_id: 'bar-1', item_id: 'heineken', confirmed_at: 'stamp' }],
  });
  assert.equal(result.groups[0].receivedCount, 1);
  assert.equal(result.groups[1].receivedCount, 0);
});

test('9. duplicate retry receipts reconstruct as one Received state', () => {
  const completion = { destination_id: 'bar-1', item_id: 'heineken', confirmed_at: 'first' };
  const result = checklist({ completions: [completion, { ...completion, confirmed_at: 'second' }] });
  assert.equal(result.receivedCount, 1);
  assert.equal(result.groups[0].rows[0].completion.confirmed_at, 'first');
  assert.match(checklistEdge, /insertError\.code !== "23505"/);
});

test('10. Opening PAR has no quantity editor or Add All action', () => {
  const ui = between('// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  const markup = html.slice(html.indexOf('id="opening-par-row"'), html.indexOf('id="opening-par-status"'));
  assert.doesNotMatch(ui + markup, /op-minus|op-plus|opening-par-qty|ADD MISSING|ADD ALL/i);
});

test('11. Opening PAR never enters Classic Review or Drafts', () => {
  const ui = between('// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.doesNotMatch(ui, /addToReview|Drafts\.|Outbox\.|eventsInsert/);
});

test('12. confirmation request contains destination and item but no target quantity', () => {
  const ui = between('// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.match(ui, /openingParChecklistInvoke\('confirm', \{ destination_id: destinationId, item_id: itemId \}\)/);
  assert.match(checklistEdge, /target quantity is read-only/);
});

test('13. reload path lists persisted receipts before rendering', () => {
  const ui = between('// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.match(ui, /openingParChecklistInvoke\('list'\)/);
  assert.match(ui, /cacheOpeningParCompletions/);
});

test('14. Classic TAKEN draft path remains functional', () => {
  const { context, captured } = addToReviewHarness();
  assert.equal(context.addToReview({ item_id: 'heineken', item_name: 'Heineken', qty: 2, action: 'TAKEN', bar_id: 'bar-1', notes: '' }).ok, true);
  assert.equal(captured[0].action, 'TAKEN');
});

test('15. Classic RETURN draft path remains functional', () => {
  const { context, captured } = addToReviewHarness();
  assert.equal(context.addToReview({ item_id: 'heineken', item_name: 'Heineken', qty: 642.5, action: 'RETURNED', bar_id: 'bar-1', notes: '' }).ok, true);
  assert.equal(captured[0].action, 'RETURNED');
});

test('16. existing PARTIAL and Review protections remain in Classic code', () => {
  assert.match(html, /bottleState === 'PARTIAL' && multiBarDestCount\(\) > 1/);
  assert.match(html, /function onDraftEditSave\(ce, form\)/);
  assert.match(html, /async function submitAllDraftsToBarinv\(\)/);
});

test('17. feature remains gated OFF and PIN login projection stays additive', () => {
  assert.match(html, /const OPENING_PAR_V1_ENABLED = false;/);
  assert.match(edge, /opening_par: openingParResult\.value/);
});
