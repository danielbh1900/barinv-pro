const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('event embeds use explicit source and destination bar relationships', () => {
  assert.match(source, /bars:bars!events_bar_id_fkey\(/);
  assert.match(source, /destination_bar:bars!events_destination_bar_id_fkey\(/);
  assert.doesNotMatch(source, /SB\.from\(['"]events['"]\)[\s\S]{0,300}bars\(name\)/);
});

test('dashboard and Event Log preserve source property and transfer destination data', () => {
  assert.match(source, /SB\.from\('events'\)\.select\('\*, bars:bars!events_bar_id_fkey\(name\), destination_bar:bars!events_destination_bar_id_fkey\(name\)/);
  assert.match(source, /destination_bar_id/);
  assert.match(source, /SOURCE BAR|destinationBarName|destination_bar/);
});

test('existing approval and stock behavior remains in the same client paths', () => {
  assert.match(source, /setStatus\([^\n]+['"]APPROVED['"]\)/);
  assert.match(source, /setStatus\([^\n]+['"]REJECTED['"]\)/);
  assert.doesNotMatch(source, /Auto-update Liquor Room stock/);
});
