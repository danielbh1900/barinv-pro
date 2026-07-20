'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');
const edge = fs.readFileSync(
  path.join(root, 'supabase/functions/barback-pin-login/index.ts'),
  'utf8',
);

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

const items = [
  { id: 'heineken', name: 'Heineken', par_level: 4, service_mode: 'regular_bar' },
  { id: 'corona', name: 'Corona', par_level: 3, service_mode: 'all_bars' },
  { id: 'finlandia', name: 'Finlandia', par_level: 4, service_mode: 'regular_bar' },
];
const bar1 = { id: 'bar-1', name: 'Main Bar', bar_type: 'bar' };
const bar2 = { id: 'bar-2', name: 'Patio Bar', bar_type: 'bar' };

function plan(overrides = {}) {
  return core.buildPlan({
    items,
    bars: [bar1],
    qtyByItem: {},
    drafts: [],
    nightId: 'night-1',
    ...overrides,
  });
}

function scopeFunctions() {
  const names = [
    'SCOPE_BAR_ALIASES',
    'SCOPE_BOTH_ALIASES',
    'SCOPE_VIP_ALIASES',
    'SCOPE_HIDDEN_ALIASES',
  ];
  const declarations = names.map(name => {
    const match = html.match(new RegExp(`const ${name}\\s*=\\s*\\[[^;]+;`));
    assert.ok(match, `missing ${name}`);
    return match[0];
  }).join('\n');
  const start = html.indexOf('function normalizeItemScope(item)');
  const end = html.indexOf('// Is this item selectable by the given role?', start);
  const start2 = html.indexOf('function isItemAllowedForRole(item, role)', end);
  const end2 = html.indexOf('function getAllowedItemsForCurrentSession(items)', start2);
  const context = {};
  vm.runInNewContext(
    declarations + '\n' + html.slice(start, end) + '\n' + html.slice(start2, end2) +
      '\nthis.isItemAllowedForRole = isItemAllowedForRole;',
    context,
  );
  return context;
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
      serverSession: { session_id: 'session-1' },
      jwt: 'scoped-jwt',
      staffId: 'staff-1',
      staffName: 'Bar Back',
    },
    cache: { items },
    isItemAllowedForRole: () => true,
    getCurrentUserRole: () => 'barback',
    scopeBlockReason: () => 'blocked',
    isAreaAllowedForSession: id => id === 'bar-1' || id === 'bar-2',
    normalizeBottleState: (state, weight) => state || (weight ? 'PARTIAL' : 'UNOPENED'),
    normalizeWeightG: value => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    uuidv4: () => `ce-${++sequence}`,
    STAGING_MODE: false,
    LIVE_PILOT_MODE: false,
    WeightProfiles: { calcRemaining: () => null },
    deriveLiquidG: () => null,
    deriveRemainingMl: () => null,
    nonNegNum: value => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : null;
    },
    Drafts: { add: record => captured.push(record) },
    StageLog: { push: () => {} },
    Recent: { add: () => {} },
    Telemetry: { bump: () => {} },
    renderRecentItemChips: () => {},
  };
  vm.runInNewContext(html.slice(start, end), context, { filename: 'add-to-review.js' });
  return { context, captured };
}

test('1. one assigned bar generates one row per positive item', () => {
  const result = plan();
  assert.equal(result.barCount, 1);
  assert.equal(result.rows.length, 3);
});

test('2. multiple assigned bars generate item x destination rows', () => {
  const result = plan({ bars: [bar1, bar2] });
  assert.equal(result.barCount, 2);
  assert.equal(result.rows.length, 6);
  const { context, captured } = addToReviewHarness();
  result.rows.forEach(row => {
    const added = context.addToReview({
      item_id: row.item.id, item_name: row.item.name, qty: row.qty,
      action: 'TAKEN', bar_id: row.bar.id, notes: core.marker,
      bottle_state: 'UNOPENED', opening_par_v1: true,
    });
    assert.equal(added.ok, true);
  });
  assert.equal(captured.length, 6);
  assert.equal(captured.every(draft => draft.opening_par_v1 === true), true);
});

test('3. no assigned bars fails closed with zero generated rows', () => {
  const result = plan({ bars: [] });
  assert.equal(result.barCount, 0);
  assert.equal(result.rows.length, 0);
  assert.match(between('// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END'), /reviewSessionBars\(\)/);
});

test('4. missing or stale par_level is skipped safely', () => {
  const visible = core.positiveParItems([
    { id: 'missing', service_mode: 'regular_bar' },
    { id: 'stale', par_level: 'not-a-number', service_mode: 'regular_bar' },
    items[0],
  ]);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'heineken');
});

test('5. par_level zero is excluded', () => {
  assert.equal(core.positiveParItems([{ id: 'zero', par_level: 0 }]).length, 0);
});

