const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pinLogin = fs.readFileSync(
  path.join(root, 'supabase/functions/barback-pin-login/index.ts'),
  'utf8',
);
const barback = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('PIN login decorates scoped bars with assigned bartender names', () => {
  assert.match(pinLogin, /BARBACK_BARTENDER_BAR_LABELS_START/);
  assert.match(pinLogin, /night_staff_assignments/);
  assert.match(pinLogin, /hasRoleToken\(row\.role, "bartender"\)/);
  assert.match(pinLogin, /bartender_name/);
  assert.match(pinLogin, /bartender_names/);
  assert.match(pinLogin, /barsWithBartenderLabels/);
  assert.match(pinLogin, /bars:\s+barsWithBartenderLabels/);
});

test('Barback UI renders bartender-decorated bar labels without changing IDs', () => {
  assert.match(barback, /function barDisplayLabel\(bar\)/);
  assert.match(barback, /function barDisplayLabelById\(bid\)/);
  assert.match(barback, /base \+ ' — ' \+ names\.join\(', '\)/);
  assert.match(barback, /barDisplayLabel\(selBar\)/);
  assert.match(barback, /esc\(barDisplayLabel\(b\)\)/);
  assert.match(barback, /esc\(barDisplayLabel\(group\.destination\)\)/);
  assert.match(barback, /function reviewBarLabel\(bid\) \{\n  return barDisplayLabelById\(bid\);\n\}/);
});

test('Dispatch bartender picker persists only bartender-to-selected-bar assignments', () => {
  assert.match(dashboard, /async function dspPersistBartenderAssignment\(barId, staffId\)/);
  assert.match(dashboard, /SB\.from\('night_staff_assignments'\)/);
  assert.match(dashboard, /\.eq\('role', 'bartender'\)/);
  assert.match(dashboard, /role: 'bartender'/);
  assert.match(dashboard, /allowed_bar_ids: \[barId\]/);
  assert.match(dashboard, /currentIds\.filter\(id => id !== barId\)/);
  assert.match(dashboard, /currentIds\.concat\(barId\)/);
  assert.match(dashboard, /if \(field === 'bartender'\) void dspPersistBartenderAssignment\(barId, staffId\);/);
});

test('Barback labels remain bartender-only with no assigned-staff fallback', () => {
  assert.doesNotMatch(pinLogin, /assigned_staff_names|assigned_staff_name/);
  assert.doesNotMatch(barback, /assigned_staff_names|assigned_staff_name/);
});
