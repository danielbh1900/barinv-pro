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

function qnksFrame(raw, statusByte, byte11 = 0x7e) {
  const bytes = [0x10, 0x12, 0x00, 0x6c, 0x01, 0x02, 0x05, 0x01,
    statusByte, (raw >> 8) & 0xff, raw & 0xff, byte11, 0x1f, 0x02, 0x58, 0x02, 0x00, 0x00];
  bytes[17] = bytes.slice(0, 17).reduce((sum, value) => (sum + value) & 0xff, 0);
  return bytes;
}

function decoder() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(functionSource('_qnksScaleDivisor') + '\n' + functionSource('_bleDecodeFrame'), context);
  return bytes => context._bleDecodeFrame(bytes);
}

test('Phase 2D decodes QN-KS b8 high-range values without a 10x downscale', () => {
  const decode = decoder();
  for (const raw of [1001, 1408, 1509]) {
    const result = decode(qnksFrame(raw, 0xe8));
    assert.equal(result.confidence, 'high');
    assert.equal(result.divisor, 1);
    assert.equal(result.rangeMode, 'high-range');
    assert.equal(result.grams, raw);
    assert.notEqual(result.grams, raw / 10);
  }
});

test('Phase 2D preserves legitimate low-range decimal QN-KS readings', () => {
  const result = decoder()(qnksFrame(1048, 0xe0, 0x3e));
  assert.equal(result.confidence, 'high');
  assert.equal(result.divisor, 10);
  assert.equal(result.rangeMode, 'low-range');
  assert.equal(result.grams, 104.8);
});

test('Phase 2D diagnostics describe the selected divisor and range truthfully', () => {
  assert.match(html, /raw ' \+ r\.raw \+ ' ÷' \+ r\.divisor \+ ' \[' \+ \(r\.rangeMode === 'high-range' \? 'high' : 'low'\) \+ '\]'/);
  assert.match(html, /÷10 would misread/);
});

test('Phase 2D keeps RAPID barcode scans isolated from modal and scale state', () => {
  const rapid = functionSource('rapidScanAddItem');
  const scanned = functionSource('onBarcodeScanned');
  const rapidBranch = scanned.slice(scanned.indexOf("if (scanWorkflow === 'FAST_UNOPENED_ONE_EACH')"), scanned.indexOf('} else {', scanned.indexOf("if (scanWorkflow === 'FAST_UNOPENED_ONE_EACH')")));
  assert.match(rapidBranch, /rapidScanAddItem\(it, barcodeResult\)/);
  assert.doesNotMatch(rapidBranch, /openQtyModal|qm-ble|bleScale|phase1MeasureUnit|weight-g-input/);
  assert.match(rapid, /qtyOverride: 1/);
  assert.match(rapid, /weightOverride: ''/);
  assert.match(rapid, /bottleStateOverride: 'UNOPENED'/);
  assert.match(rapid, /notesInput\.value = ''/);
  assert.doesNotMatch(rapid, /openQtyModal|qm-ble|bleScale|phase1MeasureUnit/);
});

test('Phase 2D preserves NORMAL modal, scanner close, scale-to-gross, and boot paths', () => {
  const scanned = functionSource('onBarcodeScanned');
  const close = functionSource('closeScanner');
  const useScale = functionSource('_bleUseLatestMain');
  assert.match(scanned, /openQtyModal\(it\)/);
  assert.match(close, /closeQtyModal\(\)/);
  assert.match(close, /state\.zxingControls\.stop\(\)/);
  assert.match(useScale, /phase1-gross-weight/);
  assert.match(useScale, /q\.value = '1'/);
  assert.doesNotMatch(useScale, /q\.value = String\(reading\.grams\)/);
  for (const marker of [
    'PHASE2A', 'canonicalBarcodeCooldownKey', 'Ready for next scan',
    'renderSafeBootError', 'safeReviewRowHTML', 'buildDegradedReviewRow',
    'resolveQuantityAndWeightSemantics', 'CONNECT / DETAILS',
    'VOICE GUIDE', 'SPEAK ITEM NAMES',
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
});

test('Phase 2E has a JS-independent Bluefy boot marker and debug panel', () => {
  const marker = html.indexOf('PHASE2E_BLUEFY_BOOT_GUARD');
  const script = html.indexOf('<script>');
  assert.ok(marker > 0 && marker < script, 'boot marker must precede app JavaScript');
  assert.match(html, /BLUEFY BOOT CHECK/);
  assert.match(html, /Boot stage: html-loaded/);
  assert.match(html, /id="bluefy-boot-debug-panel"/);
  assert.match(html, /bluefyBootDebug=1/);
  assert.match(html, /function bluefyBootStage\(stage, detail\)/);
  assert.match(html, /function renderBluefyBootDiagnostics\(\)/);
});

test('Phase 2E removes parser-risk optional chaining, nullish, numeric separators, and BigInt literals', () => {
  assert.doesNotMatch(html, /\?\./);
  assert.doesNotMatch(html, /\?\?/);
  assert.doesNotMatch(html, /\b[0-9][0-9]*_[0-9][0-9_]*\b/);
  assert.doesNotMatch(html, /\b[0-9]+n\b/);
  assert.match(html, /typeof BigInt !== 'function'/);
});

test('Phase 2E limits service-worker/cache cleanup to local or private preview origins', () => {
  const swStart = html.indexOf('(function barbackKillStaleSW()');
  assert.notEqual(swStart, -1);
  const sw = html.slice(swStart, html.indexOf('})();', swStart) + 5);
  assert.match(sw, /localPreview/);
  assert.match(sw, /if \(!localPreview\) return/);
  assert.match(sw, /serviceWorker/);
  assert.match(sw, /caches\.delete/);
});

test('Phase 2E startup remains isolated from scanner, scale, and voice actions', () => {
  const start = functionSource('startBarbackApp');
  assert.doesNotMatch(start, /openScanner|requestDevice|speechSynthesis|rapidScanAddItem/);
  assert.match(start, /bluefyBootStage\('script-loaded'\)/);
  assert.match(start, /bluefyBootStage\('app-ready'\)/);
});
