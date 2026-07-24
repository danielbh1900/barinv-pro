'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const managerHtml = fs.readFileSync(path.join(root, 'barback_manager.html'), 'utf8');
const barbackHtml = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');
const createEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-create-session/index.ts'), 'utf8');
const loginEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-pin-login/index.ts'), 'utf8');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260720171358_add_barback_sessions_opening_par_config.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end);
  assert.notEqual(a, -1, `missing marker: ${start}`);
  assert.notEqual(b, -1, `missing marker: ${end}`);
  return source.slice(a + start.length, b);
}

function vmCore(source, start, end, exportName) {
  const context = {};
  vm.runInNewContext(
    between(source, start, end) + `\nthis.result = ${exportName};`,
    context,
    { filename: `${exportName}.js` },
  );
  return context.result;
}

const managerCore = vmCore(
  managerHtml,
  '// MANAGER_OPENING_PAR_V1_CORE_START',
  '// MANAGER_OPENING_PAR_V1_CORE_END',
  'ManagerOpeningParV1',
);
const barbackCore = vmCore(
  barbackHtml,
  '// OPENING_PAR_V1_CORE_START',
  '// OPENING_PAR_V1_CORE_END',
  'OpeningParV1',
);

function denoEvalJson(source) {
  const result = spawnSync('deno', ['eval', source], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

const createValidation = denoEvalJson(`
type SessionLinkMode = "bar" | "table";
class SessionInputError extends Error {}
${between(createEdge, '// BARBACK_CREATE_SESSION_VALIDATION_START', '// BARBACK_CREATE_SESSION_VALIDATION_END')}
const items = [
  { id: "heineken", active: true, service_mode: "regular_bar" },
  { id: "corona", active: null, service_mode: "all_bars" },
  { id: "vip", active: true, service_mode: "vip_only" },
  { id: "inactive", active: false, service_mode: "regular_bar" },
];
const areas = [
  { id: "bar-1", bar_type: "bar" },
  { id: "bar-2", bar_type: "bar" },
  { id: "table-1", bar_type: "vip" },
];
const capture = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e.message }; } };
const out = {
  config: capture(() => buildOpeningParConfig(true, [{ item_id: "heineken", qty: 2 }], items, "2026-07-20T17:00:00.000Z")),
  zero: capture(() => buildOpeningParConfig(true, [{ item_id: "heineken", qty: 2 }, { item_id: "corona", qty: 0 }], items, "stamp")),
  negative: capture(() => buildOpeningParConfig(true, [{ item_id: "heineken", qty: -1 }], items, "stamp")),
  decimal: capture(() => buildOpeningParConfig(true, [{ item_id: "heineken", qty: 1.5 }], items, "stamp")),
  nan: capture(() => buildOpeningParConfig(true, [{ item_id: "heineken", qty: NaN }], items, "stamp")),
  duplicate: capture(() => buildOpeningParConfig(true, [{ item_id: "heineken", qty: 1 }, { item_id: "heineken", qty: 2 }], items, "stamp")),
  unknown: capture(() => buildOpeningParConfig(true, [{ item_id: "outside", qty: 1 }], items, "stamp")),
  inactive: capture(() => buildOpeningParConfig(true, [{ item_id: "inactive", qty: 1 }], items, "stamp")),
  vip: capture(() => buildOpeningParConfig(true, [{ item_id: "vip", qty: 1 }], items, "stamp")),
  validBars: capture(() => resolveSessionDestinations("bar", "bar-1", ["bar-2"], areas)),
  invalidArea: capture(() => resolveSessionDestinations("bar", "bar-1", ["outside"], areas)),
  wrongType: capture(() => resolveSessionDestinations("table", "bar-1", ["table-1"], areas)),
};
console.log(JSON.stringify(out));
`);

const loginNormalization = denoEvalJson(`
${between(loginEdge, '// BARBACK_PIN_LOGIN_OPENING_PAR_NORMALIZER_START', '// BARBACK_PIN_LOGIN_OPENING_PAR_NORMALIZER_END')}
const visible = [
  { id: "heineken", active: true, service_mode: "regular_bar" },
  { id: "vip", active: true, service_mode: "vip_only" },
];
const good = { enabled: true, version: 1, configured_at: "stamp", items: [{ item_id: "heineken", qty: 2 }] };
console.log(JSON.stringify({
  legacy: normalizeSessionOpeningPar(null, visible),
  disabled: normalizeSessionOpeningPar({ enabled: false, version: 1, items: [] }, visible),
  good: normalizeSessionOpeningPar(good, visible),
  missing: normalizeSessionOpeningPar({ enabled: true, version: 1, configured_at: "stamp", items: [{ item_id: "outside", qty: 2 }] }, visible),
  vip: normalizeSessionOpeningPar({ enabled: true, version: 1, configured_at: "stamp", items: [{ item_id: "vip", qty: 2 }] }, visible),
  malformed: normalizeSessionOpeningPar({ enabled: true, version: 1, items: [] }, visible),
}));
`);

const masterItems = [
  { id: 'heineken', name: 'Heineken', active: true, service_mode: 'regular_bar', par_level: 4 },
  { id: 'corona', name: 'Corona', active: true, service_mode: 'all_bars', par_level: 3 },
  { id: 'vip', name: 'VIP', active: true, service_mode: 'vip_only', par_level: 9 },
  { id: 'zero', name: 'Zero', active: true, service_mode: 'regular_bar', par_level: 0 },
];

test('1. migration contains only the approved nullable JSONB column and shape constraint', () => {
  assert.match(migration, /add column if not exists opening_par_config jsonb/);
  assert.match(migration, /barback_sessions_opening_par_config_shape/);
  assert.match(migration, /opening_par_config is null/);
  assert.match(migration, /opening_par_config @> '\{"enabled":true,"version":1\}'::jsonb/);
  assert.doesNotMatch(migration, /create\s+(table|index|trigger|policy|function)|default\s+/i);
});

test('2. legacy session with NULL config normalizes to disabled', () => {
  assert.deepEqual(loginNormalization.legacy.value, { enabled: false, version: 1, items: [] });
  assert.equal(loginNormalization.legacy.malformed, false);
});

test('3. Manager disabled mode preserves the legacy request path', () => {
  assert.match(managerHtml, /Disabled mode sends no Opening PAR fields/);
  assert.match(managerHtml, /ManagerOpeningParV1\.buildCreateRequest\([\s\S]*OPENING_PAR_MANAGER_V1_ENABLED/);
  assert.doesNotMatch(
    managerHtml.slice(
      managerHtml.indexOf('const baseCreateRequest = {'),
      managerHtml.indexOf('const createRequest = ManagerOpeningParV1.buildCreateRequest'),
    ),
    /opening_par_/,
  );
});

test('4. enabled Manager intent contains item IDs and quantities only', () => {
  const intent = managerCore.buildEnabledIntent({ heineken: 2, corona: 3 }, 1);
  assert.equal(intent.opening_par_enabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(intent.opening_par_items)), [
    { item_id: 'heineken', qty: 2 },
    { item_id: 'corona', qty: 3 },
  ]);
  assert.equal(Object.hasOwn(intent, 'version'), false);
  assert.equal(Object.hasOwn(intent, 'configured_at'), false);
});

test('5. server constructs version and configured_at', () => {
  assert.equal(createValidation.config.ok, true);
  assert.equal(createValidation.config.value.enabled, true);
  assert.equal(createValidation.config.value.version, 1);
  assert.equal(createValidation.config.value.configured_at, '2026-07-20T17:00:00.000Z');
});

test('6. Admin override 4 to 2 does not mutate Master PAR', () => {
  const heineken = masterItems[0];
  const intent = managerCore.buildEnabledIntent({ heineken: 2 }, 1);
  assert.equal(intent.opening_par_items[0].qty, 2);
  assert.equal(heineken.par_level, 4);
  assert.doesNotMatch(managerHtml, /from\(['"]items['"]\)\s*\.update|\.from\(['"]items['"]\)[\s\S]{0,80}\.update/);
});

test('7. multiple selected bars produce the correct item x bar summary', () => {
  const summary = managerCore.summary({ heineken: 2, corona: 3 }, 3);
  assert.equal(summary.itemCount, 2);
  assert.equal(summary.barCount, 3);
  assert.equal(summary.rowCount, 6);
});

test('8. zero quantity is omitted from the stored snapshot', () => {
  assert.equal(createValidation.zero.ok, true);
  assert.deepEqual(createValidation.zero.value.items, [{ item_id: 'heineken', qty: 2 }]);
});

test('9. negative quantity is rejected', () => {
  assert.equal(createValidation.negative.ok, false);
  assert.match(createValidation.negative.error, /negative/);
});

test('10. decimal quantity is rejected', () => {
  assert.equal(createValidation.decimal.ok, false);
  assert.match(createValidation.decimal.error, /integer/);
});

test('11. NaN/non-numeric quantity is rejected', () => {
  assert.equal(createValidation.nan.ok, false);
  assert.match(createValidation.nan.error, /finite/);
});

test('12. duplicate item IDs are rejected', () => {
  assert.equal(createValidation.duplicate.ok, false);
  assert.match(createValidation.duplicate.error, /duplicate/);
});

test('13. unknown or cross-venue item is rejected', () => {
  assert.equal(createValidation.unknown.ok, false);
  assert.match(createValidation.unknown.error, /unknown|outside/);
});

test('14. inactive item is rejected', () => {
  assert.equal(createValidation.inactive.ok, false);
  assert.match(createValidation.inactive.error, /inactive/);
});

test('15. vip_only item is rejected for regular-bar Opening PAR', () => {
  assert.equal(createValidation.vip.ok, false);
  assert.match(createValidation.vip.error, /regular bars/);
});

test('16. invalid Night is rejected inside the authorized venue', () => {
  assert.match(createEdge, /from\("nights"\)\.select\("id, venue_id, active"\)[\s\S]*\.eq\("id", body\.night_id\)\.eq\("venue_id", body\.venue_id\)/);
  assert.match(createEdge, /night does not belong to the authorised venue/);
  assert.match(createEdge, /This night is closed\. Reopen it in BARINV PRO before creating a Barback session\./);
});

test('17. invalid destination is rejected', () => {
  assert.equal(createValidation.invalidArea.ok, false);
  assert.match(createValidation.invalidArea.error, /not active/);
});

test('18. destination outside the selected Night is rejected', () => {
  assert.match(createEdge, /activeNightIds\.has\(area\.id\)/);
  assert.equal(createValidation.invalidArea.ok, false);
});

test('19. tampered allowed_bars cannot broaden session scope', () => {
  assert.equal(createValidation.validBars.value.effectiveDestinationIds.length, 2);
  assert.equal(createValidation.invalidArea.ok, false);
  assert.match(createEdge, /allowed_bars:\s+allowedBars/);
});

test('20. invalid allowed_staff is rejected through assignment, role, and coverage checks', () => {
  assert.match(createEdge, /night_staff_assignments/);
  assert.match(createEdge, /staffEligibleForSession\(staff, assignment, resolvedMode, activeAreaModeById\)/);
  assert.match(createEdge, /staffHasModeCoverage\(assignment, "table", activeAreaModeById\)/);
  assert.match(createEdge, /not eligible for this venue\/night\/link type/);
});

test('21. Link Type change invalidates a stale regular-bar Manager snapshot', () => {
  assert.match(managerHtml, /Link Type changed\. The previous regular-bar Opening PAR Checklist snapshot was cleared/);
  assert.equal(createValidation.wrongType.ok, false);
});

test('22. Night change clears a stale Manager snapshot', () => {
  assert.match(managerHtml, /Night changed\. The previous Opening PAR Checklist snapshot was cleared/);
  assert.match(managerHtml, /managerOpeningParClear\('Night changed/);
});

test('23. enabled session snapshot is returned by PIN login', () => {
  assert.equal(loginNormalization.good.malformed, false);
  assert.deepEqual(loginNormalization.good.value, {
    enabled: true, version: 1, items: [{ item_id: 'heineken', qty: 2 }],
  });
  assert.match(loginEdge, /opening_par: openingParResult\.value/);
});

test('24. disabled and legacy sessions return the disabled snapshot', () => {
  assert.deepEqual(loginNormalization.disabled.value, { enabled: false, version: 1, items: [] });
  assert.deepEqual(loginNormalization.legacy.value, { enabled: false, version: 1, items: [] });
});

test('25. malformed stored config fails closed without failing login', () => {
  assert.equal(loginNormalization.malformed.value.enabled, false);
  assert.equal(loginNormalization.missing.value.enabled, false);
  assert.equal(loginNormalization.vip.value.enabled, false);
  assert.match(loginEdge, /malformed Opening PAR config; feature disabled for session/);
});

test('26. compile gate is ON and runtime-not-applicable bypasses checklist routing', () => {
  assert.match(barbackHtml, /const OPENING_PAR_V1_ENABLED = true;/);
  assert.match(barbackHtml, /if \(!OPENING_PAR_V1_ENABLED \|\| !state\.jwt \|\| state\.authPath !== 'phase3'\)[\s\S]*return enterMain\(\)/);
  assert.match(barbackHtml, /result\.runtime_enabled !== true \|\| result\.required !== true \|\| result\.completed === true[\s\S]*return enterMain\(\)/);
});

test('27. enabled session plus eventual global gate uses the session snapshot', () => {
  const visible = [{ id: 'heineken', name: 'Heineken', par_level: 99, service_mode: 'regular_bar' }];
  const model = barbackCore.normalizeSessionSnapshot(
    { enabled: true, version: 1, items: [{ item_id: 'heineken', qty: 2 }] },
    visible,
  );
  assert.equal(model.enabled, true);
  assert.equal(model.items[0].opening_par_qty, 2);
});

test('28. Barback checklist has no fallback to live Master PAR', () => {
  const ui = between(barbackHtml, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.doesNotMatch(ui, /item\.par_level|openingParQty/);
  assert.match(ui, /EXPECTED PAR/);
  assert.match(ui, /row\.expectedQty/);
  assert.match(ui, /state\.openingParSession/);
});

test('29. Barback target quantity cannot be overridden', () => {
  const snapshot = { enabled: true, version: 1, items: [{ item_id: 'heineken', qty: 4 }] };
  const visible = [{ id: 'heineken', name: 'Heineken', par_level: 4 }];
  const joined = barbackCore.normalizeSessionSnapshot(snapshot, visible);
  const checklist = barbackCore.buildChecklist({
    items: joined.items,
    destinations: [{ id: 'bar-1' }],
    receipts: [],
    sessionId: 'session-1',
    staffId: 'staff-1',
  });
  assert.equal(checklist.groups[0].rows[0].expectedQty, 4);
  assert.equal(snapshot.items[0].qty, 4);
  assert.equal(visible[0].par_level, 4);
});

test('30. existing TAKEN flow remains wired to addToReview', () => {
  assert.match(barbackHtml, /data-action="TAKEN"/);
  assert.match(barbackHtml, /function addToReview\(payload\)/);
});

test('31. existing RETURN flow remains wired to addToReview', () => {
  assert.match(barbackHtml, /data-action="RETURNED"/);
  assert.match(barbackHtml, /action:\s*state\.selectedAction/);
  assert.match(barbackHtml, /function addToReview\(payload\)/);
});

test('32. existing PARTIAL restrictions remain unchanged', () => {
  assert.match(barbackHtml, /bottleState === 'PARTIAL' && multiBarDestCount\(\) > 1/);
  assert.doesNotMatch(between(barbackHtml, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END'), /bottle_state|addToReview/);
});

test('33. Review Edit/Delete remains Drafts-backed', () => {
  assert.match(barbackHtml, /function onDraftDelete\(ce\)/);
  assert.match(barbackHtml, /Drafts\.removeById\(ce\)/);
  assert.match(barbackHtml, /function onDraftEditSave\(ce, form\)/);
});

test('34. Submit All payload schema remains unchanged', () => {
  const start = barbackHtml.indexOf('async function submitAllDraftsToBarinv()');
  const submit = barbackHtml.slice(start, barbackHtml.indexOf('// Keep the SUBMIT ALL button label', start));
  assert.match(submit, /drafted_at, opening_par_v1, weight_g/);
  assert.match(submit, /Outbox\.push\(rec\)/);
  assert.doesNotMatch(between(barbackHtml, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END'), /eventsInsert\(/);
});

test('35. reload reconstruction uses persisted checklist receipts, not local drafts', () => {
  const receipt = { destination_id: 'bar-1', staff_id: 'staff-1', item_id: 'heineken', expected_quantity: 2, received_quantity: 2, confirmed_at: 'stamp' };
  const checklist = barbackCore.buildChecklist({
    items: [{ id: 'heineken', opening_par_qty: 2 }],
    destinations: [{ id: 'bar-1' }],
    receipts: [receipt], sessionId: 'session-1', staffId: 'staff-1',
  });
  assert.equal(checklist.confirmedCount, 1);
  const ui = between(barbackHtml, '// OPENING_PAR_V1_UI_START', '// OPENING_PAR_V1_UI_END');
  assert.match(ui, /openingParChecklistInvoke\('status'\)/);
  assert.doesNotMatch(ui, /Drafts\.|Outbox\./);
});

test('36. Master PAR changes after link creation do not change the stored session snapshot', () => {
  const visible = [{ id: 'heineken', par_level: 12, service_mode: 'regular_bar' }];
  const model = barbackCore.normalizeSessionSnapshot(
    { enabled: true, version: 1, items: [{ item_id: 'heineken', qty: 2 }] },
    visible,
  );
  assert.equal(model.items[0].opening_par_qty, 2);
  assert.equal(visible[0].par_level, 12);
});

test('37. Manager Opening PAR rollout gate remains ON', () => {
  assert.match(managerHtml, /const OPENING_PAR_MANAGER_V1_ENABLED = true;/);
});

test('38. disabled Manager gate keeps the Opening PAR card hidden and controls disabled', () => {
  assert.match(managerHtml, /id="c-opening-par-card" style="display:none;" aria-hidden="true"/);
  assert.match(managerHtml, /card\.querySelectorAll\('button,input,select,textarea'\)[\s\S]*control\.disabled = true/);
  assert.match(managerHtml, /if \(!enforceManagerOpeningParRolloutGate\(\)\) return;/);
});

test('39. disabled Manager gate strips all Opening PAR request fields', () => {
  const classic = { venue_id: 'venue-1', night_id: 'night-1', allowed_bars: ['bar-1'] };
  const forgedIntent = {
    opening_par_enabled: true,
    opening_par_items: [{ item_id: 'heineken', qty: 2 }],
  };
  const request = managerCore.buildCreateRequest(classic, false, forgedIntent);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), classic);
  assert.equal(Object.hasOwn(request, 'opening_par_enabled'), false);
  assert.equal(Object.hasOwn(request, 'opening_par_items'), false);
});

test('40. disabled Manager gate ignores stale Opening PAR state', () => {
  const staleIntent = managerCore.buildEnabledIntent({ heineken: 2 }, 1);
  const request = managerCore.buildCreateRequest({ nickname: 'Classic' }, false, staleIntent);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { nickname: 'Classic' });
  assert.match(managerHtml, /op\.loaded = false;[\s\S]*op\.items = \[\];[\s\S]*op\.quantities = \{\};/);
});

test('41. disabled Manager gate preserves the complete Classic request object', () => {
  const classic = {
    venue_id: 'venue-1', night_id: 'night-1', bar_id: 'bar-1',
    allowed_bars: ['bar-2'], allowed_staff: ['staff-1'], link_type: 'bar',
    nickname: 'Classic', expires_at: '2026-07-21T00:00:00.000Z',
    pin_rotate_for: ['staff-1'], public_url_base: 'https://example.test',
  };
  const request = managerCore.buildCreateRequest(classic, false, {
    opening_par_enabled: true,
    opening_par_items: [{ item_id: 'heineken', qty: 2 }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(request)), classic);
});

test('42. DOM or console-state manipulation cannot bypass request-time gating', () => {
  assert.match(
    managerHtml,
    /buildCreateRequest\(\s*baseCreateRequest,\s*OPENING_PAR_MANAGER_V1_ENABLED,\s*openingParIntent/,
  );
  assert.match(managerHtml, /if \(!enforceManagerOpeningParRolloutGate\(\)\) return null;/);
  const tampered = managerCore.buildCreateRequest({}, false, {
    opening_par_enabled: true,
    opening_par_items: [{ item_id: 'tampered', qty: 999 }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(tampered)), {});
});

test('43. enabled Manager gate with checkbox/config disabled sends no Opening PAR fields', () => {
  const request = managerCore.buildCreateRequest({ venue_id: 'venue-1' }, true, null);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { venue_id: 'venue-1' });
  assert.match(managerHtml, /const checkboxEnabled = !!\(\$\('c-opening-par-enabled'\)[\s\S]*\.checked\)/);
});

test('44. enabled Manager gate preserves the compact validated Opening PAR contract', () => {
  const intent = managerCore.buildEnabledIntent({ heineken: 2, corona: 0 }, 3);
  const request = managerCore.buildCreateRequest({ venue_id: 'venue-1' }, true, intent);
  assert.equal(request.opening_par_enabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(request.opening_par_items)), [
    { item_id: 'heineken', qty: 2 },
  ]);
  assert.equal(Object.hasOwn(request, 'version'), false);
  assert.equal(Object.hasOwn(request, 'configured_at'), false);
});

test('45. enabled Manager gate retains Night and Link Type stale-snapshot clearing', () => {
  assert.match(managerHtml, /Night changed\. The previous Opening PAR Checklist snapshot was cleared/);
  assert.match(managerHtml, /Link Type changed\. The previous regular-bar Opening PAR Checklist snapshot was cleared/);
  assert.match(managerHtml, /if \(OPENING_PAR_MANAGER_V1_ENABLED && \$\('c-opening-par-enabled'\)\)/);
});

test('46. Manager and Barback compile gates remain ON', () => {
  assert.match(managerHtml, /const OPENING_PAR_MANAGER_V1_ENABLED = true;/);
  assert.match(barbackHtml, /const OPENING_PAR_V1_ENABLED = true;/);
});
