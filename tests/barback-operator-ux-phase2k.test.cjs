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

function buildHarness() {
  let now = 10000;
  let accepted = 0;
  const context = {
    state: {
      qtyModalItem: null,
      rapidScanBusy: false,
      scannerCooldown: {},
      scannerContinuous: true,
      rapidScanResetTimer: null,
      rapidPhysicalLatchedBarcode: '',
      rapidPhysicalClearFrames: 0,
      rapidPhysicalRearmed: true,
    },
    resolveScanWorkflow: () => 'FAST_UNOPENED_ONE_EACH',
    canonicalBarcodeCooldownKey: raw => /^(?:0?\d{12})$/.test(String(raw))
      ? 'upc:' + String(raw).replace(/^0/, '')
      : 'raw:' + String(raw),
    lookupBarcodeResult: code => ({ item: { id: 'item-' + code, name: 'Bottle' } }),
    Date: { now: () => now },
    DUPE_SCAN_WINDOW_MS: 2000,
    RAPID_CLEAR_FRAMES_REQUIRED: 3,
    Feedback: { scan() {} },
    onBarcodeScanned: () => { accepted += 1; context.state.rapidScanBusy = false; },
    setTimeout: () => 1,
    clearTimeout() {},
    showScannerToast() {},
    statusOn() {},
    VoiceGuide: { announceOperationalState() {} },
    console,
  };
  vm.createContext(context);
  vm.runInContext(
    functionSource('acceptDecodedCode') + '\n' +
    functionSource('noteRapidPhysicalClearFrame') + '\n' +
    functionSource('resetRapidPhysicalRearm'),
    context
  );
  return { context, get accepted() { return accepted; }, advance(ms) { now += ms; } };
}

test('Phase 2K FAST latches one physical barcode beyond the time cooldown', () => {
  const h = buildHarness();
  h.context.acceptDecodedCode('652341401024');
  h.advance(10000);
  h.context.acceptDecodedCode('652341401024');
  assert.equal(h.accepted, 1);
  assert.equal(h.context.state.rapidPhysicalLatchedBarcode, 'upc:652341401024');
});

test('Phase 2K UPC/EAN aliases share one physical latch', () => {
  const h = buildHarness();
  h.context.acceptDecodedCode('652341401024');
  h.advance(10000);
  h.context.acceptDecodedCode('0652341401024');
  assert.equal(h.accepted, 1);
});

test('Phase 2K clear-frame evidence re-arms the same UPC for an intentional next bottle', () => {
  const h = buildHarness();
  h.context.acceptDecodedCode('652341401024');
  h.advance(10000);
  h.context.noteRapidPhysicalClearFrame();
  h.context.noteRapidPhysicalClearFrame();
  h.context.noteRapidPhysicalClearFrame();
  h.context.acceptDecodedCode('0652341401024');
  assert.equal(h.accepted, 2);
  assert.equal(h.context.state.rapidPhysicalRearmed, false);
});

test('Phase 2K different canonical barcode advances the physical scan latch', () => {
  const h = buildHarness();
  h.context.acceptDecodedCode('652341401024');
  h.advance(10000);
  h.context.acceptDecodedCode('123456789012');
  assert.equal(h.accepted, 2);
  assert.equal(h.context.state.rapidPhysicalLatchedBarcode, 'upc:123456789012');
});

test('Phase 2K scanner lifecycle clears physical latch on close', () => {
  assert.match(functionSource('closeScanner'), /resetRapidPhysicalRearm\(\)/);
  assert.match(functionSource('openScanner'), /resetRapidPhysicalRearm\(\)/);
});

test('Phase 2K ready feedback waits for physical re-arm', () => {
  const schedule = functionSource('scheduleRapidScanReady');
  assert.match(schedule, /rapidPhysicalRearmed === false/);
  assert.match(html, /Move bottle away/);
  assert.match(html, /RAPID_CLEAR_FRAMES_REQUIRED/);
});

test('Phase 2K preserves modal, weighted, review, scale, voice, and prior scanner markers', () => {
  for (const marker of [
    'resolveScanWorkflow', 'openQtyModal', 'WEIGH_PARTIAL', 'ADD WEIGHTED TO REVIEW',
    'rapidScanBusy', 'barcodeLookupVariants', 'resolveQuantityAndWeightSemantics',
    '_qnksScaleDivisor', 'safeReviewRowHTML', 'PHASE2E_BLUEFY_BOOT_GUARD',
    'CONNECT / DETAILS', 'VOICE GUIDE', 'SPEAK ITEM NAMES',
    'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT',
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
});

