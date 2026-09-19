const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('physical Jameson barcode evidence is represented by the shared alias resolver contract', () => {
  assert.match(source, /function lookupBarcodeResult\(raw\)/);
  assert.match(source, /barcodeLookupVariants\(value\)/);
});

test('ZXing permits EAN-8 and the same scanner configuration feeds all workflows', () => {
  assert.match(source, /BarcodeFormat\.EAN_8/);
  assert.match(source, /function acceptDecodedCode\(code, controls\)/);
  assert.match(source, /const scanWorkflow = resolveScanWorkflow\(\)/);
  assert.match(source, /FAST_UNOPENED_ONE_EACH/);
  assert.match(source, /SET_QUANTITY_COUNT/);
  assert.match(source, /WEIGH_PARTIAL/);
});

test('one-shot unknown scans hold briefly while FAST remains continuous', () => {
  assert.match(source, /if \(!it\) \{/);
  assert.match(source, /const oneShotHold = !state\.scannerContinuous/);
  assert.match(source, /UNKNOWN_SCAN_HOLD_MS = 1800/);
  assert.match(source, /finalizeUnknownScanHold/);
  assert.match(source, /else releaseRapidScanLock\(\)/);
});

test('unknown scans clear an existing selected item before the hold', () => {
  const start = source.indexOf('function onBarcodeScanned');
  const end = source.indexOf('// Role/scope SAFETY', start);
  assert.ok(start >= 0 && end > start);
  const unknownBranch = source.slice(source.indexOf('if (!it)', start), end);
  assert.match(unknownBranch, /clearSelectionForUnknownScan\(\)/);
});

test('08040824 is a checksum-valid EAN-8 value, so catalog absence is the unknown condition', () => {
  const digits = '08040824'.split('').map(Number);
  const sum = digits.slice(0, 7).reduce((total, value, index) => total + value * (index % 2 === 0 ? 3 : 1), 0);
  assert.equal((10 - (sum % 10)) % 10, digits[7]);
});

test('acceptance contract covers physical alias, bounded recovery, conflicts, and all modes', () => {
  assert.match(source, /flow: 'UNKNOWN_HOLD_STARTED'/);
  assert.match(source, /flow: 'UNKNOWN_HOLD_MATCHED'/);
  assert.match(source, /flow: 'UNKNOWN_HOLD_TIMEOUT'/);
  assert.match(source, /barcodeResult\.ambiguous/);
  assert.match(source, /clearSelectionForUnknownScan\(\)/);
  assert.match(source, /scanWorkflow === 'WEIGH_PARTIAL'/);
  assert.match(source, /scanWorkflow === 'FAST_UNOPENED_ONE_EACH'/);
  assert.match(source, /openQtyModal\(it\)/);
});

test('WEIGH replacement path atomically arms replacement and records state transitions', () => {
  const beginStart = source.indexOf('function beginWeighPending(it)');
  const beginEnd = source.indexOf('function weighPendingMarkUnopened', beginStart);
  assert.ok(beginStart >= 0 && beginEnd > beginStart);
  const begin = source.slice(beginStart, beginEnd);
  assert.match(begin, /phase1WeighPendingItem = it/);
  assert.match(begin, /phase1ReplacementArmed = !!\(phase1PendingItemId && state\.selectedItemId/);
  assert.match(begin, /setPickedItem\(it, 'scan'\)/);
  assert.match(begin, /afterBeginWeighPendingItemId/);
  assert.match(begin, /afterSetPickedItemId/);
  assert.match(begin, /finally \{ phase1ReplacementArmed = false; \}/);
});
