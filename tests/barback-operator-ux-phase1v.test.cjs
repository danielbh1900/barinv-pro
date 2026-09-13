const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');
const measure = html.slice(html.indexOf('function phase1RenderWeightTare'), html.indexOf('function renderPhase1MeasureControls'));
const scale = html.slice(html.indexOf('function _bleUseLatestReturn'), html.indexOf('function _weightUseScaleSync'));
const review = html.slice(html.indexOf('function addCurrentSelectionToReview'), html.indexOf("$('save-btn').addEventListener"));

test('Phase 1V keeps units quantity separate from weighted grams', () => {
  assert.match(measure, /const weight = \$\('weight-g-input'\)/);
  assert.match(measure, /weight\.value = String\(net\)/);
  assert.doesNotMatch(measure, /qty\.value = String\(net\)/);
  assert.match(html, /phase1EnsureWeightQuantityDefault/);
  assert.match(html, /Net grams saved as Weight \(g\) · Qty stays 1/);
  assert.match(html, /const measure = row\.weight_g != null/);
  assert.match(html, /Weight \(g\) ' \+ String\(row\.weight_g\)/);
  assert.doesNotMatch(html, /Qty\/grams/);
});

test('Phase 1V scale paths fill Weight (g) and preserve Qty 1', () => {
  assert.match(scale, /var gross = \$\('phase1-gross-weight'\); if \(gross\) gross\.value = String\(reading\.grams\)/);
  assert.match(scale, /var q = \$\('qty-input'\); if \(q\) q\.value = '1'/);
  assert.doesNotMatch(scale, /filled into RETURN QTY/);
  assert.match(scale, /phase1RenderWeightTare\(\)/);
  assert.match(html, /Auto-suggest the single gross Weight field when WEIGHT mode is selected/);
  assert.match(html, /\$\('phase1-gross-weight'\)\.value = grams\.toFixed\(1\)/);
});

test('Phase 1V existing draft path already carries qty and weight_g separately', () => {
  assert.match(review, /const qty = .*qty-input/);
  assert.match(review, /weight_g: weightRaw/);
  assert.match(html, /Weight \(g\)/);
  assert.match(html, /Qty/);
});

test('Phase 1V source resolver prioritizes scale/gross/manual weight without converting quantity-only values', () => {
  assert.match(html, /function resolveQuantityAndWeightSemantics\(input\)/);
  assert.match(html, /scaleUsed \|\| hasGross \|\| tareUsed/);
  assert.match(html, /finalQty: 1, finalWeightG: weightRaw, reason: scaleUsed/);
  assert.match(html, /reason: 'manual Weight \(g\)'/);
  assert.match(html, /finalQty: 1, finalWeightG: weightRaw, reason: 'manual Weight \(g\)'/);
  assert.match(html, /reason: 'quantity-only'/);
  assert.match(html, /Large Qty with no Weight\(g\)\. Review before submitting\./);
  assert.doesNotMatch(html, /Number\(qtyRaw\)\s*>\s*10[\s\S]{0,160}finalWeightG/);
});

test('Phase 1V source preparation keeps the existing fields as the only persistence inputs', () => {
  assert.match(html, /prepareQuantityAndWeightSemantics\(\{\}\)/);
  assert.match(html, /qtyOverride: semantic\.finalQty/);
  assert.match(html, /weightOverride: semantic\.finalWeightG/);
  assert.match(html, /weight_g: weightRaw/);
  assert.doesNotMatch(html, /function (save|eventsInsert|addToReview|addCurrentSelectionToReview)[\s\S]{0,500}resolveQuantityAndWeightSemantics/);
});

test('Phase 1V preserves Phase 1T/1U and current feature markers without a new save path', () => {
  for (const marker of [
    'rapidScanBusy', 'DUPE_SCAN_WINDOW_MS', 'barcodeLookupVariants',
    'hasWebBluetoothScaleSupport', 'navigator.bluetooth.requestDevice',
    'VOICE GUIDE', 'SPEAK ITEM NAMES', 'ACCESSORY / TARE', 'NET SAVED WEIGHT',
    'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.doesNotMatch(measure + scale, /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
