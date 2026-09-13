const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');
const measure = html.slice(html.indexOf('function renderPhase1MeasureControls'), html.indexOf('function initPhase1BlockPresentation'));
const scale = html.slice(html.indexOf('function _bleUseLatestReturn'), html.indexOf('function _weightUseScaleSync'));

test('Phase 1W exposes one authoritative gross-weight input in WEIGHT mode', () => {
  assert.match(html, /id="phase1-gross-weight"/);
  assert.match(html, /id="phase1-qty-input-line"/);
  assert.match(html, /id="phase1-weight-qty-fixed"[^>]*>Qty fixed: 1 for weighted entry/);
  assert.match(measure, /qtyLine\.style\.display = weight \? 'none' : ''/);
  assert.match(measure, /fixedQty\.style\.display = weight \? '' : 'none'/);
  assert.match(measure, /options\.style\.display = !measureWeight/);
});

test('Phase 1W stable scale actions fill gross, recalculate tare, and keep Qty 1', () => {
  assert.match(scale, /var gross = \$\('phase1-gross-weight'\); if \(gross\) gross\.value = String\(reading\.grams\)/);
  assert.match(scale, /var q = \$\('qty-input'\); if \(q\) q\.value = '1'/);
  assert.match(scale, /phase1RenderWeightTare\(\)/);
  assert.doesNotMatch(scale, /var w = \$\('weight-g-input'\); if \(w\) w\.value = String\(reading\.grams\)/);
  assert.doesNotMatch(html, /Fills QTY \(grams\)/);
});

test('Phase 1W tare output remains Weight(g), while quantity-only mode remains separate', () => {
  const tare = html.slice(html.indexOf('function phase1RenderWeightTare'), html.indexOf('function renderPhase1MeasureControls'));
  assert.match(tare, /const weight = \$\('weight-g-input'\)/);
  assert.match(tare, /weight\.value = String\(net\)/);
  assert.match(html, /resolveQuantityAndWeightSemantics/);
  assert.match(html, /Large Qty with no Weight\(g\)\. Review before submitting\./);
  for (const marker of ['rapidScanBusy', 'barcodeLookupVariants', 'hasWebBluetoothScaleSupport', 'VOICE GUIDE', 'SPEAK ITEM NAMES', 'ACCESSORY / TARE', 'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT']) {
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
});
