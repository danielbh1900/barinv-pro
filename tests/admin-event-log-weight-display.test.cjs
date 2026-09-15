'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const start = app.indexOf('function eventLogNoteMetadata(notes) {');
const end = app.indexOf('async function loadEvents()', start);
assert.notEqual(start, -1, 'missing eventLogNoteMetadata helper');
assert.notEqual(end, -1, 'missing loadEvents marker');

const context = {
  Object,
  Number,
  String,
  esc(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },
};
vm.createContext(context);
vm.runInContext(app.slice(start, end), context);

const display = (event, isCase = false, upc = 1) =>
  context.eventLogQtyDisplay(event, isCase, upc);

test('Admin loadEvents uses the dedicated quantity formatter', () => {
  const loadEventsEnd = app.indexOf('async function setStatus(', end);
  assert.notEqual(loadEventsEnd, -1, 'missing setStatus marker');
  const loadEventsSource = app.slice(end, loadEventsEnd);
  assert.match(loadEventsSource, /const qtyDisplay = eventLogQtyDisplay\(e, isCase, upc\);/);
});

test('plain count quantities remain counts without explicit weight metadata', () => {
  assert.equal(display({ qty: 1, notes: '' }), '1');
  assert.equal(display({ qty: 8, notes: 'ordinary operator note' }), '8');
});

test('explicit integer and decimal weights include the gram unit', () => {
  assert.equal(display({ qty: 1, notes: '[WEIGHT_G=1201]' }), '1201 g');
  assert.equal(display({ qty: 1, notes: '[WEIGHT_G=971.5]' }), '971.5 g');
});

test('partial bottles show count, state, weight, percent, and remaining ml', () => {
  const rendered = display({
    qty: 1,
    notes: '[BOTTLE_STATE=PARTIAL] [WEIGHT_G=1756] [REMAINING_PERCENT=98] [REMAINING_ML=1026]',
  });
  assert.match(rendered, /1 partial/);
  assert.match(rendered, /1756 g/);
  assert.match(rendered, /98% rem/);
  assert.match(rendered, /1026 ml/);
});

test('case quantity and units display remains unchanged', () => {
  assert.equal(
    display({ qty: 2, notes: '[WEIGHT_G=1201]' }, true, 6),
    '2 <span style="font-size:10px;color:var(--muted);">(12 units)</span>',
  );
});

test('large quantities are not guessed to be weights', () => {
  assert.equal(display({ qty: 1201, notes: '' }), '1201');
});

test('legacy qty equal to explicit weight is rendered once with its unit', () => {
  const rendered = display({ qty: 1201, notes: '[WEIGHT_G=1201]' });
  assert.equal(rendered, '1201 g');
  assert.equal((rendered.match(/1201/g) || []).length, 1);
});
