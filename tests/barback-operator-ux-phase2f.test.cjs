const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = html.indexOf('\nfunction ', start + 10);
  return html.slice(start, next === -1 ? html.length : next);
}

function workflow(mode, rapid, measure) {
  const selected = { value: mode };
  const rapidInput = { checked: rapid };
  const context = { phase1MeasureUnit: measure, $: id => id === 'scan-workflow' ? selected : id === 'rapid-mode' ? rapidInput : null };
  vm.createContext(context);
  vm.runInContext(functionSource('resolveScanWorkflow'), context);
  return context.resolveScanWorkflow();
}

test('Phase 2F exposes three explicit scan workflows', () => {
  assert.match(html, /id="scan-workflow"/);
  assert.match(html, /FAST_UNOPENED_ONE_EACH/);
  assert.match(html, /SET_QUANTITY_COUNT/);
  assert.match(html, /WEIGH_PARTIAL/);
  assert.match(html, /FAST 1 EACH/);
  assert.match(html, /SET QTY/);
  assert.match(html, /WEIGH — scan, then place bottle on scale/);
});

test('Phase 2F resolver routes FAST, SET QTY, and WEIGH deterministically', () => {
  assert.equal(workflow('FAST_UNOPENED_ONE_EACH', false, 'UNITS'), 'FAST_UNOPENED_ONE_EACH');
  assert.equal(workflow('SET_QUANTITY_COUNT', false, 'UNITS'), 'SET_QUANTITY_COUNT');
  assert.equal(workflow('WEIGH_PARTIAL', false, 'UNITS'), 'WEIGH_PARTIAL');
  assert.equal(workflow('SET_QUANTITY_COUNT', false, 'WEIGHT'), 'WEIGH_PARTIAL');
});

test('Phase 2F FAST path remains direct Qty 1 and isolated from modal/scale state', () => {
  const scan = functionSource('onBarcodeScanned');
  const rapid = functionSource('rapidScanAddItem');
  const branch = scan.slice(scan.indexOf("if (scanWorkflow === 'FAST_UNOPENED_ONE_EACH')"), scan.indexOf('} else {'));
  assert.doesNotMatch(branch, /openQtyModal|phase1-gross-weight|weight-g-input|qm-ble|bleScale/);
  assert.match(rapid, /qtyOverride: 1/);
  assert.match(rapid, /weightOverride: ''/);
  assert.match(rapid, /bottleStateOverride: 'UNOPENED'/);
  assert.match(rapid, /notesInput\.value = ''/);
});

test('Phase 2F SET QTY preserves the existing quantity sheet and default one', () => {
  const scan = functionSource('onBarcodeScanned');
  assert.match(scan, /openQtyModal\(it\)/);
  assert.match(html, /_qmSetQty\(1\)/);
  assert.match(html, /qtyModalAdd/);
  assert.match(html, /Weight \(grams\) must be a positive number/);
});

test('Phase 2F WEIGH pauses without auto-add and provides explicit recovery choices', () => {
  const scan = functionSource('onBarcodeScanned');
  const weigh = functionSource('beginWeighPending');
  assert.match(scan, /scanWorkflow === 'WEIGH_PARTIAL'/);
  assert.match(scan, /beginWeighPending\(it\)/);
  assert.match(weigh, /setTimeout/);
  assert.match(weigh, /No stable weight received/);
  assert.doesNotMatch(weigh, /addCurrentSelectionToReview/);
  for (const marker of [
    'ADD WEIGHTED TO REVIEW', 'CANCEL / SKIP ITEM', 'USE LATEST STABLE WEIGHT',
    'ENTER WEIGHT MANUALLY', 'RECONNECT / CHECK SCALE', 'MARK AS UNOPENED UNIT',
    'SKIP ITEM', 'bottleStateOverride: \'UNOPENED\'',
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
});

test('Phase 2F weighted confirmation uses existing save path with Qty 1, Weight(g), PARTIAL', () => {
  const save = html.slice(html.indexOf("$('save-btn').addEventListener"), html.indexOf('// ════════════════════════════════════════════════════════════════════', html.indexOf("$('save-btn').addEventListener")));
  assert.match(save, /addCurrentSelectionToReview\(\{\}\)/);
  assert.match(html, /phase1MeasureUnit === 'WEIGHT'/);
  assert.match(html, /bottle-state-select.*PARTIAL|value = 'PARTIAL'/s);
  assert.match(html, /Qty fixed: 1 for weighted entry/);
});

test('Phase 2F re-arm, lock release, QN-KS, Review, Bluefy, and voice paths remain', () => {
  for (const marker of [
    'rapidScanBusy', 'DUPE_SCAN_WINDOW_MS', 'canonicalBarcodeCooldownKey',
    'releaseRapidScanLock', 'barcodeLookupVariants', 'resolveQuantityAndWeightSemantics',
    '_qnksScaleDivisor', 'phase1-gross-weight', 'Weight (g)',
    'CONNECT / DETAILS', 'BLUEFY BOOT CHECK', 'VOICE GUIDE', 'SPEAK ITEM NAMES',
    'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT', 'showReview', 'renderReview',
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
  const close = functionSource('closeScanner');
  assert.match(close, /closeQtyModal\(\)/);
  assert.match(close, /state\.zxingControls\.stop\(\)/);
  assert.match(close, /state\.scannerContinuous = false/);
});

test('Phase 2F adds no new persistence function or backend path', () => {
  assert.doesNotMatch(html, /function phase1.*(?:Save|Submit|Persist)/);
  assert.doesNotMatch(html, /fetch\([^)]*phase2f|fetch\([^)]*scan-workflow/);
});