test('6. editable override 4 to 2 affects drafts only', () => {
  const result = plan({ items: [items[0]], qtyByItem: { heineken: 2 } });
  assert.equal(result.rows[0].qty, 2);
  assert.equal(items[0].par_level, 4);
});

test('7. regular-bar filtering reuses the existing service_mode predicate', () => {
  const scope = scopeFunctions();
  assert.equal(scope.isItemAllowedForRole({ service_mode: 'regular_bar' }, 'barback'), true);
  assert.equal(scope.isItemAllowedForRole({ service_mode: 'all_bars' }, 'barback'), true);
  assert.match(between('// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END'), /getAllowedItemsForCurrentSession\(cache\.items\)/);
});

test('8. vip_only is excluded from regular bar sessions', () => {
  const scope = scopeFunctions();
  assert.equal(scope.isItemAllowedForRole({ service_mode: 'vip_only' }, 'barback'), false);
});

test('9. duplicate Opening drafts are add-missing-only for the same night/bar/item', () => {
  const drafts = [{
    night_id: 'night-1', bar_id: 'bar-1', item_id: 'heineken', action: 'RETURNED',
    notes: core.marker, opening_par_v1: true,
  }];
  const result = plan({ items: [items[0], items[1]], drafts });
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].item.id, 'corona');
  assert.equal(plan({ items: [items[0]], drafts, nightId: 'night-2' }).rows.length, 1);
});

test('10. editable quantity zero is skipped', () => {
  const result = plan({ qtyByItem: { heineken: 0, corona: 3, finlandia: 0 } });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].item.id, 'corona');
});

test('11. existing TAKEN draft path remains functional', () => {
  const { context, captured } = addToReviewHarness();
  const result = context.addToReview({
    item_id: 'heineken', item_name: 'Heineken', qty: 2, action: 'TAKEN',
    bar_id: 'bar-1', notes: '', bottle_state: 'UNOPENED',
  });
  assert.equal(result.ok, true);
  assert.equal(captured[0].action, 'TAKEN');
  assert.equal(captured[0].qty, 2);
});

test('12. existing RETURN draft path remains functional', () => {
  const { context, captured } = addToReviewHarness();
  const result = context.addToReview({
    item_id: 'heineken', item_name: 'Heineken', qty: 642.5, action: 'RETURNED',
    bar_id: 'bar-1', notes: '', bottle_state: 'UNOPENED',
  });
  assert.equal(result.ok, true);
  assert.equal(captured[0].action, 'RETURNED');
  assert.equal(captured[0].qty, 642.5);
});

test('13. PARTIAL remains single-destination and Opening rows are UNOPENED', () => {
  assert.match(html, /bottleState === 'PARTIAL' && multiBarDestCount\(\) > 1/);
  const openingUi = between('// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.match(openingUi, /bottle_state: 'UNOPENED'/);
  assert.doesNotMatch(openingUi, /bottle_state: 'PARTIAL'/);
});

test('14. Review Edit/Delete paths remain wired to Drafts', () => {
  assert.match(html, /function onDraftDelete\(ce\)/);
  assert.match(html, /Drafts\.removeById\(ce\)/);
  assert.match(html, /function onDraftEditSave\(ce, form\)/);
  assert.match(html, /Drafts\.save\(arr\)/);
});

test('15. Submit All strips Opening metadata and keeps the existing event payload path', () => {
  const submitStart = html.indexOf('async function submitAllDraftsToBarinv()');
  const submitEnd = html.indexOf('// Keep the SUBMIT ALL button label', submitStart);
  const submit = html.slice(submitStart, submitEnd);
  assert.match(submit, /drafted_at, opening_par_v1, weight_g/);
  assert.match(submit, /Outbox\.push\(rec\)/);
  assert.match(html, /const \{ queued_at, attempts, last_error, last_attempt_at, \.\.\.rec \} = ev;/);
  assert.match(html, /eventsInsert\(rec\)/);
  assert.doesNotMatch(between('// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END'), /from\(['"]events['"]\)|eventsInsert\(/);
});

test('16. offline/reload duplicate state survives local draft serialization', () => {
  const draft = {
    night_id: 'night-1', bar_id: 'bar-1', item_id: 'heineken', action: 'TAKEN',
    notes: core.marker, opening_par_v1: true,
  };
  const restored = JSON.parse(JSON.stringify([draft]));
  assert.equal(core.isOpeningDraft(restored[0]), true);
  assert.equal(plan({ items: [items[0]], drafts: restored }).duplicateCount, 1);
  assert.match(html, /reviewDrafts:\s+'barinv_barback_review_drafts'/);
});

test('feature is reversible, defaults OFF, and login projection is additive', () => {
  assert.match(html, /const OPENING_PAR_V1_ENABLED = false;/);
  assert.match(edge, /full_bottle_weight_g, par_level"\)/);
  assert.match(edge, /\.or\("active\.is\.true,active\.is\.null"\)/);
  assert.match(edge, /\.eq\("venue_id", venueId\)/);
});
