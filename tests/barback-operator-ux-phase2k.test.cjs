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
      rapidPhysicalClearStartedAt: 0,
      rapidPhysicalRearmed: true,
      rapidPhysicalDifferentCandidate: '',
      rapidPhysicalDifferentCount: 0,
      rapidPhysicalDifferentStartedAt: 0,
    },
    resolveScanWorkflow: () => 'FAST_UNOPENED_ONE_EACH',
    canonicalBarcodeCooldownKey: raw => /^(?:0?\d{12})$/.test(String(raw))
      ? 'upc:' + String(raw).replace(/^0/, '')
      : 'raw:' + String(raw),
    lookupBarcodeResult: code => ({ item: { id: 'item-' + code, name: 'Bottle' } }),
    Date: { now: () => now },
    DUPE_SCAN_WINDOW_MS: 2000,
    RAPID_CLEAR_ABSENCE_MS: 1400,
    RAPID_DIFFERENT_CONFIRMATIONS: 2,
    RAPID_DIFFERENT_CONFIRM_WINDOW_MS: 700,
    Feedback: { scan() {} },
    onBarcodeScanned: (_code, _controls, _result, cooldownKey) => {
      accepted += 1;
      context.state.rapidScanBusy = false;
      context.state.rapidPhysicalLatchedBarcode = cooldownKey;
      context.state.rapidPhysicalRearmed = false;
    },
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
  h.context.noteRapidPhysicalClearFrame();
  h.advance(10000);
  h.context.noteRapidPhysicalClearFrame();
  // Phase 2K.2: only the explicit gate may re-arm FAST.
  h.context.resetRapidPhysicalRearm();
  h.context.acceptDecodedCode('0652341401024');
  assert.equal(h.accepted, 2);
  assert.equal(h.context.state.rapidPhysicalRearmed, false);
});

test('Phase 2K.2 clear gaps never re-arm FAST without NEXT SCAN', () => {
  const h = buildHarness();
  h.context.acceptDecodedCode('652341401024');
  h.advance(500);
  h.context.noteRapidPhysicalClearFrame();
  h.context.acceptDecodedCode('652341401024');
  h.advance(500);
  h.context.noteRapidPhysicalClearFrame();
  assert.equal(h.context.state.rapidPhysicalRearmed, false);
  assert.equal(h.accepted, 1);
  h.advance(10000);
  h.context.noteRapidPhysicalClearFrame();
  assert.equal(h.context.state.rapidPhysicalRearmed, false);
  h.context.resetRapidPhysicalRearm();
  assert.equal(h.context.state.rapidPhysicalRearmed, true);
});

test('Phase 2K.2 different barcode cannot bypass the FAST hard lock', () => {
  const h = buildHarness();
  h.context.acceptDecodedCode('652341401024');
  h.advance(10000);
  for (let i = 0; i < 10; i++) h.context.acceptDecodedCode('123456789012');
  assert.equal(h.accepted, 1);
  assert.equal(h.context.state.rapidPhysicalLatchedBarcode, 'upc:652341401024');
});

test('Phase 2K scanner lifecycle clears physical latch on close', () => {
  assert.match(functionSource('closeScanner'), /resetRapidPhysicalRearm\(\)/);
  assert.match(functionSource('openScanner'), /resetRapidPhysicalRearm\(\)/);
});

test('Phase 2K ready feedback waits for physical re-arm', () => {
  const schedule = functionSource('scheduleRapidScanReady');
  assert.match(schedule, /rapidPhysicalRearmed === false/);
  assert.match(html, /Move bottle away/);
  assert.match(html, /RAPID_CLEAR_ABSENCE_MS/);
  assert.match(html, /RAPID_DIFFERENT_CONFIRMATIONS/);
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
