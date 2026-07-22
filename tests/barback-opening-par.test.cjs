'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'barback_manager.html'), 'utf8');
const loginEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-pin-login/index.ts'), 'utf8');
const checklistEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-opening-par-checklist/index.ts'), 'utf8');
const managerEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-manager-sessions/index.ts'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260722063733_barback_opening_par_checklist_persistence.sql'),
  'utf8',
);

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end);
  assert.notEqual(a, -1, `missing marker: ${start}`);
  assert.notEqual(b, -1, `missing marker: ${end}`);
  return source.slice(a + start.length, b);
}

const coreContext = {};
vm.runInNewContext(
  between(html, '// OPENING_PAR_V1_CORE_START', '// OPENING_PAR_V1_CORE_END') +
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
    sessionId: 'session-1', staffId: 'staff-1', items: model.items,
    destinations: [destinations[0]], receipts: [], ...overrides,
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

test('1. session snapshot remains the read-only Expected PAR source', () => {
  assert.equal(model.enabled, true);
  assert.equal(model.items[0].opening_par_qty, 4);
  visibleItems[0].par_level = 123;
  assert.equal(model.items[0].opening_par_qty, 4);
});

test('2. all assigned destinations create independent required rows', () => {
  const result = checklist({ destinations: [destinations[0], destinations[1], destinations[0]] });
  assert.equal(result.destinationCount, 2);
  assert.equal(result.rowCount, 4);
  assert.equal(result.groups[1].destination.id, 'dispatch-1');
});

test('3. receipt identity includes session, destination, staff, and item', () => {
  assert.equal(core.checklistKey('s', 'd', 'staff-a', 'i'), 's|d|staff-a|i');
  assert.notEqual(core.checklistKey('s', 'd', 'staff-a', 'i'), core.checklistKey('s', 'd', 'staff-b', 'i'));
  assert.match(migration, /PRIMARY KEY \(session_id, destination_id, staff_id, item_id\)/);
});

test('4. two staff sharing one session have independent progress', () => {
  const receipt = {
    destination_id: 'bar-1', staff_id: 'staff-a', item_id: 'heineken',
    expected_quantity: 4, received_quantity: 4, confirmed_at: 'first',
  };
  const staffA = checklist({ staffId: 'staff-a', receipts: [receipt] });
  const staffB = checklist({ staffId: 'staff-b', receipts: [receipt] });
  assert.equal(staffA.confirmedCount, 1);
  assert.equal(staffB.confirmedCount, 0);
});

test('5. duplicate receipt reconstruction preserves the original timestamp', () => {
  const receipt = {
    destination_id: 'bar-1', staff_id: 'staff-1', item_id: 'heineken',
    expected_quantity: 4, received_quantity: 7, confirmed_at: 'first',
  };
  const result = checklist({ receipts: [receipt, { ...receipt, confirmed_at: 'second' }] });
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.groups[0].rows[0].receipt.confirmed_at, 'first');
  assert.match(migration, /ON CONFLICT \(session_id, destination_id, staff_id, item_id\) DO NOTHING/);
  assert.doesNotMatch(migration, /DO UPDATE SET/);
});

test('6. concurrent final confirmations are serialized and completion is unique', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /PRIMARY KEY \(session_id, staff_id\)/);
  assert.match(migration, /INSERT INTO public\.barback_opening_par_completions[\s\S]*ON CONFLICT \(session_id, staff_id\) DO NOTHING/);
});

test('7. Received quantity accepts shortage, zero, exact, and overage whole counts', () => {
  for (const input of ['0', '7', '10', '12']) assert.equal(core.parseReceivedQuantity(input), input);
  for (const input of ['', '-1', '1.5', '2e3', 'abc']) assert.equal(core.parseReceivedQuantity(input), null);
  assert.equal(core.parseReceivedQuantity('90071992547409931234567890'), '90071992547409931234567890');
  assert.deepEqual(JSON.parse(JSON.stringify(core.variance(10, 10))), { delta: '0', status: 'match', label: 'MATCH' });
  assert.deepEqual(JSON.parse(JSON.stringify(core.variance(10, 7))), { delta: '-3', status: 'short', label: 'SHORT 3' });
  assert.deepEqual(JSON.parse(JSON.stringify(core.variance(10, 0))), { delta: '-10', status: 'short', label: 'SHORT 10' });
  assert.deepEqual(JSON.parse(JSON.stringify(core.variance(10, 12))), { delta: '2', status: 'over', label: 'OVER 2' });
});

