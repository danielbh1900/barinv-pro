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

function rapidHarness(result) {
  const notes = { value: 'stale shift note' };
  const scanner = { classList: { contains: name => name === 'active' } };
  const timers = [];
  const calls = { add: [], voice: [], toast: [], status: [], release: 0 };
  let count = 0;
  const context = {
    state: { scannerContinuous: true, rapidScanReadyTimer: null },
    resolveScanWorkflow: () => 'FAST_UNOPENED_ONE_EACH',
    Drafts: { count: () => count },
    multiBarActive: () => !!result.multi,
    multiBarDestCount: () => result.destinations || 0,
    addCurrentSelectionToReview: options => {
      calls.add.push({ options, notesDuringAdd: notes.value });
      count += result.countIncrease == null ? (result.added || 0) : result.countIncrease;
      return { ok: result.ok, added: result.added, fail: result.fail, multi: !!result.multi };
    },
    Feedback: { ok() {}, warn() {} },
    VoiceGuide: { announceOperationalState: (...args) => calls.voice.push(args) },
    showScannerToast: (...args) => calls.toast.push(args),
    statusOn: (...args) => calls.status.push(args),
    releaseRapidScanLock: () => { calls.release += 1; },
    clearTimeout() {},
    setTimeout: callback => { timers.push(callback); return timers.length; },
    $: id => id === 'notes-input' ? notes : id === 'scanner-box' ? scanner : null,
  };
  vm.createContext(context);
  vm.runInContext(functionSource('scheduleRapidScanReady') + '\n' + functionSource('rapidScanAddItem'), context);
  return { context, notes, timers, calls, run: (item = { id: 'item-1', name: 'Bottle' }, barcodeResult = {}) => context.rapidScanAddItem(item, barcodeResult) };
}

test('Phase 2B RAPID creates one isolated unit Draft and restores hidden form notes', () => {
  const h = rapidHarness({ ok: true, added: 1, fail: 0, countIncrease: 1 });
  assert.equal(h.run(), true);
  assert.equal(h.calls.add.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.add[0].options)), {
    item: { id: 'item-1', name: 'Bottle' },
    qtyOverride: 1,
    weightOverride: '',
    bottleStateOverride: 'UNOPENED',
  });
  assert.equal(h.calls.add[0].notesDuringAdd, '');
  assert.equal(h.notes.value, 'stale shift note');
  assert.equal(h.calls.release, 1);
  assert.equal(h.calls.voice[0][0], 'added');
});

test('Phase 2B RAPID success transitions from Added to Ready for next scan', () => {
  const h = rapidHarness({ ok: true, added: 1, fail: 0, countIncrease: 1 });
  h.run();
  assert.match(h.calls.toast[0][0], /Added to Review: Bottle/);
  assert.equal(h.timers.length, 1);
  h.timers[0]();
  assert.equal(h.calls.toast.at(-1)[0], 'Ready for next scan');
});

test('Phase 2B reports partial multi-bar adds without announcing full success', () => {
  const h = rapidHarness({ ok: true, added: 1, fail: 1, countIncrease: 1, multi: true, destinations: 2 });
  assert.equal(h.run(), false);
  assert.match(h.calls.toast[0][0], /Partially added/);
  assert.equal(h.calls.voice.some(([type]) => type === 'added'), false);
  assert.equal(h.calls.release, 1);
});

test('Phase 2B announces full success only when every multi-bar destination is confirmed', () => {
  const h = rapidHarness({ ok: true, added: 2, fail: 0, countIncrease: 2, multi: true, destinations: 2 });
  assert.equal(h.run(), true);
  assert.match(h.calls.toast[0][0], /Added to Review/);
  assert.equal(h.calls.voice[0][0], 'added');
});

test('Phase 2B reports zero-add failure and always releases the rapid lock', () => {
  const h = rapidHarness({ ok: false, added: 0, fail: 1, countIncrease: 0 });
  assert.equal(h.run(), false);
  assert.match(h.calls.toast[0][0], /Scan failed/);
  assert.equal(h.calls.voice[0][0], 'failed');
  assert.equal(h.calls.release, 1);
});

