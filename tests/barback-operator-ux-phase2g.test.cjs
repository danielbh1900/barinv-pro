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

test('Phase 2G uses the scan workflow dropdown as the only routing source', () => {
  assert.match(html, /id="scan-workflow"/);
  assert.match(html, /id="rapid-mode"[^>]*disabled[^>]*aria-hidden="true"/);
  const resolver = functionSource('resolveScanWorkflow');
  assert.doesNotMatch(resolver, /rapid-mode.*checked/);
  const context = {
    phase1MeasureUnit: 'UNITS',
    $: id => id === 'scan-workflow' ? { value: 'SET_QUANTITY_COUNT' } : { checked: true },
  };
  vm.createContext(context);
  vm.runInContext(resolver, context);
  assert.equal(context.resolveScanWorkflow(), 'SET_QUANTITY_COUNT');
  context.$ = id => id === 'scan-workflow' ? { value: 'FAST_UNOPENED_ONE_EACH' } : { checked: false };
  assert.equal(context.resolveScanWorkflow(), 'FAST_UNOPENED_ONE_EACH');
  context.$ = id => id === 'scan-workflow' ? { value: 'WEIGH_PARTIAL' } : { checked: true };
  assert.equal(context.resolveScanWorkflow(), 'WEIGH_PARTIAL');
});

test('Phase 2G helper text has no dropdown/legacy-checkbox contradiction', () => {
  const label = functionSource('renderScanWorkflowLabel');
  assert.match(label, /FAST 1 EACH: unopened bottles add Qty 1\. No quantity popup\./);
  assert.match(label, /SET QTY: scan item, then enter quantity\./);
  assert.match(label, /WEIGH: scan item, then place bottle on scale\./);
  assert.match(html, /savedWorkflow/);
  assert.match(html, /Prefs\.patch\('scanWorkflow', select\.value\)/);
});

test('Phase 2G scanner routing branches only from resolveScanWorkflow', () => {
  const scanned = functionSource('onBarcodeScanned');
  assert.match(scanned, /const scanWorkflow = resolveScanWorkflow\(\)/);
  assert.match(scanned, /if \(scanWorkflow === 'WEIGH_PARTIAL'\)/);
  assert.match(scanned, /if \(scanWorkflow === 'FAST_UNOPENED_ONE_EACH'\)/);
  assert.match(scanned, /openQtyModal\(it\)/);
  assert.doesNotMatch(scanned, /if \(state\.scannerContinuous\)\s*\{/);
});

test('Phase 2G workflow changes safely clear stale scanner/modal state', () => {
  const controls = functionSource('initScanWorkflowControls');
  assert.match(controls, /closeScanner\(\)/);
  assert.match(controls, /clearWeighPending\(\)/);
  assert.match(controls, /releaseRapidScanLock\(\)/);
  assert.match(controls, /phase1MeasureUnit = 'WEIGHT'/);
  assert.match(controls, /phase1MeasureUnit = 'UNITS'/);
});

test('Phase 2G preserves the three workflow outcomes and prior safety markers', () => {
  for (const marker of [
    'FAST_UNOPENED_ONE_EACH', 'SET_QUANTITY_COUNT', 'WEIGH_PARTIAL',
    'qtyOverride: 1', "weightOverride: ''", "bottleStateOverride: 'UNOPENED'",
    'ADD WEIGHTED TO REVIEW', 'No stable weight received', 'rapidScanBusy',
    'canonicalBarcodeCooldownKey', '_qnksScaleDivisor', 'safeReviewRowHTML',
    'resolveQuantityAndWeightSemantics', 'PHASE2E_BLUEFY_BOOT_GUARD',
    'CONNECT / DETAILS', 'VOICE GUIDE', 'SPEAK ITEM NAMES'
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
});

test('Phase 2G adds no persistence path', () => {
  assert.doesNotMatch(html, /function (phase2g|scanWorkflowSave|scanWorkflowPersist)\w*\(/i);
  assert.match(html, /addCurrentSelectionToReview\(/);
  assert.match(html, /Drafts\.count\(\)/);
});
