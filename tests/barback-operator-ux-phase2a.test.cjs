const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');
const scanStart = html.indexOf('function onBarcodeScanned');
const scanEnd = html.indexOf('function showScannerToast', scanStart);
const scan = html.slice(scanStart, scanEnd);
const rapidStart = scan.indexOf("if (scanWorkflow === 'FAST_UNOPENED_ONE_EACH')");
const rapidEnd = scan.indexOf("} else {", rapidStart);
const rapid = scan.slice(rapidStart, rapidEnd);

test('Phase 2A rapid scans bypass the quantity modal and add one unit', () => {
  assert.match(html, /function rapidScanAddItem\(it, barcodeResult\)/);
  assert.match(rapid, /rapidScanAddItem\(it, barcodeResult\)/);
  assert.doesNotMatch(rapid, /openQtyModal\(it\)/);
  assert.match(html, /qtyOverride: 1,[\s\S]*weightOverride: '',[\s\S]*bottleStateOverride: 'UNOPENED'/);
  assert.match(html, /Scan failed — try again/);
  assert.match(html, /Added to Review:/);
});

test('Phase 2A rapid barcode units never inherit weight and release the lock', () => {
  assert.match(html, /weightOverride: ''/);
  assert.match(html, /releaseRapidScanLock\(\);/);
  assert.match(html, /Voice is best-effort and must never hold the scanner processing gate/);
  assert.match(html, /DUPE_SCAN_WINDOW_MS/);
  assert.match(html, /state\.rapidScanBusy = true/);
});

test('Phase 2A keeps NORMAL scan modal behavior and safe modal cleanup', () => {
  assert.match(scan, /openQtyModal\(it\)/);
  assert.match(html, /function closeQtyModal\(\)/);
  assert.match(html, /function closeScanner\(\)/);
  assert.match(html, /closeQtyModal\(\);/);
  assert.match(html, /if \(\$\('qm-cancel'\)\) \$\('qm-cancel'\)\.addEventListener/);
  assert.match(html, /\$\('scanner-close'\)\.addEventListener\('click', closeScanner\)/);
});

test('Phase 2A preserves Review, weight, scale, voice, and barcode paths', () => {
  for (const marker of [
    'showReview', 'renderReview', 'buildDraftRowHTML', 'resolveQuantityAndWeightSemantics',
    'phase1-gross-weight', 'Qty fixed: 1 for weighted entry', 'barcodeLookupVariants',
    'rapidScanBusy', 'CONNECT / DETAILS', 'VOICE GUIDE', 'SPEAK ITEM NAMES',
    'ACCESSORY / TARE', 'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
});
