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

const selectedNightPopulation = [
  { staff_id: 'juju', global_role: 'bartender', role: 'bartender', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'barback', global_role: 'barback', role: 'barback', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'dual', global_role: 'bartender, barback', role: 'bartender, barback', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'server', global_role: 'server', role: 'server', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'manager', global_role: 'barback', role: 'manager', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'security', global_role: 'security', role: 'security', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'cashier', global_role: 'cashier', role: 'cashier', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'host', global_role: 'host', role: 'host', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'promoter', global_role: 'promoter', role: 'promoter', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'substring', global_role: 'barback', role: 'lead barback', revoked: false, allowed_bar_ids: ['b1'] },
];

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

test('every population row shown in Barbacks has the exact selected-night barback token', () => {
  const shown = selectedNightPopulation.filter(assignment => roles.has(assignment, 'barback'));
  assert.deepEqual(shown.map(row => row.staff_id), ['barback', 'dual']);
  assert.equal(shown.every(row => roles.roles(row.role).includes('barback')), true);
});

test('every population row without exact selected-night barback is excluded from Barbacks', () => {
  const excluded = selectedNightPopulation.filter(assignment => !roles.roles(assignment.role).includes('barback'));
  assert.equal(excluded.every(assignment => !roles.has(assignment, 'barback')), true);
  assert.equal(excluded.some(row => row.staff_id === 'manager' && row.global_role === 'barback'), true);
  assert.equal(excluded.some(row => row.staff_id === 'substring'), true);
});

test('every population row shown in Bartenders has the exact selected-night bartender token', () => {
  const shown = selectedNightPopulation.filter(assignment => roles.has(assignment, 'bartender'));
  assert.deepEqual(shown.map(row => row.staff_id), ['juju', 'dual']);
  assert.equal(shown.every(row => roles.roles(row.role).includes('bartender')), true);
});

test('every population row without exact selected-night bartender is excluded from Bartenders', () => {
  const excluded = selectedNightPopulation.filter(assignment => !roles.roles(assignment.role).includes('bartender'));
  assert.equal(excluded.every(assignment => !roles.has(assignment, 'bartender')), true);
});

test('dual-role membership requires both explicit selected-night tokens', () => {
  const both = selectedNightPopulation.filter(assignment =>
    roles.has(assignment, 'barback') && roles.has(assignment, 'bartender'));
  assert.deepEqual(both.map(row => row.staff_id), ['dual']);
});

test('population role classification is invariant under destination changes', () => {
  selectedNightPopulation.forEach(assignment => {
    const changed = { ...assignment, allowed_bar_ids: assignment.allowed_bar_ids.length ? [] : ['new-destination'] };
    assert.equal(roles.has(changed, 'barback'), roles.has(assignment, 'barback'));
    assert.equal(roles.has(changed, 'bartender'), roles.has(assignment, 'bartender'));
  });
});

test('session creation accepts only exact selected-night roles for Barback/Bars', () => {
  assert.match(createEdge, /SESSION_BAR_ROLE_KEYWORDS = \["barback", "bartender"\]/);
  assert.match(createEdge, /String\(assignment\?\.role \|\| ""\)[\s\S]*\.map\(\(part\) => part\.trim\(\)\)/);
  assert.doesNotMatch(createEdge, /words\.includes\("barback"\)|staff\?\.role/);
});
