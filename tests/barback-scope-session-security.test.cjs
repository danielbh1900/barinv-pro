'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'barback_manager.html'), 'utf8');
const barback = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');
const createEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-create-session/index.ts'), 'utf8');
const listEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-manager-sessions/index.ts'), 'utf8');
const revokeEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-revoke-session/index.ts'), 'utf8');
const checklistEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-opening-par-checklist/index.ts'), 'utf8');
const persistenceMigration = fs.readFileSync(
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

const scopeContext = {};
vm.runInNewContext(
  between(manager, '// MANAGER_DESTINATION_SCOPE_V1_CORE_START', '// MANAGER_DESTINATION_SCOPE_V1_CORE_END') +
    '\nthis.scope = ManagerDestinationScopeV1;',
  scopeContext,
);
const scope = scopeContext.scope;

const active = [
  { id: 'b1', name: 'B1-B1', bar_type: 'bar' },
  { id: 'b2', name: 'B1-B2', bar_type: 'bar' },
  { id: 'dispatch', name: 'Dispatch', bar_type: 'dispatch' },
  { id: 'vip', name: 'VIP 1', bar_type: 'vip' },
];
const assignments = [
  { staff_id: 'dussan', role: 'barback', allowed_bar_ids: ['b1', 'b2'], revoked: false },
  { staff_id: 'alex', role: 'barback', allowed_bar_ids: ['b2', 'dispatch'], revoked: false },
  { staff_id: 'old', role: 'barback', allowed_bar_ids: ['b1'], revoked: true },
];

test('1. selecting Dussan selects B1-B1 and B1-B2', () => {
  assert.deepEqual(Array.from(scope.derive(['dussan'], assignments, active, 'bar').destinationIds), ['b1', 'b2']);
});

test('2. multiple selected staff produce the destination union', () => {
  assert.deepEqual(Array.from(scope.derive(['dussan', 'alex'], assignments, active, 'bar').destinationIds), ['b1', 'b2', 'dispatch']);
});

test('3. deselecting staff removes only destinations no longer referenced', () => {
  assert.deepEqual(Array.from(scope.derive(['alex'], assignments, active, 'bar').destinationIds), ['b2', 'dispatch']);
});

test('4. a shared destination remains selected', () => {
  assert.equal(scope.derive(['alex'], assignments, active, 'bar').destinationIds.includes('b2'), true);
});

test('5. duplicate assignment destinations are removed', () => {
  const duplicated = assignments.concat({ staff_id: 'dussan', role: 'barback', allowed_bar_ids: ['b1'] });
  assert.deepEqual(Array.from(scope.derive(['dussan'], duplicated, active, 'bar').destinationIds), ['b1', 'b2']);
});

test('6. exactly one destination becomes primary and is not duplicated', () => {
  const one = scope.derive(
    ['solo'],
    [{ staff_id: 'solo', role: 'barback', allowed_bar_ids: ['b1'] }],
    active,
    'bar',
  );
  assert.equal(one.primaryId, 'b1');
  assert.deepEqual(Array.from(one.additionalIds), []);
  assert.deepEqual(JSON.parse(JSON.stringify(scope.submittedScope('b1', ['b1', 'b2']))), { primaryId: 'b1', additionalIds: ['b2'] });
});

test('7. Barback/Bars excludes bartender-only and includes active VIP Table bussers', () => {
  const bartender = { staff_id: 'bartender', role: 'bartender', allowed_bar_ids: ['b1'], revoked: false };
  const busser = { staff_id: 'busser', role: 'busser', allowed_bar_ids: ['vip'], revoked: false };
  assert.equal(scope.roleEligible({ role: 'bartender', active: true }, bartender, 'bar', active), false);
  assert.equal(scope.roleEligible({ role: 'busser', active: true }, busser, 'bar', active), true);
  assert.match(manager, /barRoles:\s*\['barback'\]/);
  assert.match(createEdge, /SESSION_BAR_ROLE_KEYWORDS = \["barback"\]/);
  assert.doesNotMatch(createEdge, /SESSION_BAR_ROLE_KEYWORDS = \[[^\]]*"bartender"/);
});

test('8. non-bar operational destinations are supported without hardcoding', () => {
  assert.equal(scope.destinationMode(active[2]), 'bar');
  assert.equal(scope.derive(['alex'], assignments, active, 'bar').destinationIds.includes('dispatch'), true);
  assert.match(createEdge, /Any active,[\s\S]*future operational type/);
});

test('9. customization is explicit and warns about an assignment exception', () => {
  assert.match(manager, /id="c-customize-destinations"/);
  assert.match(manager, /This creates a session-specific exception to the BARINV PRO night assignment\./);
});

test('10. final staff and destination scope is reviewed before submission', () => {
  assert.match(manager, /id="c-scope-review"/);
  assert.match(manager, /const scope = currentManagerDestinationScope\(\)/);
  assert.match(manager, /const allowedStaff = selectedManagerStaffIds\(\)/);
});

test('11. inactive nights are omitted by default and optionally labelled CLOSED', () => {
  assert.match(manager, /filter\(night => showClosed \|\| night\.active !== false\)/);
  assert.match(manager, /night\.active === false \? ' · CLOSED'/);
  assert.match(manager, /id="c-show-closed-nights"/);
});

test('12. inactive-night submission is disabled client-side', () => {
  assert.match(manager, /\$\('c-create'\)\.disabled = !night \|\| closed/);
  assert.match(manager, /This night is closed\. Reopen it in BARINV PRO before creating a Barback session\./);
});

test('13. inactive-night submission is rejected server-side', () => {
  assert.match(createEdge, /select\("id, venue_id, active"\)/);
  assert.match(createEdge, /scopedNight\.active === false/);
  assert.match(createEdge, /This night is closed\. Reopen it in BARINV PRO before creating a Barback session\./);
});

test('14. Manager session listing is server-mediated with no view/table fallback', () => {
  const render = manager.slice(manager.indexOf('async function renderSessions'), manager.indexOf("$('sessions-refresh')"));
  assert.match(render, /fnInvoke\('barback-manager-sessions'/);
  assert.doesNotMatch(render, /v_barback_session_summary|from\('barback_sessions'\)/);
});

test('15. session listing requires authenticated venue-manager authorization', () => {
  assert.match(listEdge, /authenticateManager\(req, svc\)/);
  assert.match(listEdge, /requireVenueManager\(manager, svc, body\.venue_id\)/);
  assert.match(listEdge, /\.eq\("venue_id", body\.venue_id\)/);
});

test('16. session list selects and returns no credential fields', () => {
  const selected = listEdge.match(/\.select\(\s*"([^"]+)"/)[1];
  assert.doesNotMatch(selected, /token|pin|url|jwt|secret|code/i);
  const responseStart = listEdge.indexOf('return jsonResponse({ sessions });');
  assert.ok(responseStart > 0);
  assert.doesNotMatch(listEdge.slice(listEdge.indexOf('const sessions ='), responseStart), /token|pin|generated_url|jwt|secret/i);
});

test('17. exact-session revoke requires UUID, venue, and current non-revoked state', () => {
  assert.match(revokeEdge, /valid exact session_id required/);
  assert.match(revokeEdge, /\.eq\("id", body\.session_id\)[\s\S]*\.eq\("venue_id", body\.venue_id\)[\s\S]*\.is\("revoked_at", null\)/);
  assert.doesNotMatch(revokeEdge, /\.in\("id"|revoke_all|bulk/i);
});

test('18. revoke records manager identity and an audit action', () => {
  assert.match(revokeEdge, /revoked_by: manager\.staffId/);
  assert.match(revokeEdge, /action: "session_revoked"/);
  assert.match(revokeEdge, /exact_session: true/);
});

test('19. already-revoked and cross-venue attempts fail safely', () => {
  assert.match(revokeEdge, /session not found in venue or already revoked/);
  assert.match(revokeEdge, /409/);
});

test('20. Manager exposes only exact-session revoke controls', () => {
  assert.match(manager, /REVOKE EXACT SESSION/);
  assert.doesNotMatch(manager, /sessions-bulk-revoke|dz-revoke-all|dz-close-night/);
});

test('21. generated PIN, link, and QR are masked or collapsed by default', () => {
  assert.match(manager, /maskedGeneratedLink\(\)/);
  assert.match(manager, /data-staff-id=/);
  assert.doesNotMatch(manager, /data-pin-val=/);
  assert.match(manager, /id="qr-out" style="display:none/);
});

test('22. reveal controls require explicit warnings', () => {
  assert.match(manager, /Reveal this one-time PIN\?/);
  assert.match(manager, /Reveal the generated session link\?/);
  assert.match(manager, /Reveal the QR code\?/);
});

test('23. copy uses the in-memory secret without leaving it displayed', () => {
  assert.match(manager, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(manager, /Link copied without revealing it/);
  assert.match(manager, /navigator\.clipboard\.writeText\(val\)/);
});

test('24. credentials re-hide when leaving or creating another result', () => {
  assert.match(manager, /if \(name !== 'create'\) hideGeneratedCredentials\(true\)/);
  assert.match(manager, /hideGeneratedCredentials\(true\);[\s\S]*GENERATING/);
});

test('25. checklist authorization derives session identity from signed JWT', () => {
  assert.match(checklistEdge, /decodeJwt\(\s*authorization\.slice\(7\)\.trim\(\),\s*getSupabaseJwtSecret\(\)/);
  assert.match(checklistEdge, /session and staff are derived from authorization/);
  assert.match(checklistEdge, /claims\.role !== "barback_user"/);
});

test('26. checklist rejects revoked, expired, closed-night, cross-staff, and out-of-scope requests', () => {
  for (const expected of [
    /session\.revoked_at/, /session expired/, /night\.active === false/,
    /staff is outside this session/, /destination is outside this session/,
    /item is outside this Opening PAR snapshot/,
  ]) assert.match(checklistEdge, expected);
  assert.match(checklistEdge, /!Array\.isArray\(session\.allowed_staff\)/);
});

test('27. confirmation is retry-safe and cannot change target quantity', () => {
  assert.match(checklistEdge, /barback_confirm_opening_par/);
  assert.match(checklistEdge, /Expected PAR is read-only/);
  assert.match(persistenceMigration, /ON CONFLICT \(session_id, destination_id, staff_id, item_id\) DO NOTHING/);
  assert.match(persistenceMigration, /confirmation retry could not be reconstructed/);
  assert.doesNotMatch(checklistEdge, /update\(\{[^}]*qty/);
});

test('28. Confirm All remains client-side and no bulk server confirmation path exists', () => {
  assert.match(barback, /Confirm All/);
  assert.doesNotMatch(checklistEdge, /Confirm All|confirm_all|confirmAll/);
});

test('29. rollout compile gates remain Manager true and Barback true', () => {
  assert.match(manager, /const OPENING_PAR_MANAGER_V1_ENABLED = true;/);
  assert.match(barback, /const OPENING_PAR_V1_ENABLED = true;/);
});

test('30. create-session rejects empty staff/destination scopes and assignment tampering', () => {
  assert.match(createEdge, /at least one allowed_staff member is required/);
  assert.match(createEdge, /at least one validated destination is required/);
  assert.match(createEdge, /selected destination is not assigned to allowed_staff/);
});

test('31. checklist JWT identity binds subject and Barback role to the session claim', () => {
  assert.match(checklistEdge, /claims\.barback_role !== "barback"/);
  assert.match(checklistEdge, /claims\.sub !== sessionId/);
});

test('32. revoke audit failure triggers an exact guarded rollback', () => {
  assert.match(revokeEdge, /session audit failed; revocation rolled back/);
  assert.match(revokeEdge, /\.eq\("revoked_at", revokedAt\)/);
});

test('33. verified baseline and one authored checklist migration are present', () => {
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql'));
  assert.equal(migrations.length, 88);
  assert.ok(migrations.includes('20260720171358_add_barback_sessions_opening_par_config.sql'));
  assert.ok(migrations.includes('20260722063733_barback_opening_par_checklist_persistence.sql'));
});

test('34. active nights remain selectable while closed nights remain available to safe history', () => {
  assert.match(manager, /showClosed \|\| night\.active !== false/);
  assert.match(manager, /state\.nights = state\.allNights; \/\/ history\/session labels include closed nights/);
  assert.match(manager, /include_history: true/);
});

test('35. create-session returns an explicit safe session projection', () => {
  assert.match(createEdge, /id, venue_id, night_id, bar_id, allowed_bars, allowed_staff, nickname, issued_by, issued_at, expires_at, opening_par_config/);
  assert.doesNotMatch(createEdge, /\.from\("barback_sessions"\)[\s\S]{0,500}\.select\(\)/);
});
