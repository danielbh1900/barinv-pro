'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'barback_manager.html'), 'utf8');
const createEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-create-session/index.ts'), 'utf8');
const managerAuth = fs.readFileSync(path.join(root, 'supabase/functions/_shared/manager.ts'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end);
  assert.notEqual(a, -1, `missing marker: ${start}`);
  assert.notEqual(b, -1, `missing marker: ${end}`);
  return source.slice(a + start.length, b);
}

const context = {};
vm.runInNewContext(
  between(manager, '// MANAGER_VENUE_SELECTION_V1_CORE_START', '// MANAGER_VENUE_SELECTION_V1_CORE_END') +
    '\nthis.scope = ManagerVenueSelectionV1;',
  context,
);
const scope = context.scope;

const memberships = [
  { venue_id: 'event', role: 'admin' },
  { venue_id: 'theatre', role: 'owner' },
  { venue_id: 'staff-only', role: 'staff' },
  { venue_id: 'viewer-only', role: 'viewer' },
];
const venues = [
  { id: 'event', name: 'Harbour Event & Convention Centre' },
  { id: 'theatre', name: 'Harbour Theatre' },
  { id: 'staff-only', name: 'Staff Venue' },
  { id: 'viewer-only', name: 'Viewer Venue' },
  { id: 'unrelated', name: 'Unrelated Venue' },
];
const authorized = scope.authorizedMemberships(memberships, venues);

test('1. multi-venue Manager sees only manager/admin/owner memberships', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(authorized)),
    [
      { id: 'event', name: 'Harbour Event & Convention Centre', role: 'admin' },
      { id: 'theatre', name: 'Harbour Theatre', role: 'owner' },
    ],
  );
  assert.match(manager, /\.eq\('user_id', state\.user\.id\)[\s\S]*\.in\('role', MANAGER_VENUE_ROLES\)/);
});

test('2. saved authorized preference is restored first', () => {
  assert.equal(scope.chooseInitial(authorized, 'theatre', 'event'), 'theatre');
  assert.match(manager, /localStorage\.getItem\('barinv_manager_venue_id'\)/);
});

test('3. unauthorized saved preference is rejected and removed', () => {
  assert.equal(scope.chooseInitial(authorized, 'unrelated', 'event'), 'event');
  assert.match(manager, /savedVenueId !== selectedVenueId[\s\S]*removeItem\('barinv_manager_venue_id'\)/);
});

test('4. legacy staff venue is used only when authorized', () => {
  assert.equal(scope.chooseInitial(authorized, null, 'event'), 'event');
  assert.equal(scope.chooseInitial(authorized, null, 'unrelated'), 'event');
  assert.doesNotMatch(manager, /state\.venueId\s*=\s*state\.staff\.venue_id/);
});

test('5. first authorized venue is the final fallback', () => {
  assert.equal(scope.chooseInitial(authorized, null, null), 'event');
});

test('6. venue switch clears every venue-scoped in-memory value', () => {
  const dirty = {
    venueName: 'Old',
    nights: ['night'],
    allNights: ['night'],
    bars: ['bar'],
    staffList: ['staff'],
    nightAssignments: ['assignment'],
    nightDestinationIds: ['destination'],
    destinationCustomization: true,
    lastCreate: { secret: 'not-retained' },
    credentialReveal: { link: true, qr: true, pins: new Set(['staff']) },
    openingPar: { enabled: true, loaded: true, items: ['item'] },
  };
  const cleared = scope.clearScopedState(dirty);
  assert.deepEqual(Array.from(cleared.nights), []);
  assert.deepEqual(Array.from(cleared.staffList), []);
  assert.deepEqual(Array.from(cleared.nightDestinationIds), []);
  assert.equal(cleared.destinationCustomization, false);
  assert.equal(cleared.lastCreate, null);
  assert.equal(cleared.openingPar.loaded, false);
  assert.equal(cleared.credentialReveal.link, false);
});

test('7. venue switch validates, persists, and reloads selected context', () => {
  const switchStart = manager.indexOf('async function switchManagerVenue');
  const switchEnd = manager.indexOf("$('manager-venue-selector')?.addEventListener", switchStart);
  const switchBody = manager.slice(switchStart, switchEnd);
  assert.match(switchBody, /fetchAuthorizedManagerVenues\(\)/);
  assert.match(switchBody, /clearManagerVenueScopedState\(\)/);
  assert.match(switchBody, /state\.venueId = selected\.id/);
  assert.match(switchBody, /localStorage\.setItem\('barinv_manager_venue_id', selected\.id\)/);
  assert.match(switchBody, /await loadVenueContext\(\)/);
});

test('8. Manager requests use the newly selected venue and revalidate membership', () => {
  assert.match(manager, /async function fnInvoke\(path, body\) \{\s*await assertSelectedManagerVenueAuthorized\(\)/);
  assert.match(manager, /venue_id:\s+state\.venueId/);
  assert.match(manager, /\.eq\('venue_id', state\.venueId\)[\s\S]*\.in\('role', MANAGER_VENUE_ROLES\)/);
  assert.match(manager, /fnInvoke\('barback-extend-session', \{[\s\S]*?venue_id: state\.venueId/);
  assert.match(manager, /fnInvoke\('barback-revoke-session', \{[\s\S]*?session_id: r\.id,[\s\S]*?venue_id: state\.venueId/);
});

test('9. stale prior-venue DOM results are removed before reload', () => {
  const clearBody = manager.slice(manager.indexOf('function clearManagerVenueScopedState'), manager.indexOf('async function fetchAuthorizedManagerVenues'));
  for (const id of [
    'c-night', 'c-bar', 'c-allowed-bars', 'c-staff', 'sessions-list',
    'diag-list', 'diag-analytics', 'audit-list', 'pilot-night', 'c-result-card',
    'c-url', 'c-pins', 'qr-out',
  ]) assert.match(clearBody, new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('10. single-venue Manager keeps the authorized legacy behavior', () => {
  const single = [authorized[0]];
  assert.equal(scope.chooseInitial(single, null, 'event'), 'event');
  assert.match(manager, /selector\.disabled = \(state\.authorizedVenues \|\| \[\]\)\.length <= 1/);
});

test('11. zero-membership state fails safely without selecting a venue', () => {
  assert.equal(scope.chooseInitial([], 'event', 'event'), null);
  assert.match(manager, /No manager-authorized venues are assigned to this account\./);
  assert.match(manager, /Selected venue access is no longer authorized\./);
});

test('12. existing server-side Manager authorization remains authoritative', () => {
  assert.match(createEdge, /await requireVenueManager\(mgr, svc, body\.venue_id\)/);
  assert.match(managerAuth, /userClient[\s\S]*rpc\("has_venue_access", params\)/);
  assert.match(managerAuth, /\.from\("venue_members"\)[\s\S]*\.eq\("user_id", ctx\.userId\)[\s\S]*\.eq\("venue_id", venueId\)/);
});
