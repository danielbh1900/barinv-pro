const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('actual Barback page contains the diagnostics panel and required marker', () => {
  assert.match(source, /BLUEFY-BARBACK-WEIGH-DIAG-20260919/);
  assert.match(source, /id="bluefy-barback-diag-panel"/);
  assert.match(source, /CLEAR/);
  assert.match(source, /COPY DIAGNOSTICS/);
});

test('all three scan workflows record the shared barcode resolution', () => {
  assert.match(source, /FAST_UNOPENED_ONE_EACH/);
  assert.match(source, /SET_QUANTITY_COUNT/);
  assert.match(source, /WEIGH_PARTIAL/);
  assert.match(source, /flow: 'BARCODE_RESOLUTION'/);
  assert.match(source, /lookupFunction: 'lookupBarcodeResult'/);
  assert.match(source, /mode: diagWorkflow/);
});

test('weigh selection and item-not-found branches are observable', () => {
  assert.match(source, /flow: 'WEIGH_SELECTED'/);
  assert.match(source, /weighState: 'WAITING_FOR_WEIGHT'/);
  assert.match(source, /if \(!it\)/);
  assert.match(source, /weighState: it \? \(diagWorkflow === 'WEIGH_PARTIAL'/);
});

test('diagnostics history is bounded and contains no credential access', () => {
  assert.match(source, /BLUEFY_BARBACK_DIAG_HISTORY_LIMIT = 40/);
  const start = source.indexOf('BLUEFY_BARBACK_WEIGHT_DIAGNOSTICS_START - observation only');
  const end = source.indexOf('BLUEFY_BARBACK_WEIGHT_DIAGNOSTICS_END', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /access_token|service_role|anonKey|password|secret|session_token/i);
  assert.doesNotMatch(block, /localStorage|sessionStorage/);
});
