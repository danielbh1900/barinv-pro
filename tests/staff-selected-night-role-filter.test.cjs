'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'barback_manager.html'), 'utf8');
const createEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-create-session/index.ts'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end);
  assert.notEqual(a, -1, `missing marker: ${start}`);
  assert.notEqual(b, -1, `missing marker: ${end}`);
  return source.slice(a + start.length, b);
}

const mainContext = {};
vm.runInNewContext(
  between(main, '// SELECTED_NIGHT_STAFF_ROLE_V1_CORE_START', '// SELECTED_NIGHT_STAFF_ROLE_V1_CORE_END') +
    '\nthis.roles = SelectedNightStaffRoleV1;',
  mainContext,
);
const roles = mainContext.roles;

const managerContext = {};
vm.runInNewContext(
  manager.slice(manager.indexOf('function _selectedNightRoleTokens'), manager.indexOf('// MANAGER_DESTINATION_SCOPE_V1_CORE_END')) +
    '\nthis.scope = ManagerDestinationScopeV1;',
  managerContext,
);
const scope = managerContext.scope;

test('bartender-only selected-night role is excluded from Barbacks', () => {
  const assignment = { staff_id: 'juju', role: 'bartender', revoked: false, allowed_bar_ids: ['b1'] };
  assert.equal(roles.has(assignment, 'bartender'), true);
  assert.equal(roles.has(assignment, 'barback'), false);
});

test('barback-only selected-night role is excluded from Bartenders', () => {
  const assignment = { staff_id: 'bb', role: 'barback', revoked: false, allowed_bar_ids: ['b1'] };
  assert.equal(roles.has(assignment, 'barback'), true);
  assert.equal(roles.has(assignment, 'bartender'), false);
});

test('explicit selected-night dual role appears in both filters', () => {
  const assignment = { staff_id: 'dual', role: 'bartender, barback', revoked: false };
  assert.equal(roles.has(assignment, 'barback'), true);
  assert.equal(roles.has(assignment, 'bartender'), true);
});

test('destination assignment never affects role classification', () => {
  const bartender = { staff_id: 'juju', role: 'bartender', revoked: false, allowed_bar_ids: ['barback-named-destination'] };
  const noDestinations = { ...bartender, allowed_bar_ids: [] };
  assert.equal(roles.has(bartender, 'barback'), false);
  assert.equal(roles.has(noDestinations, 'barback'), false);
  assert.deepEqual(Array.from(roles.staffIds([bartender], 'bartender')), ['juju']);
});

test('combined Manager selector accepts both exact roles and retains selected-night labels', () => {
  const staffWithMisleadingGlobalRole = { role: 'barback', active: true };
  const bartenderAssignment = { role: 'bartender', revoked: false, allowed_bar_ids: ['b1'] };
  const barbackAssignment = { role: 'barback', revoked: false, allowed_bar_ids: ['b2'] };
  assert.equal(scope.roleEligible(staffWithMisleadingGlobalRole, bartenderAssignment, 'bar'), true);
  assert.equal(scope.hasSelectedNightRole(bartenderAssignment, 'bartender'), true);
  assert.equal(scope.hasSelectedNightRole(bartenderAssignment, 'barback'), false);
  assert.equal(scope.roleEligible({ role: 'bartender', active: true }, barbackAssignment, 'bar'), true);
  assert.match(manager, /const roleLabel = Array\.from\(entry\.roles\)/);
  assert.match(createEdge, /String\(assignment\?\.role \|\| ""\)/);
  assert.doesNotMatch(createEdge, /\[staff\?\.role, assignment\?\.role\]/);
});