test('8. Expected and Received quantities are persisted independently', () => {
  assert.match(migration, /expected_quantity\s+integer\s+NOT NULL CHECK \(expected_quantity > 0\)/);
  assert.match(migration, /received_quantity\s+numeric\s+NOT NULL[\s\S]*received_quantity >= 0 AND received_quantity = trunc\(received_quantity\)/);
  assert.match(migration, /received_quantity text,[\s\S]*variance text,/);
  assert.match(checklistEdge, /received_quantity:received_quantity::text/);
  assert.match(migration, /v_expected_quantity, p_received_quantity/);
  assert.match(checklistEdge, /body\?\.expected_quantity !== undefined/);
});

test('9. dedicated checklist is non-dismissible and precedes Classic entry', () => {
  const screen = html.slice(html.indexOf('id="screen-opening-par-checklist"'), html.indexOf('id="screen-main"'));
  assert.match(screen, /OPENING PAR CHECKLIST/);
  assert.doesNotMatch(screen, /CLOSE CHECKLIST|Cancel|Back/);
  assert.match(html, /await routeAfterAuthenticatedLogin\(\)/);
  assert.match(html, /Opening PAR must be completed before normal inventory operations/);
});

test('10. status failure is fail-closed and supports retry', () => {
  const ui = between(html, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.match(ui, /state\.openingParClassicUnlocked = false/);
  assert.match(ui, /Opening PAR status could not be verified/);
  assert.match(ui, /opening-par-retry/);
});

test('11. resume loads staff-scoped persisted receipts from status', () => {
  const ui = between(html, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.match(ui, /openingParChecklistInvoke\('status'\)/);
  assert.match(ui, /cacheOpeningParReceipts\(result\.receipts \|\| \[\]\)/);
  assert.doesNotMatch(ui, /Drafts\.|Outbox\.|eventsInsert/);
  assert.match(checklistEdge, /\.eq\("session_id", sessionId\)\.eq\("staff_id", staffId\)/);
});

test('12. completed staff bypasses the checklist on subsequent login', () => {
  const ui = between(html, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.match(ui, /result\.completed === true[\s\S]*state\.openingParClassicUnlocked = true[\s\S]*return enterMain\(\)/);
  assert.match(ui, /Opening PAR Complete/);
});

test('13. browser confirmation sends actual quantity but never Expected PAR', () => {
  const ui = between(html, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.match(ui, /received_quantity: receivedQuantity/);
  assert.doesNotMatch(ui, /expected_quantity:/);
  assert.match(checklistEdge, /p_received_quantity: receivedQuantity/);
});

test('14. checklist API derives both session and staff from signed authorization', () => {
  const ui = between(html, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.match(checklistEdge, /session and staff are derived from authorization/);
  assert.match(checklistEdge, /claims\.sub !== sessionId/);
  assert.match(checklistEdge, /claims\.barback_role !== "barback"/);
  assert.match(ui, /row\.staff_id !== state\.staffId/);
});

test('15. default-deny RLS and service-only RPC prevent browser table writes', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(migration, /REVOKE ALL ON TABLE public\.barback_opening_par_receipts[\s\S]*FROM PUBLIC, anon, authenticated, barback_user/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.barback_confirm_opening_par[\s\S]*FROM PUBLIC, anon, authenticated, barback_user/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.barback_confirm_opening_par[\s\S]*TO service_role/);
});

test('16. runtime-gated restrictive policy leaves the existing event policy unchanged', () => {
  assert.match(migration, /barback_opening_par_runtime_enabled/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS barback_opening_par_enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration, /SELECT v\.barback_opening_par_enabled/);
  assert.doesNotMatch(migration, /public\.feature_flags/);
  assert.match(migration, /CREATE POLICY events_opening_par_completion_gate[\s\S]*AS RESTRICTIVE/);
  assert.match(migration, /IF NOT public\.barback_opening_par_runtime_enabled\(v_venue_id\)[\s\S]*RETURN true/);
  assert.doesNotMatch(migration, /DROP POLICY.*events_barback_insert/i);
});

test('17. Manager reporting returns separate progress and visible variance data', () => {
  assert.match(managerEdge, /opening_par_progress/);
  assert.match(managerEdge, /variance_status/);
  assert.match(managerEdge, /short_count/);
  assert.match(managerEdge, /over_count/);
  assert.match(manager, /Opening PAR shortages \/ overages/);
});

test('18. Classic TAKEN and RETURN draft paths remain functional', () => {
  const first = addToReviewHarness();
  assert.equal(first.context.addToReview({ item_id: 'heineken', item_name: 'Heineken', qty: 2, action: 'TAKEN', bar_id: 'bar-1', notes: '' }).ok, true);
  assert.equal(first.captured[0].action, 'TAKEN');
  const second = addToReviewHarness();
  assert.equal(second.context.addToReview({ item_id: 'heineken', item_name: 'Heineken', qty: 642.5, action: 'RETURNED', bar_id: 'bar-1', notes: '' }).ok, true);
  assert.equal(second.captured[0].action, 'RETURNED');
});

test('19. Partial, Review, Drafts, and Outbox code remains outside checklist code', () => {
  const ui = between(html, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.doesNotMatch(ui, /bottle_state|addToReview|Drafts\.|Outbox\.|eventsInsert/);
  assert.match(html, /bottleState === 'PARTIAL' && multiBarDestCount\(\) > 1/);
  assert.match(html, /function onDraftEditSave\(ce, form\)/);
  assert.match(html, /async function submitAllDraftsToBarinv\(\)/);
});

test('20. Manager gate remains on and Barback compile gate remains off', () => {
  assert.match(manager, /const OPENING_PAR_MANAGER_V1_ENABLED = true;/);
  assert.match(html, /const OPENING_PAR_V1_ENABLED = false;/);
  assert.match(loginEdge, /opening_par: openingParResult\.value/);
});

test('21. an incomplete staff member cannot insert Classic events while enforcement is on', () => {
  assert.match(migration, /IF NOT public\.barback_opening_par_runtime_enabled\(v_venue_id\) THEN\s+RETURN true;/);
  assert.match(migration, /RETURN EXISTS \(\s+SELECT 1\s+FROM public\.barback_opening_par_completions AS c\s+WHERE c\.session_id = v_session_id AND c\.staff_id = v_staff_id\s+\);/);
  assert.match(migration, /WITH CHECK \(public\.barback_opening_par_classic_unlocked\(\)\)/);
});

test('22. one completed staff member never unlocks another staff member in the same session', () => {
  const completionLookup = migration.match(/RETURN EXISTS \([\s\S]*?\n  \);/);
  assert.ok(completionLookup);
  assert.match(completionLookup[0], /c\.session_id = v_session_id/);
  assert.match(completionLookup[0], /c\.staff_id = v_staff_id/);
  assert.doesNotMatch(completionLookup[0], /OR c\.staff_id/);
});

test('23. runtime gate off preserves Classic event behavior', () => {
  assert.match(migration, /IF NOT public\.barback_opening_par_runtime_enabled\(v_venue_id\) THEN\s+RETURN true;\s+END IF;/);
  assert.match(migration, /barback_opening_par_enabled boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(migration, /DROP POLICY.*events_barback_insert/i);
  const gateCheck = migration.indexOf('IF NOT public.barback_opening_par_runtime_enabled(v_venue_id)');
  const sessionClaimCheck = migration.indexOf("v_session_id := NULLIF(v_claims ->> 'session_id'");
  assert.ok(gateCheck > 0 && sessionClaimCheck > gateCheck);
});
