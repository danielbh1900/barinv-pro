'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
  { staff_id: 'vip-busser', global_role: 'bartender', role: 'busser', revoked: false, allowed_bar_ids: ['vip1'] },
  { staff_id: 'bar-busser', global_role: 'barback', role: 'busser', revoked: false, allowed_bar_ids: ['b1'] },
  { staff_id: 'revoked-busser', global_role: 'busser', role: 'busser', revoked: true, allowed_bar_ids: ['vip1'] },
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
  manager.slice(manager.indexOf('// MANAGER_DESTINATION_SCOPE_V1_CORE_START'), manager.indexOf('// MANAGER_DESTINATION_SCOPE_V1_CORE_END')) +
    '\nthis.scope = ManagerDestinationScopeV1;',
  managerContext,
);
const scope = managerContext.scope;
const activeDestinations = [
  { id: 'b1', bar_type: 'bar' },
  { id: 'vip1', bar_type: 'vip' },
];

function denoEvalJson(source) {
  const result = spawnSync('deno', ['eval', source], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

const serverEligibility = denoEvalJson(`
type SessionLinkMode = "bar" | "table";
class SessionInputError extends Error {}
${between(createEdge, '// BARBACK_CREATE_SESSION_VALIDATION_START', '// BARBACK_CREATE_SESSION_VALIDATION_END')}
const areas = new Map([
  ["b1", "bar"],
  ["vip1", "table"],
]);
const staff = { role: "misleading-global-role" };
const eligible = (role, allowed_bar_ids, revoked = false) =>
  staffEligibleForSession(staff, { role, allowed_bar_ids, revoked }, "bar", areas);
console.log(JSON.stringify({
  bartender: eligible("bartender", ["b1"]),
  barback: eligible("barback", ["b1"]),
  dual: eligible("bartender, barback", ["b1"]),
  vipBusser: eligible("busser", ["vip1"]),
  barBusser: eligible("busser", ["b1"]),
  revokedBusser: eligible("busser", ["vip1"], true),
  substringBarback: eligible("lead barback", ["b1"]),
  busserVipDestination: staffDestinationEligible({ role: "busser" }, "bar", "table"),
  busserBarDestination: staffDestinationEligible({ role: "busser" }, "bar", "bar"),
}));
`);

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

test('combined Manager selector excludes bartender-only and retains selected-night labels', () => {
  const staffWithMisleadingGlobalRole = { role: 'barback', active: true };
  const bartenderAssignment = { role: 'bartender', revoked: false, allowed_bar_ids: ['b1'] };
  const barbackAssignment = { role: 'barback', revoked: false, allowed_bar_ids: ['b2'] };
  assert.equal(scope.roleEligible(staffWithMisleadingGlobalRole, bartenderAssignment, 'bar', activeDestinations), false);
  assert.equal(scope.hasSelectedNightRole(bartenderAssignment, 'bartender'), true);
  assert.equal(scope.hasSelectedNightRole(bartenderAssignment, 'barback'), false);
  assert.equal(scope.roleEligible({ role: 'bartender', active: true }, barbackAssignment, 'bar', activeDestinations), true);
  assert.match(manager, /const roleLabel = Array\.from\(entry\.roles\)/);
  assert.match(createEdge, /String\(assignment\.role \|\| ""\)/);
  assert.doesNotMatch(createEdge, /\[staff\?\.role, assignment\?\.role\]/);
});

test('exact barback is included and bartender plus barback qualifies as barback', () => {
  assert.equal(scope.roleEligible({ active: true }, selectedNightPopulation[1], 'bar', activeDestinations), true);
  assert.equal(scope.roleEligible({ active: true }, selectedNightPopulation[2], 'bar', activeDestinations), true);
  assert.equal(serverEligibility.barback, true);
  assert.equal(serverEligibility.dual, true);
});

test('busser requires an active selected-night VIP Tables assignment', () => {
  assert.equal(scope.roleEligible({ active: true }, selectedNightPopulation[3], 'bar', activeDestinations), true);
  assert.equal(scope.roleEligible({ active: true }, selectedNightPopulation[4], 'bar', activeDestinations), false);
  assert.equal(serverEligibility.vipBusser, true);
  assert.equal(serverEligibility.barBusser, false);
});

test('inactive or revoked selected-night assignment is excluded', () => {
  assert.equal(scope.roleEligible({ active: true }, selectedNightPopulation[5], 'bar', activeDestinations), false);
  assert.equal(serverEligibility.revokedBusser, false);
});

test('ordinary bar destination never qualifies a busser', () => {
  assert.equal(scope.destinationEligible({ role: 'busser', revoked: false }, activeDestinations[0], 'bar'), false);
  assert.equal(scope.destinationEligible({ role: 'busser', revoked: false }, activeDestinations[1], 'bar'), true);
  assert.equal(serverEligibility.busserBarDestination, false);
  assert.equal(serverEligibility.busserVipDestination, true);
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

test('session creation uses the same exact selected-night Barback and VIP Busser rule', () => {
  assert.match(createEdge, /SESSION_BAR_ROLE_KEYWORDS = \["barback"\]/);
  assert.match(createEdge, /SESSION_BAR_VIP_BUSSER_ROLE = "busser"/);
  assert.match(createEdge, /String\(assignment\.role \|\| ""\)[\s\S]*\.map\(\(part\) => part\.trim\(\)\)/);
  assert.doesNotMatch(createEdge, /words\.includes\("barback"\)|staff\?\.role/);
  assert.equal(serverEligibility.bartender, false);
  assert.equal(serverEligibility.substringBarback, false);
});

test('population-wide Manager assertion shows zero ineligible staff', () => {
  const shown = selectedNightPopulation.filter(assignment =>
    scope.roleEligible({ active: true }, assignment, 'bar', activeDestinations));
  assert.deepEqual(shown.map(row => row.staff_id), ['barback', 'dual', 'vip-busser']);
  assert.equal(shown.every(assignment => {
    const tokens = scope.selectedNightRoles(assignment);
    return tokens.includes('barback') ||
      (tokens.includes('busser') && assignment.allowed_bar_ids.some(id => id === 'vip1'));
  }), true);
  assert.equal(shown.some(row => row.staff_id === 'juju'), false);
  assert.match(manager, /Selected-night Barbacks and active VIP Table Bussers/);
});
