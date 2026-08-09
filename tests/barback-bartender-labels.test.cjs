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

test('PIN login decorates scoped bars with assigned bartender names', () => {
  assert.match(pinLogin, /BARBACK_BARTENDER_BAR_LABELS_START/);
  assert.match(pinLogin, /night_staff_assignments/);
  assert.match(pinLogin, /hasRoleToken\(row\.role, "bartender"\)/);
  assert.match(pinLogin, /bartender_name/);
  assert.match(pinLogin, /bartender_names/);
  assert.match(pinLogin, /barsWithBartenderLabels/);
  assert.match(pinLogin, /bars:\s+barsWithBartenderLabels/);
});

test('PIN login includes assigned-staff fallback metadata only for already-scoped bars', () => {
  assert.match(pinLogin, /assignedStaffNamesByBarId/);
  assert.match(pinLogin, /if \(!scopedBarIdSet\.has\(barId\)\) continue;/);
  assert.match(pinLogin, /assigned_staff_name/);
  assert.match(pinLogin, /assigned_staff_names/);
  assert.match(pinLogin, /!bartenderNames\.length && assignedStaffNames\.length/);
  assert.match(pinLogin, /\.\.\.bar,/);
  assert.doesNotMatch(pinLogin, /allowed_bars:\s*assignedStaffNames/);
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

test('Barback UI renders assigned-staff fallback labels while retaining the base bar name', () => {
  assert.match(barback, /Array\.isArray\(bar\.assigned_staff_names\)/);
  assert.match(barback, /bar\.assigned_staff_name \? \[bar\.assigned_staff_name\] : \[\]/);
  assert.match(barback, /return names\.length \? \(base \+ ' — ' \+ names\.join\(', '\)\) : base;/);
  assert.match(barback, /\.find\(b => b\.id === bid\)/);
});
