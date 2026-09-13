const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');
const lookupStart = html.indexOf('function barcodeDigitsOnly');
const lookupEnd = html.indexOf('function setPickedItem', lookupStart);
const lookup = html.slice(lookupStart, lookupEnd);

test('Phase 1U creates only safe UPC-A/EAN-13 leading-zero variants', () => {
  assert.match(lookup, /function barcodeDigitsOnly\(raw\)/);
  assert.match(lookup, /function barcodeLookupVariants\(raw\)/);
  assert.match(lookup, /digits\.length === 12\) add\('0' \+ digits\)/);
  assert.match(lookup, /digits\.length === 13 && digits\[0\] === '0'\) add\(digits\.slice\(1\)\)/);
  assert.doesNotMatch(lookup, /replace\(\/\^0\+\//);
});

test('Phase 1U prioritizes exact matches and rejects ambiguous aliases', () => {
  assert.match(lookup, /const exact = items\.filter/);
  assert.match(lookup, /if \(exactIds\.length === 1\) return \{ item: exact\[0\]/);
  assert.match(lookup, /if \(aliasIds\.length === 1\) return \{ item: aliases\[0\]/);
  assert.match(lookup, /aliasIds\.length > 1/);
  assert.match(html, /Barcode matched multiple items/);
});

test('Phase 1U applies normalized lookup to scanner, search, and HID paths', () => {
  assert.match(html, /const barcodeResult = lookupBarcodeResult\(code\)/);
  assert.match(html, /const barcodeResult = lookupBarcodeResult\(q\)/);
  assert.match(html, /const barcodeResult = lookupBarcodeResult\(v\)/);
  assert.match(html, /const barcodeResult = lookupBarcodeResult\(code\);\n        const it = barcodeResult\.item/);
});

test('Phase 1U releases rapid lock for unmatched and ambiguous scans', () => {
  const scanner = html.slice(html.indexOf('function onBarcodeScanned'), html.indexOf('function showScannerToast'));
  assert.match(scanner, /if \(barcodeResult\.ambiguous\)[\s\S]*releaseRapidScanLock\(\)/);
  assert.match(scanner, /if \(!it\)[\s\S]*releaseRapidScanLock\(\)/);
  assert.match(html, /rapidScanBusy/);
  assert.match(html, /DUPE_SCAN_WINDOW_MS/);
});

test('Phase 1U preserves Phase 1T, Bluefy scale, voice, tare, and no new save path', () => {
  for (const marker of [
    'rapidScanBusy', 'releaseRapidScanLock', 'VOICE GUIDE', 'SPEAK ITEM NAMES',
    'announceOperationalState', 'hasWebBluetoothScaleSupport',
    'navigator.bluetooth.requestDevice', 'CONNECT / DETAILS',
    'ACCESSORY / TARE', 'NET SAVED WEIGHT'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.doesNotMatch(html.slice(html.indexOf('function barcodeDigitsOnly'), html.indexOf('function setPickedItem')), /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