test('Phase 2B canonical cooldown treats UPC-A and zero-prefixed EAN-13 as one barcode', () => {
  const lookupBlock = html.slice(html.indexOf('function barcodeDigitsOnly'), html.indexOf('function lookupByBarcode'));
  let now = 10000;
  let accepted = 0;
  const context = {
    cache: { items: [{ id: 'item-1', sku: '0652341401024' }] },
    state: { qtyModalItem: null, rapidScanBusy: false, scannerCooldown: {}, scannerContinuous: true, rapidScanResetTimer: null },
    resolveScanWorkflow: () => 'FAST_UNOPENED_ONE_EACH',
    DUPE_SCAN_WINDOW_MS: 2000,
    Date: { now: () => now },
    Feedback: { scan() {} },
    lookupBarcodeResult: undefined,
    onBarcodeScanned: () => { accepted += 1; context.state.rapidScanBusy = false; },
    setTimeout: () => 1,
    clearTimeout() {},
    console,
  };
  vm.createContext(context);
  vm.runInContext(lookupBlock + '\n' + functionSource('acceptDecodedCode'), context);
  assert.equal(context.canonicalBarcodeCooldownKey('652341401024', context.lookupBarcodeResult('652341401024')), 'upc:652341401024');
  assert.equal(context.canonicalBarcodeCooldownKey('0652341401024', context.lookupBarcodeResult('0652341401024')), 'upc:652341401024');
  context.acceptDecodedCode('652341401024');
  now += 100;
  context.acceptDecodedCode('0652341401024');
  assert.equal(accepted, 1);
  now += 2100;
  context.acceptDecodedCode('0652341401024');
  assert.equal(accepted, 2);
});

test('Phase 2B RETURN + UNITS does not require weight, while explicit weight and PARTIAL do', () => {
  const controls = { 'bottle-state-select': { value: 'UNOPENED' }, 'weight-g-input': { value: '' } };
  const context = { state: { selectedAction: 'RETURNED' }, phase1MeasureUnit: 'UNITS', $: id => controls[id] };
  vm.createContext(context);
  vm.runInContext(functionSource('shouldRequireWeightBeforeAdd'), context);
  assert.equal(context.shouldRequireWeightBeforeAdd(), false);
  context.phase1MeasureUnit = 'WEIGHT';
  assert.equal(context.shouldRequireWeightBeforeAdd(), true);
  context.phase1MeasureUnit = 'UNITS';
  controls['bottle-state-select'].value = 'PARTIAL';
  assert.equal(context.shouldRequireWeightBeforeAdd(), true);
});

test('Phase 2B preserves no-modal RAPID and NORMAL modal routing', () => {
  const scanner = html.slice(html.indexOf('function onBarcodeScanned'), html.indexOf('function showScannerToast'));
  const rapid = scanner.slice(scanner.indexOf("if (scanWorkflow === 'FAST_UNOPENED_ONE_EACH')"), scanner.indexOf('} else {', scanner.indexOf("if (scanWorkflow === 'FAST_UNOPENED_ONE_EACH')")));
  assert.doesNotMatch(rapid, /openQtyModal/);
  assert.match(scanner, /openQtyModal\(it\)/);
  assert.match(html, /FAST 1 EACH: unopened bottles add Qty 1\. No quantity popup\./);
});

test('Phase 2B keeps previous scanner, Review, weight, scale, and voice fixes', () => {
  for (const marker of [
    'rapidScanBusy', 'barcodeLookupVariants', 'resolveQuantityAndWeightSemantics',
    'phase1-gross-weight', 'Qty fixed: 1 for weighted entry', 'safeReviewRowHTML',
    'buildDegradedReviewRow', 'CONNECT / DETAILS', 'VOICE GUIDE', 'SPEAK ITEM NAMES',
    'ACCESSORY / TARE', 'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT',
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
});
